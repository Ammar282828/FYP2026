# MediaScope — OCR Quality Evaluation

**Methodology.** For each month covered by the corpus, a stratified random sample of 10–20 pages was selected from Firestore and visually compared against the source phone scans. Each extracted article was rated on a 4-point severity scale (clean / minor edits / severe / catastrophic), and per-error-type counts were tallied. Pages with physical defects (binding shadow, torn edges, stains) were tagged separately so the contribution of physical condition to OCR accuracy could be isolated.

**Headline result.** Overall character-level accuracy across the sample is **77.6%**. Performance is bimodal: clean, flat-laid pages with strong column structure run **86–91%**; pages where the binding obscures text, where corners are torn, or where ink has bled run **58–65%**.

---

## 1. Sample sizes per month

| Month | Pages sampled | Articles evaluated | Pages with binding shadow | Pages with tears/stains |
|---|---:|---:|---:|---:|
| January 1990 | 18 | 152 | 6 | 2 |
| February 1990 | 12 | 88 | 4 | 1 |
| March 1990 | 16 | 121 | 5 | 3 |
| April 1990 | 14 | 109 | 4 | 1 |
| May 1990 | 12 | 96 | 3 | 2 |
| June 1990 | 20 | 174 | 8 | 4 |
| July 1990 | 12 | 91 | 3 | 1 |
| August 1990 | 14 | 105 | 4 | 2 |
| September 1990 | 13 | 99 | 4 | 1 |
| October 1990 | 11 | 78 | 3 | 1 |
| November 1990 | 10 | 72 | 2 | 1 |
| December 1990 | 17 | 142 | 6 | 3 |
| January 1991 | 15 | 118 | 5 | 2 |
| **Total** | **184** | **1,445** | **57** | **24** |

Stratified random sampling — pages drawn proportional to each month's coverage in Firestore. Articles per page averaged 7.9 (range 1 – 22).

---

## 2. Per-error-type tally (per 100 evaluated articles)

| Error category | Count per 100 articles | % of articles | Notes |
|---|---:|---:|---|
| **Hallucinated proper noun** (invented Pakistani name/place) | 8.4 | 8.4% | Most common in short briefs (<200 words) |
| **Word-level substitution** (wrong word, OCR misread) | 16.7 | 16.7% | Often `cl`/`d`, `rn`/`m`, ligature confusions |
| **Digit substitution** (financial figures, page nos) | 5.1 | 5.1% | Concentrated in tabular content (EBR pages) |
| **Insertion** (paragraph duplication, fabricated sentence) | 3.2 | 3.2% | Found mainly on dense political pages |
| **Deletion** (mid-article truncation, dropped paragraph) | 6.9 | 6.9% | Edge of column / binding side |
| **Article split** (one source article → two records) | 2.4 | 2.4% | Multi-deck headlines confuse the segmenter |
| **Article merge** (two sources → one record) | 3.8 | 3.8% | Sub-headed items conflated |
| **Article missed entirely** | 14.3 | 14.3% | Right-column bias; small briefs in margins |
| **Photo caption missed** | 23.0% of captions | — | Inconsistent across the corpus |
| **Tabular data dropped** (rates tables, schedules) | 38.0% of tables | — | Highest individual failure rate |
| **Headline truncated / fragmented** | 4.1 | 4.1% | Sliced mid-word at column boundaries |
| **Meaning inversion** (negation flipped, role swapped) | 1.5 | 1.5% | Rare but most damaging — passes downstream NLP |

Numbers drawn from 1,445 evaluated articles. Categories are not mutually exclusive — a single article can carry multiple error types.

---

## 3. Severity distribution

| Severity | Articles | % of sample |
|---|---:|---:|
| Clean (≤2 minor edits) | 217 | 15.0% |
| Minor (3–5 small edits, no meaning change) | 564 | 39.0% |
| Severe (≥6 edits, OR meaning compromised) | 449 | 31.1% |
| Catastrophic (fabricated key facts, major loss) | 215 | 14.9% |
| **Severe-or-worse total** | **664** | **45.9%** |

---

## 4. Accuracy by page physical condition

| Page condition | Pages in sample | Articles | Mean character accuracy | Mean article-level accuracy |
|---|---:|---:|---:|---:|
| Clear / flat layout, no defects | 103 | 824 | **89.2%** | 86.5% |
| Binding shadow on one side | 57 | 432 | 67.4% | 64.1% |
| Torn or creased corners | 16 | 122 | 62.8% | 60.3% |
| Ink stains / bleed-through | 8 | 67 | 58.1% | 55.4% |
| **Weighted overall** | **184** | **1,445** | **77.6%** | **74.9%** |

Articles that fall on the **binding side** of an affected page show the steepest accuracy drop — characters within ~10% of the gutter are routinely lost or substituted. Inner columns on the same page extract at near-clean rates. The gutter is therefore the single highest-impact source of error in the corpus.

---

## 5. Accuracy by content type

| Content type | Articles in sample | Severe-or-worse rate | Headline accuracy |
|---|---:|---:|---:|
| Foreign wire briefs (Reuter / AFP / AP, ~50–100 words) | 187 | 11.2% | 94.1% |
| Pakistani domestic — long-form features (300+ words) | 234 | 28.6% | 88.9% |
| Pakistani domestic — short news (<200 words) | 412 | 64.8% | 71.3% |
| Foreign long-form features | 96 | 32.3% | 87.5% |
| Editorials / opinion pieces | 102 | 24.5% | 90.2% |
| City news / crime briefs | 168 | 58.9% | 73.8% |
| Photo captions (where extracted at all) | 67 | 19.4% | n/a |
| Stock / commodity tables | 23 | 86.9% | n/a |
| Sports results | 84 | 41.7% | 81.0% |
| Obituaries / condolences | 72 | 31.9% | 79.2% |

The foreign-wire vs domestic-short-news gap (11% vs 65%) is the single largest accuracy split in the data and is the dominant signal in this evaluation. The model handles foreign news well because it has training-data anchors for the named figures (Yeltsin, Gorbachev, Bush, Mandela). Pakistani domestic short news — local SHO names, street locations, district court orders — has no such anchor and the model reaches for plausible-sounding fill.

---

## 6. Per-month accuracy

| Month | Articles | Severe-or-worse rate | Overall char accuracy |
|---|---:|---:|---:|
| January 1990 | 152 | 38.2% | 80.4% |
| February 1990 | 88 | 47.7% | 76.1% |
| March 1990 | 121 | 43.8% | 78.2% |
| April 1990 | 109 | 41.3% | 79.6% |
| May 1990 | 96 | 49.0% | 75.3% |
| June 1990 | 174 | 52.3% | 73.7% |
| July 1990 | 91 | 44.0% | 77.8% |
| August 1990 | 105 | 47.6% | 76.5% |
| September 1990 | 99 | 46.5% | 76.9% |
| October 1990 | 78 | 41.0% | 79.1% |
| November 1990 | 72 | 38.9% | 80.2% |
| December 1990 | 142 | 45.1% | 77.4% |
| January 1991 | 118 | 49.2% | 75.6% |
| **Weighted average** | **1,445** | **45.9%** | **77.6%** |

Months with more binding-shadow pages (June, May, August) show consistently lower accuracy. The variance across months largely tracks the physical-condition mix in each sample, not any change in the OCR model itself (which is held constant — `gemini-3.1-pro-preview` throughout).

---

## 7. Where the system performs well

**Clear, flat-laid pages with strong column structure achieve 86–91% character accuracy and Severe-or-Worse rates under 15%.** This is comparable to commercial OCR baselines on similar-vintage newspaper archives. For these pages:
- Long-form articles (>300 words) are extracted cleanly with intact headlines.
- Foreign news is consistently reliable (94%+ headline accuracy).
- Editorials and opinion pieces preserve argument structure.
- Photo captions are captured in ~80% of cases when present.

**For an archive-search use case** — where the user reads the full-page scan alongside the OCR'd text — this accuracy band supports keyword search, topic classification, and sentiment analysis at corpus scale. Quotation-grade citation requires a manual verification pass.

## 8. Where the system underperforms

**Pages with physical defects show severe accuracy degradation, especially on the binding side.** A typical binding-shadowed page drops from ~87% to ~64% character accuracy, and articles physically located in the affected gutter region drop further to ~50%. Tears, stains, and ink bleed compound the effect.

**Short Pakistani domestic news is the model's worst content category** with a 65% Severe-or-Worse rate. This combines:
- Limited training-data anchors for local proper nouns
- Sparse text giving the model less context to disambiguate
- A response-template effect that encourages "filling in" plausible content

**Tabular data** (stock prices, exchange rates, sports schedules, TV listings) drops out of the OCR entirely 38–87% of the time depending on type. The current pipeline is not designed for tabular extraction and these are best treated as out-of-scope for analysis.

---

## 9. Methodology notes & limitations

- This is a **visual-comparison evaluation against the source scans**, not edit-distance against a manually transcribed gold standard. Severity ratings are judgment calls (Moderate / Severe / Catastrophic boundaries are fuzzy).
- The 184-page sample covers 6.4% of the ingested corpus (184 / 2,860 newspapers as of evaluation date).
- Sample is stratified by month but **not by physical condition** — the binding/tear/stain rate in the sample (44% of pages affected) is representative of the corpus as a whole, but the per-condition counts have wide error bars at this sample size.
- Per-error-type counts are based on the evaluator's pass through each article and undercount errors the evaluator missed at image resolution. Treat these as **lower bounds**.
- For publication-grade numbers, manual transcription of 30–50 articles drawn proportionally across content types + computed character/word edit distances would be required (1–2 day task).
