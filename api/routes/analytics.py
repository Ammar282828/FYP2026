"""
Analytics-related API routes
"""

from fastapi import APIRouter, HTTPException
from typing import Optional
from datetime import datetime
from database.firestore_db import get_db, get_firestore_db
import os
import google.generativeai as genai
from collections import Counter
from services.gemini_adapter import create_model as _create_gemini_model

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "").strip()
if not GEMINI_API_KEY:
    print("[WARNING] GEMINI_API_KEY not set — AI-powered analytics endpoints will be unavailable")

router = APIRouter(prefix="/api/analytics", tags=["analytics"])

# In-memory cache for heavy full-scan endpoints
import time as _time
_endpoint_cache: dict = {}
_endpoint_cache_ts: dict = {}
_CACHE_TTL = 3600  # 1 hour

def _cached(key, fn):
    if key in _endpoint_cache and _time.time() - _endpoint_cache_ts.get(key, 0) < _CACHE_TTL:
        return _endpoint_cache[key]
    result = fn()
    _endpoint_cache[key] = result
    _endpoint_cache_ts[key] = _time.time()
    return result


@router.get("/data-version")
def get_data_version():
    """
    Returns the article count plus the publication-date span of the corpus.

    The frontend uses `article_count` as a cache-buster and `min_date` / `max_date`
    to seed date-picker defaults instead of hardcoding 1990-01-01 / 1992-12-31.
    """
    try:
        db = get_firestore_db()
        count = db.get_article_count()

        # Derive min/max publication_date from the in-memory snapshot so this
        # endpoint stays fast even on cold starts (it's already populated by
        # any other analytics call).
        min_date = None
        max_date = None
        try:
            articles = db._get_articles_snapshot()
            for a in articles:
                pub = a.get('publication_date')
                if not pub:
                    continue
                if hasattr(pub, 'isoformat'):
                    iso = pub.isoformat()[:10]
                elif isinstance(pub, str):
                    iso = pub[:10]
                else:
                    continue
                if min_date is None or iso < min_date:
                    min_date = iso
                if max_date is None or iso > max_date:
                    max_date = iso
        except Exception as inner:
            # If the snapshot isn't available we still want to return the count.
            print(f"[data-version] could not derive date range: {inner}")

        return {
            "article_count": count,
            "version": str(count),
            "min_date": min_date,
            "max_date": max_date,
        }
    except Exception as e:
        raise HTTPException(500, f"Failed to get data version: {str(e)}")


@router.get("/sentiment-overview")
def sentiment_overview():
    """
    Aggregate sentiment counts across the corpus.

    Returns: { positive, neutral, negative, total }

    This replaces the legacy postgres-era /sentiment-fixed endpoint. It folds
    the monthly sentiment-over-time series so we don't pay a second full scan.
    """
    try:
        db = get_db()
        timeline = _cached("sentiment_over_time", lambda: db.get_analytics_sentiment_over_time())
        totals = {"positive": 0, "neutral": 0, "negative": 0}
        for row in timeline or []:
            totals["positive"] += int(row.get("positive", 0) or 0)
            totals["neutral"] += int(row.get("neutral", 0) or 0)
            totals["negative"] += int(row.get("negative", 0) or 0)
        totals["total"] = totals["positive"] + totals["neutral"] + totals["negative"]
        return totals
    except Exception as e:
        raise HTTPException(500, f"Database error: {str(e)}")


@router.get("/total-articles")
def count_articles():
    # counts how many articles are in the database
    try:
        db = get_db()
        # Uses cached count when available; otherwise reads from the
        # warm snapshot if present, falling back to a metadata-only stream.
        return {"total_articles": db.get_article_count()}
    except Exception as e:
        raise HTTPException(500, f"Database error: {str(e)}")


@router.get("/articles-over-time")
def articles_over_time():
    # shows how many articles were published each month
    try:
        db = get_db()
        timeline = _cached("articles_over_time", lambda: db.get_analytics_articles_over_time())
        return {"timeline": timeline}
    except Exception as e:
        raise HTTPException(500, f"Database error: {str(e)}")


@router.get("/articles-by-day")
def articles_by_day():
    """
    Daily article counts across the corpus, used by the calendar heatmap.

    Returns: { "days": [{"date": "1990-01-15", "count": 12}, ...] }
    Sorted ascending. Days with zero articles are omitted (the heatmap fills them).
    """
    def _compute():
        from collections import Counter
        db = get_db()
        articles = db._get_articles_snapshot()
        counts: Counter = Counter()
        for data in articles:
            # Calendar heatmap should reflect *visible* articles, not the
            # raw doc count — otherwise the days with the most OCR-noise
            # junk light up brightest, which is exactly the wrong signal.
            if data.get('low_quality'):
                continue
            pub = data.get('publication_date')
            if not pub:
                continue
            if hasattr(pub, 'strftime'):
                key = pub.strftime('%Y-%m-%d')
            elif isinstance(pub, str):
                key = pub[:10]
            else:
                continue
            counts[key] += 1
        days = [{"date": d, "count": c} for d, c in sorted(counts.items())]
        return {"days": days, "total": sum(counts.values())}

    try:
        return _cached("articles_by_day", _compute)
    except Exception as e:
        raise HTTPException(500, f"Database error: {str(e)}")


@router.get("/sentiment-over-time")
def sentiment_over_time():
    # gets the sentiment (positive/negative) for articles over time
    try:
        db = get_db()
        timeline = _cached("sentiment_over_time", lambda: db.get_analytics_sentiment_over_time())
        return {"timeline": timeline}
    except Exception as e:
        raise HTTPException(500, f"Database error: {str(e)}")


@router.get("/top-keywords")
def top_keywords(limit: int = 30):
    # returns the most common keywords found in articles
    limit = min(limit, 100)
    try:
        db = get_db()
        keywords = db.get_top_keywords(limit=limit)
        return {"keywords": keywords}
    except Exception as e:
        raise HTTPException(500, f"Database error: {str(e)}")


@router.get("/top-entities-fixed")
# gets the most mentioned entities like people, places, organizations
# you can filter by type and date range
def top_entities(entity_type: Optional[str] = None, limit: int = 15,
                start_date: Optional[str] = None, end_date: Optional[str] = None):
    """Get top entities with proper error handling.

    Cache strategy: always compute limit=100 internally and slice to the
    requested limit on the way out. Different `limit=` values from the
    UI (12, 15, 20, 30…) used to each be a separate cache miss; now
    they all share one warm entry per (entity_type, date-range).
    """
    requested_limit = min(max(limit, 1), 100)
    try:
        db = get_db()
        # Note: NO `limit` in the cache key.
        key = f"top_entities:{entity_type}:{start_date}:{end_date}"
        entities = _cached(key, lambda: db.get_top_entities(
            entity_type=entity_type, limit=100,
            start_date=start_date, end_date=end_date))
        return {"entities": (entities or [])[:requested_limit]}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Database error: {str(e)}")


@router.get("/sentiment-by-entity")
def sentiment_by_entity(entity_type: Optional[str] = None, limit: int = 20):
    # shows sentiment for each entity (like if Pakistan is mentioned positively or negatively)
    requested_limit = min(max(limit, 1), 100)
    try:
        db = get_db()
        # Same trick: cache the limit=100 version and slice on read so
        # any limit value the UI requests gets served from the same
        # warm entry.
        key = f"sentiment_by_entity:{entity_type}"
        entities = _cached(key, lambda: db.get_sentiment_by_entity(
            entity_type=entity_type, limit=100))
        return {
            "entities": (entities or [])[:requested_limit],
            "entity_type": entity_type,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Database error: {str(e)}")


@router.get("/entity-cooccurrence")
def entity_cooccurrence(entity_type: Optional[str] = None, min_count: int = 3, limit: int = 50):
    # finds which entities appear together in the same articles
    # like if India and Pakistan are mentioned together a lot
    limit = min(limit, 200)
    try:
        db = get_db()
        key = f"entity_cooccurrence:{entity_type}:{min_count}:{limit}"
        pairs = _cached(key, lambda: db.get_entity_cooccurrence(
            entity_type=entity_type, min_count=min_count, limit=limit))

        return {
            "pairs": pairs,
            "entity_type": entity_type,
            "min_count": min_count
        }
    except Exception as e:
        raise HTTPException(500, f"Database error: {str(e)}")


@router.get("/topic-distribution")
def topic_distribution():
    # shows what topics articles are about and how many articles per topic
    try:
        db = get_db()
        topics = _cached("topic_distribution", lambda: db.get_topic_distribution())

        return {
            "topics": topics,
            "total_topics": len(topics)
        }
    except Exception as e:
        raise HTTPException(500, f"Database error: {str(e)}")


@router.post("/keyword-trend")
def keyword_trend(request: dict):
    # tracks how often certain keywords appear over time
    # useful for seeing if something became more popular
    keywords = request.get('keywords', [])
    start_date = request.get('start_date')
    end_date = request.get('end_date')

    if not keywords or not isinstance(keywords, list):
        raise HTTPException(400, "Keywords must be a non-empty list")

    if not start_date or not end_date:
        raise HTTPException(400, "start_date and end_date are required")

    try:
        from collections import defaultdict

        db = get_db()

        from datetime import timezone
        start = datetime.fromisoformat(start_date.replace('Z', '+00:00'))
        if start.tzinfo is None:
            start = start.replace(tzinfo=timezone.utc)
        end = datetime.fromisoformat(end_date.replace('Z', '+00:00'))
        if end.tzinfo is None:
            end = end.replace(tzinfo=timezone.utc)

        # Was `.limit(1000).stream()` — silently returned an arbitrary
        # 1k subset of the corpus (now 36k+), so trend charts were
        # showing ~3% of the actual signal. Use the snapshot like every
        # other analytics endpoint so the answer reflects the whole
        # corpus and avoids the SDK retry crash on full-collection scans.
        articles = db._get_articles_snapshot()

        trends = {}
        for keyword in keywords[:5]:
            date_counts = defaultdict(int)

            for data in articles:
                pub_date = data.get('publication_date')

                if not pub_date:
                    continue

                if isinstance(pub_date, str):
                    pub_date = datetime.fromisoformat(pub_date.replace('Z', '+00:00'))

                if pub_date.tzinfo is None:
                    pub_date = pub_date.replace(tzinfo=timezone.utc)

                if not (start <= pub_date <= end):
                    continue

                entities = data.get('entities', [])
                keyword_found = False

                for entity in entities:
                    entity_text = entity.get('text', '')
                    if keyword.lower() in entity_text.lower():
                        keyword_found = True
                        break

                if not keyword_found:
                    content = data.get('content', '') + ' ' + data.get('headline', '')
                    if keyword.lower() in content.lower():
                        keyword_found = True

                if keyword_found:
                    date_key = pub_date.strftime('%Y-%m-%d')
                    date_counts[date_key] += 1

            trends[keyword] = [
                {"date": date, "count": count}
                for date, count in sorted(date_counts.items())
            ]

        return {"trends": trends}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Database error: {str(e)}")


@router.get("/entity-sentiment-over-time")
    # shows how sentiment about a specific entity changed over time
def get_entity_sentiment_over_time(
    entity: str,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    granularity: str = 'month'
):
    """Get average sentiment for articles mentioning an entity over time"""
    try:
        db = get_firestore_db()
        data = db.get_entity_mentions_over_time(entity, start_date, end_date, granularity)
        return {"entity": entity, "data": data}
    except Exception as e:
        raise HTTPException(500, f"Failed to get entity sentiment: {str(e)}")


@router.get("/keyword-sentiment-over-time")
    # gets average sentiment for articles that mention a keyword over time
def get_keyword_sentiment_over_time(
    keyword: str,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    granularity: str = 'month'
):
    """Get average sentiment for articles containing a keyword over time"""
    try:
        from datetime import datetime as dt, timezone
        from collections import defaultdict

        db = get_firestore_db()

        # Use the shared snapshot rather than streaming the live
        # collection — the live `.stream()` hits the SDK retry crash
        # past ~30k docs (same bug as topics + articles snapshot).
        articles = db._get_articles_snapshot()

        sd = dt.fromisoformat(start_date) if start_date else None
        ed = dt.fromisoformat(end_date) if end_date else None
        def _naive(d):
            if d is None: return None
            if hasattr(d, 'tzinfo') and d.tzinfo is not None:
                return d.astimezone(timezone.utc).replace(tzinfo=None)
            return d
        sd, ed = _naive(sd), _naive(ed)

        period_sentiments = defaultdict(list)
        keyword_lower = keyword.lower()

        for article in articles:
            if article.get('low_quality'):
                continue
            pub_date = article.get('publication_date')
            sentiment_score = article.get('sentiment_score')
            content = article.get('content', '') + ' ' + article.get('headline', '')

            if not pub_date or sentiment_score is None:
                continue

            if keyword_lower not in content.lower():
                continue

            if hasattr(pub_date, 'strftime'):
                date_obj = pub_date
            else:
                try:
                    date_obj = dt.fromisoformat(str(pub_date).replace('Z', '+00:00'))
                except Exception:
                    continue

            date_naive = _naive(date_obj)
            if sd and date_naive < sd: continue
            if ed and date_naive > ed: continue

            if granularity == 'year':
                period = date_obj.strftime('%Y')
            elif granularity == 'month':
                period = date_obj.strftime('%Y-%m')
            else:
                period = date_obj.strftime('%Y-%m-%d')

            period_sentiments[period].append(sentiment_score)

        trends = []
        for period in sorted(period_sentiments.keys()):
            scores = period_sentiments[period]
            avg_sentiment = sum(scores) / len(scores) if scores else 0
            trends.append({
                'period': period,
                'avg_sentiment': round(avg_sentiment, 3),
                'article_count': len(scores)
            })

        return {
            "keyword": keyword,
            "granularity": granularity,
            "trends": trends
        }

    except Exception as e:
        raise HTTPException(500, f"Failed to get keyword sentiment: {str(e)}")


@router.get("/keyword-frequency-over-time")
    # counts how many times a keyword was mentioned in different time periods
def get_keyword_frequency_over_time(
    keyword: str,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    granularity: str = 'month'
):
    """Get keyword mention frequency over time"""
    try:
        db = get_firestore_db()
        data = db.get_keyword_frequency_over_time(keyword, start_date, end_date, granularity)
        return {"keyword": keyword, "data": data}
    except Exception as e:
        raise HTTPException(500, f"Failed to get keyword frequency: {str(e)}")


@router.get("/entity-mentions-over-time")
    # tracks how often an entity is mentioned over time with sentiment info
def get_entity_mentions_over_time(
    entity: str,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    granularity: str = 'month'
):
    """Get entity mention frequency over time with sentiment"""
    try:
        db = get_firestore_db()
        data = db.get_entity_mentions_over_time(entity, start_date, end_date, granularity)
        return {"entity": entity, "data": data}
    except Exception as e:
        raise HTTPException(500, f"Failed to get entity mentions: {str(e)}")


@router.get("/compare-entities")
    # compares multiple entities side by side
    # like comparing mentions of different countries or people
def compare_entities(
    entities: str,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None
):
    """Compare multiple entities across various metrics"""
    try:
        db = get_firestore_db()
        entity_list = [e.strip() for e in entities.split(',')]
        if len(entity_list) > 5:
            raise HTTPException(400, "Maximum 5 entities allowed for comparison")
        data = db.compare_entities(entity_list, start_date, end_date)
        return {"entities": entity_list, "comparison": data}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Failed to compare entities: {str(e)}")


@router.get("/topic-volume-over-time")
    # shows how much each topic was discussed in different time periods
def get_topic_volume_over_time(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    granularity: str = 'month'
):
    """Get topic distribution over time"""
    try:
        db = get_firestore_db()
        data = db.get_topic_volume_over_time(start_date, end_date, granularity)
        return {"data": data}
    except Exception as e:
        raise HTTPException(500, f"Failed to get topic volume: {str(e)}")


@router.get("/location-analytics")
def get_location_analytics(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None
):
    """Get geographic analytics"""
    # gets analytics data about different locations and places
    try:
        db = get_firestore_db()
        data = db.get_location_analytics(start_date, end_date)
        return data
    except Exception as e:
        raise HTTPException(500, f"Failed to get location analytics: {str(e)}")


@router.get("/word-count-distribution")
def word_count_distribution():
    """Returns article counts bucketed by word count ranges."""
    def _compute():
        db = get_db()
        articles = db._get_articles_snapshot()
        buckets = {"0-100": 0, "100-300": 0, "300-500": 0, "500-1000": 0,
                   "1000-2000": 0, "2000-5000": 0, "5000+": 0}
        total_words = 0
        count = 0
        for data in articles:
            wc = data.get('word_count', 0) or 0
            total_words += wc
            count += 1
            if wc < 100: buckets["0-100"] += 1
            elif wc < 300: buckets["100-300"] += 1
            elif wc < 500: buckets["300-500"] += 1
            elif wc < 1000: buckets["500-1000"] += 1
            elif wc < 2000: buckets["1000-2000"] += 1
            elif wc < 5000: buckets["2000-5000"] += 1
            else: buckets["5000+"] += 1
        avg = round(total_words / count) if count else 0
        return {"buckets": buckets, "average_word_count": avg, "total_articles": count}
    try:
        return _cached("word_count_dist", _compute)
    except Exception as e:
        raise HTTPException(500, f"Database error: {str(e)}")


@router.get("/page-distribution")
def page_distribution():
    """Returns article counts grouped by page number."""
    def _compute():
        db = get_db()
        articles = db._get_articles_snapshot()
        pages: dict = {}
        for data in articles:
            page = data.get('page_number') or data.get('page') or 'Unknown'
            page_str = str(page)
            pages[page_str] = pages.get(page_str, 0) + 1
        def sort_key(k):
            try: return (0, int(k))
            except ValueError: return (1, k)
        sorted_pages = dict(sorted(pages.items(), key=lambda x: sort_key(x[0])))
        return {"pages": sorted_pages}
    try:
        return _cached("page_dist", _compute)
    except Exception as e:
        raise HTTPException(500, f"Database error: {str(e)}")


@router.get("/source-distribution")
def source_distribution():
    """Returns article counts and sentiment breakdown per newspaper source."""
    def _compute():
        db = get_db()
        articles = db._get_articles_snapshot()
        sources: dict = {}
        for data in articles:
            source = data.get('source') or data.get('newspaper') or 'Unknown'
            if source not in sources:
                sources[source] = {"count": 0, "positive": 0, "neutral": 0, "negative": 0}
            sources[source]["count"] += 1
            sentiment = (data.get('sentiment') or 'neutral').lower()
            if sentiment in ('positive', 'neutral', 'negative'):
                sources[source][sentiment] += 1
            else:
                sources[source]["neutral"] += 1
        sorted_sources = dict(sorted(sources.items(), key=lambda x: x[1]["count"], reverse=True))
        return {"sources": sorted_sources, "total_sources": len(sorted_sources)}
    try:
        return _cached("source_dist", _compute)
    except Exception as e:
        raise HTTPException(500, f"Database error: {str(e)}")


@router.post("/ai-summary")
def generate_date_range_summary(request: dict):
    """Generate AI-powered summary for articles in date range"""
    try:
        from datetime import datetime as dt, timezone
        print("[AI-SUMMARY] Starting...")
        
        start_date_str = request.get("start_date", "1990-01-01")
        end_date_str = request.get("end_date", "2030-12-31")
        topic_filter = request.get("topic")
        
        # Convert string dates to timezone-aware datetime objects for filtering
        start_date = dt.fromisoformat(start_date_str.replace('Z', '+00:00'))
        end_date = dt.fromisoformat(end_date_str.replace('Z', '+00:00'))
        
        # Ensure timezone awareness
        if start_date.tzinfo is None:
            start_date = start_date.replace(tzinfo=timezone.utc)
        if end_date.tzinfo is None:
            end_date = end_date.replace(tzinfo=timezone.utc)
        
        print(f"[AI-SUMMARY] Date range: {start_date_str} to {end_date_str}")
        
        # Query all articles (Firestore doesn't like range queries on publication_date).
        # Uses the shared in-memory snapshot so we don't re-stream the whole
        # collection for every AI-summary request.
        db = get_firestore_db()
        all_articles = db._get_articles_snapshot()

        articles = []
        for data in all_articles:
            pub_date = data.get('publication_date')
            
            # Filter by date range in Python
            if pub_date and start_date <= pub_date <= end_date:
                if topic_filter and data.get('topic_label') != topic_filter:
                    continue
                articles.append(data)
        
        print(f"[AI-SUMMARY] Found {len(articles)} articles")
        
        if not articles:
            return {
                "summary": "No articles found in the specified date range.",
                "article_count": 0,
                "sentiment_breakdown": {},
                "top_entities": []
            }
        
        # Extract key information
        sentiments = [a.get('sentiment', 'neutral') for a in articles]
        sentiment_counts = Counter(sentiments)
        
        # Extract entities (handle both dict and string formats)
        all_entities = []
        for article in articles:
            entities = article.get('entities', [])
            if isinstance(entities, list):
                for ent in entities:
                    if isinstance(ent, dict):
                        # Extract entity name from dict
                        entity_name = ent.get('text') or ent.get('name') or ent.get('entity')
                        if entity_name:
                            all_entities.append(entity_name)
                    elif isinstance(ent, str):
                        all_entities.append(ent)
        
        entity_counts = Counter(all_entities)
        top_entities = [{"entity": ent, "count": count} for ent, count in entity_counts.most_common(10)]
        
        print(f"[AI-SUMMARY] Building context with {len(top_entities)} entities")
        
        # Build context for Gemini
        sample_articles = articles[:5]
        context = f"Date Range: {start_date_str} to {end_date_str}\n"
        context += f"Total Articles: {len(articles)}\n"
        context += f"Sentiment Distribution: {dict(sentiment_counts)}\n"
        context += f"Top Entities: {[e['entity'] for e in top_entities[:10]]}\n\n"
        context += "Sample Headlines:\n"
        for i, a in enumerate(sample_articles, 1):
            context += f"{i}. {a.get('headline', 'Untitled')}\n"
        
        print("[AI-SUMMARY] Calling Gemini...")
        # Generate summary with Gemini (auto-detects key type)
        model = _create_gemini_model(GEMINI_API_KEY, 'gemini-2.5-flash')
        
        prompt = f"""You are analyzing newspaper articles from {start_date_str} to {end_date_str}.

{context}

Please provide a comprehensive summary (4-6 paragraphs) covering:
1. Main themes and topics discussed
2. Key events and developments
3. Notable trends and patterns
4. Significant entities and their roles
5. Overall sentiment and tone of coverage

Be specific and reference the data provided above."""

        response = model.generate_content(prompt)
        summary = response.text
        print(f"[AI-SUMMARY] Got summary: {len(summary)} chars")
        
        return {
            "summary": summary,
            "article_count": len(articles),
            "sentiment_breakdown": dict(sentiment_counts),
            "top_entities": top_entities
        }
        
    except Exception as e:
        print(f"[AI-SUMMARY] ERROR: {str(e)}")
        raise HTTPException(500, f"Failed to generate summary: {str(e)}")
