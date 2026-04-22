"""
Bookmarks API routes - save, list, and remove bookmarked articles.
"""

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional
from datetime import datetime
import uuid
from database.firestore_db import get_firestore_db
from api.routes.auth import get_current_user, get_optional_user

router = APIRouter(prefix="/api/bookmarks", tags=["bookmarks"])


class BookmarkRequest(BaseModel):
    article_id: str
    note: Optional[str] = None
    tags: Optional[list] = None
    collection: Optional[str] = None


class BookmarkUpdateRequest(BaseModel):
    note: Optional[str] = None
    tags: Optional[list] = None
    collection: Optional[str] = None


class SavedSearchRequest(BaseModel):
    name: str
    query: str
    filters: Optional[dict] = None


class AnnotationRequest(BaseModel):
    article_id: str
    text: str
    note: Optional[str] = None
    start_offset: Optional[int] = None
    end_offset: Optional[int] = None
    color: Optional[str] = "yellow"


@router.post("/")
def add_bookmark(req: BookmarkRequest, user=Depends(get_current_user)):
    """Bookmark an article."""
    db = get_firestore_db()

    # Check if already bookmarked
    existing = list(
        db.db.collection('bookmarks')
        .where('user_id', '==', user['user_id'])
        .where('article_id', '==', req.article_id)
        .limit(1)
        .stream()
    )
    if existing:
        raise HTTPException(400, "Article already bookmarked")

    # Verify article exists and get its headline
    article_doc = db.db.collection('articles').document(req.article_id).get()
    if not article_doc.exists:
        raise HTTPException(404, "Article not found")

    article_data = article_doc.to_dict()

    bookmark_id = str(uuid.uuid4())
    bookmark_doc = {
        'id': bookmark_id,
        'user_id': user['user_id'],
        'article_id': req.article_id,
        'article_headline': article_data.get('headline', 'No headline'),
        'article_date': str(article_data.get('publication_date', ''))[:10],
        'article_sentiment': article_data.get('sentiment_label', 'neutral'),
        'article_topic': article_data.get('topic_label', ''),
        'note': req.note or '',
        'tags': req.tags or [],
        'collection': req.collection or '',
        'created_at': datetime.utcnow()
    }

    db.db.collection('bookmarks').document(bookmark_id).set(bookmark_doc)

    # Increment user bookmark count
    user_ref = db.db.collection('users').document(user['user_id'])
    user_doc = user_ref.get()
    if user_doc.exists:
        current_count = user_doc.to_dict().get('bookmark_count', 0)
        user_ref.update({'bookmark_count': current_count + 1})

    return {"id": bookmark_id, "status": "bookmarked"}


@router.get("/")
def list_bookmarks(limit: int = 50, user=Depends(get_current_user)):
    """List all bookmarks for the current user."""
    db = get_firestore_db()
    limit = min(limit, 200)

    bookmarks_query = (
        db.db.collection('bookmarks')
        .where('user_id', '==', user['user_id'])
        .limit(limit)
    )

    bookmarks = []
    for doc in bookmarks_query.stream():
        data = doc.to_dict()
        bookmarks.append({
            'id': data['id'],
            'article_id': data['article_id'],
            'article_headline': data.get('article_headline', ''),
            'article_date': data.get('article_date', ''),
            'article_sentiment': data.get('article_sentiment', 'neutral'),
            'article_topic': data.get('article_topic', ''),
            'note': data.get('note', ''),
            'tags': data.get('tags', []),
            'collection': data.get('collection', ''),
            'created_at': str(data.get('created_at', ''))
        })

    # Sort by created_at descending (newest first)
    bookmarks.sort(key=lambda x: x['created_at'], reverse=True)

    return {"bookmarks": bookmarks, "count": len(bookmarks)}


@router.delete("/{bookmark_id}")
def remove_bookmark(bookmark_id: str, user=Depends(get_current_user)):
    """Remove a bookmark."""
    db = get_firestore_db()

    bookmark_doc = db.db.collection('bookmarks').document(bookmark_id).get()
    if not bookmark_doc.exists:
        raise HTTPException(404, "Bookmark not found")

    data = bookmark_doc.to_dict()
    if data.get('user_id') != user['user_id']:
        raise HTTPException(403, "Not your bookmark")

    db.db.collection('bookmarks').document(bookmark_id).delete()

    # Decrement user bookmark count
    user_ref = db.db.collection('users').document(user['user_id'])
    user_doc = user_ref.get()
    if user_doc.exists:
        current_count = user_doc.to_dict().get('bookmark_count', 0)
        user_ref.update({'bookmark_count': max(0, current_count - 1)})

    return {"status": "removed"}


@router.delete("/article/{article_id}")
def remove_bookmark_by_article(article_id: str, user=Depends(get_current_user)):
    """Remove a bookmark by article ID (convenience endpoint)."""
    db = get_firestore_db()

    bookmarks = list(
        db.db.collection('bookmarks')
        .where('user_id', '==', user['user_id'])
        .where('article_id', '==', article_id)
        .limit(1)
        .stream()
    )

    if not bookmarks:
        raise HTTPException(404, "Bookmark not found")

    bookmark_data = bookmarks[0].to_dict()
    db.db.collection('bookmarks').document(bookmark_data['id']).delete()

    # Decrement
    user_ref = db.db.collection('users').document(user['user_id'])
    user_doc = user_ref.get()
    if user_doc.exists:
        current_count = user_doc.to_dict().get('bookmark_count', 0)
        user_ref.update({'bookmark_count': max(0, current_count - 1)})

    return {"status": "removed"}


@router.get("/check/{article_id}")
def check_bookmark(article_id: str, user=Depends(get_optional_user)):
    """Check if an article is bookmarked by the current user."""
    if not user:
        return {"bookmarked": False, "bookmark_id": None}

    db = get_firestore_db()
    bookmarks = list(
        db.db.collection('bookmarks')
        .where('user_id', '==', user['user_id'])
        .where('article_id', '==', article_id)
        .limit(1)
        .stream()
    )

    if bookmarks:
        data = bookmarks[0].to_dict()
        return {"bookmarked": True, "bookmark_id": data['id']}

    return {"bookmarked": False, "bookmark_id": None}


@router.get("/ids")
def get_bookmark_ids(user=Depends(get_current_user)):
    """Get all bookmarked article IDs for the current user (for bulk checking)."""
    db = get_firestore_db()

    bookmarks = db.db.collection('bookmarks').where('user_id', '==', user['user_id']).stream()
    ids = [doc.to_dict().get('article_id') for doc in bookmarks]

    return {"article_ids": ids}


@router.patch("/{bookmark_id}")
def update_bookmark(bookmark_id: str, req: BookmarkUpdateRequest, user=Depends(get_current_user)):
    """Update note / tags / collection on an existing bookmark."""
    db = get_firestore_db()
    ref = db.db.collection('bookmarks').document(bookmark_id)
    doc = ref.get()
    if not doc.exists:
        raise HTTPException(404, "Bookmark not found")
    data = doc.to_dict()
    if data.get('user_id') != user['user_id']:
        raise HTTPException(403, "Not your bookmark")

    updates = {}
    if req.note is not None:
        updates['note'] = req.note
    if req.tags is not None:
        updates['tags'] = req.tags
    if req.collection is not None:
        updates['collection'] = req.collection
    if updates:
        ref.update(updates)
    return {"status": "updated", "id": bookmark_id}


@router.get("/collections")
def list_collections(user=Depends(get_current_user)):
    """Return distinct collection names and the tag universe for this user."""
    db = get_firestore_db()
    bookmarks = db.db.collection('bookmarks').where('user_id', '==', user['user_id']).stream()
    collections: dict = {}
    tag_counts: dict = {}
    for doc in bookmarks:
        data = doc.to_dict()
        c = (data.get('collection') or '').strip()
        if c:
            collections[c] = collections.get(c, 0) + 1
        for t in (data.get('tags') or []):
            t = str(t).strip()
            if t:
                tag_counts[t] = tag_counts.get(t, 0) + 1
    return {
        "collections": [{"name": n, "count": c} for n, c in sorted(collections.items())],
        "tags": [{"name": n, "count": c} for n, c in sorted(tag_counts.items(), key=lambda x: -x[1])],
    }


# ─── Saved searches ───────────────────────────────────────────────────────────

@router.post("/saved-searches")
def save_search(req: SavedSearchRequest, user=Depends(get_current_user)):
    db = get_firestore_db()
    sid = str(uuid.uuid4())
    doc = {
        'id': sid,
        'user_id': user['user_id'],
        'name': req.name,
        'query': req.query,
        'filters': req.filters or {},
        'created_at': datetime.utcnow(),
    }
    db.db.collection('saved_searches').document(sid).set(doc)
    return {"id": sid, "status": "saved"}


@router.get("/saved-searches")
def list_saved_searches(user=Depends(get_current_user)):
    db = get_firestore_db()
    docs = db.db.collection('saved_searches').where('user_id', '==', user['user_id']).stream()
    out = []
    for d in docs:
        data = d.to_dict()
        out.append({
            "id": data['id'],
            "name": data.get('name', ''),
            "query": data.get('query', ''),
            "filters": data.get('filters', {}),
            "created_at": str(data.get('created_at', '')),
        })
    out.sort(key=lambda x: x['created_at'], reverse=True)
    return {"saved_searches": out, "count": len(out)}


@router.delete("/saved-searches/{search_id}")
def delete_saved_search(search_id: str, user=Depends(get_current_user)):
    db = get_firestore_db()
    ref = db.db.collection('saved_searches').document(search_id)
    doc = ref.get()
    if not doc.exists:
        raise HTTPException(404, "Saved search not found")
    if doc.to_dict().get('user_id') != user['user_id']:
        raise HTTPException(403, "Not your saved search")
    ref.delete()
    return {"status": "deleted"}


# ─── Annotations ──────────────────────────────────────────────────────────────

@router.post("/annotations")
def create_annotation(req: AnnotationRequest, user=Depends(get_current_user)):
    db = get_firestore_db()
    aid = str(uuid.uuid4())
    doc = {
        'id': aid,
        'user_id': user['user_id'],
        'article_id': req.article_id,
        'text': req.text,
        'note': req.note or '',
        'start_offset': req.start_offset,
        'end_offset': req.end_offset,
        'color': req.color or 'yellow',
        'created_at': datetime.utcnow(),
    }
    db.db.collection('annotations').document(aid).set(doc)
    return {"id": aid, "status": "created"}


@router.get("/annotations/article/{article_id}")
def list_article_annotations(article_id: str, user=Depends(get_current_user)):
    db = get_firestore_db()
    docs = (db.db.collection('annotations')
              .where('user_id', '==', user['user_id'])
              .where('article_id', '==', article_id)
              .stream())
    out = []
    for d in docs:
        data = d.to_dict()
        out.append({
            'id': data['id'],
            'article_id': data['article_id'],
            'text': data.get('text', ''),
            'note': data.get('note', ''),
            'start_offset': data.get('start_offset'),
            'end_offset': data.get('end_offset'),
            'color': data.get('color', 'yellow'),
            'created_at': str(data.get('created_at', '')),
        })
    out.sort(key=lambda x: (x.get('start_offset') or 0))
    return {"annotations": out, "count": len(out)}


@router.delete("/annotations/{annotation_id}")
def delete_annotation(annotation_id: str, user=Depends(get_current_user)):
    db = get_firestore_db()
    ref = db.db.collection('annotations').document(annotation_id)
    doc = ref.get()
    if not doc.exists:
        raise HTTPException(404, "Annotation not found")
    if doc.to_dict().get('user_id') != user['user_id']:
        raise HTTPException(403, "Not your annotation")
    ref.delete()
    return {"status": "deleted"}
