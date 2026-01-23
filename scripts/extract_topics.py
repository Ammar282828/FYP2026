#!/usr/bin/env python3
"""
Extract topic information from saved BERTopic model
Works around Python 3.14 compatibility issues by using pickle directly
"""

# this script loads the topic model and extracts all the topic data
# then saves it to a json file so we can use it later

import pickle
import json
from pathlib import Path

def extract_topics_from_model():

    try:
        with open('data/topic_model', 'rb') as f:
            model_data = pickle.load(f)

        print("Model loaded successfully!")
        print(f"Model type: {type(model_data)}")

        if hasattr(model_data, 'get_topic_info'):
            topic_info = model_data.get_topic_info()
            print(f"\nFound {len(topic_info)} topics")

            topics_list = []

            for idx, row in topic_info.iterrows():
                topic_id = int(row['Topic'])

                if topic_id == -1:
                    topics_list.append({
                        'topic_id': topic_id,
                        'name': 'Outliers',
                        'keywords': [],
                        'count': int(row['Count'])
                    })
                else:
                    topic_words = model_data.get_topic(topic_id)
                    keywords = [word for word, score in topic_words[:10]]
                    keyword_scores = [(word, float(score)) for word, score in topic_words[:10]]

                    top_keywords = [word for word, _ in topic_words[:3]]
                    topic_name = ' • '.join([k.title() for k in top_keywords])

                    topics_list.append({
                        'topic_id': topic_id,
                        'name': topic_name,
                        'keywords': keywords,
                        'keyword_scores': keyword_scores,
                        'count': int(row['Count'])
                    })

                    if idx < 10:
                        print(f"  Topic {topic_id}: {topic_name} (Count: {row['Count']})")

            output_data = {
                'total_topics': len(topics_list),
                'topics': topics_list,
                'extracted_at': '2025-12-17',
                'model_file': 'data/topic_model'
            }

            with open('data/topics_data.json', 'w') as f:
                json.dump(output_data, f, indent=2)

            print(f"\nOK Successfully extracted {len(topics_list)} topics")
            print(f"OK Saved to data/topics_data.json")

            return topics_list

        else:
            print("Model doesn't have get_topic_info method")
            return None

    except Exception as e:
        print(f"Error extracting topics: {e}")
        import traceback
        traceback.print_exc()
        return None

if __name__ == "__main__":
    extract_topics_from_model()
