# How every analytic + story is computed

For the eval, so you can answer "how does this work?" with specifics. Each section: what shows on screen, the input data, the algorithm, and the known gotchas.

---

## 1. KPI cards (Total Articles, Coverage Period, Overall Sentiment)

**Total Articles**
Counts every doc in `articles` whose `publication_date` is in the corpus window (1990-01 to 1991-01) AND `low_quality` is not true. Computed at snapshot-load time.

**Coverage Period**
Min and max `publication_date` across the snapshot. Filtered to corpus window so a single OCR-misread "1996" doesn't push the max.

**Overall Sentiment**
Mean of `sentiment_score` across all visible articles. `sentiment_score` is a per-article number in [-1, +1] produced by VADER (lexicon-based) at ingest. Hot take: this is fine for trend lines, less reliable for absolute calls.

---

## 2. Coverage Calendar (heatmap)

**Endpoint:** `/api/analytics/articles-by-day`

**Algorithm:**
1. Group `low_quality=false` articles by `publication_date.strftime('%Y-%m-%d')`
2. Each cell = article count that day
3. Color intensity = log-scaled bucket of count (so a few high days don't wash out the rest)

**Gotcha:** Days with no articles get no cell rendered. A blank week means no coverage *or* OCR pipeline never ran on those photos.

---

## 3. Articles Published Over Time (monthly bar chart)

**Endpoint:** `/api/analytics/articles-over-time`

Same source as the calendar, but bucketed by `YYYY-MM`. The visible spike in Jun-Aug 1990 is real Gulf War coverage volume.

**Gotcha:** December 1990 looks low (832 articles). Two reasons:
- The Sep_to_Dec_90 Drive folder had less coverage of December than other months
- Some December scans went to `low_quality` because of OCR scarring

---

## 4. Sentiment Distribution (pie)

**Endpoint:** `/api/analytics/sentiment-overview`

Buckets every article's `sentiment_score`:
- > +0.1 → positive
- < -0.1 → negative
- otherwise → neutral

The 71% neutral / 19% negative / 10% positive split is what VADER reports.

---

## 5. Top Entities (PEOPLE / ORGS / PLACES)

**Endpoint:** `/api/analytics/top-entities-fixed`

**Algorithm:**
1. For each article, walk its `entities` array (output of spaCy NER at ingest)
2. Per-article dedup — count an entity at most once per article. Without this, "Karachi" mentioned 5× in one article counted as 5 toward Karachi's total
3. Apply blocklist: drops generic nouns (Government, Press), wire-service tags (Reuter, AFP), Pakistani city names mis-tagged as PERSON (Larkana, Sukkur, Sialkot, Nawabshah, Hyderabad), ethnic groups mis-tagged PERSON (Mohajirs, Pathans), and bare ambiguous surnames (Hussain, Khan, Sharif, Bhutto — these conflate multiple distinct people, full names like "Saddam Hussein" still surface)
4. Normalise (strip "the ", lowercase compare, title-case display)
5. Sort by article-count descending

**Gotcha:** The PERSON top still has noise — spaCy is a generic English model with no Pakistan-specific tuning. Future work: fine-tune NER on hand-labelled Pakistani news.

---

## 6. Topic Distribution (the long taxonomy list)

**Source for the chip count:** `/api/topics/` — returns the JSON taxonomy with **live** Firestore counts (was previously stale JSON-baked counts; chip and detail page used to disagree).

**Source for the topic_id on each article:** `assign_topics_gemini.py` runs at ingest: feeds (headline + first ~500 chars) to Gemini-2.5-flash with the 85-category taxonomy and asks for the best match.

**Hidden from the trend charts (not the taxonomy list):** Tenders & Classifieds, Job Listings, Legal Notices, Obituaries, Puzzles, "Other / Uncategorised", "Topic 10000+" placeholders.

**Gotcha:** The "Other / Uncategorised" bucket grows when the topic classifier hasn't run on new ingest yet. Currently ~6k articles are unclassified because the 25,418-article topic backfill is still in progress (~1/sec, 8h ETA).

---

## 7. Topic Trends Over Time (multi-line)

**Endpoint:** `/api/topics/trends-over-time`

For each topic in the dropdown:
1. Pull every snapshot article with `topic_id == that_topic` AND `not low_quality`
2. Bucket by `granularity` (year / month / day)
3. Plot one line per selected topic

**Gotcha:** The September dip across all topics is because September articles are the most recent ingest and most haven't been topic-classified yet — they have `topic_id=None`. Will fill in as the classifier progresses.

---

## 8. Topic Sentiment Over Time (multi-line)

Same shape as Topic Trends, but each point is the **mean sentiment_score** of articles in that topic in that period (not count).

**Gotcha:** Same September gap as above. Also: topics with very few articles in a given month produce noisy lines because the mean of 3-4 scores is not stable.

---

## 9. Entity Relationships (co-occurrence)

**Endpoint:** `/api/analytics/entity-cooccurrence`

**Algorithm:**
1. Take a sample of up to 1,500 articles from the snapshot
2. For each article, collect its filtered entity list (after blocklist + per-article dedup)
3. Pre-pass per article: pick ONE canonical type per entity name (priority: PERSON > ORG > GPE > LOC > NORP). Without this, "Iraq" appeared once as GPE and once as NORP in the same article and we double-counted Iraq+Kuwait pairs
4. For every pair of distinct entities in the article, increment that pair's count
5. Cap to top-N pairs by count, with one example article per pair

**Gotcha:** Sampling 1,500 articles means rare-but-meaningful relationships might not surface. The example article shown for each pair is just the FIRST article we found containing both — not necessarily the most relevant. Future work: rank examples by content density of both entities together.

---

## 10. Top Keywords (word cloud)

**Endpoint:** `/api/analytics/top-keywords`

**Algorithm:**
1. For every snapshot article, take `headline + content`, lowercase, split by whitespace, strip punctuation
2. Drop tokens shorter than 4 chars, all-digit tokens, numbered patterns, and stopwords (the, and, etc., plus OCR-noise tokens like `illegible`, `unreadable`, plus generic words like `government`, `against`, `today`)
3. Skip articles flagged `low_quality`
4. Frequency-rank what's left

**Gotcha:** This is bag-of-words at the article level — it doesn't understand phrases, so "Benazir Bhutto" is split into "benazir" and "bhutto". For phrase-level analysis use the Top Entities chart instead.

---

## 11. Stories (clustered narrative threads)

**Built by:** `scripts/build_stories_v2.py`

**Algorithm:**
1. **Pre-filter**: drop classifieds, garbage headlines, articles with <80 words, articles flagged `low_quality`. ~22,759 articles survive
2. **Dedup near-identical**: drop articles whose `(date, headline-lowercase)` collides with another — kills reprints and "Correction" boilerplate
3. **Compute IDF** across all remaining articles per entity. Rare entities ("Anjuman-i-Talaba-i-Islam") weigh more than common ones ("Pakistan")
4. **Build feature vectors** over (entities + headline content-words + topic) with IDF weighting
5. **Cluster via UNION-FIND**: for each article, find its k-nearest forward neighbours (top-k=80) within a 45-day window where cosine similarity ≥ 0.32. Connect them. Connected components are clusters
6. **Filter clusters** to size ≥ 3 articles (singletons and duos are noise)
7. **Generate titles** with Gemini-2.5-flash (one call per cluster, ~4-7 word event title). When AI titling is skipped (no GEMINI_API_KEY), fall back to "Entity1 · Entity2 · Entity3" stitched from the cluster's most common entities
8. **Write** as `stories` collection with `story_id` link added to each constituent article

**Gotcha 1:** Without AI titles, ~130 stories ended up named after a topic ("Pakistan Politics", "Crime & Violence"). Those have been deleted as cluster fallback noise — they were just "3 articles in topic X that happened the same week", not real narratives. The list endpoint also blocks them server-side now in case they reappear.

**Gotcha 2:** Cluster duration is often short (2-5 days). That's because the date window is 45 days but the cosine threshold + UNION-FIND tends to merge tightly. A real news event clusters fast and wide because so many articles cite the same entities in the same week.

**Gotcha 3:** We didn't run the AI title pass on this build because the script reads `GEMINI_API_KEY` (single-key) and the env was set up with `GEMINI_API_KEYS` (rotation pool). Easy to fix and re-run; for the eval, the entity-stitch titles work as labels.

---

## 12. Ad Browser

**Endpoints:** `/api/ads/browse`, `/api/ads/search`, `/api/ads/analytics/summary`

**Source:** the `advertisements` collection. Every doc has the Gemini-Vision analysis blob (brand, category, design style, target audience, sentiment).

**Filters applied at the cache layer (so all three endpoints agree):**
- House-promo filter: drops Dawn / Herald self-ads
- ILLEGIBLE-brand filter: drops ads where brand contains `[ILLEGIBLE]`
- Date-window filter: drops ads outside 1990-01 to 1991-01

**Browse + search return the same 2,797 ads.** Summary's `total_ads` matches.

**Sort options:** Newest first (default), Oldest first, Brand A-Z, Category A-Z. Sort happens client-side on the already-fetched 2,000-ad page.

**Click categories or brands** in the Analytics view to drill into Browse with that filter.

---

## 13. Ask the Archive (chat)

**Endpoint:** `/api/chat/ask`

**Pipeline:**
1. **Extract signals** from the question: keywords (lowercased non-stopword tokens), proper nouns (capitalised multi-word spans), years (regex `\b(19[89]\d|20\d{2})\b`)
2. **Multi-strategy retrieval** in parallel:
   - Keyword search across each significant term (top 8 keywords)
   - Entity search on each proper-noun phrase (top 6)
   - If a year was mentioned, pull the top 60 articles from that year
3. **Year filter** — when a year is mentioned, restrict candidates to articles in that year (with soft fall-back to mixed pool if filter would empty results). This is what fixed the "What happened in 1991?" bug — previously keyword/entity hits saturated the pool with 1990 articles before the year search ran
4. **Score** each candidate: question-term overlap (high weight) + proper-noun verbatim hit (+2 each) + multi-source bonus (+2 if found via 2+ retrieval strategies) + 0.04 × OCR-quality score
5. **Send top 12 articles** plus conversation history to gemini-2.5-flash with explicit grounding rules: cite every claim with `[n]`, no general knowledge, flag OCR damage rather than guess
6. **Return** answer + sources list with `citation_index → article_id` mapping so the frontend can link back

**Gotcha:** The retrieval depends on the corpus *containing* relevant articles. Asking "What happened in 1995?" correctly returns "no matching articles in the archive" because we only have 1990-Jan 1991. Sample questions on the empty state are chosen specifically to hit dense parts of the corpus.

---

## 14. Search (full-text + entity)

**Endpoint:** `/api/articles/list` (date-range queries) and `/api/search/keyword`, `/api/search/entity`

**Keyword search:**
1. Take the lowercased query
2. Walk the snapshot, count occurrences in `headline + content`
3. Score = `mentions + 3 if in headline + 0`
4. Tiebreak by `created_at` desc

**Entity search:**
1. Walk the snapshot
2. Match against the `entities` array — exact match OR target is a whole-word substring of any entity text
3. Skip `low_quality`

**Gotcha:** Both are linear scans over the snapshot. With 35k visible articles, a search returns in <500ms. If we ever need <100ms, we'd add a proper inverted index (Whoosh / SQLite FTS).

---

## 15. Calendar drill-in (BrowseByDate)

Click a day in the Coverage Calendar → switch to BrowseByDate tab → load all articles + ads for that day.

**Endpoint:** `/api/articles?date_from=YYYY-MM-DD&date_to=YYYY-MM-DD&limit=500&sort_by=date_asc`

Articles are ordered ascending so you read down the day chronologically. Ads for the same day are loaded from `/api/ads/browse?start_date=...&end_date=...`.

---

## What every analytic *can't* do (be honest in Q&A)

1. **Detect causality** — entity co-occurrence shows that two entities appeared in the same article, not that they're related causally
2. **Distinguish people with the same surname** — bare "Hussain" was conflating 5 people; we mitigated by dropping the bare surname so full names dominate, but if Saddam Hussein and Altaf Hussain co-occur in an article, they're treated as two distinct entities
3. **Capture ironic / sarcastic sentiment** — VADER is lexicon-based and reads "great achievement" as positive even when the article is mocking
4. **Verify OCR quality automatically** — `low_quality` flag is a heuristic on `[ILLEGIBLE]` density, not an audit. Some flagged articles are recoverable; some unflagged ones are still partial
5. **Tell you *why* a story matters** — the cluster algorithm groups articles, but doesn't summarise the event. The AI titling step would do that; we didn't run it on this build

This is the honest version. If asked, every "how does this work?" has a real answer, with a real limitation behind it.
