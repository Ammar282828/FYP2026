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

# Per-call socket timeout for Storage uploads. Without it,
# `blob.upload_from_filename(...)` blocks forever when the underlying
# TCP connection silently dies (NAT timeout, dropped FIN/RST, server
# abort) — same recv()-on-dead-socket pattern that caused the v4
# pipeline 8-hour stall on Gemini. Override via STORAGE_REQUEST_TIMEOUT.
_UPLOAD_TIMEOUT = float(os.getenv('STORAGE_REQUEST_TIMEOUT', '180'))

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
        # 24h — data is a historical archive and only changes on writes,
        # which call _clear_analytics_cache() to invalidate.
        self._cache_ttl = 86400
        # Persist cache to disk so analytics is instant across server restarts.
        self._cache_file = os.getenv('ANALYTICS_CACHE_FILE', '.analytics_cache.json')
        self._load_persistent_cache()

        # Shared in-memory snapshot of every article doc. The Analytics
        # dashboard fires ~7 endpoints in parallel; without this each one
        # would launch its own full collection scan. The snapshot is
        # populated once under a lock and reused by every aggregator.
        import threading
        self._articles_snapshot = None
        self._articles_snapshot_ts = 0.0
        self._snapshot_lock = threading.Lock()

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
        # Persist to disk so restarts don't lose warm cache.
        try:
            self._save_persistent_cache()
        except Exception as e:
            print(f"[CACHE WARN] Failed to persist cache: {e}")

    def _load_persistent_cache(self):
        """Load cached analytics from disk, skipping expired entries."""
        import time
        try:
            if not os.path.exists(self._cache_file):
                return
            with open(self._cache_file, 'r') as f:
                payload = json.load(f)
            entries = payload.get('entries', {})
            timestamps = payload.get('timestamps', {})
            now = time.time()
            loaded = 0
            for key, value in entries.items():
                ts = timestamps.get(key, 0)
                if now - ts < self._cache_ttl:
                    self._cache[key] = value
                    self._cache_timestamp[key] = ts
                    loaded += 1
            if loaded:
                print(f"[CACHE] Loaded {loaded} persisted analytics entries from {self._cache_file}")
        except Exception as e:
            print(f"[CACHE WARN] Failed to load persisted cache: {e}")

    def _save_persistent_cache(self):
        """Write current cache snapshot to disk atomically.

        Holds a per-instance lock — without it, concurrent _set_cached()
        calls race on the same .tmp filename and the loser hits
        ENOENT on os.replace().
        """
        if not hasattr(self, '_cache_write_lock'):
            import threading
            self._cache_write_lock = threading.Lock()
        with self._cache_write_lock:
            try:
                payload = {
                    'entries': self._cache,
                    'timestamps': self._cache_timestamp,
                }
                tmp_path = self._cache_file + '.tmp'
                with open(tmp_path, 'w') as f:
                    json.dump(payload, f, default=str)
                os.replace(tmp_path, self._cache_file)
            except (TypeError, ValueError) as e:
                # Value not JSON-serializable — skip silently.
                print(f"[CACHE WARN] Non-serializable cache value skipped: {e}")

    # ─── Firestore quota cool-down ──────────────────────────────────────────
    # When Firestore returns 429 / DeadlineExceeded, every retry blocks for
    # ~5 minutes. We mark the client as "blocked" for a short window so
    # subsequent calls fail fast instead of stacking 5-minute waits.
    _FIRESTORE_COOLDOWN_SECONDS = 60

    def _is_firestore_blocked(self) -> bool:
        import time
        until = getattr(self, '_firestore_blocked_until', 0)
        return until > time.time()

    def _maybe_mark_firestore_blocked(self, exc):
        import time
        msg = str(exc).lower()
        if any(s in msg for s in ('429', 'quota', 'deadline', 'exhausted', 'unavailable',
                                   'timed out', 'timeout', 'exceeded')) or isinstance(exc, TimeoutError):
            self._firestore_blocked_until = time.time() + self._FIRESTORE_COOLDOWN_SECONDS
            print(f"[FIRESTORE COOLDOWN] Blocked for {self._FIRESTORE_COOLDOWN_SECONDS}s after: {exc}")

    def _run_with_deadline(self, func, deadline_seconds: float = 10.0, label: str = ''):
        """Run a callable in a daemon thread with a hard wall-clock deadline.

        Required because Firestore SDK retries swallow per-RPC timeouts and
        can stretch a single failed call to 5 minutes. We use a daemon
        thread so the response can return even if the underlying RPC
        continues to hang in the background — the leaked thread won't
        block process exit.
        """
        import threading
        result_box = []
        exc_box = []

        def runner():
            try:
                result_box.append(func())
            except BaseException as e:  # noqa: BLE001
                exc_box.append(e)

        t = threading.Thread(target=runner, daemon=True, name=f"firestore-deadline:{label}")
        t.start()
        t.join(deadline_seconds)
        if t.is_alive():
            msg = f"{label or func.__name__} exceeded {deadline_seconds}s"
            print(f"[FIRESTORE DEADLINE] {msg}")
            self._maybe_mark_firestore_blocked(TimeoutError(msg))
            raise TimeoutError(msg)
        if exc_box:
            raise exc_box[0]
        return result_box[0] if result_box else None

    # Persist the full-collection snapshot to disk too. The aggregates
    # already use the in-memory cache, but if Firestore quota is exhausted
    # at startup the next-best thing is to serve from yesterday's snapshot
    # rather than 500-error every analytics endpoint.
    _SNAPSHOT_FILE = '.articles_snapshot.json'

    def _load_snapshot_from_disk(self):
        import time
        try:
            path = os.getenv('ARTICLES_SNAPSHOT_FILE', self._SNAPSHOT_FILE)
            if not os.path.exists(path):
                return
            with open(path, 'r') as f:
                payload = json.load(f)
            ts = payload.get('timestamp', 0)
            articles = payload.get('articles', [])
            if articles and time.time() - ts < self._cache_ttl:
                self._articles_snapshot = articles
                self._articles_snapshot_ts = ts
                print(f"[SNAPSHOT] Loaded {len(articles)} articles from disk cache")
        except Exception as e:
            print(f"[SNAPSHOT WARN] Could not read disk snapshot: {e}")

    def _save_snapshot_to_disk(self):
        try:
            path = os.getenv('ARTICLES_SNAPSHOT_FILE', self._SNAPSHOT_FILE)
            tmp = path + '.tmp'
            with open(tmp, 'w') as f:
                json.dump({
                    'timestamp': self._articles_snapshot_ts,
                    'articles': self._articles_snapshot,
                }, f, default=str)
            os.replace(tmp, path)
        except Exception as e:
            print(f"[SNAPSHOT WARN] Could not write disk snapshot: {e}")

    def _get_articles_snapshot(self) -> List[Dict]:
        """Return every article doc as a list of dicts.

        Loaded once and shared across all analytics aggregators. Without
        this, the Analytics dashboard's parallel endpoint fan-out would
        trigger N independent full collection scans.

        Held under a lock so concurrent first-callers don't each kick off
        their own scan; subsequent callers within the TTL get the cached
        list immediately.

        Backed by a disk snapshot — if Firestore is unavailable (quota,
        cool-down) we fall back to the most recent on-disk copy rather
        than failing every analytics endpoint.
        """
        import time
        if (
            self._articles_snapshot is not None
            and time.time() - self._articles_snapshot_ts < self._cache_ttl
        ):
            return self._articles_snapshot

        with self._snapshot_lock:
            # Double-check inside the lock — another thread may have
            # populated it while we were waiting.
            if (
                self._articles_snapshot is not None
                and time.time() - self._articles_snapshot_ts < self._cache_ttl
            ):
                return self._articles_snapshot

            # Try the disk cache first — instant, no Firestore reads.
            self._load_snapshot_from_disk()
            if self._articles_snapshot is not None:
                return self._articles_snapshot

            # Skip the live fetch if we're already in cool-down. Cache an
            # empty snapshot for the cool-down so concurrent callers don't
            # each retry the 30s deadline.
            if self._is_firestore_blocked():
                print("[SNAPSHOT] Firestore in cool-down, returning empty")
                self._articles_snapshot = []
                self._articles_snapshot_ts = time.time()
                return []

            def _scan():
                # Paginated scan: an unindexed `.stream()` over the whole
                # `articles` collection now hits Firestore's server-side
                # query timeout (~60s) once we pass ~30k docs, and the
                # SDK's retry path crashes with an AttributeError on the
                # resulting 503. Page through in chunks of 5k ordered by
                # __name__ so each page is a small, fresh query.
                from google.cloud.firestore_v1.base_query import FieldFilter  # noqa
                PAGE = 5000
                out = []
                last_id = None
                # Out-of-corpus dates leak in from new ingest runs whose
                # OCR misread the masthead — without this, a 1996 stray
                # would push the dashboard's "Coverage Period" KPI to
                # "1990-01 to 1996-09". Filter at snapshot time so the
                # leak never reaches any analytics endpoint.
                VALID_YMS = {f'1990-{m:02d}' for m in range(1, 13)} | {'1991-01'}
                def _in_corpus(data: dict) -> bool:
                    pd = data.get('publication_date')
                    if not pd:
                        return False
                    if hasattr(pd, 'isoformat'):
                        return pd.isoformat()[:7] in VALID_YMS
                    return str(pd)[:7] in VALID_YMS
                while True:
                    q = self.db.collection('articles').order_by('__name__').limit(PAGE)
                    if last_id is not None:
                        q = q.start_after({'__name__': last_id})
                    docs = list(q.stream())
                    if not docs:
                        break
                    for d in docs:
                        data = d.to_dict()
                        if _in_corpus(data):
                            out.append(data)
                    last_id = docs[-1].id
                    if len(docs) < PAGE:
                        break
                return out

            try:
                t0 = time.time()
                # 4243+ docs with full article content takes ~30s end-to-end
                # over the wire; give the first load enough headroom to
                # actually finish so subsequent requests can serve from cache.
                # Paginated scan above means each page is fast — 90s is
                # plenty for 30k+ docs split into 5k pages.
                articles = self._run_with_deadline(_scan, deadline_seconds=180, label='articles_snapshot')
                self._articles_snapshot = articles
                self._articles_snapshot_ts = time.time()
                print(f"[SNAPSHOT] Loaded {len(articles)} articles from Firestore in {time.time() - t0:.2f}s")
                self._save_snapshot_to_disk()
                return articles
            except Exception as e:
                print(f"[SNAPSHOT ERROR] {e}")
                self._maybe_mark_firestore_blocked(e)
                # Cache the empty result so concurrent endpoints don't each
                # block on the deadline.
                self._articles_snapshot = []
                self._articles_snapshot_ts = time.time()
                return []

    def _clear_analytics_cache(self):
        """Clear all analytics caches when new data is written."""
        keys_to_clear = [k for k in self._cache if k != 'article_count']
        for k in keys_to_clear:
            self._cache.pop(k, None)
            self._cache_timestamp.pop(k, None)
        # Update article_count cache too
        self._cache.pop('article_count', None)
        self._cache_timestamp.pop('article_count', None)
        # Drop the in-memory and on-disk articles snapshot so the next
        # read picks up the newly written data.
        self._articles_snapshot = None
        self._articles_snapshot_ts = 0.0
        try:
            path = os.getenv('ARTICLES_SNAPSHOT_FILE', self._SNAPSHOT_FILE)
            if os.path.exists(path):
                os.remove(path)
        except Exception as e:
            print(f"[SNAPSHOT WARN] Failed to delete disk snapshot: {e}")
        # Remove persisted file so next restart starts clean.
        try:
            if os.path.exists(self._cache_file):
                os.remove(self._cache_file)
        except Exception as e:
            print(f"[CACHE WARN] Failed to delete persisted cache: {e}")
        print("[CACHE CLEARED] Analytics cache invalidated due to new data")

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
            self._clear_analytics_cache()

            print(f"[OK] Stored article: {article_id}")
            return article_id

        except Exception as e:
            print(f"[ERROR] Failed to store article: {e}")
            raise

    def get_article_count(self) -> int:
        cached = self._get_cached('article_count')
        if cached is not None:
            return cached
        # Prefer the shared snapshot (it has a wall-clock deadline so it
        # can never hang the way a raw .select().stream() can during a
        # quota outage).
        if self._articles_snapshot is not None:
            count = len(self._articles_snapshot)
        elif self._is_firestore_blocked():
            return 0
        else:
            articles = self._get_articles_snapshot()
            count = len(articles)
        if count > 0:
            self._set_cached('article_count', count)
        return count

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
        """Substring search across headline + content, ranked by mentions then recency.

        Reads from `_get_articles_snapshot()` so we don't stream the entire
        4k-doc collection over the wire on every search request — the
        snapshot is shared with all the analytics endpoints and held under
        a TTL cache.
        """
        query_lower = (query or '').lower().strip()
        if not query_lower:
            return []

        try:
            articles = self._get_articles_snapshot()
        except Exception as e:
            print(f"[ERROR] search_articles snapshot failed: {e}")
            return []

        results_with_score = []
        for data in articles:
            # Skip OCR-noise articles flagged by the cleanup script.
            # Their headlines are typically pure "[ILLEGIBLE]" or share
            # one short fragment across many docs, which dominated the
            # search ranking for short queries.
            if data.get('low_quality'):
                continue
            headline = (data.get('headline') or '').lower()
            content = (data.get('content') or '').lower()
            combined = headline + ' ' + content
            if query_lower not in combined:
                continue
            mentions = combined.count(query_lower)
            # Headline matches count more than body matches.
            if query_lower in headline:
                mentions += 3
            ca = data.get('created_at')
            ts = ca.timestamp() if ca and hasattr(ca, 'timestamp') else 0
            results_with_score.append((mentions, ts, data))

        results_with_score.sort(key=lambda x: (x[0], x[1]), reverse=True)
        return [item[2] for item in results_with_score[:limit]]

    def search_by_entity(self, entity_name: str, entity_type: Optional[str] = None, limit: int = 50) -> List[Dict]:
        """Find articles whose `entities` list contains a match for `entity_name`.

        Previous version capped at the first 300 docs from Firestore — so
        common entities like "Karachi" only surfaced a tiny fraction of
        their actual mentions. Now scans the full cached snapshot and
        also accepts substring matches (so "Karachi" finds "Karachi,"
        "Karachi University", etc.).
        """
        target = (entity_name or '').lower().strip()
        if not target:
            return []

        try:
            articles = self._get_articles_snapshot()
        except Exception as e:
            print(f"[ERROR] search_by_entity snapshot failed: {e}")
            return []

        results = []
        for data in articles:
            if data.get('low_quality'):
                continue
            entities = data.get('entities') or []
            if not isinstance(entities, list):
                continue
            for entity in entities:
                if not isinstance(entity, dict):
                    continue
                text = (entity.get('text') or '').lower().strip()
                if not text:
                    continue
                # Exact match, or `target` is a whole-word substring of `text`
                # (so "Karachi" hits "Karachi University" but not "Bukhari").
                if text == target or target in text.split() or text in target.split():
                    if entity_type is None or entity.get('type') == entity_type:
                        results.append(data)
                        break
            if len(results) >= limit:
                break
        return results

    def get_analytics_articles_over_time(self) -> List[Dict]:
        cached = self._get_cached('articles_over_time')
        if cached is not None:
            return cached

        try:
            articles = self._get_articles_snapshot()

            monthly_counts = {}
            for data in articles:
                if data.get('low_quality'):
                    continue
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
            articles = self._get_articles_snapshot()

            monthly_sentiment = {}
            for data in articles:
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
            articles = self._get_articles_snapshot()

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
                'five', 'six', 'seven', 'eight', 'nine', 'ten', 'said', 'page', 'continued', 'back',
                # OCR-noise tokens — without these, "illegible" was the #1
                # keyword by a wide margin (35k+ mentions from every
                # [ILLEGIBLE] placeholder in the corpus).
                'illegible', 'unreadable', 'unclear', 'unintelligible', 'visible', 'placeholder',
                # Generic/structural words that dominate the chart with
                # zero analytical value — equivalent of "stopwords for
                # historians".
                'against', 'people', 'first', 'last', 'years', 'year', 'time', 'today', 'yesterday',
                'tomorrow', 'week', 'month', 'months', 'days', 'made', 'make', 'take', 'taken',
                'including', 'according', 'told', 'told', 'told',
            }

            # Skip flagged-low-quality articles entirely so their
            # placeholder-heavy bodies don't poison the keyword counts.
            for data in articles:
                if data.get('low_quality'):
                    continue
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

    # Common spaCy false-positives we never want as top entities. These
    # are short, generic tokens the NER tags as ORG/GPE/PERSON when they're
    # really role descriptors, fragments of longer phrases, or OCR'd noise.
    # Adding to this list filters them out at normalization time, which is
    # cheaper than running another scrub pass over the whole corpus.
    _ENTITY_BLOCKLIST = frozenset({
        # OCR-noise tokens (kept out of every chart)
        'illegible', 'unreadable', 'unclear',

        # Role/byline descriptors that get tagged PERSON/ORG
        'joint', 'joint director', 'staff reporter', 'correspondent',

        # Wire-service names that cluster into PERSON spuriously
        'reuter', 'reuters', 'afp', 'app', 'ap', 'ppi', 'ipa', 'dpa', 'xinhua', 'tass',
        'pti', 'unb',

        # Almost always part of a longer org name (Anjuman-i-…-Islam, etc.)
        'islam',

        # The newspaper itself — appearing in mastheads & bylines on every page
        # blows up the chart with self-references that aren't useful "topics".
        'dawn', 'the dawn', 'dawn newspaper', 'dawn islamabad bureau',
        'dawn lahore bureau', 'dawn karachi bureau', 'lahore bureau',
        'islamabad bureau', 'karachi bureau', 'herald',

        # Generic government/legal nouns spaCy promotes to ORG. They tell
        # you nothing about *which* org and crowd out real names like PPP.
        'government', 'federal government', 'state', 'press', 'house',
        'parliament',  # use 'national assembly' / 'senate' instead
        'cabinet',
        'ministry',  # too generic without the specific ministry suffix

        # Date words / weekdays that occasionally slip through DATE filter
        'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday',
        'jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
    })

    # Names that NER consistently mis-types — keep them but route to the
    # correct type. spaCy's en_core_web_sm tags Pakistani city names as
    # PERSON because it sees them in surname-shaped contexts ("Mr Bhutto
    # of Larkana" → both tagged PERSON). Adding to this set drops the
    # wrong-type entry from the People chart; the GPE/ORG entry still
    # surfaces under the correct filter.
    _ENTITY_PERSON_TO_GPE = frozenset({
        # Sindh + Punjab cities mis-tagged PERSON
        'larkana', 'sukkur', 'sialkot', 'nawabshah', 'hyderabad',
        'multan', 'gujranwala', 'rawalpindi', 'peshawar', 'quetta',
        'faisalabad', 'bahawalpur', 'gujrat', 'sahiwal', 'sargodha',
        'mardan', 'mirpur', 'shikarpur', 'thatta', 'jacobabad',
        # Ethnic groups that mis-tag PERSON instead of NORP
        'mohajirs', 'pathans', 'baluchis', 'sindhis', 'punjabis',
        # Orgs / acronyms that mis-tag PERSON
        'pia', 'wapda', 'oic', 'unb',
        # Common nouns that mis-tag PERSON in title-case context.
        # "Bill" appears as PERSON because spaCy sees it in proper-noun
        # position ("a Bill was tabled"); 99% of mentions in this corpus
        # are about parliamentary bills, not people named Bill.
        'bill', 'bills', 'budget', 'cabinet', 'committee',
        'opposition', 'governor', 'speaker', 'minister', 'secretary',
    })

    # Surnames that collapse multiple distinct people into one chart
    # entry when used alone. "Hussain" alone could be Saddam Hussein,
    # Altaf Hussain (MQM), Mushahid Hussain, Iqbal Hussain — all of
    # whom appear in Dawn coverage as separate full names. Drop the
    # bare surname so the specific full names dominate the chart.
    _AMBIGUOUS_SURNAMES = frozenset({
        'hussain', 'hussein',          # Saddam / Altaf / Mushahid / etc.
        'khan',                        # too many to list
        'sharif',                      # Nawaz / Shahbaz / Mian
        'bhutto',                      # Z.A. / Benazir / Mir Murtaza
        'shah',                        # title-suffix as well
        'ahmed', 'ahmad',
        'malik',
        'chaudhry', 'chowdhury',
        'qureshi',
        'siddiqui',
    })

    def _normalize_entity_name(self, entity_text: str) -> str:
        entity_lower = entity_text.lower().strip()

        # Strip leading articles spaCy keeps in the entity span:
        # "the Pakistan International Airlines" → "Pakistan International Airlines"
        for prefix in ('the ', 'a ', 'an '):
            if entity_lower.startswith(prefix):
                entity_lower = entity_lower[len(prefix):]
                entity_text = entity_text[len(prefix):]
                break

        # Drop generic-noise tokens before any normalization runs.
        if entity_lower in self._ENTITY_BLOCKLIST:
            return ''  # caller filters empty strings out via the len(entity_text) < 3 check

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
        cache_key = f'sentiment_by_entity_{entity_type}_{limit}'
        cached = self._get_cached(cache_key)
        if cached is not None:
            return cached

        try:
            articles = self._get_articles_snapshot()

            entity_sentiment = {}

            for data in articles:
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

            result = filtered_entities[:limit]
            self._set_cached(cache_key, result)
            return result

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
            articles = self._get_articles_snapshot()

            entity_counts = {}

            for data in articles:

                if start_date or end_date:
                    pub_date_raw = data.get('publication_date')
                    pub_date = self._normalize_date(pub_date_raw)
                    if start_date and pub_date and pub_date < start_date:
                        continue
                    if end_date and pub_date and pub_date > end_date:
                        continue

                # Skip flagged-low-quality articles: their entities are
                # often spaCy artefacts from heavy [ILLEGIBLE] noise (e.g.
                # "ILLEGIBLE" itself extracted as ORG, fragmented byline
                # cities double-counted). Including them inflates the top
                # entity chart with garbage and pushes real names down.
                if data.get('low_quality'):
                    continue

                entities = data.get('entities', [])

                # PER-ARTICLE DEDUP: previously we incremented `count` for
                # every mention, so a story with "Karachi" five times added
                # 5 to Karachi's total. The result was the dateline city
                # (always one mention per dateline + many in the body)
                # dwarfing every other entity. Now count each entity at
                # most once per article — the chart now reflects "how many
                # *distinct articles* mention X", which is the question
                # users actually want answered.
                seen_in_article = set()

                for entity in entities:
                    entity_text = entity.get('text', '')
                    entity_type_val = entity.get('type', '')

                    if entity_type_val in ['DATE', 'TIME', 'CARDINAL', 'ORDINAL', 'QUANTITY', 'MONEY', 'PERCENT']:
                        continue

                    if len(entity_text) < 3 or entity_text.isdigit():
                        continue

                    # NER mis-types: the chunk of names below routinely
                    # arrive tagged PERSON when they're really cities (in
                    # Sindh, near Bhutto's hometown) or orgs (PIA). When
                    # filtering by entity_type=PERSON, drop them so they
                    # don't pollute the "Top People" chart. They still
                    # appear under the corrected type when caller asks
                    # for ORG / GPE specifically (or no filter).
                    if (entity_type_val == 'PERSON'
                            and entity_text.lower() in self._ENTITY_PERSON_TO_GPE):
                        continue

                    # Bare surnames collapse multiple distinct people
                    # ("Hussain" → Saddam / Altaf / Mushahid Hussain).
                    # Drop the surname-only mention so the full names
                    # surface separately. The full-name version
                    # ("Saddam Hussein") still counts because it has a
                    # space and isn't in the blocklist.
                    if (entity_type_val == 'PERSON'
                            and ' ' not in entity_text
                            and entity_text.lower() in self._AMBIGUOUS_SURNAMES):
                        continue

                    if entity_type and entity_type_val != entity_type:
                        continue

                    normalized_text = self._normalize_entity_name(entity_text)

                    # Normalizer returns '' for blocklisted tokens
                    # ("Joint", "Reuter", weekday names, etc.) — drop them.
                    if not normalized_text or len(normalized_text) < 3:
                        continue

                    entity_key = (normalized_text, entity_type_val)

                    # Only count this entity once per article.
                    if entity_key in seen_in_article:
                        continue
                    seen_in_article.add(entity_key)

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

            # Sample up to 1500 articles to keep response time reasonable
            articles = self._get_articles_snapshot()[:1500]

            pair_counts = defaultdict(int)
            # Store one article per pair for context (not all)
            pair_example = {}

            for data in articles:
                entities = data.get('entities', [])
                article_id = data.get('id', '')
                headline = data.get('headline', '')
                content = data.get('content', '')

                # Type-priority used to pick a single canonical type
                # for each entity name. Without this, "Iraq" appears
                # once as GPE and once as NORP and they're counted as
                # two different entities, doubling Iraq+Kuwait pairs.
                type_priority = {'PERSON': 5, 'ORG': 4, 'GPE': 3, 'LOC': 2, 'NORP': 1}

                # Pass 1 — collect best-typed version of each unique
                # normalised name in this article.
                by_name = {}
                for entity in entities:
                    entity_text = entity.get('text', '')
                    entity_type_val = entity.get('type', '')

                    if not entity_type_val:
                        continue
                    if entity_type_val in ['DATE', 'TIME', 'CARDINAL', 'ORDINAL', 'QUANTITY', 'MONEY', 'PERCENT']:
                        continue
                    if len(entity_text) < 3 or entity_text.isdigit():
                        continue
                    if entity_type and entity_type_val != entity_type:
                        continue
                    # Reuse the same blocklist + surname-collapse the
                    # top-entities chart uses so the relationship matrix
                    # is consistent with the chart.
                    normalized_text = self._normalize_entity_name(entity_text)
                    if not normalized_text or len(normalized_text) < 3:
                        continue
                    if (entity_type_val == 'PERSON'
                            and normalized_text.lower() in self._ENTITY_PERSON_TO_GPE):
                        continue
                    if (entity_type_val == 'PERSON'
                            and ' ' not in normalized_text
                            and normalized_text.lower() in self._AMBIGUOUS_SURNAMES):
                        continue

                    cur = by_name.get(normalized_text)
                    if cur is None or type_priority.get(entity_type_val, 0) > type_priority.get(cur['type'], 0):
                        by_name[normalized_text] = {
                            'text': normalized_text,
                            'type': entity_type_val,
                            'original': entity_text,
                        }

                filtered_entities = list(by_name.values())[:15]

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

                    # Store only one example article per pair
                    if pair not in pair_example:
                        pair_example[pair] = {
                            'article_id': article_id,
                            'headline': headline,
                            'content': content,
                            'entity1_orig': entity1_orig,
                            'entity2_orig': entity2_orig,
                        }

            # Sort and filter before extracting context (only for top results)
            top_pairs = sorted(
                [(pair, count) for pair, count in pair_counts.items() if count >= min_count],
                key=lambda x: x[1], reverse=True
            )[:limit]

            results = []
            for (entity1, type1, entity2, type2), count in top_pairs:
                pair = (entity1, type1, entity2, type2)
                examples = []
                ex = pair_example.get(pair)
                if ex:
                    context = self._extract_relationship_context(
                        ex['content'], ex['entity1_orig'], ex['entity2_orig']
                    )
                    if context:
                        examples = [{'article_id': ex['article_id'], 'headline': ex['headline'], 'context': context}]
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
            articles = self._get_articles_snapshot()

            topic_counts = defaultdict(int)
            total_articles = 0

            for data in articles:
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

            articles = self._get_articles_snapshot()
            keyword_lower = keyword.lower()
            time_counts = defaultdict(int)

            for data in articles:
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

            articles = self._get_articles_snapshot()
            entity_lower = self._normalize_entity_name(entity_name).lower()
            time_data = defaultdict(lambda: {'count': 0, 'positive': 0, 'negative': 0, 'neutral': 0})

            for data in articles:
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

            articles = self._get_articles_snapshot()
            entity_data = {name: {
                'total_mentions': 0,
                'positive': 0,
                'negative': 0,
                'neutral': 0,
                'topics': defaultdict(int),
                'cooccurrences': defaultdict(int)
            } for name in entity_names}

            normalized_entities = {self._normalize_entity_name(name).lower(): name for name in entity_names}

            for data in articles:
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

            articles = self._get_articles_snapshot()
            time_topics = defaultdict(lambda: defaultdict(int))

            for data in articles:
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

            articles = self._get_articles_snapshot()
            location_data = defaultdict(lambda: {
                'count': 0,
                'topics': defaultdict(int),
                'sentiment': {'positive': 0, 'negative': 0, 'neutral': 0},
                'over_time': defaultdict(int)
            })

            for data in articles:
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
            # 180s upload + 30s metadata timeout — matches the global
            # GEMINI_REQUEST_TIMEOUT default. Without this, an upload
            # whose underlying TCP connection silently dies blocks the
            # whole pipeline forever (same bug that caused the v4 8-hour
            # stall, just on a different network call).
            blob.upload_from_filename(image_path, timeout=_UPLOAD_TIMEOUT)

            blob.make_public(timeout=30)

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
            blob.upload_from_filename(
                image_path,
                content_type='image/jpeg',
                timeout=_UPLOAD_TIMEOUT,
            )
            blob.make_public(timeout=30)
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
import threading as _threading
_db_init_lock = _threading.Lock()

def get_db() -> FirestoreDB:
    """Process-wide singleton. Lock guards against the parallel-fan-out
    race where 11 dashboard endpoints each see _db_instance as None and
    each call firebase_admin.initialize_app() → ValueError 'default app
    already exists'."""
    global _db_instance
    if _db_instance is None:
        with _db_init_lock:
            if _db_instance is None:
                _db_instance = FirestoreDB()
    return _db_instance


def get_firestore_db() -> FirestoreDB:
    return get_db()
