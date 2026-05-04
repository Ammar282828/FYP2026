# MediaScope — Bulk Ingest Runbook

How to run the Drive → Firestore ingest pipeline in parallel without
exhausting the Vertex AI quota. Written after a full day of trial-and-
error so you don't repeat the same mistakes.

---

## TL;DR — the rules that actually matter

1. **All API keys in the same GCP project share one quota.** 11 keys ≠ 11×
   capacity. You have **one project ceiling**; keys are just authentication
   slots, not quota multipliers.
2. **Vertex Express trial-tier ceiling on `gemini-3.1-pro-preview` is
   roughly 6 sustained RPM project-wide.** Past that you start cascading
   429s and poisoning records.
3. **The sustainable parallel-worker count on this project is 4–6.**
   - 6 workers = peak throughput (~30–40 ingests/hr) when quota is fresh.
   - 11 workers = cascading exhaustion within minutes; fast-failed ingests
     write empty 0-article records ("poisoned") that have to be cleaned.
4. **If you need more than 6 workers, spread keys across multiple GCP
   projects.** Each project has its own ceiling.
5. **Don't share keys across machines without coordinating.** Two laptops
   running 6 workers each = 12 RPM on the same project = the quota wall.

---

## How the pipeline is structured

### One bulk runner = one Python process

`/tmp/bulk_ingest.py` is a single resume-safe runner that:

1. Reads a manifest (list of Drive file IDs)
2. Reads a checkpoint (set of file IDs already done/errored/skipped)
3. For each unprocessed file in the manifest:
   - Downloads via Drive API (service account, *not* gdown public-link)
   - Runs cheap masthead OCR to get date + page number
   - Dedup-skip if `(date, page)` already exists in Firestore
   - Month-skip if `--skip-months 1990-12` covers it
   - Otherwise: full pipeline (region detect → per-region OCR → ads → upload → Firestore writes)
   - Marks the file ID in the checkpoint and `rm`s the local download
4. Throttles ~1 s between files

### Inside one worker — internal key rotation

Each worker reads two env vars at startup:

| Env var | Purpose |
|---|---|
| `GEMINI_API_KEY` | Primary Vertex key. Used until it 429s. |
| `GEMINI_API_KEYS` | Comma-separated rotation pool. When the primary 429s, the worker round-robins through these. |

Inside one ingest, the **regional OCR** step fans out 3–4 concurrent
threads (one per detected article region). When the primary key 429s on
any region OCR call, `services/pipeline.py:_rotate_key()` fires:

```
[INFO] Rotating to API key 1/11 (vertex:…uH9Hkw)
[INFO] Rotating to API key 2/11 (vertex:…YGq3UQ)
…
[ERROR] All API keys exhausted quota   ← if every key in the pool 429s
```

`All API keys exhausted` means the request gave up; the article falls
back to whole-page OCR or the page is written as a poisoned 0-article
record. Sustained `All API keys exhausted` across multiple workers means
the project quota is genuinely depleted, not just one slow key.

### N parallel workers = N OS processes

Each worker has its own:
- Manifest slice (we shard the master manifest N ways)
- Checkpoint file (so writes don't conflict)
- Workdir for downloaded JPGs

They share Firestore (correct — that's how cross-worker dedup works) and
they share the project quota (the problem).

---

## Step-by-step: launch N workers safely

### 1. Confirm key health (single sequential call per key)

```bash
GEMINI_API_KEY=AQ.... \
  python -c "
from services.gemini_adapter import create_model
m = create_model('AQ.....', 'gemini-3.1-pro-preview')
print(m._client.models.generate_content(
    model='gemini-3.1-pro-preview', contents='reply OK').text)
"
```

A clean "OK" in 3–6 s = key fine. A 403 = billing disabled on that key's
project. A 429 = project quota saturated, wait 10 min.

### 2. Burst-test the project's concurrent ceiling

```bash
python -c "
import concurrent.futures, time
from services.gemini_adapter import create_model
keys = ['AQ.key1', 'AQ.key2', 'AQ.key3', 'AQ.key4', 'AQ.key5', 'AQ.key6']
def call(i, k):
    t = time.time()
    m = create_model(k, 'gemini-3.1-pro-preview')
    r = m._client.models.generate_content(model='gemini-3.1-pro-preview', contents='OK')
    return f'K{i+1}: {time.time()-t:.1f}s'
with concurrent.futures.ThreadPoolExecutor(max_workers=len(keys)) as ex:
    for f in concurrent.futures.as_completed([ex.submit(call, i, k) for i, k in enumerate(keys)]):
        print(f.result())
"
```

If all N return in under 8 s with no errors, you can probably sustain N
workers. If any take 25 s+ or 429, drop N by 1 and re-test.

### 3. Partition the manifest across workers

```python
import json
m = json.load(open('/tmp/manifest.json'))
processed = set(json.load(open('/tmp/checkpoint.json'))['done'])
remaining = [f for f in m['files'] if f['id'] not in processed]

N = 6
chunks = [[] for _ in range(N)]
for i, f in enumerate(remaining):
    chunks[i % N].append(f)
for w in range(N):
    json.dump({'files': chunks[w]},
              open(f'/tmp/w{w+1}_manifest.json', 'w'))
    json.dump({'done': [], 'errored': [], 'skipped_dedup': []},
              open(f'/tmp/w{w+1}_progress.json', 'w'))
```

### 4. Launch each worker with primary key + rotation pool

```bash
ALL_KEYS="AQ.key1,AQ.key2,AQ.key3,AQ.key4,AQ.key5,AQ.key6,AQ.key7,AQ.key8,AQ.key9,AQ.key10,AQ.key11"

# Worker 1, primary K1
GEMINI_API_KEY="AQ.key1" \
GEMINI_API_KEYS="$ALL_KEYS" \
GOOGLE_APPLICATION_CREDENTIALS=firebase-service-account.json \
nohup python -u /tmp/bulk_ingest.py \
  --manifest /tmp/w1_manifest.json \
  --workdir /tmp/work_w1 \
  --checkpoint /tmp/w1_progress.json \
  --throttle 1.0 \
  --skip-months 1990-12 \
  > /tmp/bulk_w1.log 2>&1 &
```

Repeat for w2…wN with a different primary key each. **Every worker
should still see the FULL ALL_KEYS list as its rotation pool** — that's
what makes momentary 429s recoverable.

### 5. Watch for cascading 429s

```bash
tail -qF /tmp/bulk_w*.log | grep --line-buffered -E "✓ \[|✗ |All API keys exhausted|FATAL"
```

What healthy traffic looks like:
- ✓ ingests landing every 30 s – 5 min depending on page complexity
- Maybe 1–2 `All API keys exhausted` events per hour (one rotation cycle
  through the whole pool, isolated)
- 0 fast-poison ingests (`0 articles, 0 ads in <90s`)

What a quota cascade looks like:
- `All API keys exhausted` every 10–30 s
- Workers spend more time rotating than ingesting
- `0 articles, 0 ads in 60s` records start appearing — these are poisoned
  and need to be deleted

When you see a cascade: **kill workers immediately**, wait 10 min for
quota to recover, restart with N-2 workers.

### 6. Clean up if you poisoned records

```bash
# Find them
GOOGLE_APPLICATION_CREDENTIALS=firebase-service-account.json python -c "
from google.cloud import firestore
db = firestore.Client.from_service_account_json('firebase-service-account.json')
for d in db.collection('newspapers').stream():
    a = d.to_dict()
    if not list(db.collection('articles').where(
            filter=firestore.FieldFilter('newspaper_id','==',d.id)).limit(1).stream()):
        print(d.id, a.get('image_filename'))
"
```

Delete the empty newspaper docs and remove their file IDs from the
worker checkpoint so the bulk runner reprocesses them on the next pass.

---

## Coordinating with a second person

You and your friend are both ingesting into `fyp2026-87a9b`. The
**Vertex quota is on whichever GCP project the keys come from**, not the
Firestore project.

- All 11 keys we created live in **`project-31b2b788-913e-4a04-ba6`**.
  They share that project's Vertex quota.
- The Firestore project is **`fyp2026-87a9b`** — that's where the
  articles end up. No quota fight there.

Two safe-coordination patterns:

**Pattern A — split the keys.** You take K1–K6, friend takes K7–K11.
You can each run up to 4–6 workers safely (since Vertex Express ceiling
is shared at the project level, this still risks contention but at least
the keys themselves don't double-up). For this corpus's quota, neither
of you should run more than 4 workers when both are active.

**Pattern B (better) — friend creates their own GCP project.** Friend
makes 6 keys in `friend-personal-project`. Now each of you has an
independent Vertex ceiling. You can both safely run 6 workers
simultaneously without quota contention.

Either way, **share the Firestore project's read access** so cross-
worker dedup catches your friend's already-processed pages and you
don't redo work.

---

## Quota cheat-sheet

| Symptom | Cause | Fix |
|---|---|---|
| `429 RESOURCE_EXHAUSTED` on a single call | Per-key rate-limit | Worker rotates; usually self-heals in <5 s |
| `All API keys exhausted` once every 5–10 min | Project ceiling brushing | Acceptable; rotation absorbs it |
| `All API keys exhausted` every 30 s | Project quota saturated | Drop worker count, wait 10 min |
| `0 articles, 0 ads in 60s` ingest log | Region detection 429'd → empty record written | Cascade in progress; kill workers, clean records |
| `403 PERMISSION_DENIED billing disabled` | `.env` key is from a project without billing | Swap `GEMINI_API_KEY` to a key bound to a billed project |
| `gdown rc=1: Cannot retrieve the public link` | Drive public-link rate-limit | We don't use gdown anymore — use Drive API + service account |

---

## What we tried that didn't work

- **11 workers with 11 keys**: cascaded within 5 min. Drove 70+ exhaust
  events in 15 min and started poisoning records. Don't.
- **Sequential 60s sleeps + retry**: doesn't help, quota is per-minute
  bucket; sleeping just moves the bucket forward.
- **"Cool-off and try again" without dropping worker count**: quota stays
  saturated as long as the same N workers come back hot. You have to
  reduce N.
- **Trying gdown public-link downloads in parallel**: Drive rate-limits
  public-link requests aggressively. Always use the Drive API with the
  service account.

---

## Quick reference — env vars summary

```bash
# Drive + Firestore (service account file)
GOOGLE_APPLICATION_CREDENTIALS=firebase-service-account.json
FIREBASE_STORAGE_BUCKET=fyp2026-87a9b.appspot.com

# Vertex (per worker)
GEMINI_API_KEY=AQ.<primary-key>      # this worker's "home" key
GEMINI_API_KEYS=AQ.k1,AQ.k2,…,AQ.k11 # rotation pool when primary 429s

# Optional model overrides
GEMINI_MODEL=gemini-3.1-pro-preview  # default, used by ImageProcessor
TOPIC_MODEL=gemini-2.5-flash         # cheaper, used by topic backfill
```
