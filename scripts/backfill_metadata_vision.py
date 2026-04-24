"""
Backfill ``publication_date`` and ``page_number`` on Firestore newspapers
(and their child articles) by reading the masthead from the stored image
with Gemini Vision.

Why
---
Phase 1 (``scripts/backfill_metadata.py``) handled the easy cases:
  * recovered metadata from filenames matching ``Mon_DD_YY_pN.jpg`` (~10%
    of the corpus — the original Dawn-archive scans), and
  * nulled out the legacy ``(1990-01-01, page=1)`` sentinels for the rest
    so dashboards stop showing fake data.

What's left is the ~3,800 ``IMG_NNNN.JPG`` phone-camera scans whose
filename carries no signal at all but whose *image* still has the printed
date and page number on the masthead. This script reads them with
``services.metadata_vision.extract_metadata_from_image``.

Strategy
--------
1. Stream every newspaper. If ``publication_date`` is None (i.e. it was
   either nulled by Phase 1 or never had one), it's a candidate.
2. Skip newspapers already marked ``metadata_method == 'gemini-vision'``
   (resume-safe; you can re-run interrupted batches without re-spending
   tokens).
3. Download the image from ``image_url`` (Firebase Storage public URL),
   call ``extract_metadata_from_image``.
4. Only write if ``confidence >= --min-confidence`` (default 0.5). The
   model returning 0 means it couldn't read the masthead — log and move on.
5. Cascade the result to every article whose ``newspaper_id`` matches.
   Same write-only-if-currently-None guard so we don't overwrite anything
   that was correctly recovered earlier.

Fields written on success
-------------------------
On the newspaper:
    publication_date         datetime (UTC)
    page_number              int  (only if vision returned one)
    metadata_method          "gemini-vision"
    metadata_confidence      float in [0, 1]
    metadata_reasoning       short string (debug aid)
    metadata_scored_at       ISO-8601 UTC timestamp

Same fields cascade to child articles, with the same guards.

Usage
-----
    GEMINI_API_KEY=AQ... python -m scripts.backfill_metadata_vision --dry-run --limit 5
    GEMINI_API_KEY=AQ... python -m scripts.backfill_metadata_vision --limit 100
    GEMINI_API_KEY=AQ... python -m scripts.backfill_metadata_vision --throttle 0.5
    GEMINI_API_KEY=AQ... python -m scripts.backfill_metadata_vision --resume-force
"""
from __future__ import annotations

import argparse
import os
import sys
import time
from datetime import datetime, timezone
from typing import Iterator, Optional

# Importable from repo root.
_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(_HERE)
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from services.metadata_vision import extract_metadata_from_image  # noqa: E402


# Phase 1's pass_null_sentinels only iterates the `articles` collection, so
# many newspaper docs still carry the legacy (1990-01-01, page=1) fallback.
# Treat that as "missing" here so vision actually picks them up.
_SENTINEL_DATE_DATE = datetime(1990, 1, 1).date()


def _is_sentinel_date(value) -> bool:
    if value is None:
        return False
    if hasattr(value, 'date'):
        return value.date() == _SENTINEL_DATE_DATE
    if isinstance(value, str):
        return value.startswith('1990-01-01')
    return False


def _is_missing_or_sentinel_date(value) -> bool:
    return value is None or _is_sentinel_date(value)


def _is_missing_or_sentinel_page(value) -> bool:
    return value is None or value == 1


def _iter_newspapers(db, page_size: int = 200) -> Iterator[dict]:
    """Cursor-paginate the newspapers collection without loading it all."""
    coll = db.collection('newspapers')
    last = None
    while True:
        q = coll.order_by('__name__').limit(page_size)
        if last is not None:
            q = q.start_after(last)
        docs = list(q.stream())
        if not docs:
            return
        for d in docs:
            data = d.to_dict() or {}
            data['_ref'] = d.reference
            data['_id'] = d.id
            yield data
        last = docs[-1]


def _should_skip(newspaper: dict, args) -> Optional[str]:
    """Return a skip-reason string, or None if this newspaper is a candidate."""
    if not args.resume_force and newspaper.get('metadata_method') == 'gemini-vision':
        return "already vision-scored"
    pub = newspaper.get('publication_date')
    # A newspaper is a candidate if its date is missing OR is the legacy
    # 1990-01-01 sentinel (Phase 1 only nulled articles, not newspapers).
    if not _is_missing_or_sentinel_date(pub) and not args.include_dated:
        return "already has real date"
    if not newspaper.get('image_url'):
        return "no image_url"
    return None


def _cascade_to_articles(db, newspaper_id: str, patch: dict, args) -> int:
    """Apply (subset of) `patch` to every article tied to this newspaper.

    Only fills missing fields — never overwrites existing real data.
    Returns the number of articles updated.
    """
    children = list(db.collection('articles')
                      .where('newspaper_id', '==', newspaper_id)
                      .stream())
    updated = 0
    for c in children:
        cd = c.to_dict() or {}
        cpatch = {}
        # Same guard as the newspaper write: fill if the article is missing
        # OR still carrying the legacy sentinel that Phase 1 may not have
        # nulled yet (e.g. articles that survived the date-AND-page=1
        # conjunction in pass-2 because their page wasn't 1).
        if 'publication_date' in patch and _is_missing_or_sentinel_date(cd.get('publication_date')):
            cpatch['publication_date'] = patch['publication_date']
        if 'page_number' in patch and _is_missing_or_sentinel_page(cd.get('page_number')):
            cpatch['page_number'] = patch['page_number']
        if not cpatch:
            continue
        # Carry the provenance fields across so the article is auditable too.
        for k in ('metadata_method', 'metadata_confidence',
                  'metadata_scored_at', 'metadata_reasoning'):
            if k in patch:
                cpatch[k] = patch[k]
        if not args.dry_run:
            try:
                c.reference.update(cpatch)
            except Exception as exc:  # noqa: BLE001
                print(f"      ! article {c.id[:8]}: write failed: {exc}")
                continue
        updated += 1
    return updated


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--limit", type=int, default=0,
                   help="max newspapers to score (0 = no limit)")
    p.add_argument("--dry-run", action="store_true",
                   help="print what would change, don't write")
    p.add_argument("--throttle", type=float, default=0.4,
                   help="seconds to sleep between vision calls (default 0.4)")
    p.add_argument("--min-confidence", type=float, default=0.5,
                   help="only write if model confidence is >= this (default 0.5)")
    p.add_argument("--model", type=str, default="gemini-2.5-flash")
    p.add_argument("--page-size", type=int, default=200,
                   help="Firestore page size while streaming")
    p.add_argument("--resume-force", action="store_true",
                   help="re-score even newspapers already marked gemini-vision")
    p.add_argument("--include-dated", action="store_true",
                   help="also re-score newspapers that already have a date "
                        "(use only to fix bad earlier vision calls)")
    p.add_argument("--report-every", type=int, default=10,
                   help="print a running tally every N scored newspapers")
    args = p.parse_args()

    if not os.getenv("GEMINI_API_KEY"):
        print("error: GEMINI_API_KEY not set", file=sys.stderr)
        return 2

    print(f"[backfill-vision] starting "
          f"(dry_run={args.dry_run}, limit={args.limit or '∞'}, "
          f"min_conf={args.min_confidence}, model={args.model})")

    from database.firestore_db import get_firestore_db
    db_wrapper = get_firestore_db()
    db = db_wrapper.db

    seen = scored = written = skipped = errored = low_conf = 0
    article_writes = 0
    start = time.time()

    try:
        for n in _iter_newspapers(db, page_size=args.page_size):
            seen += 1
            reason = _should_skip(n, args)
            if reason:
                skipped += 1
                continue

            scored += 1
            try:
                result = extract_metadata_from_image(
                    n['image_url'], model_name=args.model,
                )
            except Exception as exc:  # noqa: BLE001
                errored += 1
                print(f"  ! {n['_id'][:8]}: vision exception: {exc}")
                if args.throttle:
                    time.sleep(args.throttle)
                continue

            conf = result.get('confidence', 0.0)
            date = result.get('date')
            page = result.get('page')

            if conf < args.min_confidence or (date is None and page is None):
                low_conf += 1
                short_reason = (result.get('reasoning') or '')[:80]
                print(f"  · {n['_id'][:8]}: low conf={conf:.2f} "
                      f"(date={date} page={page}) — {short_reason}")
                if args.throttle:
                    time.sleep(args.throttle)
                continue

            # Build the newspaper patch — only fill missing fields. Never
            # overwrite existing real data even if --include-dated.
            patch: dict = {
                'metadata_method': 'gemini-vision',
                'metadata_confidence': conf,
                'metadata_reasoning': result.get('reasoning', ''),
                'metadata_scored_at': datetime.now(timezone.utc).isoformat(),
            }
            # Overwrite both true-None and the legacy 1990-01-01/page=1
            # sentinels — anything we'd consider "real" is left alone.
            if date is not None and _is_missing_or_sentinel_date(n.get('publication_date')):
                patch['publication_date'] = date
            if page is not None and _is_missing_or_sentinel_page(n.get('page_number')):
                patch['page_number'] = page

            tag = "[DRY]" if args.dry_run else "[OK ]"
            print(f"  {tag} {n['_id'][:8]}: "
                  f"date={date.date() if date else '—'} page={page} "
                  f"conf={conf:.2f}  ({(result.get('reasoning') or '')[:60]})")

            if not args.dry_run:
                try:
                    n['_ref'].update(patch)
                except Exception as exc:  # noqa: BLE001
                    errored += 1
                    print(f"  ! {n['_id'][:8]}: newspaper write failed: {exc}")
                    if args.throttle:
                        time.sleep(args.throttle)
                    continue

            written += 1
            article_writes += _cascade_to_articles(db, n['_id'], patch, args)

            if args.report_every and written % args.report_every == 0:
                elapsed = time.time() - start
                rate = scored / elapsed if elapsed > 0 else 0
                print(f"  -- progress: scored={scored} written={written} "
                      f"low_conf={low_conf} errored={errored} "
                      f"articles+={article_writes} ({rate:.2f}/s) --")

            if args.limit and written >= args.limit:
                print(f"[backfill-vision] reached --limit {args.limit}, stopping")
                break

            if args.throttle:
                time.sleep(args.throttle)

    except KeyboardInterrupt:
        print("\n[backfill-vision] interrupted — partial progress kept "
              "(safe to re-run; already-scored docs are skipped)")

    elapsed = time.time() - start
    print()
    print("=" * 60)
    print(f"[backfill-vision] done in {elapsed:.1f}s")
    print(f"  newspapers seen:    {seen}")
    print(f"  newspapers scored:  {scored}")
    print(f"  newspapers written: {written}")
    print(f"  low confidence:     {low_conf}")
    print(f"  errored:            {errored}")
    print(f"  article writes:     {article_writes}")

    # Bust the analytics cache so dashboards reflect the new dates/pages.
    if not args.dry_run and written > 0:
        try:
            db_wrapper._clear_analytics_cache()
            print("[backfill-vision] analytics cache cleared")
        except Exception as exc:  # noqa: BLE001
            print(f"[backfill-vision] warning: cache clear failed: {exc}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
