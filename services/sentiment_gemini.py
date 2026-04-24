"""
Gemini-based sentiment scorer for newspaper articles.

Why this exists
---------------
Production sentiment uses `cardiffnlp/twitter-roberta-base-sentiment-latest`, a
RoBERTa fine-tuned on tweets. It misfires on 1990s Pakistani English newspaper
prose for three compounding reasons:

  1. **Domain mismatch.** Twitter is informal/emotional; Dawn op-eds are
     formal and restrained. The Twitter model treats restrained outrage as
     "neutral" because it lacks the emojis/slang it was trained to read.
  2. **Truncation.** `pipeline.analyze_sentiment` slices to the first 1000
     chars. News leads are deliberately impartial; the editorial stance lives
     in paragraphs 4–N which never reach the model.
  3. **Score collapse.** The score is `Σ label_prob · {-1,0,+1}`. Because the
     "neutral" class almost always retains nontrivial probability, even a
     confidently positive article gets pulled toward 0.

This module asks Gemini to read the *whole* article (up to ~12k chars) and
return a structured `{label, score, confidence, reasoning}`. We prompt
explicitly for newspaper-appropriate sentiment (about the *subject matter's
valence*, not the writing style).

Public API
----------
    analyze_sentiment_gemini(text, *, model_name="gemini-2.5-flash") -> dict
        {'score': -1..1, 'label': 'positive|neutral|negative',
         'confidence': 0..1, 'reasoning': str}

This is **not** wired into the live pipeline — swap-in is a deliberate,
audited decision. Use `scripts/audit_sentiment.py` to compare side-by-side.
"""
from __future__ import annotations

import json
import os
import re
from typing import Dict, Optional

from services.gemini_adapter import create_model as _create_gemini_model

# Truncate to ~12k chars (~3k tokens). Plenty for a long op-ed; keeps cost down.
_MAX_CHARS = 12000

_PROMPT = """You are a sentiment analyst rating a news article from a 1990s Pakistani English-language daily (Dawn).

Read the FULL article below and judge the article's overall sentiment about its primary subject(s). Focus on the *substance* (events, outcomes, claims), not the formal/restrained writing register typical of broadsheet journalism. A measured editorial condemning a policy is **negative**, not "neutral", even if it avoids loaded language.

Definitions:
- positive: the article describes favourable events/outcomes, praises a subject, or argues for an optimistic position.
- negative: the article describes unfavourable events (violence, loss, scandal, condemnation, decline) or argues against a subject.
- neutral: factual reporting with no clear valence (routine wire copy, balanced explainers, schedules, listings).

Return ONLY a single JSON object with these keys, nothing else:
{
  "label": "positive" | "negative" | "neutral",
  "score": <float in [-1.0, 1.0]; -1=very negative, +1=very positive>,
  "confidence": <float in [0.0, 1.0]>,
  "reasoning": "<one short sentence explaining your call>"
}

Article:
\"\"\"
{ARTICLE}
\"\"\"
"""


def _extract_json(raw: str) -> Optional[dict]:
    """Pull the first JSON object out of model output (handles ```json fences)."""
    if not raw:
        return None
    # Strip code fences if present.
    fenced = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", raw, re.DOTALL)
    if fenced:
        candidate = fenced.group(1)
    else:
        # Fall back to first {...} blob.
        m = re.search(r"\{.*\}", raw, re.DOTALL)
        candidate = m.group(0) if m else None
    if not candidate:
        return None
    try:
        return json.loads(candidate)
    except json.JSONDecodeError:
        return None


def _coerce(parsed: dict) -> Dict:
    """Normalize the parsed dict into the canonical sentiment shape."""
    label = str(parsed.get("label", "neutral")).strip().lower()
    if label not in ("positive", "negative", "neutral"):
        label = "neutral"
    try:
        score = float(parsed.get("score", 0.0))
    except (TypeError, ValueError):
        score = 0.0
    score = max(-1.0, min(1.0, score))
    try:
        confidence = float(parsed.get("confidence", 0.0))
    except (TypeError, ValueError):
        confidence = 0.0
    confidence = max(0.0, min(1.0, confidence))
    reasoning = str(parsed.get("reasoning", "")).strip()
    return {
        "score": round(score, 3),
        "label": label,
        "confidence": round(confidence, 3),
        "reasoning": reasoning,
    }


def analyze_sentiment_gemini(
    text: str,
    *,
    model_name: str = "gemini-2.5-flash",
    api_key: Optional[str] = None,
) -> Dict:
    """
    Score one article's sentiment via Gemini.

    Returns the same shape as the legacy scorer plus a `reasoning` field:
        {'score': float, 'label': str, 'confidence': float, 'reasoning': str}

    On any failure (key missing, parse error, network) returns a neutral
    fallback with confidence=0 so callers can detect the miss.
    """
    fallback = {"score": 0.0, "label": "neutral", "confidence": 0.0, "reasoning": ""}
    if not text or not text.strip():
        return fallback

    key = (api_key or os.getenv("GEMINI_API_KEY", "")).strip()
    if not key:
        fallback["reasoning"] = "GEMINI_API_KEY not set"
        return fallback

    article = text[:_MAX_CHARS]
    prompt = _PROMPT.replace("{ARTICLE}", article)

    try:
        model = _create_gemini_model(key, model_name)
        response = model.generate_content(prompt)
        raw = getattr(response, "text", "") or ""
    except Exception as exc:  # noqa: BLE001 — opaque failures from SDK
        fallback["reasoning"] = f"gemini error: {exc}"
        return fallback

    parsed = _extract_json(raw)
    if not parsed:
        fallback["reasoning"] = f"unparseable: {raw[:120]!r}"
        return fallback
    return _coerce(parsed)
