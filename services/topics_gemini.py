"""
Gemini-based topic classifier for newspaper articles.

Why this exists
---------------
The original topic pipeline used BERTopic, which produced auto-generated
"labels" like ``'kgs_grams_oil_40 kgs'`` and ``'mqm_kashmir_ppp_sindh_minister'``.
Those labels were never readable on the surface — the frontend had to ship a
``TOPIC_NAME_MAP`` (in EnhancedAnalytics.tsx) translating them into things
like "Commodities" and "Sindh Politics". When a topic drifted or new articles
landed in a cluster the map went stale, which is the bug the user hit.

This module replaces that flow with:
  1. A *curated* taxonomy of ~38 stable, human-readable topic labels
     (data/topics_taxonomy.json) that match what readers expect to see.
  2. A Gemini classifier that reads the article and returns the canonical
     ``topic_id`` + ``topic_label`` in one call. No training step, no batch
     re-clustering — labels are stable across runs.

Vertex routing
--------------
The underlying model is reached through ``services.gemini_adapter.create_model``,
which auto-detects whether ``GEMINI_API_KEY`` is a Vertex AI Express key
(``AQ.*``) or a legacy Developer API key (``AIzaSy*``) and dispatches
accordingly. So setting ``GEMINI_API_KEY=AQ.…`` is all that's required to
run this on Vertex.

Public API
----------
    load_taxonomy() -> List[TopicEntry]
    classify_topic_gemini(text, *, model_name="gemini-2.5-flash") -> dict
        {'topic_id': int, 'topic_label': str, 'topic_key': str,
         'confidence': float, 'reasoning': str}

On any failure (key missing, parse error, network) the classifier returns
the "Other" topic with confidence=0.0 so callers can detect the miss without
breaking ingestion.
"""
from __future__ import annotations

import json
import os
import re
from functools import lru_cache
from pathlib import Path
from typing import Dict, List, Optional, TypedDict

from services.gemini_adapter import create_model as _create_gemini_model

# Truncate articles to ~6k chars (~1.5k tokens). Plenty of context for topic
# classification — the lede + first few paragraphs almost always carry the
# subject — and keeps the prompt cheap.
_MAX_CHARS = 6000

# The "Other" topic is the safe fallback when classification fails or returns
# a topic id we don't recognise. Matches data/topics_taxonomy.json id 99.
_OTHER_ID = 99
_OTHER_LABEL = "Other / Uncategorised"
_OTHER_KEY = "other"


class TopicEntry(TypedDict):
    id: int
    key: str
    label: str
    description: str
    keywords: List[str]


@lru_cache(maxsize=1)
def load_taxonomy() -> List[TopicEntry]:
    """Load the curated taxonomy from data/topics_taxonomy.json.

    Cached for the lifetime of the process — the file changes only between
    deploys.
    """
    path = Path(__file__).parent.parent / "data" / "topics_taxonomy.json"
    if not path.exists():
        return []
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    return [t for t in data.get("topics", []) if "id" in t and "label" in t]


def _build_topic_block(taxonomy: List[TopicEntry]) -> str:
    """Render the taxonomy as a numbered list for the prompt.

    Format keeps each topic on one line so Gemini can scan them quickly:
        ``  12: Oil & Energy Markets — OPEC quotas, oil prices, …``
    """
    lines = []
    for t in taxonomy:
        desc = t.get("description", "").strip()
        lines.append(f"  {t['id']}: {t['label']} — {desc}")
    return "\n".join(lines)


_PROMPT_TEMPLATE = """You are a topic classifier for articles from Dawn, a 1990s Pakistani English-language daily.

Read the article below and pick the single best-fitting topic from this fixed list. Choose by *primary subject*, not by passing mentions. If the article genuinely doesn't match anything, use 99 (Other) — don't force a fit.

Topics:
{TOPICS}

Article:
\"\"\"
{ARTICLE}
\"\"\"

Return ONLY a single JSON object, no markdown fences, with these exact keys:
{{
  "topic_id": <integer matching one of the IDs above>,
  "confidence": <float in [0.0, 1.0]>,
  "reasoning": "<one short sentence explaining your call>"
}}
"""


def _extract_json(raw: str) -> Optional[dict]:
    """Pull the first JSON object out of model output (handles ```json fences)."""
    if not raw:
        return None
    fenced = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", raw, re.DOTALL)
    if fenced:
        candidate = fenced.group(1)
    else:
        m = re.search(r"\{.*\}", raw, re.DOTALL)
        candidate = m.group(0) if m else None
    if not candidate:
        return None
    try:
        return json.loads(candidate)
    except json.JSONDecodeError:
        return None


def _coerce(parsed: dict, taxonomy: List[TopicEntry]) -> Dict:
    """Map the parsed Gemini response to the canonical topic shape."""
    by_id = {t["id"]: t for t in taxonomy}
    try:
        topic_id = int(parsed.get("topic_id", _OTHER_ID))
    except (TypeError, ValueError):
        topic_id = _OTHER_ID
    if topic_id not in by_id:
        topic_id = _OTHER_ID

    entry = by_id.get(topic_id, {
        "id": _OTHER_ID, "key": _OTHER_KEY, "label": _OTHER_LABEL,
    })

    try:
        confidence = float(parsed.get("confidence", 0.0))
    except (TypeError, ValueError):
        confidence = 0.0
    confidence = max(0.0, min(1.0, confidence))

    reasoning = str(parsed.get("reasoning", "")).strip()

    return {
        "topic_id": entry["id"],
        "topic_key": entry.get("key", _OTHER_KEY),
        "topic_label": entry["label"],
        "confidence": round(confidence, 3),
        "reasoning": reasoning,
    }


def classify_topic_gemini(
    text: str,
    *,
    model_name: str = "gemini-2.5-flash",
    api_key: Optional[str] = None,
) -> Dict:
    """Classify one article into the curated taxonomy via Gemini.

    Returns:
        {
            'topic_id':   int,    # canonical id from data/topics_taxonomy.json
            'topic_key':  str,    # slug ('crime-violence', etc.)
            'topic_label':str,    # display label ('Crime & Violence')
            'confidence': float,  # 0..1; 0 means we fell back to "Other"
            'reasoning':  str,    # one-sentence rationale (debug aid)
        }

    On any failure (missing key, parse error, network exception, empty
    taxonomy) returns the "Other" topic with confidence=0.0. The pipeline
    treats confidence==0.0 as "no signal" so it can fall back to the legacy
    classifier if one is wired up.
    """
    other_fallback = {
        "topic_id": _OTHER_ID,
        "topic_key": _OTHER_KEY,
        "topic_label": _OTHER_LABEL,
        "confidence": 0.0,
        "reasoning": "",
    }
    if not text or not text.strip():
        return other_fallback

    taxonomy = load_taxonomy()
    if not taxonomy:
        other_fallback["reasoning"] = "topics_taxonomy.json missing or empty"
        return other_fallback

    key = (api_key or os.getenv("GEMINI_API_KEY", "")).strip()
    if not key:
        other_fallback["reasoning"] = "GEMINI_API_KEY not set"
        return other_fallback

    article = text[:_MAX_CHARS]
    prompt = (
        _PROMPT_TEMPLATE
        .replace("{TOPICS}", _build_topic_block(taxonomy))
        .replace("{ARTICLE}", article)
    )

    try:
        model = _create_gemini_model(key, model_name)
        response = model.generate_content(prompt)
        raw = getattr(response, "text", "") or ""
    except Exception as exc:  # noqa: BLE001 — opaque SDK failures
        other_fallback["reasoning"] = f"gemini error: {exc}"
        return other_fallback

    parsed = _extract_json(raw)
    if not parsed:
        other_fallback["reasoning"] = f"unparseable: {raw[:120]!r}"
        return other_fallback

    return _coerce(parsed, taxonomy)


# ─── Batch classifier ─────────────────────────────────────────────────────

# Default batch size. 10 articles per Gemini call ≈ 10× fewer round-trips
# than the single-article path. Gemini happily handles a single prompt with
# 10 article snippets at ~600 chars each (≈ 6000 char prompt, well within
# context). Set lower if articles are unusually long; the per-article cap
# below is the primary safety net.
BATCH_TOPIC_SIZE = 10
_BATCH_PER_ARTICLE_CHARS = 800

_BATCH_PROMPT_TEMPLATE = """You are a topic classifier for articles from Dawn, a 1990s Pakistani English-language daily.

Classify EACH article below into the single best-fitting topic from this fixed list. Choose by *primary subject*, not passing mentions. If an article genuinely doesn't match anything, use 99 (Other) — don't force a fit.

Topics:
{TOPICS}

Articles:
{ARTICLES}

Return ONLY a JSON array, no markdown fences, with one object per article in the same order they appear above:
[
  {{"index": 0, "topic_id": <int>, "confidence": <float 0..1>, "reasoning": "<one short sentence>"}},
  ...
]

The "index" field MUST match the article number you saw above (0, 1, 2, …). Include exactly {N} entries — one per article.
"""


def _extract_json_array(raw: str) -> Optional[list]:
    """Pull the first JSON array out of model output (handles ```json fences)."""
    if not raw:
        return None
    fenced = re.search(r"```(?:json)?\s*(\[.*?\])\s*```", raw, re.DOTALL)
    if fenced:
        candidate = fenced.group(1)
    else:
        m = re.search(r"\[.*\]", raw, re.DOTALL)
        candidate = m.group(0) if m else None
    if not candidate:
        return None
    try:
        parsed = json.loads(candidate)
        return parsed if isinstance(parsed, list) else None
    except json.JSONDecodeError:
        return None


def classify_topics_batch_gemini(
    texts: List[str],
    *,
    model_name: str = "gemini-2.5-flash",
    api_key: Optional[str] = None,
    batch_size: int = BATCH_TOPIC_SIZE,
) -> List[Dict]:
    """Classify N articles into the curated taxonomy in BATCH_TOPIC_SIZE-sized
    Gemini calls.

    Returns a list of topic dicts (same shape as ``classify_topic_gemini``)
    in the SAME order as ``texts``. Articles that couldn't be classified get
    the "Other" fallback (so the caller can always zip the result with the
    input).

    Why this exists separately from ``classify_topic_gemini``: the per-
    article version was costing 1 Gemini call per article. On a page with
    13 articles that's 13 round-trips. Batching at 10 cuts that to 2 calls
    per page — the dominant per-page cost in the ingestion pipeline.

    Robustness:
      * If Gemini returns a malformed array, the WHOLE batch falls back to
        "Other" — but only that batch, not the whole input list. So a
        single bad batch doesn't poison the rest of the page.
      * Per-article fallback is also applied when the model omits an index
        from its response (some indices may be classified, others may not).
    """
    other_fallback = {
        "topic_id": _OTHER_ID,
        "topic_key": _OTHER_KEY,
        "topic_label": _OTHER_LABEL,
        "confidence": 0.0,
        "reasoning": "",
    }

    if not texts:
        return []

    taxonomy = load_taxonomy()
    if not taxonomy:
        return [{**other_fallback, "reasoning": "topics_taxonomy.json missing"} for _ in texts]

    key = (api_key or os.getenv("GEMINI_API_KEY", "")).strip()
    if not key:
        return [{**other_fallback, "reasoning": "GEMINI_API_KEY not set"} for _ in texts]

    topic_block = _build_topic_block(taxonomy)
    results: List[Optional[Dict]] = [None] * len(texts)

    for batch_start in range(0, len(texts), batch_size):
        batch = texts[batch_start: batch_start + batch_size]
        # Build the per-batch articles block. Truncate each article to
        # _BATCH_PER_ARTICLE_CHARS to keep the total prompt cheap — topic
        # classification doesn't need the full body, the lede + first few
        # paragraphs carry the subject.
        articles_block_lines = []
        for j, text in enumerate(batch):
            snippet = (text or "")[:_BATCH_PER_ARTICLE_CHARS].strip()
            if not snippet:
                snippet = "(empty)"
            articles_block_lines.append(f"--- Article {j} ---\n{snippet}\n")
        articles_block = "\n".join(articles_block_lines)

        prompt = (
            _BATCH_PROMPT_TEMPLATE
            .replace("{TOPICS}", topic_block)
            .replace("{ARTICLES}", articles_block)
            .replace("{N}", str(len(batch)))
        )

        try:
            model = _create_gemini_model(key, model_name)
            response = model.generate_content(prompt)
            raw = getattr(response, "text", "") or ""
        except Exception as exc:  # noqa: BLE001
            # Whole-batch fallback. Tagged so the caller can see why.
            for j in range(len(batch)):
                results[batch_start + j] = {
                    **other_fallback,
                    "reasoning": f"gemini batch error: {exc}",
                }
            continue

        parsed = _extract_json_array(raw)
        if not parsed:
            for j in range(len(batch)):
                results[batch_start + j] = {
                    **other_fallback,
                    "reasoning": f"unparseable batch response: {raw[:120]!r}",
                }
            continue

        # Index per-article responses by the model's "index" field. Then
        # for each article in the batch look up its result; missing
        # entries get the per-article fallback.
        by_index: Dict[int, dict] = {}
        for entry in parsed:
            if not isinstance(entry, dict):
                continue
            try:
                idx = int(entry.get("index", -1))
            except (TypeError, ValueError):
                continue
            if 0 <= idx < len(batch):
                by_index[idx] = entry

        for j in range(len(batch)):
            entry = by_index.get(j)
            if entry is None:
                results[batch_start + j] = {
                    **other_fallback,
                    "reasoning": "model omitted this index",
                }
            else:
                results[batch_start + j] = _coerce(entry, taxonomy)

    # Replace any leftover Nones (shouldn't happen but defensive) with
    # the safe fallback so the return shape always matches len(texts).
    return [r if r is not None else dict(other_fallback) for r in results]
