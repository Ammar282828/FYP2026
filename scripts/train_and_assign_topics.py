#!/usr/bin/env python3
"""
Train BERTopic model on existing articles and assign topics to all articles
"""

import os
import sys

# Set environment variables
os.environ['FIREBASE_SERVICE_ACCOUNT_PATH'] = '/Users/arqam/Desktop/FYP/fypm-a17a4-firebase-adminsdk-w60h5-29c009db1a.json'
os.environ['FIREBASE_STORAGE_BUCKET'] = 'fypm-a17a4.firebasestorage.app'

# Add parent directory to path
sys.path.insert(0, '/Users/arqam/Desktop/FYP')

from bertopic import BERTopic
from database.firestore_db import FirestoreDB
from sentence_transformers import SentenceTransformer
from sklearn.feature_extraction.text import CountVectorizer
from datetime import datetime

def main():
    print("=" * 70)
    print("STEP 1: Fetching articles from Firestore")
    print("=" * 70)
    
    db = FirestoreDB()
    
    articles_ref = db.db.collection('articles').stream()
    
    documents = []
    article_ids = []
    article_data = []
    
    for doc in articles_ref:
        data = doc.to_dict()
        content = data.get('content', '')
        headline = data.get('headline', '')
        
        # Combine headline and content for better topic modeling
        combined_text = f"{headline}\n\n{content}"
        
        if combined_text.strip():
            documents.append(combined_text)
            article_ids.append(data.get('id'))
            article_data.append({
                'id': data.get('id'),
                'headline': headline[:60],
                'pub_date': data.get('publication_date')
            })
    
    print(f"Found {len(documents)} articles")
    
    if len(documents) < 5:
        print("ERROR: Not enough articles to train topic model (need at least 5)")
        print("Please upload more newspapers first!")
        return
    
    print("\n" + "=" * 70)
    print("STEP 2: Training BERTopic model")
    print("=" * 70)
    
    # Initialize embedding model
    print("Loading embedding model...")
    embedding_model = SentenceTransformer('all-MiniLM-L6-v2')
    
    # Configure vectorizer
    vectorizer_model = CountVectorizer(
        ngram_range=(1, 2),
        stop_words="english",
        min_df=1,  # Lower threshold for small dataset
        max_df=0.9
    )
    
    # Initialize BERTopic
    print("Initializing BERTopic...")
    topic_model = BERTopic(
        embedding_model=embedding_model,
        vectorizer_model=vectorizer_model,
        nr_topics="auto",
        min_topic_size=3,  # Lower threshold for small dataset
        calculate_probabilities=True,
        verbose=True
    )
    
    # Train the model
    print("\nTraining topic model (this may take a minute)...")
    topics, probabilities = topic_model.fit_transform(documents)
    
    num_topics = len(set(topics)) - (1 if -1 in topics else 0)
    print(f"\n[OK] Discovered {num_topics} topics (plus {list(topics).count(-1)} outliers)")
    
    # Display topic info
    print("\nTopic Summary:")
    topic_info = topic_model.get_topic_info()
    for idx, row in topic_info.head(10).iterrows():
        topic_id = int(row['Topic'])
        count = int(row['Count'])
        if topic_id != -1:
            topic_words = topic_model.get_topic(topic_id)
            keywords = [word for word, _ in topic_words[:3]]
            print(f"  Topic {topic_id}: {' • '.join(keywords)} ({count} articles)")
        else:
            print(f"  Topic {topic_id}: Outliers ({count} articles)")
    
    print("\n" + "=" * 70)
    print("STEP 3: Saving topic model")
    print("=" * 70)
    
    model_path = 'data/topic_model'
    print(f"Saving to {model_path}...")
    topic_model.save(model_path, serialization="pickle", save_ctfidf=True, save_embedding_model=False)
    print("[OK] Topic model saved!")
    
    print("\n" + "=" * 70)
    print("STEP 4: Assigning topics to all articles in Firestore")
    print("=" * 70)
    
    updated_count = 0
    failed_count = 0
    
    for i, (article_id, topic_id, prob) in enumerate(zip(article_ids, topics, probabilities)):
        try:
            # Get topic label (keywords)
            if topic_id == -1:
                topic_label = 'Uncategorized'
            else:
                topic_words = topic_model.get_topic(topic_id)
                keywords = [word for word, _ in topic_words[:5]]
                topic_label = '_'.join(keywords)
            
            # Update Firestore
            article_ref = db.db.collection('articles').document(article_id)
            article_ref.update({
                'topic_id': int(topic_id),
                'topic_label': topic_label
            })
            
            updated_count += 1
            
            # Show progress
            if article_data[i]['headline']:
                print(f"  [{i+1}/{len(article_ids)}] {article_data[i]['headline'][:50]}... → Topic {topic_id}: {topic_label[:30]}")
            
        except Exception as e:
            print(f"  [ERROR] Failed to update article {article_id}: {e}")
            failed_count += 1
    
    print("\n" + "=" * 70)
    print("COMPLETE!")
    print("=" * 70)
    print(f"✓ Trained topic model with {num_topics} topics")
    print(f"✓ Updated {updated_count}/{len(article_ids)} articles")
    if failed_count > 0:
        print(f"✗ Failed to update {failed_count} articles")
    print("\nYou can now:")
    print("  1. View Topic Trends Over Time in the analytics dashboard")
    print("  2. Upload new newspapers - they will automatically get topics assigned")

if __name__ == "__main__":
    main()
