"""
Regenerate ``data/topics_data.json`` from the curated taxonomy and the
current Firestore article counts.

Why
---
The ``/api/topics/`` endpoint reads from ``data/topics_data.json`` to render
the topic browser (TopicDistribution widget). Historically that JSON came
from the BERTopic model output via ``scripts/extract_topics.py``. Once we
switch to the curated taxonomy in ``data/topics_taxonomy.json`` plus the
Gemini classifier (``services.topics_gemini``), the JSON cache needs to be
rebuilt from a different source: the curated taxonomy entries + the actual
counts of articles assigned each ``topic_label``.

This script:
  1. Loads the curated taxonomy (data/topics_taxonomy.json).
  2. Counts how many Firestore articles carry each curated ``topic_label``.
  3. Writes ``data/topics_data.json`` in the same shape the existing
     endpoint expects: ``{topic_id, name, keywords, count}`` per topic.

The endpoint code does NOT need to change — the JSON shape is preserved.
What changes is that ``name`` is now the human-readable label (``'Cricket'``)
instead of the BERTopic underscore string (``'match_cricket_team_final_england'``).

Usage
-----
    python -m scripts.regen_topics_data            # write data/topics_data.json
    python -m scripts.regen_topics_data --dry-run  # print what would be written
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path


_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(_HERE)
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)


def _count_articles_per_label(db) -> dict[str, int]:
    """Stream every article and tally `topic_label` values.

    Uses the same cursor-pagination pattern as backfill scripts so this
    stays bounded on large corpora.
    """
    counts: dict[str, int] = {}
    coll = db.collection('articles')
    last_doc = None
    while True:
        q = coll.order_by('__name__').limit(500)
        if last_doc is not None:
            q = q.start_after(last_doc)
        docs = list(q.stream())
        if not docs:
            return counts
        for d in docs:
            data = d.to_dict() or {}
            label = data.get('topic_label')
            if not label:
                continue
            counts[label] = counts.get(label, 0) + 1
        last_doc = docs[-1]


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--dry-run", action="store_true",
                   help="print what would be written, don't write")
    p.add_argument("--out", type=str, default="data/topics_data.json")
    args = p.parse_args()

    taxonomy_path = Path(_ROOT) / "data" / "topics_taxonomy.json"
    if not taxonomy_path.exists():
        print(f"error: {taxonomy_path} not found", file=sys.stderr)
        return 2
    with open(taxonomy_path, "r", encoding="utf-8") as f:
        tax = json.load(f).get("topics", [])

    print(f"[regen-topics] loaded {len(tax)} curated topic entries")

    from database.firestore_db import get_firestore_db
    db_wrapper = get_firestore_db()
    db = db_wrapper.db

    print("[regen-topics] counting articles per topic_label …")
    counts = _count_articles_per_label(db)
    total = sum(counts.values())
    print(f"[regen-topics] tallied {total} labelled articles "
          f"({len(counts)} distinct labels)")

    topics_list = []
    for entry in tax:
        label = entry["label"]
        topics_list.append({
            'topic_id': entry["id"],
            'name': label,
            'keywords': entry.get("keywords", []),
            'description': entry.get("description", ""),
            'key': entry.get("key", ""),
            'count': counts.get(label, 0),
        })

    # Surface every non-taxonomy label individually instead of
    # collapsing them into one "Legacy" bucket. The audit was lumping
    # ~45 distinct labels (Cricket, Education, Foreign Relations, …)
    # under a single row, which (a) hid topics from the browser and
    # (b) made the topic count look stuck at ~40. Each gets its own
    # entry with a synthetic id (10000+i) so they can't collide with
    # curated taxonomy ids.
    used_labels = {t["name"] for t in topics_list}
    extras = sorted(
        ((lbl, n) for lbl, n in counts.items() if lbl not in used_labels),
        key=lambda kv: -kv[1],
    )
    if extras:
        print(f"[regen-topics] including {len(extras)} extra labels not in "
              "the curated taxonomy")
        for i, (lbl, n) in enumerate(extras):
            topics_list.append({
                'topic_id': 10000 + i,
                'name': lbl,
                'keywords': [],
                'description': "Auto-generated topic — not part of the curated taxonomy. "
                               "Edit data/topics_taxonomy.json to promote.",
                'count': n,
                'auto': True,
            })

    output_data = {
        'total_topics': len(topics_list),
        'topics': topics_list,
        'extracted_at': datetime.now(timezone.utc).isoformat(),
        'source': 'curated taxonomy (data/topics_taxonomy.json) + Firestore counts',
    }

    blob = json.dumps(output_data, indent=2)
    if args.dry_run:
        print()
        print("=" * 60)
        print("DRY RUN — would write the following to", args.out)
        print("=" * 60)
        print(blob[:2000])
        if len(blob) > 2000:
            print(f"... ({len(blob) - 2000} more bytes)")
        return 0

    out_path = Path(_ROOT) / args.out
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(blob)
    print(f"[regen-topics] wrote {out_path} "
          f"({len(topics_list)} entries, {len(blob)} bytes)")

    # Bust the analytics cache so the topic-distribution endpoint picks
    # up the new counts.
    try:
        db_wrapper._clear_analytics_cache()
        print("[regen-topics] analytics cache cleared")
    except Exception as exc:  # noqa: BLE001
        print(f"[regen-topics] warning: failed to clear analytics cache: {exc}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
