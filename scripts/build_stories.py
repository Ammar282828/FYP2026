#!/usr/bin/env python3
"""
Build stories collection retroactively from existing articles in Firestore.

Usage:
    python scripts/build_stories.py [--date-window 30] [--jaccard 0.15] [--dry-run] [--clear]

Strategy:
  - Groups articles IN MEMORY first using topic + entity overlap + date window.
  - Only writes groups that have 2+ articles to Firestore as stories.
  - Articles with no related articles are simply skipped — no story is created for them.
  - This means stories only appear where they actually make sense.

Run with --dry-run first to check grouping quality without writing anything.
Run with --clear to delete existing stories and rebuild from scratch.
"""

import os
import sys
import argparse
from datetime import timedelta
from typing import List, Dict, Optional

# ─── Environment bootstrap ───────────────────────────────────────────────────
os.environ.setdefault('FIREBASE_SERVICE_ACCOUNT_PATH', 'firebase-service-account.json')
os.environ.setdefault('FIREBASE_STORAGE_BUCKET', 'fyp2026-87a9b.appspot.com')

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database.firestore_db import (
    get_db, _extract_story_entities, _jaccard_similarity
)


def parse_args():
    parser = argparse.ArgumentParser(description='Build MediaScope story groups')
    parser.add_argument('--date-window', type=int, default=30,
                        help='Max days between articles to be in the same story (default: 30)')
    parser.add_argument('--jaccard', type=float, default=0.15,
                        help='Minimum entity Jaccard similarity to group articles (default: 0.15)')
    parser.add_argument('--dry-run', action='store_true',
                        help='Print groups without writing to Firestore')
    parser.add_argument('--clear', action='store_true',
                        help='Delete all existing stories before rebuilding')
    return parser.parse_args()


def fetch_all_articles(db) -> List[Dict]:
    """Fetch all articles with a topic_id, sorted by publication_date ASC."""
    print("Fetching articles from Firestore...")
    docs = []
    batch_size = 500
    last_doc = None

    while True:
        if last_doc:
            query = db.db.collection('articles')\
                .order_by('publication_date')\
                .start_after(last_doc)\
                .limit(batch_size)
        else:
            query = db.db.collection('articles')\
                .order_by('publication_date')\
                .limit(batch_size)

        batch = list(query.stream())
        if not batch:
            break

        for doc in batch:
            data = doc.to_dict()
            topic_id = data.get('topic_id')
            if topic_id is not None and topic_id != -1:
                docs.append(data)

        last_doc = batch[-1]
        print(f"  Fetched {len(docs)} eligible articles so far...")

        if len(batch) < batch_size:
            break

    print(f"[OK] Total articles with topics: {len(docs)}")
    return docs


def clear_existing_stories(db):
    """Delete all story documents and clear story_id from articles."""
    print("Clearing existing stories...")

    story_docs = list(db.db.collection('stories').stream())
    for doc in story_docs:
        doc.reference.delete()
    print(f"[OK] Deleted {len(story_docs)} stories")

    article_docs = list(db.db.collection('articles').stream())
    batch_writer = db.db.batch()
    count = 0
    for doc in article_docs:
        batch_writer.update(doc.reference, {'story_id': None})
        count += 1
        if count % 500 == 0:
            batch_writer.commit()
            batch_writer = db.db.batch()
    if count % 500 != 0:
        batch_writer.commit()
    print(f"[OK] Cleared story_id from {count} articles")


def group_articles_locally(
    articles: List[Dict],
    date_window_days: int,
    jaccard_threshold: float
) -> List[List[Dict]]:
    """
    Group articles in memory. Returns only groups with 2+ articles.

    Each group is a list of article dicts that are about the same ongoing event.
    Articles with no match are silently excluded — no single-article groups.

    Algorithm (single pass, O(n * groups)):
      - Maintain a list of active groups, each tracking:
          - merged entity set (union of all member entities)
          - topic_id
          - latest publication_date in the group (for date window check)
      - For each article (chronological order):
          - Find the best matching group (topic match + date window + Jaccard >= threshold)
          - If match: add article to that group, update merged entities and end_date
          - If no match: add article to a "pending" pool (single candidates)
          - Check pending pool: if this article matches any pending article,
            create a new 2-article group from both
    """
    # Each group: {articles: [...], entity_set: set, topic_id: int, end_date: datetime}
    groups = []
    # Pending: articles waiting for a match — stored as {article, entity_set}
    pending = []

    for article in articles:
        topic_id = article.get('topic_id')
        pub_date = article.get('publication_date')
        art_entities = _extract_story_entities(article.get('entities', []))

        if not art_entities or not pub_date:
            continue

        # ── 1. Try to match an existing multi-article group ──────────────────
        best_group_idx = None
        best_score = 0.0

        for idx, grp in enumerate(groups):
            if grp['topic_id'] != topic_id:
                continue

            # Date window check: article must be within window of group's last article
            if pub_date - grp['end_date'] > timedelta(days=date_window_days):
                continue

            score = _jaccard_similarity(art_entities, grp['entity_set'])
            if score > best_score and score >= jaccard_threshold:
                best_score = score
                best_group_idx = idx

        if best_group_idx is not None:
            grp = groups[best_group_idx]
            grp['articles'].append(article)
            grp['entity_set'] |= art_entities
            grp['end_date'] = max(grp['end_date'], pub_date)
            continue

        # ── 2. Try to match a pending (single-article) candidate ─────────────
        best_pending_idx = None
        best_score = 0.0

        for idx, pend in enumerate(pending):
            if pend['topic_id'] != topic_id:
                continue

            if pub_date - pend['end_date'] > timedelta(days=date_window_days):
                continue

            score = _jaccard_similarity(art_entities, pend['entity_set'])
            if score > best_score and score >= jaccard_threshold:
                best_score = score
                best_pending_idx = idx

        if best_pending_idx is not None:
            pend = pending.pop(best_pending_idx)
            # Promote to a real group
            new_group = {
                'articles': [pend['article'], article],
                'entity_set': pend['entity_set'] | art_entities,
                'topic_id': topic_id,
                'end_date': max(pend['end_date'], pub_date),
            }
            groups.append(new_group)
            continue

        # ── 3. No match — add to pending pool ────────────────────────────────
        pending.append({
            'article': article,
            'entity_set': art_entities,
            'topic_id': topic_id,
            'end_date': pub_date,
        })

    print(f"[OK] Found {len(groups)} story groups with 2+ articles")
    print(f"[OK] {len(pending)} articles had no related articles — skipped")
    return [grp['articles'] for grp in groups]


def write_groups_to_firestore(db, groups: List[List[Dict]]) -> tuple:
    """Write each article group to Firestore as a story. Returns (created, linked) counts."""
    created = 0
    linked = 0

    for articles in groups:
        # Sort chronologically within the group
        articles_sorted = sorted(
            articles,
            key=lambda a: a.get('publication_date') or ''
        )

        # Use the first article as the seed
        seed = articles_sorted[0]
        story_id = db.create_story(seed)
        db.db.collection('articles').document(seed['id']).update({'story_id': story_id})
        created += 1
        linked += 1

        # Add the rest
        for article in articles_sorted[1:]:
            try:
                db.add_article_to_story(story_id, article)
                linked += 1
            except Exception as e:
                print(f"  [ERROR] Failed to add article {article['id']}: {e}")

    return created, linked


def main():
    args = parse_args()

    print("=" * 70)
    print("MediaScope — Build Stories (multi-article only)")
    print(f"  Date window : {args.date_window} days")
    print(f"  Jaccard min : {args.jaccard}")
    print(f"  Dry run     : {args.dry_run}")
    print(f"  Clear first : {args.clear}")
    print("=" * 70)

    db = get_db()

    if args.clear and not args.dry_run:
        clear_existing_stories(db)

    articles = fetch_all_articles(db)

    if not articles:
        print("[ERROR] No articles with topics found. Run topic assignment first.")
        return

    print(f"\nGrouping {len(articles)} articles in memory...")
    groups = group_articles_locally(articles, args.date_window, args.jaccard)

    if not groups:
        print("[INFO] No multi-article groups found. Try lowering --jaccard or increasing --date-window.")
        return

    # Print preview
    print(f"\n{'─' * 70}")
    print(f"PREVIEW — {len(groups)} stories to write:")
    for i, grp in enumerate(groups, 1):
        sorted_grp = sorted(grp, key=lambda a: a.get('publication_date') or '')
        start = sorted_grp[0].get('publication_date')
        end = sorted_grp[-1].get('publication_date')
        start_str = start.strftime('%Y-%m-%d') if hasattr(start, 'strftime') else str(start)[:10]
        end_str = end.strftime('%Y-%m-%d') if hasattr(end, 'strftime') else str(end)[:10]
        headlines = [a.get('headline', '')[:40] for a in sorted_grp[:2]]
        print(f"  [{i}] {len(grp)} articles | {start_str} → {end_str}")
        for h in headlines:
            print(f"       • {h}")
    print(f"{'─' * 70}")

    if args.dry_run:
        print("\n[DRY RUN] No changes written to Firestore.")
        return

    print(f"\nWriting {len(groups)} stories to Firestore...")
    created, linked = write_groups_to_firestore(db, groups)

    print("\n" + "=" * 70)
    print("COMPLETE!")
    print(f"  Stories created   : {created}")
    print(f"  Articles linked   : {linked}")
    print(f"  Articles skipped  : {len(articles) - linked} (no related articles)")

    sizes = [len(g) for g in groups]
    if sizes:
        print(f"\nStory stats:")
        print(f"  Avg articles/story : {sum(sizes)/len(sizes):.1f}")
        print(f"  Largest story      : {max(sizes)} articles")
        print(f"  Smallest story     : {min(sizes)} articles")
    print("=" * 70)


if __name__ == '__main__':
    main()
