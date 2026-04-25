"""
Per-call watchdog for backfill scripts.

Why
---
The Gemini SDKs (both `google.generativeai` legacy and `google.genai`)
make a blocking HTTPS request inside `generate_content()`. They don't
expose a per-call timeout that's actually enforced at the socket level —
when the laptop's network changes underneath an active socket (sleep/wake
on a different wifi, VPN flap, etc.) the socket lands in CLOSE_WAIT and
the SDK happily waits forever for bytes that won't arrive.

This module wraps any synchronous Gemini-style call in a
`ThreadPoolExecutor` and abandons the worker thread if it exceeds the
budget. The orphaned thread eventually dies when the Python process
exits; we accept the leak in exchange for guaranteed forward progress
on the main loop.

Usage
-----
    from scripts._call_timeout import call_with_timeout
    result = call_with_timeout(
        analyze_sentiment_gemini, text, model_name="gemini-2.5-flash",
        timeout=60,
    )

Raises `TimeoutError` if the inner call doesn't return within `timeout`
seconds — caller handles that exactly like any other Gemini exception.
"""
from __future__ import annotations

import concurrent.futures
from typing import Any, Callable

# Single shared executor — created lazily so importing this module is free.
# `max_workers=1` is fine because every backfill is single-threaded; we
# just need a parking spot for the blocking call.
_EXEC: concurrent.futures.ThreadPoolExecutor | None = None


def _executor() -> concurrent.futures.ThreadPoolExecutor:
    global _EXEC
    if _EXEC is None:
        # `max_workers=2` so a previously-orphaned thread from a timed-out
        # call doesn't block the next dispatch.
        _EXEC = concurrent.futures.ThreadPoolExecutor(
            max_workers=2, thread_name_prefix="gemini-watchdog"
        )
    return _EXEC


def call_with_timeout(fn: Callable[..., Any], *args, timeout: float = 60.0, **kwargs) -> Any:
    """Run `fn(*args, **kwargs)` and raise `TimeoutError` if it exceeds `timeout` seconds.

    The worker thread is *not* cancelled — Python can't cancel a thread that's
    blocked in C-level I/O. Instead it's abandoned and the next call gets a
    fresh slot. In a backfill loop this means a stuck Gemini request causes
    one missed article instead of the entire run hanging.
    """
    fut = _executor().submit(fn, *args, **kwargs)
    try:
        return fut.result(timeout=timeout)
    except concurrent.futures.TimeoutError:
        # Don't bother with `fut.cancel()` — it returns False once the call
        # has started (which it has, since we're in C-level socket waits).
        raise TimeoutError(f"call to {getattr(fn, '__name__', fn)!r} exceeded {timeout}s budget")
