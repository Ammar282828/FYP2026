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

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "AIzaSyCfNJ89hLJAPqrklHqk7sE-83czHYBIM_U")
if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)

router = APIRouter(prefix="/api/analytics", tags=["analytics"])


@router.get("/total-articles")
def count_articles():
    # counts how many articles are in the database
    try:
        db = get_db()
        count = 0
        for _ in db.db.collection('articles').stream():
            count += 1
        return {"total_articles": count}
    except Exception as e:
        raise HTTPException(500, f"Database error: {str(e)}")


@router.get("/articles-over-time")
def articles_over_time():
    # shows how many articles were published each month
    try:
        db = get_db()
        timeline = db.get_analytics_articles_over_time()
        return {"timeline": timeline}
    except Exception as e:
        raise HTTPException(500, f"Database error: {str(e)}")


@router.get("/sentiment-over-time")
def sentiment_over_time():
    # gets the sentiment (positive/negative) for articles over time
    try:
        db = get_db()
        timeline = db.get_analytics_sentiment_over_time()
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
    """Get top entities with proper error handling"""
    limit = min(limit, 100)
    try:
        db = get_db()
        entities = db.get_top_entities(entity_type=entity_type, limit=limit,
                                      start_date=start_date, end_date=end_date)
        return {"entities": entities}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Database error: {str(e)}")


@router.get("/sentiment-by-entity")
def sentiment_by_entity(entity_type: Optional[str] = None, limit: int = 20):
    # shows sentiment for each entity (like if Pakistan is mentioned positively or negatively)
    limit = min(limit, 100)
    try:
        db = get_db()
        entities = db.get_sentiment_by_entity(entity_type=entity_type, limit=limit)
        return {
            "entities": entities,
            "entity_type": entity_type
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
        pairs = db.get_entity_cooccurrence(entity_type=entity_type, min_count=min_count, limit=limit)

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
        topics = db.get_topic_distribution()

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

        articles_stream = db.db.collection('articles').limit(1000).stream()
        articles = [doc.to_dict() for doc in articles_stream]

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
        from datetime import datetime as dt
        from collections import defaultdict

        db = get_firestore_db()
        articles_query = db.db.collection('articles')

        if start_date:
            articles_query = articles_query.where('publication_date', '>=', dt.fromisoformat(start_date))
        if end_date:
            articles_query = articles_query.where('publication_date', '<=', dt.fromisoformat(end_date))

        period_sentiments = defaultdict(list)
        keyword_lower = keyword.lower()

        for article_doc in articles_query.stream():
            article = article_doc.to_dict()
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
                except:
                    continue

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
        
        # Query all articles (Firestore doesn't like range queries on publication_date)
        db = get_firestore_db()
        all_docs = db.db.collection('articles').stream()
        
        articles = []
        for doc in all_docs:
            data = doc.to_dict()
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
        # Generate summary with Gemini
        model = genai.GenerativeModel('gemini-2.0-flash')
        
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
