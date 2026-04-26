# MediaScope

Editorial archive + analytics platform for the **Dawn newspaper corpus, 1990–1992**. Phone-scanned newspaper pages → OCR → structured articles + advertisements → curated topic taxonomy + sentiment + named entities → searchable archive with editorial-style dashboards.

## What it does

| Layer | Stack | Purpose |
|------|-------|---------|
| **Ingestion** | Gemini 2.5 + 3.1 Pro Vision via Vertex AI Express | OCR newspaper page scans → date/page metadata, ads, articles |
| **Classification** | Gemini batched classifier + curated taxonomy | Topic (40 curated buckets) + sentiment per article |
| **Storage** | Firebase Firestore + Storage | Articles, advertisements, newspapers, stories, bookmarks, users |
| **API** | FastAPI | REST surface for the dashboard, with TTL caching for heavy aggregations |
| **Frontend** | React 18 + TypeScript + Recharts + Lucide | Editorial-archive dashboard, search, comparison, story clustering |
| **Backfills** | Python CLI scripts | Reclassify legacy data, recover dates from mastheads, repair broken ad crops |

## Quick start

```bash
# 1. Backend
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env  # edit with GEMINI_API_KEY + Firebase paths
uvicorn app:app --port 8000 --host 0.0.0.0

# 2. Frontend
cd mediascope-frontend
npm install
npm start  # http://localhost:3000
```

Required env vars (see `.env.example`):
```
GEMINI_API_KEY=AQ.…              # Vertex AI Express key (or AIzaSy… legacy)
GOOGLE_APPLICATION_CREDENTIALS=./firebase-service-account.json
FIREBASE_STORAGE_BUCKET=…
ALLOWED_ORIGINS=http://localhost:3000
JWT_SECRET=…                      # for auth tokens
```

## Architecture

```
┌────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│ Phone scans    │───▶│ services/       │───▶│ Firestore       │
│ (.jpg folders) │    │   pipeline.py   │    │  collections    │
└────────────────┘    └─────────────────┘    └────────┬────────┘
                              │                       │
                              ▼                       ▼
                      ┌──────────────┐       ┌────────────────┐
                      │ Gemini       │       │ FastAPI        │
                      │   adapter    │       │   /api/*       │
                      │ (Vertex      │       └────────┬───────┘
                      │  Express)    │                │
                      └──────────────┘                ▼
                                              ┌──────────────┐
                                              │ React app    │
                                              │ (mediascope- │
                                              │  frontend/)  │
                                              └──────────────┘
```

For another LLM trying to understand this codebase fast, read **[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)** — it has a per-file responsibility table, the data flow graph, and a Mermaid diagram.

## Project layout

```
.
├── app.py                         # FastAPI entry point, mounts all /api/* routers
├── api/routes/                    # 9 routers, ~4,600 LOC total
│   ├── articles.py                # Article CRUD + search (keyword + entity)
│   ├── analytics.py               # Aggregations w/ TTL cache + persisted snapshot
│   ├── ads.py                     # Ad browsing + Gemini-based ad analysis
│   ├── topics.py                  # Curated taxonomy + topic distribution
│   ├── stories.py                 # Clustered ongoing stories (build_stories.py)
│   ├── newspapers.py              # OCR upload pipeline endpoint
│   ├── auth.py                    # JWT login / register
│   ├── bookmarks.py               # User bookmarks + saved searches
│   └── config.py                  # /api/config (env + feature flags)
│
├── services/                      # Business logic (image + Gemini)
│   ├── pipeline.py                # ImageProcessor + NLPProcessor + MediaScopePipeline
│   ├── gemini_adapter.py          # Vertex Express vs legacy key auto-detection
│   ├── metadata_vision.py         # Masthead OCR for date/page recovery
│   ├── topics_gemini.py           # Per-article + batch curated topic classifier
│   └── sentiment_gemini.py        # Curated sentiment classifier (no RoBERTa)
│
├── database/firestore_db.py       # Firestore client wrapper, Storage, analytics cache
│
├── scripts/                       # Backfills + maintenance
│   ├── backfill_topics.py         # Reclassify legacy BERTopic labels (--batch-size 10)
│   ├── backfill_sentiment.py      # Score sentiment via Gemini
│   ├── backfill_metadata_vision.py # Recover date/page from masthead OCR
│   ├── backfill_metadata.py       # Recover date/page from filenames
│   ├── recut_ad_crops.py          # Re-cut ad crops from parent newspapers
│   ├── redetect_broken_ads.py     # Re-run ad detection on parents w/ junk coords
│   ├── build_stories.py           # Cluster articles into ongoing stories
│   ├── regen_topics_data.py       # Rebuild data/topics_data.json from live counts
│   ├── _call_timeout.py           # 60-s watchdog used by all backfills
│   └── _quarantine_corrupted.py   # One-shot mark image-corrupted parents
│
├── data/
│   ├── topics_taxonomy.json       # 40 curated topics (canonical source)
│   └── topics_data.json           # Snapshot w/ live article counts (regenerated)
│
├── utils/filters.py               # Date parsing + null-aware filter helpers
│
├── mediascope-frontend/           # React 18 + TypeScript dashboard
│   └── src/
│       ├── MediaScopeDashboard.tsx  # Top-level shell (tab nav, header, profile)
│       ├── components/              # 35+ feature components (see ARCHITECTURE.md)
│       ├── theme/
│       │   ├── components.css       # Reusable primitives (.card, .stat-card, .btn…)
│       │   ├── chartTheme.ts        # Shared Recharts tooltip + axis style
│       │   └── chartColors.ts       # Sentiment + categorical palettes
│       ├── mediascope-dashboard.css # CSS tokens (--space-*, --font-size-*…)
│       └── hooks/
│           ├── useAnalyticsCache.ts # Versioned localStorage cache wrapper
│           ├── useDataVersion.ts    # Article-count poll for cache busting
│           └── useGlobalShortcuts.ts
│
└── docs/
    ├── ARCHITECTURE.md            # ← Read this first (for LLMs and new devs)
    ├── FIREBASE_SETUP.md
    └── …
```

## Key concepts

**Curated taxonomy.** Replaced BERTopic's auto-generated `mqm_kashmir_ppp_sindh_minister`-style labels with a **fixed list of 40 readable topics** in `data/topics_taxonomy.json` (Pakistan Politics, Cricket, Crime & Violence, IMF & External Debt, Puzzles & Crosswords, …). Articles are classified against this fixed list, so labels are stable across runs and don't drift.

**Vertex AI Express routing.** `services/gemini_adapter.py` auto-detects whether `GEMINI_API_KEY` starts with `AQ.` (Vertex Express) or `AIzaSy` (legacy Developer API) and dispatches accordingly. Same code path in both cases.

**Honest nulls.** Articles whose date/page can't be recovered are stored with `publication_date=null` and `page_number=null` instead of fabricating `(1990-01-01, page=1)` defaults that masked extraction failures. The frontend shows them under an "Unknown" bucket. Older sentinel-defaulted articles are nulled by `pass_2_sentinel_nulling` in `backfill_metadata.py`.

**Resume-safe backfills.** Every backfill streams via Firestore cursor pagination, marks completed docs with a terminal method flag (`metadata_method='gemini-vision'`, `topic_method='gemini-curated'`, etc.), and skips them on subsequent runs. Restart-friendly. A 60-second per-call watchdog (`scripts/_call_timeout.py`) prevents hung gRPC channels from blocking the queue.

**Batch topic classification.** `services/topics_gemini.py:classify_topics_batch_gemini` sends up to 10 articles per Gemini call with index-based response parsing. Wired into both the live ingestion path (`pipeline.py:process_single_newspaper`) and the corpus backfill (`backfill_topics.py --batch-size 10`). ~10× fewer API calls per page.

**Parallel page processing.** `process_single_newspaper` runs the 3 page-level Gemini calls (metadata, ad detection, article OCR) concurrently via `ThreadPoolExecutor`. Per-ad analysis also fans out (cap 4 concurrent). Wall time per page: ~290s → ~190s on a 12-article 1-ad page.

## API surface (high-level)

| Router | Mount | Notable endpoints |
|--------|-------|-------------------|
| **articles** | `/api/articles/*`, `/api/search/*` | `GET /articles/{id}`, `POST /search/keyword`, `POST /search/entity`, `GET /articles/on-this-day`, `GET /articles/random` |
| **analytics** | `/api/analytics/*` | `GET /data-version` (cache key + canonical article count), `articles-over-time`, `top-entities-fixed`, `sentiment-over-time`, `top-keywords`, `entity-cooccurrence` |
| **ads** | `/api/ads/*` | `GET /browse`, `POST /search`, `POST /upload + /analyze` (manual analysis path) |
| **topics** | `/api/topics/*` | `GET /` (taxonomy + counts), `GET /{id}/articles`, `GET /trends-over-time` |
| **stories** | `/api/stories/*` | `GET /` (clustered ongoing-story threads built by `build_stories.py`) |
| **newspapers** | `/api/newspapers/*` | `POST /upload` (single page), parsing endpoints |
| **auth** | `/api/auth/*` | `POST /register`, `POST /login`, `GET /me` (JWT) |
| **bookmarks** | `/api/bookmarks/*` | Per-user bookmarks + saved searches |
| **config** | `/api/config` | Feature flags + corpus bounds |

## Backfill cookbook

```bash
# Topics (curated reclassification, ~10× faster with batching)
python -m scripts.backfill_topics --batch-size 10
python -m scripts.backfill_topics --only-legacy --batch-size 10  # just legacy labels
python -m scripts.backfill_topics --dry-run --limit 5            # preview

# Sentiment
python -m scripts.backfill_sentiment

# Date/page recovery from masthead OCR
python -m scripts.backfill_metadata_vision --throttle 2.0

# Date/page recovery from filename pattern (Mon_DD_YY_pN.jpg)
python -m scripts.backfill_metadata

# Repair broken ad crops (legacy y1=4031,y2=4051 garbage coords)
python -m scripts.redetect_broken_ads
python -m scripts.recut_ad_crops --resume-force

# Rebuild ongoing-story clusters
python -m scripts.build_stories

# Refresh data/topics_data.json from live Firestore counts
python -m scripts.regen_topics_data
```

All backfills accept `--dry-run`, `--limit N`, `--throttle S` (seconds), and `--resume-force` (re-process already-completed docs).

## Tech stack

- **Python 3.13** · FastAPI · Firebase Admin · `google-generativeai` (via Vertex AI Express adapter) · spaCy + transformers (optional, only NLPProcessor) · Pillow
- **TypeScript 4.9** · React 18 · React Router 7 · Recharts 3 · Lucide React · Axios
- **Firebase**: Firestore for documents, Storage for images
- **Gemini models**: `gemini-2.5-flash` (default), `gemini-3.1-pro-preview` (optional)

## Documentation

- **[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)** — codebase graph for LLMs and new devs
- [`docs/FIREBASE_SETUP.md`](docs/FIREBASE_SETUP.md)
- [`docs/FRESH_START_GUIDE.md`](docs/FRESH_START_GUIDE.md)
- [`docs/MIGRATION_GUIDE.md`](docs/MIGRATION_GUIDE.md)
- [`docs/TOPICS_WORKING.md`](docs/TOPICS_WORKING.md)
