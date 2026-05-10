"""
Gemini client adapter — auto-detects whether an API key is for the
Gemini Developer API (AI Studio, "AIzaSy..." keys) or Vertex AI Express
Mode ("AQ...." keys), and returns a uniform object exposing a legacy
`.generate_content(parts, safety_settings=...)` method.

This lets the existing pipeline (which was written against the old
`google.generativeai` SDK) work with Vertex Express keys transparently.
"""
from __future__ import annotations

import os
from typing import Any, Iterable, List


# Per-request socket timeout, in seconds. Without this, a Gemini call
# whose underlying TCP connection silently dies (NAT timeout, dropped
# RST/FIN, server-side abort) blocks on recv() forever — observed in
# production as an 8-hour silent stall on the v4 ingestion run.
# Override via GEMINI_REQUEST_TIMEOUT env var if a workload genuinely
# needs longer (e.g. a 20-page batch OCR call). 180s is a safe default:
# the slowest legitimate single call we've seen is ~227s under quota
# pressure, but the batch path keeps real wall time well under that.
_DEFAULT_TIMEOUT = float(os.getenv('GEMINI_REQUEST_TIMEOUT', '180'))


def _detect_transport(api_key: str) -> str:
    """Return 'vertex' for Vertex Express keys, 'gemini' for Developer API keys."""
    if not api_key:
        return 'gemini'
    return 'vertex' if api_key.startswith('AQ.') else 'gemini'


# ─── Vertex (new google-genai SDK) ────────────────────────────────────────────

# Vertex AI quotas are per-region per-project — cycling regions
# multiplies effective throughput because each region has its own
# Dynamic Shared Quota slice. Default ['us-central1'] keeps legacy
# single-region behaviour; set GEMINI_VERTEX_REGIONS=us-central1,us-east1,...
# to rotate. Five common Vertex regions all support Gemini Pro/Flash.
_DEFAULT_REGIONS = ('us-central1',)
_ENV_REGIONS = os.getenv('GEMINI_VERTEX_REGIONS', '').strip()
VERTEX_REGIONS: tuple = (
    tuple(r.strip() for r in _ENV_REGIONS.split(',') if r.strip())
    if _ENV_REGIONS else _DEFAULT_REGIONS
)


class _VertexModel:
    """Mimics the legacy `GenerativeModel` interface using google-genai + Vertex Express.

    Region rotation: holds one Client per configured region and
    round-robins per call. Combined with the existing key rotation in
    pipeline.py, the effective throughput is (#keys × #regions) before
    project DSQ saturates. Threadsafe via a per-instance lock.
    """

    def __init__(self, api_key: str, model_name: str, safety_settings=None):
        from google import genai
        from google.genai import types as _types
        import threading
        self._genai = genai
        self._types = _types
        self._api_key = api_key
        # Build one client per region. With Vertex Express (api_key auth)
        # we can't pass `location=` directly — the SDK rejects it. Instead
        # we point each client at the regional endpoint via
        # `http_options.base_url`. Vertex Express exposes its REST API
        # under `https://<region>-aiplatform.googleapis.com` and routes
        # accordingly. Empty regions list ⇒ legacy single-region client.
        self._regions = VERTEX_REGIONS
        self._clients = [self._build_client(r) for r in self._regions]
        self._region_idx = 0
        self._region_lock = threading.Lock()
        # Backwards compat: callers that read `_client` get the first one.
        self._client = self._clients[0]
        self._model_name = model_name
        self._safety_settings = self._convert_safety(safety_settings)

    def _build_client(self, region: str):
        from google import genai
        # us-central1 is also the default-global endpoint, so we don't
        # need to override it; this avoids touching paths that work today.
        if region == 'us-central1':
            return genai.Client(vertexai=True, api_key=self._api_key)
        # Regional Vertex REST endpoint
        base = f'https://{region}-aiplatform.googleapis.com'
        return genai.Client(
            vertexai=True,
            api_key=self._api_key,
            http_options=self._types.HttpOptions(base_url=base),
        )

    def _next_client(self):
        """Round-robin pick of a regional client. Threadsafe."""
        with self._region_lock:
            c = self._clients[self._region_idx]
            self._region_idx = (self._region_idx + 1) % len(self._clients)
            return c

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
        # Apply the global request timeout via the new SDK's HttpOptions.
        # Caller can override per-call by passing timeout=N as a kwarg.
        cfg_kwargs['http_options'] = self._types.HttpOptions(
            timeout=int(kwargs.get('timeout', _DEFAULT_TIMEOUT) * 1000),  # ms
        )
        config = self._types.GenerateContentConfig(**cfg_kwargs) if cfg_kwargs else None
        # Pick a regional client per call so consecutive requests rotate
        # us-central1 → us-east1 → us-east4 → … When one region 429s on
        # quota, the next call automatically tries a different region.
        client = self._next_client()
        response = client.models.generate_content(
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
        # Legacy SDK exposes a per-request RequestOptions(timeout=...)
        # mechanism — apply the global default unless caller overrides.
        # Without this, a TCP-half-closed connection blocks the call
        # forever on recv() (the bug that caused the v4 8-hour stall).
        try:
            from google.generativeai.types import RequestOptions  # type: ignore
            req_opts = RequestOptions(timeout=kwargs.get('timeout', _DEFAULT_TIMEOUT))
            return self._model.generate_content(
                prompt_parts,
                safety_settings=safety_settings or self._safety_settings,
                request_options=req_opts,
            )
        except ImportError:
            # Older google-generativeai versions don't expose RequestOptions.
            # Fall back to a passthrough call — caller's _call_timeout
            # watchdog (scripts/_call_timeout.py) is the safety net here.
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
    # `gemini-pro-vision` is genuinely retired — keep the redirect.
    if lower == 'gemini-pro-vision':
        return 'gemini-2.5-pro'
    # `gemini-3-pro-preview` (and the 3.1 line) are real preview models on
    # Vertex now — pass them through unchanged so callers actually get the
    # newer model when they ask for it. Previously this function rewrote
    # them to gemini-2.5-pro, which silently downgraded every call site.
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
