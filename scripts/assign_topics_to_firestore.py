#!/usr/bin/env python3
"""
Assign topics to existing Firestore articles using pre-trained topic model
"""

# this script goes through all the articles in firestore
# and assigns them topics using the trained model
# it does it in batches so it doesn't crash

import os

os.environ['FIREBASE_SERVICE_ACCOUNT_PATH'] = 'config/firebase-service-account.json'
os.environ['FIREBASE_STORAGE_BUCKET'] = 'fyp2026-87a9b.appspot.com'

from bertopic import BERTopic
from database.firestore_db import get_db
from sentence_transformers import SentenceTransformer

def main():
    print("Loading topic model from disk...")

    embedding_model = SentenceTransformer('all-MiniLM-L6-v2')

    topic_model = BERTopic.load('data/topic_model', embedding_model=embedding_model)
    print(f"OK Topic model loaded successfully!")

    topic_info = topic_model.get_topic_info()
    print(f"Number of topics: {len(topic_info)}")

    print("\nConnecting to Firestore...")
    db = get_db()

    print("Fetching articles from Firestore...")
    documents = []
    article_ids = []
    article_metadata = []

    batch_size = 1000
    last_doc = None
    total_fetched = 0

    while True:
        if last_doc:
            articles_query = db.db.collection('articles').order_by('__name__').start_after(last_doc).limit(batch_size)
        else:
            articles_query = db.db.collection('articles').order_by('__name__').limit(batch_size)

        batch_docs = list(articles_query.stream())

        if not batch_docs:
            break

        for doc in batch_docs:
            data = doc.to_dict()
            content = data.get('content', '')
            headline = data.get('headline', '')

            combined_text = f"{headline}\n{content}"

            if combined_text.strip():
                documents.append(combined_text)
                article_ids.append(data.get('id'))
                article_metadata.append({
                    'id': data.get('id'),
                    'headline': headline,
                    'publication_date': data.get('publication_date')
                })

        total_fetched += len(batch_docs)
        print(f"Fetched {total_fetched} articles so far...")

        last_doc = batch_docs[-1]

        if len(batch_docs) < batch_size:
            break

    print(f"\nTotal articles fetched: {len(documents)}")

    if len(documents) == 0:
        print("No articles found in Firestore!")
        return

    print(f"\nAssigning topics to {len(documents)} articles...")
    topics, probabilities = topic_model.transform(documents)
    print("OK Topic assignment completed!")

    print("\nUpdating Firestore with topic assignments...")
    updated_count = 0
    failed_count = 0

    batch_size = 500
    total_articles = len(article_ids)

    for i in range(0, total_articles, batch_size):
        batch = db.db.batch()
        batch_items = 0

        for article_id, topic_id in zip(article_ids[i:i+batch_size], topics[i:i+batch_size]):
            if article_id:
                try:
                    article_ref = db.db.collection('articles').document(article_id)
                    batch.update(article_ref, {'topic_id': int(topic_id)})
                    batch_items += 1
                except Exception as e:
                    print(f"Warning: Failed to add article {article_id} to batch: {e}")
                    failed_count += 1

        try:
            batch.commit()
            updated_count += batch_items
            print(f"  Progress: {updated_count}/{total_articles} articles updated ({100*updated_count//total_articles}%)")
        except Exception as e:
            print(f"Warning: Failed to commit batch: {e}")
            failed_count += batch_items

    print(f"\nOK Completed! Updated {updated_count} articles with topic assignments ({failed_count} failed)")

    print("\nTopic Distribution:")
    from collections import Counter
    topic_counts = Counter(topics)
    for topic_id in sorted(topic_counts.keys())[:10]:
        if topic_id != -1:
            keywords = topic_model.get_topic(topic_id)
            top_words = ', '.join([word for word, _ in keywords[:3]])
            print(f"  Topic {topic_id}: {top_words} (Count: {topic_counts[topic_id]})")
        else:
            print(f"  Topic {topic_id}: Outliers (Count: {topic_counts[topic_id]})")

if __name__ == "__main__":
    main()
