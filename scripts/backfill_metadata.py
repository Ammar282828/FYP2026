"""
Backfill publication_date and page_number on existing Firestore newspapers
and articles by re-deriving them from the source-image filename, then
NULLing out the legacy ``(1990-01-01, page=1)`` silent-default sentinels
that pollute the corpus.

Why
---
The pre-fix ingest pipeline used these silent fallbacks when metadata
extraction failed:

    extract_metadata() failure → (datetime(1990, 1, 1), page=1)
    insert_article() missing keys → (datetime(1990, 1, 1), page=1)

Of the 4,243 articles in production:
    * 2,689 (63.4%) carry the bogus 1990-01-01 date
    * 4,062 (95.7%) carry the bogus page=1
This shows up as a single fake spike in the dashboard's Coverage Intensity
month picker and in the Articles-by-Page chart.

Recovery strategy
-----------------
1. **Filename parse.** Many newspaper records carry an ``image_filename``
   like ``Jun_10_90_p6.jpg`` (Mon_DD_YY_pN). When that pattern matches we
   can recover both date and page exactly — for ~10% of the corpus.
2. **Null sentinels.** For records still sitting on the legacy
   ``(1990-01-01, page=1)`` defaults that we can't recover, set both to
   ``None`` so dashboards bucket them honestly as "Unknown" instead of
   pretending they're real data.

Records that already look real (date != 1990-01-01 OR page != 1) are left
alone — those are presumed to be genuine OCR results, even if the OCR was
imperfect.

Phase 2 (services/metadata_vision.py + scripts/backfill_metadata_vision.py)
will recover the rest by re-running Gemini Vision on the cropped masthead.

Usage
-----
    python -m scripts.backfill_metadata --dry-run            # report only
    python -m scripts.backfill_metadata --only-filename      # phase 1 only — recover from filename, leave sentinels alone
    python -m scripts.backfill_metadata --null-sentinels     # phase 2 only — null out remaining legacy defaults
    python -m scripts.backfill_metadata                      # both passes
"""
from __future__ import annotations

import argparse
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator, Optional

# Importable from repo root.
_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(_HERE)
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)


# ───────────────────────── filename parsing ─────────────────────────────────

_MONTH_ABBR = {
    'jan': 1, 'feb': 2, 'mar': 3, 'apr': 4, 'may': 5, 'jun': 6,
    'jul': 7, 'aug': 8, 'sep': 9, 'oct': 10, 'nov': 11, 'dec': 12,
}

# Mirrors GeminiImageProcessor.parse_filename_metadata in services/pipeline.py.
# Kept duplicated here so this script can run without importing the heavy
# pipeline module (spacy, transformers, etc.).
_DATE_PATTERNS = [
    r'(\d{4})-(\d{2})-(\d{2})',
    r'(\d{4})_(\d{2})_(\d{2})',
    r'(\d{2})-(\d{2})-(\d{4})',
    r'(\d{2})_(\d{2})_(\d{4})',
    r'(\d{8})',
]


def parse_filename(filename: str) -> dict:
    """Extract ``{date, page}`` from a filename. Either or both may be None."""
    if not filename:
        return {'date': None, 'page': None}
    stem = Path(filename).stem

    m = re.match(r'^([A-Za-z]{3})_(\d{1,2})_(\d{2})_p(\d{1,2})$', stem)
    if m:
        mon_abbr, day, yy, page = m.groups()
        mn = _MONTH_ABBR.get(mon_abbr.lower())
        if mn is not None:
            try:
                yr = 1900 + int(yy) if int(yy) >= 50 else 2000 + int(yy)
                return {'date': datetime(yr, mn, int(day), tzinfo=timezone.utc),
                        'page': int(page)}
            except ValueError:
                pass

    for pattern in _DATE_PATTERNS:
        match = re.search(pattern, stem)
        if not match:
            continue
        try:
            if len(match.groups()) == 3:
                g1, g2, g3 = match.groups()
                if len(g1) == 4:
                    year, month, day = int(g1), int(g2), int(g3)
                else:
                    day, month, year = int(g1), int(g2), int(g3)
            else:
                s = match.group(1)
                year, month, day = int(s[:4]), int(s[4:6]), int(s[6:8])
            return {'date': datetime(year, month, day, tzinfo=timezone.utc),
                    'page': None}
        except (ValueError, IndexError):
            continue

    return {'date': None, 'page': None}


# ───────────────────────── sentinel detection ───────────────────────────────

_SENTINEL_DATE = datetime(1990, 1, 1, tzinfo=timezone.utc)
_SENTINEL_DATE_NAIVE = datetime(1990, 1, 1)


def _is_sentinel_date(value) -> bool:
    """True if value is the legacy 1990-01-01 fallback."""
    if value is None:
        return False
    if hasattr(value, 'date'):
        return value.date() == _SENTINEL_DATE.date()
    if isinstance(value, str):
        return value.startswith('1990-01-01')
    return False


def _is_sentinel_page(value) -> bool:
    """True if value is exactly 1 (the legacy fallback)."""
    return value == 1


# ───────────────────────── streaming helpers ────────────────────────────────

def _iter_collection(db, name: str, page_size: int = 500) -> Iterator:
    """Cursor-paginate a Firestore collection without loading it all in memory."""
    coll = db.collection(name)
    last = None
    while True:
        q = coll.order_by('__name__').limit(page_size)
        if last is not None:
            q = q.start_after(last)
        docs = list(q.stream())
        if not docs:
            return
        for d in docs:
            yield d
        last = docs[-1]


# ───────────────────────── pass 1: filename recovery ────────────────────────

def pass_filename(db, args) -> dict:
    """For every newspaper, parse image_filename and update date/page on
    the newspaper itself + every child article that links to it.

    Only writes if the filename gave us something and the existing value
    looks like the legacy sentinel (or is missing). Real OCR-derived data
    is left alone."""
    stats = {'newspapers_seen': 0, 'newspapers_updated': 0,
             'articles_seen': 0, 'articles_updated': 0,
             'unparseable_filenames': 0}

    print("[backfill-metadata] pass 1: filename recovery")
    for d in _iter_collection(db, 'newspapers'):
        stats['newspapers_seen'] += 1
        n = d.to_dict() or {}
        fname = n.get('image_filename') or ''
        parsed = parse_filename(fname)
        if parsed['date'] is None and parsed['page'] is None:
            stats['unparseable_filenames'] += 1
            continue

        new_date = parsed['date']
        new_page = parsed['page']
        cur_date = n.get('publication_date')
        cur_page = n.get('page_number')

        # Build the patch — only overwrite sentinels / missing values.
        patch = {}
        if new_date is not None and (cur_date is None or _is_sentinel_date(cur_date)):
            patch['publication_date'] = new_date
        if new_page is not None and (cur_page is None or _is_sentinel_page(cur_page)):
            patch['page_number'] = new_page

        if not patch:
            continue

        tag = "[DRY]" if args.dry_run else "[OK ]"
        print(f"  {tag} newspaper {d.id[:8]}: {fname}  "
              f"→ date={patch.get('publication_date', cur_date)} "
              f"page={patch.get('page_number', cur_page)}")

        if not args.dry_run:
            d.reference.update(patch)
        stats['newspapers_updated'] += 1

        # Cascade to all articles whose newspaper_id == this newspaper.
        # Bounded scan — most newspapers have <30 articles each.
        children = list(db.collection('articles')
                          .where('newspaper_id', '==', d.id)
                          .stream())
        for c in children:
            stats['articles_seen'] += 1
            cd = c.to_dict() or {}
            cpatch = {}
            if 'publication_date' in patch and (cd.get('publication_date') is None
                                                or _is_sentinel_date(cd.get('publication_date'))):
                cpatch['publication_date'] = patch['publication_date']
            if 'page_number' in patch and (cd.get('page_number') is None
                                           or _is_sentinel_page(cd.get('page_number'))):
                cpatch['page_number'] = patch['page_number']
            if not cpatch:
                continue
            if not args.dry_run:
                c.reference.update(cpatch)
            stats['articles_updated'] += 1

        if args.limit and stats['newspapers_updated'] >= args.limit:
            print(f"[backfill-metadata] reached --limit {args.limit}")
            break

    return stats


# ───────────────────────── pass 2: null out sentinels ───────────────────────

def pass_null_sentinels(db, args) -> dict:
    """For every article still carrying the legacy (1990-01-01, page=1)
    fallback that pass-1 couldn't recover, set both fields to None so the
    dashboards bucket them as 'Unknown' rather than fake real data."""
    stats = {'seen': 0, 'date_nulled': 0, 'page_nulled': 0, 'updated': 0}

    print("[backfill-metadata] pass 2: nulling unrecoverable sentinels")
    for d in _iter_collection(db, 'articles'):
        stats['seen'] += 1
        a = d.to_dict() or {}
        patch = {}
        # Only null DATE if it's exactly 1990-01-01 (the legacy default).
        if _is_sentinel_date(a.get('publication_date')):
            patch['publication_date'] = None
        # Only null PAGE if (a) it's exactly 1 AND (b) date was also a
        # sentinel — the conjunction limits collateral damage to articles
        # that are very likely fakes, not real page-1 stories.
        if _is_sentinel_page(a.get('page_number')) and 'publication_date' in patch:
            patch['page_number'] = None
        if not patch:
            continue

        tag = "[DRY]" if args.dry_run else "[OK ]"
        if stats['updated'] < 10 or stats['updated'] % 200 == 0:
            print(f"  {tag} article {d.id[:8]}: nulling {list(patch.keys())}")
        if not args.dry_run:
            d.reference.update(patch)
        stats['updated'] += 1
        if 'publication_date' in patch:
            stats['date_nulled'] += 1
        if 'page_number' in patch:
            stats['page_nulled'] += 1

        if args.limit and stats['updated'] >= args.limit:
            print(f"[backfill-metadata] reached --limit {args.limit}")
            break

    return stats


# ───────────────────────── main ─────────────────────────────────────────────

def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--dry-run", action="store_true",
                   help="print what would change, don't write")
    p.add_argument("--only-filename", action="store_true",
                   help="run only pass 1 (filename recovery)")
    p.add_argument("--null-sentinels", action="store_true",
                   help="run only pass 2 (null out legacy sentinels)")
    p.add_argument("--limit", type=int, default=0,
                   help="cap number of writes per pass (0 = no limit)")
    args = p.parse_args()

    from database.firestore_db import get_firestore_db
    db_wrapper = get_firestore_db()
    db = db_wrapper.db

    run_filename = args.only_filename or not args.null_sentinels
    run_null = args.null_sentinels or not args.only_filename

    if run_filename:
        s1 = pass_filename(db, args)
        print()
        print("=" * 60)
        print("[backfill-metadata] PASS 1 SUMMARY (filename recovery)")
        for k, v in s1.items():
            print(f"  {k:<28} {v}")
        print()

    if run_null:
        s2 = pass_null_sentinels(db, args)
        print()
        print("=" * 60)
        print("[backfill-metadata] PASS 2 SUMMARY (null sentinels)")
        for k, v in s2.items():
            print(f"  {k:<28} {v}")
        print()

    if not args.dry_run and (run_filename or run_null):
        try:
            db_wrapper._clear_analytics_cache()
            print("[backfill-metadata] analytics cache cleared")
        except Exception as exc:  # noqa: BLE001
            print(f"[backfill-metadata] warning: cache clear failed: {exc}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
