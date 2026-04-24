"""
Gemini-Vision metadata extractor — recover (publication_date, page_number)
from the masthead/header of a scanned newspaper image when the filename
gives us nothing useful.

Why this exists
---------------
Phase 1 (scripts/backfill_metadata.py) recovered metadata for the ~10% of
the corpus whose filename matched ``Mon_DD_YY_pN.jpg`` and nulled the
remaining (1990-01-01, page=1) sentinels. That leaves ~3,800 ``IMG_NNNN.JPG``
phone-camera scans whose filename carries no signal at all, but whose
*image* still has the Dawn masthead with the date and page number printed
on it. This module asks Gemini Vision to read that header.

How it works
------------
1. Open the image (path or bytes), crop the top ~22% of the frame — that's
   where Dawn's masthead/page-header strip lives — and downscale wide images
   so we don't ship 10MB JPEGs to the API.
2. Send the crop + a tight prompt to ``gemini-2.5-flash`` via
   ``services.gemini_adapter`` (so the same Vertex Express key works).
3. Parse a small JSON response: ``{date_iso, page_number, confidence}``.
4. Sanity-check: dates must fall in 1980-2010 (Dawn corpus window) and
   page must be 1-50; out-of-range answers degrade to ``confidence=0``.

On any failure (key missing, parse error, model refusal, sanity-check
failure) the function returns ``confidence=0.0`` with a reasoning string
the caller can log. The caller decides whether to write — typically only
when ``confidence >= 0.5``.

Public API
----------
    extract_metadata_from_image(image_source, *, model_name="gemini-2.5-flash")
        -> {'date': datetime|None, 'page': int|None,
            'confidence': float, 'reasoning': str}

``image_source`` can be a filesystem path, an HTTP(S) URL (Firebase Storage),
or raw bytes.
"""
from __future__ import annotations

import io
import json
import os
import re
from datetime import datetime, timezone
from typing import Optional, Union

from services.gemini_adapter import create_model as _create_gemini_model

# Crop the top ~22% of the page — empirically that captures the Dawn
# masthead (date strip + page number) on portrait scans without sucking in
# the headline text below it (which would tempt the model to invent dates
# from the article body).
_TOP_CROP_FRACTION = 0.22

# Scale wide images down before sending — Gemini handles up to ~3072px on
# the long edge cleanly. We're well under that for most phone scans.
_MAX_LONG_EDGE = 1600

# Sanity bounds. Dawn corpus is 1980s-90s; we leave generous slack.
_MIN_YEAR = 1980
_MAX_YEAR = 2010
_MIN_PAGE = 1
_MAX_PAGE = 50


_PROMPT = """You are looking at the TOP STRIP of a scanned page from "Dawn",
a Pakistani English-language daily newspaper. Newspapers from this corpus
typically print the date and page number along the top edge of every page
(date inside the masthead area, page number near a top corner).

Read the printed text in the image and extract:
  1. The publication date (year/month/day).
  2. The page number printed on this page.

Rules:
- Use ONLY what is visibly printed. Do not guess or interpolate.
- If the date is partially visible (e.g. only month + year), still report
  what you can see — set confidence accordingly.
- If you genuinely cannot read either field, return confidence 0.

Return ONLY a single JSON object, no markdown fences, with these exact keys:
{
  "date_iso":     "YYYY-MM-DD" or null,
  "page_number":  <integer 1-50> or null,
  "confidence":   <float 0.0-1.0>,
  "reasoning":    "<one short sentence: what you saw>"
}
"""


# ─── image loading ──────────────────────────────────────────────────────────

def _load_image(source: Union[str, bytes, "PIL.Image.Image"]):  # type: ignore[name-defined]
    """Accept path / URL / bytes / PIL.Image and return an open PIL.Image."""
    from PIL import Image
    if hasattr(source, 'crop'):  # already a PIL.Image
        return source
    if isinstance(source, bytes):
        return Image.open(io.BytesIO(source))
    if not isinstance(source, str):
        raise TypeError(f"unsupported image source type: {type(source)}")
    if source.startswith(('http://', 'https://')):
        import requests
        r = requests.get(source, timeout=30)
        r.raise_for_status()
        return Image.open(io.BytesIO(r.content))
    return Image.open(source)


def _crop_top(img):
    """Return the top `_TOP_CROP_FRACTION` of the image, downscaled if huge."""
    w, h = img.size
    crop = img.crop((0, 0, w, max(1, int(h * _TOP_CROP_FRACTION))))
    cw, ch = crop.size
    long_edge = max(cw, ch)
    if long_edge > _MAX_LONG_EDGE:
        scale = _MAX_LONG_EDGE / long_edge
        crop = crop.resize((max(1, int(cw * scale)), max(1, int(ch * scale))))
    if crop.mode not in ('RGB', 'L'):
        crop = crop.convert('RGB')
    return crop


# ─── response parsing ───────────────────────────────────────────────────────

def _extract_json(raw: str) -> Optional[dict]:
    if not raw:
        return None
    fenced = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", raw, re.DOTALL)
    candidate = fenced.group(1) if fenced else None
    if not candidate:
        m = re.search(r"\{.*\}", raw, re.DOTALL)
        candidate = m.group(0) if m else None
    if not candidate:
        return None
    try:
        return json.loads(candidate)
    except json.JSONDecodeError:
        return None


def _coerce_date(raw_date) -> Optional[datetime]:
    if not raw_date or not isinstance(raw_date, str):
        return None
    m = re.match(r'^(\d{4})-(\d{1,2})-(\d{1,2})', raw_date.strip())
    if not m:
        return None
    try:
        y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
        if not (_MIN_YEAR <= y <= _MAX_YEAR):
            return None
        return datetime(y, mo, d, tzinfo=timezone.utc)
    except ValueError:
        return None


def _coerce_page(raw_page) -> Optional[int]:
    if raw_page is None:
        return None
    try:
        n = int(raw_page)
    except (TypeError, ValueError):
        return None
    return n if _MIN_PAGE <= n <= _MAX_PAGE else None


# ─── public API ─────────────────────────────────────────────────────────────

_SENTINEL = {
    'date': None,
    'page': None,
    'confidence': 0.0,
    'reasoning': '',
}


def extract_metadata_from_image(
    source: Union[str, bytes],
    *,
    model_name: str = "gemini-2.5-flash",
    api_key: Optional[str] = None,
) -> dict:
    """Pull (date, page) off a newspaper masthead via Gemini Vision.

    Returns a dict with keys ``date`` (datetime|None), ``page`` (int|None),
    ``confidence`` (float in [0, 1]), and ``reasoning`` (str). On any
    failure, returns confidence=0 — the caller decides whether to write.
    """
    out = dict(_SENTINEL)

    key = (api_key or os.getenv("GEMINI_API_KEY", "")).strip()
    if not key:
        out['reasoning'] = "GEMINI_API_KEY not set"
        return out

    try:
        img = _load_image(source)
    except Exception as exc:  # noqa: BLE001
        out['reasoning'] = f"image load failed: {exc}"
        return out

    try:
        crop = _crop_top(img)
    except Exception as exc:  # noqa: BLE001
        out['reasoning'] = f"crop failed: {exc}"
        return out

    try:
        model = _create_gemini_model(key, model_name)
        # gemini_adapter accepts mixed [str, PIL.Image] parts — it converts
        # PIL.Image to inline bytes internally.
        response = model.generate_content([_PROMPT, crop])
        raw = getattr(response, 'text', '') or ''
    except Exception as exc:  # noqa: BLE001
        out['reasoning'] = f"gemini error: {exc}"
        return out

    parsed = _extract_json(raw)
    if not parsed:
        out['reasoning'] = f"unparseable: {raw[:120]!r}"
        return out

    date = _coerce_date(parsed.get('date_iso'))
    page = _coerce_page(parsed.get('page_number'))

    try:
        confidence = float(parsed.get('confidence', 0.0))
    except (TypeError, ValueError):
        confidence = 0.0
    confidence = max(0.0, min(1.0, confidence))

    # If neither field survived sanity-check, force confidence to 0 so the
    # caller doesn't write garbage even if the model claimed it was sure.
    if date is None and page is None:
        confidence = 0.0

    out['date'] = date
    out['page'] = page
    out['confidence'] = round(confidence, 3)
    out['reasoning'] = str(parsed.get('reasoning', '')).strip()
    return out
