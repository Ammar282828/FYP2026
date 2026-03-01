#!/usr/bin/env python3
"""
Firebase Firestore Database Layer for MediaScope
Replaces PostgreSQL + Elasticsearch with cloud Firestore
"""

# this handles all the database stuff using firebase firestore
# it has methods for storing and getting articles, searching, analytics, etc

import os
import json
from datetime import datetime, timedelta
from typing import List, Dict, Optional
import firebase_admin
from firebase_admin import credentials, firestore, storage
from google.cloud.firestore_v1.base_query import FieldFilter

# ─── Story helpers ────────────────────────────────────────────────────────────
_STORY_ENTITY_TYPES = {'PERSON', 'ORG', 'GPE'}

def _extract_story_entities(entities: List[Dict]) -> set:
    """Return lowercase entity text set for PERSON/ORG/GPE entities only."""
    result = set()
    for ent in entities:
        if ent.get('type') in _STORY_ENTITY_TYPES:
            text = ent.get('text', '').strip()
            if len(text) >= 3:
                result.add(text.lower())
    return result

def _get_entity_type(normalized_text: str, entities: List[Dict]) -> str:
    for ent in entities:
        if ent.get('text', '').lower() == normalized_text:
            return ent.get('type', 'UNKNOWN')
    return 'UNKNOWN'

def _jaccard_similarity(set_a: set, set_b: set) -> float:
    if not set_a or not set_b:
        return 0.0
    return len(set_a & set_b) / len(set_a | set_b)
# ─────────────────────────────────────────────────────────────────────────────

class FirestoreDB:

    def __init__(self):
        self._cache = {}
        self._cache_timestamp = {}
        self._cache_ttl = 3600  # 1 hour — data is a historical archive, never changes

        if not firebase_admin._apps:
            service_account_path = os.getenv('FIREBASE_SERVICE_ACCOUNT_PATH')
            storage_bucket = os.getenv('FIREBASE_STORAGE_BUCKET')

            if service_account_path and os.path.exists(service_account_path):
                cred = credentials.Certificate(service_account_path)
                firebase_admin.initialize_app(cred, {
                    'storageBucket': storage_bucket
                })
            else:
                firebase_admin.initialize_app()

        self.db = firestore.client()
        try:
            self.bucket = storage.bucket()
            print("[OK] Connected to Firebase Firestore and Storage")
        except Exception as e:
            print(f"[WARNING] Storage not available: {e}")
            self.bucket = None
            print("[OK] Connected to Firebase Firestore (Storage disabled)")

    def _get_cached(self, key: str):
        import time
        if key in self._cache:
            if time.time() - self._cache_timestamp.get(key, 0) < self._cache_ttl:
                print(f"[CACHE HIT] {key}")
                return self._cache[key]
        return None

    def _set_cached(self, key: str, value):
        import time
        self._cache[key] = value
        self._cache_timestamp[key] = time.time()
        print(f"[CACHE SET] {key}")

    def store_article(self, article_data: Dict) -> str:
        try:
            article_id = article_data.get('id', self.db.collection('articles').document().id)

            doc_data = {
                'id': article_id,
                'headline': article_data.get('headline', ''),
                'content': article_data.get('content', ''),
                'publication_date': article_data.get('publication_date'),
                'page_number': article_data.get('page_number', 1),
                'newspaper_id': article_data.get('newspaper_id'),
                'sentiment_score': article_data.get('sentiment_score', 0.0),
                'sentiment_label': article_data.get('sentiment_label', 'neutral'),
                'topic_label': article_data.get('topic_label', ''),
                'word_count': article_data.get('word_count', 0),
                'entities': article_data.get('entities', []),
                'story_id': article_data.get('story_id', None),
                'created_at': firestore.SERVER_TIMESTAMP,
            }

            self.db.collection('articles').document(article_id).set(doc_data)

            print(f"[OK] Stored article: {article_id}")
            return article_id

        except Exception as e:
            print(f"[ERROR] Failed to store article: {e}")
            raise

    def get_article(self, article_id: str) -> Optional[Dict]:
        try:
            doc = self.db.collection('articles').document(article_id).get()
            if doc.exists:
                return doc.to_dict()
            return None
        except Exception as e:
            print(f"[ERROR] Failed to retrieve article: {e}")
            return None

    def search_articles(self, query: str, limit: int = 50) -> List[Dict]:
        try:
            all_articles = self.db.collection('articles').stream()

            results_with_score = []
            query_lower = query.lower()

            for doc in all_articles:
                data = doc.to_dict()
                headline = data.get('headline', '').lower()
                content = data.get('content', '').lower()
                combined_text = headline + ' ' + content

                if query_lower in combined_text:
                    mention_count = combined_text.count(query_lower)

                    created_at = data.get('created_at')
                    if created_at:
                        timestamp = created_at.timestamp() if hasattr(created_at, 'timestamp') else 0
                    else:
                        timestamp = 0

                    results_with_score.append({
                        'data': data,
                        'mentions': mention_count,
                        'timestamp': timestamp
                    })

            results_with_score.sort(key=lambda x: (x['mentions'], x['timestamp']), reverse=True)

            results = [item['data'] for item in results_with_score[:limit]]

            return results

        except Exception as e:
            print(f"[ERROR] Search failed: {e}")
            return []

    def search_by_entity(self, entity_name: str, entity_type: Optional[str] = None, limit: int = 50) -> List[Dict]:
        try:
            results = []

            articles = self.db.collection('articles').limit(300).stream()

            for doc in articles:
                data = doc.to_dict()
                entities = data.get('entities', [])

                for entity in entities:
                    if entity.get('text', '').lower() == entity_name.lower():
                        if entity_type is None or entity.get('type') == entity_type:
                            results.append(data)
                            break

                if len(results) >= limit:
                    break

            return results

        except Exception as e:
            print(f"[ERROR] Entity search failed: {e}")
            return []

    def get_analytics_articles_over_time(self) -> List[Dict]:
        cached = self._get_cached('articles_over_time')
        if cached is not None:
            return cached

        try:
            articles = self.db.collection('articles').stream()

            monthly_counts = {}
            for doc in articles:
                data = doc.to_dict()
                pub_date = data.get('publication_date')
                if pub_date:
                    if isinstance(pub_date, str):
                        pub_date = datetime.fromisoformat(pub_date.replace('Z', '+00:00'))

                    month_key = pub_date.strftime('%Y-%m')
                    monthly_counts[month_key] = monthly_counts.get(month_key, 0) + 1

            result = [
                {'month': month, 'count': count}
                for month, count in sorted(monthly_counts.items())
            ]

            self._set_cached('articles_over_time', result)
            return result

        except Exception as e:
            print(f"[ERROR] Analytics query failed: {e}")
            return []

    def get_analytics_sentiment_over_time(self) -> List[Dict]:
        cached = self._get_cached('sentiment_over_time')
        if cached is not None:
            return cached

        try:
            articles = self.db.collection('articles').stream()

            monthly_sentiment = {}
            for doc in articles:
                data = doc.to_dict()
                pub_date = data.get('publication_date')
                sentiment = data.get('sentiment_label', 'neutral')

                if pub_date:
                    if isinstance(pub_date, str):
                        pub_date = datetime.fromisoformat(pub_date.replace('Z', '+00:00'))

                    month_key = pub_date.strftime('%Y-%m')
                    if month_key not in monthly_sentiment:
                        monthly_sentiment[month_key] = {'positive': 0, 'neutral': 0, 'negative': 0}

                    monthly_sentiment[month_key][sentiment] = monthly_sentiment[month_key].get(sentiment, 0) + 1

            result = [
                {
                    'month': month,
                    'positive': counts['positive'],
                    'neutral': counts['neutral'],
                    'negative': counts['negative']
                }
                for month, counts in sorted(monthly_sentiment.items())
            ]

            self._set_cached('sentiment_over_time', result)
            return result

        except Exception as e:
            print(f"[ERROR] Sentiment analytics failed: {e}")
            return []

    def get_top_keywords(self, limit: int = 50) -> List[Dict]:
        cache_key = f'top_keywords_{limit}'
        cached = self._get_cached(cache_key)
        if cached is not None:
            return cached

        try:
            import re
            articles = self.db.collection('articles').stream()

            word_freq = {}
            stop_words = {
                'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
                'this', 'that', 'these', 'those', 'is', 'was', 'are', 'were', 'been', 'be', 'have', 'has',
                'had', 'do', 'does', 'did', 'will', 'would', 'should', 'could', 'may', 'might', 'must',
                'can', 'from', 'as', 'it', 'its', 'their', 'them', 'they', 'he', 'she', 'him', 'her',
                'his', 'we', 'our', 'us', 'you', 'your', 'which', 'who', 'whom', 'whose', 'what', 'when',
                'where', 'why', 'how', 'all', 'each', 'every', 'both', 'few', 'more', 'most', 'other',
                'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very',
                'also', 'just', 'about', 'into', 'through', 'during', 'before', 'after', 'above', 'below',
                'between', 'under', 'again', 'further', 'then', 'once', 'here', 'there', 'up', 'down',
                'out', 'over', 'off', 'any', 'being', 'having', 'doing', 'one', 'two', 'three', 'four',
                'five', 'six', 'seven', 'eight', 'nine', 'ten', 'said', 'page', 'continued', 'back'
            }

            for doc in articles:
                data = doc.to_dict()
                content = data.get('content', '') + ' ' + data.get('headline', '')
                words = content.lower().split()

                for word in words:
                    word = word.strip('.,!?;:"\'()[]{}')

                    if (len(word) > 3 and
                        word not in stop_words and
                        not word.isdigit() and
                        not re.match(r'^\d+[a-z]+$', word) and
                        not re.match(r'^[a-z]+\d+$', word) and
                        not re.match(r'^\d{1,2}[-/]\d{1,2}', word) and
                        re.search(r'[a-z]', word)):
                        word_freq[word] = word_freq.get(word, 0) + 1

            sorted_keywords = sorted(word_freq.items(), key=lambda x: x[1], reverse=True)
            result = [
                {'keyword': word, 'frequency': freq}
                for word, freq in sorted_keywords[:limit]
            ]

            self._set_cached(cache_key, result)
            return result

        except Exception as e:
            print(f"[ERROR] Keyword extraction failed: {e}")
            return []

    def _normalize_entity_name(self, entity_text: str) -> str:
        entity_lower = entity_text.lower()

        normalization_map = {
            'pakist': 'pakistan',
            'pakistani': 'pakistan',
            'pakistanis': 'pakistan',
            'paki': 'pakistan',
            'pakis': 'pakistan',
            'pakistan': 'pakistan',

            'indian': 'india',
            'indians': 'india',
            'india': 'india',

            'palestin': 'palestine',
            'palestine': 'palestine',
            'palestinian': 'palestine',
            'palestinians': 'palestine',
            'plo': 'palestine',

            'syr': 'syria',
            'syria': 'syria',
            'syrian': 'syria',
            'syrians': 'syria',

            'lebanon': 'lebanon',
            'lebanese': 'lebanon',

            'egypt': 'egypt',
            'egyptian': 'egypt',
            'egyptians': 'egypt',

            'american': 'america',
            'americans': 'america',
            'america': 'america',
            'us': 'america',
            'usa': 'america',

            'british': 'britain',
            'britain': 'britain',
            'uk': 'britain',

            'karachi': 'karachi',
            'karachiites': 'karachi',
            'lahore': 'lahore',
            'lahori': 'lahore',
            'lahoris': 'lahore',
            'islamabad': 'islamabad',

            'arab': 'arab',
            'arabs': 'arab',
            'saudi': 'saudi arabia',
            'saudis': 'saudi arabia',
            'saudi arabia': 'saudi arabia',
            'jordan': 'jordan',
            'jordanian': 'jordan',
            'jordanians': 'jordan',
            'kuwait': 'kuwait',
            'kuwaiti': 'kuwait',
            'kuwaitis': 'kuwait',

            'soviet': 'ussr',
            'soviets': 'ussr',
            'ussr': 'ussr',
            'russia': 'russia',
            'russian': 'russia',
            'russians': 'russia',
            'iraq': 'iraq',
            'iraqi': 'iraq',
            'iraqis': 'iraq',
            'iran': 'iran',
            'iranian': 'iran',
            'iranians': 'iran',
            'israel': 'israel',
            'israeli': 'israel',
            'israelis': 'israel',
            'china': 'china',
            'chinese': 'china',
            'japan': 'japan',
            'japanese': 'japan',
            'afghanistan': 'afghanistan',
            'afghan': 'afghanistan',
            'afghans': 'afghanistan',
        }

        if entity_lower in normalization_map:
            return normalization_map[entity_lower].title()

        if entity_lower.endswith('ans') and len(entity_lower) > 5:
            base = entity_lower[:-3]
            if base not in normalization_map:
                return base.title()
        elif entity_lower.endswith('ese') and len(entity_lower) > 6:
            base = entity_lower[:-3]
            if base.endswith('in'):
                base = base[:-2] + 'a'
            return base.title()
        elif entity_lower.endswith('is') and len(entity_lower) > 5:
            base = entity_lower[:-2]
            return base.title()

        return entity_text

    def get_sentiment_by_entity(self, entity_type: Optional[str] = None, limit: int = 20) -> List[Dict]:
        try:
            articles = self.db.collection('articles').stream()

            entity_sentiment = {}

            for doc in articles:
                data = doc.to_dict()
                sentiment = data.get('sentiment_label', 'neutral')
                entities = data.get('entities', [])

                for entity in entities:
                    entity_text = entity.get('text', '')
                    entity_type_val = entity.get('type', '')

                    if entity_type_val in ['DATE', 'TIME', 'CARDINAL', 'ORDINAL', 'QUANTITY', 'MONEY', 'PERCENT']:
                        continue

                    if len(entity_text) < 3 or entity_text.isdigit():
                        continue

                    if entity_type and entity_type_val != entity_type:
                        continue

                    normalized_text = self._normalize_entity_name(entity_text)

                    if normalized_text not in entity_sentiment:
                        entity_sentiment[normalized_text] = {
                            'entity_text': normalized_text,
                            'entity_type': entity_type_val,
                            'positive_count': 0,
                            'neutral_count': 0,
                            'negative_count': 0,
                            'article_count': 0,
                            'sentiment_scores': []
                        }

                    entity_sentiment[normalized_text][f'{sentiment}_count'] += 1
                    entity_sentiment[normalized_text]['article_count'] += 1

                    sentiment_score = data.get('sentiment_score', 0.0)
                    entity_sentiment[normalized_text]['sentiment_scores'].append(sentiment_score)

            for entity_data in entity_sentiment.values():
                scores = entity_data.pop('sentiment_scores', [])
                entity_data['avg_sentiment'] = sum(scores) / len(scores) if scores else 0.0

            sorted_entities = sorted(
                entity_sentiment.values(),
                key=lambda x: x['article_count'],
                reverse=True
            )

            filtered_entities = [e for e in sorted_entities if e['article_count'] >= 2]

            return filtered_entities[:limit]

        except Exception as e:
            print(f"[ERROR] Entity sentiment analysis failed: {e}")
            return []

    def get_top_entities(self, entity_type: Optional[str] = None, limit: int = 15,
                         start_date: Optional[str] = None, end_date: Optional[str] = None) -> List[Dict]:
        """Get top entities by frequency"""
        cache_key = f'top_entities_{entity_type}_{limit}_{start_date}_{end_date}'
        cached = self._get_cached(cache_key)
        if cached is not None:
            return cached

        try:
            import re
            articles = self.db.collection('articles').stream()

            entity_counts = {}

            for doc in articles:
                data = doc.to_dict()

                if start_date or end_date:
                    pub_date_raw = data.get('publication_date')
                    pub_date = self._normalize_date(pub_date_raw)
                    if start_date and pub_date and pub_date < start_date:
                        continue
                    if end_date and pub_date and pub_date > end_date:
                        continue

                entities = data.get('entities', [])

                for entity in entities:
                    entity_text = entity.get('text', '')
                    entity_type_val = entity.get('type', '')

                    if entity_type_val in ['DATE', 'TIME', 'CARDINAL', 'ORDINAL', 'QUANTITY', 'MONEY', 'PERCENT']:
                        continue

                    if len(entity_text) < 3 or entity_text.isdigit():
                        continue

                    if entity_type and entity_type_val != entity_type:
                        continue

                    normalized_text = self._normalize_entity_name(entity_text)

                    entity_key = (normalized_text, entity_type_val)

                    if entity_key not in entity_counts:
                        entity_counts[entity_key] = {
                            'text': normalized_text,
                            'type': entity_type_val,
                            'count': 0
                        }

                    entity_counts[entity_key]['count'] += 1

            sorted_entities = sorted(
                entity_counts.values(),
                key=lambda x: x['count'],
                reverse=True
            )

            result = sorted_entities[:limit]
            self._set_cached(cache_key, result)
            return result

        except Exception as e:
            print(f"[ERROR] Top entities query failed: {e}")
            return []

    def get_entity_cooccurrence(self, entity_type: Optional[str] = None, min_count: int = 3, limit: int = 50) -> List[Dict]:
        cache_key = f'entity_cooccurrence_{entity_type}_{min_count}_{limit}'
        cached = self._get_cached(cache_key)
        if cached is not None:
            return cached

        try:
            from itertools import combinations
            from collections import defaultdict

            articles = self.db.collection('articles').stream()

            pair_counts = defaultdict(int)
            pair_articles = defaultdict(list)  # Store article info for each pair

            for doc in articles:
                data = doc.to_dict()
                entities = data.get('entities', [])
                article_id = data.get('id', '')
                headline = data.get('headline', '')
                content = data.get('content', '')

                filtered_entities = []
                for entity in entities:
                    entity_text = entity.get('text', '')
                    entity_type_val = entity.get('type', '')

                    if entity_type_val in ['DATE', 'TIME', 'CARDINAL', 'ORDINAL', 'QUANTITY', 'MONEY', 'PERCENT']:
                        continue

                    if len(entity_text) < 3 or entity_text.isdigit():
                        continue

                    if entity_type and entity_type_val != entity_type:
                        continue

                    normalized_text = self._normalize_entity_name(entity_text)
                    filtered_entities.append({
                        'text': normalized_text,
                        'type': entity_type_val,
                        'original': entity_text
                    })

                for e1, e2 in combinations(filtered_entities, 2):
                    if e1['text'] == e2['text']:
                        continue

                    if e1['text'] < e2['text']:
                        pair = (e1['text'], e1['type'], e2['text'], e2['type'])
                        entity1_orig = e1['original']
                        entity2_orig = e2['original']
                    else:
                        pair = (e2['text'], e2['type'], e1['text'], e1['type'])
                        entity1_orig = e2['original']
                        entity2_orig = e1['original']

                    pair_counts[pair] += 1
                    
                    # Extract context snippet showing both entities
                    context = self._extract_relationship_context(content, entity1_orig, entity2_orig)
                    if context:
                        pair_articles[pair].append({
                            'article_id': article_id,
                            'headline': headline,
                            'context': context
                        })

            results = []
            for (entity1, type1, entity2, type2), count in pair_counts.items():
                if count >= min_count:
                    # Get up to 3 example contexts
                    examples = pair_articles[(entity1, type1, entity2, type2)][:3]
                    print(f"[DEBUG] Pair: {entity1}-{entity2}, Count: {count}, Examples: {len(examples)}")
                    if examples:
                        print(f"[DEBUG] First example: headline={examples[0].get('headline')[:50]}, context_len={len(examples[0].get('context', ''))}")
                    results.append({
                        'entity1': entity1,
                        'entity1_type': type1,
                        'entity2': entity2,
                        'entity2_type': type2,
                        'cooccurrence_count': count,
                        'examples': examples
                    })

            results.sort(key=lambda x: x['cooccurrence_count'], reverse=True)
            result = results[:limit]
            self._set_cached(cache_key, result)
            return result

        except Exception as e:
            print(f"[ERROR] Entity co-occurrence analysis failed: {e}")
            return []

    def _extract_relationship_context(self, text: str, entity1: str, entity2: str, window: int = 150) -> str:
        """Extract a snippet of text showing both entities in context"""
        try:
            text_lower = text.lower()
            e1_lower = entity1.lower()
            e2_lower = entity2.lower()
            
            # Find positions of both entities
            e1_pos = text_lower.find(e1_lower)
            e2_pos = text_lower.find(e2_lower)
            
            if e1_pos == -1 or e2_pos == -1:
                return ""
            
            # Get the span between entities plus some context
            start_pos = min(e1_pos, e2_pos)
            end_pos = max(e1_pos + len(entity1), e2_pos + len(entity2))
            
            # Add context before and after
            context_start = max(0, start_pos - window)
            context_end = min(len(text), end_pos + window)
            
            snippet = text[context_start:context_end].strip()
            
            # Add ellipsis if we cut off text
            if context_start > 0:
                snippet = "..." + snippet
            if context_end < len(text):
                snippet = snippet + "..."
                
            return snippet
            
        except Exception as e:
            return ""

    def get_topic_distribution(self) -> List[Dict]:
        cached = self._get_cached('topic_distribution')
        if cached is not None:
            return cached

        try:
            from collections import defaultdict
            articles = self.db.collection('articles').stream()

            topic_counts = defaultdict(int)
            total_articles = 0

            for doc in articles:
                data = doc.to_dict()
                topic = data.get('topic_label', 'Uncategorized')
                topic_counts[topic] += 1
                total_articles += 1

            results = []
            for topic, count in topic_counts.items():
                results.append({
                    'topic': topic,
                    'count': count,
                    'percentage': round((count / total_articles) * 100, 2) if total_articles > 0 else 0
                })

            results.sort(key=lambda x: x['count'], reverse=True)
            self._set_cached('topic_distribution', results)
            return results

        except Exception as e:
            print(f"[ERROR] Topic distribution analysis failed: {e}")
            return []

    def _normalize_date(self, date_value):
        if hasattr(date_value, 'strftime'):
            return date_value.strftime('%Y-%m-%d')
        return str(date_value) if date_value else None

    def get_keyword_frequency_over_time(self, keyword: str, start_date: Optional[str] = None,
                                        end_date: Optional[str] = None, granularity: str = 'month') -> List[Dict]:
        """Get keyword mention frequency over time

        Args:
            keyword: The keyword to track
            start_date: Start date (YYYY-MM-DD format)
            end_date: End date (YYYY-MM-DD format)
            granularity: 'day', 'week', or 'month'
        """
        try:
            from datetime import datetime
            from collections import defaultdict

            articles = self.db.collection('articles').stream()
            keyword_lower = keyword.lower()
            time_counts = defaultdict(int)

            for doc in articles:
                data = doc.to_dict()
                pub_date_raw = data.get('publication_date')
                if not pub_date_raw:
                    continue

                pub_date = self._normalize_date(pub_date_raw)
                if not pub_date:
                    continue

                if start_date and pub_date < start_date:
                    continue
                if end_date and pub_date > end_date:
                    continue

                text = (data.get('headline', '') + ' ' + data.get('full_text', '')).lower()
                if keyword_lower in text:
                    if granularity == 'day':
                        time_key = pub_date[:10]
                    elif granularity == 'week':
                        dt = datetime.fromisoformat(pub_date[:10])
                        time_key = f"{dt.year}-W{dt.isocalendar()[1]:02d}"
                    else:
                        time_key = pub_date[:7]

                    time_counts[time_key] += 1

            results = [{'date': k, 'count': v} for k, v in time_counts.items()]
            results.sort(key=lambda x: x['date'])
            return results

        except Exception as e:
            print(f"[ERROR] Keyword frequency over time failed: {e}")
            return []

    def get_entity_mentions_over_time(self, entity_name: str, start_date: Optional[str] = None,
                                     end_date: Optional[str] = None, granularity: str = 'month') -> List[Dict]:
        """Get entity mention frequency over time with sentiment"""
        try:
            from datetime import datetime
            from collections import defaultdict

            articles = self.db.collection('articles').stream()
            entity_lower = self._normalize_entity_name(entity_name).lower()
            time_data = defaultdict(lambda: {'count': 0, 'positive': 0, 'negative': 0, 'neutral': 0})

            for doc in articles:
                data = doc.to_dict()
                pub_date_raw = data.get('publication_date')
                if not pub_date_raw:
                    continue

                pub_date = self._normalize_date(pub_date_raw)
                if not pub_date:
                    continue

                if start_date and pub_date < start_date:
                    continue
                if end_date and pub_date > end_date:
                    continue

                entities = data.get('entities', [])
                entity_found = False
                for ent in entities:
                    if self._normalize_entity_name(ent.get('text', '')).lower() == entity_lower:
                        entity_found = True
                        break

                if entity_found:
                    if granularity == 'day':
                        time_key = pub_date[:10]
                    elif granularity == 'week':
                        dt = datetime.fromisoformat(pub_date[:10])
                        time_key = f"{dt.year}-W{dt.isocalendar()[1]:02d}"
                    else:
                        time_key = pub_date[:7]

                    time_data[time_key]['count'] += 1
                    sentiment = data.get('sentiment_label', 'neutral')
                    time_data[time_key][sentiment] += 1

            results = []
            for date, stats in sorted(time_data.items()):
                results.append({
                    'date': date,
                    'count': stats['count'],
                    'positive': stats['positive'],
                    'negative': stats['negative'],
                    'neutral': stats['neutral'],
                    'sentiment_score': (stats['positive'] - stats['negative']) / stats['count'] if stats['count'] > 0 else 0
                })

            return results

        except Exception as e:
            print(f"[ERROR] Entity mentions over time failed: {e}")
            return []

    def compare_entities(self, entity_names: List[str], start_date: Optional[str] = None,
                        end_date: Optional[str] = None) -> Dict:
        """Compare multiple entities across various metrics"""
        try:
            from collections import defaultdict

            articles = self.db.collection('articles').stream()
            entity_data = {name: {
                'total_mentions': 0,
                'positive': 0,
                'negative': 0,
                'neutral': 0,
                'topics': defaultdict(int),
                'cooccurrences': defaultdict(int)
            } for name in entity_names}

            normalized_entities = {self._normalize_entity_name(name).lower(): name for name in entity_names}

            for doc in articles:
                data = doc.to_dict()
                pub_date_raw = data.get('publication_date')
                if not pub_date_raw:
                    continue

                pub_date = self._normalize_date(pub_date_raw)
                if not pub_date:
                    continue

                if start_date and pub_date < start_date:
                    continue
                if end_date and pub_date > end_date:
                    continue

                entities = data.get('entities', [])
                sentiment = data.get('sentiment_label', 'neutral')
                topic = data.get('topic_label', 'Uncategorized')

                found_entities = []
                for ent in entities:
                    normalized = self._normalize_entity_name(ent.get('text', '')).lower()
                    if normalized in normalized_entities:
                        original_name = normalized_entities[normalized]
                        found_entities.append(original_name)
                        entity_data[original_name]['total_mentions'] += 1
                        entity_data[original_name][sentiment] += 1
                        entity_data[original_name]['topics'][topic] += 1

                for i, ent1 in enumerate(found_entities):
                    for ent2 in found_entities[i+1:]:
                        entity_data[ent1]['cooccurrences'][ent2] += 1
                        entity_data[ent2]['cooccurrences'][ent1] += 1

            results = {}
            for name, data in entity_data.items():
                total = data['total_mentions']
                results[name] = {
                    'total_mentions': total,
                    'sentiment': {
                        'positive': data['positive'],
                        'negative': data['negative'],
                        'neutral': data['neutral'],
                        'score': (data['positive'] - data['negative']) / total if total > 0 else 0
                    },
                    'top_topics': sorted(data['topics'].items(), key=lambda x: x[1], reverse=True)[:5],
                    'top_cooccurrences': sorted(data['cooccurrences'].items(), key=lambda x: x[1], reverse=True)[:5]
                }

            return results

        except Exception as e:
            print(f"[ERROR] Entity comparison failed: {e}")
            return {}

    def get_topic_volume_over_time(self, start_date: Optional[str] = None,
                                   end_date: Optional[str] = None, granularity: str = 'month') -> List[Dict]:
        """Get topic distribution over time"""
        try:
            from datetime import datetime
            from collections import defaultdict

            articles = self.db.collection('articles').stream()
            time_topics = defaultdict(lambda: defaultdict(int))

            for doc in articles:
                data = doc.to_dict()
                pub_date_raw = data.get('publication_date')
                if not pub_date_raw:
                    continue

                pub_date = self._normalize_date(pub_date_raw)
                if not pub_date:
                    continue

                if start_date and pub_date < start_date:
                    continue
                if end_date and pub_date > end_date:
                    continue

                topic = data.get('topic_label', 'Uncategorized')

                if granularity == 'day':
                    time_key = pub_date[:10]
                elif granularity == 'week':
                    dt = datetime.fromisoformat(pub_date[:10])
                    time_key = f"{dt.year}-W{dt.isocalendar()[1]:02d}"
                else:
                    time_key = pub_date[:7]

                time_topics[time_key][topic] += 1

            results = []
            for date in sorted(time_topics.keys()):
                entry = {'date': date}
                entry.update(time_topics[date])
                results.append(entry)

            return results

        except Exception as e:
            print(f"[ERROR] Topic volume over time failed: {e}")
            return []

    def get_location_analytics(self, start_date: Optional[str] = None,
                               end_date: Optional[str] = None) -> Dict:
        """Get geographic analytics - top locations, their topics, and sentiment"""
        try:
            from collections import defaultdict

            articles = self.db.collection('articles').stream()
            location_data = defaultdict(lambda: {
                'count': 0,
                'topics': defaultdict(int),
                'sentiment': {'positive': 0, 'negative': 0, 'neutral': 0},
                'over_time': defaultdict(int)
            })

            for doc in articles:
                data = doc.to_dict()
                pub_date_raw = data.get('publication_date')
                if not pub_date_raw:
                    continue

                pub_date = self._normalize_date(pub_date_raw)
                if not pub_date:
                    continue

                if start_date and pub_date < start_date:
                    continue
                if end_date and pub_date > end_date:
                    continue

                entities = data.get('entities', [])
                sentiment = data.get('sentiment_label', 'neutral')
                topic = data.get('topic_label', 'Uncategorized')
                month = pub_date[:7]

                for ent in entities:
                    if ent.get('label') == 'GPE':
                        location = self._normalize_entity_name(ent.get('text', '')).title()
                        location_data[location]['count'] += 1
                        location_data[location]['topics'][topic] += 1
                        location_data[location]['sentiment'][sentiment] += 1
                        location_data[location]['over_time'][month] += 1

            results = []
            for location, data in sorted(location_data.items(), key=lambda x: x[1]['count'], reverse=True)[:20]:
                total = data['count']
                results.append({
                    'location': location,
                    'total_mentions': total,
                    'top_topics': sorted(data['topics'].items(), key=lambda x: x[1], reverse=True)[:3],
                    'sentiment': data['sentiment'],
                    'sentiment_score': (data['sentiment']['positive'] - data['sentiment']['negative']) / total if total > 0 else 0,
                    'timeline': [{'date': k, 'count': v} for k, v in sorted(data['over_time'].items())]
                })

            return {'locations': results}

        except Exception as e:
            print(f"[ERROR] Location analytics failed: {e}")
            return {'locations': []}

    def upload_newspaper_image(self, image_path: str, newspaper_id: str) -> Optional[str]:
        if not self.bucket:
            print("[WARNING] Firebase Storage not initialized - check FIREBASE_STORAGE_BUCKET env variable")
            return None

        try:
            from pathlib import Path
            import os

            if not os.path.exists(image_path):
                print(f"[ERROR] Image file does not exist: {image_path}")
                return None

            filename = Path(image_path).name
            storage_path = f"newspapers/{newspaper_id}/{filename}"

            print(f"[INFO] Uploading {image_path} to {storage_path}")
            blob = self.bucket.blob(storage_path)
            blob.upload_from_filename(image_path)

            blob.make_public()

            public_url = blob.public_url
            print(f"[OK] Uploaded image to Storage: {storage_path}")
            return public_url

        except Exception as e:
            import traceback
            print(f"[ERROR] Failed to upload image to Storage: {e}")
            print(f"[ERROR] Traceback: {traceback.format_exc()}")
            return None

    def upload_ad_image(self, image_path: str, newspaper_id: str, ad_id: str) -> Optional[str]:
        """Upload a cropped ad image to Firebase Storage."""
        if not self.bucket:
            return None
        try:
            storage_path = f"ads/{newspaper_id}/{ad_id}.jpg"
            blob = self.bucket.blob(storage_path)
            blob.upload_from_filename(image_path, content_type='image/jpeg')
            blob.make_public()
            return blob.public_url
        except Exception as e:
            print(f"[ERROR] Failed to upload ad image: {e}")
            return None

    def delete_article(self, article_id: str) -> bool:
        """
        Delete an article from Firestore.
        Returns True if successful, False otherwise.
        """
        try:
            # Delete the article document
            self.db.collection('articles').document(article_id).delete()
            print(f"[OK] Deleted article: {article_id}")
            
            # Clear cache if it exists
            cache_key = f"article_{article_id}"
            if cache_key in self._cache:
                del self._cache[cache_key]
                if cache_key in self._cache_timestamp:
                    del self._cache_timestamp[cache_key]
            
            return True
        except Exception as e:
            print(f"[ERROR] Failed to delete article: {e}")
            return False
    
    def delete_newspaper(self, newspaper_id: str, delete_articles: bool = True) -> bool:
        """
        Delete a newspaper and optionally its associated articles.
        
        Args:
            newspaper_id: The ID of the newspaper to delete
            delete_articles: If True, also delete all articles belonging to this newspaper
        
        Returns True if successful, False otherwise.
        """
        try:
            # Delete associated articles if requested
            if delete_articles:
                articles_ref = self.db.collection('articles').where(filter=FieldFilter('newspaper_id', '==', newspaper_id))
                articles_docs = list(articles_ref.stream())
                
                for doc in articles_docs:
                    doc.reference.delete()
                
                print(f"[OK] Deleted {len(articles_docs)} articles for newspaper: {newspaper_id}")
            
            # Delete the newspaper document
            self.db.collection('newspapers').document(newspaper_id).delete()
            print(f"[OK] Deleted newspaper: {newspaper_id}")
            
            # Try to delete associated image from Storage
            if self.bucket:
                try:
                    blobs = self.bucket.list_blobs(prefix=f"newspapers/{newspaper_id}/")
                    for blob in blobs:
                        blob.delete()
                        print(f"[OK] Deleted storage file: {blob.name}")
                except Exception as e:
                    print(f"[WARNING] Could not delete storage files: {e}")
            
            return True
        except Exception as e:
            print(f"[ERROR] Failed to delete newspaper: {e}")
            return False

    # ─── Story methods ────────────────────────────────────────────────────────

    def _serialize_story(self, story: Dict) -> Dict:
        """Convert Firestore Timestamps to ISO strings for API responses."""
        for field in ('start_date', 'end_date', 'created_at', 'updated_at', 'narrative_generated_at'):
            val = story.get(field)
            if val and hasattr(val, 'isoformat'):
                story[field] = val.isoformat()
        return story

    def create_story(self, seed_article: Dict) -> str:
        """Create a new story document seeded from a single article. Returns story_id."""
        import uuid
        story_id = str(uuid.uuid4())

        article_entities = _extract_story_entities(seed_article.get('entities', []))
        key_entities = [
            {'text': e, 'type': _get_entity_type(e, seed_article.get('entities', [])), 'article_count': 1}
            for e in article_entities
        ]

        pub_date = seed_article.get('publication_date')
        topic_label = seed_article.get('topic_label', '') or 'Uncategorized'

        top_texts = [e['text'].title() for e in key_entities[:3]]
        title = ' · '.join(top_texts) if top_texts else topic_label

        story_doc = {
            'id': story_id,
            'title': title,
            'topic_id': seed_article.get('topic_id'),
            'topic_label': topic_label,
            'article_ids': [seed_article['id']],
            'article_count': 1,
            'start_date': pub_date,
            'end_date': pub_date,
            'date_span_days': 0,
            'key_entities': key_entities,
            'narrative': None,
            'narrative_generated_at': None,
            'avg_sentiment_score': seed_article.get('sentiment_score', 0.0),
            'dominant_sentiment': seed_article.get('sentiment_label', 'neutral'),
            '_label_counts': {seed_article.get('sentiment_label', 'neutral'): 1},
            'newspaper_ids': [seed_article.get('newspaper_id', '')],
            'created_at': firestore.SERVER_TIMESTAMP,
            'updated_at': firestore.SERVER_TIMESTAMP,
        }

        self.db.collection('stories').document(story_id).set(story_doc)
        print(f"[OK] Created new story: {story_id} | {title}")
        return story_id

    def get_story(self, story_id: str) -> Optional[Dict]:
        """Fetch a single story document by ID."""
        try:
            doc = self.db.collection('stories').document(story_id).get()
            if doc.exists:
                return doc.to_dict()
            return None
        except Exception as e:
            print(f"[ERROR] Failed to get story {story_id}: {e}")
            return None

    def list_stories(
        self,
        limit: int = 20,
        offset: int = 0,
        topic_id: Optional[int] = None,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None
    ) -> List[Dict]:
        """List stories ordered by start_date descending."""
        try:
            query = self.db.collection('stories').order_by('start_date', direction='DESCENDING')

            if topic_id is not None:
                query = query.where('topic_id', '==', topic_id)

            # Fetch more than needed to allow for Python-side date filtering
            fetch_limit = (limit + offset) * 3 if (start_date or end_date) else limit + offset
            docs = list(query.limit(fetch_limit).stream())

            stories = []
            for doc in docs:
                data = doc.to_dict()
                if start_date:
                    sd = data.get('start_date')
                    sd_str = sd.isoformat()[:10] if hasattr(sd, 'isoformat') else str(sd)[:10]
                    if sd_str < start_date:
                        continue
                if end_date:
                    ed = data.get('end_date')
                    ed_str = ed.isoformat()[:10] if hasattr(ed, 'isoformat') else str(ed)[:10]
                    if ed_str > end_date:
                        continue
                data.pop('_label_counts', None)
                stories.append(self._serialize_story(data))

            return stories[offset:offset + limit]
        except Exception as e:
            print(f"[ERROR] list_stories failed: {e}")
            return []

    def find_story_for_article(
        self,
        article: Dict,
        date_window_days: int = 30,
        jaccard_threshold: float = 0.15
    ) -> Optional[str]:
        """Find the best matching story for an article. Returns story_id or None."""
        topic_id = article.get('topic_id')
        if topic_id is None or topic_id == -1:
            return None

        pub_date = article.get('publication_date')
        if not pub_date:
            return None

        article_entities = _extract_story_entities(article.get('entities', []))
        if not article_entities:
            return None

        window_start = pub_date - timedelta(days=date_window_days)

        try:
            candidates = self.db.collection('stories')\
                .where('topic_id', '==', topic_id)\
                .where('end_date', '>=', window_start)\
                .stream()
        except Exception as e:
            print(f"[ERROR] Story candidate query failed: {e}")
            return None

        best_story_id = None
        best_score = 0.0

        for doc in candidates:
            story = doc.to_dict()

            story_start = story.get('start_date')
            if story_start and story_start > pub_date + timedelta(days=date_window_days):
                continue

            story_entity_set = {e['text'].lower() for e in story.get('key_entities', [])}
            score = _jaccard_similarity(article_entities, story_entity_set)

            if score > best_score and score >= jaccard_threshold:
                best_score = score
                best_story_id = story['id']

        if best_story_id:
            print(f"[OK] Matched article to story {best_story_id} (Jaccard={best_score:.2f})")
        else:
            print(f"[INFO] No story match found (best Jaccard={best_score:.2f})")

        return best_story_id

    def add_article_to_story(self, story_id: str, article: Dict) -> bool:
        """Add an article to an existing story using a Firestore transaction."""
        story_ref = self.db.collection('stories').document(story_id)
        article_ref = self.db.collection('articles').document(article['id'])

        @firestore.transactional
        def _update(transaction, story_ref, article_ref):
            story_snap = story_ref.get(transaction=transaction)
            if not story_snap.exists:
                raise ValueError(f"Story {story_id} not found")

            story = story_snap.to_dict()

            existing_ids = story.get('article_ids', [])
            if article['id'] in existing_ids:
                return  # already in story

            new_ids = existing_ids + [article['id']]
            article_count = len(new_ids)

            pub_date = article.get('publication_date')
            new_start = min(story['start_date'], pub_date)
            new_end = max(story['end_date'], pub_date)
            span_days = (new_end - new_start).days

            # Merge entities
            entity_map = {e['text'].lower(): e for e in story.get('key_entities', [])}
            for ent_text in _extract_story_entities(article.get('entities', [])):
                if ent_text in entity_map:
                    entity_map[ent_text]['article_count'] += 1
                else:
                    entity_map[ent_text] = {
                        'text': ent_text,
                        'type': _get_entity_type(ent_text, article.get('entities', [])),
                        'article_count': 1
                    }
            merged_entities = sorted(entity_map.values(), key=lambda x: x['article_count'], reverse=True)[:20]

            # Rolling avg sentiment
            old_avg = story.get('avg_sentiment_score', 0.0)
            old_count = story.get('article_count', 1)
            new_avg = (old_avg * old_count + article.get('sentiment_score', 0.0)) / article_count

            label_counts = story.get('_label_counts', {'positive': 0, 'neutral': 0, 'negative': 0})
            label = article.get('sentiment_label', 'neutral')
            label_counts[label] = label_counts.get(label, 0) + 1
            dominant = max(label_counts, key=label_counts.get)

            newspaper_ids = list(set(story.get('newspaper_ids', []) + [article.get('newspaper_id', '')]))

            transaction.update(story_ref, {
                'article_ids': new_ids,
                'article_count': article_count,
                'start_date': new_start,
                'end_date': new_end,
                'date_span_days': span_days,
                'key_entities': merged_entities,
                'avg_sentiment_score': round(new_avg, 3),
                'dominant_sentiment': dominant,
                '_label_counts': label_counts,
                'newspaper_ids': newspaper_ids,
                'narrative': None,
                'narrative_generated_at': None,
                'updated_at': firestore.SERVER_TIMESTAMP,
            })
            transaction.update(article_ref, {'story_id': story_id})

        transaction = self.db.transaction()
        _update(transaction, story_ref, article_ref)
        print(f"[OK] Added article {article['id']} to story {story_id}")
        return True

    # ─────────────────────────────────────────────────────────────────────────

    def close(self):
        print("[OK] Firestore connection closed")


_db_instance = None

def get_db() -> FirestoreDB:
    global _db_instance
    if _db_instance is None:
        _db_instance = FirestoreDB()
    return _db_instance


def get_firestore_db() -> FirestoreDB:
    return get_db()
