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
try:
    from services.gemini_adapter import create_model as _create_gemini_model
except ImportError:
    _create_gemini_model = None


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
    m = int(month or now.month)
    d = int(day or now.day)
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
                data['content_preview'] = (data.get('content') or '')[:200]
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


@router.post("/chat/ask")
def ask_archive(request: dict):
    """
    Ask-the-Archive: natural-language Q&A grounded in article search.

    Body: { "question": "...", "max_context": 6 }
    """
    question = (request.get("question") or "").strip()
    if not question:
        raise HTTPException(400, "question is required")
    if not genai:
        raise HTTPException(500, "google-generativeai package not installed")
    gemini_key = os.getenv("GEMINI_API_KEY")
    if not gemini_key:
        raise HTTPException(500, "GEMINI_API_KEY not configured")

    max_context = min(int(request.get("max_context", 6)), 12)

    try:
        db = get_db()
        # Retrieve candidate articles via keyword search on the question terms
        terms = [t for t in question.split() if len(t) >= 4][:4]
        candidates: list = []
        seen = set()
        for term in terms:
            try:
                hits = db.search_articles(term, limit=10) or []
            except Exception:
                hits = []
            for h in hits:
                aid = h.get('id')
                if aid and aid not in seen:
                    seen.add(aid)
                    candidates.append(h)
                if len(candidates) >= max_context * 2:
                    break
            if len(candidates) >= max_context * 2:
                break

        # Rank by naive keyword overlap with question
        ql = question.lower()
        def _score(a):
            txt = ((a.get('headline') or '') + ' ' + (a.get('content_preview') or a.get('content') or '')).lower()
            return sum(1 for t in terms if t.lower() in txt) + (2 if any(w in txt for w in ql.split()) else 0)
        candidates.sort(key=_score, reverse=True)
        context_articles = candidates[:max_context]

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
            excerpt = (a.get('content') or a.get('content_preview') or '')[:500].strip()
            blocks.append(f"[{i}] ({date_str}) {headline}\n{excerpt}")
            sources.append({
                "id": a.get('id'),
                "headline": headline,
                "publication_date": date_str,
                "citation_index": i,
            })

        prompt = f"""You are a research assistant for the Dawn newspaper archive (Pakistan, 1990-1992).

Answer the user's question using ONLY the articles below. Cite each claim with [number] notation pointing to the article it came from. If the articles don't answer the question, say so honestly — do not make up facts.

ARTICLES:
{chr(10).join(blocks)}

QUESTION: {question}

Answer (with [#] citations):"""

        model = _create_gemini_model(gemini_key, 'gemini-2.5-flash')
        response = model.generate_content(prompt)
        return {
            "question": question,
            "answer": response.text.strip(),
            "sources": sources,
            "model": "gemini-2.5-flash",
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
    gemini_key = os.getenv("GEMINI_API_KEY")
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
            excerpt = (a.get('content') or a.get('content_preview') or '')[:400].strip()
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

