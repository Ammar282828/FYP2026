#!/usr/bin/env python3
import os
import sys
sys.path.insert(0, '/Users/arqam/Desktop/FYP')

os.environ['FIREBASE_SERVICE_ACCOUNT_PATH'] = '/Users/arqam/Desktop/FYP/config/firebase-service-account.json'
os.environ['FIREBASE_STORAGE_BUCKET'] = 'fypm-a17a4.firebasestorage.app'

print("=" * 70)
print("TRAINING BERTOPIC MODEL")
print("=" * 70)

from database.firestore_db import FirestoreDB
from bertopic import BERTopic
from sentence_transformers import SentenceTransformer
from sklearn.feature_extraction.text import CountVectorizer

print("\n[1/5] Connecting to Firestore...")
import firebase_admin
from firebase_admin import credentials, firestore

cred = credentials.Certificate('/Users/arqam/Desktop/FYP/config/firebase-service-account.json')
try:
    firebase_admin.initialize_app(cred, {'storageBucket': 'fypm-a17a4.firebasestorage.app'})
except:
    pass
db = FirestoreDB()

print("[2/5] Fetching articles...")
docs = list(db.db.collection('articles').stream())
documents = []
article_ids = []

for doc in docs:
    data = doc.to_dict()
    text = f"{data.get('headline', '')}\n\n{data.get('content', '')}"
    if text.strip():
        documents.append(text)
        article_ids.append(data.get('id'))

print(f"      Found {len(documents)} articles")

if len(documents) < 5:
    print("ERROR: Need at least 5 articles")
    sys.exit(1)

print("\n[3/5] Training topic model (this may take 2-3 minutes)...")
print("      - Downloading embedding model (one-time, ~90MB)...")
embedding_model = SentenceTransformer('all-MiniLM-L6-v2')

print("      - Configuring BERTopic with improved settings...")
from umap import UMAP
from hdbscan import HDBSCAN

# Adaptive parameters based on dataset size
min_size = max(2, len(documents) // 8)

vectorizer = CountVectorizer(
    ngram_range=(1, 3),  # Capture more nuanced phrases
    stop_words="english",
    min_df=1,  # Lower threshold for small datasets
    max_df=0.85
)

# Better dimension reduction
umap_model = UMAP(
    n_neighbors=min(10, len(documents) - 1),
    n_components=min(5, len(documents) - 1),
    metric='cosine',
    random_state=42
)

# More diverse topic clustering
hdbscan_model = HDBSCAN(
    min_cluster_size=min_size,
    metric='euclidean',
    cluster_selection_method='eom',
    prediction_data=True
)

topic_model = BERTopic(
    embedding_model=embedding_model,
    vectorizer_model=vectorizer,
    umap_model=umap_model,
    hdbscan_model=hdbscan_model,
    top_n_words=10,
    nr_topics="auto",
    calculate_probabilities=True,
    verbose=False
)

print("      - Fitting model to documents...")
topics, probs = topic_model.fit_transform(documents)

num_topics = len(set(topics)) - (1 if -1 in topics else 0)
outliers = list(topics).count(-1)
print(f"      ✓ Discovered {num_topics} topics ({outliers} outliers)")

print("\n[4/5] Saving model to data/topic_model...")
topic_model.save('data/topic_model', serialization="pickle", save_ctfidf=True, save_embedding_model=False)
print("      ✓ Model saved")

print("\n[5/5] Assigning topics to all articles in Firestore...")
for i, (article_id, topic_id) in enumerate(zip(article_ids, topics)):
    if topic_id == -1:
        topic_label = 'Uncategorized'
    else:
        words = topic_model.get_topic(topic_id)
        topic_label = '_'.join([w for w, _ in words[:5]])
    
    db.db.collection('articles').document(article_id).update({
        'topic_id': int(topic_id),
        'topic_label': topic_label
    })
    
    if (i + 1) % 5 == 0 or (i + 1) == len(article_ids):
        print(f"      [{i+1}/{len(article_ids)}] updated")

print("\n" + "=" * 70)
print("✓ COMPLETE!")
print("=" * 70)
print(f"Topics discovered: {num_topics}")
print(f"Articles updated: {len(article_ids)}")
print("\nYou can now:")
print("  • View Topic Trends Over Time in the dashboard")
print("  • Upload new newspapers - they'll get topics automatically")
