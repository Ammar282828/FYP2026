# MediaScope — First-Time User Tutorial

A guided tour of the dashboard for researchers, journalists, and anyone exploring the **Dawn newspaper corpus, 1990–1992**.

> **Estimated time:** 10 minutes to read · 30 minutes to feel comfortable with all surfaces

---

## Before you start

You need:
- The MediaScope dashboard running at `http://localhost:3000` (see [README](../README.md) for setup)
- A free account (sign up takes 30 seconds — described below)

---

## Step 1 — Sign in or create an account

Open the app. Click **"Sign in"** in the top-right corner.

A small dialog appears. New here? Click *"Don't have an account? Create one"* at the bottom and fill in name, email, and a password (≥ 6 characters). You're in.

> **Why an account?** Without one you can browse and search freely, but you won't be able to save bookmarks, pin saved searches, or sync your view history across devices.

---

## Step 2 — The dashboard home

This is the landing page — designed to feel like opening a daily paper, not a SaaS dashboard.

```
┌────────────────────────────────────────────────────────────┐
│  Dawn Newspaper Archive · 1990–1992                        │
│                                                            │
│  On April 26 in the archive                                │
│  12 articles published on April 26 between 1990 and 1992.  │
│                                                            │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  🔍  Search the archive — "Benazir", "Kashmir"…    │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                            │
│   [Benazir Bhutto] [Kashmir] [Gulf War] [MQM] [Cricket]    │
│                                                            │
│  ─── On this day ─────────────────────────────────         │
│  1990  Sindh assembly approves budget                      │
│  1991  Karachi violence enters fourth day                  │
│  1992  Sharif visits Washington                            │
│  ...                                                       │
│                                                            │
│  ┌────────────┬────────────┬────────────┬────────────┐     │
│  │ 5,004      │ 40         │ 73         │ 1990–92    │     │
│  │ ARTICLES   │ TOPICS     │ STORIES    │ COVERAGE   │     │
│  └────────────┴────────────┴────────────┴────────────┘     │
│                                                            │
│  Ongoing stories          │  Recent articles               │
│   • Kashmir uprising  …   │   • IMF $500m loan approved    │
│   • PPP-MQM coalition …   │   • PIA new Karachi route      │
│                                                            │
│  [Analytics] [Ad Browser] [OCR Pipeline]                   │
└────────────────────────────────────────────────────────────┘
```

**What's on this page:**
- **Editorial hero** — what's in the archive on today's calendar date (April 26, May 12, etc.)
- **Search bar** with suggested keywords from the corpus
- **On this day** — articles published on this exact day across 1990–92
- **Stat band** — total articles, topics, stories, coverage period
- **Ongoing stories** — clusters of related articles (Kashmir, MQM-PPP coalition, …)
- **Recent articles** — the latest ingested
- **Quick nav** — jump to Analytics, Ad Browser, or OCR

---

## Step 3 — Search the archive

Click into the search bar (or hit **`/`** anywhere).

**Two modes** — toggle on the left:
- **Keyword** — full-text search across article bodies + headlines (default)
- **Entity** — search by named entity (person, organisation, place)

Type something — `"Benazir"`, `"Kashmir"`, `"cricket"`, `"Bhutto"` — and hit Enter.

### Filtering results

Click **"Filters"** below the search bar to open the drawer. You can narrow by:

| Filter | What it does |
|--------|--------------|
| **From / To** | Date range (defaults to the corpus span) |
| **Sentiment** | Positive / neutral / negative |
| **Topic** | Free-text match against the curated taxonomy ("Pakistan Politics", "Cricket", …) |
| **Entity** | Restrict to a specific entity type (PERSON, ORG, GPE…) |
| **Sort by** | Newest first · Oldest first · Most relevant · Most mentions · Sentiment |

The active-filter count appears as a badge on the Filters button.

### Density toggle

The result list has a small toggle in the top-right (`☰` vs `⋮`). Switch to **compact** mode when you want to scan a lot of results — rows tighten, the preview hides, and zebra striping kicks in.

### Save a search

Click the **bookmark icon** in the toolbar → **"Save current"** in the dropdown. Name it ("MQM-PPP coalition", "Cricket WC 92", whatever). Now it lives in your saved-searches menu — one click to re-run with all filters preserved.

---

## Step 4 — Read an article

Click any result. You land on the article page:

- **Headline + date + page number**
- **Sentiment** chip (positive / neutral / negative + score)
- **Topic** chip (from the curated taxonomy)
- **Entities** — clickable chips for every person, place, and organisation mentioned. Click one to see all articles that mention it.
- **Body text** — the OCR'd article verbatim
- **Ongoing coverage rail** (right side, when applicable) — other articles in the same story cluster
- **Bookmark button** — save the article to your collection
- **Share / open in new tab** — bottom of page

> **Tip:** Hit **`Esc`** to go back to your search results without losing your scroll position or filters.

---

## Step 5 — Browse advertisements

The Dawn archive has historical advertisements alongside news — a goldmine for studying brand presence, consumer goods, and advertising language in early-90s Pakistan.

Click **"Ad Browser"** in the dashboard or top nav.

- **Card grid** — every ad with a brand chip + category + date
- **Keyword search** — find ads mentioning specific products, slogans, or brands
- **Click any card** — opens a modal with the full crop, brand analysis, target audience, design style, and cultural context (Gemini-generated structured analysis)

Recovered brands include PEL Pak Elektron, Moonlite, Toshiba, Berger, Bawany Metals, ENO Fruit Salt, and many more.

---

## Step 6 — Compare two articles side by side

Click **"Compare"** in the top nav. Pick two articles via the picker — useful for:
- Comparing how the same event was covered on different days
- Tracking how a story developed
- Contrasting two newspapers' takes on the same incident

You get headline, date, sentiment, word count, and a shared-entities highlight (entities that appear in BOTH articles).

---

## Step 7 — Follow ongoing stories

The **Stories** tab shows clusters of related articles — automatically grouped by entity overlap and date proximity using DBSCAN clustering.

Each story card shows:
- **Story title** (auto-summarised)
- **Article count** + date span
- **Key entities** (top 3)
- **"Arc written"** badge if Gemini has written a narrative summary

Click a story to see all its articles in chronological order.

> **What counts as a story?** 3+ articles in the same time window mentioning ≥ 2 of the same key entities. Re-cluster anytime by running `python -m scripts.build_stories` from the repo root.

---

## Step 8 — Analytics

The **Analytics** tab is where you go for the macro picture.

### Overview tab
- **Total Articles · Coverage Period · Overall Sentiment** — three primary KPIs
- **Sentiment over time** — line chart, stacked positive/neutral/negative
- **Articles over time** — month-by-month counts
- **Calendar heatmap** — daily article density across the corpus

### Topics tab
- **47 populated topics** — bar chart of articles per topic
- Click any bar → drill into that topic's articles
- Threshold is ≥5 articles, so long-tail buckets like "Puzzles & Crosswords" or "IMF & External Debt" still appear

### Entities tab — Named Entity Explorer
- Pick an entity type (People · Organisations · Locations · Nationalities · Events) — each has a Lucide icon
- See top 30 entities of that type with mention counts + average sentiment
- Click any entity → its articles

### Keywords tab — Interactive Keyword Cloud
- Top 30 keywords across the corpus, sized by frequency
- Click any keyword → articles where it appears
- Useful for finding signal in noise (e.g. spikes around `"earthquake"` or `"election"`)

### Corpus tab
- Per-newspaper stats, page counts, OCR confidence, etc.

---

## Step 9 — Ask AI (Chat)

Click **"Chat"** in the top nav.

Ask questions in natural language:
- *"What did Dawn say about the 1990 IPI cricket series?"*
- *"How did sentiment around Benazir Bhutto change from 1990 to 1992?"*
- *"Find articles mentioning both PIA and the privatisation programme"*

The AI answers with grounded citations to the actual archive articles. Click any citation to jump to the source.

---

## Step 10 — Bookmarks & saved searches

Open your **profile menu** (top-right) → **Bookmarks**.

Two collections live here:
- **Bookmarked articles** — anything you starred while reading
- **Saved searches** — the queries you pinned (also accessible from the search toolbar dropdown)

Both sync across devices when you're signed in.

---

## Keyboard shortcuts

Hit **`?`** anywhere to open the shortcuts panel. The essentials:

| Key | Action |
|-----|--------|
| `/` | Focus the search bar |
| `Cmd+K` (Mac) / `Ctrl+K` | Command palette — jump to any tab, search, or article |
| `Esc` | Back / close modal |
| `g h` | Go home (dashboard) |
| `g s` | Go to search |
| `g a` | Go to analytics |
| `g b` | Go to bookmarks |
| `?` | Show this list |

---

## OCR Pipeline (advanced)

If you have new newspaper scans to add, click **"OCR Pipeline"**.

Drop a JPEG of a newspaper page (phone scan is fine). The pipeline:
1. Detects the masthead → reads date + page number
2. Locates display advertisements → crops and analyses each one
3. OCRs every article on the page
4. Classifies each article (topic + sentiment via Gemini)
5. Extracts named entities
6. Inserts everything into the searchable archive

Takes ~3-4 minutes per page on a typical text-heavy edition.

> **Want to bulk-process a folder?** That's a developer task — see [README](../README.md#backfill-cookbook) for the CLI scripts.

---

## Common questions

**Q: Why does some article say "Unknown" for the date?**
> Dawn's archive includes pages where the masthead was cut off in scanning, or whose filename gave no signal. Those articles are honestly stored as `publication_date = null` rather than fabricating a default. The vision-recovery backfill is continuously trying to recover dates from the masthead OCR — counts will improve over time.

**Q: Why are some topic labels weirdly word-jumbled like `mqm_kashmir_ppp_sindh_minister`?**
> Those are legacy labels from an earlier topic-modelling run (BERTopic). They're being reclassified into the curated taxonomy ("Pakistan Politics", "Kashmir", "MQM", etc.) by the topic backfill — they'll disappear over time.

**Q: I see ads with weird spine/binding crops in the Ad Browser. Why?**
> Some legacy advertisements were saved with bad bounding-box coordinates from an old detection run. The redetect script reprocesses them — affected ads get replaced with fresh, correct crops. If you spot one, file an issue.

**Q: How fresh is the data?**
> Live. Firestore is the canonical store; the dashboard reads it via `/api/analytics/data-version` and busts its analytics cache automatically when the article count changes.

**Q: Can I export search results / charts?**
> Yes — every chart has a small download icon in the top-right (exports to PNG via html-to-image). Search results don't have a CSV export yet — file a feature request.

---

## Where to go next

- **Read articles!** The whole point. Try searching for `"Bhutto"`, `"Kashmir"`, `"cricket"`, `"earthquake"`, or `"IMF"`.
- **Cluster a story** of your own — the Stories tab will show you what's already grouped.
- **Browse the ads** — the cultural snapshot of early-90s Pakistan is something else.
- **Read [`docs/ARCHITECTURE.md`](ARCHITECTURE.md)** if you're a developer who wants to extend the system.

Welcome aboard.
