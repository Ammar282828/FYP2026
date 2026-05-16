"""
Article-related API routes
"""

import re
from fastapi import APIRouter, HTTPException
from typing import Optional
import os
from database.firestore_db import get_db
from utils.filters import filter_and_normalize_entities

# Topic IDs that are purely classified ads — tenders, job listings
_CLASSIFIED_TOPIC_IDS = {4, 5}


# Dawn dateline prefix: "ISLAMABAD, Jan 12: ..." or
# "By Our Staff Reporter\nKARACHI, Jan 13: ..." (sometimes with a parenthetical
# region: "KARACHI (NNI), Jan 13: ..."). Strip it before display because:
#   - Every article repeats the city/date in the body, so the search-result
#     cards all start "ISLAMABAD, Jan 12:" and the actual lede is buried.
#   - The byline ("By Our Staff Reporter") is the same across ~33% of the
#     corpus and is noise, not signal.
# We KEEP the original `content` in the API response untouched — only the
# `content_preview` (and full-content read endpoint) strips. That way the
# dateline still shows up in the article-detail full-text view if anyone
# wants it, but lists and previews are clean.
_DATELINE_RE = re.compile(
    r'^\s*'
    # optional byline line ("By X / By Our Staff Reporter / From Y") —
    # the model produces these in many forms; one or two lines is plenty.
    r'(?:(?:by|from)\s+[^\n]{1,80}\n){0,2}'
    # the dateline city in ALL CAPS, optional parenthetical (NNI),
    # optional comma, then month + day, optional year, then a colon.
    r'[A-Z][A-Z\-/\s]{2,40}'
    r'(?:\s*\([A-Z][A-Z\-/\s]{0,20}\))?'
    r'\s*,?\s+'
    r'(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*'
    r'\.?\s+\d{1,2}'
    r'(?:\s*,\s*\d{4})?'
    r'\s*:\s*',
    re.IGNORECASE,
)


def _strip_dateline(text: str) -> str:
    """Remove the leading "CITY, Mon DD:" dateline (and optional byline).

    Returns text unchanged when no dateline is found, so this is safe to
    apply to every article — non-dateline-prefixed bodies pass through
    untouched.
    """
    if not text:
        return text
    return _DATELINE_RE.sub('', text, count=1).lstrip()


def _make_preview(content: str, length: int = 200) -> str:
    """content_preview = first `length` chars AFTER stripping the dateline."""
    return _strip_dateline(content or '')[:length]

# Headline keywords that indicate a classified ad regardless of topic
_CLASSIFIED_KEYWORDS = [
    'tender', 'situation vacant', 'job opportunity', 'vacancy',
    'applications are invited', 'notice inviting tender', 'corrigendum',
    'pvt.) ltd.', 'earnest money', 'nit no.', 'n.i.t',
]

def _is_classified(article: dict) -> bool:
    if article.get('topic_id') in _CLASSIFIED_TOPIC_IDS:
        return True
    headline = (article.get('headline') or '').lower()
    return any(kw in headline for kw in _CLASSIFIED_KEYWORDS)


# Headlines that are obviously not real news headlines: Gemini meta-text,
# leftover markdown from the extraction prompt, page-header lines OCR'd
# from the masthead, etc. These ended up in Firestore at extraction time;
# until a backfill scrubs them we filter them out at read-time so search
# results don't lead with garbage like "### **Main Advertisement (Top)**".
_GARBAGE_HEADLINE_PATTERNS = [
    re.compile(r'^\s*(here is|based on|the following|note:|\(note)', re.IGNORECASE),
    re.compile(r'^\s*(\*\*|##|\*\(|---|>>>)', re.IGNORECASE),       # markdown leftovers
    # Page-header leakage: "10 DAWN FRIDAY", "II DAWN, WEDNESDAY",
    # "DAWN MONDAY", or just "DAWN, JANUARY 14, 1990".
    re.compile(r'^\s*([\divxlcm]+\s+)?dawn[\s,]+(sun|mon|tues|wednes|thurs|fri|satur|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)', re.IGNORECASE),
    re.compile(r'^\s*[ivxlcm]+\s+dawn\b', re.IGNORECASE),            # Roman-numeral page nums
    re.compile(r'founded by quaid[\s\-]?i[\s\-]?azam', re.IGNORECASE), # masthead tagline
    re.compile(r'^\s*(main advertisement|advertisement \(top|column \d|article \d)', re.IGNORECASE),
    re.compile(r'^\s*\W*$'),                                          # all punctuation/whitespace
    re.compile(r'transcrib(ed|ing)', re.IGNORECASE),                  # "as transcribed in the columns"
    re.compile(r'extracted from the image', re.IGNORECASE),
]


def _is_garbage_headline(headline: str) -> bool:
    """Return True for headlines that are clearly not real article titles."""
    if not headline:
        return True
    h = headline.strip()
    if len(h) < 4:
        return True
    return any(p.search(h) for p in _GARBAGE_HEADLINE_PATTERNS)


def _date_sort_key(article: dict, *, ascending: bool):
    """Stable, None-safe sort key for `publication_date`.

    Firestore docs may have a missing/None publication_date (older imports,
    or articles whose vision-backfill is still pending). A naive `lambda x:
    x.get('publication_date', '')` blows up with
    `'<' not supported between 'NoneType' and 'DatetimeWithNanoseconds'`
    because some entries are real datetimes and some are None or strings.
    Normalise everything to an ISO string and push None to the end (or
    start, when ascending).
    """
    pd = article.get('publication_date')
    if pd is None:
        # Sentinel sorts after real dates in DESC, before in ASC.
        return ('' if ascending else '~~~~~')
    if hasattr(pd, 'isoformat'):
        return pd.isoformat()
    return str(pd)


def _quality_score(article: dict) -> int:
    """Quality-aware ranking score for search results.

    Higher = better.

    The intent is to surface articles where the full pipeline ran cleanly
    (region OCR + topic + sentiment + entities) over articles that came
    out fragmented or are missing downstream metadata. Search results
    sorted by this key visibly demonstrate the value of every backfill
    pass: clean prose with topic/sentiment/entities/summary bubbles up,
    OCR fragments and meta-only stubs sink.

    All factors are additive and bounded so the worst-case score stays
    small (lets date desc act as a tie-breaker among comparable articles).
    """
    score = 0
    headline = (article.get('headline') or '').strip()
    body = (article.get('content') or '').strip()
    wc = article.get('word_count') or len(body.split())

    # Computed metadata — proves downstream pipeline ran
    if article.get('topic_label'): score += 30
    if article.get('topic_method'): score += 10
    if article.get('sentiment_method'): score += 20
    if article.get('summary'): score += 25
    ents = article.get('entities')
    if ents:
        score += 10 + min(len(ents), 5)  # up to +15
    kws = article.get('keywords')
    if kws:
        score += min(len(kws), 5)        # up to +5

    # Word-count sweet spot — full extracted articles beat fragments + dumps
    if 50 <= wc <= 800:
        score += 25
    elif 800 < wc <= 2000:
        score += 15
    elif 30 <= wc < 50:
        score += 5
    # else: 0 (fragments <30w, mega-dumps >2000w both penalised)

    # Headline cleanliness
    if 15 <= len(headline) <= 120:
        score += 15
    if headline and not headline.startswith('['):
        score += 5
    if headline and not headline.isupper():
        score += 5

    # Body cleanliness — no [...] markers means region OCR fully captured
    bracket_count = body.count('[...]') + body.count('[…]')
    bracket_density = bracket_count / max(wc / 100.0, 1.0)
    if bracket_density < 0.5:
        score += 20
    elif bracket_density > 2.0:
        score -= 15

    # Has metadata that lets the article be cited / dated
    if article.get('publication_date'): score += 10
    if article.get('page_number'): score += 5

    return score


def _quality_sort_key(article: dict):
    """Combined sort key: highest quality first, then most-recent.
    Returns a tuple that sort(reverse=True) sorts as desired.
    """
    return (_quality_score(article), _date_sort_key(article, ascending=False))

try:
    import google.generativeai as genai
except ImportError:
    genai = None
try:
    from services.gemini_adapter import create_model as _create_gemini_model
except ImportError:
    _create_gemini_model = None


# Pick a Gemini key for runtime API calls (chat, summary, entity bio).
# History: this used to read only `GEMINI_API_KEY` (a single key set in
# .env). On this deployment that key points at a project where Vertex AI
# billing is disabled, so every chat call returned 403 PERMISSION_DENIED.
# The OCR ingest path already rotates through `GEMINI_API_KEYS` (the
# fresh Vertex Express keys) — pick from the same pool so chat works
# whenever ingest works. Fallback to the legacy single key keeps
# backwards compatibility on dev machines that haven't migrated yet.
import itertools
_GEMINI_KEY_POOL: list = []
_GEMINI_KEY_CYCLE = None

def _refresh_gemini_pool():
    global _GEMINI_KEY_POOL, _GEMINI_KEY_CYCLE
    rotation = (os.getenv("GEMINI_API_KEYS") or "").strip()
    keys = [k.strip() for k in rotation.split(",") if k.strip()]
    primary = (os.getenv("GEMINI_API_KEY") or "").strip()
    # Prefer rotation pool. Use legacy single-key only when no rotation
    # is configured — that way a misconfigured-billing legacy key never
    # silently steals requests away from a healthy rotation pool.
    if keys:
        _GEMINI_KEY_POOL = keys
    elif primary:
        _GEMINI_KEY_POOL = [primary]
    else:
        _GEMINI_KEY_POOL = []
    _GEMINI_KEY_CYCLE = itertools.cycle(_GEMINI_KEY_POOL) if _GEMINI_KEY_POOL else None

_refresh_gemini_pool()

def _pick_gemini_key():
    """Return the next key from the rotation pool. Re-reads env once if
    the pool is empty so changes to GEMINI_API_KEYS without a restart
    are picked up on the first call after the change."""
    global _GEMINI_KEY_CYCLE
    if _GEMINI_KEY_CYCLE is None:
        _refresh_gemini_pool()
    if _GEMINI_KEY_CYCLE is None:
        return None
    return next(_GEMINI_KEY_CYCLE)


router = APIRouter(prefix="/api", tags=["articles"])


@router.get("/articles")
def list_articles(
    limit: int = 100,
    offset: int = 0,
    sort_by: str = 'relevance',
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
):
    """List articles. Default sort = quality-aware ranking.

    `limit` counts non-classified articles — i.e. asking for limit=100
    returns 100 *visible* articles, not 100 raw docs of which a chunk
    are tenders/vacancies you'd never see. We over-fetch by a generous
    margin so a long stretch of classifieds at the head of the corpus
    doesn't starve the page.

    sort_by:
      relevance (default) — articles with full pipeline metadata
        (topic + sentiment + entities + summary) and clean OCR rank
        above fragments and meta-stubs. Demonstrates corpus quality
        rather than just chronology.
      date — most-recent first (legacy behaviour).

    date_from / date_to: ISO yyyy-mm-dd strings (inclusive). When set,
    Firestore is queried with a publication_date range filter so we
    only fetch the relevant slice of the archive. If only one bound is
    given the other side is open. The "Browse by date" UI uses this.
    """
    from datetime import datetime as _dt
    try:
        db = get_db()
        q = db.db.collection('articles')

        # Range query lives in Firestore so we don't pull the whole
        # corpus when the user just wants a single day. Firestore needs
        # an order_by on the same field as the inequality; that's fine
        # — we want chronological order anyway.
        if date_from:
            try:
                df = _dt.fromisoformat(date_from)
                q = q.where('publication_date', '>=', df)
            except ValueError:
                raise HTTPException(400, f"date_from must be yyyy-mm-dd, got {date_from!r}")
        if date_to:
            try:
                # End of day so 'date_to=2090-10-15' includes that day.
                dt = _dt.fromisoformat(date_to).replace(hour=23, minute=59, second=59)
                q = q.where('publication_date', '<=', dt)
            except ValueError:
                raise HTTPException(400, f"date_to must be yyyy-mm-dd, got {date_to!r}")

        if date_from or date_to:
            # Range: pull everything matching, sorted ascending so we
            # naturally walk forward through the slice.
            q = q.order_by('publication_date', direction='ASCENDING')
            # Don't truncate the range; users asking "show me everything
            # in October 1990" want everything. Bound at 5000 to keep
            # responses sane.
            q = q.limit(min(5000, limit + offset + 500))
        else:
            # No range: original "recent corpus" behaviour.
            if sort_by == 'relevance':
                oversample = max((limit + offset) * 6, 600)
            else:
                oversample = max((limit + offset) * 2, (limit + offset) + 200)
            q = q.order_by('publication_date', direction='DESCENDING').limit(oversample)

        raw_docs = list(q.stream())

        keepers = []
        for doc in raw_docs:
            data = doc.to_dict()
            if _is_classified(data):
                continue
            if _is_garbage_headline(data.get('headline') or ''):
                continue
            # Hide low-quality OCR victims (article body had >5
            # [ILLEGIBLE] markers or >20% of words were placeholders).
            # The `low_quality` flag is set by scripts/cleanup_quality.py
            # at ingest-time / on demand. Articles aren't deleted because
            # they're sometimes recoverable on a re-OCR pass; they're
            # just hidden from default browse + search.
            if data.get('low_quality'):
                continue
            data['content_preview'] = _make_preview(data.get('content') or '')
            keepers.append(data)

        # Apply requested sort to whatever we pulled.
        if sort_by == 'relevance':
            keepers.sort(key=_quality_sort_key, reverse=True)
        elif sort_by == 'date_asc':
            keepers.sort(key=lambda x: _date_sort_key(x, ascending=True))
        elif sort_by == 'date':
            keepers.sort(key=lambda x: _date_sort_key(x, ascending=False), reverse=True)
        # else: leave whatever Firestore gave us

        total = len(keepers)
        return {
            "articles": keepers[offset:offset + limit],
            "total": total,
            "date_from": date_from,
            "date_to": date_to,
        }
    except Exception as e:
        raise HTTPException(500, f"Database error: {str(e)}")


# NOTE: These two routes MUST be declared before /articles/{article_id}
# because FastAPI matches path routes in declaration order.
@router.get("/articles/random")
def random_article():
    """Return a single random non-classified article from the archive."""
    import random
    try:
        db = get_db()
        from datetime import datetime as _dt, timedelta as _td
        start = _dt(1990, 1, 1)
        end = _dt(1992, 12, 31)
        delta_days = (end - start).days
        pick = start + _td(days=random.randint(0, delta_days))
        next_day = pick + _td(days=1)

        q = (db.db.collection('articles')
               .where('publication_date', '>=', pick)
               .where('publication_date', '<', next_day)
               .limit(50))
        docs = list(q.stream())
        candidates = [d.to_dict() for d in docs]
        candidates = [c for c in candidates if not _is_classified(c)]
        if not candidates:
            fallback = list(db.db.collection('articles').order_by(
                'publication_date', direction='DESCENDING').limit(200).stream())
            candidates = [d.to_dict() for d in fallback if not _is_classified(d.to_dict())]
        if not candidates:
            raise HTTPException(404, "No articles available")
        choice = random.choice(candidates)
        return {"article": choice}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Database error: {str(e)}")


@router.get("/articles/on-this-day")
def on_this_day(month: Optional[int] = None, day: Optional[int] = None, limit: int = 10):
    """Return articles published on today's month/day across archive years."""
    from datetime import datetime as _dt
    now = _dt.utcnow()
    # Bounds check — caller-supplied month/day was previously trusted
    # blindly, so on-this-day?month=99&day=99 raised an unhandled
    # ValueError 500. Validate before we use them anywhere.
    m = int(month or now.month)
    d = int(day or now.day)
    if not (1 <= m <= 12):
        raise HTTPException(400, f"month must be 1-12, got {m}")
    if not (1 <= d <= 31):
        raise HTTPException(400, f"day must be 1-31, got {d}")
    # Cap limit so a caller can't make us scan + materialise 100k articles
    # for a single page render.
    limit = max(1, min(int(limit or 10), 100))
    try:
        db = get_db()
        docs = db.db.collection('articles').order_by(
            'publication_date', direction='DESCENDING').limit(2000).stream()
        hits = []
        for doc in docs:
            data = doc.to_dict()
            pd = data.get('publication_date')
            if pd and hasattr(pd, 'month') and pd.month == m and pd.day == d:
                if _is_classified(data):
                    continue
                data['content_preview'] = _make_preview(data.get('content') or '')
                hits.append(data)
                if len(hits) >= limit:
                    break
        return {"month": m, "day": d, "articles": hits, "count": len(hits)}
    except Exception as e:
        raise HTTPException(500, f"Database error: {str(e)}")


@router.get("/articles/{article_id}")
def get_article(article_id: str):
    # gets one specific article by its id
    try:
        db = get_db()
        article = db.get_article(article_id)
        if not article:
            raise HTTPException(404, "Article not found")
        # Strip the leading "CITY, Mon DD:" dateline so the displayed body
        # starts at the actual lede. Original is preserved on disk; only
        # the API response is cleaned.
        if article.get('content'):
            article['content'] = _strip_dateline(article['content'])
        return article
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Database error: {str(e)}")


@router.get("/articles/{article_id}/full")
def get_article_full(article_id: str):
    # gets the full article with all the details
    try:
        db = get_db()
        article = db.get_article(article_id)

        if not article:
            raise HTTPException(404, "Article not found")

        article['entities'] = filter_and_normalize_entities(article.get('entities', []))
        if article.get('content'):
            article['content'] = _strip_dateline(article['content'])

        return {"article": article}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Database error: {str(e)}")


# searches for articles that contain certain keywords
@router.post("/search/keyword")
def search_keyword(request: dict):
    keyword = request.get('keyword') or request.get('query', '')
    limit = min(request.get('limit', 100), 1000)
    offset = max(request.get('offset', 0), 0)
    # Default = quality-aware ranking. Surfaces articles with full
    # pipeline metadata (topic/sentiment/entities/summary) and clean
    # OCR over fragments/meta-stubs. Old behaviour available via
    # sort_by='date'.
    sort_by = request.get('sort_by', 'relevance')

    # Filters from the search panel — previously these were silently
    # dropped here, so users could click "Topic = Pakistan Politics"
    # and still get articles from other topics. Now they actually
    # narrow the result set.
    start_date_str = (request.get('start_date') or '').strip() or None
    end_date_str = (request.get('end_date') or '').strip() or None
    sentiment_filter = (request.get('sentiment') or '').strip().lower() or None
    topic_filter = (request.get('topic') or '').strip() or None
    entity_type_filter = (request.get('entity_type') or '').strip().upper() or None

    has_filters = any([start_date_str, end_date_str, sentiment_filter,
                       topic_filter, entity_type_filter])

    # Allow filter-only queries (e.g. "all positive Pakistan Politics
    # articles in March 1990"). Without a keyword we walk the snapshot
    # and apply filters directly.
    if not keyword:
        if not has_filters:
            raise HTTPException(400, "Provide a keyword or at least one filter")
    elif len(keyword) > 200:
        raise HTTPException(400, "Keyword must be less than 200 characters")

    try:
        from datetime import datetime as _dt, timezone as _tz

        def _coerce_date(v):
            if v is None: return None
            if hasattr(v, 'tzinfo'):
                return v.replace(tzinfo=_tz.utc) if v.tzinfo is None else v
            try:
                d = _dt.fromisoformat(str(v).replace('Z', '+00:00'))
                return d.replace(tzinfo=_tz.utc) if d.tzinfo is None else d
            except Exception:
                return None

        sd = _coerce_date(start_date_str)
        ed = _coerce_date(end_date_str)

        db = get_db()
        if keyword:
            # Pull a wider candidate pool than `limit` since we're about to
            # filter out classifieds + garbage headlines, and we want enough
            # left to actually fill the page.
            articles = db.search_articles(keyword, limit=max(limit * 8, 1000))
        else:
            # Filter-only mode: stream the full snapshot.
            articles = list(db._get_articles_snapshot())

        articles = [
            a for a in articles
            if not _is_classified(a) and not _is_garbage_headline(a.get('headline') or '')
        ]

        # Apply structured filters in Python.
        if sd or ed or sentiment_filter or topic_filter or entity_type_filter:
            filtered = []
            for a in articles:
                if sd or ed:
                    pd = _coerce_date(a.get('publication_date'))
                    if pd is None:
                        continue
                    if sd and pd < sd: continue
                    if ed and pd > ed: continue
                if sentiment_filter:
                    if (a.get('sentiment_label') or '').lower() != sentiment_filter:
                        continue
                if topic_filter:
                    if (a.get('topic_label') or '') != topic_filter:
                        continue
                if entity_type_filter:
                    ents = a.get('entities') or []
                    if not any(
                        (isinstance(e, dict) and (e.get('type') or '').upper() == entity_type_filter)
                        for e in ents
                    ):
                        continue
                filtered.append(a)
            articles = filtered

        total = len(articles)
        articles = articles[offset:offset + limit]

        articles_list = []
        for article in articles:
            article['content_preview'] = _make_preview(article.get('content') or '')
            article['entities'] = filter_and_normalize_entities(article.get('entities', []))
            articles_list.append(article)

        if sort_by == 'relevance':
            # Quality-aware: rich-metadata + clean-OCR articles first, then
            # break ties by most recent.
            articles_list.sort(key=_quality_sort_key, reverse=True)
        elif sort_by == 'date':
            articles_list.sort(key=lambda x: _date_sort_key(x, ascending=False), reverse=True)
        elif sort_by == 'date_asc':
            articles_list.sort(key=lambda x: _date_sort_key(x, ascending=True))
        elif sort_by == 'sentiment':
            articles_list.sort(key=lambda x: x.get('sentiment_score') or 0, reverse=True)
        elif sort_by == 'sentiment_asc':
            articles_list.sort(key=lambda x: x.get('sentiment_score') or 0)

        return {
            "articles": articles_list,
            "total": total,
            "keyword": keyword,
            "sort_by": sort_by
        }
    except Exception as e:
        raise HTTPException(500, f"Database error: {str(e)}")


# finds articles that mention a specific entity like a person or place
@router.post("/search/entity")
def search_entity(request: dict):
    entity_name = request.get('entity_name', '') or request.get('query', '')
    limit = min(request.get('limit', 100), 1000)
    offset = max(request.get('offset', 0), 0)

    if not entity_name or len(entity_name) < 1:
        raise HTTPException(400, "Entity name is required")

    try:
        db = get_db()
        articles = db.search_by_entity(entity_name, limit=max(limit * 4, 200))
        articles = [
            a for a in articles
            if not _is_classified(a) and not _is_garbage_headline(a.get('headline') or '')
        ]

        total = len(articles)
        articles = articles[offset:offset + limit]

        articles_list = []
        for article in articles:
            article['content_preview'] = _make_preview(article.get('content') or '')
            article['entities'] = filter_and_normalize_entities(article.get('entities', []))
            articles_list.append(article)

        # Default to quality-aware ranking — same as keyword search:
        # rich-metadata + clean-OCR articles bubble up, then date desc.
        articles_list.sort(key=_quality_sort_key, reverse=True)

        return {
            "articles": articles_list,
            "total": total,
            "entity_name": entity_name
        }
    except Exception as e:
        raise HTTPException(500, f"Database error: {str(e)}")


@router.post("/articles/{article_id}/summary")
def generate_article_summary(article_id: str):
    # generates an AI summary for a specific article using Gemini
    try:
        db = get_db()
        article = db.get_article(article_id)

        if not article:
            raise HTTPException(404, "Article not found")

        if not genai:
            raise HTTPException(500, "Google Generative AI package not installed")

        gemini_key = _pick_gemini_key()
        if not gemini_key:
            raise HTTPException(500, "GEMINI_API_KEY not configured")

        try:
            model = _create_gemini_model(gemini_key, 'gemini-2.5-pro')

            prompt = f"""You are analyzing a historical newspaper article from 1990-1992.

Article Headline: {article.get('headline', '')}

Article Content:
{article.get('content', '')}

Please provide a concise, professional summary (3-5 sentences) covering:
1. Main topic and key events
2. Key people, organizations, or locations mentioned
3. Historical significance or context
4. Overall tone and perspective

Summary:"""

            response = model.generate_content(prompt)
            summary = response.text.strip()

        except Exception as e:
            summary = f"AI Summary temporarily unavailable. Article discusses: {article.get('headline', '')}"
            print(f"Gemini API error: {str(e)}")

        return {
            "article_id": article_id,
            "summary": summary,
            "headline": article.get('headline', '')
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Error generating summary: {str(e)}")


@router.get("/articles/{article_id}/related")
def get_related_articles(article_id: str):
    """
    Return articles related to this one via the shared story.

    If the article belongs to a story (has a story_id), returns:
      - Other articles in that story, sorted chronologically
      - The story title, narrative (context), and key entities

    If no story is assigned, returns an empty result.
    """
    try:
        db = get_db()
        article = db.get_article(article_id)
        if not article:
            raise HTTPException(404, "Article not found")

        story_id = article.get('story_id')
        if not story_id:
            return {"related_articles": [], "story_id": None, "story_context": None}

        story = db.get_story(story_id)
        if not story:
            return {"related_articles": [], "story_id": None, "story_context": None}

        # Fetch other articles in the same story
        other_ids = [aid for aid in story.get('article_ids', []) if aid != article_id]
        related = []
        for aid in other_ids:
            a = db.get_article(aid)
            if a and not _is_classified(a):
                a['content_preview'] = _make_preview(a.get('content') or '')
                pub = a.get('publication_date')
                if pub and hasattr(pub, 'isoformat'):
                    a['publication_date'] = pub.isoformat()
                ca = a.get('created_at')
                if ca and hasattr(ca, 'isoformat'):
                    a['created_at'] = ca.isoformat()
                related.append(a)

        # Sort chronologically
        related.sort(key=lambda a: a.get('publication_date', ''))

        story = db._serialize_story(story)

        return {
            "related_articles": related,
            "story_id": story_id,
            "story_title": story.get('title', ''),
            "story_context": story.get('narrative'),
            "story_key_entities": story.get('key_entities', [])[:6],
            "story_date_span_days": story.get('date_span_days', 0),
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Database error: {str(e)}")


_STOPWORDS = {
    'a','an','the','and','or','but','of','in','on','at','to','from','for',
    'with','by','as','is','are','was','were','be','been','being','have',
    'has','had','do','does','did','will','would','should','could','can',
    'may','might','must','shall','this','that','these','those','it','its',
    'they','them','their','there','here','what','which','who','whom',
    'whose','when','where','why','how','tell','me','about','you','your',
    'we','our','us','i','my','mine','also','any','all','some','more',
    'most','many','few','one','two','three','than','then','so','too','if',
    'into','out','over','under','during','between','before','after','up',
    'down','no','not','nor','only','same','very','just','really'
}

# Years 1980..2099 — used to narrow searches when a question mentions a year.
_YEAR_RE = re.compile(r'\b(19[89]\d|20\d{2})\b')


def _extract_query_signals(q: str) -> dict:
    """Pull retrieval-useful signals out of a free-form question.

    Returns:
      keywords: lower-cased non-stopword tokens (>=3 chars), preserving order.
      proper_nouns: capitalised tokens / multi-word capitalised spans
        (likely entities to query against the entities index).
      years: any 4-digit year mentioned (used for date-range fallback).
    """
    text = q.strip()
    keywords: list[str] = []
    seen = set()
    for tok in re.findall(r"[A-Za-z][A-Za-z'\-]{2,}", text):
        low = tok.lower()
        if low in _STOPWORDS or low in seen:
            continue
        keywords.append(low)
        seen.add(low)
    # Capitalised runs (e.g. "Benazir Bhutto", "Gulf War") — but skip the
    # first word of the sentence which is always capitalised.
    proper_nouns: list[str] = []
    # Drop the first word from consideration as a sentence-start cap.
    rest = ' '.join(text.split()[1:]) if text.split() else ''
    for m in re.findall(r'\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\b', rest):
        if m and m.lower() not in _STOPWORDS:
            proper_nouns.append(m)
    years = list(set(_YEAR_RE.findall(text)))
    return {'keywords': keywords[:8], 'proper_nouns': proper_nouns[:6], 'years': years}


@router.post("/chat/ask")
def ask_archive(request: dict):
    """
    Ask-the-Archive: natural-language Q&A grounded in archive search.

    Body:
      question: str (required)
      max_context: int (default 12, max 20) — how many articles to feed Gemini
      history: optional list of {role, content} prior turns, last 6 used
      model: optional override ('gemini-2.5-pro' [default] or 'gemini-2.5-flash')

    Pipeline:
      1. Extract keywords, proper nouns, year hints from the question.
      2. Run multi-strategy retrieval in parallel:
           - keyword search on each significant term (top 8)
           - entity search on each proper-noun phrase (top 6)
           - if a year was mentioned, pull articles from that year too
      3. Merge candidates, dedup by ID.
      4. Score each candidate by:
           - count of question terms found in headline/body (high weight)
           - bonus if a proper-noun phrase appears verbatim
           - +0.4 × _quality_score (cleanness of the OCR / pipeline metadata)
      5. Send top max_context articles + the conversation history to
         gemini-2.5-pro for a synthesised, cited answer.
    """
    question = (request.get("question") or "").strip()
    if not question:
        raise HTTPException(400, "question is required")
    if not genai:
        raise HTTPException(500, "google-generativeai package not installed")
    gemini_key = _pick_gemini_key()
    if not gemini_key:
        raise HTTPException(500, "GEMINI_API_KEY not configured")

    # Coerce safely — `int()` on a string like "abc" would crash with
    # ValueError and 500 instead of giving the caller a 400.
    raw_max = request.get("max_context", 12)
    try:
        max_context = max(1, min(int(raw_max), 20))
    except (TypeError, ValueError):
        raise HTTPException(400, f"max_context must be an integer 1-20, got {raw_max!r}")
    history = request.get("history") or []
    if not isinstance(history, list):
        raise HTTPException(400, "history must be a list of {role, content} turns")
    # Default to flash because gemini-2.5-pro is heavily quota-throttled
    # on the trial-tier project — sending the request to pro reliably
    # 429s after ~14s and then we fall back, doubling latency. flash is
    # plenty good for archive Q&A and answers in ~3-6s. Frontend can
    # opt into pro by sending {"model": "gemini-2.5-pro"} explicitly.
    model_name = request.get("model") or 'gemini-2.5-flash'

    try:
        db = get_db()
        signals = _extract_query_signals(question)
        keywords = signals['keywords']
        proper_nouns = signals['proper_nouns']
        years = signals['years']

        # Multi-strategy candidate gather. Tag each hit with its source
        # so we can boost articles that surfaced via multiple paths.
        candidates: dict = {}  # id -> (article, retrieval_count)
        def _add(art, source: str):
            aid = art.get('id')
            if not aid:
                return
            cur = candidates.get(aid)
            if cur is None:
                candidates[aid] = (art, {source})
            else:
                cur[1].add(source)

        # 1) Keyword search on each significant term.
        for term in keywords[:6]:
            try:
                hits = db.search_articles(term, limit=15) or []
            except Exception:
                hits = []
            for h in hits:
                _add(h, 'kw')

        # 2) Entity search on proper nouns.
        for ent in proper_nouns:
            try:
                hits = db.search_by_entity(ent, limit=10) or []
            except Exception:
                hits = []
            for h in hits:
                _add(h, 'entity')

        # 3) Year hint → pull articles from that year for chronological context.
        # Always run when a year is mentioned (was: only when candidates was
        # under threshold). Without this, keyword + entity hits saturated the
        # pool with off-year articles and the year search never executed —
        # so "events in 1991?" returned only 1990 articles even though the
        # corpus has 5k+ from Jan 1991.
        if years:
            from datetime import datetime as _dt
            for yr in years[:1]:  # just the first year; usually one is plenty
                try:
                    df = _dt(int(yr), 1, 1)
                    dt = _dt(int(yr), 12, 31, 23, 59, 59)
                    # Larger pull (60 vs 40 before) — we may filter candidates
                    # down to just this year's articles below, so we need
                    # enough headroom to fill max_context after garbage drops.
                    yearq = (db.db.collection('articles')
                             .where('publication_date', '>=', df)
                             .where('publication_date', '<=', dt)
                             .order_by('publication_date', direction='DESCENDING')
                             .limit(60))
                    for doc in yearq.stream():
                        _add(doc.to_dict(), 'year')
                except Exception:
                    pass

        # If nothing found, drop into the legacy LLM-only fallback below.
        candidate_list = [(a, srcs) for a, srcs in candidates.values()]
        # Filter classifieds + garbage headlines so the LLM doesn't get
        # noise.
        candidate_list = [
            (a, srcs) for (a, srcs) in candidate_list
            if not _is_classified(a) and not _is_garbage_headline(a.get('headline') or '')
        ]

        # If the question explicitly mentioned a year, restrict the
        # candidate pool to articles from that year. Without this, a
        # question about "1991" would still get 1990 articles ranked
        # higher because keyword+entity overlap dominates the score.
        # Soft-fall-back: if we'd filter to zero, keep the unfiltered
        # pool so the LLM at least has *something* to work from.
        if years:
            wanted = {int(y) for y in years}
            def _in_wanted_year(a):
                pd = a.get('publication_date')
                if pd is None: return False
                if hasattr(pd, 'year'): return pd.year in wanted
                # ISO string fallback
                try:
                    return int(str(pd)[:4]) in wanted
                except Exception:
                    return False
            year_filtered = [(a, s) for (a, s) in candidate_list if _in_wanted_year(a)]
            if year_filtered:
                candidate_list = year_filtered

        # 4) Score: term overlap + quality
        ql_terms = set(keywords)
        ql_proper = [p.lower() for p in proper_nouns]
        def _rich_score(item):
            a, srcs = item
            txt = ((a.get('headline') or '') + ' ' + (a.get('content') or a.get('content_preview') or '')).lower()
            term_hits = sum(1 for t in ql_terms if t in txt)
            proper_hits = sum(2 for p in ql_proper if p and p in txt)
            multi_source_bonus = 2 if len(srcs) >= 2 else 0
            quality = _quality_score(a) * 0.04   # max ~5
            return term_hits + proper_hits + multi_source_bonus + quality
        candidate_list.sort(key=_rich_score, reverse=True)
        context_articles = [a for a, _ in candidate_list[:max_context]]

        if not context_articles:
            # Fall back to a direct LLM answer with a clear disclaimer so the
            # user gets *something* useful when the archive search is empty
            # (e.g. Firestore quota exceeded, or genuinely no matching docs).
            try:
                fallback_prompt = f"""You are a research assistant for the Dawn newspaper archive (Pakistan, 1990-1992).

The archive search returned no matching articles for the user's question, so you must answer from general historical knowledge of Pakistan in 1990-1992. Keep the answer brief (3-5 sentences) and START with this exact disclaimer line:

"⚠️ No matching articles in the archive — answering from general historical context."

QUESTION: {question}

Answer:"""
                model = _create_gemini_model(gemini_key, 'gemini-2.5-flash')
                resp = model.generate_content(fallback_prompt)
                return {
                    "question": question,
                    "answer": resp.text.strip(),
                    "sources": [],
                    "model": "gemini-2.5-flash",
                    "grounded": False,
                }
            except Exception as e:
                return {
                    "question": question,
                    "answer": f"I couldn't find any articles in the archive that match this question, and the AI fallback also failed: {e}",
                    "sources": [],
                }

        blocks = []
        sources = []
        for i, a in enumerate(context_articles, 1):
            pd = a.get('publication_date', '')
            if hasattr(pd, 'strftime'):
                date_str = pd.strftime('%B %d, %Y')
            else:
                date_str = str(pd)[:10]
            headline = (a.get('headline') or 'Untitled').strip()
            page = a.get('page_number')
            page_str = f" · p. {page}" if page else ''
            topic = (a.get('topic_label') or '').strip()
            topic_str = f" · {topic}" if topic else ''
            # Bigger excerpt — 2.5-pro has a huge context window; the
            # synthesis is dramatically better with the actual article
            # body instead of a 500-char teaser.
            excerpt = _strip_dateline(a.get('content') or a.get('content_preview') or '').strip()
            if len(excerpt) > 1500:
                excerpt = excerpt[:1500] + '…'
            blocks.append(
                f"[{i}] ({date_str}{page_str}{topic_str}) {headline}\n{excerpt}"
            )
            sources.append({
                "id": a.get('id'),
                "headline": headline,
                "publication_date": date_str,
                "citation_index": i,
                "topic_label": topic or None,
                "page_number": page,
            })

        # Compress conversation history to last 6 turns and a summary line.
        history_block = ''
        if isinstance(history, list) and history:
            tail = []
            for turn in history[-6:]:
                role = (turn.get('role') or '').lower()
                content = (turn.get('content') or '').strip()
                if not content or role not in ('user', 'assistant'):
                    continue
                # Trim long prior assistant answers — we just need the gist
                # so the model can keep a thread going.
                if role == 'assistant' and len(content) > 600:
                    content = content[:600] + '…'
                tail.append(f"{role.upper()}: {content}")
            if tail:
                history_block = "\n\nPRIOR CONVERSATION (most recent last):\n" + "\n".join(tail)

        prompt = f"""You are a careful research assistant working with the Dawn newspaper archive (Pakistan, primarily 1990–1992). You answer questions using only the articles supplied below.

GROUND RULES
1. Use ONLY information present in the articles. If something isn't covered, say so plainly — do not fill in from general knowledge.
2. Cite every factual claim with [n] markers tied to the article numbers. Multiple citations like [3][7] are fine when several articles back the same point.
3. Where dates differ across articles, present them chronologically and call out the disagreement explicitly.
4. Disambiguate names, places, and roles when the articles do (e.g. "Nawaz Sharif (then PM)"). Don't assume context that isn't in the text.
5. Be concise but specific. Aim for 3–8 sentences for simple questions; longer with structure (paragraphs, bullets) only when the question is broad and the articles support depth.
6. When the corpus has obvious OCR damage in a citation (gutter cuts, [...] markers), flag it briefly rather than guessing missing words.
7. End with a one-line "Sources used:" summary listing the most load-bearing citations (e.g. "Sources used: [1], [3], [5]").

ARTICLES (in retrieval-rank order):
{chr(10).join(blocks)}{history_block}

CURRENT QUESTION: {question}

ANSWER (with [n] citations):"""

        # Default model is gemini-2.5-pro — significantly better at
        # synthesising across many sources than 2.5-flash. Fall back to
        # 2.5-flash if pro hits a quota.
        try:
            model = _create_gemini_model(gemini_key, model_name)
            response = model.generate_content(prompt)
            answer_text = (response.text or '').strip()
            used_model = model_name
        except Exception as primary_err:
            try:
                model = _create_gemini_model(gemini_key, 'gemini-2.5-flash')
                response = model.generate_content(prompt)
                answer_text = (response.text or '').strip()
                used_model = 'gemini-2.5-flash'
            except Exception:
                raise primary_err

        return {
            "question": question,
            "answer": answer_text,
            "sources": sources,
            "model": used_model,
            "retrieval": {
                "candidates_considered": len(candidate_list),
                "context_used": len(context_articles),
                "keywords": keywords[:6],
                "proper_nouns": proper_nouns,
                "years": years,
            },
            "grounded": True,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Chat error: {str(e)}")


@router.post("/entities/{entity_text}/bio")
def generate_entity_bio(entity_text: str):
    """Generate a short AI bio for an entity based on articles mentioning it."""
    if not genai:
        raise HTTPException(500, "google-generativeai package not installed")
    gemini_key = _pick_gemini_key()
    if not gemini_key:
        raise HTTPException(500, "GEMINI_API_KEY not configured")

    try:
        from urllib.parse import unquote
        entity = unquote(entity_text)
        db = get_db()
        hits = db.search_by_entity(entity, limit=10) or []
        if not hits:
            raise HTTPException(404, f"No articles mention '{entity}'")

        blocks = []
        for i, a in enumerate(hits[:10], 1):
            pd = a.get('publication_date', '')
            if hasattr(pd, 'strftime'):
                date_str = pd.strftime('%b %d, %Y')
            else:
                date_str = str(pd)[:10]
            headline = (a.get('headline') or '').strip()
            excerpt = _strip_dateline(a.get('content') or a.get('content_preview') or '')[:400].strip()
            blocks.append(f"({date_str}) {headline}\n{excerpt}")

        prompt = f"""Based ONLY on the Dawn newspaper (Pakistan, 1990-1992) articles below, write a 3-4 sentence factual profile of "{entity}" — who or what they are, their role in these articles, and the main events they were associated with. Do not invent details that are not in the articles.

ARTICLES:
{chr(10).join(blocks)}

Profile:"""

        model = _create_gemini_model(gemini_key, 'gemini-2.5-flash')
        response = model.generate_content(prompt)
        return {
            "entity": entity,
            "bio": response.text.strip(),
            "source_count": len(hits),
            "model": "gemini-2.5-flash",
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Bio generation failed: {str(e)}")


@router.delete("/articles/{article_id}")
def delete_article(article_id: str):
    """
    Delete a specific article by ID.
    """
    try:
        db = get_db()
        
        # Check if article exists
        article = db.get_article(article_id)
        if not article:
            raise HTTPException(404, "Article not found")
        
        # Delete the article
        success = db.delete_article(article_id)
        
        if success:
            return {
                "success": True,
                "message": f"Article {article_id} deleted successfully",
                "article_id": article_id
            }
        else:
            raise HTTPException(500, "Failed to delete article")
            
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Error deleting article: {str(e)}")

