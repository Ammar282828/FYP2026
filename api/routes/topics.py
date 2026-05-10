"""
Topic modeling API routes
"""

from fastapi import APIRouter, HTTPException
from typing import Optional
from datetime import datetime
from database.firestore_db import get_firestore_db
import json
import os
import google.generativeai as genai
from collections import Counter
from services.gemini_adapter import create_model as _create_gemini_model

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "").strip()
if not GEMINI_API_KEY:
    print("[WARNING] GEMINI_API_KEY not set — topic classification endpoints will be unavailable")


router = APIRouter(prefix="/api/topics", tags=["topics"])

# In-memory cache for heavy full-scan endpoints
import time as _time
_endpoint_cache: dict = {}
_endpoint_cache_ts: dict = {}
_CACHE_TTL = 3600

def _cached(key, fn):
    if key in _endpoint_cache and _time.time() - _endpoint_cache_ts.get(key, 0) < _CACHE_TTL:
        return _endpoint_cache[key]
    result = fn()
    _endpoint_cache[key] = result
    _endpoint_cache_ts[key] = _time.time()
    return result

_topics_data = None


# loads the topics from the json file into memory
def load_topics_data():
    global _topics_data

    if _topics_data is not None:
        return _topics_data

    topics_file = "data/topics_data.json"
    if not os.path.exists(topics_file):
        return None

    try:
        with open(topics_file, 'r') as f:
            _topics_data = json.load(f)
        print(f"[OK] Loaded {_topics_data['total_topics']} topics from {topics_file}")
        return _topics_data
    except Exception as e:
        print(f"[ERROR] Failed to load topics data: {e}")
        return None


# Re-classify all articles using Gemini API
# Uses predefined topic taxonomy from topics_data.json
@router.post("/train")
def train_topic_model():
    """Re-classify all articles using Gemini API with predefined topic taxonomy."""
    try:
        import time as _t

        topics_data = load_topics_data()
        if not topics_data:
            raise HTTPException(400, "Topics data not available. data/topics_data.json required.")

        topics = [t for t in topics_data['topics'] if t['topic_id'] != -1]
        valid_ids = {t['topic_id'] for t in topics}

        # Build topic prompt
        topic_lines = []
        for t in topics:
            kw = ', '.join(t.get('keywords', [])[:5])
            topic_lines.append(f"  {t['topic_id']}: {t['name']} - {t.get('description', '')} (keywords: {kw})")
        topic_list_str = '\n'.join(topic_lines)

        db = get_firestore_db()

        print("Fetching all articles from Firestore...")
        documents = []
        article_ids = []

        batch_size = 1000
        last_doc = None
        total_fetched = 0

        while True:
            if last_doc:
                articles_query = db.db.collection('articles').order_by('__name__').start_after(last_doc).limit(batch_size)
            else:
                articles_query = db.db.collection('articles').order_by('__name__').limit(batch_size)

            batch_docs = list(articles_query.stream())
            if not batch_docs:
                break

            for doc in batch_docs:
                data = doc.to_dict()
                content = data.get('content', '')
                headline = data.get('headline', '')
                combined_text = f"{headline}\n{content}"
                if combined_text.strip():
                    documents.append(combined_text)
                    article_ids.append(data.get('id'))

            total_fetched += len(batch_docs)
            print(f"Fetched {total_fetched} articles so far...")
            last_doc = batch_docs[-1]
            if len(batch_docs) < batch_size:
                break

        print(f"Total articles fetched: {len(documents)}")

        if len(documents) < 1:
            raise HTTPException(400, f"No articles found in Firestore.")

        # Classify in batches of 10 using Gemini
        print(f"Classifying {len(documents)} articles with Gemini API...")
        gemini_batch_size = 10
        all_results = []

        for i in range(0, len(documents), gemini_batch_size):
            batch_texts = documents[i:i + gemini_batch_size]
            articles_block = ""
            for j, text in enumerate(batch_texts):
                articles_block += f"\n--- ARTICLE {j} ---\n{text[:800]}\n"

            prompt = f"""Classify each article into ONE of these topics:

{topic_list_str}

If an article does not fit, use topic_id -1.

{articles_block}

Respond with ONLY valid JSON array:
[{{"article_index": 0, "topic_id": <number>}}, ...]"""

            try:
                model = _create_gemini_model(GEMINI_API_KEY, 'gemini-2.5-flash')
                response = model.generate_content(prompt)
                raw = response.text.strip() if response.parts else ""

                if '```json' in raw:
                    raw = raw.split('```json')[1].split('```')[0].strip()
                elif '```' in raw:
                    raw = raw.split('```')[1].split('```')[0].strip()

                batch_results = json.loads(raw)
                result_map = {}
                for r in batch_results:
                    idx = r.get('article_index', -1)
                    tid = int(r.get('topic_id', -1))
                    if tid not in valid_ids:
                        tid = -1
                    result_map[idx] = tid

                for j in range(len(batch_texts)):
                    tid = result_map.get(j, -1)
                    if tid == -1:
                        all_results.append({'topic_id': -1, 'topic_label': 'Uncategorized'})
                    else:
                        for t in topics:
                            if t['topic_id'] == tid:
                                all_results.append({
                                    'topic_id': tid,
                                    'topic_label': '_'.join(t.get('keywords', [])[:5])
                                })
                                break
                        else:
                            all_results.append({'topic_id': -1, 'topic_label': 'Uncategorized'})

            except Exception as e:
                print(f"  [WARNING] Batch classification failed: {e}")
                for _ in batch_texts:
                    all_results.append({'topic_id': -1, 'topic_label': 'Uncategorized'})

            done = min(i + gemini_batch_size, len(documents))
            if done % 100 == 0 or done == len(documents):
                print(f"  Classified {done}/{len(documents)} ({100 * done // len(documents)}%)")
            _t.sleep(0.3)

        # Update Firestore
        print("Updating Firestore with topic assignments...")
        updated_count = 0
        failed_count = 0
        fb_batch_size = 500

        for i in range(0, len(article_ids), fb_batch_size):
            batch = db.db.batch()
            batch_items = 0

            for j in range(i, min(i + fb_batch_size, len(article_ids))):
                article_id = article_ids[j]
                result = all_results[j]
                if article_id:
                    try:
                        ref = db.db.collection('articles').document(article_id)
                        batch.update(ref, {
                            'topic_id': result['topic_id'],
                            'topic_label': result['topic_label']
                        })
                        batch_items += 1
                    except Exception as e:
                        failed_count += 1

            try:
                batch.commit()
                updated_count += batch_items
            except Exception as e:
                failed_count += batch_items

        # Invalidate cached topic data
        _endpoint_cache.clear()
        _endpoint_cache_ts.clear()

        return {
            "status": "success",
            "message": f"Classified {len(documents)} articles using Gemini API",
            "updated": updated_count,
            "failed": failed_count,
            "topic_count": len(topics)
        }

    except HTTPException:
        raise
    except Exception as e:
        print(f"Topic training error: {str(e)}")
        raise HTTPException(500, f"Failed to classify topics: {str(e)}")


# gets a specific topic by its id with sample articles
@router.get("/by-id/{topic_id}")
def get_topic_by_id(topic_id: int):
    try:
        topics_data = load_topics_data()

        if not topics_data:
            raise HTTPException(400, "Topics data not available")

        topic = None
        for t in topics_data['topics']:
            if t['topic_id'] == topic_id:
                topic = t.copy()
                break

        if not topic:
            raise HTTPException(404, f"Topic {topic_id} not found")

        db = get_firestore_db()
        articles = []
        try:
            articles_query = db.db.collection('articles').where('topic_id', '==', topic_id).limit(20)
            for doc in articles_query.stream():
                article = doc.to_dict()
                articles.append({
                    'id': article.get('id'),
                    'headline': article.get('headline', 'No headline'),
                    'publication_date': str(article.get('publication_date', '')),
                    'sentiment_label': article.get('sentiment_label', 'neutral'),
                    'sentiment_score': article.get('sentiment_score', 0.0)
                })
        except Exception as e:
            print(f"Warning: Failed to get articles for topic {topic_id}: {e}")

        topic['articles'] = articles
        topic['article_count_in_db'] = len(articles)

        return topic

    except HTTPException:
        raise
    except Exception as e:
        print(f"Get topic error: {str(e)}")
        raise HTTPException(500, f"Failed to get topic: {str(e)}")


@router.get("/")
# returns all topics from the JSON file (no Firestore queries needed for the list)
def get_topics():
    try:
        topics_data = load_topics_data()

        if not topics_data:
            raise HTTPException(400, "Topics data not available. Topic model needs to be extracted.")

        return {
            "topic_count": topics_data['total_topics'],
            "topics": topics_data['topics'],
            "source": topics_data.get('source', 'Unknown')
        }

    except HTTPException:
        raise
    except Exception as e:
        print(f"Get topics error: {str(e)}")
        raise HTTPException(500, f"Failed to get topics: {str(e)}")


# shows how different topics became more or less popular over time
@router.get("/trends-over-time")
def get_topic_trends_over_time(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    granularity: str = 'month'
):
    """Get topic distribution over time to see how topics evolve"""
    try:
        cache_key = f"topic_trends_{granularity}_{start_date}_{end_date}"

        def _compute():
            topics_data = load_topics_data()
            if not topics_data:
                raise HTTPException(400, "Topics data not available")

            from datetime import datetime as dt
            from collections import defaultdict

            db = get_firestore_db()

            # Use the snapshot the analytics endpoints share rather than
            # streaming the live `articles` collection. Two reasons:
            #  1) `.stream()` over the full ~36k-doc collection now hits
            #     Firestore's server-side query timeout (~60s), and the
            #     google-cloud-firestore 2.27 retry path crashes on the
            #     503 with `'_UnaryStreamMultiCallable' object has no
            #     attribute '_retry'`. Same bug we patched in
            #     firestore_db._get_articles_snapshot.
            #  2) The snapshot is already loaded for the other analytics
            #     endpoints; reusing it makes this query ~50ms once warm
            #     instead of 30+s every call.
            articles = db._get_articles_snapshot()

            # Filter the snapshot in-process for the date range.
            sd = dt.fromisoformat(start_date) if start_date else None
            ed = dt.fromisoformat(end_date) if end_date else None
            # Strip tz so date-string comparisons against tz-naive bounds
            # don't raise. Snapshot dates are tz-aware; bounds aren't.
            from datetime import timezone
            def _naive(d):
                if d is None: return None
                if hasattr(d, 'tzinfo') and d.tzinfo is not None:
                    return d.astimezone(timezone.utc).replace(tzinfo=None)
                return d
            sd, ed = _naive(sd), _naive(ed)

            time_topic_counts = defaultdict(lambda: defaultdict(int))

            for article_data in articles:
                pub_date = article_data.get('publication_date')
                topic_label = article_data.get('topic_label', '')

                if not pub_date or not topic_label or topic_label == 'Uncategorized':
                    continue
                if article_data.get('low_quality'):
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

                time_topic_counts[period][topic_label] += 1

            periods = sorted(time_topic_counts.keys())
            trends = []
            for period in periods:
                period_data = {'period': period, 'topics': []}
                for topic_label, count in time_topic_counts[period].items():
                    period_data['topics'].append({'topic_id': topic_label, 'topic_name': topic_label, 'count': count})
                period_data['topics'].sort(key=lambda x: x['count'], reverse=True)
                trends.append(period_data)

            return {"granularity": granularity, "periods": len(periods), "trends": trends}

        return _cached(cache_key, _compute)

    except HTTPException:
        raise
    except Exception as e:
        print(f"Topic trends error: {str(e)}")
        raise HTTPException(500, f"Failed to get topic trends: {str(e)}")


# tracks the average sentiment for topics over different time periods
@router.get("/sentiment-over-time")
def get_topic_sentiment_over_time(
    topic_id: Optional[int] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    granularity: str = 'month'
):
    """Get average sentiment for topics over time"""
    try:
        cache_key = f"topic_sentiment_{granularity}_{topic_id}_{start_date}_{end_date}"

        def _compute():
            from datetime import datetime as dt, timezone
            from collections import defaultdict

            db = get_firestore_db()
            # Same fix as trends-over-time above: read from the shared
            # snapshot rather than re-streaming the live collection (which
            # times out on the SDK retry path past ~30k docs).
            articles = db._get_articles_snapshot()

            sd = dt.fromisoformat(start_date) if start_date else None
            ed = dt.fromisoformat(end_date) if end_date else None
            def _naive(d):
                if d is None: return None
                if hasattr(d, 'tzinfo') and d.tzinfo is not None:
                    return d.astimezone(timezone.utc).replace(tzinfo=None)
                return d
            sd, ed = _naive(sd), _naive(ed)

            period_topic_sentiments = defaultdict(lambda: defaultdict(list))

            for article in articles:
                pub_date = article.get('publication_date')
                article_topic_id = article.get('topic_id')
                sentiment_score = article.get('sentiment_score')

                if not pub_date or article_topic_id is None or article_topic_id == -1 or sentiment_score is None:
                    continue
                if topic_id is not None and article_topic_id != topic_id:
                    continue
                if article.get('low_quality'):
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

                period_topic_sentiments[period][article_topic_id].append(sentiment_score)

            trends = []
            for period in sorted(period_topic_sentiments.keys()):
                period_data = {'period': period, 'topics': []}
                for t_id, scores in period_topic_sentiments[period].items():
                    avg_sentiment = sum(scores) / len(scores) if scores else 0
                    period_data['topics'].append({'topic_id': t_id, 'avg_sentiment': round(avg_sentiment, 3), 'article_count': len(scores)})
                trends.append(period_data)

            return {"granularity": granularity, "topic_id": topic_id, "trends": trends}

        return _cached(cache_key, _compute)

    except Exception as e:
        print(f"Topic sentiment error: {str(e)}")
        raise HTTPException(500, f"Failed to get topic sentiment: {str(e)}")


@router.get("/{topic_id}/articles")
def get_topic_articles(topic_id: int):
    """Return all articles belonging to a topic, sorted by date descending."""
    try:
        db = get_firestore_db()
        articles = []
        for doc in db.db.collection('articles').where('topic_id', '==', topic_id).limit(1000).stream():
            data = doc.to_dict()
            pub = data.get('publication_date')
            articles.append({
                'id': data.get('id'),
                'headline': data.get('headline', 'No headline'),
                'publication_date': str(pub)[:10] if pub else '',
                'sentiment_label': data.get('sentiment_label', 'neutral'),
            })
        articles.sort(key=lambda x: x.get('publication_date', ''), reverse=True)
        return {"articles": articles, "count": len(articles)}
    except Exception as e:
        raise HTTPException(500, f"Failed to get topic articles: {str(e)}")


@router.get("/{topic_id}/summary")
def get_topic_summary(topic_id: int):
    """Generate an AI summary for a topic using its articles."""
    try:
        topics_data = load_topics_data()
        topic_info = None
        if topics_data:
            for t in topics_data['topics']:
                if t['topic_id'] == topic_id:
                    topic_info = t
                    break

        db = get_firestore_db()
        articles = []
        for doc in db.db.collection('articles').where('topic_id', '==', topic_id).limit(200).stream():
            articles.append(doc.to_dict())

        if not articles:
            return {"summary": "No articles found for this topic.", "article_count": 0}

        keywords = topic_info.get('keywords', []) if topic_info else []
        sentiments = [a.get('sentiment', 'neutral') for a in articles]
        sentiment_dist = dict(Counter(sentiments))
        sample_headlines = [a.get('headline', '') for a in articles[:10]]

        context = f"Topic Keywords: {', '.join(keywords)}\n"
        context += f"Total Articles: {len(articles)}\n"
        context += f"Sentiment Distribution: {sentiment_dist}\n"
        context += "Sample Headlines:\n"
        for i, h in enumerate(sample_headlines, 1):
            context += f"{i}. {h}\n"

        model = _create_gemini_model(GEMINI_API_KEY, 'gemini-2.5-flash')
        prompt = f"""You are analyzing newspaper articles from Dawn (1990-1992) grouped under the same topic.

{context}

Write a concise 3-4 paragraph analytical summary covering:
1. What this topic is about and its significance
2. Key events and developments covered
3. Notable patterns or recurring themes
4. The general tone and sentiment of coverage

Be specific and analytical. Do not repeat the headlines verbatim."""

        response = model.generate_content(prompt)
        return {
            "summary": response.text,
            "article_count": len(articles),
            "keywords": keywords
        }
    except Exception as e:
        raise HTTPException(500, f"Failed to generate topic summary: {str(e)}")


# ─── Batch topic assignment ───────────────────────────────────────────────────

from fastapi import BackgroundTasks

_TOPIC_ASSIGN_STATUS: dict = {
    "running": False, "started_at": None, "finished_at": None,
    "processed": 0, "total": 0, "last_error": None,
}


@router.post("/assign-batch")
def assign_topics_batch(request: dict, background_tasks: BackgroundTasks):
    """
    Run topic assignment over all unassigned articles (or a limited batch).

    Body: { "limit": 500, "reassign": false }
    """
    if _TOPIC_ASSIGN_STATUS["running"]:
        raise HTTPException(409, "A topic-assignment job is already running")
    if not GEMINI_API_KEY:
        raise HTTPException(500, "GEMINI_API_KEY not configured")

    limit = int(request.get("limit", 500))
    reassign = bool(request.get("reassign", False))

    background_tasks.add_task(_run_topic_assign_bg, limit, reassign)
    return {"status": "started", "limit": limit, "reassign": reassign}


@router.get("/assign-batch/status")
def topic_assign_status():
    return _TOPIC_ASSIGN_STATUS


def _run_topic_assign_bg(limit: int, reassign: bool):
    from datetime import datetime as dt
    _TOPIC_ASSIGN_STATUS.update({
        "running": True, "started_at": dt.utcnow().isoformat() + "Z",
        "finished_at": None, "processed": 0, "total": 0, "last_error": None,
    })
    try:
        import subprocess, sys as _sys, os as _os
        cmd = [_sys.executable, "scripts/assign_topics_gemini.py", "--limit", str(limit)]
        if reassign:
            cmd.append("--reassign")
        env = _os.environ.copy()
        result = subprocess.run(cmd, capture_output=True, text=True, env=env, timeout=3600)
        out = result.stdout or ""
        for line in out.splitlines():
            low = line.strip().lower()
            if low.startswith("processed") or "articles processed" in low:
                for tok in low.replace(",", " ").split():
                    if tok.isdigit():
                        _TOPIC_ASSIGN_STATUS["processed"] = int(tok)
                        break
        if result.returncode != 0:
            _TOPIC_ASSIGN_STATUS["last_error"] = (result.stderr or result.stdout)[-2000:]
    except Exception as e:
        _TOPIC_ASSIGN_STATUS["last_error"] = str(e)
    finally:
        from datetime import datetime as dt
        _TOPIC_ASSIGN_STATUS["running"] = False
        _TOPIC_ASSIGN_STATUS["finished_at"] = dt.utcnow().isoformat() + "Z"
