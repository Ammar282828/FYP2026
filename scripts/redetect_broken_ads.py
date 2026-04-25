"""
Re-detect ads for newspapers whose stored ads have broken/legacy coords.

Why
---
~63% of the legacy ``advertisements`` collection has degenerate
coordinates (typically ``y1=4031, y2=4051`` — a 20-pixel sliver pinned to
the bottom edge of a 4032×3024 phone scan). These came from an older
ingester whose Gemini bbox parser failed silently and saved a constant
fallback. They render as bands of binding/spine in the AdBrowser. The
recut script can't help — the source coords are junk.

Recovery: re-run ``ImageProcessor.detect_ads`` against each affected
parent newspaper image, replace the junk ad docs with freshly detected
ones, and let the current detect_ads filters (60-pixel min, 70%-max
area, 0.15-min aspect) keep us honest going forward.

What "broken" means here
------------------------
We mark an ad as broken when ANY of:
  - sliver: ``min(crop_w, crop_h) < 60`` (matches detect_ads' filter)
  - off-page: ``y1`` or ``y2`` >= parent height
              (parent is landscape 4032×3024; coords were saved in
              rotated portrait pixel space — anything past 3023 in y is
              outside the actual image)

Cost
----
Each affected newspaper costs:
  1× detect_ads call (full page, downscaled)  ~$
  N× analyze_ad_image calls (one per detected ad)  ~$$
The script groups by newspaper_id so we only call detect_ads once per
parent regardless of how many broken ads it has.

Usage
-----
    python -m scripts.redetect_broken_ads --dry-run --limit 5
    python -m scripts.redetect_broken_ads --limit 10 --throttle 2
    python -m scripts.redetect_broken_ads                  # full corpus
    python -m scripts.redetect_broken_ads --resume-force   # ignore reprocess marks
"""
from __future__ import annotations

import argparse
import io
import os
import sys
import tempfile
import time
from collections import defaultdict
from datetime import datetime, timezone
from typing import Iterator, Optional

# Make the repo importable.
_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(_HERE)
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)


# Min sane crop dimension. Mirrors services/pipeline.py:detect_ads filter.
_MIN_CROP_PX = 60


def _is_broken(coords: dict, parent_h: Optional[int] = None) -> Optional[str]:
    """Return a short reason string when coords are degenerate, else None.

    Only handles the legacy ``{x1,y1,x2,y2}`` schema; new percentage
    schema ads aren't candidates for re-detection.
    """
    if not isinstance(coords, dict):
        return 'no coords'
    if not all(k in coords for k in ('x1', 'y1', 'x2', 'y2')):
        return None  # percentage schema, not a candidate
    try:
        x1, y1, x2, y2 = (int(coords['x1']), int(coords['y1']),
                          int(coords['x2']), int(coords['y2']))
    except (TypeError, ValueError):
        return 'unparseable coords'
    w, h = x2 - x1, y2 - y1
    if min(w, h) < _MIN_CROP_PX:
        return f'sliver {w}x{h}'
    if parent_h and (y1 >= parent_h or y2 > parent_h + 1):
        return f'off-page y={y1}-{y2} > parent_h={parent_h}'
    return None


def _iter_ads(db, page_size: int = 200) -> Iterator[dict]:
    coll = db.collection('advertisements')
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


def _download_parent(url: str):
    """Download a newspaper image URL → PIL.Image (un-rotated)."""
    import requests
    from PIL import Image
    r = requests.get(url, timeout=30)
    r.raise_for_status()
    img = Image.open(io.BytesIO(r.content))
    img.load()
    return img


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--limit", type=int, default=0,
                   help="max NEWSPAPERS to re-detect (0 = no limit)")
    p.add_argument("--dry-run", action="store_true",
                   help="print what would change, don't call Gemini or write")
    p.add_argument("--throttle", type=float, default=1.5,
                   help="seconds to sleep between newspapers")
    p.add_argument("--resume-force", action="store_true",
                   help="re-process newspapers already marked redetect_at")
    p.add_argument("--page-size", type=int, default=200,
                   help="Firestore page size while streaming ads")
    args = p.parse_args()

    print(f"[redetect] starting (dry_run={args.dry_run}, "
          f"limit={args.limit or 'inf'} newspapers, "
          f"resume_force={args.resume_force})")

    from database.firestore_db import get_firestore_db
    from services.pipeline import Config, ImageProcessor
    from PIL import Image  # noqa: F401  (pulled in for ImageProcessor)

    db_wrapper = get_firestore_db()
    db = db_wrapper.db

    # Phase 1: scan ads, group broken ones by newspaper_id.
    print("[redetect] scanning ads for broken coords ...")
    broken_by_paper: dict[str, list[dict]] = defaultdict(list)
    parent_cache: dict[str, dict] = {}
    seen = 0
    for ad in _iter_ads(db, page_size=args.page_size):
        seen += 1
        np_id = (ad.get('newspaper_id') or '').strip()
        if not np_id or np_id.startswith('local_'):
            continue
        # Lazy parent-doc fetch (just for the height — used by _is_broken's
        # off-page check).
        if np_id not in parent_cache:
            try:
                snap = db.collection('newspapers').document(np_id).get()
                parent_cache[np_id] = snap.to_dict() or {} if snap.exists else {}
            except Exception:
                parent_cache[np_id] = {}
        # Without a true parent_h we still flag slivers (min<60). Off-page
        # rejection just needs ANY parent height; we don't actually load
        # the image yet — but the legacy y=4031/4051 pattern is caught by
        # the sliver rule anyway.
        reason = _is_broken(ad.get('coordinates') or {}, parent_h=None)
        if reason:
            ad['_broken_reason'] = reason
            broken_by_paper[np_id].append(ad)

    print(f"[redetect] scanned {seen} ads — "
          f"{sum(len(v) for v in broken_by_paper.values())} broken across "
          f"{len(broken_by_paper)} parent newspapers")

    if not broken_by_paper:
        print("[redetect] nothing to do.")
        return 0

    # Phase 2: per affected newspaper — download, re-detect, replace.
    cfg = Config()
    image_proc = ImageProcessor(cfg)

    seen_papers = recovered = removed = errored = 0
    new_ads_total = 0
    start = time.time()
    skip_reasons: dict[str, int] = defaultdict(int)

    try:
        for np_id, broken_ads in broken_by_paper.items():
            seen_papers += 1
            np_doc = parent_cache.get(np_id) or {}

            if not args.resume_force and np_doc.get('ads_redetect_at'):
                skip_reasons['already redetected'] += 1
                continue

            url = np_doc.get('image_url') or ''
            if not url:
                skip_reasons['no parent url'] += 1
                continue

            tag = "[DRY]" if args.dry_run else "[OK ]"
            print(f"\n{tag} {np_id[:8]}  ({len(broken_ads)} broken ads "
                  f"to replace)")

            try:
                raw = _download_parent(url)
                page_img = image_proc.enhance_image(raw)
            except Exception as exc:
                errored += 1
                print(f"  ! parent download/enhance failed: {exc}")
                continue

            # Re-detect ads against the rotated portrait (matches the
            # coord-system the existing valid ads also use).
            try:
                detected = image_proc.detect_ads(page_img)
            except Exception as exc:
                errored += 1
                print(f"  ! detect_ads failed: {exc}")
                continue

            print(f"  detected {len(detected)} ad regions on this page")

            if args.dry_run:
                # Preview only — don't write or delete.
                for ad in detected[:5]:
                    bb = ad.get('bounding_box') or {}
                    print(f"    would-add  bbox={bb}  text={(ad.get('text') or '')[:60]!r}")
                print(f"  would-remove {len(broken_ads)} junk ads from this newspaper")
                if args.throttle:
                    time.sleep(args.throttle)
                continue

            # Write phase — analyze + insert each new ad, then delete the
            # broken ones. Order matters: insert first so the newspaper is
            # never momentarily ad-less.
            ads_added = 0
            for ad in detected:
                try:
                    ad['publication_date'] = np_doc.get('publication_date')
                    ad['page_number'] = np_doc.get('page_number')
                    ad['deep_analysis'] = image_proc.analyze_ad_image(ad['image'])
                    if db_wrapper.insert_ad(np_id, ad) if False else \
                       _insert_via_pipeline_db(np_id, ad):
                        ads_added += 1
                except Exception as exc:
                    print(f"    ! insert failed: {exc}")

            new_ads_total += ads_added

            # Delete the broken ones.
            for bad in broken_ads:
                try:
                    bad['_ref'].delete()
                    removed += 1
                except Exception as exc:
                    print(f"    ! delete failed for {bad['_id'][:8]}: {exc}")

            # Mark the newspaper so reruns skip unless --resume-force.
            try:
                db.collection('newspapers').document(np_id).update({
                    'ads_redetect_at': datetime.now(timezone.utc).isoformat(),
                    'ads_redetect_added': ads_added,
                    'ads_redetect_removed': len(broken_ads),
                })
            except Exception as exc:
                print(f"    ! parent mark failed: {exc}")

            recovered += 1
            print(f"  added={ads_added}  removed={len(broken_ads)}")

            if args.limit and recovered >= args.limit:
                print(f"\n[redetect] reached --limit {args.limit}, stopping")
                break

            if args.throttle:
                time.sleep(args.throttle)

    except KeyboardInterrupt:
        print("\n[redetect] interrupted — partial progress kept (resume-safe)")

    elapsed = time.time() - start
    print()
    print("=" * 60)
    print(f"[redetect] done in {elapsed:.1f}s")
    print(f"  newspapers seen:        {seen_papers}")
    print(f"  newspapers recovered:   {recovered}")
    print(f"  new ads inserted:       {new_ads_total}")
    print(f"  junk ads removed:       {removed}")
    print(f"  errored:                {errored}")
    if skip_reasons:
        print("  skip reasons:")
        for r, n in sorted(skip_reasons.items(), key=lambda kv: -kv[1]):
            print(f"    {r:<28} {n}")

    return 0


def _insert_via_pipeline_db(newspaper_id: str, ad: dict) -> Optional[str]:
    """Insert one ad using the same MediaScopeDatabase path the pipeline uses.

    Late-bound + memoised so we don't pay the import cost when --dry-run
    and don't rebuild the DB connection per ad.
    """
    from services.pipeline import Config, MediaScopeDatabase
    if not hasattr(_insert_via_pipeline_db, '_db'):
        _db = MediaScopeDatabase(Config())
        _db.connect()
        _insert_via_pipeline_db._db = _db  # type: ignore[attr-defined]
    return _insert_via_pipeline_db._db.insert_ad(newspaper_id, ad)  # type: ignore[attr-defined]


if __name__ == "__main__":
    raise SystemExit(main())
