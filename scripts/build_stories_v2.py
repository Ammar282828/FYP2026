#!/usr/bin/env python3
"""
Build stories v2 — TF-IDF entity weighting, headline-overlap signal,
connected-components clustering, AI-generated titles, garbage filtering.

Why v2:
  Audit of v1 stories shows 67% are 2-article same-day duos with machine-
  stitched "Entity · Entity · Entity" titles. Tender notices + repeated
  "Correction" boilerplate cluster together because the v1 algorithm
  uses raw entity Jaccard with no IDF weighting — common entities like
  ISLAMABAD or numeric tokens dominate the matches. v2 fixes this by:

    1. Pre-filtering classifieds / garbage-headline / sub-80w articles.
    2. Pre-deduping near-identical articles (same date + same headline).
    3. Computing per-entity IDF across the whole corpus and discounting
       common-noun entities ("Pakistan", "Karachi", years, single
       digits).
    4. Building per-article feature vectors over (entities + headline
       content-words + topic) with IDF weighting.
    5. Clustering via cosine-similarity nearest-neighbours (top-K) and
       UNION-FIND, requiring date proximity AND a minimum similarity.
    6. Requiring story size >= 3 articles (was 2) so single-day duos
       are dropped.
    7. Asking gemini-2.5-flash to generate a 4-7 word event title per
       cluster (cached, single call per cluster).

Usage:
    GEMINI_API_KEY=... GOOGLE_APPLICATION_CREDENTIALS=... \\
        python scripts/build_stories_v2.py --dry-run
    Add --clear to wipe v1 stories and write v2 from scratch.
"""

import argparse
import math
import os
import re
import sys
import time
from collections import Counter, defaultdict
from datetime import timedelta
from typing import Dict, List, Optional, Set, Tuple

os.environ.setdefault('FIREBASE_SERVICE_ACCOUNT_PATH', 'firebase-service-account.json')
os.environ.setdefault('FIREBASE_STORAGE_BUCKET', 'fyp2026-87a9b.appspot.com')

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database.firestore_db import get_db, _STORY_ENTITY_TYPES
from api.routes.articles import _is_classified, _is_garbage_headline


# ───────────────────────── helpers ─────────────────────────────────────

# Words that overwhelm headline-overlap signals when not down-weighted
# (common newspaper boilerplate + Pakistan-corpus high-frequency terms).
_HEADLINE_STOPWORDS = {
    'a', 'an', 'and', 'as', 'at', 'be', 'by', 'for', 'from', 'in', 'is',
    'it', 'of', 'on', 'or', 'that', 'the', 'to', 'with', 'will', 'was',
    'were', 'are', 'has', 'have', 'had', 'this', 'these', 'their', 'his',
    'her', 'who', 'what', 'when', 'where', 'why', 'how', 'than', 'more',
    'most', 'over', 'after', 'before', 'into', 'out', 'one', 'two', 'three',
    'pakistan', 'pakistani', 'islamabad', 'karachi', 'lahore', 'dawn',
    'says', 'said', 'asks', 'urge', 'urges', 'today', 'tomorrow', 'yesterday',
    'note', 'notice', 'call', 'calls', 'demand', 'demands',
}

# Entities that match this pattern are noise (numeric tokens, dates,
# times, single Roman numerals). Filtered out before IDF computation.
_NOISE_ENT_RE = re.compile(
    r'^(?:'
    r'\d+|'                                    # 1, 15, 1990
    r'[ivxlcdm]{1,4}|'                         # roman numerals
    r'[a-z]|'                                  # single letters
    r'\d+[\s./-]\d+(?:[\s./-]\d+)?|'           # dates / fractions
    r'[a-z]+day|'                              # weekday names
    r'jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec'  # month abbrs
    r')$',
    re.IGNORECASE,
)

# Multi-word noise (titles, common locations, calendar phrases).
_NOISE_PHRASES = {
    'pakistan', 'islamabad', 'karachi', 'lahore', 'rawalpindi',
    'peshawar', 'quetta', 'sindh', 'punjab', 'balochistan', 'nwfp',
    'the government', 'government', 'the senate', 'the assembly',
    'national assembly', 'provincial assembly', 'cabinet', 'parliament',
    'today', 'yesterday', 'tomorrow', 'morning', 'evening', 'reuters',
    'reuter', 'afp', 'ap', 'apa', 'app', 'ppi',
}


def _is_useful_entity(text: str, etype: str) -> bool:
    text = (text or '').strip()
    if not text or len(text) < 3:
        return False
    if etype not in _STORY_ENTITY_TYPES:
        return False
    if _NOISE_ENT_RE.match(text):
        return False
    if text.lower() in _NOISE_PHRASES:
        return False
    # Reject nearly-all-digit tokens
    if sum(c.isdigit() for c in text) / max(len(text), 1) > 0.5:
        return False
    return True


def _article_entities(article: dict) -> List[str]:
    out = []
    for e in (article.get('entities') or []):
        if _is_useful_entity(e.get('text', ''), e.get('type', '')):
            out.append(e['text'].strip().lower())
    return out


def _headline_terms(headline: str) -> List[str]:
    """Lower-cased content words from the headline, no stopwords."""
    if not headline:
        return []
    toks = re.findall(r"[a-z][a-z'\-]{2,}", headline.lower())
    return [t for t in toks if t not in _HEADLINE_STOPWORDS]


def _article_features(article: dict) -> List[str]:
    """Combined feature tokens for an article: entities + headline words + topic."""
    feats: List[str] = []
    for e in _article_entities(article):
        feats.append(f'ent:{e}')
    for t in _headline_terms(article.get('headline') or ''):
        feats.append(f'kw:{t}')
    topic = (article.get('topic_label') or '').strip().lower()
    if topic and topic not in ('uncategorized', 'other'):
        feats.append(f'topic:{topic}')
    return feats


# ───────────────────────── I/O ──────────────────────────────────────────

def fetch_all_articles(db) -> List[dict]:
    """Pull every article. Apply garbage filters in-memory.

    Pages by __name__ in 5k chunks instead of one giant `.stream()`.
    The single-stream version hangs on the SDK retry bug once the
    collection passes ~30k docs (same fix as
    firestore_db._get_articles_snapshot and the topics endpoints).
    """
    print('Fetching articles (paginated)…')
    docs = []
    PAGE = 5000
    last_id = None
    seen = 0
    while True:
        q = db.db.collection('articles').order_by('__name__').limit(PAGE)
        if last_id is not None:
            q = q.start_after({'__name__': last_id})
        page = list(q.stream())
        if not page:
            break
        for d in page:
            a = d.to_dict()
            if a.get('low_quality'):
                continue
            if _is_classified(a):
                continue
            if _is_garbage_headline(a.get('headline') or ''):
                continue
            # Body must have substance
            wc = a.get('word_count') or len((a.get('content') or '').split())
            if wc < 80:
                continue
            # Need a date for date-window logic
            if not a.get('publication_date'):
                continue
            docs.append(a)
        seen += len(page)
        last_id = page[-1].id
        print(f'  scanned {seen}, kept {len(docs)}', flush=True)
        if len(page) < PAGE:
            break
    print(f'  {len(docs)} articles after filters')
    return docs


def dedup_near_identical(articles: List[dict]) -> List[dict]:
    """Drop articles whose (date, headline-lower) collides with another.

    Reprints + boilerplate ("Correction") frequently produce 2 nearly
    identical articles per day; v1 turned every such pair into a story.
    Keep just one.
    """
    seen = {}
    kept = []
    for a in articles:
        key = (str(a.get('publication_date'))[:10],
               (a.get('headline') or '').strip().lower())
        if key in seen:
            continue
        seen[key] = True
        kept.append(a)
    print(f'  {len(kept)} after near-identical dedup')
    return kept


# ───────────────────────── IDF + similarity ─────────────────────────────

def compute_idf(articles: List[dict]) -> Dict[str, float]:
    """Inverse-document-frequency weight per feature token.

    A feature appearing in many articles gets a low weight so it can't
    dominate similarity scores. Rare features (specific names, unique
    keywords) get high weight.
    """
    df = Counter()
    for a in articles:
        for tok in set(_article_features(a)):
            df[tok] += 1
    n = max(len(articles), 1)
    return {tok: math.log((n + 1) / (cnt + 1)) + 1.0 for tok, cnt in df.items()}


def vectorize(article: dict, idf: Dict[str, float]) -> Dict[str, float]:
    """Return a sparse {feature: weight} vector for an article."""
    counts = Counter(_article_features(article))
    return {tok: cnt * idf.get(tok, 1.0) for tok, cnt in counts.items() if tok in idf}


def cosine(a: Dict[str, float], b: Dict[str, float]) -> float:
    if not a or not b:
        return 0.0
    # Iterate the shorter dict for the dot product
    short, long = (a, b) if len(a) <= len(b) else (b, a)
    dot = sum(v * long.get(k, 0.0) for k, v in short.items())
    if dot == 0.0:
        return 0.0
    na = math.sqrt(sum(v * v for v in a.values()))
    nb = math.sqrt(sum(v * v for v in b.values()))
    return dot / (na * nb) if na and nb else 0.0


# ───────────────────────── clustering ───────────────────────────────────

class UnionFind:
    def __init__(self, n: int):
        self.parent = list(range(n))
        self.rank = [0] * n

    def find(self, x: int) -> int:
        while self.parent[x] != x:
            self.parent[x] = self.parent[self.parent[x]]
            x = self.parent[x]
        return x

    def union(self, a: int, b: int) -> None:
        ra, rb = self.find(a), self.find(b)
        if ra == rb:
            return
        if self.rank[ra] < self.rank[rb]:
            ra, rb = rb, ra
        self.parent[rb] = ra
        if self.rank[ra] == self.rank[rb]:
            self.rank[ra] += 1


def cluster_articles(
    articles: List[dict],
    sim_threshold: float,
    date_window_days: int,
    top_k: int,
) -> List[List[dict]]:
    """Build feature vectors, find nearest-neighbours, link via UF.

    For each article, look at the top_k subsequent articles within
    date_window_days. If cosine ≥ sim_threshold, link them. After all
    pairs are processed, every connected component of size ≥ 3 becomes
    a story.

    O(n × k) — n articles compared against the k articles immediately
    after them in chronological order.
    """
    print('Computing IDF and feature vectors…')
    idf = compute_idf(articles)
    vectors = [vectorize(a, idf) for a in articles]
    dates = [a.get('publication_date') for a in articles]
    print(f'  IDF over {len(idf)} unique features')
    print(f'  Linking with cosine ≥ {sim_threshold}, window {date_window_days}d, k={top_k}')

    uf = UnionFind(len(articles))
    edges = 0
    t0 = time.time()
    for i in range(len(articles)):
        if i and i % 1000 == 0:
            print(f'  {i}/{len(articles)}  edges={edges}  elapsed={time.time()-t0:.0f}s')
        # Articles are NOT pre-sorted by date — so search a window of
        # top_k * 4 ahead and filter by date
        for j in range(i + 1, min(i + top_k * 4, len(articles))):
            di, dj = dates[i], dates[j]
            if di is None or dj is None:
                continue
            try:
                if abs((dj - di).days) > date_window_days:
                    continue
            except Exception:
                continue
            sim = cosine(vectors[i], vectors[j])
            if sim >= sim_threshold:
                uf.union(i, j)
                edges += 1
    print(f'  Linked {edges} edges in {time.time()-t0:.0f}s')

    # Gather components
    groups = defaultdict(list)
    for i in range(len(articles)):
        groups[uf.find(i)].append(i)

    clusters = [
        [articles[i] for i in idxs]
        for idxs in groups.values()
        if len(idxs) >= 3
    ]
    clusters.sort(key=len, reverse=True)
    print(f'  Components ≥ 3 articles: {len(clusters)}')
    return clusters


# ───────────────────────── titling via Gemini ──────────────────────────

def _build_title_prompt(cluster: List[dict]) -> str:
    sample = sorted(cluster, key=lambda a: a.get('publication_date') or '')[:6]
    lines = []
    for a in sample:
        d = str(a.get('publication_date') or '')[:10]
        lines.append(f'  ({d}) {a.get("headline") or "(untitled)"}')
    headlines_block = '\n'.join(lines)
    # Top shared entities (excluding noise) — gives the model an anchor.
    ent_counter = Counter()
    for a in cluster:
        for e in _article_entities(a):
            ent_counter[e] += 1
    top_ents = [e for e, _ in ent_counter.most_common(6)]
    return (
        "You are titling a multi-article newspaper story cluster from the Dawn "
        "(Pakistan) archive. Below are the article headlines (chronological). "
        "Write a single 4–8-word headline-style title that names the EVENT or "
        "ONGOING STORY across all of them — not a list of entities. Do NOT use "
        "the word 'story' or 'coverage'. Don't quote, don't end with a period. "
        f"Reply with the title only.\n\nHEADLINES:\n{headlines_block}\n\n"
        f"KEY ENTITIES: {', '.join(top_ents)}\n\nTITLE:"
    )


def _gemini_title(prompt: str, key: str, model_name: str = 'gemini-2.5-flash') -> Optional[str]:
    try:
        from services.gemini_adapter import create_model
        model = create_model(key, model_name)
        resp = model.generate_content(prompt)
        text = (resp.text or '').strip().strip('"\'')
        # Trim explanatory prefixes some models like to add.
        for prefix in ('TITLE:', 'Title:', 'title:'):
            if text.startswith(prefix):
                text = text[len(prefix):].strip()
        return text[:80] if text else None
    except Exception as e:
        print(f'  [WARN] title gen failed: {type(e).__name__}: {e}')
        return None


# ───────────────────────── writers ─────────────────────────────────────

def clear_existing_stories(db) -> None:
    print('Clearing existing stories…')

    # Delete stories in batches. Single-doc delete on 500+ stories used
    # to take ~minutes; batched commits cut it to seconds.
    docs = list(db.db.collection('stories').stream())
    if docs:
        b = db.db.batch(); n = 0
        for d in docs:
            b.delete(d.reference); n += 1
            if n % 400 == 0:
                b.commit(); b = db.db.batch()
        b.commit()
    print(f'  Deleted {len(docs)} stories')

    # Clearing story_id from articles previously did a full
    # `db.collection("articles").stream()` of all ~36k docs, then
    # filtered in-process. That hits the SDK retry bug on large
    # collections and hangs forever. Use a where() filter so Firestore
    # only sends back the docs that actually have a story_id set.
    from google.cloud.firestore_v1.base_query import FieldFilter
    n = 0
    b = db.db.batch()
    try:
        # Articles with any non-null story_id. We can't use `!=` on a
        # field that may be missing; fall back to ordering-by-key
        # pagination if this query errors.
        q = db.db.collection('articles').where(filter=FieldFilter('story_id', '>', ''))
        for d in q.stream():
            b.update(d.reference, {'story_id': None})
            n += 1
            if n % 400 == 0:
                b.commit(); b = db.db.batch()
        if n % 400:
            b.commit()
    except Exception as e:
        # Fallback: paginate articles by __name__ in chunks of 5k —
        # same pattern firestore_db._get_articles_snapshot uses to
        # dodge the SDK's full-collection-scan crash.
        print(f'  story_id where-query failed ({e}); falling back to paginated scan')
        last_id = None
        while True:
            qq = db.db.collection('articles').order_by('__name__').limit(5000)
            if last_id is not None:
                qq = qq.start_after({'__name__': last_id})
            page = list(qq.stream())
            if not page: break
            for d in page:
                if d.to_dict().get('story_id'):
                    b.update(d.reference, {'story_id': None})
                    n += 1
                    if n % 400 == 0:
                        b.commit(); b = db.db.batch()
            last_id = page[-1].id
            if len(page) < 5000: break
        if n % 400:
            b.commit()

    print(f'  Cleared story_id from {n} articles')


def write_clusters(db, clusters: List[List[dict]], titles: Dict[int, str]) -> Tuple[int, int]:
    created = 0
    linked = 0
    for cid, cluster in enumerate(clusters):
        ordered = sorted(cluster, key=lambda a: a.get('publication_date') or '')
        seed = ordered[0]
        story_id = db.create_story(seed)
        # Override title with our AI title if we got one.
        if cid in titles and titles[cid]:
            db.db.collection('stories').document(story_id).update({'title': titles[cid]})
        db.db.collection('articles').document(seed['id']).update({'story_id': story_id})
        created += 1
        linked += 1
        for a in ordered[1:]:
            try:
                db.add_article_to_story(story_id, a)
                linked += 1
            except Exception as e:
                print(f'  [WARN] add failed for {a.get("id")}: {e}')
    return created, linked


# ───────────────────────── main ────────────────────────────────────────

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--sim', type=float, default=0.32, help='Cosine sim threshold (default 0.32)')
    ap.add_argument('--window', type=int, default=45, help='Date window in days (default 45)')
    ap.add_argument('--top-k', type=int, default=80, help='Max forward articles to consider per article (default 80)')
    ap.add_argument('--min-size', type=int, default=3, help='Minimum cluster size (default 3)')
    ap.add_argument('--max-titles', type=int, default=200, help='Cap AI title generation (default 200)')
    ap.add_argument('--no-titles', action='store_true', help='Skip AI title generation')
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--clear', action='store_true')
    args = ap.parse_args()

    print('=' * 70)
    print('Build stories v2  —  TF-IDF + connected components')
    print(f'  sim={args.sim}  window={args.window}d  top_k={args.top_k}  min={args.min_size}')
    print(f'  dry_run={args.dry_run}  clear={args.clear}')
    print('=' * 70)

    db = get_db()
    if args.clear and not args.dry_run:
        clear_existing_stories(db)

    articles = fetch_all_articles(db)
    articles = dedup_near_identical(articles)
    if not articles:
        print('[ERROR] No articles passed filters.'); return 1

    # Sort chronologically so the top-k window is forward-in-time.
    articles.sort(key=lambda a: a.get('publication_date') or '')

    clusters = cluster_articles(
        articles,
        sim_threshold=args.sim,
        date_window_days=args.window,
        top_k=args.top_k,
    )
    clusters = [c for c in clusters if len(c) >= args.min_size]
    if not clusters:
        print('[INFO] No clusters at this threshold. Try --sim lower.'); return 0

    # Title each cluster via Gemini (unless --no-titles).
    titles: Dict[int, str] = {}
    if not args.no_titles:
        gemini_key = os.getenv('GEMINI_API_KEY', '').strip()
        if not gemini_key:
            print('[INFO] GEMINI_API_KEY not set — skipping AI titles.')
        else:
            print(f'\nGenerating titles for top {min(args.max_titles, len(clusters))} clusters…')
            for i, c in enumerate(clusters[:args.max_titles]):
                t = _gemini_title(_build_title_prompt(c), gemini_key)
                if t:
                    titles[i] = t
                if i and i % 20 == 0:
                    print(f'  titled {i}/{min(args.max_titles, len(clusters))}')
                # Light throttle
                time.sleep(0.4)

    # Preview
    print(f'\n{"-"*70}\nPREVIEW — {len(clusters)} stories:')
    for i, c in enumerate(clusters[:30]):
        ordered = sorted(c, key=lambda a: a.get('publication_date') or '')
        sd = str(ordered[0].get('publication_date') or '')[:10]
        ed = str(ordered[-1].get('publication_date') or '')[:10]
        title = titles.get(i, '<no title>')
        print(f'  [{i+1:3d}] ({len(c)} arts, {sd}→{ed}) {title}')
        for a in ordered[:2]:
            print(f'         · {(a.get("headline") or "")[:70]}')
        if len(clusters) > 30 and i == 29:
            print(f'  … and {len(clusters)-30} more')
            break

    sizes = [len(c) for c in clusters]
    spans = []
    for c in clusters:
        ordered = sorted(c, key=lambda a: a.get('publication_date') or '')
        try:
            spans.append((ordered[-1]['publication_date'] - ordered[0]['publication_date']).days)
        except Exception:
            pass
    print(f'\nSize histogram:')
    sb = Counter(sizes if len(sizes) <= 50 else [3 if s == 3 else 4 if s == 4 else 5 if s == 5 else
                                                 6 if 6 <= s <= 9 else 10 if 10 <= s <= 19 else 20
                                                 for s in sizes])
    for s, n in sorted(sb.items()):
        print(f'  {s} arts: {n}')
    if spans:
        print(f'Date-span percentiles (days):  p50={sorted(spans)[len(spans)//2]}  p90={sorted(spans)[int(len(spans)*0.9)]}  max={max(spans)}')

    if args.dry_run:
        print('\n[DRY RUN] No changes written.'); return 0

    print(f'\nWriting {len(clusters)} stories…')
    created, linked = write_clusters(db, clusters, titles)
    print(f'  Created: {created}  Linked: {linked}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
