#!/usr/bin/env python3
"""Dedup articles in Firestore.

Strategy:
  Group by (publication_date day, headline_lower, content_prefix_lower).
  Within each group, keep the article with the highest word_count and
  most pipeline-metadata (sentiment_method, topic_method, summary,
  entities). Delete the rest.

Why content-prefix in the key:
  Naive (date, headline) catches false dupes — bylines like "From Our
  Correspondent" or "By Our Staff Reporter" appear on many distinct
  articles every day. Using the first 200 chars of body content as
  part of the key keeps real reprints (where body matches) but lets
  byline-collision articles survive untouched.

Usage:
    python scripts/dedup_articles.py --dry-run    # preview only
    python scripts/dedup_articles.py              # delete duplicates
"""
import argparse
import os
import re
import sys
from collections import defaultdict

os.environ.setdefault('FIREBASE_SERVICE_ACCOUNT_PATH', 'firebase-service-account.json')
os.environ.setdefault('FIREBASE_STORAGE_BUCKET', 'fyp2026-87a9b.appspot.com')
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database.firestore_db import get_db


# Bylines and other "shared headline, different article" patterns.
# We treat any headline starting with one of these as ambiguous and
# require BOTH headline AND content-prefix to match before dedup'ing.
_BYLINE_PATTERNS = [
    re.compile(r'^\s*(from\s+(our|a)\s+(correspondent|staff)|'
               r'by\s+(our|a)\s+(staff\s+)?(reporter|correspondent)|'
               r'reuter|afp|ap|app|ppi|ipa|dpa|xinhua|tass)',
               re.IGNORECASE),
    re.compile(r'^\s*\(continued from page', re.IGNORECASE),
]


def _is_byline_headline(h: str) -> bool:
    return any(p.match(h or '') for p in _BYLINE_PATTERNS)


def _normalize_for_key(s: str) -> str:
    """Lowercase + collapse whitespace + strip punctuation noise."""
    s = re.sub(r'\s+', ' ', (s or '').strip().lower())
    s = re.sub(r'[^\w\s]', '', s)
    return s


def _quality_key(a: dict):
    """Higher = keeper. Tuple sort: more words first, then more metadata."""
    return (
        a.get('word_count') or len((a.get('content') or '').split()),
        1 if a.get('topic_method') else 0,
        1 if a.get('sentiment_method') else 0,
        1 if a.get('summary') else 0,
        len(a.get('entities') or []),
        # Fallback: keep the newer document so re-runs are deterministic
        str(a.get('created_at') or ''),
    )


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true',
                    help='Preview only. No deletions.')
    ap.add_argument('--prefix-chars', type=int, default=200,
                    help='Body-content prefix length used in dedup key (default 200).')
    ap.add_argument('--limit', type=int, default=0,
                    help='Hard cap on deletions (0 = no cap).')
    args = ap.parse_args()

    print('=' * 70)
    print('Dedup articles  (dry_run={dry})'.format(dry=args.dry_run))
    print('=' * 70)

    db_wrap = get_db()
    db = db_wrap.db

    # Stream every article; we need full content to compute prefix.
    print('Fetching articles…')
    groups = defaultdict(list)
    total = 0
    skipped_no_date = 0
    for d in db.collection('articles').stream():
        total += 1
        a = d.to_dict() or {}
        a['__id'] = d.id
        a['__ref'] = d.reference
        h = a.get('headline') or ''
        pd = a.get('publication_date')
        if not pd:
            skipped_no_date += 1
            continue
        day = pd.isoformat()[:10] if hasattr(pd, 'isoformat') else str(pd)[:10]
        head_norm = _normalize_for_key(h)[:120]
        body = a.get('content') or ''
        body_prefix = _normalize_for_key(body)[:args.prefix_chars]

        if _is_byline_headline(h):
            # Ambiguous byline: require BOTH headline AND content-prefix
            # to match. Practically that means we only dedup byline
            # articles that are also identical reprints.
            key = ('byline', day, head_norm, body_prefix)
        else:
            # Real headline: same day + same headline + same body prefix
            # are very likely a real duplicate (same wire story re-saved).
            key = ('real', day, head_norm, body_prefix)

        groups[key].append(a)
        if total % 5000 == 0:
            print(f'  scanned {total}…')

    dupes = {k: v for k, v in groups.items() if len(v) >= 2}
    print(f'\nScanned {total} articles ({skipped_no_date} skipped — no date)')
    print(f'Duplicate groups (>=2 entries): {len(dupes)}')

    by_kind = defaultdict(int)
    for (kind, *_), v in dupes.items():
        by_kind[kind] += len(v) - 1
    print(f'Articles to delete:')
    for kind, n in by_kind.items():
        print(f'  {kind}: {n}')
    total_to_delete = sum(by_kind.values())

    if total_to_delete == 0:
        print('Nothing to do.')
        return 0

    print(f'\nLargest groups:')
    for k, v in sorted(dupes.items(), key=lambda kv: -len(kv[1]))[:10]:
        kind, day, head, body_pref = k
        head_show = (head[:55] + '…') if len(head) > 55 else head
        wcs = sorted([a.get('word_count') or 0 for a in v], reverse=True)
        print(f'  {len(v)}× [{kind}] ({day}) "{head_show}"  word_counts={wcs[:6]}{"..." if len(wcs) > 6 else ""}')

    if args.dry_run:
        print('\n[DRY RUN] No changes written.')
        return 0

    # Delete duplicates: keep the highest-quality article in each group.
    deleted = 0
    print(f'\nDeleting {total_to_delete} duplicate articles…')
    for k, v in dupes.items():
        if args.limit and deleted >= args.limit:
            break
        ranked = sorted(v, key=_quality_key, reverse=True)
        keeper = ranked[0]
        for victim in ranked[1:]:
            if args.limit and deleted >= args.limit:
                break
            try:
                victim['__ref'].delete()
                deleted += 1
                if deleted % 100 == 0:
                    print(f'  deleted {deleted}/{total_to_delete}…')
            except Exception as e:
                print(f'  ! failed to delete {victim["__id"][:8]}: {e}')
    print(f'\nDone. Deleted {deleted} duplicates.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
