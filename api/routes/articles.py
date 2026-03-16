"""
Article-related API routes
"""

from fastapi import APIRouter, HTTPException
from typing import Optional
import os
from database.firestore_db import get_db
from utils.filters import filter_and_normalize_entities

# Topic IDs that are purely classified ads — tenders, job listings
_CLASSIFIED_TOPIC_IDS = {4, 5}

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

try:
    import google.generativeai as genai
except ImportError:
    genai = None


router = APIRouter(prefix="/api", tags=["articles"])


@router.get("/articles")
def list_articles(limit: int = 100, offset: int = 0):
    # returns a list of articles from the database
    # you can set how many to get and where to start from
    try:
        db = get_db()
        articles_ref = db.db.collection('articles').order_by('publication_date', direction='DESCENDING').limit(limit + offset)
        articles_docs = list(articles_ref.stream())

        articles_docs = articles_docs[offset:offset + limit]

        articles = []
        for doc in articles_docs:
            data = doc.to_dict()
            if _is_classified(data):
                continue
            data['content_preview'] = data.get('content', '')[:200]
            articles.append(data)

        return {"articles": articles}
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
    sort_by = request.get('sort_by', 'date')

    if not keyword or len(keyword) < 1:
        raise HTTPException(400, "Keyword is required and must be at least 1 character")

    if len(keyword) > 200:
        raise HTTPException(400, "Keyword must be less than 200 characters")

    try:
        db = get_db()
        articles = db.search_articles(keyword, limit=limit * 2)
        articles = [a for a in articles if not _is_classified(a)]

        total = len(articles)
        articles = articles[offset:offset + limit]

        articles_list = []
        for article in articles:
            article['content_preview'] = article.get('content', '')[:200]
            article['entities'] = filter_and_normalize_entities(article.get('entities', []))
            articles_list.append(article)

        if sort_by == 'date':
            articles_list.sort(key=lambda x: x.get('publication_date', ''), reverse=True)
        elif sort_by == 'date_asc':
            articles_list.sort(key=lambda x: x.get('publication_date', ''))
        elif sort_by == 'sentiment':
            articles_list.sort(key=lambda x: x.get('sentiment_score', 0), reverse=True)
        elif sort_by == 'sentiment_asc':
            articles_list.sort(key=lambda x: x.get('sentiment_score', 0))

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
        articles = db.search_by_entity(entity_name, limit=limit * 2)
        articles = [a for a in articles if not _is_classified(a)]

        total = len(articles)
        articles = articles[offset:offset + limit]

        articles_list = []
        for article in articles:
            article['content_preview'] = article.get('content', '')[:200]
            article['entities'] = filter_and_normalize_entities(article.get('entities', []))
            articles_list.append(article)

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

        gemini_key = os.getenv("GEMINI_API_KEY")
        if not gemini_key:
            raise HTTPException(500, "GEMINI_API_KEY not configured")

        genai.configure(api_key=gemini_key)

        try:
            model = genai.GenerativeModel('gemini-3-pro-preview')

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
                a['content_preview'] = (a.get('content') or '')[:200]
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

