"""
Backfill topic labels on existing Firestore articles using the curated
Gemini classifier (services.topics_gemini).

Why
---
The original topic labels on stored articles were BERTopic-derived underscore
strings like ``'kgs_grams_oil_40 kgs'`` that the frontend had to humanize via
a hand-rolled TOPIC_NAME_MAP. The new pipeline (services.topics_gemini)
classifies against the curated taxonomy in ``data/topics_taxonomy.json`` and
writes clean human-readable labels (``'Crime & Violence'``, ``'Cricket'``…).
This script re-classifies the existing corpus in place so dashboards stop
showing the legacy underscore noise.

Safe defaults
-------------
- Skips articles that already have ``topic_method == 'gemini-curated'``
  (resume-safe).
- ``--dry-run`` prints what would change without writing.
- ``--only-legacy`` re-classifies only articles with the underscore-style
  labels (highest signal-to-noise — recommended for a first pass).
- Throttles between calls to avoid quota exhaustion.
- On per-article failure, logs and continues.
- Streams via Firestore cursor pagination — bounded memory.

Usage
-----
    GEMINI_API_KEY=AQ... python -m scripts.backfill_topics --dry-run --limit 5
    GEMINI_API_KEY=AQ... python -m scripts.backfill_topics --only-legacy --limit 500
    GEMINI_API_KEY=AQ... python -m scripts.backfill_topics            # full corpus
    GEMINI_API_KEY=AQ... python -m scripts.backfill_topics --resume-force

Fields written
--------------
    topic_id:           int   (canonical id from data/topics_taxonomy.json)
    topic_label:        str   ("Crime & Violence" etc.)
    topic_key:          str   slug ("crime-violence")
    topic_confidence:   float in [0, 1]
    topic_reasoning:    short string from the model
    topic_method:       "gemini-curated"
    topic_scored_at:    ISO-8601 UTC timestamp
"""
from __future__ import annotations

import argparse
import os
import re
import sys
import time
from datetime import datetime, timezone
from typing import Iterator, Optional

# Importable from the repo root.
_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(_HERE)
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from services.topics_gemini import (  # noqa: E402
    classify_topic_gemini,
    classify_topics_batch_gemini,
    BATCH_TOPIC_SIZE,
)
from scripts._call_timeout import call_with_timeout  # noqa: E402


# A label looks "legacy" if it's the BERTopic underscore-keyword style
# (e.g. ``kgs_grams_oil_40 kgs``) — three or more underscore-joined tokens —
# OR the literal "Uncategorized" placeholder.
_LEGACY_RE = re.compile(r"^[a-z0-9 ]+(_[a-z0-9 ]+){2,}$")


def _is_legacy_label(label: Optional[str]) -> bool:
    if not label:
        return True
    if label == "Uncategorized":
        return True
    return bool(_LEGACY_RE.match(label.strip()))


def _iter_articles(db, page_size: int = 200) -> Iterator[dict]:
    """Stream every article doc with cursor pagination (bounded memory)."""
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
    """Return a skip-reason string, or None if the article should be classified."""
    if not args.resume_force and article.get('topic_method') == 'gemini-curated':
        return "already curated"
    if args.only_legacy and not _is_legacy_label(article.get('topic_label')):
        return "not legacy-style label"
    text = article.get('content') or article.get('text') or ''
    headline = article.get('headline') or ''
    if not (text.strip() or headline.strip()):
        return "no content"
    return None


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--limit", type=int, default=0,
                   help="max articles to classify (0 = no limit)")
    p.add_argument("--only-legacy", action="store_true",
                   help="only re-classify articles whose topic_label looks "
                        "BERTopic-style (underscore-joined keywords) or 'Uncategorized'")
    p.add_argument("--dry-run", action="store_true",
                   help="print what would change, don't write")
    p.add_argument("--throttle", type=float, default=0.4,
                   help="seconds to sleep between Gemini calls (default 0.4)")
    p.add_argument("--model", type=str, default="gemini-3.1-pro-preview",
                   help="Gemini model. 3.1-pro-preview is enabled on the "
                        "Vertex Express project (europe-west1) as of 2026-04; "
                        "3-pro-preview 404s. Fallback: gemini-2.5-pro.")
    p.add_argument("--page-size", type=int, default=200,
                   help="Firestore page size while streaming")
    p.add_argument("--resume-force", action="store_true",
                   help="re-classify even articles already marked gemini-curated")
    p.add_argument("--report-every", type=int, default=20,
                   help="print a running tally every N classified articles")
    p.add_argument("--batch-size", type=int, default=BATCH_TOPIC_SIZE,
                   help=f"how many articles per Gemini call (default {BATCH_TOPIC_SIZE}, "
                        "0 = legacy per-article path)")
    args = p.parse_args()

    if not os.getenv("GEMINI_API_KEY"):
        print("error: GEMINI_API_KEY not set", file=sys.stderr)
        return 2

    print(f"[backfill-topics] starting "
          f"(only_legacy={args.only_legacy}, dry_run={args.dry_run}, "
          f"limit={args.limit or '∞'}, model={args.model})")

    from database.firestore_db import get_firestore_db
    db_wrapper = get_firestore_db()
    db = db_wrapper.db  # raw firestore client

    seen = classified = skipped = errored = 0
    label_counts: dict[str, int] = {}
    transitions: dict[tuple[str, str], int] = {}
    start = time.time()

    use_batch = args.batch_size > 1

    # Per-batch buffer: each entry is (article_dict, combined_text, old_label).
    # Flushed when it reaches batch_size OR the input stream ends. The flush
    # function is a closure over all the running counters above.
    pending: list[tuple[dict, str, str]] = []

    def _flush() -> bool:
        """Send the pending batch to Gemini, write the results to Firestore.
        Returns False when --limit causes us to stop early."""
        nonlocal classified, errored
        if not pending:
            return True

        texts = [entry[1] for entry in pending]
        try:
            results = call_with_timeout(
                classify_topics_batch_gemini, texts,
                model_name=args.model, batch_size=args.batch_size, timeout=120.0,
            )
        except Exception as exc:  # noqa: BLE001
            # Whole-batch hard failure (timeout, network). Flag every
            # article in the batch as errored and continue.
            for art, _, _ in pending:
                errored += 1
                print(f"  ! {art['_id']}: gemini batch error: {exc}")
            pending.clear()
            if args.throttle:
                time.sleep(args.throttle)
            return True

        for (art, _combined, old_label), result in zip(pending, results):
            if result.get('confidence', 0) <= 0:
                errored += 1
                print(f"  ! {art['_id']}: no signal "
                      f"({(result.get('reasoning') or '')[:80]})")
                continue

            new_label = result['topic_label']
            label_counts[new_label] = label_counts.get(new_label, 0) + 1
            transitions[(old_label, new_label)] = transitions.get((old_label, new_label), 0) + 1

            payload = {
                'topic_id': result['topic_id'],
                'topic_label': new_label,
                'topic_key': result['topic_key'],
                'topic_confidence': result['confidence'],
                'topic_reasoning': result.get('reasoning', ''),
                'topic_method': 'gemini-curated',
                'topic_scored_at': datetime.now(timezone.utc).isoformat(),
            }

            tag = "[DRY]" if args.dry_run else "[OK ]"
            arrow = '→' if old_label != new_label else '='
            old_short = (old_label[:32] + '…') if len(old_label) > 32 else old_label
            print(f"  {tag} {art['_id']}: {old_short:<33} {arrow} {new_label} "
                  f"(conf={result['confidence']:.2f})")

            if not args.dry_run:
                try:
                    art['_ref'].update(payload)
                except Exception as exc:  # noqa: BLE001
                    errored += 1
                    print(f"  ! {art['_id']}: write failed: {exc}")
                    continue

            classified += 1
            if args.report_every and classified % args.report_every == 0:
                elapsed = time.time() - start
                rate = classified / elapsed if elapsed > 0 else 0
                print(f"  -- progress: classified={classified} skipped={skipped} "
                      f"errored={errored} ({rate:.1f}/s) --")

            if args.limit and classified >= args.limit:
                pending.clear()
                print(f"[backfill-topics] reached --limit {args.limit}, stopping")
                return False

        pending.clear()
        if args.throttle:
            time.sleep(args.throttle)
        return True

    try:
        for article in _iter_articles(db, page_size=args.page_size):
            seen += 1
            reason = _should_skip(article, args)
            if reason:
                skipped += 1
                continue

            text = article.get('content') or article.get('text') or ''
            headline = article.get('headline') or ''
            combined = f"{headline}\n\n{text}".strip()
            old_label = article.get('topic_label') or 'Uncategorized'

            if use_batch:
                pending.append((article, combined, old_label))
                if len(pending) >= args.batch_size:
                    if not _flush():
                        break
                continue

            # ── Legacy per-article path (--batch-size 0 or 1) ──
            try:
                result = call_with_timeout(
                    classify_topic_gemini, combined,
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

            new_label = result['topic_label']
            label_counts[new_label] = label_counts.get(new_label, 0) + 1
            transitions[(old_label, new_label)] = transitions.get((old_label, new_label), 0) + 1

            payload = {
                'topic_id': result['topic_id'],
                'topic_label': new_label,
                'topic_key': result['topic_key'],
                'topic_confidence': result['confidence'],
                'topic_reasoning': result.get('reasoning', ''),
                'topic_method': 'gemini-curated',
                'topic_scored_at': datetime.now(timezone.utc).isoformat(),
            }

            tag = "[DRY]" if args.dry_run else "[OK ]"
            arrow = '→' if old_label != new_label else '='
            old_short = (old_label[:32] + '…') if len(old_label) > 32 else old_label
            print(f"  {tag} {article['_id']}: {old_short:<33} {arrow} {new_label} "
                  f"(conf={result['confidence']:.2f})")

            if not args.dry_run:
                try:
                    article['_ref'].update(payload)
                except Exception as exc:  # noqa: BLE001
                    errored += 1
                    print(f"  ! {article['_id']}: write failed: {exc}")
                    continue

            classified += 1
            if args.report_every and classified % args.report_every == 0:
                elapsed = time.time() - start
                rate = classified / elapsed if elapsed > 0 else 0
                print(f"  -- progress: classified={classified} skipped={skipped} "
                      f"errored={errored} ({rate:.1f}/s) --")

            if args.limit and classified >= args.limit:
                print(f"[backfill-topics] reached --limit {args.limit}, stopping")
                break

            if args.throttle:
                time.sleep(args.throttle)

        # End of stream — drain whatever's left in the batch buffer.
        if use_batch:
            _flush()

    except KeyboardInterrupt:
        print("\n[backfill-topics] interrupted — partial progress kept "
              "(safe to re-run; already-classified docs are skipped)")

    elapsed = time.time() - start
    print()
    print("=" * 60)
    print(f"[backfill-topics] done in {elapsed:.1f}s")
    print(f"  seen:       {seen}")
    print(f"  classified: {classified}")
    print(f"  skipped:    {skipped}")
    print(f"  errored:    {errored}")
    if label_counts:
        print()
        print("Top labels assigned:")
        for label, count in sorted(label_counts.items(), key=lambda kv: -kv[1])[:15]:
            print(f"  {label:<32}  {count:>5}")

    # Bust the analytics cache so dashboards reflect the new labels next request.
    if not args.dry_run and classified > 0:
        try:
            db_wrapper._clear_analytics_cache()
            print("\n[backfill-topics] analytics cache cleared")
        except Exception as exc:  # noqa: BLE001
            print(f"\n[backfill-topics] warning: failed to clear analytics cache: {exc}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
