#!/usr/bin/env python3
"""
Assign topics to existing Firestore articles using Gemini API.
Replaces the old BERTopic-based scripts with a simpler Gemini classification approach.
Uses the predefined topic taxonomy from data/topics_data.json.
"""

import os
import sys
import json
import time

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
load_dotenv()

import google.generativeai as genai
from database.firestore_db import get_db

# Gemini API keys (rotate on quota errors).
# Reads from environment: GEMINI_API_KEY (primary) + optional GEMINI_API_KEYS (comma-separated)
def _load_api_keys():
    keys = []
    primary = os.getenv("GEMINI_API_KEY", "").strip()
    if primary:
        keys.append(primary)
    rotation = os.getenv("GEMINI_API_KEYS", "").strip()
    if rotation:
        for k in rotation.split(","):
            k = k.strip()
            if k and k not in keys:
                keys.append(k)
    if not keys:
        raise RuntimeError(
            "No Gemini API keys configured. Set GEMINI_API_KEY (and optionally "
            "GEMINI_API_KEYS as a comma-separated list) in your environment or .env"
        )
    return keys

API_KEYS = _load_api_keys()
_key_index = 0


def rotate_key():
    global _key_index
    _key_index = (_key_index + 1) % len(API_KEYS)
    genai.configure(api_key=API_KEYS[_key_index])
    print(f"  [INFO] Rotated to API key {_key_index + 1}/{len(API_KEYS)}")


def load_topic_taxonomy():
    """Load predefined topics from topics_data.json"""
    topics_file = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "topics_data.json")
    if not os.path.exists(topics_file):
        print(f"ERROR: {topics_file} not found")
        sys.exit(1)

    with open(topics_file, 'r') as f:
        data = json.load(f)

    topics = [t for t in data.get('topics', []) if t['topic_id'] != -1]
    print(f"Loaded {len(topics)} topic categories")
    return topics


def build_topic_prompt(topics):
    """Build the topic list for classification prompt."""
    lines = []
    for t in topics:
        keywords = ', '.join(t.get('keywords', [])[:5])
        lines.append(f"  {t['topic_id']}: {t['name']} - {t.get('description', '')} (keywords: {keywords})")
    return '\n'.join(lines)


def classify_batch(articles_batch, topic_list_str, topics):
    """Classify a batch of articles using Gemini."""
    articles_block = ""
    for j, (aid, headline, content) in enumerate(articles_batch):
        snippet = f"{headline}\n{content[:600]}"
        articles_block += f"\n--- ARTICLE {j} ---\n{snippet}\n"

    prompt = f"""You are a newspaper article topic classifier for Dawn newspaper (Pakistan, 1990-1992).

Classify each article below into exactly ONE of these topics:

{topic_list_str}

If an article does not clearly fit any topic, use topic_id -1.

{articles_block}

Respond with ONLY a valid JSON array, no markdown:
[{{"article_index": 0, "topic_id": <number>}}, ...]"""

    keys_tried = 0
    while keys_tried < len(API_KEYS):
        try:
            model = genai.GenerativeModel('gemini-2.0-flash')
            response = model.generate_content(prompt)
            raw = response.text.strip() if response.parts else ""

            if '```json' in raw:
                raw = raw.split('```json')[1].split('```')[0].strip()
            elif '```' in raw:
                raw = raw.split('```')[1].split('```')[0].strip()

            batch_results = json.loads(raw)
            valid_ids = {t['topic_id'] for t in topics}

            result_map = {}
            for r in batch_results:
                idx = r.get('article_index', -1)
                tid = int(r.get('topic_id', -1))
                if tid not in valid_ids:
                    tid = -1
                result_map[idx] = tid

            # Build results aligned to input batch
            results = []
            for j in range(len(articles_batch)):
                tid = result_map.get(j, -1)
                if tid == -1:
                    results.append({'topic_id': -1, 'topic_label': 'Uncategorized'})
                else:
                    for t in topics:
                        if t['topic_id'] == tid:
                            results.append({
                                'topic_id': tid,
                                'topic_label': '_'.join(t.get('keywords', [])[:5])
                            })
                            break
                    else:
                        results.append({'topic_id': -1, 'topic_label': 'Uncategorized'})

            return results

        except Exception as e:
            if any(x in str(e).lower() for x in ['quota', '429', 'rate', '403']):
                keys_tried += 1
                if keys_tried < len(API_KEYS):
                    rotate_key()
                    time.sleep(1)
                continue
            else:
                print(f"  [ERROR] Gemini classification failed: {e}")
                break

    # Fallback: all uncategorized
    return [{'topic_id': -1, 'topic_label': 'Uncategorized'} for _ in articles_batch]


def main():
    print("=" * 70)
    print("GEMINI TOPIC ASSIGNMENT")
    print("Classify articles using Gemini API (no BERTopic needed)")
    print("=" * 70)

    # Initialize
    genai.configure(api_key=API_KEYS[_key_index])
    topics = load_topic_taxonomy()
    topic_list_str = build_topic_prompt(topics)

    print("\nConnecting to Firestore...")
    db = get_db()

    # Fetch all articles
    print("Fetching articles from Firestore...")
    articles = []
    batch_size = 1000
    last_doc = None
    total_fetched = 0

    while True:
        if last_doc:
            query = db.db.collection('articles').order_by('__name__').start_after(last_doc).limit(batch_size)
        else:
            query = db.db.collection('articles').order_by('__name__').limit(batch_size)

        batch_docs = list(query.stream())
        if not batch_docs:
            break

        for doc in batch_docs:
            data = doc.to_dict()
            articles.append((
                data.get('id'),
                data.get('headline', ''),
                data.get('content', '')
            ))

        total_fetched += len(batch_docs)
        print(f"  Fetched {total_fetched} articles...")
        last_doc = batch_docs[-1]

        if len(batch_docs) < batch_size:
            break

    print(f"\nTotal articles: {len(articles)}")

    if not articles:
        print("No articles found!")
        return

    # Classify in batches of 10
    print("\nClassifying articles with Gemini API...")
    gemini_batch_size = 10
    all_results = []
    total = len(articles)

    for i in range(0, total, gemini_batch_size):
        batch = articles[i:i + gemini_batch_size]
        results = classify_batch(batch, topic_list_str, topics)
        all_results.extend(results)

        done = min(i + gemini_batch_size, total)
        if done % 50 == 0 or done == total:
            print(f"  Classified {done}/{total} articles ({100 * done // total}%)")

        # Small delay to avoid rate limiting
        time.sleep(0.3)

    # Update Firestore
    print("\nUpdating Firestore with topic assignments...")
    updated = 0
    failed = 0
    firestore_batch_size = 500

    for i in range(0, len(articles), firestore_batch_size):
        batch = db.db.batch()
        batch_items = 0

        for j in range(i, min(i + firestore_batch_size, len(articles))):
            article_id = articles[j][0]
            result = all_results[j]

            if article_id:
                try:
                    ref = db.db.collection('articles').document(article_id)
                    batch.update(ref, {
                        'topic_id': result['topic_id'],
                        'topic_label': result['topic_label']
                    })
                    batch_items += 1
                except Exception as e:
                    failed += 1

        try:
            batch.commit()
            updated += batch_items
            print(f"  Updated {updated}/{len(articles)} articles ({100 * updated // len(articles)}%)")
        except Exception as e:
            print(f"  [ERROR] Batch commit failed: {e}")
            failed += batch_items

    # Summary
    from collections import Counter
    topic_counts = Counter(r['topic_id'] for r in all_results)

    print(f"\n{'=' * 70}")
    print("COMPLETE!")
    print(f"{'=' * 70}")
    print(f"Updated: {updated}/{len(articles)} articles")
    if failed:
        print(f"Failed: {failed}")
    print(f"\nTopic Distribution (top 10):")
    for tid, count in topic_counts.most_common(10):
        if tid == -1:
            print(f"  Uncategorized: {count} articles")
        else:
            for t in topics:
                if t['topic_id'] == tid:
                    print(f"  {t['name']}: {count} articles")
                    break


if __name__ == "__main__":
    main()
