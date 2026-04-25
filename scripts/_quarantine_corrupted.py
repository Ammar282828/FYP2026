"""One-shot: mark four known-corrupted newspaper docs as image-corrupted.

Resolves each prefix to the single matching newspaper doc id, then writes
``metadata_method = 'image-corrupted'`` so the vision backfill skips it
permanently (see _should_skip in backfill_metadata_vision.py).
"""
from __future__ import annotations

import os
import sys
from datetime import datetime, timezone

_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(_HERE)
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from database.firestore_db import get_firestore_db  # noqa: E402

PREFIXES = ['0361208d', '039862d0', '03a5a12f', '041f8b09']


def main() -> int:
    db = get_firestore_db().db
    coll = db.collection('newspapers')
    now = datetime.now(timezone.utc).isoformat()
    resolved: list[str] = []
    for prefix in PREFIXES:
        # Range scan on the document key: every doc id sorts as a string,
        # so [prefix, prefix + '\uffff'] gives every key starting with prefix.
        # `__name__` cursors take a list of field values; for top-level
        # collections each value is the bare document id.
        docs = list(
            coll.order_by('__name__')
                .start_at([prefix])
                .end_at([prefix + '\uffff'])
                .limit(5)
                .stream()
        )
        if not docs:
            print(f"  ! prefix {prefix}: no match")
            continue
        if len(docs) > 1:
            print(f"  ! prefix {prefix}: {len(docs)} matches — refusing to write")
            for d in docs:
                print(f"      {d.id}")
            continue
        doc = docs[0]
        full = doc.id
        resolved.append(full)
        existing = (doc.to_dict() or {}).get('metadata_method')
        print(f"  · {prefix} -> {full}  (existing method: {existing!r})")
        doc.reference.update({
            'metadata_method': 'image-corrupted',
            'metadata_last_failure': 'PIL cannot decode bytes from image_url '
                                     '(confirmed across 3 backfill runs)',
            'metadata_scored_at': now,
        })
    print()
    print("quarantined doc ids:")
    for r in resolved:
        print(f"  {r}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
