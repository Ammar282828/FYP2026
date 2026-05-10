# MediaScope
## A searchable AI archive of Dawn newspapers, 1990–January 1991

Final Year Project — Spring 2026
Dhanani School of Science and Engineering, Habib University

**Team:** Ammar Murtaza · Izbal Mengal · Mahnoor Aminullah · Mohammad Arqam Nakhuda
**Supervisor:** Dr. Faisal Alvi

---

## The problem

Pakistan's national newspaper of record sits in bound volumes at Frere Hall.

- 6,958 page images of *Dawn* from the early 1990s
- No public system to search, filter, or analyse it at the article level
- Researchers, journalists, and students still read these volumes page by page
- The pages couldn't be removed for flatbed scanning, so we had to photograph them — leaving us with binding shadows, page curvature, lighting variation, and creased gutters

The history is there. It just isn't reachable.

---

## Who we built this for

- **Researchers and media historians** — track how people, parties, and policy debates appeared over time
- **Journalists** — pull historical context for current reporting
- **Students** in media studies, sociology, political science — coursework and independent research without writing code
- **Cultural researchers** — study consumer culture and visual style through 1990s advertising

---

## Source material

- Photographed bound volumes at Frere Hall library, Karachi
- Coordinated through Majid Raja Sahab, who guided us through the archive
- Project period: full year 1990 plus January 1991
- Conditions we had to design around: binding shadow, gutter loss, torn margins, ink bleed, dense multi-column layouts, irregular orientation

---

## What we built

A working pipeline plus a researcher-facing dashboard.

- **Pipeline:** photograph → image preprocessing → Gemini Vision → structured records → Firestore
- **Dashboard:** search, entity tracking, sentiment trends, topic exploration, ad browser, story clusters, Ask AI, bookmarks, comparison tools
- **Output today:** ~38,000 articles, ~2,800 ads, ~4,400 indexed pages

Visual style borrows from a newspaper. Analytics views stay clean and readable.

---

## Tech stack

**Extraction**
- Gemini Vision (multimodal OCR, layout, structured JSON in one call)
- Tesseract OSD for orientation correction

**Storage**
- Firestore for articles, ads, entities, metadata
- Firebase Storage for original page images and ad crops

**Backend**
- FastAPI on Uvicorn
- Snapshot caching for full-corpus analytics
- Per-endpoint analytics cache versioned by article count

**Frontend**
- React + TypeScript
- Recharts for line/bar/stacked charts
- Editorial newspaper-inspired design

---

## The pipeline

For every page:

1. Read image from batch folder or OCR upload tab
2. Preprocess — orientation, denoise, preserve resolution for small print
3. Gemini Vision extracts page metadata, article regions, ad regions, headlines, body text
4. Validate detected regions; fall back to whole-page OCR if regions are unreliable
5. Store articles with text, date, page, topic, sentiment, entities
6. Store ads separately with crop coordinates, brand, category, visible text, visual description
7. Persist to Firestore and Cloud Storage

The OCR prompt is written to favour transcription over summary. Unreadable text is marked `[ILLEGIBLE]` rather than invented.

---

## Why Gemini Vision

We tested six OCR and layout tools before deciding.

| Tool | Why it didn't work |
| --- | --- |
| Tesseract OCR | Fragmented text, unreliable reading order on multi-column pages |
| PaddleOCR | Detected fragments but article grouping wasn't reliable |
| Google Vision OCR | Mixed columns, captions, and ads in output order |
| Amazon Textract | Confused layout on irregular columns and damaged margins |
| LayoutLMv3 | Did not produce usable article-level segmentation |
| **Gemini Vision** | **Combined OCR, layout, metadata, and structured JSON in one call** |

For photographed bound volumes, the multimodal approach was the only one that held up.

---

## OCR quality results

Random page samples were checked against the original images, month by month.

- **1,445 articles reviewed** across all 13 months
- **77.6% character accuracy** weighted across the corpus
- **Best month:** January 1990 at 80.4%
- **Worst month:** May 1990 at 75.3%

Page condition matters more than month.

| Condition | Accuracy |
| --- | --- |
| Clear pages | 89.2% |
| Binding shadow | 67.4% |
| Partially torn | 62.8% |
| Stained / ink bleed | 58.1% |
| Heavily creased | 61.3% |

The single largest source of error is binding shadow on the inner column.

---

## Topic and sentiment enrichment

**Topic classification**
- We started with unsupervised clustering. The labels were noisy keyword strings like `kgs_grams_oil` — useless in a public-facing UI.
- Switched to a curated taxonomy with Gemini-assisted classification. Stable, human-readable labels.

**Sentiment analysis**
- Reviewed 273 article pairs against a legacy local classifier
- Cohen's kappa = 0.169 — disagreement was useful, not a defect
- The local model labelled long news articles as neutral when the tone was clearly positive or negative
- Gemini matched manual inspection more often on the disagreed cases

---

## Advertisement analysis

Ads have a different visual structure from articles, so we extract and store them separately.

- Crop coordinates, visible text, brand, product, category, and a short visual description
- ~100 ads manually reviewed for industry classification
- **87% correct general industry assignment** (automotive, real estate, jobs, education, consumer goods)
- Crop handling tuned to skip tiny classified blocks — the dashboard stays browsable

The Ad Browser also supports period comparison: compare ads from any two date ranges side by side.

---

## Dashboard — what users actually do

- **Search** by keyword, entity, topic, sentiment, date
- **Article detail** with headline, body, entities, related records, original page context
- **Analytics** — article counts, topic distribution, sentiment trends, entity mentions over time
- **Stories** — TF-IDF clusters of related articles linked across days
- **Ad Browser** — paginated grid, sort, search, period comparison, clickable category and brand bars
- **Ask AI** — conversational Q&A grounded in retrieved articles
- **Bookmarks** — saved articles per logged-in user
- **OCR Upload** — single-page ingestion through the same pipeline that ran the corpus

---

## Stories — finding the same event across days

Articles often follow the same event for a week. We link them.

- TF-IDF feature vectors over article text
- Cosine similarity ≥ 0.32, 45-day window, top-80 nearest neighbours
- Connected components form story clusters (minimum 3 articles)
- Gemini generates a human-readable title for each cluster

This turns 38,000 isolated articles into a smaller set of narrative threads users can follow.

---

## Ask AI

A conversational layer on top of the archive.

- User asks a natural-language question (e.g. "What was happening in Sindh in March 1990?")
- Backend retrieves the most relevant articles using keyword + entity + date filters
- Gemini answers grounded in the retrieved text, with the source articles cited inline
- Year filter ensures questions about 1991 don't pull 1990 candidates

Built for the case where a user knows the question but not the search query.

---

## Reliability and engineering decisions

- **Idempotent writes** — articles and ads are keyed by content-derived IDs. Re-running ingestion does not duplicate documents.
- **Request-level timeouts** — every Gemini call and every Firestore call has an explicit timeout. One stalled upstream call can't block the API thread.
- **Paginated snapshot scans** — the Firestore SDK crashes on full-collection streams past ~30k docs. We page in 5k chunks ordered by document ID.
- **Analytics cache** — endpoint results are keyed by function name, params, and an article-count version. New ingestion bumps the version and stale entries fall out.
- **Multi-region key rotation** — Gemini calls rotate across five regions to absorb 429 backoff cleanly.

---

## Functional testing

Every dashboard feature was checked end-to-end against the React UI.

| Feature | Status |
| --- | --- |
| User registration and login | Passed |
| Keyword and entity search | Passed |
| Article detail page | Passed |
| Analytics dashboard | Passed |
| Advertisement browser | Passed |
| Bookmarks | Passed |
| Chat (Ask AI) | Passed |
| OCR upload tab | Passed |

---

## What we know are limits

- **Page condition is destiny.** Stains, bleed, and heavy creasing drop accuracy below 60%. The model can't read what isn't visible.
- **Source material isn't ours.** Photographing bound volumes at the library was always going to lose detail at the gutter — a Dawn collaboration would change that.
- **Sentiment is hard on long news articles.** Neutral framing in formal prose hides actual tone. We lean on Gemini to push back.
- **Cost.** 6,958 pages × multiple Gemini calls per page makes ingestion non-trivial. We use batching, duplicate skipping, and resumable workers to keep it practical.

---

## Future work

- **Direct collaboration with Dawn** for cleaner scans
- **Larger time periods** — extend beyond 1990–Jan 1991
- **Community ground truth** — let trusted users correct OCR text and become a reusable training corpus
- **Per-record quality flags** — confidence score per article for downstream researchers
- **Funded deployment** so the platform stays available beyond submission

---

## Reflection

What we got wrong early made the project better.

- Our first project was rejected. We had to start over.
- We thought we'd get clean digital scans from Dawn. We didn't. Frere Hall was the answer instead.
- We migrated from PostgreSQL to Firestore mid-way and had to rebuild the schema.
- The hardest engineering problem wasn't OCR — it was making entity, sentiment, and topic outputs comparable across a corpus where every page looks different.

The team learned to design for the source material we actually had, not the source material we wished we had.

---

## Thank you

**MediaScope**
Habib University · Spring 2026

We'll demo live: search, ad browser, stories, Ask AI, and the OCR upload tab.

Questions welcome.
