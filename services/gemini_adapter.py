"""
Gemini client adapter — auto-detects whether an API key is for the
Gemini Developer API (AI Studio, "AIzaSy..." keys) or Vertex AI Express
Mode ("AQ...." keys), and returns a uniform object exposing a legacy
`.generate_content(parts, safety_settings=...)` method.

This lets the existing pipeline (which was written against the old
`google.generativeai` SDK) work with Vertex Express keys transparently.
"""
from __future__ import annotations

from typing import Any, Iterable, List


def _detect_transport(api_key: str) -> str:
    """Return 'vertex' for Vertex Express keys, 'gemini' for Developer API keys."""
    if not api_key:
        return 'gemini'
    return 'vertex' if api_key.startswith('AQ.') else 'gemini'


# ─── Vertex (new google-genai SDK) ────────────────────────────────────────────

class _VertexModel:
    """Mimics the legacy `GenerativeModel` interface using google-genai + Vertex Express."""

    def __init__(self, api_key: str, model_name: str, safety_settings=None):
        from google import genai
        from google.genai import types as _types
        self._genai = genai
        self._types = _types
        self._client = genai.Client(vertexai=True, api_key=api_key)
        self._model_name = model_name
        self._safety_settings = self._convert_safety(safety_settings)

    def _convert_safety(self, safety_settings):
        """Translate legacy {HarmCategory: HarmBlockThreshold} dict to new-SDK list."""
        if not safety_settings:
            return None
        try:
            out = []
            for cat, thr in safety_settings.items():
                # Both old and new enums use the same string names. Stringify to bridge.
                cat_name = getattr(cat, 'name', str(cat))
                thr_name = getattr(thr, 'name', str(thr))
                # Old names: HARM_CATEGORY_* / BLOCK_NONE etc. Same names in new SDK.
                out.append(self._types.SafetySetting(
                    category=cat_name,
                    threshold=thr_name,
                ))
            return out
        except Exception:
            # If translation fails, drop safety settings rather than crash.
            return None

    def _normalize_parts(self, prompt_parts) -> List[Any]:
        """Accept str, PIL.Image, or a list mixing them — return as list of parts."""
        if isinstance(prompt_parts, (str, bytes)):
            return [prompt_parts]
        if not isinstance(prompt_parts, (list, tuple)):
            return [prompt_parts]
        return list(prompt_parts)

    def _convert_to_genai_parts(self, raw_parts):
        """Convert PIL.Image objects to genai.Image parts; pass strings through."""
        import io
        from PIL import Image
        out = []
        for p in raw_parts:
            if isinstance(p, str):
                out.append(p)
            elif isinstance(p, Image.Image):
                buf = io.BytesIO()
                fmt = 'JPEG' if p.mode == 'RGB' else 'PNG'
                save_img = p if p.mode in ('RGB', 'RGBA') else p.convert('RGB')
                save_img.save(buf, format='JPEG')
                out.append(self._types.Part.from_bytes(data=buf.getvalue(), mime_type='image/jpeg'))
            else:
                # Already a Part / dict — pass through.
                out.append(p)
        return out

    def generate_content(self, prompt_parts, safety_settings=None, **kwargs):
        parts = self._normalize_parts(prompt_parts)
        parts = self._convert_to_genai_parts(parts)
        # User-role content, as the user explicitly requested.
        contents = [self._types.Content(role='user', parts=[
            self._types.Part(text=p) if isinstance(p, str) else p for p in parts
        ])]
        cfg_kwargs = {}
        if self._safety_settings:
            cfg_kwargs['safety_settings'] = self._safety_settings
        config = self._types.GenerateContentConfig(**cfg_kwargs) if cfg_kwargs else None
        response = self._client.models.generate_content(
            model=self._model_name,
            contents=contents,
            config=config,
        )
        return _ResponseShim(response)


class _ResponseShim:
    """Wrap the new-SDK response so .text and .parts behave like the old SDK."""

    def __init__(self, raw):
        self._raw = raw

    @property
    def text(self):
        try:
            return self._raw.text or ''
        except Exception:
            return ''

    @property
    def parts(self):
        """Legacy code checks `response.parts` to guard against empty responses."""
        try:
            candidates = getattr(self._raw, 'candidates', None) or []
            if not candidates:
                return []
            content = getattr(candidates[0], 'content', None)
            return getattr(content, 'parts', []) if content else []
        except Exception:
            return []


# ─── Legacy Gemini Developer API ──────────────────────────────────────────────

class _LegacyGeminiModel:
    """Thin wrapper around google.generativeai to keep a uniform interface."""

    def __init__(self, api_key: str, model_name: str, safety_settings=None):
        import google.generativeai as genai
        genai.configure(api_key=api_key)
        self._model = genai.GenerativeModel(model_name, safety_settings=safety_settings)
        self._safety_settings = safety_settings

    def generate_content(self, prompt_parts, safety_settings=None, **kwargs):
        return self._model.generate_content(
            prompt_parts,
            safety_settings=safety_settings or self._safety_settings,
        )


# ─── Public factory ───────────────────────────────────────────────────────────

def create_model(api_key: str, model_name: str, safety_settings=None):
    """Return a `.generate_content()`-compatible model for either key type."""
    transport = _detect_transport(api_key)
    # Vertex does not support the "preview" bare names the legacy SDK used.
    # Map common legacy/unsupported names to Vertex-valid ones.
    model_name = _normalize_model_name(model_name, transport)
    if transport == 'vertex':
        return _VertexModel(api_key, model_name, safety_settings)
    return _LegacyGeminiModel(api_key, model_name, safety_settings)


def _normalize_model_name(name: str, transport: str) -> str:
    name = (name or '').strip()
    # Default fallback
    if not name:
        return 'gemini-2.5-flash'
    lower = name.lower()
    # Legacy/invalid names the pipeline still references
    if lower in {'gemini-3.1-pro-preview', 'gemini-3-pro-preview', 'gemini-pro-vision'}:
        return 'gemini-2.5-pro'
    # On Vertex Express, gemini-2.0-flash is not always enabled — prefer 2.5-flash.
    if transport == 'vertex' and lower in {'gemini-2.0-flash', 'gemini-2.0-flash-001', 'gemini-1.5-flash'}:
        return 'gemini-2.5-flash'
    if transport == 'vertex' and lower in {'gemini-1.5-pro'}:
        return 'gemini-2.5-pro'
    return name


def describe_key(api_key: str) -> str:
    """Human-readable identifier for logs."""
    if not api_key:
        return 'unset'
    tail = api_key[-6:]
    return f"{_detect_transport(api_key)}:…{tail}"
