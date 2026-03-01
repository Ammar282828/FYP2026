"""
Story API routes for MediaScope.

Endpoints:
    GET  /api/stories/                     List stories
    GET  /api/stories/{story_id}           Get single story metadata
    GET  /api/stories/{story_id}/articles  Get all articles in a story
    POST /api/stories/generate             Trigger Gemini narrative generation
    POST /api/stories/{story_id}/assign    Manually assign an article to a story
"""

import os
from fastapi import APIRouter, HTTPException, BackgroundTasks
from typing import Optional

from database.firestore_db import get_db

try:
    import google.generativeai as genai
except ImportError:
    genai = None

router = APIRouter(prefix="/api/stories", tags=["stories"])


# ─── GET /api/stories/ ───────────────────────────────────────────────────────

@router.get("/")
def list_stories(
    limit: int = 20,
    offset: int = 0,
    topic_id: Optional[int] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None
):
    """
    List stories ordered by start_date descending.

    Query params:
      limit       Max results (default 20, max 100)
      offset      Pagination offset
      topic_id    Filter by BERTopic topic_id
      start_date  YYYY-MM-DD — stories that started on or after this date
      end_date    YYYY-MM-DD — stories that ended on or before this date
    """
    limit = min(limit, 100)
    try:
        db = get_db()
        stories = db.list_stories(
            limit=limit,
            offset=offset,
            topic_id=topic_id,
            start_date=start_date,
            end_date=end_date
        )
        return {"stories": stories, "count": len(stories), "offset": offset, "limit": limit}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")


# ─── GET /api/stories/{story_id} ─────────────────────────────────────────────

@router.get("/{story_id}")
def get_story(story_id: str):
    """Return full story metadata including key_entities and narrative."""
    try:
        db = get_db()
        story = db.get_story(story_id)
        if not story:
            raise HTTPException(status_code=404, detail=f"Story {story_id} not found")
        story.pop('_label_counts', None)
        return db._serialize_story(story)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")


# ─── GET /api/stories/{story_id}/articles ────────────────────────────────────

@router.get("/{story_id}/articles")
def get_story_articles(story_id: str):
    """
    Return all articles in a story, sorted chronologically.
    Each article includes a content_preview (first 200 chars).
    """
    try:
        db = get_db()
        story = db.get_story(story_id)
        if not story:
            raise HTTPException(status_code=404, detail=f"Story {story_id} not found")

        article_ids = story.get('article_ids', [])
        articles = []
        for article_id in article_ids:
            article = db.get_article(article_id)
            if article:
                article['content_preview'] = (article.get('content') or '')[:200]
                pub_date = article.get('publication_date')
                if pub_date and hasattr(pub_date, 'isoformat'):
                    article['publication_date'] = pub_date.isoformat()
                created_at = article.get('created_at')
                if created_at and hasattr(created_at, 'isoformat'):
                    article['created_at'] = created_at.isoformat()
                articles.append(article)

        articles.sort(key=lambda a: a.get('publication_date', ''))

        return {
            "story_id": story_id,
            "story_title": story.get('title', ''),
            "article_count": len(articles),
            "articles": articles
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")


# ─── POST /api/stories/generate ──────────────────────────────────────────────

@router.post("/generate")
def generate_story_narrative(request: dict, background_tasks: BackgroundTasks):
    """
    Trigger Gemini narrative generation for a story.

    Request body: { "story_id": "...", "force": false }

    Returns cached narrative if it exists and force=false.
    Otherwise, launches background generation and returns immediately.
    Poll GET /api/stories/{story_id} for the result.
    """
    story_id = request.get('story_id')
    force = request.get('force', False)

    if not story_id:
        raise HTTPException(status_code=400, detail="story_id is required")

    if not genai:
        raise HTTPException(status_code=500, detail="google-generativeai package not installed")

    gemini_key = os.getenv("GEMINI_API_KEY")
    if not gemini_key:
        raise HTTPException(status_code=500, detail="GEMINI_API_KEY not configured")

    try:
        db = get_db()
        story = db.get_story(story_id)
        if not story:
            raise HTTPException(status_code=404, detail=f"Story {story_id} not found")

        if story.get('narrative') and not force:
            return {
                "story_id": story_id,
                "status": "cached",
                "narrative": story['narrative'],
                "generated_at": str(story.get('narrative_generated_at', ''))
            }

        if story.get('article_count', 0) < 2:
            raise HTTPException(
                status_code=400,
                detail="Story needs at least 2 articles to generate a narrative"
            )

        background_tasks.add_task(_generate_narrative_background, story_id, gemini_key)

        return {
            "story_id": story_id,
            "status": "generating",
            "message": "Narrative generation started. Poll GET /api/stories/{story_id} for result."
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error: {str(e)}")


def _generate_narrative_background(story_id: str, gemini_key: str):
    """Background task: fetch articles, build prompt, write Gemini narrative to Firestore."""
    try:
        from datetime import datetime as dt
        from firebase_admin import firestore as fs

        db = get_db()
        story = db.get_story(story_id)
        if not story:
            print(f"[ERROR] Narrative gen: story {story_id} not found")
            return

        articles = []
        for aid in story.get('article_ids', []):
            a = db.get_article(aid)
            if a:
                articles.append(a)

        articles.sort(key=lambda a: (
            a['publication_date'].isoformat()
            if hasattr(a.get('publication_date'), 'isoformat')
            else str(a.get('publication_date', ''))
        ))

        prompt = _build_narrative_prompt(story, articles)

        genai.configure(api_key=gemini_key)
        model = genai.GenerativeModel('gemini-1.5-flash')
        response = model.generate_content(prompt)
        narrative = response.text.strip()

        db.db.collection('stories').document(story_id).update({
            'narrative': narrative,
            'narrative_generated_at': fs.SERVER_TIMESTAMP
        })
        print(f"[OK] Narrative generated for story {story_id} ({len(narrative)} chars)")

    except Exception as e:
        import traceback
        print(f"[ERROR] Narrative generation failed for {story_id}: {e}")
        traceback.print_exc()


def _build_narrative_prompt(story: dict, articles: list) -> str:
    """Build the story arc prompt for Gemini."""
    article_blocks = []
    for i, article in enumerate(articles, 1):
        pub_date = article.get('publication_date', '')
        if hasattr(pub_date, 'strftime'):
            date_str = pub_date.strftime('%B %d, %Y')
        else:
            date_str = str(pub_date)[:10]

        headline = (article.get('headline') or 'Untitled').strip()
        excerpt = (article.get('content') or '')[:800].strip()

        article_blocks.append(
            f"--- Article {i} | {date_str} ---\n"
            f"Headline: {headline}\n"
            f"Excerpt:\n{excerpt}"
        )

    timeline_text = "\n\n".join(article_blocks)

    key_entities = story.get('key_entities', [])
    entity_summary = ", ".join(
        f"{e['text'].title()} ({e['type']})" for e in key_entities[:8]
    )

    topic_label = story.get('topic_label', 'Unknown Topic')
    date_span = story.get('date_span_days', 0)

    return f"""You are a historian analyzing the Dawn newspaper archive from the early 1990s.

You have been given {len(articles)} articles published over {date_span} days, all covering the same ongoing event.

Key entities involved: {entity_summary}
Topic category: {topic_label}

ARTICLES IN CHRONOLOGICAL ORDER:

{timeline_text}

---

Your task is to write a STORY ARC — not a summary — that captures how this event developed over time.

The story arc must include:

1. **Opening**: What was the initial situation or trigger? When and how did this story begin? (2-3 sentences)

2. **Development**: How did the event evolve? What new actors, complications, or escalations emerged? Describe the progression, not a list of facts. (3-5 sentences)

3. **Turning Points**: Were there moments of significant change — a declaration, a decision, an escalation, a de-escalation? What shifted? (2-3 sentences)

4. **Tone Shift**: How did the newspaper's framing or tone change across the articles? Did coverage become more alarmed, optimistic, or analytical? (1-2 sentences)

5. **Conclusion or Ongoing Status**: How did the story end in this archive's coverage, or was it still unresolved? What questions remained open? (2-3 sentences)

Write in the style of a concise historical narrative. Use active voice. Reference specific dates and named actors from the articles. Do not use bullet points — write in flowing paragraphs.

Story Arc:"""


# ─── POST /api/stories/{story_id}/assign ─────────────────────────────────────

@router.post("/{story_id}/assign")
def manually_assign_article(story_id: str, request: dict):
    """
    Manually add an article to a story (editor override).

    Request body: { "article_id": "..." }
    """
    article_id = request.get('article_id')
    if not article_id:
        raise HTTPException(status_code=400, detail="article_id is required")

    try:
        db = get_db()
        story = db.get_story(story_id)
        if not story:
            raise HTTPException(status_code=404, detail=f"Story {story_id} not found")

        article = db.get_article(article_id)
        if not article:
            raise HTTPException(status_code=404, detail=f"Article {article_id} not found")

        db.add_article_to_story(story_id, article)
        return {
            "success": True,
            "story_id": story_id,
            "article_id": article_id
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error: {str(e)}")
