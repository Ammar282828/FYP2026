# MediaScope — Gamma slide outline

Paste this into Gamma. Each `---` is a slide break. Built for a 15-min talk + 10-min Q&A.

---

# MediaScope
## A searchable AI archive of Dawn newspaper, Pakistan 1990–1992

Final-year project · Ammar Mansa · 2026

37,000 articles · 4,000 pages · 2,500 ads · 340 stories · 13 months

---

# The problem

Pakistan's most important political year sits in physical print. Bhutto's first government. The Gulf War. The 1990 elections. The rise of MQM.

If you want to read any of it today, you scroll page-by-page through scanned PDFs at the National Library. There's no keyword search, no entity index, no way to ask "what did Dawn say about Saddam Hussein in August 1990?" without committing a weekend.

---

# What MediaScope does

iPhone photos go in. A searchable archive comes out.

- Ingest the photos with Gemini Vision OCR
- Search 37k articles by keyword, entity, or date range
- Browse by calendar heatmap, month, topic, or named entity
- See sentiment and topic trends over time
- Ask natural-language questions, get back cited answers

---

# System architecture

```
React + TypeScript frontend  →  FastAPI backend  →  Firebase Firestore
        :3001                         :8000        (37k articles, 4k newspapers,
                                                   2.5k ads, 340 stories)
                                          │
                                          ├→  Firebase Storage  (image hosting)
                                          └→  Vertex AI Gemini
                                                 2.5-pro for vision
                                                 2.5-flash for text
                                                 5 regions, 16 keys
```

---

# Ingest pipeline

1. Download a page from the Drive folder.
2. Enhance the image: EXIF transpose, then Tesseract checks orientation, then contrast boost.
3. Send to Gemini-2.5-pro to detect article bounding boxes and pull out the headline and body.
4. Run a separate Gemini call to detect ads. The prompt explicitly rejects tenders and vacancies, which used to pollute the ad corpus.
5. Enrich with spaCy NER, sentiment, and Gemini-flash topic classification.
6. Write to Firestore.

If a worker crashes, the per-worker checkpoint means it resumes from the last successful page. No duplicate work.

---

# Tech stack: frontend

- **React 18 + TypeScript.** Types caught a lot of prop-shape bugs when wiring 70+ endpoints into chart components — those bugs would otherwise have been silently empty charts.
- **React Router v6.** URL-driven tabs (`/dashboard?tab=analytics&sub=topics`) so the back button works and views are linkable.
- **Recharts.** D3 would have been more powerful but 4× the code. Recharts gave me what I needed in a React idiom.
- **Axios** for HTTP, with interceptors for auth headers.
- **CSS Modules + a sepia theme.** Anchors the look to the subject matter.

---

# Tech stack: backend & storage

- **Python 3.13, FastAPI, Uvicorn.** Async, automatic OpenAPI docs at `/docs`, Pydantic does input validation so I get 400 errors for free.
- **Firebase Firestore.** I picked it for schema flexibility — I kept adding fields like `low_quality`, `topic_method`, `metadata_confidence` without writing migrations. Trade-off: full-collection scans crash past ~30k docs in the SDK's retry path. I worked around it with paginated 5k-doc reads everywhere.
- **Firebase Storage** for newspaper and ad images. Public CDN URLs the frontend can hotlink.
- **JWT + bcrypt** for auth. Secret lives in `.env`, not in source.
- **In-memory + on-disk snapshot cache** of all 37k articles. First load is 100 seconds, after that everything analytics-related runs in milliseconds.

---

# Tech stack: AI & NLP

- **Gemini 2.5-pro** for OCR. Pakistani newspapers in mixed English / Urdu typography are out of distribution for traditional OCR — Tesseract's word error rate on these scans is unworkable.
- **Gemini 2.5-flash** for topic classification (85 categories), the Ask-AI chat, and per-article summaries. About 4× cheaper than pro per call.
- **Vertex Express keys with 5-region rotation.** Each region has its own quota slice, so cycling them gives roughly 5× the throughput of a single-region setup. Combined with 3 keys = 15 effective quota slots.
- **Tesseract** for orientation detection only — never OCR. Free, fast, and confidence-gated so it only acts when sure.
- **spaCy NER** with a 30-token blocklist and per-article dedup. Without those, "Karachi" was being inflated 5× because the dateline appears in 33% of articles.
- **Custom TF-IDF + UNION-FIND** for story clustering. I tried BERTopic first; 30 minutes for 22k articles. The custom version runs in seconds and gives a cleaner signal because the entity-IDF weighting matches what actually makes a "story".

---

# Datasets

| Collection | Count | What's in it |
|---|---|---|
| Newspapers | ~4,000 | One doc per page |
| Articles | ~37,000 | Topic + sentiment + entities |
| Ads | ~2,500 | Brand, category, design analysis |
| Stories | ~340 | TF-IDF + UNION-FIND clusters |
| Users + bookmarks | per-user | JWT auth |

Coverage: Jan 1990 to Jan 1991. Big spike in June–August from Gulf War coverage.

---

# Live demo

I'll switch to the app. Quick agenda for orientation:

1. Landing → dashboard KPIs *(45s)*
2. Analytics: calendar heatmap, monthly volume, sentiment pie *(75s)*
3. Topics: 85 categories, top is Foreign Relations, Cricket, Education *(45s)*
4. Entities: Bhutto 633 mentions, Sharif 368, MQM 495, PPP 1,308 *(60s)*
5. Search "Bhutto" → 1,000 results, dateline-clean previews *(90s)*
6. AdBrowser: 1,300+ ads, sort + rotate, click into modal *(90s)*
7. Stories: clustered narrative threads *(45s)*
8. Ask-AI: "What happened during the 1990 election?" *(60s)*

---

# Testing

- 41 backend endpoints dry-run via curl. 36 worked first pass; I fixed the 5 that didn't.
- Every frontend tab walked via headless Chrome to confirm it renders real data, not just a loading spinner.
- The September ingest run processed 537 files with checkpoint resumption. About 98% landed first pass; the rest went into a retry queue.
- 3 OCR workers, the topic classifier, and the stories rebuilder ran simultaneously without quota deadlock.

---

# Performance

- Articles snapshot (37k docs): **104 seconds the first time, instant after that.** 5-minute TTL, falls back to disk if Firestore times out.
- `/api/ads/analytics/summary`: **12s → 4ms** with the cache. ~3000× speedup.
- `/api/ads/browse`: **600s → 44s first → 143ms cached.** Concurrent newspaper-image attach plus LRU.
- Articles list endpoint: about 2 seconds.
- Ingest throughput: 5–25 minutes per page on Gemini-pro depending on how dense the page is.

---

# Bugs we found and fixed

These came out of the eval-prep audit. Real production bugs, not nits.

1. JWT secret was hardcoded in source. Anyone who'd seen the repo could forge tokens. Moved to env.
2. Firestore SDK retry path crashes on 30k+ doc scans. Same bug broke the dashboard, topics, keyword trends, and the stories rebuild. Fixed in 5 places by paginating in 5k chunks.
3. Karachi was the #1 entity by a wide margin because the dateline appears in 33% of articles. Per-article dedup + blocklist fixed it.
4. `illegible` was the #1 keyword with 35,817 mentions. From every `[ILLEGIBLE]` placeholder. Stopword + low-quality skip fixed it.
5. Bookmark counter was a read-modify-write race. Two concurrent bookmarks would both go from 0 to 1. Switched to `firestore.Increment()`.
6. Chat hit a billing-disabled project because it was reading the legacy single key. Rerouted through the working rotation pool.
7. AdBrowser took 600+ seconds to load because the parent-image lookup was sequential. Switched to a 16-thread pool plus a persistent cache.
8. Date cleanup deleted 2,572 out-of-range / NULL-date docs.
9. 123 articles deleted, 2,586 flagged `low_quality` (hidden from search, kept on disk in case a re-OCR pass can recover them).

---

# Limitations

- OCR scarring. Pages photographed at an angle produce `[ILLEGIBLE]` markers. About 2,600 articles got hidden from search.
- Date defaults. When Gemini can't read the day on the masthead, it falls back to the 1st of the month. That's why Jan 1, 1990 has 338 papers in the corpus when it should have one or two.
- Source attribution is missing entirely. The pipeline never extracts `source` from the byline, so the Source chart shows only "Unknown".
- Entity model misclassifies some Pakistani names. Larkana and Sukkur get tagged PERSON instead of GPE. The blocklist filters them but a Pakistan-specific NER would do better.
- Coverage is uneven. September was almost empty until last week. Some days still have under 10 pages.
- It's a single-machine deployment. Fine for the demo, not production.

---

# Future work

- Re-OCR the 338 Jan-1-default papers with a stricter date prompt.
- Source-from-byline backfill — parse "By Reuter / AFP / PPI" from the article's first line.
- Train a Pakistan-specific NER on ~500 hand-labelled articles.
- One-paragraph Gemini-generated synopsis for each story cluster.
- Incremental ingest: watch the Drive folder for new uploads.
- Redis-backed snapshot so a backend restart is sub-second instead of 100 seconds.

---

# Why this matters

It works. 37,000 articles, 2,500 ads, 340 stories, all searchable, deployed on a Mac mini, with the full ingest pipeline running.

Every architectural choice has a reason behind it that holds up to "why not the alternative". The hard parts (snapshot pagination, entity dedup, key rotation, orientation auto-correction) came from real failures, not from a checklist.

And the pipeline isn't tied to Dawn. Drop another newspaper's photos in and it just works.

Questions?

---

# Appendix — numbers for slide footers

- 37,000+ articles
- 4,000 newspaper pages
- 2,500 ads with full analysis
- 340 clustered stories
- 85 topic categories
- 50,000+ named entities
- 5 Vertex AI regions cycled per call
- 16 Gemini API keys in rotation
- 13 months of continuous coverage
- 3000× speedup on ads analytics
- 600s → 143ms speedup on ads browse
