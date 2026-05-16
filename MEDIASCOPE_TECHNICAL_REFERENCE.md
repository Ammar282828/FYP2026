# MediaScope — Technical Reference

**Final Year Project, Habib University · Spring 2026**

Ammar Murtaza · Izbal Mengal · Mahnoor Aminullah · Mohammad Arqam Nakhuda

This document is the canonical technical reference for MediaScope: how every part of the system actually works, from OCR ingest through analytics and dashboard. Every claim is grounded in a file path in the repository.

---

## 1. Repository Layout

```
files/
├── app.py                       # FastAPI app entrypoint — wires routes, loads .env
├── .env                         # API keys, JWT secret, Firebase bucket
├── api/routes/                  # 9 route modules
│   ├── articles.py              # search, list, chat (Ask AI)
│   ├── analytics.py             # 15+ analytics endpoints
│   ├── topics.py                # topic taxonomy, trends, sentiment-over-time
│   ├── newspapers.py            # OCR upload + /ocr/process
│   ├── ads.py                   # ad browse, search, period compare
│   ├── stories.py               # story list + narrative generation
│   ├── auth.py                  # JWT login/register
│   ├── bookmarks.py             # bookmarks + saved searches
│   └── config.py                # frontend config endpoint
├── services/
│   ├── pipeline.py              # ImageProcessor (OCR), NLPProcessor, MediaScopeDatabase
│   ├── gemini_adapter.py        # Vertex vs AI Studio routing, region rotation
│   ├── topics_gemini.py         # curated taxonomy classifier
│   └── sentiment_gemini.py      # Gemini sentiment scorer
├── database/firestore_db.py     # Firestore client + snapshot cache
├── utils/filters.py             # date extraction (Tesseract → Gemini fallback)
├── data/topics_taxonomy.json    # 39 curated topics
├── data/topics_data.json        # 85 dropdown labels (curated + legacy)
├── scripts/
│   ├── build_stories_v2.py      # TF-IDF clustering for stories
│   ├── backfill_topics.py       # re-classify articles
│   ├── backfill_sentiment.py    # re-score sentiment
│   └── assign_topics_gemini.py  # key-rotation topic classifier
└── mediascope-frontend/         # React + TypeScript dashboard (Recharts)
```

There are two flows: a **live read flow** (dashboard → FastAPI → Firestore snapshot), and an **offline write flow** (operator scripts → Gemini → Firestore). They share Firestore but never block each other.

---

## 2. Data Design

This section is the deep dive — Firestore schema, why the model looks the way it does, and how reads stay fast.

### 2.1 Why Firestore (not Postgres)

The team started on PostgreSQL during Kaavish I but migrated to Firestore mid-project. The reason is the **shape of the data**, not the tooling preference:

- An article carries variable-length `entities[]` (some have 30, some have 3), variable-length `keywords[]`, and a free-form `analysis` dict for ads. Modelling this in Postgres means either a `JSONB` column (loses query benefits) or 5–6 normalized tables with joins on every read.
- Article documents are **read together, updated together** — when the article-detail page loads, the user wants headline, body, entities, topic, sentiment in one round-trip. Firestore returns that in one read; Postgres needs JOINs.
- Firestore is **eventually consistent and horizontally scalable** out of the box, which matters when batch ingest writes thousands of articles in parallel.
- Built-in Firebase Storage colocates blobs with metadata using the same auth credentials.

The trade-off is that Firestore is **bad at range queries on multiple fields** (you can't say "publication_date between X and Y AND topic_label = Z" cheaply). The system works around this by maintaining an in-memory snapshot of all articles (Section 2.5).

### 2.2 The 8 Firestore Collections

| Collection | Purpose | Document shape (key fields) |
|---|---|---|
| `newspapers` | One doc per page image | `id`, `publication_date`, `section`, `page_number`, `image_path`, `image_url`, `image_filename`, `article_count`, `avg_sentiment`, `created_at` |
| `articles` | One doc per article extracted from a page | `id`, `newspaper_id` (FK), `headline`, `content`, `word_count`, `entities[]` (embedded), `publication_date`, `page_number`, `topic_id`, `topic_label`, `topic_method`, `topic_confidence`, `sentiment_score`, `sentiment_label`, `sentiment_method`, `sentiment_confidence`, `low_quality`, `story_id` (FK, nullable), `created_at` |
| `ads` | One doc per detected advertisement | `id`, `newspaper_id` (FK), `identifier`, `brand`, `category`, `description`, `coordinates` (dict with x1,y1,x2,y2), `analysis` (dict), `image_url`, `publication_date`, `page_number`, `source`, `created_at` |
| `users` | JWT-authenticated users | `id`, `email`, `password_hash` (bcrypt), `name`, `avatar_color`, `bookmark_count`, `created_at` |
| `bookmarks` | Per-user saved articles | `id`, `user_id` (FK), `article_id` (FK), `note`, `tags[]`, plus cached `article_headline`/`article_date`/`article_sentiment`/`article_topic` (snapshot fields), `created_at` |
| `saved_searches` | Per-user saved queries | `id`, `user_id` (FK), `name`, `query`, `filters` (dict), `created_at` |
| `annotations` | Per-user text highlights | `id`, `user_id` (FK), `article_id` (FK), `text`, `start_offset`, `end_offset`, `color`, `note`, `created_at` |
| `stories` | Groups of related articles | `id`, `title`, `topic_label`, `topic_id` (nullable), `article_ids[]`, `article_count`, `start_date`, `end_date`, `date_span_days`, `key_entities[]`, `avg_sentiment_score`, `dominant_sentiment`, `narrative` (nullable, AI-generated), `narrative_generated_at`, `newspaper_ids[]`, `created_at`, `updated_at` |

### 2.3 Why entities are embedded (not a separate collection)

An `Entity` is a `{text, type, count}` triple inside an article. The natural relational instinct is a separate `entities` collection with a foreign key back to the article — but for this corpus that's wrong.

- **Read pattern**: when the article-detail page loads, the user always wants the entities for that article. Embedding means one Firestore read fetches headline + body + entities together. Separating means two reads or a join.
- **Cardinality**: an article has 5–50 entities. That fits inside a single Firestore document (1 MB limit) with room to spare.
- **Write pattern**: entities are written once when the article is ingested. They don't get edited independently of the article. So the relational guarantees of a separate table aren't needed.
- **Analytics path**: top-entities and entity-co-occurrence calculations walk the entire article snapshot anyway (Section 6) — having entities inline means one pass through the collection instead of joining.

The system also stores entities with type-priority dedup (Section 5) so the same name doesn't appear three times with three different types.

### 2.4 Indexes and lookup paths

Firestore creates a composite index for every `.where().order_by()` pattern the app uses. The ones that exist on this project:

- `articles.where(newspaper_id == X).order_by(page_number)` — for the newspaper-detail view
- `articles.where(topic_id == X).order_by(publication_date desc)` — for topic-drill-in
- `articles.where(story_id == X).order_by(publication_date asc)` — for story timelines
- `bookmarks.where(user_id == X).order_by(created_at desc)`
- `stories.order_by(start_date desc)` — for the Stories tab
- `ads.where(newspaper_id == X)` and `ads.where(category == X)` — for ad views

Composite indexes are auto-created the first time a query runs; Firestore returns an error with a deep link to "create this index" which the developer clicks once.

### 2.5 The snapshot cache — why it exists

Firestore is a transactional document database. It is **not a fast analytical store**. A query like "how many articles per month, grouped by topic, for each of 38,000 articles" would require either:

1. Multiple Firestore queries with full collection scans — 30+ seconds per request, paid per read
2. Maintaining materialised aggregate documents that get rebuilt on every write — complex, error-prone

The system uses option 3: a **shared in-memory snapshot** rebuilt on backend startup.

- `database/firestore_db.py:_get_articles_snapshot()` pulls every article into a Python list, paginated in 5,000-document chunks ordered by `__name__` (document ID). This dodges an SDK retry crash that triggers on full-collection streams past ~30,000 docs (`'_UnaryStreamMultiCallable' object has no attribute '_retry'`).
- The snapshot is held in a thread-local global and persisted to `.articles_snapshot.json` on disk so a server restart doesn't re-pay the 50-second rebuild.
- It's versioned by `article_count`. When ingest writes new articles, the count changes, which busts every downstream analytics cache (Section 6).

Every analytics endpoint reads from the snapshot. The live Firestore collection is only touched for writes (ingest, bookmarks, auth).

### 2.6 The dual topic stores

There are two JSON files that look similar but serve different purposes:

- **`data/topics_taxonomy.json`** — the **canonical 39-topic taxonomy** used by the live Gemini classifier. Each entry has `{id, key, label, description, keywords[]}`. The label is what users see ("Pakistan Politics"); the description is what Gemini sees in the prompt.
- **`data/topics_data.json`** — an **85-entry list** that includes the curated 39 plus 46 legacy BERTopic auto-generated labels (`kgs_grams_oil_40 kgs`, `mqm_kashmir_ppp_sindh_minister`, etc.). This file exists because the topic browser endpoint historically read it. The legacy 46 now have zero articles assigned (the migration moved everything to curated labels), so the `/topics/` endpoint filters out zero-count topics → effectively only the 39 are visible.

### 2.7 Image storage

Image blobs live in **Firebase Storage** at bucket `fyp2026-87a9b.firebasestorage.app`, not in Firestore. Two prefixes:

- `newspapers/{newspaper_id}/{filename}` — full page image
- `ads/{ad_id}.jpg` — cropped ad image

Articles reference these via a `image_url` string (signed URL). Storing blobs in Firestore would (a) hit the 1 MB doc limit and (b) cost 10× more per read.

### 2.8 Field-level write semantics

- All writes are **idempotent**: each article ID is a UUID v4; ingest paths use content-derived IDs to detect duplicates.
- `bookmark_count` on the user doc is updated atomically with `firestore.Increment(±1)` so concurrent bookmark adds don't race.
- `topic_method`, `sentiment_method` fields exist so the backend can tell legacy-RoBERTa-scored articles apart from Gemini-scored ones during backfills (resume safety).

---

## 3. Where Gemini is called

There are **two API surfaces** Gemini routes through, decided by key prefix in `services/gemini_adapter.py:create_model()`:

- Keys starting `AQ.` → **Vertex AI Express** via `google-genai`, with region rotation across `us-central1, us-east1, us-east4, us-west1, europe-west1`.
- All other keys → **Google AI Studio** via `google-generativeai` (legacy SDK).

**Every Gemini touchpoint in the codebase:**

| Caller | Model | Purpose |
|---|---|---|
| `services/pipeline.py` → `ImageProcessor.extract_metadata` | `gemini-2.5-pro` | masthead OCR (date, page number) |
| `services/pipeline.py` → `ImageProcessor.detect_article_regions` | `gemini-2.5-pro` | layout: returns bboxes for article regions |
| `services/pipeline.py` → `ImageProcessor.extract_articles` | `gemini-2.5-pro` | per-region OCR (cropped image → text + headline) |
| `services/pipeline.py` → `ImageProcessor.detect_ads` | `gemini-2.5-pro` | layout: bboxes + category for ads |
| `services/pipeline.py` → `ImageProcessor.analyze_ad_image` | `gemini-2.5-pro` | per-ad: brand, product, visual description |
| `services/pipeline.py` whole-page fallback | `gemini-2.5-pro` | when region detection returns nothing |
| `services/topics_gemini.py` → `classify_topics_batch_gemini` | `gemini-2.5-flash` | topic classification (batch of 10 articles) |
| `services/sentiment_gemini.py` → `analyze_sentiment_gemini` | `gemini-2.5-flash` | sentiment score + label (up to 12k chars) |
| `utils/filters.py` → `_gemini_extract_date` | `gemini-2.5-pro` | fallback masthead date when Tesseract fails |
| `api/routes/articles.py` → `/chat/ask` | `gemini-2.5-flash` | Ask AI |
| `api/routes/articles.py` → article summary, entity bio | `gemini-2.5-flash` | one-off summaries |
| `api/routes/analytics.py` → `/ai-summary` | `gemini-2.5-flash` | search-slice summary |
| `api/routes/stories.py` → `_generate_narrative_background` | `gemini-2.5-pro` | story narrative arc |
| `scripts/build_stories_v2.py` AI title gen | `gemini-2.5-flash` | story cluster title |
| `scripts/backfill_topics.py`, `topic_missing.py` | `gemini-2.5-flash` | re-classification passes |
| `scripts/backfill_sentiment.py` | `gemini-2.5-flash` | re-score sentiment |

**Key rotation** lives in three places:

- For backend runtime: `api/routes/articles.py:_pick_gemini_key()` round-robins a pool from `GEMINI_API_KEYS` (comma-separated env var) + falls back to `GEMINI_API_KEY` if empty.
- For ImageProcessor per-batch: `services/pipeline.py:ImageProcessor._next_key()` round-robins with `GEMINI_429_BACKOFF=8s → 60s` exponential backoff on quota errors.
- Region rotation is built into the Vertex client (`services/gemini_adapter.py:_VertexModel._next_client`) — one client per region, round-robin per call.

---

## 4. OCR / Ingest Pipeline (per page)

When a page is uploaded via `/api/ocr/upload` then `/api/ocr/process`, this is the exact sequence:

1. **File upload** (`/ocr/upload`) — saves bytes to `uploads/newspapers/{uuid}.jpg`, runs `utils/filters.extract_date_from_image()` (Tesseract OSD → Gemini-vision fallback on a 30%-tall masthead crop with a corpus-anchored prompt).
2. **`/ocr/process`** instantiates `Config()` + `ImageProcessor(config)` + `MediaScopeDatabase(config)`.
3. **EXIF transpose** + **orientation correction** via Tesseract OSD (confidence threshold 2.0).
4. **Metadata OCR** — Gemini call on the masthead crop, returns `{date, page}`.
5. **Parallel fan-out** (`ThreadPoolExecutor max_workers=2`):
   - `ip.detect_ads(page_img)` → list of ad bboxes + analysis
   - `ip.extract_articles(file_path, page_img)` → list of articles
6. **`extract_articles`** internally: one Gemini call for layout (bboxes), then up to 4 parallel Gemini calls (one per cropped region) with a strict "verbatim only, mark unreadable as `[ILLEGIBLE]`" prompt.
7. **Newspaper doc inserted** to Firestore with `image_path` + signed `image_url`.
8. **Ads loop** — per ad: `ip.analyze_ad_image()` (Gemini), then `db.insert_ad()` writes Firestore + uploads the cropped image to Storage.
9. **Articles loop**:
   - One Gemini batch call: `classify_topics_batch_gemini(article_texts)` returns `[{topic_id, topic_label, confidence}, …]`
   - Per article: `analyze_sentiment_gemini(text[:4000])` returns `{label, score, confidence, reasoning}`
   - Write to Firestore with `topic_method='gemini-curated'`, `sentiment_method='gemini'`
10. **Return** `{newspaper_id, articles, ads, status='completed'}`.

**Reliability:**

- Idempotent writes (article IDs are UUIDs; rerunning upload doesn't dupe via content-hash check)
- Request-level timeout 300s (env `GEMINI_REQUEST_TIMEOUT`)
- `GEMINI_429_BACKOFF=8`, doubling to `GEMINI_429_MAX_BACKOFF=60`, max 20 retries before giving up
- Whole-page OCR fallback if region detection returns 0 regions

---

## 5. NLP Enrichment

**Topic classification** (`services/topics_gemini.py`):

- Curated taxonomy of **39 topics** in `data/topics_taxonomy.json` (id, key, label, description, keywords)
- Batched 10 articles per Gemini call (token-efficient)
- Prompt includes the full taxonomy as a numbered list + 10 article headlines+bodies
- Returns `[{idx, topic_id, confidence}, …]`; falls back to `{topic_id: -1, topic_label: "Uncategorized"}` on parse error
- Method tag stored: `topic_method = 'gemini-curated'`

**Sentiment** (`services/sentiment_gemini.py`):

- Up to 12,000 chars per article (~3k tokens)
- Prompt: *"You are a sentiment analyst rating a news article from 1990s Dawn. Focus on substance, not the formal/restrained register. A measured editorial condemning a policy is negative, not neutral."*
- Returns `{label: positive|negative|neutral, score: [-1,1], confidence: [0,1], reasoning}`
- Method tag: `sentiment_method = 'gemini'`
- Legacy RoBERTa fallback (Cardiff NLP twitter-roberta) lives in `services/pipeline.py:NLPProcessor.analyze_sentiment` — never reads more than 1000 chars, hence the systematic neutral bias on long articles (this is why Cohen's κ = 0.169 between the two).

**Entities (NER):**

- `spaCy` (`en_core_web_sm` or `en_core_web_trf`) — extracts PERSON, ORG, GPE, LOC, DATE, MONEY, …
- Embedded in the article doc as `entities: [{text, type, count}, …]`
- Post-processing in `database/firestore_db.py`:
  - 17-city + 9-common-noun **PERSON blocklist** (Karachi, Pakistan, Karachi → can't be a person)
  - **Surname-only dedup** (drops bare "Hussain", "Khan", "Sharif", "Bhutto" when the full name exists in the same doc)
  - **Per-article type-priority pre-pass**: if "Iraq" is tagged GPE in one mention and PERSON in another, all become GPE

---

## 6. Analytics — Every Chart, Every Calculation

Every analytics endpoint reads from `db._get_articles_snapshot()` and filters in Python. The full chart catalogue:

**`/analytics/data-version`** — returns `{article_count, version, min_date, max_date}`. Used by the frontend to bound date pickers. Version is the article count itself — changes whenever ingest runs, which is how the analytics-cache busts.

**`/analytics/articles-by-day`** — iterates snapshot, groups by `publication_date.date()`, returns `[{date, count}, …]`. Powers the **Coverage Calendar** heatmap. Skips `low_quality` articles.

**`/analytics/keyword-frequency-over-time`** — iterates snapshot, counts articles whose `content + headline` contains the keyword (case-insensitive), bucketed by `granularity ∈ {year, month, day}` between `start_date` and `end_date`. The frontend can call this for multiple keywords in parallel and the Recharts BarChart renders one Bar series per keyword.

**`/analytics/keyword-sentiment-over-time`** — same iteration, but returns avg `sentiment_score` per bucket (not count). Multi-keyword chart renders one Line series per keyword.

**`/analytics/top-keywords`** — pulls top 30 most-frequent words across all `content` fields, with extension stopwords (`illegible`, plus standard nltk-style list).

**`/analytics/top-entities`** — flattens all `entities[]` arrays, applies the PERSON blocklist + surname dedup, returns top N per type.

**`/analytics/entity-relationships`** — pairs co-occurring entities within the same article, counts pair frequency. Filters: skip when `type` is empty, dedup same-text-different-type collapse.

**`/analytics/ai-summary`** — the "Summarize this slice" endpoint:

- Accepts: `start_date`, `end_date`, `topic` filter, optional `article_ids[]`, optional `query`
- If `article_ids` provided → filter snapshot to just that set first
- Builds context: `Total Articles, Sentiment Distribution, Top Entities, Sample Headlines (30 if query, else 10)`
- Gemini-2.5-flash prompt: if `query` present, hard-anchors with *"The user searched for X — every paragraph must reference X"*; otherwise generic summary

**`/topics/`** — returns `topics_data.json` with live counts from snapshot (`Counter(a.topic_id for a in articles if not a.low_quality)`). Drops topics with count=0 so the dropdown only shows real options.

**`/topics/trends-over-time`** — buckets articles by period, groups by `topic_label`. Filters out `low_quality` + `topic_label == 'Uncategorized'`. Returns `[{period, topics: [{topic_id, topic_name, count}]}]`.

**`/topics/sentiment-over-time`** — same loop but bucketed by `topic_id` with avg `sentiment_score` per topic. Filters: `topic_id is not None and != -1`, `sentiment_score is not None`, not `low_quality`.

**`/topics/{topic_id}/articles`** — list articles for one topic from snapshot.

**`/ads/analytics/summary`** — counts ads by `category` and `brand`, monthly distribution. Uses the same 3-filter set as `/ads/browse` (house-promo filter, illegible-brand filter, valid date range) so counts agree.

**`/ads/analytics/compare-periods`** — accepts two date ranges, returns parallel category/brand/industry breakdowns.

**Caching layer**: `api/routes/topics.py:_cached(key, fn)` — in-memory dict keyed by `cache_key + article_count_version`. TTL 1 hour. When new articles ingest, `article_count` changes → cache key changes → entries auto-invalidate.

---

## 7. Search & Filters

**Keyword search** — `POST /api/search/keyword` (`api/routes/articles.py:472`):

- Pulls a wider candidate pool (`limit × 8`, min 1000) from `db.search_articles(keyword)` which scans the snapshot for substring match on `headline` and `content`
- Drops `_is_classified()` (tender/quotation/vacancy headlines) and `_is_garbage_headline()` (single-char, all-caps junk)
- Applies structured filters in Python:
  - `start_date` / `end_date` (with `_coerce_date()` to handle both `datetime` and string `publication_date`)
  - `sentiment` — exact match on `sentiment_label`
  - `topic` — exact match on `topic_label`
  - `entity_type` — at least one entity with that `type`
- Sort: `relevance` (quality-aware: rich-metadata + clean-OCR first), `date`, `sentiment`
- Filter-only search (no keyword) supported — useful for "show me positive cricket coverage"
- Returns first 100 by default (configurable)

**Entity search** — `POST /api/search/entity` — same flow but matches against the `entities[]` array.

---

## 8. Ask AI (`/chat/ask`)

`api/routes/articles.py:731`:

1. Parses user question, extracts year (if mentioned) via regex `(19[89]\d|20\d{2})`
2. Retrieves candidate articles by combining: year filter, keyword extraction from the question, entity match
3. Top 20 candidates ranked by relevance
4. Builds context: `[{date}] {headline}\n{content[:800]}\n\n` for each
5. Gemini-2.5-flash prompt: "Answer the user's question grounded in these articles. Cite source dates inline. If no articles match, say so."
6. Returns `{answer, sources: [{id, headline, date}]}`
7. Year mismatch protection: if user asks about 1991 events, candidates from 1990 are excluded

---

## 9. Stories (clustering + narrative arcs)

**Clustering** (`scripts/build_stories_v2.py`):

- TF-IDF feature vectors over article `headline + content`
- Filter: skip `low_quality`, dedup near-identical articles by content hash
- Build cosine similarity graph: edges where `similarity ≥ 0.32`, within a `45-day window`, top-80 nearest neighbours per article
- Connected components → clusters; keep clusters with `≥ 3 articles`
- Result: ~639 stories on the current corpus

**Title generation** (top 200 clusters get AI titles):

- Pick 5–8 representative articles per cluster
- Gemini-2.5-flash prompt: "Generate a 4–8 word newspaper-style headline that captures this cluster"
- Smaller clusters get fallback entity-joined titles like `"M. Salahuddin · Pakistan · Gmp"`
- Frontend `/api/stories/` endpoint filters out entity-joined titles + topic-name fallbacks, so users only see the 200 AI-titled stories

**Narrative arc** (on-demand, `POST /api/stories/generate`):

- Fetches all articles in the cluster, sorted by `publication_date`
- Gemini-2.5-pro prompt: "Build a chronological narrative arc covering events, key turning points, and outcomes"
- Returns 3–5 paragraphs; written back to story doc as `narrative` field
- Cached — subsequent reads pull from Firestore unless `force=true`

---

## 10. Ad Pipeline

**Detection** (during ingest, `ImageProcessor.detect_ads`):

- Gemini call returns bboxes + raw `category` + `brand` guess
- Each detected ad becomes a Storage upload (`ads/{ad_id}.jpg`) + Firestore doc

**Per-ad analysis** (`ImageProcessor.analyze_ad_image`):

- Gemini call on the cropped ad image
- Returns structured dict: `{brand: {name, category, industry}, content, visual, contact_info, dates}`
- Stored as `analysis` field on the ad doc

**Browse endpoint** (`/ads/browse`):

- Reads from in-memory ads cache (5-min TTL, refreshed on background timer)
- 3 cache-layer filters: `_is_house_promo()`, `_has_illegible_brand()`, `_ad_in_valid_date()`
- Newspaper-image URLs attached via 16-thread `ThreadPoolExecutor` + persistent 10k-entry LRU cache

**Search** (`/ads/search`) — looser filter that respects classified-style queries so users can explicitly search for tenders.

**Period comparison** (`/ads/analytics/compare-periods`):

- Accepts two date ranges
- Aggregates each independently using `_aggregate_ads()` helper
- Returns parallel category + brand + industry counts side-by-side

---

## 11. Auth & Bookmarks

- **JWT** (`api/routes/auth.py`): bcrypt password hashing, `JWT_SECRET` from `.env`, tokens last 7 days
- `get_optional_user()` distinguishes expired vs invalid tokens vs other failures
- **Bookmarks** (`api/routes/bookmarks.py`): atomic `firestore.Increment(±1)` on `bookmark_count`; caps at 10k IDs per user
- **Saved searches**: stores `query + filters` dict; user can re-execute

---

## 12. Frontend

**Stack**: React + TypeScript (CRA), Recharts, lucide-react, axios, react-router via `useQueryState`.

**Main tabs** (`MediaScopeDashboard.tsx`):

- `home` (Search default)
- `search` (with SearchPanel + filters)
- `analytics` with sub-tabs: `overview`, `topics`, `entities`, `keywords`, `corpus`
- `stories` (Stories tab)
- `ocr` (OCR upload)
- `ad-browser`
- `bookmarks`, `compare`, `periods`, `by-date`, `chat`

**Key components & what they call:**

- `SearchPanel.tsx` → `POST /api/search/keyword` (with all filters)
- `SearchResultsSummary.tsx` → `POST /api/analytics/ai-summary` (with `article_ids` + `query`)
- `CalendarHeatmap.tsx` → `GET /api/analytics/articles-by-day` — auto-trims year grid to last month with data, softens empty cells
- `EnhancedAnalytics.tsx` → topic trends + sentiment-over-time, keyword sentiment (multi-keyword)
- `AdvancedAnalytics.tsx` → keyword frequency (multi-keyword)
- `StoriesTab.tsx` → `GET /api/stories/?limit=200` (sorts narrative-having first, then by article_count)
- `AdBrowserTab.tsx` → `GET /api/ads/browse?limit=5000`, paginates 100 per page, in-grid sort
- `OCRTab.tsx` → `/ocr/upload` then `/ocr/process`, shows auto-detected date
- `ChatTab.tsx` → `/chat/ask`

**Snapshot/cache version awareness**: `useDataVersion` hook polls `/analytics/data-version` so date bounds and corpus-aware UIs auto-sync when new ingest happens.

---

## 13. Reliability & Engineering Decisions

- **Idempotent writes** — every doc keyed by content-derived ID. Re-running ingest doesn't dupe.
- **Paginated snapshot scans** — Firestore SDK has a retry crash past ~30k docs. Solved by scanning in 5,000-doc chunks ordered by `__name__`.
- **Analytics cache** — In-memory dict keyed by `(function_name, params, article_count)`. Persisted to `.analytics_cache.json` so a restart doesn't recompute everything. Bumped automatically when the corpus grows.
- **Request-level timeouts** — Every Gemini call and Firestore call has an explicit timeout. One stalled call can't block the API thread.
- **Multi-region Gemini** — Vertex Express keys round-robin across 5 regions for ~5× quota.
- **Resume-safe backfills** — `scripts/backfill_topics.py`, `scripts/backfill_sentiment.py` skip articles where `topic_method == 'gemini-curated'` (or `sentiment_method == 'gemini'`). Killing and restarting picks up where you left off.

---

## 14. Validated Numbers (from the evaluation)

- **6,958** total page images in the corpus
- **~38,000** articles after ingest
- **~2,800** ads
- **OCR accuracy**: 77.6% weighted across 1,445 sampled articles. Best month Jan-90 (80.4%), worst May-90 (75.3%). Best condition: clear pages (89.2%); worst: stained/ink-bleed (58.1%)
- **Ad industry classification**: 87% correct on ~100 reviewed
- **Sentiment Cohen's κ = 0.169** between local RoBERTa and Gemini (273 pairs; finding: local model understates tone on long articles)
- **Topic classification**: switched from BERTopic (unstable cluster labels) to Gemini-against-curated-39 (human-readable, stable)
- **Stories**: 639 clusters, 200 AI-titled, top cluster (Pakistan Election Schedule) has 520 articles

---

*End of technical reference.*
