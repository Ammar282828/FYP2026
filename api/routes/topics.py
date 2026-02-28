"""
Topic modeling API routes
"""

from fastapi import APIRouter, HTTPException
from typing import Optional
from datetime import datetime
from database.firestore_db import get_firestore_db
import json
import os


router = APIRouter(prefix="/api/topics", tags=["topics"])

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


# trains a new topic model on all the articles in the database
# this can take a while depending on how many articles you have
@router.post("/train")
def train_topic_model():
    try:
        pipeline = get_pipeline()

        if not pipeline or not _PIPELINE_AVAILABLE:
            raise HTTPException(503, "NLP pipeline not available")

        db = get_firestore_db()

        print("Fetching all articles from Firestore...")
        documents = []
        article_ids = []
        article_metadata = []

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
                    article_metadata.append({
                        'id': data.get('id'),
                        'headline': headline,
                        'publication_date': data.get('publication_date')
                    })

            total_fetched += len(batch_docs)
            print(f"Fetched {total_fetched} articles so far...")

            last_doc = batch_docs[-1]

            if len(batch_docs) < batch_size:
                break

        print(f"Total articles fetched: {len(documents)}")

        if len(documents) < 10:
            raise HTTPException(400, f"Not enough articles for topic modeling. Found {len(documents)}, need at least 10.")

        print(f"Training topic model on {len(documents)} articles...")
        pipeline.nlp_processor.train_topic_model(documents)

        pipeline.nlp_processor.article_metadata = article_metadata

        print("Updating articles with topic assignments...")
        topic_assignments = pipeline.nlp_processor.topic_assignments
        updated_count = 0
        failed_count = 0

        batch_size = 500
        total_articles = len(article_ids)

        for i in range(0, total_articles, batch_size):
            batch = db.db.batch()
            batch_items = 0

            for article_id, topic_id in zip(article_ids[i:i+batch_size], topic_assignments[i:i+batch_size]):
                if article_id:
                    try:
                        # Get topic label (keywords)
                        if topic_id == -1:
                            topic_label = 'Uncategorized'
                        else:
                            topic_words = pipeline.nlp_processor.topic_model.get_topic(topic_id)
                            keywords = [word for word, _ in topic_words[:5]]
                            topic_label = '_'.join(keywords)
                        
                        article_ref = db.db.collection('articles').document(article_id)
                        batch.update(article_ref, {
                            'topic_id': int(topic_id),
                            'topic_label': topic_label
                        })
                        batch_items += 1
                    except Exception as e:
                        print(f"Warning: Failed to add article {article_id} to batch: {e}")
                        failed_count += 1

            try:
                batch.commit()
                updated_count += batch_items
                print(f"  Progress: {updated_count}/{total_articles} articles updated ({100*updated_count//total_articles}%)")
            except Exception as e:
                print(f"Warning: Failed to commit batch: {e}")
                failed_count += batch_items

        print(f"Updated {updated_count} articles with topic assignments ({failed_count} failed)")

        print("Saving topic model to disk...")
        pipeline.nlp_processor.save_topic_model("data/topic_model")
        print("Topic model saved successfully")

        topic_info = pipeline.nlp_processor.topic_model.get_topic_info()
        topics = []

        for _, row in topic_info.iterrows():
            if row['Topic'] != -1:
                topic_words = pipeline.nlp_processor.topic_model.get_topic(row['Topic'])
                topics.append({
                    'topic_id': int(row['Topic']),
                    'count': int(row['Count']),
                    'keywords': [word for word, _ in topic_words[:5]],
                    'name': row.get('Name', f"Topic {row['Topic']}")
                })

        return {
            "status": "success",
            "message": f"Topic model trained on {len(documents)} articles",
            "topic_count": len(topics),
            "topics": topics
        }

    except Exception as e:
        print(f"Topic training error: {str(e)}")
        raise HTTPException(500, f"Failed to train topic model: {str(e)}")


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
# returns all the topics with examples of articles in each topic
def get_topics():
    try:
        topics_data = load_topics_data()

        if not topics_data:
            raise HTTPException(400, "Topics data not available. Topic model needs to be extracted.")

        db = get_firestore_db()
        topics_with_docs = []

        for topic in topics_data['topics']:
            topic_id = topic['topic_id']

            if topic_id == -1:
                topics_with_docs.append(topic)
                continue

            representative_docs = []
            try:
                articles_query = db.db.collection('articles').where('topic_id', '==', topic_id).limit(5)
                for doc in articles_query.stream():
                    article = doc.to_dict()
                    representative_docs.append({
                        'headline': article.get('headline', 'No headline'),
                        'id': article.get('id')
                    })
            except Exception as e:
                print(f"Warning: Failed to get representative docs for topic {topic_id}: {e}")

            topic_with_docs = topic.copy()
            topic_with_docs['representative_docs'] = representative_docs
            topics_with_docs.append(topic_with_docs)

        return {
            "topic_count": topics_data['total_topics'],
            "topics": topics_with_docs,
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
        topics_data = load_topics_data()

        if not topics_data:
            raise HTTPException(400, "Topics data not available")

        from datetime import datetime as dt
        from collections import defaultdict

        db = get_firestore_db()

        articles_query = db.db.collection('articles')

        if start_date:
            start_dt = dt.fromisoformat(start_date)
            articles_query = articles_query.where('publication_date', '>=', start_dt)

        if end_date:
            end_dt = dt.fromisoformat(end_date)
            articles_query = articles_query.where('publication_date', '<=', end_dt)

        articles_stream = articles_query.stream()

        time_topic_counts = defaultdict(lambda: defaultdict(int))
        
        articles_processed = 0
        articles_with_topics = 0

        for article_doc in articles_stream:
            articles_processed += 1
            article_data = article_doc.to_dict()
            pub_date = article_data.get('publication_date')
            topic_label = article_data.get('topic_label', '')

            # Skip articles without dates or topics
            if not pub_date or not topic_label or topic_label == 'Uncategorized':
                continue

            articles_with_topics += 1

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

            time_topic_counts[period][topic_label] += 1

        print(f"[DEBUG] Topic trends: processed {articles_processed} articles, {articles_with_topics} with topics")
        print(f"[DEBUG] Found {len(time_topic_counts)} periods")
        if time_topic_counts:
            first_period = list(time_topic_counts.keys())[0]
            print(f"[DEBUG] First period: {first_period}, topics: {list(time_topic_counts[first_period].keys())[:3]}")

        # Get all unique topics from the data
        all_topics = set()
        for period_topics in time_topic_counts.values():
            all_topics.update(period_topics.keys())

        periods = sorted(time_topic_counts.keys())
        trends = []

        for period in periods:
            period_data = {
                'period': period,
                'topics': []
            }

            for topic_label, count in time_topic_counts[period].items():
                period_data['topics'].append({
                    'topic_id': topic_label,  # Keep for compatibility
                    'topic_name': topic_label,
                    'count': count
                })

            period_data['topics'].sort(key=lambda x: x['count'], reverse=True)
            trends.append(period_data)

        return {
            "granularity": granularity,
            "periods": len(periods),
            "trends": trends
        }

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
        from datetime import datetime as dt
        from collections import defaultdict

        db = get_firestore_db()
        articles_query = db.db.collection('articles')

        if start_date:
            articles_query = articles_query.where('publication_date', '>=', dt.fromisoformat(start_date))
        if end_date:
            articles_query = articles_query.where('publication_date', '<=', dt.fromisoformat(end_date))

        period_topic_sentiments = defaultdict(lambda: defaultdict(list))

        for article_doc in articles_query.stream():
            article = article_doc.to_dict()
            pub_date = article.get('publication_date')
            article_topic_id = article.get('topic_id')
            sentiment_score = article.get('sentiment_score')

            if not pub_date or article_topic_id is None or article_topic_id == -1 or sentiment_score is None:
                continue

            if topic_id is not None and article_topic_id != topic_id:
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

            period_topic_sentiments[period][article_topic_id].append(sentiment_score)

        trends = []
        for period in sorted(period_topic_sentiments.keys()):
            period_data = {
                'period': period,
                'topics': []
            }

            for t_id, scores in period_topic_sentiments[period].items():
                avg_sentiment = sum(scores) / len(scores) if scores else 0
                period_data['topics'].append({
                    'topic_id': t_id,
                    'avg_sentiment': round(avg_sentiment, 3),
                    'article_count': len(scores)
                })

            trends.append(period_data)

        return {
            "granularity": granularity,
            "topic_id": topic_id,
            "trends": trends
        }

    except Exception as e:
        print(f"Topic sentiment error: {str(e)}")
        raise HTTPException(500, f"Failed to get topic sentiment: {str(e)}")
