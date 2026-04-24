"""
Audit: legacy RoBERTa sentiment vs. Gemini sentiment, side-by-side.

Why
---
The current production scorer (cardiffnlp/twitter-roberta-base-sentiment-latest,
truncated to 1000 chars, weighted-sum score) labels almost everything "neutral"
on Dawn 1990s prose. This script samples N articles from Firestore, runs both
the legacy scorer and the Gemini scorer (services.sentiment_gemini), and prints
a comparison report so we can decide whether a swap is worth it before touching
the live pipeline.

Usage
-----
    GEMINI_API_KEY=AQ.xxx python -m scripts.audit_sentiment --n 30
    python -m scripts.audit_sentiment --n 50 --csv out.csv
    python -m scripts.audit_sentiment --n 20 --skip-legacy   # gemini-only

Output
------
    - per-article table: id, legacy(label,score), gemini(label,score), agree?
    - aggregate: label distributions, score histograms, disagreement matrix.
    - optional CSV for spreadsheet inspection.
"""
from __future__ import annotations

import argparse
import csv
import os
import random
import sys
import time
from collections import Counter
from typing import Dict, List, Optional

# Make sibling packages importable when run as a script from repo root.
_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(_HERE)
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from services.sentiment_gemini import analyze_sentiment_gemini  # noqa: E402


def _load_legacy_scorer():
    """Lazy-load the HuggingFace pipeline so --skip-legacy doesn't pay the cost."""
    print("[audit] loading legacy RoBERTa pipeline (this is slow on first run)…")
    from transformers import pipeline
    return pipeline(
        "sentiment-analysis",
        model="cardiffnlp/twitter-roberta-base-sentiment-latest",
        return_all_scores=True,
    )


def _legacy_score(scorer, text: str) -> Dict:
    """Mirror services.pipeline.NLPProcessor.analyze_sentiment for parity."""
    snippet = (text or "")[:1000]
    if not snippet.strip():
        return {"score": 0.0, "label": "neutral", "confidence": 0.0}
    try:
        results = scorer(snippet)[0]
    except Exception as exc:  # noqa: BLE001
        return {"score": 0.0, "label": "neutral", "confidence": 0.0, "error": str(exc)}
    label_map = {"negative": -1, "neutral": 0, "positive": 1}
    top = max(results, key=lambda x: x["score"])
    score = sum(label_map.get(r["label"].lower(), 0) * r["score"] for r in results)
    return {
        "score": round(score, 3),
        "label": top["label"].lower(),
        "confidence": round(top["score"], 3),
    }


def _sample_articles(n: int) -> List[Dict]:
    """Pull a random sample of articles from Firestore (text + metadata)."""
    from database.firestore_db import get_firestore_db
    db = get_firestore_db()
    # Use the in-memory snapshot when available — avoids a live Firestore scan.
    snapshot = getattr(db, "_articles_snapshot", None)
    if snapshot is None and hasattr(db, "_load_articles_snapshot"):
        db._load_articles_snapshot()
        snapshot = getattr(db, "_articles_snapshot", None)
    if not snapshot:
        # Fall back to the public API (slower but always works).
        results = db.search_articles(query="", limit=max(500, n * 10))
        pool = results.get("articles", []) if isinstance(results, dict) else results
    else:
        pool = list(snapshot.values()) if isinstance(snapshot, dict) else list(snapshot)

    pool = [a for a in pool if (a.get("content") or a.get("text") or "").strip()]
    if not pool:
        raise RuntimeError("No articles found in snapshot — is Firestore configured?")
    return random.sample(pool, k=min(n, len(pool)))


def _row_for(article: Dict, legacy: Optional[Dict], gemini: Dict) -> Dict:
    return {
        "id": article.get("id") or article.get("article_id") or "",
        "title": (article.get("title") or "")[:80],
        "date": (article.get("publication_date") or "")[:10],
        "page": article.get("page_number") or article.get("page") or "",
        "legacy_label": (legacy or {}).get("label", "—"),
        "legacy_score": (legacy or {}).get("score", "—"),
        "gemini_label": gemini.get("label", "—"),
        "gemini_score": gemini.get("score", "—"),
        "gemini_confidence": gemini.get("confidence", "—"),
        "gemini_reasoning": (gemini.get("reasoning") or "")[:120],
        "agree": (legacy and gemini and legacy.get("label") == gemini.get("label")) or False,
    }


def _print_table(rows: List[Dict]) -> None:
    cols = [
        ("date", 11), ("page", 4),
        ("legacy_label", 9), ("legacy_score", 7),
        ("gemini_label", 9), ("gemini_score", 7), ("gemini_confidence", 5),
        ("agree", 5),
        ("title", 60),
    ]
    header = "  ".join(name.ljust(width) for name, width in cols)
    print(header)
    print("-" * len(header))
    for r in rows:
        print("  ".join(str(r.get(name, "")).ljust(width)[:width] for name, width in cols))


def _print_summary(rows: List[Dict], skip_legacy: bool) -> None:
    n = len(rows)
    if not n:
        print("\n(no rows)")
        return
    g_labels = Counter(r["gemini_label"] for r in rows)
    print("\n=== Gemini label distribution ===")
    for lbl in ("positive", "neutral", "negative"):
        c = g_labels.get(lbl, 0)
        print(f"  {lbl:<9} {c:>4}  ({c / n:.0%})")

    if skip_legacy:
        return

    l_labels = Counter(r["legacy_label"] for r in rows)
    print("\n=== Legacy label distribution ===")
    for lbl in ("positive", "neutral", "negative"):
        c = l_labels.get(lbl, 0)
        print(f"  {lbl:<9} {c:>4}  ({c / n:.0%})")

    agree = sum(1 for r in rows if r["agree"])
    print(f"\n=== Agreement: {agree}/{n} ({agree / n:.0%}) ===")

    # Confusion matrix legacy x gemini
    print("\n=== Confusion (rows=legacy, cols=gemini) ===")
    labels = ("positive", "neutral", "negative")
    print("           " + "  ".join(l.rjust(9) for l in labels))
    for lr in labels:
        cells = []
        for lc in labels:
            c = sum(1 for r in rows if r["legacy_label"] == lr and r["gemini_label"] == lc)
            cells.append(f"{c:>9}")
        print(f"  {lr:<9}" + "  ".join(cells))

    # Where does the legacy "neutral" mass actually land?
    legacy_neutral = [r for r in rows if r["legacy_label"] == "neutral"]
    if legacy_neutral:
        flips = Counter(r["gemini_label"] for r in legacy_neutral)
        moved = sum(c for lbl, c in flips.items() if lbl != "neutral")
        print(
            f"\n=== Of {len(legacy_neutral)} legacy-neutral, "
            f"Gemini moved {moved} ({moved / len(legacy_neutral):.0%}) off neutral ==="
        )
        for lbl in ("positive", "negative", "neutral"):
            print(f"  → {lbl:<9} {flips.get(lbl, 0)}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--n", type=int, default=30, help="sample size")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--csv", type=str, default=None, help="optional CSV output path")
    parser.add_argument("--skip-legacy", action="store_true", help="don't run RoBERTa")
    parser.add_argument("--model", type=str, default="gemini-2.5-flash")
    parser.add_argument("--sleep", type=float, default=0.6, help="seconds between Gemini calls")
    args = parser.parse_args()

    if not os.getenv("GEMINI_API_KEY"):
        print("error: GEMINI_API_KEY not set", file=sys.stderr)
        return 2

    random.seed(args.seed)
    print(f"[audit] sampling {args.n} articles…")
    sample = _sample_articles(args.n)
    print(f"[audit] got {len(sample)} articles")

    legacy_scorer = None if args.skip_legacy else _load_legacy_scorer()

    rows: List[Dict] = []
    for i, art in enumerate(sample, 1):
        text = art.get("content") or art.get("text") or ""
        legacy = None if args.skip_legacy else _legacy_score(legacy_scorer, text)
        gemini = analyze_sentiment_gemini(text, model_name=args.model)
        rows.append(_row_for(art, legacy, gemini))
        print(f"  [{i:>3}/{len(sample)}] legacy={legacy and legacy['label']:<8} gemini={gemini['label']:<8} {art.get('title','')[:60]}")
        if args.sleep:
            time.sleep(args.sleep)

    print()
    _print_table(rows)
    _print_summary(rows, args.skip_legacy)

    if args.csv:
        with open(args.csv, "w", newline="", encoding="utf-8") as fh:
            w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
            w.writeheader()
            w.writerows(rows)
        print(f"\n[audit] wrote {args.csv}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
