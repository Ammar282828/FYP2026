#!/usr/bin/env python3
"""
Dry-run pipeline test.

Runs every processing stage (metadata, ad detection, article extraction,
NER, sentiment, topic classification) on one random newspaper image.
Does NOT write to Firestore — instead dumps structured output to a
JSON report and prints a discrepancy summary at the end.

Usage:
  GEMINI_API_KEY=... venv/bin/python scripts/test_pipeline_dry_run.py [image_path]
"""
import os
import sys
import json
import random
import traceback
from pathlib import Path
from datetime import datetime

# Make repo importable
REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))

from services.pipeline import Config, ImageProcessor, NLPProcessor
from PIL import Image


def pick_random_image() -> str:
    candidates_dirs = [
        REPO_ROOT / 'uploads' / 'newspapers',
        REPO_ROOT / 'input_newspapers',
    ]
    all_imgs = []
    for d in candidates_dirs:
        if d.exists():
            for ext in ('*.jpg', '*.jpeg', '*.png', '*.JPG', '*.JPEG', '*.PNG'):
                all_imgs.extend(d.glob(ext))
    if not all_imgs:
        raise SystemExit("[ERROR] No newspaper images found in uploads/newspapers or input_newspapers")
    return str(random.choice(all_imgs))


def _safe(callable_, *args, **kwargs):
    """Call a function, capture exceptions, return (ok, value_or_error_str)."""
    try:
        return True, callable_(*args, **kwargs)
    except Exception as e:
        tb = traceback.format_exc(limit=3)
        return False, f"{type(e).__name__}: {e}\n{tb}"


def summarize_article(a: dict) -> dict:
    """Strip bulky fields for the report."""
    out = {k: v for k, v in a.items() if k != 'text'}
    out['text_length'] = len(a.get('text') or '')
    out['text_preview'] = (a.get('text') or '')[:200]
    return out


def find_discrepancies(report: dict) -> list:
    issues = []
    meta = report.get('metadata') or {}
    pub_date = meta.get('date')
    if not pub_date:
        issues.append("[META] No publication date detected")
    else:
        # Archive is Dawn 1990–1992; out-of-range dates are suspicious.
        try:
            if isinstance(pub_date, str):
                d = datetime.fromisoformat(pub_date.replace('Z', ''))
            else:
                d = pub_date
            if not (1990 <= d.year <= 1992):
                issues.append(f"[META] Detected date {d.date()} is outside archive range 1990-1992")
        except Exception:
            issues.append(f"[META] Could not parse detected date: {pub_date!r}")

    page = meta.get('page')
    if page is None:
        issues.append("[META] No page number detected")
    elif not (1 <= int(page) <= 32):
        issues.append(f"[META] Page number {page} looks implausible (expected 1–32)")

    articles = report.get('articles') or []
    if not articles:
        issues.append("[ARTICLES] Zero articles extracted")
    for a in articles:
        num = a.get('number')
        headline = a.get('headline') or ''
        wc = a.get('word_count') or 0
        text_len = a.get('text_length') or 0
        if not headline.strip():
            issues.append(f"[ARTICLE {num}] Empty headline")
        if wc == 0 or text_len == 0:
            issues.append(f"[ARTICLE {num}] Empty body (word_count={wc}, text_length={text_len})")
        # word_count vs text_length rough sanity
        if wc and text_len:
            ratio = text_len / max(wc, 1)
            if ratio < 2 or ratio > 15:
                issues.append(
                    f"[ARTICLE {num}] Suspicious text_length/word_count ratio {ratio:.1f} "
                    f"(wc={wc}, chars={text_len})"
                )

    nlp_rows = report.get('nlp_per_article') or []
    for row in nlp_rows:
        num = row.get('article_number')
        if row.get('entities_error'):
            issues.append(f"[NER {num}] Error: {row['entities_error'].splitlines()[0]}")
        if row.get('sentiment_error'):
            issues.append(f"[SENTIMENT {num}] Error: {row['sentiment_error'].splitlines()[0]}")
        if row.get('topic_error'):
            issues.append(f"[TOPIC {num}] Error: {row['topic_error'].splitlines()[0]}")

        sent = row.get('sentiment') or {}
        label = sent.get('label')
        score = sent.get('score')
        if label and label.lower() not in {'positive', 'negative', 'neutral'}:
            issues.append(f"[SENTIMENT {num}] Unexpected label {label!r}")
        if score is not None and not (-1.0 <= float(score) <= 1.0):
            issues.append(f"[SENTIMENT {num}] Score {score} out of range [-1, 1]")

        topic = row.get('topic') or {}
        if topic and not topic.get('topic_label'):
            issues.append(f"[TOPIC {num}] No topic_label returned (topic_id={topic.get('topic_id')})")

    ads = report.get('ads') or []
    for i, ad in enumerate(ads):
        bb = ad.get('bounding_box')
        if not bb:
            issues.append(f"[AD {i}] Missing bounding box")
        else:
            for k in ('x1', 'y1', 'x2', 'y2'):
                if k not in bb:
                    issues.append(f"[AD {i}] Bounding box missing {k}")
                    break
            else:
                if bb['x2'] <= bb['x1'] or bb['y2'] <= bb['y1']:
                    issues.append(f"[AD {i}] Degenerate bounding box: {bb}")
    return issues


def main():
    api_key = os.environ.get('GEMINI_API_KEY', '').strip()
    if not api_key:
        raise SystemExit("[ERROR] GEMINI_API_KEY not set in environment")

    image_path = sys.argv[1] if len(sys.argv) > 1 else pick_random_image()
    print(f"[TEST] Using image: {image_path}")

    cfg = Config()
    # Ensure the Config picks up the environment key even if constructed early.
    cfg.GEMINI_API_KEY = api_key
    cfg.GEMINI_API_KEYS = (api_key,) + tuple(k for k in cfg.GEMINI_API_KEYS if k != api_key)

    print("[TEST] Initializing ImageProcessor...")
    image_proc = ImageProcessor(cfg)
    print("[TEST] Initializing NLPProcessor (may take a while: spaCy + HuggingFace)...")
    nlp_proc = NLPProcessor(cfg)

    report = {
        'image_path': image_path,
        'started_at': datetime.utcnow().isoformat() + 'Z',
        'stages': {},
    }

    # 1. Metadata
    print("\n=== Stage 1: Metadata (date + page) ===")
    ok, meta = _safe(image_proc.extract_metadata, image_path)
    report['stages']['metadata'] = {'ok': ok}
    if ok:
        # Normalize datetime for JSON
        md = dict(meta)
        if isinstance(md.get('date'), datetime):
            md['date'] = md['date'].isoformat()
        report['metadata'] = md
        print(f"  date={md.get('date')}  page={md.get('page')}")
    else:
        report['stages']['metadata']['error'] = meta
        report['metadata'] = {}
        print(f"  [ERROR] {meta.splitlines()[0]}")

    # 2. Ads
    print("\n=== Stage 2: Ad detection ===")
    ads_report = []
    try:
        img = Image.open(image_path)
        img = image_proc.enhance_image(img)
        ok, ads = _safe(image_proc.detect_ads, img)
        report['stages']['ads'] = {'ok': ok}
        if ok:
            for i, ad in enumerate(ads or []):
                row = {
                    'index': i,
                    'bounding_box': ad.get('bounding_box'),
                    'text_preview': (ad.get('text') or '')[:120],
                    'brand': ad.get('brand'),
                    'category': ad.get('category'),
                    'has_image': ad.get('image') is not None,
                }
                # Optional: run deep analysis on first 2 only to save quota
                if i < 2 and ad.get('image') is not None:
                    ok2, deep = _safe(image_proc.analyze_ad_image, ad['image'])
                    row['deep_analysis_ok'] = ok2
                    row['deep_analysis'] = deep if ok2 else None
                    if not ok2:
                        row['deep_analysis_error'] = deep.splitlines()[0] if isinstance(deep, str) else str(deep)
                ads_report.append(row)
            report['ads'] = ads_report
            print(f"  detected {len(ads or [])} ads")
        else:
            report['stages']['ads']['error'] = ads
            print(f"  [ERROR] {ads.splitlines()[0]}")
    except Exception as e:
        report['stages']['ads'] = {'ok': False, 'error': str(e)}
        print(f"  [ERROR] {e}")

    # 3. Articles
    print("\n=== Stage 3: Article extraction (Gemini OCR) ===")
    ok, articles = _safe(image_proc.extract_articles, image_path)
    report['stages']['articles'] = {'ok': ok}
    if ok:
        report['articles'] = [summarize_article(a) for a in articles]
        print(f"  extracted {len(articles)} articles")
        for a in articles[:3]:
            print(f"    - #{a.get('number')}: {a.get('headline', '')[:60]!r}  wc={a.get('word_count')}")
    else:
        articles = []
        report['stages']['articles']['error'] = articles if isinstance(articles, str) else 'unknown'
        report['articles'] = []
        print(f"  [ERROR] {ok}")

    # 4. NLP per article (NER, sentiment, topic)
    print("\n=== Stage 4: NLP per article ===")
    nlp_rows = []
    max_articles = min(len(articles), 5)  # cap for API usage
    for a in articles[:max_articles]:
        num = a.get('number')
        row = {'article_number': num, 'headline': a.get('headline')}
        # Entities
        ok_e, ents = _safe(nlp_proc.extract_entities, a.get('text', ''))
        if ok_e:
            # summarize entity types
            type_counts = {}
            for ent in ents:
                t = ent.get('type', 'UNKNOWN')
                type_counts[t] = type_counts.get(t, 0) + 1
            row['entities_count'] = len(ents)
            row['entities_by_type'] = type_counts
            row['entities_sample'] = ents[:5]
        else:
            row['entities_error'] = ents
        # Sentiment
        ok_s, sent = _safe(nlp_proc.analyze_sentiment, a.get('text', ''))
        if ok_s:
            row['sentiment'] = sent
        else:
            row['sentiment_error'] = sent
        # Topic (Gemini)
        combined = f"{a.get('headline', '')}\n\n{a.get('text', '')}"
        ok_t, topic = _safe(nlp_proc.assign_topic, combined)
        if ok_t:
            row['topic'] = topic
        else:
            row['topic_error'] = topic
        nlp_rows.append(row)
        print(f"  #{num}: ents={row.get('entities_count', '?')}  "
              f"sent={row.get('sentiment', {}).get('label', '?')}  "
              f"topic={(row.get('topic') or {}).get('topic_label', '?')}")

    report['nlp_per_article'] = nlp_rows

    # 5. Discrepancies
    print("\n=== Stage 5: Discrepancy check ===")
    issues = find_discrepancies(report)
    report['discrepancies'] = issues
    if issues:
        print(f"  Found {len(issues)} issue(s):")
        for i in issues:
            print(f"    • {i}")
    else:
        print("  ✓ No discrepancies found")

    report['finished_at'] = datetime.utcnow().isoformat() + 'Z'

    out_path = REPO_ROOT / 'pipeline_test_report.json'
    with open(out_path, 'w') as f:
        json.dump(report, f, indent=2, default=str)
    print(f"\n[DONE] Report written to {out_path}")
    print(f"[DONE] Processed articles: {len(articles)}  |  ads: {len(ads_report)}  |  issues: {len(issues)}")


if __name__ == '__main__':
    main()
