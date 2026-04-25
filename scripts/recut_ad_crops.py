"""
Re-cut bad cached advertisement crops from their parent newspaper images.

Why
---
Many stored ads have a cached `image_url` pointing to a Firebase Storage
JPEG that's mostly whitespace with a sliver of text. The frontend already
works around this by clipping the parent newspaper image live (commit
4916034), but that leaves the actual crops in storage broken — wasting
space and breaking any future consumer that uses `image_url` directly.

This script fixes the underlying data:

  1. Stream every advertisement.
  2. Skip ads we can't re-cut (no usable percentage coords, no parent
     newspaper, no parent image_url, or already re-cut).
  3. Download the parent newspaper image (cached per newspaper_id so we
     don't re-fetch for ads on the same page).
  4. Crop with PIL using the stored {left, top, width, height} percentages
     plus a small padding margin.
  5. Re-upload to the SAME storage path (`ads/{newspaper_id}/{ad_id}.jpg`)
     so the existing `image_url` keeps working — no Firestore URL update
     needed unless the URL itself changed.
  6. Mark `crop_recut_at` on the ad doc so re-runs are resume-safe.

Usage
-----
    python -m scripts.recut_ad_crops --dry-run --limit 5
    python -m scripts.recut_ad_crops --limit 100
    python -m scripts.recut_ad_crops                  # full corpus
    python -m scripts.recut_ad_crops --resume-force   # re-cut even already-recut ads
"""
from __future__ import annotations

import argparse
import io
import os
import sys
import tempfile
import time
from datetime import datetime, timezone
from typing import Iterator, Optional

# Importable from repo root.
_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(_HERE)
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)


# How much padding (% of parent image) to add around each crop. Helps when
# the bbox is too tight on the ad text and clips off borders / surrounding
# whitespace that gives the ad context.
_PAD_PCT = 1.5


def _iter_ads(db, page_size: int = 200) -> Iterator[dict]:
    """Cursor-paginate the advertisements collection without loading it all."""
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


def _pct_box(coords: dict) -> Optional[tuple]:
    """Return (left%, top%, width%, height%) or None when unusable.

    Old schema saved {x1, y1, x2, y2} in absolute pixels — that requires
    knowing the parent image size, which we get from PIL after download
    so we handle it via a separate code path during the actual crop.
    """
    if not isinstance(coords, dict):
        return None
    if all(k in coords for k in ('left', 'top', 'width', 'height')):
        try:
            l, t, w, h = (float(coords['left']), float(coords['top']),
                          float(coords['width']), float(coords['height']))
        except (TypeError, ValueError):
            return None
        if w <= 0 or h <= 0 or w > 100 or h > 100:
            return None
        return (l, t, w, h)
    return None


def _abs_corners(coords: dict) -> Optional[tuple]:
    """Return (x1, y1, x2, y2) absolute pixels or None. For legacy schema."""
    if not isinstance(coords, dict):
        return None
    if all(k in coords for k in ('x1', 'y1', 'x2', 'y2')):
        try:
            return (int(coords['x1']), int(coords['y1']),
                    int(coords['x2']), int(coords['y2']))
        except (TypeError, ValueError):
            return None
    return None


class _NewspaperImageCache:
    """LRU-ish cache of (PIL.Image, public_url) keyed by newspaper_id.

    Many ads share the same parent newspaper page, so caching the decoded
    image saves both bandwidth and JPEG-decode time. Bounded so we don't
    accumulate full-page JPEGs forever.
    """

    def __init__(self, db, max_entries: int = 24):
        self.db = db
        self.max_entries = max_entries
        self._items: dict = {}
        self._order: list = []

    def get(self, newspaper_id: str):
        if newspaper_id in self._items:
            return self._items[newspaper_id]
        try:
            snap = self.db.collection('newspapers').document(newspaper_id).get()
        except Exception as exc:  # noqa: BLE001
            return ('error', f'firestore: {exc}')
        if not snap.exists:
            return ('error', 'newspaper doc missing')
        url = (snap.to_dict() or {}).get('image_url') or ''
        if not url:
            return ('error', 'no image_url on newspaper')
        try:
            import requests
            from PIL import Image, ImageOps
            r = requests.get(url, timeout=30)
            r.raise_for_status()
            img = Image.open(io.BytesIO(r.content))
            img.load()  # force decode
            # CRITICAL: the bbox percentages stored on each ad were generated
            # against the ROTATED-to-portrait image (services/pipeline.py:1185
            # calls enhance_image BEFORE detect_ads). But the parent newspaper's
            # image_url points to the un-rotated landscape original (the raw
            # file uploaded at pipeline.py:118). Without mirroring that rotation
            # here, portrait-space percentages get applied to a landscape canvas
            # and produce crops of the wrong region — typically a horizontal
            # strip showing the binding/spine. Mirror enhance_image's orientation
            # pass exactly so coords align.
            try:
                img = ImageOps.exif_transpose(img)
            except Exception:
                pass
            if img.width > img.height:
                img = img.rotate(90, expand=True)
        except Exception as exc:  # noqa: BLE001
            return ('error', f'download/decode: {exc}')

        entry = ('ok', img)
        self._items[newspaper_id] = entry
        self._order.append(newspaper_id)
        if len(self._order) > self.max_entries:
            evict = self._order.pop(0)
            self._items.pop(evict, None)
        return entry


def _crop_pct(img, l: float, t: float, w: float, h: float, pad_pct: float = _PAD_PCT):
    """PIL crop using percentage coordinates, with `pad_pct` margin clamped."""
    W, H = img.size
    pad_w = (pad_pct / 100.0) * W
    pad_h = (pad_pct / 100.0) * H
    x1 = max(0, int((l / 100.0) * W - pad_w))
    y1 = max(0, int((t / 100.0) * H - pad_h))
    x2 = min(W, int(((l + w) / 100.0) * W + pad_w))
    y2 = min(H, int(((t + h) / 100.0) * H + pad_h))
    if x2 - x1 < 8 or y2 - y1 < 8:
        return None
    return img.crop((x1, y1, x2, y2))


def _upload_crop(db_wrapper, crop, newspaper_id: str, ad_id: str) -> Optional[str]:
    """Save crop to a temp JPEG and upload to ads/{newspaper_id}/{ad_id}.jpg."""
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix='.jpg', delete=False) as tmp:
            # quality=88 ≈ visually lossless on newspaper scans, ~⅓ the bytes
            crop.convert('RGB').save(tmp.name, 'JPEG', quality=88)
            tmp_path = tmp.name
        return db_wrapper.upload_ad_image(tmp_path, newspaper_id, ad_id)
    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.unlink(tmp_path)
            except OSError:
                pass


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--limit", type=int, default=0,
                   help="max ads to re-cut (0 = no limit)")
    p.add_argument("--dry-run", action="store_true",
                   help="print what would change, don't download/upload/write")
    p.add_argument("--throttle", type=float, default=0.0,
                   help="seconds to sleep between recuts (default 0)")
    p.add_argument("--resume-force", action="store_true",
                   help="re-cut even ads already marked crop_recut_at")
    p.add_argument("--page-size", type=int, default=200,
                   help="Firestore page size while streaming")
    p.add_argument("--report-every", type=int, default=25,
                   help="print a running tally every N re-cut ads")
    args = p.parse_args()

    print(f"[recut-ads] starting (dry_run={args.dry_run}, "
          f"limit={args.limit or '∞'}, resume_force={args.resume_force})")

    from database.firestore_db import get_firestore_db
    db_wrapper = get_firestore_db()
    db = db_wrapper.db

    cache = _NewspaperImageCache(db)
    seen = recut = skipped = errored = 0
    skip_reasons: dict[str, int] = {}
    start = time.time()

    def _bump_skip(reason: str):
        skip_reasons[reason] = skip_reasons.get(reason, 0) + 1

    try:
        for ad in _iter_ads(db, page_size=args.page_size):
            seen += 1
            ad_id = ad['_id']

            if not args.resume_force and ad.get('crop_recut_at'):
                skipped += 1
                _bump_skip('already recut')
                continue

            newspaper_id = (ad.get('newspaper_id') or '').strip()
            if not newspaper_id or newspaper_id.startswith('local_'):
                skipped += 1
                _bump_skip('no/local newspaper_id')
                continue

            coords = ad.get('coordinates') or {}
            pct = _pct_box(coords)
            corners = _abs_corners(coords) if pct is None else None
            if pct is None and corners is None:
                skipped += 1
                _bump_skip('no usable coords')
                continue

            status, payload = cache.get(newspaper_id)
            if status != 'ok':
                errored += 1
                print(f"  ! {ad_id[:8]}: parent fetch failed — {payload}")
                continue
            img = payload

            # Compute the actual PIL crop.
            if pct is not None:
                crop = _crop_pct(img, *pct)
                shape_str = f"L={pct[0]:.1f}% T={pct[1]:.1f}% W={pct[2]:.1f}% H={pct[3]:.1f}%"
            else:
                x1, y1, x2, y2 = corners
                W, H = img.size
                x1, y1 = max(0, x1), max(0, y1)
                x2, y2 = min(W, x2), min(H, y2)
                if x2 - x1 < 8 or y2 - y1 < 8:
                    skipped += 1
                    _bump_skip('crop too small')
                    continue
                crop = img.crop((x1, y1, x2, y2))
                shape_str = f"abs ({x1},{y1})-({x2},{y2})"

            if crop is None:
                skipped += 1
                _bump_skip('crop too small')
                continue

            cw, ch = crop.size
            tag = "[DRY]" if args.dry_run else "[OK ]"
            print(f"  {tag} {ad_id[:8]}: parent {newspaper_id[:8]}  {shape_str}  → {cw}×{ch}px")

            if not args.dry_run:
                new_url = _upload_crop(db_wrapper, crop, newspaper_id, ad_id)
                if not new_url:
                    errored += 1
                    print(f"  ! {ad_id[:8]}: upload failed")
                    continue
                patch = {
                    'image_url': new_url,
                    'crop_recut_at': datetime.now(timezone.utc).isoformat(),
                    'crop_recut_method': 'pct-box-pad' if pct else 'abs-corners',
                }
                try:
                    ad['_ref'].update(patch)
                except Exception as exc:  # noqa: BLE001
                    errored += 1
                    print(f"  ! {ad_id[:8]}: firestore update failed: {exc}")
                    continue

            recut += 1
            if args.report_every and recut % args.report_every == 0:
                elapsed = time.time() - start
                rate = recut / elapsed if elapsed > 0 else 0
                print(f"  -- progress: recut={recut} skipped={skipped} "
                      f"errored={errored} ({rate:.1f}/s) --")

            if args.limit and recut >= args.limit:
                print(f"[recut-ads] reached --limit {args.limit}, stopping")
                break

            if args.throttle:
                time.sleep(args.throttle)

    except KeyboardInterrupt:
        print("\n[recut-ads] interrupted — partial progress kept "
              "(safe to re-run; already-recut ads are skipped)")

    elapsed = time.time() - start
    print()
    print("=" * 60)
    print(f"[recut-ads] done in {elapsed:.1f}s")
    print(f"  seen:    {seen}")
    print(f"  recut:   {recut}")
    print(f"  skipped: {skipped}")
    print(f"  errored: {errored}")
    if skip_reasons:
        print("  skip reasons:")
        for reason, n in sorted(skip_reasons.items(), key=lambda kv: -kv[1]):
            print(f"    {reason:<28} {n}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
