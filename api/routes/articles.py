"""
Article-related API routes
"""

from fastapi import APIRouter, HTTPException
from typing import Optional
from database.firestore_db import get_db


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
        articles = db.search_articles(keyword, limit=limit)

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
        articles = db.search_by_entity(entity_name, limit=limit)

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
