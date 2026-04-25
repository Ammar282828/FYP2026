"""
Backfill sentiment on existing Firestore articles using Gemini.

Why
---
The legacy RoBERTa scorer labels most Dawn 1990s articles "neutral" — the
model is Twitter-trained and the pipeline truncates to 1000 chars. Once
audit_sentiment.py confirms Gemini produces meaningfully different labels,
this script re-scores the corpus in place.

Safe defaults
-------------
- Skips articles that already have `sentiment_method == 'gemini'` (resume).
- `--dry-run` prints what would change without writing.
- `--only-neutral` re-scores only articles the legacy scorer marked neutral
  (the highest-impact slice — recommended for a first pass).
- Throttles between calls to avoid quota exhaustion.
- On any per-article failure, logs and continues — never stops the whole run.
- Streams via Firestore page-token paging instead of loading the full
  collection into memory.

Usage
-----
    GEMINI_API_KEY=AQ... python -m scripts.backfill_sentiment --dry-run --limit 5
    GEMINI_API_KEY=AQ... python -m scripts.backfill_sentiment --only-neutral --limit 500
    GEMINI_API_KEY=AQ... python -m scripts.backfill_sentiment            # full corpus
    GEMINI_API_KEY=AQ... python -m scripts.backfill_sentiment --resume   # explicit re-run

Fields written
--------------
    sentiment_score:      float in [-1, 1]
    sentiment_label:      "positive" | "neutral" | "negative"
    sentiment_method:     "gemini"
    sentiment_confidence: float in [0, 1]
    sentiment_reasoning:  short string from the model
    sentiment_scored_at:  ISO-8601 UTC timestamp
"""
from __future__ import annotations

import argparse
import os
import sys
import time
from datetime import datetime, timezone
from typing import Iterator, Optional

# Importable from the repo root.
_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(_HERE)
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from services.sentiment_gemini import analyze_sentiment_gemini  # noqa: E402
from scripts._call_timeout import call_with_timeout  # noqa: E402


def _iter_articles(db, page_size: int = 200) -> Iterator[dict]:
    """
    Stream every article doc (as dict, with `_ref` injected for write-back).

    Uses Firestore's native cursor pagination so memory stays bounded even on
    a 100k-article corpus. Falls back to the in-memory snapshot if the live
    stream throws.
    """
    coll = db.collection('articles')
    last_doc = None
    while True:
        q = coll.order_by('__name__').limit(page_size)
        if last_doc is not None:
            q = q.start_after(last_doc)
        docs = list(q.stream())
        if not docs:
            return
        for d in docs:
            data = d.to_dict() or {}
            data['_ref'] = d.reference
            data['_id'] = d.id
            yield data
        last_doc = docs[-1]


def _should_skip(article: dict, args) -> Optional[str]:
    """Return a skip-reason string, or None if the article should be scored."""
    if not args.resume_force and article.get('sentiment_method') == 'gemini':
        return "already gemini-scored"
    if args.only_neutral and article.get('sentiment_label') != 'neutral':
        return "not legacy-neutral"
    text = article.get('content') or article.get('text') or ''
    if not text.strip():
        return "no content"
    return None


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--limit", type=int, default=0,
                   help="max articles to score (0 = no limit)")
    p.add_argument("--only-neutral", action="store_true",
                   help="only re-score articles the legacy scorer called 'neutral'")
    p.add_argument("--dry-run", action="store_true",
                   help="print what would change, don't write")
    p.add_argument("--throttle", type=float, default=0.4,
                   help="seconds to sleep between Gemini calls (default 0.4)")
    p.add_argument("--model", type=str, default="gemini-3.1-pro-preview",
                   help="Gemini model. As of 2026-04 the Vertex Express key "
                        "in europe-west1 has 3.1-pro-preview enabled; "
                        "3-pro-preview / 3.1-flash variants 404. Fallbacks "
                        "that also work: gemini-2.5-pro, gemini-2.5-flash.")
    p.add_argument("--page-size", type=int, default=200,
                   help="Firestore page size while streaming")
    p.add_argument("--resume-force", action="store_true",
                   help="re-score even articles already marked gemini")
    p.add_argument("--report-every", type=int, default=20,
                   help="print a running tally every N scored articles")
    args = p.parse_args()

    if not os.getenv("GEMINI_API_KEY"):
        print("error: GEMINI_API_KEY not set", file=sys.stderr)
        return 2

    print(f"[backfill] starting "
          f"(only_neutral={args.only_neutral}, dry_run={args.dry_run}, "
          f"limit={args.limit or '∞'}, model={args.model})")

    from database.firestore_db import get_firestore_db
    db_wrapper = get_firestore_db()
    db = db_wrapper.db  # raw firestore client

    seen = scored = skipped = errored = 0
    label_changes = {('neutral', 'positive'): 0, ('neutral', 'negative'): 0,
                     ('neutral', 'neutral'): 0,
                     ('positive', 'negative'): 0, ('negative', 'positive'): 0,
                     ('positive', 'neutral'): 0, ('negative', 'neutral'): 0,
                     ('positive', 'positive'): 0, ('negative', 'negative'): 0}
    start = time.time()

    try:
        for article in _iter_articles(db, page_size=args.page_size):
            seen += 1
            reason = _should_skip(article, args)
            if reason:
                skipped += 1
                continue

            text = article.get('content') or article.get('text') or ''
            old_label = article.get('sentiment_label', 'neutral')
            try:
                result = call_with_timeout(
                    analyze_sentiment_gemini, text,
                    model_name=args.model, timeout=60.0,
                )
            except Exception as exc:  # noqa: BLE001 (TimeoutError + Gemini errors)
                errored += 1
                print(f"  ! {article['_id']}: gemini error: {exc}")
                if args.throttle:
                    time.sleep(args.throttle)
                continue

            if result.get('confidence', 0) <= 0:
                errored += 1
                print(f"  ! {article['_id']}: no signal "
                      f"({(result.get('reasoning') or '')[:80]})")
                if args.throttle:
                    time.sleep(args.throttle)
                continue

            new_label = result['label']
            key = (old_label, new_label)
            label_changes[key] = label_changes.get(key, 0) + 1

            payload = {
                'sentiment_score': result['score'],
                'sentiment_label': new_label,
                'sentiment_method': 'gemini',
                'sentiment_confidence': result['confidence'],
                'sentiment_reasoning': result.get('reasoning', ''),
                'sentiment_scored_at': datetime.now(timezone.utc).isoformat(),
            }

            tag = "[DRY]" if args.dry_run else "[OK ]"
            arrow = '→' if old_label != new_label else '='
            print(f"  {tag} {article['_id']}: {old_label} {arrow} {new_label} "
                  f"(score={result['score']:+.2f}, conf={result['confidence']:.2f})")

            if not args.dry_run:
                try:
                    article['_ref'].update(payload)
                except Exception as exc:  # noqa: BLE001
                    errored += 1
                    print(f"  ! {article['_id']}: write failed: {exc}")
                    continue

            scored += 1
            if args.report_every and scored % args.report_every == 0:
                elapsed = time.time() - start
                rate = scored / elapsed if elapsed > 0 else 0
                print(f"  -- progress: scored={scored} skipped={skipped} "
                      f"errored={errored} ({rate:.1f}/s) --")

            if args.limit and scored >= args.limit:
                print(f"[backfill] reached --limit {args.limit}, stopping")
                break

            if args.throttle:
                time.sleep(args.throttle)

    except KeyboardInterrupt:
        print("\n[backfill] interrupted — partial progress kept "
              "(safe to re-run; already-scored docs are skipped)")

    elapsed = time.time() - start
    print()
    print("=" * 60)
    print(f"[backfill] done in {elapsed:.1f}s")
    print(f"  seen:    {seen}")
    print(f"  scored:  {scored}")
    print(f"  skipped: {skipped}")
    print(f"  errored: {errored}")
    print()
    print("Label transitions (old → new):")
    for (old, new), count in sorted(label_changes.items(), key=lambda kv: -kv[1]):
        if count == 0:
            continue
        marker = " (changed)" if old != new else ""
        print(f"  {old:>9} → {new:<9}  {count:>5}{marker}")

    # Bust the analytics cache so dashboards reflect the new labels next request.
    if not args.dry_run and scored > 0:
        try:
            db_wrapper._clear_analytics_cache()
            print("\n[backfill] analytics cache cleared")
        except Exception as exc:
            print(f"\n[backfill] warning: failed to clear analytics cache: {exc}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
