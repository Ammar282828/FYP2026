#!/usr/bin/env python3
import os
import sys
os.environ.setdefault('FIREBASE_SERVICE_ACCOUNT_PATH', '/Users/arqam/Desktop/FYP/fypm-a17a4-firebase-adminsdk-w60h5-29c009db1a.json')
os.environ.setdefault('FIREBASE_STORAGE_BUCKET', 'fypm-a17a4.firebasestorage.app')

from services.pipeline import Config, NLPProcessor
from database.firestore_db import get_firestore_db

print('Fetching articles...')
db = get_firestore_db()
docs = list(db.db.collection('articles').stream())
documents = []
article_ids = []

for doc in docs:
    data = doc.to_dict()
    text = f"{data.get('headline', '')}\n\n{data.get('content', '')}"
    if text.strip():
        documents.append(text)
        article_ids.append(data.get('id'))

print(f'Found {len(documents)} articles')

if len(documents) < 5:
    print('ERROR: Need at least 5 articles to train')
    sys.exit(1)

print('Training topic model (this may take 1-2 minutes)...')
config = Config()
nlp = NLPProcessor(config)
nlp.train_topic_model(documents)

print('Saving model...')
nlp.save_topic_model('data/topic_model')

print('Assigning topics to Firestore...')
for i, (article_id, topic_id) in enumerate(zip(article_ids, nlp.topic_assignments)):
    if topic_id == -1:
        topic_label = 'Uncategorized'
    else:
        words = nlp.topic_model.get_topic(topic_id)
        topic_label = '_'.join([w for w, _ in words[:5]])
    
    db.db.collection('articles').document(article_id).update({
        'topic_id': int(topic_id),
        'topic_label': topic_label
    })
    print(f'  [{i+1}/{len(article_ids)}] Topic {topic_id}: {topic_label[:50]}')

print('\nDONE! Topic model trained and all articles updated.')
print('You can now view Topic Trends Over Time in the dashboard.')
