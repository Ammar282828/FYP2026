#!/usr/bin/env python3
"""
MediaScope Complete Processing Pipeline
- OCR with Gemini
- Layout Detection
- Named Entity Recognition (spaCy)
- Sentiment Analysis (RoBERTa/DistilBERT)
- Topic Classification (Gemini API)
- Database Storage (Firestore)
"""

# this is the main processing pipeline that does OCR and NLP stuff
# it uses gemini for OCR, spacy for entities, and gemini for topics

import os
import re
import json
from datetime import datetime
from pathlib import Path
from typing import List, Dict, Optional, Tuple
import uuid
from dotenv import load_dotenv

load_dotenv()

from PIL import Image, ImageEnhance, ImageOps
import google.generativeai as genai

from services.gemini_adapter import create_model as _create_gemini_model, describe_key as _describe_key

# spaCy + transformers are heavy and only needed by NLPProcessor (entities,
# sentiment). Image-only consumers (e.g. scripts/redetect_broken_ads.py
# which uses ImageProcessor in isolation) shouldn't have to install them.
# Defer import failures until NLPProcessor is actually constructed.
try:
    import spacy  # type: ignore
except ImportError:
    spacy = None  # type: ignore
try:
    from transformers import pipeline  # type: ignore
except ImportError:
    pipeline = None  # type: ignore

from database.firestore_db import get_db as get_firestore_db

from dataclasses import dataclass

def _load_gemini_keys() -> tuple:
    """Load Gemini API keys from environment variables.

    Supports GEMINI_API_KEY (single) and GEMINI_API_KEYS (comma-separated rotation).
    Returns a tuple of keys. Empty tuple if none set.
    """
    keys = []
    primary = os.getenv("GEMINI_API_KEY", "").strip()
    if primary:
        keys.append(primary)
    rotation = os.getenv("GEMINI_API_KEYS", "").strip()
    if rotation:
        for k in rotation.split(","):
            k = k.strip()
            if k and k not in keys:
                keys.append(k)
    return tuple(keys)


@dataclass
class Config:
    GEMINI_API_KEY: str = os.getenv("GEMINI_API_KEY", "")
    GEMINI_API_KEYS: tuple = _load_gemini_keys()
    # Default OCR model. gemini-3.1-pro-preview was the best multimodal
    # but is single-region (us-central1 only) and severely RPM-capped on
    # trial-tier projects, which corrupted ingests by losing per-region
    # OCR calls to 429s. gemini-2.5-pro is published in every Vertex
    # region so we can multiply throughput via region rotation, and the
    # OCR-quality delta is negligible. Override via OCR_MODEL env var.
    GEMINI_MODEL: str = os.getenv("OCR_MODEL", "gemini-2.5-pro")
    
    DB_HOST: str = "localhost"
    DB_PORT: int = 5432
    DB_NAME: str = "mediascope"
    DB_USER: str = "mediascope_user"
    DB_PASSWORD: str = "your_password"
    
    ES_HOST: str = "localhost"
    ES_PORT: int = 9200
    ES_INDEX: str = "mediascope_articles"
    
    INPUT_FOLDER: str = "/Users/ammarmansa/Downloads/Jan_t" \
    "" \
    "o_May"
    OUTPUT_FOLDER: str = "./processed_newspapers"
    
    SPACY_MODEL: str = "en_core_web_lg"
    SENTIMENT_MODEL: str = "cardiffnlp/twitter-roberta-base-sentiment-latest"
    # Sentiment backend: "roberta" (legacy HF Twitter model) or "gemini"
    # (services/sentiment_gemini, full-article LLM scoring). Gemini is more
    # accurate on Dawn 1990s prose — see scripts/audit_sentiment.py — but
    # costs an API call per article, so it's opt-in at runtime via env var.
    SENTIMENT_BACKEND: str = os.getenv("SENTIMENT_BACKEND", "roberta").strip().lower()

    # Topic backend: "curated" (default — services/topics_gemini, classifies
    # against the curated 38-topic taxonomy in data/topics_taxonomy.json and
    # writes clean human-readable labels) or "legacy" (the original code path
    # which classifies against the BERTopic-derived taxonomy in
    # data/topics_data.json and writes underscore-joined keyword strings).
    # Both routes use Gemini under the hood; the difference is the label set.
    TOPIC_BACKEND: str = os.getenv("TOPIC_BACKEND", "curated").strip().lower()
    # Model to use for topic classification. Routed through gemini_adapter, so
    # a Vertex Express key (AQ.…) lands on Vertex automatically.
    TOPIC_MODEL: str = os.getenv("TOPIC_MODEL", "gemini-2.5-flash").strip()


class MediaScopeDatabase:

    def __init__(self, config: Config):
        self.config = config
        self.db = None

    def connect(self):
        try:
            self.db = get_firestore_db()
            print("[OK] Connected to Firebase Firestore")
        except Exception as e:
            print(f"[ERROR] Firestore connection error: {e}")
            raise

    def insert_newspaper(self, pub_date: datetime, page_num: int,
                        section: str, image_path: str) -> str:
        """Insert newspaper record with image to Firebase Storage + Firestore"""
        newspaper_id = str(uuid.uuid4())

        try:
            image_url = self.db.upload_newspaper_image(image_path, newspaper_id)

            if not image_url:
                print(f"[WARNING] Failed to upload image to Storage, continuing without image")

            newspaper_doc = {
                'id': newspaper_id,
                'publication_date': pub_date,
                'page_number': page_num,
                'section': section,
                'image_url': image_url,
                'image_filename': Path(image_path).name,
                'created_at': datetime.now(),
                'article_count': 0,
                'avg_sentiment': 0.0
            }

            self.db.db.collection('newspapers').document(newspaper_id).set(newspaper_doc)
            print(f"[OK] Stored newspaper in Firestore: {newspaper_id}")

        except Exception as e:
            print(f"[WARNING] Failed to save newspaper: {e}")

        return newspaper_id

    def insert_article(self, newspaper_id: str, article_data: Dict) -> str:
        article_id = str(uuid.uuid4())

        firestore_article = {
            'id': article_id,
            'newspaper_id': newspaper_id,
            'headline': article_data['headline'],
            'content': article_data['content'],
            'word_count': article_data['word_count'],
            'sentiment_score': article_data.get('sentiment_score', 0.0),
            'sentiment_label': article_data.get('sentiment_label', 'neutral'),
            'topic_label': article_data.get('topic_label', ''),
            'topic_id': article_data.get('topic_id'),
            # IMPORTANT: do NOT fabricate (1990-01-01, 1) defaults here. Pass
            # through whatever the caller gives — including None — so the
            # dashboards can render an honest "Unknown" bucket instead of
            # hiding extraction failures behind a fake date and page. See
            # scripts/backfill_metadata.py for the corresponding clean-up.
            'publication_date': article_data.get('publication_date'),
            'page_number': article_data.get('page_number'),
            'entities': []
        }

        self.db.store_article(firestore_article)
        print(f"[OK] Stored article in Firestore: {article_id}")

        return article_id

    def insert_entities(self, article_id: str, entities: List[Dict]):
        if not entities:
            return

        article_ref = self.db.db.collection('articles').document(article_id)
        article_doc = article_ref.get()

        if article_doc.exists:
            entity_list = [
                {'text': ent['text'], 'type': ent['type']}
                for ent in entities
            ]

            article_ref.update({'entities': entity_list})

    def insert_ad(self, newspaper_id: str, ad_data: Dict) -> Optional[str]:
        """Save a detected ad image to Storage and metadata to Firestore."""
        import tempfile
        import os

        ad_id = str(uuid.uuid4())
        ad_image = ad_data.get('image')
        if ad_image is None:
            return None

        try:
            # Save cropped image to a temp file for upload
            with tempfile.NamedTemporaryFile(suffix='.jpg', delete=False) as tmp:
                ad_image.save(tmp.name, 'JPEG', quality=85)
                tmp_path = tmp.name

            image_url = self.db.upload_ad_image(tmp_path, newspaper_id, ad_id)
            os.unlink(tmp_path)

            analysis = ad_data.get('deep_analysis', {})

            ad_text = ad_data.get('text', '')
            brand_info = analysis.get('brand', {})
            brand_name = brand_info.get('name', '') or ad_data.get('brand', '')
            category = brand_info.get('category', '') or ad_data.get('category', 'other')
            tc = analysis.get('textContent', {})
            identifier = tc.get('headline', '') or ad_text[:80] or f"Ad from page {ad_data.get('page_number', 1)}"

            ad_doc = {
                'id': ad_id,
                'newspaper_id': newspaper_id,
                'image_url': image_url,
                'identifier': identifier,
                'brand': brand_name,
                'category': category,
                'location': ad_data.get('bounding_box', {}),
                'description': tc.get('bodyText', '') or ad_text,
                'analysis': analysis,
                'coordinates': ad_data.get('bounding_box', {}),
                'publication_date': ad_data.get('publication_date'),
                'page_number': ad_data.get('page_number', 1),
                'source': 'pipeline',
                'created_at': datetime.now()
            }

            self.db.db.collection('advertisements').document(ad_id).set(ad_doc)
            brand_str = f" [{ad_doc['brand']}]" if ad_doc['brand'] else ""
            print(f"    [OK] Ad saved: {ad_doc['category']}{brand_str} → {ad_id[:8]}...")
            return ad_id

        except Exception as e:
            print(f"    [WARNING] Failed to save ad: {e}")
            return None

    def index_article_es(self, article_id: str, article_data: Dict,
                         entities: List[Dict], pub_date: datetime):
        """No-op: Firestore handles indexing automatically"""
        pass

    def close(self):
        if self.db:
            self.db.close()
        print("[OK] Firestore connection closed")


class ImageProcessor:

    def __init__(self, config: Config):
        self.config = config
        self._key_index = 0
        self._keys = list(config.GEMINI_API_KEYS)

        from google.generativeai.types import HarmCategory, HarmBlockThreshold

        self.safety_settings = {
            HarmCategory.HARM_CATEGORY_HARASSMENT: HarmBlockThreshold.BLOCK_NONE,
            HarmCategory.HARM_CATEGORY_HATE_SPEECH: HarmBlockThreshold.BLOCK_NONE,
            HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT: HarmBlockThreshold.BLOCK_NONE,
            HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT: HarmBlockThreshold.BLOCK_NONE,
        }

        key = self._keys[self._key_index] if self._keys else ''
        print(f"  [INFO] ImageProcessor using {_describe_key(key)}")
        self.model = _create_gemini_model(
            key,
            config.GEMINI_MODEL,
            safety_settings=self.safety_settings,
        )

    def _rotate_key(self):
        """Switch to the next API key and reinitialise the model."""
        self._key_index = (self._key_index + 1) % len(self._keys)
        new_key = self._keys[self._key_index]
        print(f"  [INFO] Rotating to API key {self._key_index + 1}/{len(self._keys)} ({_describe_key(new_key)})")
        self.model = _create_gemini_model(
            new_key,
            self.config.GEMINI_MODEL,
            safety_settings=self.safety_settings,
        )

    def _generate(self, prompt_parts):
        """Call generate_content, rotating keys on quota errors and
        retrying with exponential backoff if every key is 429.

        Behaviour change vs original: instead of giving up after one
        full pass through the key list, we keep retrying. After a full
        cycle of 429s we sleep `429_BACKOFF * 2^cycle` seconds (capped
        at GEMINI_429_MAX_BACKOFF), then start the rotation again. This
        prevents partial-extraction poisoning when the project's
        per-minute quota is briefly saturated — the call WILL eventually
        land instead of falling back to whole-page OCR or returning 0
        articles.
        """
        import time as _time
        backoff = float(os.getenv('GEMINI_429_BACKOFF', '8'))         # seconds
        max_backoff = float(os.getenv('GEMINI_429_MAX_BACKOFF', '60'))
        max_retries = int(os.getenv('GEMINI_429_MAX_RETRIES', '20'))   # cycles
        keys_tried = 0
        cycles = 0
        while True:
            try:
                return self.model.generate_content(
                    prompt_parts,
                    safety_settings=self.safety_settings
                )
            except Exception as e:
                msg = str(e).lower()
                is_quota = any(x in msg for x in ['quota', '429', 'rate', '403', 'permission', 'leaked'])
                if not is_quota:
                    raise
                keys_tried += 1
                if keys_tried < len(self._keys):
                    self._rotate_key()
                    continue
                # Full cycle exhausted — back off and retry instead of
                # raising. This is what stops partial-extraction
                # poisoning when quota is briefly saturated.
                cycles += 1
                if cycles > max_retries:
                    print(f"  [ERROR] All API keys exhausted after {cycles} cycles — giving up")
                    raise
                wait = min(backoff * (2 ** (cycles - 1)), max_backoff)
                print(f"  [WAIT] All keys 429d. Cycle {cycles}/{max_retries}, sleeping {wait:.0f}s before retry…")
                _time.sleep(wait)
                keys_tried = 0
                self._rotate_key()
    
    # Map of 3-letter month abbreviations to numeric month, used by the
    # ``Mon_DD_YY_pN`` filename pattern below. The Dawn 1990–1992 corpus is
    # named that way (e.g. ``Jun_10_90_p6.jpg``); previously this format was
    # unparseable and the pipeline silently fell back to (1990-01-01, page=1)
    # — see the data-quality bug investigation.
    _MONTH_ABBR = {
        'jan': 1, 'feb': 2, 'mar': 3, 'apr': 4, 'may': 5, 'jun': 6,
        'jul': 7, 'aug': 8, 'sep': 9, 'oct': 10, 'nov': 11, 'dec': 12,
    }

    def parse_filename_metadata(self, image_path: str) -> Dict[str, Optional[object]]:
        """Extract ``(date, page)`` from the source-image filename.

        Recognises:
          * ``Mon_DD_YY_pN.jpg`` (Dawn corpus convention) — returns both date
            and page.
          * Numeric date patterns (``YYYY-MM-DD``, ``DD_MM_YYYY``, ``YYYYMMDD``)
            — returns date only, page=None.

        Returns ``{'date': datetime|None, 'page': int|None}``. Either or both
        keys may be ``None``; callers must handle both cases. Crucially this
        function NEVER fabricates a default — that's what the legacy code
        did and is the source of the 1990-01-01 / page=1 bug.
        """
        filename = Path(image_path).stem

        # ``Jun_10_90_p6`` — month abbr + day + 2-digit year + page.
        m = re.match(r'^([A-Za-z]{3})_(\d{1,2})_(\d{2})_p(\d{1,2})$', filename)
        if m:
            mon_abbr, day, yy, page = m.groups()
            mn = self._MONTH_ABBR.get(mon_abbr.lower())
            if mn is not None:
                try:
                    year = 1900 + int(yy) if int(yy) >= 50 else 2000 + int(yy)
                    return {'date': datetime(year, mn, int(day)),
                            'page': int(page)}
                except ValueError:
                    pass  # fall through to numeric patterns

        # Numeric date patterns (legacy support — e.g. iPhone-renamed scans).
        patterns = [
            r'(\d{4})-(\d{2})-(\d{2})',
            r'(\d{4})_(\d{2})_(\d{2})',
            r'(\d{2})-(\d{2})-(\d{4})',
            r'(\d{2})_(\d{2})_(\d{4})',
            r'(\d{8})',
        ]
        for pattern in patterns:
            match = re.search(pattern, filename)
            if match:
                try:
                    if len(match.groups()) == 3:
                        g1, g2, g3 = match.groups()
                        if len(g1) == 4:
                            year, month, day = int(g1), int(g2), int(g3)
                        else:
                            day, month, year = int(g1), int(g2), int(g3)
                    else:
                        date_str = match.group(1)
                        year = int(date_str[:4])
                        month = int(date_str[4:6])
                        day = int(date_str[6:8])
                    return {'date': datetime(year, month, day), 'page': None}
                except (ValueError, IndexError):
                    continue

        return {'date': None, 'page': None}

    def extract_date_from_filename(self, image_path: str) -> Optional[datetime]:
        """Back-compat shim — returns just the date or None."""
        return self.parse_filename_metadata(image_path)['date']

    def extract_metadata(self, image_path: str,
                         prepared_image: Optional[Image.Image] = None) -> Dict:
        """Extract publication date + page number from a newspaper scan.

        Order of preference (most reliable first):

          1. **Filename** — if the file is named like ``Mon_DD_YY_pN.jpg`` we
             trust it absolutely. The Dawn corpus is named that way and the
             filename was set when the scan was filed, so it's authoritative.
          2. **OCR (Gemini Vision)** — read the masthead and page corner.
          3. **Filename (date only)** — for numeric-date filenames where
             page wasn't encoded.

        On total failure we now return ``date=None, page=None`` instead of
        the legacy ``(datetime(1990,1,1), 1)`` defaults that masked the
        failure as real data — see the data-quality bug investigation that
        traced 2,689 articles to a fake 1990-01-01 default. Callers (and
        ``insert_article``) must handle ``None`` and persist it as ``None``
        so the dashboards show an honest "Unknown" bucket.
        """
        fname = self.parse_filename_metadata(image_path)
        # If the filename gives us date AND page (Mon_DD_YY_pN format), trust
        # it without burning a Vision call.
        if fname['date'] is not None and fname['page'] is not None:
            print(f"  [OK] Filename metadata: "
                  f"{fname['date'].strftime('%Y-%m-%d')} | Page: {fname['page']}")
            return {'date': fname['date'], 'page': fname['page'], 'success': True}

        try:
            # Reuse the caller's pre-loaded + enhanced image when given;
            # otherwise open from disk and convert (we don't enhance on the
            # solo path because the legacy caller doesn't expect rotation).
            if prepared_image is not None:
                img = prepared_image
            else:
                img = Image.open(image_path)
                img = img.convert('RGB')  # strip MPO/HEIC/etc so Gemini accepts it

            prompt = """Extract from this newspaper scan:
1. Publication date (month, day, year)
2. Page number

Respond ONLY in this format:
MONTH: [month name]
DAY: [day number]
YEAR: [4-digit year like 1990]
PAGE: [page number]

If a field cannot be read confidently, write UNKNOWN for that field."""

            # Downscale before sending — saves ~80% of bytes on a 4032px
            # phone scan with no measured quality drop on masthead OCR.
            response = self._generate([prompt, self._prepare_for_gemini(img)])
            text = response.text if response.parts else ""

            month_match = re.search(r'MONTH:\s*([A-Za-z]+)', text, re.IGNORECASE)
            day_match = re.search(r'DAY:\s*(\d+)', text, re.IGNORECASE)
            year_match = re.search(r'YEAR:\s*(\d+)', text, re.IGNORECASE)
            page_match = re.search(r'PAGE:\s*(\d+)', text, re.IGNORECASE)

            # Date: prefer OCR if all three components parsed, else use filename
            # date if any, else None. We never invent year=1990 / day=1.
            pub_date: Optional[datetime] = None
            if month_match and day_match and year_match:
                try:
                    month_num = datetime.strptime(month_match.group(1)[:3].title(), '%b').month
                    pub_date = datetime(int(year_match.group(1)),
                                        month_num,
                                        int(day_match.group(1)))
                except ValueError:
                    pub_date = None
            if pub_date is None and fname['date'] is not None:
                pub_date = fname['date']
                print(f"  [OK] Using filename date: {pub_date.strftime('%Y-%m-%d')}")

            # Page: OCR first, then filename, then None.
            page: Optional[int] = None
            if page_match:
                try:
                    page = int(page_match.group(1))
                    if page <= 0 or page > 100:  # sanity-bound
                        page = None
                except ValueError:
                    page = None
            if page is None and fname['page'] is not None:
                page = fname['page']

            success = pub_date is not None or page is not None
            if success:
                print(f"  [OK] Metadata: "
                      f"date={pub_date.strftime('%Y-%m-%d') if pub_date else 'UNKNOWN'} | "
                      f"page={page if page is not None else 'UNKNOWN'}")
            else:
                print(f"  [WARNING] Metadata not extractable; storing date=None page=None")

            return {'date': pub_date, 'page': page, 'success': success}

        except Exception as e:
            print(f"  [WARNING] Metadata extraction failed: {e}")
            # On total failure we still return whatever the filename gave us
            # (could be both None — that's fine, callers handle it).
            return {'date': fname['date'], 'page': fname['page'],
                    'success': fname['date'] is not None or fname['page'] is not None}
    
    def enhance_image(self, image: Image.Image) -> Image.Image:
        try:
            image = ImageOps.exif_transpose(image)
        except Exception:
            pass

        if image.width > image.height:
            print("  [INFO] Rotating landscape image to portrait")
            image = image.rotate(90, expand=True)

        # iPhone EXIF orientation tags are unreliable on transferred /
        # app-saved photos: the flag often says "no rotation needed" even
        # when the page was photographed upside-down or 90° off. The
        # landscape→portrait check above only catches the gross 90° case;
        # papers shot upside-down in portrait still come through inverted,
        # which means every ad cropped from that page is also upside-down.
        # Use Tesseract OSD on a downsampled copy to detect rotation, then
        # rotate the original to match. OSD is fast (<1s on a 1024px copy)
        # and confidence-gated so we only act when we're sure.
        try:
            image = self._auto_orient_with_osd(image)
        except Exception as e:
            # Never let orientation detection fail an ingest — if Tesseract
            # isn't available or OSD couldn't read the page (sparse text,
            # photo of a cover image), keep the existing orientation.
            print(f"  [INFO] OSD orientation skipped: {e}")

        if image.mode != 'RGB':
            image = image.convert('RGB')

        enhancer = ImageEnhance.Contrast(image)
        image = enhancer.enhance(1.3)

        enhancer = ImageEnhance.Sharpness(image)
        image = enhancer.enhance(1.2)

        enhancer = ImageEnhance.Brightness(image)
        image = enhancer.enhance(1.1)

        return image

    # Confidence threshold for trusting Tesseract's orientation guess.
    # Below this we leave the page alone — OSD can return spurious 90/180
    # results on sparse pages (photos, ads, mostly-white sections) and a
    # wrong rotation is worse than no rotation since downstream OCR will
    # then read text upside-down.
    _OSD_MIN_CONFIDENCE = 2.0

    def _auto_orient_with_osd(self, image: Image.Image) -> Image.Image:
        """Use Tesseract OSD to detect 0/90/180/270° rotation and correct it.

        Runs on a downsampled copy for speed. Only rotates when Tesseract
        reports both a non-zero rotation AND a confidence above
        ``_OSD_MIN_CONFIDENCE``. Falls back to the input image on any
        failure (Tesseract missing, OSD couldn't classify, etc.).
        """
        import pytesseract  # local import keeps optional dep lazy

        # Downsample for OSD speed — accuracy is fine at 1024px long edge.
        long_edge = max(image.width, image.height)
        if long_edge > 1024:
            scale = 1024 / long_edge
            small = image.resize(
                (max(1, int(image.width * scale)), max(1, int(image.height * scale))),
                Image.LANCZOS,
            )
        else:
            small = image

        try:
            osd = pytesseract.image_to_osd(small, output_type=pytesseract.Output.DICT)
        except pytesseract.TesseractError:
            # Sparse pages → "Too few characters." OSD raises rather than
            # returning low confidence; treat as "leave it alone".
            return image
        except Exception:
            return image

        rotate = int(osd.get('rotate', 0)) or 0
        confidence = float(osd.get('orientation_conf', 0.0) or 0.0)

        if rotate == 0:
            return image
        if confidence < self._OSD_MIN_CONFIDENCE:
            print(
                f"  [INFO] OSD says rotate {rotate}° but confidence {confidence:.2f} "
                f"is below threshold {self._OSD_MIN_CONFIDENCE} — leaving as-is"
            )
            return image

        # Tesseract's `rotate` is the angle to rotate the image
        # COUNTER-clockwise to make it upright. PIL's `image.rotate(angle)`
        # also rotates counter-clockwise, so the values match directly.
        print(f"  [INFO] OSD: rotating page {rotate}° (confidence {confidence:.1f})")
        return image.rotate(rotate, expand=True)

    # Cap the long edge of any image we ship to Gemini. Phone scans are
    # 4032×3024 (≈6-12 MB JPEG) which the Vertex Express endpoint accepts
    # but punishes us for: payload bandwidth, encode time, and per-call
    # latency all scale with bytes. metadata_vision proved 1600px is plenty
    # for masthead OCR, and Gemini's vision tower internally downscales to
    # roughly the same target anyway — so we lose nothing visible. Crops
    # for `detect_ads` are still produced from the ORIGINAL image; only the
    # copy SENT to the model is shrunk. Returns the same image when it's
    # already under the cap.
    _GEMINI_LONG_EDGE = 1600

    def _prepare_for_gemini(self, image: Image.Image) -> Image.Image:
        try:
            w, h = image.size
            long_edge = max(w, h)
            if long_edge <= self._GEMINI_LONG_EDGE:
                return image
            scale = self._GEMINI_LONG_EDGE / long_edge
            new_size = (max(1, int(w * scale)), max(1, int(h * scale)))
            return image.resize(new_size, Image.LANCZOS)
        except Exception:
            # Never let downscale failure block a Gemini call — fall back
            # to the original image.
            return image
    
    # ─── Per-region article OCR (replaces whole-page OCR) ─────────────
    #
    # The whole-page OCR path (kept below as `extract_articles_whole_page`
    # for fallback) was independently audited at ~53% severe-or-worse
    # error rate: fabricated names/numbers in short briefs, missed
    # right-column content, conflated multi-item entries. Root cause was
    # asking Gemini to do region segmentation + reading order + verbatim
    # OCR + boundary inference all at once on a 4000×3000-pixel image.
    # When attention budget runs out, the model fills the structured
    # response template with plausible-sounding fabrication.
    #
    # The per-region path splits the work in two:
    #   1. detect_article_regions: cheap bbox detection (Gemini sees the
    #      whole page but only outputs coordinates + type, no transcription).
    #   2. _ocr_region: per-crop verbatim transcription. Each call sees
    #      ONE article. No template to fill, no spatial bias, no
    #      conflation — the model can only describe what's literally in
    #      front of it.
    #
    # Mirrors the working pattern of detect_ads + analyze_ad_image.

    # When converting Gemini's bbox coordinates to crops, pad each side
    # by this fraction of the box's own dimension. Smoke testing showed
    # the model's bboxes shave 1-3 characters off the edges of articles —
    # which the per-region OCR honestly reports as "[...]" but is purely
    # an artifact of imprecise bbox detection. 8% padding fully captures
    # the article body; the dedupe step below handles the overlap that
    # padding introduces between adjacent articles.
    _REGION_PAD_FRACTION = 0.08
    # Two regions are considered the same article when their IoU
    # (intersection over union) exceeds this. Picked conservatively —
    # genuine adjacent articles share at most ~20% of their union when
    # padded; same-article duplicates routinely hit 60-90%.
    _REGION_DEDUPE_IOU = 0.45

    @staticmethod
    def _bbox_iou(a, b):
        ax1, ay1, ax2, ay2 = a
        bx1, by1, bx2, by2 = b
        ix1, iy1 = max(ax1, bx1), max(ay1, by1)
        ix2, iy2 = min(ax2, bx2), min(ay2, by2)
        if ix2 <= ix1 or iy2 <= iy1:
            return 0.0
        inter = (ix2 - ix1) * (iy2 - iy1)
        a_area = (ax2 - ax1) * (ay2 - ay1)
        b_area = (bx2 - bx1) * (by2 - by1)
        union = a_area + b_area - inter
        return inter / union if union > 0 else 0.0

    def detect_article_regions(self, image: Image.Image) -> List[Dict]:
        """Identify article-like regions on a newspaper page.

        Returns a list of region dicts with bounding boxes (as
        absolute pixel coords, padded for OCR safety) and a type tag.
        Boxes are deduplicated by IoU so a single article isn't OCR'd
        twice when the model returns overlapping detections.
        """
        try:
            width, height = image.size
            prompt = """You are a layout analyzer for a Dawn newspaper page (Pakistan, 1990-1992).

Identify the bounding box of EVERY distinct content region on the page. Include:
  - Articles, editorials, opinion pieces (label "article")
  - Photo captions standing alone under or beside images (label "caption")
  - TV / radio listings, schedules, results tables (label "listing")
  - Obituaries, condolences, death notices (label "obituary")

Skip mastheads (the newspaper title block at the top), advertisements, weather boxes,
stock-price tables, classifieds, cartoons, and page-number bands.

CRITICAL — bounding box accuracy:
  - Each box must FULLY contain the article including its headline AND every line of body text.
  - It is much better to include 5-10 pixels of whitespace beyond the article on every side
    than to clip a single character at the edges.
  - Do NOT split a single article into multiple regions just because it has subheadings or
    runs across columns — one article = one box, even if it spans multiple visual columns.
  - Do NOT overlap regions: each piece of body text should belong to exactly one region.

Coordinate system: x1, y1 are the top-left of the region as fractions of page WIDTH/HEIGHT
(0.0 to 1.0). x2, y2 are bottom-right.

Respond with ONLY a JSON object, no markdown:
{
  "regions": [
    {
      "x1": 0.05, "y1": 0.10, "x2": 0.32, "y2": 0.28,
      "type": "article",
      "headline_hint": "the headline you see (or null if none visible)"
    }
  ]
}

If you can't see any content regions at all, return {"regions": []}.
Be exhaustive — small briefs, single-paragraph items, and right-column items count too."""

            response = self._generate([prompt, self._prepare_for_gemini(image)])
            text = response.text if response.parts else ""

            json_match = re.search(r'\{[\s\S]*\}', text)
            if not json_match:
                return []
            data = json.loads(json_match.group())
            raw_regions = data.get('regions', []) or []

            # Convert fractional coords to pixels + filter degenerate boxes.
            out = []
            for r in raw_regions:
                try:
                    x1 = float(r['x1']) * width
                    y1 = float(r['y1']) * height
                    x2 = float(r['x2']) * width
                    y2 = float(r['y2']) * height
                    bw, bh = x2 - x1, y2 - y1
                    if bw < 60 or bh < 60:
                        continue
                    if (bw * bh) / (width * height) > 0.85:
                        # Almost-whole-page region = model gave up on
                        # segmentation. Drop it.
                        continue
                    # Pad each side to compensate for imprecise bboxes
                    # (smoke testing showed 1-3 characters shaved off edges).
                    pad_w = bw * self._REGION_PAD_FRACTION
                    pad_h = bh * self._REGION_PAD_FRACTION
                    px1 = max(0, int(x1 - pad_w))
                    py1 = max(0, int(y1 - pad_h))
                    px2 = min(width, int(x2 + pad_w))
                    py2 = min(height, int(y2 + pad_h))
                    rtype = (r.get('type') or 'article').strip().lower()
                    out.append({
                        'bbox': (px1, py1, px2, py2),
                        'type': rtype if rtype in ('article', 'caption', 'listing', 'obituary') else 'article',
                        'headline_hint': (r.get('headline_hint') or '').strip() or None,
                        '_area': (px2 - px1) * (py2 - py1),
                    })
                except (KeyError, ValueError, TypeError):
                    continue

            # Dedupe overlapping regions: when two boxes have IoU above
            # _REGION_DEDUPE_IOU, keep the larger one. Padded boxes for
            # adjacent articles overlap slightly but never above 0.45;
            # duplicate detections of the same article routinely hit
            # 0.6-0.9. Sort by area desc so we always keep the "main"
            # box and discard sub-regions.
            out.sort(key=lambda r: -r['_area'])
            kept = []
            for r in out:
                if any(self._bbox_iou(r['bbox'], k['bbox']) > self._REGION_DEDUPE_IOU for k in kept):
                    continue
                kept.append(r)

            for r in kept:
                r.pop('_area', None)

            if len(kept) < len(out):
                print(f"    [INFO] Region dedupe: {len(out)} → {len(kept)} (IoU > {self._REGION_DEDUPE_IOU})")
            return kept

        except Exception as e:
            print(f"  [WARNING] Article region detection failed: {e}")
            return []

    def _ocr_region(self, region_image: Image.Image, region_type: str = 'article') -> Optional[Dict]:
        """OCR a single cropped region — one article, one caption, etc.

        Tight prompt: transcribe ONLY visible text. No invention, no
        completion of cut-off sentences from "context". Returns
        ``{headline, body, word_count}`` or None if the crop is genuinely
        unreadable.
        """
        try:
            if region_type == 'caption':
                prompt = """Transcribe the photo caption visible in this image, verbatim.
A caption is one or two sentences describing a photograph.

Rules:
- Transcribe ONLY what is literally printed in this image.
- Do NOT infer missing text. Do NOT complete cut-off sentences.
- If you cannot read any text, return {"text": ""}

Respond ONLY with JSON:
{"text": "<the caption text, verbatim>"}"""
            else:
                prompt = """Transcribe the news article visible in this image. This is from "Dawn",
a Pakistani English-language daily newspaper from 1990-1992.

Rules:
- Transcribe ONLY what is literally printed in this image.
- Do NOT infer missing words. Do NOT invent names, places, numbers, or dates.
- Do NOT summarise. Do NOT paraphrase. Verbatim only.
- If part of the text is cut off at the image edges, transcribe what you can see and
  end with "[…]". Do not guess what came next.
- The "headline" is the boldface or large-type title at the top of the article.
  If there's no clearly distinct headline, set headline to null and put everything
  in body.
- Preserve paragraph breaks with \\n\\n.
- If you cannot read any text in this image, return {"headline": null, "body": ""}.

Respond ONLY with JSON:
{
  "headline": "<headline text, or null>",
  "body": "<full body text, verbatim, paragraph-broken with \\n\\n>"
}"""

            response = self._generate([prompt, self._prepare_for_gemini(region_image)])
            raw = response.text.strip() if response.parts else ""
            if '```json' in raw:
                raw = raw.split('```json')[1].split('```')[0].strip()
            elif '```' in raw:
                raw = raw.split('```')[1].split('```')[0].strip()

            data = json.loads(raw)

            if region_type == 'caption':
                text = (data.get('text') or '').strip()
                if not text:
                    return None
                return {'headline': None, 'body': text, 'word_count': len(text.split())}

            headline = data.get('headline')
            if headline:
                headline = str(headline).strip() or None
            body = (data.get('body') or '').strip()

            # Reject empty/microscopic results. A real article has at
            # least a sentence; anything less is most likely a failed
            # OCR or a pure-image region we shouldn't have asked about.
            if not body and not headline:
                return None
            if body and len(body.split()) < 5 and not headline:
                return None

            return {
                'headline': headline,
                'body': body,
                'word_count': len(body.split()),
            }

        except json.JSONDecodeError as e:
            print(f"    [WARNING] Region OCR JSON parse failed: {e}")
            return None
        except Exception as e:
            print(f"    [WARNING] Region OCR failed: {e}")
            return None

    def extract_articles(self, image_path: str,
                         prepared_image: Optional[Image.Image] = None) -> List[Dict]:
        """Per-region article OCR.

        Two-stage pipeline:
          1. Detect article regions on the page (one Gemini call, bbox-only).
          2. For each region, crop and OCR independently in parallel
             (N Gemini calls, each on a small image with a strict
             "verbatim only" prompt).

        Returns the same shape as the legacy whole-page path
        (``[{number, headline, text, word_count}]``) so downstream code
        is unchanged. Falls back to whole-page OCR if region detection
        returns nothing (the model genuinely couldn't segment).
        """
        try:
            if prepared_image is not None:
                img = prepared_image
            else:
                img = Image.open(image_path)
                img = self.enhance_image(img)

            print(f"  [INFO] Detecting article regions...")
            regions = self.detect_article_regions(img)
            if not regions:
                print(f"  [WARNING] No regions detected — falling back to whole-page OCR")
                return self._extract_articles_whole_page(image_path, img)

            print(f"  [OK] Detected {len(regions)} regions "
                  f"({sum(1 for r in regions if r['type']=='article')} articles, "
                  f"{sum(1 for r in regions if r['type']=='caption')} captions, "
                  f"{sum(1 for r in regions if r['type']=='listing')} listings, "
                  f"{sum(1 for r in regions if r['type']=='obituary')} obituaries)")

            # Crop each region from the FULL-RES image (not the downscaled
            # gem_img — we want the model to see the same pixel density it
            # would see if we'd OCR'd the page directly). Then OCR them in
            # parallel; cap concurrency at 4 so a 25-region page doesn't
            # slam Gemini all at once and trigger 429s.
            from concurrent.futures import ThreadPoolExecutor, as_completed
            crops = []
            for r in regions:
                x1, y1, x2, y2 = r['bbox']
                try:
                    crop = img.crop((x1, y1, x2, y2))
                    crops.append((r, crop))
                except Exception as e:
                    print(f"    [WARNING] Crop failed for region {r['bbox']}: {e}")

            articles = []
            n_workers = min(4, max(1, len(crops)))
            with ThreadPoolExecutor(max_workers=n_workers, thread_name_prefix='region') as ex:
                future_to_region = {
                    ex.submit(self._ocr_region, crop, r['type']): (r, idx)
                    for idx, (r, crop) in enumerate(crops)
                }
                results = [None] * len(crops)
                for fut in as_completed(future_to_region):
                    r, idx = future_to_region[fut]
                    try:
                        ocr = fut.result()
                    except Exception as e:
                        print(f"    [WARNING] Region {idx} OCR exception: {e}")
                        ocr = None
                    results[idx] = (r, ocr)

            for idx, item in enumerate(results):
                if not item or not item[1]:
                    continue
                r, ocr = item
                # Use the OCR'd headline; fall back to the bbox-detector's
                # hint if the region OCR didn't return one.
                headline = ocr.get('headline') or r.get('headline_hint')
                body = ocr.get('body', '')
                if not body and not headline:
                    continue
                articles.append({
                    'number': len(articles) + 1,
                    'headline': (headline or '').strip(),
                    'text': body,
                    'word_count': ocr.get('word_count', len(body.split())),
                    'region_type': r['type'],  # so downstream can distinguish caption from article
                })

            print(f"  [OK] Per-region OCR returned {len(articles)} successful items "
                  f"out of {len(regions)} detected regions")

            if not articles:
                print(f"  [WARNING] All regions failed OCR — falling back to whole-page")
                return self._extract_articles_whole_page(image_path, img)

            return articles

        except Exception as e:
            import traceback
            print(f"  [ERROR] Per-region article extraction failed: {e}")
            traceback.print_exc()
            print(f"  [INFO] Falling back to whole-page OCR")
            try:
                return self._extract_articles_whole_page(image_path, img if 'img' in locals() else None)
            except Exception:
                return []

    def _extract_articles_whole_page(self, image_path: str,
                                      prepared_image: Optional[Image.Image] = None) -> List[Dict]:
        """Legacy whole-page article OCR.

        Kept for fallback when per-region detection fails (model returns
        zero regions, or every region OCR fails). Audited at ~53%
        severe-or-worse error rate on dense pages — should rarely be
        the production path.
        """
        try:
            if prepared_image is not None:
                img = prepared_image
            else:
                img = Image.open(image_path)
                img = self.enhance_image(img)

            # Cache the downscaled copy so attempt-1 and attempt-2 share it.
            gem_img = self._prepare_for_gemini(img)

            print(f"  [INFO] Attempting whole-page OCR extraction (attempt 1/2)...")
            prompt = """You are an OCR + layout analyzer for a Dawn newspaper page (Pakistan, 1990-1992).

Identify every distinct news article / editorial / opinion piece on this page and transcribe each one as a SEPARATE block in EXACTLY this format (no markdown, no preamble, no commentary):

ARTICLE_START
NUMBER: 1
HEADLINE: <the article's headline, one line>
CONTENT: <the full body text of this article, preserving paragraph breaks>
ARTICLE_END

ARTICLE_START
NUMBER: 2
HEADLINE: <next headline>
CONTENT: <next body>
ARTICLE_END

Rules:
- Skip ads, classifieds, photo captions, weather boxes, stock tables, cartoons, crosswords, and mastheads.
- Skip anything that is clearly a photo caption rather than a standalone article.
- If a piece has no headline (rare), use the first line of the body as the headline (do NOT invent one).
- Transcribe text verbatim — do not summarise the body. Do NOT invent names, places, or numbers.
- Output nothing outside the ARTICLE_START/ARTICLE_END blocks. No explanations, no "Here is..." preamble.

Begin now."""
            response = self._generate([prompt, gem_img])

            text = ""
            if hasattr(response, 'parts') and response.parts:
                try:
                    text = response.text
                    print(f"  [OK] Got response ({len(text)} chars)")
                except Exception as e:
                    print(f"  [WARNING] Could not get text from response: {e}")
            else:
                # Diagnostic: why no parts?
                try:
                    fr = getattr(getattr(response, '_raw', response), 'prompt_feedback', None)
                    if fr:
                        print(f"  [DEBUG] prompt_feedback: {fr}")
                except Exception:
                    pass

            if not text or len(text) < 50:
                print(f"  [WARNING] Response too short or empty, retrying with structured prompt...")
                print(f"  [INFO] Attempting OCR extraction (attempt 2/2)...")
                retry_prompt = """Transcribe every article on this newspaper page. For each one, output:

ARTICLE_START
NUMBER: <n>
HEADLINE: <short headline>
CONTENT: <full body text, preserving paragraphs>
ARTICLE_END

Skip ads, captions, weather, and classifieds. Output nothing else — no commentary, no preamble."""
                response = self._generate([retry_prompt, gem_img])
                if hasattr(response, 'parts') and response.parts:
                    try:
                        text = response.text
                        print(f"  [OK] Got response ({len(text)} chars)")
                    except:
                        pass

            if not text:
                print(f"  [ERROR] No text extracted after 3 attempts")
                return []

            # Try to parse structured format first
            articles = []
            article_blocks = re.findall(
                r'ARTICLE_START(.*?)ARTICLE_END',
                text,
                re.DOTALL
            )

            if article_blocks:
                print(f"  [OK] Found {len(article_blocks)} structured articles")
                for block in article_blocks:
                    num_match = re.search(r'NUMBER:\s*(\d+)', block)
                    headline_match = re.search(r'HEADLINE:\s*(.+?)(?=\n)', block)
                    content_match = re.search(r'CONTENT:\s*(.+)', block, re.DOTALL)

                    if headline_match and content_match:
                        headline = headline_match.group(1).strip()
                        content = content_match.group(1).strip()

                        articles.append({
                            'number': int(num_match.group(1)) if num_match else len(articles) + 1,
                            'headline': headline,
                            'text': content,
                            'word_count': len(content.split())
                        })
            else:
                # Fallback: Try to extract any text as a single article
                print(f"  [INFO] No structured format found, parsing as single article")
                lines = text.split('\n')

                # Drop leading preamble lines that Gemini likes to emit.
                _preamble_prefixes = (
                    'here is', 'here are', 'here\'s', 'of course', 'sure,',
                    'below is', 'i have transcribed', 'i cannot', 'this is',
                    'based on the image', 'this document',
                )

                def _is_preamble(s: str) -> bool:
                    low = s.strip().lower().rstrip(':').rstrip('.')
                    return any(low.startswith(p) for p in _preamble_prefixes)

                # Try to find something that looks like a headline
                headline = "Extracted Text"
                content_start = 0

                for i, line in enumerate(lines[:15]):
                    line_s = line.strip()
                    if not line_s or _is_preamble(line_s):
                        continue
                    # Headline heuristic: short line with 2+ words, not ending in period.
                    if len(line_s) < 120 and len(line_s.split()) >= 2 and not line_s.endswith('.'):
                        headline = line_s
                        content_start = i + 1
                        break

                # Skip preamble lines inside body text too.
                body_lines = [l for l in lines[content_start:] if not _is_preamble(l)]
                content = '\n'.join(body_lines).strip()

                if content and len(content) > 50:
                    articles.append({
                        'number': 1,
                        'headline': headline,
                        'text': content,
                        'word_count': len(content.split())
                    })
                    print(f"  [OK] Created 1 article from unstructured text")

            return articles

        except Exception as e:
            import traceback
            print(f"  [ERROR] Article extraction failed: {e}")
            traceback.print_exc()
            return []


    def analyze_ad_image(self, ad_image: Image.Image) -> Dict:
        """Run deep structured analysis on a cropped ad image using Gemini."""
        try:
            analysis_prompt = """Analyze this historical newspaper advertisement (from the early 1990s Pakistan). Return ONLY valid JSON, no markdown.

{
  "brand": {
    "name": "Brand or company name",
    "product": "Product or service being advertised",
    "category": "One of: automotive, food_beverage, electronics, fashion_apparel, banking_finance, healthcare_pharma, real_estate, education, telecom, government_psa, retail, hospitality, media_entertainment, other"
  },
  "textContent": {
    "headline": "Main headline text",
    "bodyText": "Key body copy (summarised if long)",
    "slogan": "Tagline or slogan if present",
    "contactInfo": "Phone, address, or other contact details"
  },
  "visualAnalysis": {
    "dominantColors": ["color1", "color2"],
    "imagery": "Description of key visual elements (photos, illustrations, logos)",
    "designStyle": "e.g. minimalist, ornate, photographic, illustrated, typographic",
    "layout": "e.g. headline dominant, image dominant, grid, border-heavy"
  },
  "advertisingStrategy": {
    "mainMessage": "Core value proposition in one sentence",
    "emotionalAppeal": "e.g. prestige, aspiration, family, safety, value, patriotism",
    "callToAction": "What action is requested, or null"
  },
  "assessment": {
    "sentiment": "positive | neutral | negative",
    "targetAudience": "Brief description of intended audience",
    "effectiveness": "Brief assessment of the ad's likely impact",
    "historicalNotes": "Any notable 1990-1992 era context or cultural references"
  }
}

Return ONLY the JSON object, nothing else."""

            response = self._generate([analysis_prompt, self._prepare_for_gemini(ad_image)])
            raw = response.text.strip() if response.parts else ""
            if '```json' in raw:
                raw = raw.split('```json')[1].split('```')[0].strip()
            elif '```' in raw:
                raw = raw.split('```')[1].split('```')[0].strip()
            return json.loads(raw)
        except Exception as e:
            print(f"    [WARNING] Ad analysis failed: {e}")
            return {}

    def detect_ads(self, image: Image.Image) -> List[Dict]:
        """Detect advertisement regions in a newspaper page image using Gemini."""
        try:
            width, height = image.size

            prompt = """Analyze this newspaper page and identify ONLY commercial display advertisements.

DO NOT include any of the following — they are NOT advertisements:
- Tender notices / government procurement / bid invitations
- Job listings / recruitment / vacancy announcements
- Real estate listings (property for sale or rent)
- Classified columns (lost & found, matrimonial, personals)
- Public notices / legal notices / court announcements
- Government announcements / PSA notices
- News articles or editorial content

ONLY include genuine brand/product/service commercial advertisements — display ads that promote a brand, product, or commercial service with visual design elements such as logos, product images, styled typography, or promotional language.

For each commercial advertisement found, provide bounding box coordinates as percentages (0.0 to 1.0) of the image width/height.

Respond ONLY in valid JSON:
{
  "ads": [
    {
      "x1": 0.0, "y1": 0.0, "x2": 1.0, "y2": 1.0,
      "text": "main text visible in the ad",
      "brand": "brand or company name, or empty string",
      "category": "one of: product, service, entertainment, other"
    }
  ]
}

- If no commercial advertisements are found, return {"ads": []}
- Keep coordinates within 0.0-1.0 range"""

            # Send the downscaled copy to Gemini, but keep `image` (full
            # resolution) for the actual crop on line below — Gemini
            # returns 0.0-1.0 percentages so the coord system is
            # invariant to which size we ship.
            response = self._generate([prompt, self._prepare_for_gemini(image)])
            text = response.text if response.parts else ""

            json_match = re.search(r'\{[\s\S]*\}', text)
            if not json_match:
                return []

            data = json.loads(json_match.group())
            raw_ads = data.get('ads', [])

            cropped_ads = []
            pad_w = int(width * 0.02)
            pad_h = int(height * 0.02)
            for ad in raw_ads:
                try:
                    x1 = int(float(ad['x1']) * width) - pad_w
                    y1 = int(float(ad['y1']) * height) - pad_h
                    x2 = int(float(ad['x2']) * width) + pad_w
                    y2 = int(float(ad['y2']) * height) + pad_h

                    x1 = max(0, min(x1, width - 1))
                    y1 = max(0, min(y1, height - 1))
                    x2 = max(x1 + 1, min(x2, width))
                    y2 = max(y1 + 1, min(y2, height))

                    crop_w = x2 - x1
                    crop_h = y2 - y1

                    # Skip tiny crops (< 60px in either dimension)
                    if crop_w < 60 or crop_h < 60:
                        print(f"  [SKIP] Ad crop too small: {crop_w}x{crop_h}px")
                        continue

                    # Skip regions that are too large (likely the whole page, not an ad)
                    region_fraction = (crop_w * crop_h) / (width * height)
                    if region_fraction > 0.7:
                        print(f"  [SKIP] Ad crop too large: {region_fraction:.1%} of page")
                        continue

                    # Skip degenerate aspect ratios (extreme slivers → thin black lines)
                    aspect = min(crop_w, crop_h) / max(crop_w, crop_h)
                    if aspect < 0.15:
                        print(f"  [SKIP] Ad crop degenerate aspect ratio: {aspect:.2f}")
                        continue

                    cropped = image.crop((x1, y1, x2, y2))
                    cropped_ads.append({
                        'image': cropped,
                        'bounding_box': {'x1': x1, 'y1': y1, 'x2': x2, 'y2': y2},
                        'text': ad.get('text', '').strip(),
                        'brand': ad.get('brand', '').strip(),
                        'category': ad.get('category', 'other')
                    })
                except (KeyError, ValueError) as e:
                    print(f"  [WARNING] Bad ad region data: {e}")
                    continue

            print(f"  [OK] Detected {len(cropped_ads)} ads")
            return cropped_ads

        except Exception as e:
            print(f"  [WARNING] Ad detection failed: {e}")
            return []


class NLPProcessor:

    def __init__(self, config: Config):
        self.config = config

        import os
        os.environ['PYTORCH_ENABLE_MPS_FALLBACK'] = '1'
        os.environ['CUDA_VISIBLE_DEVICES'] = ''

        import torch
        torch.set_num_threads(4)

        print("Loading spaCy model...")
        self.nlp = spacy.load(config.SPACY_MODEL)

        print("Loading sentiment analysis model...")
        self.sentiment_analyzer = pipeline(
            "sentiment-analysis",
            model=config.SENTIMENT_MODEL,
            device=-1,
            top_k=None
        )

        # Load topic taxonomy for Gemini-based classification
        self.topics_taxonomy = self._load_topics_taxonomy()
        self.topic_assignments = []
        self.article_metadata = []

        # Set up Gemini for topic classification (reuses pipeline API keys)
        self._topic_key_index = 0
        self._topic_keys = list(config.GEMINI_API_KEYS)

        print("[OK] NLP models loaded (topics via Gemini API)")

    def _load_topics_taxonomy(self) -> List[Dict]:
        """Load the predefined topic taxonomy from topics_data.json"""
        topics_file = Path(__file__).parent.parent / "data" / "topics_data.json"
        if topics_file.exists():
            with open(topics_file, 'r') as f:
                data = json.load(f)
            topics = [t for t in data.get('topics', []) if t['topic_id'] != -1]
            print(f"[OK] Loaded {len(topics)} topic categories for Gemini classification")
            return topics
        print("[WARNING] topics_data.json not found, topic classification will be limited")
        return []

    def _build_topic_prompt(self) -> str:
        """Build the topic list portion of the Gemini classification prompt."""
        lines = []
        for t in self.topics_taxonomy:
            keywords = ', '.join(t.get('keywords', [])[:5])
            lines.append(f"  {t['topic_id']}: {t['name']} (keywords: {keywords})")
        return '\n'.join(lines)

    def extract_entities(self, text: str) -> List[Dict]:
        doc = self.nlp(text)
        entities = []

        for ent in doc.ents:
            entities.append({
                'text': ent.text,
                'type': ent.label_,
                'start': ent.start_char,
                'end': ent.end_char,
                'confidence': 1.0
            })

        return entities

    def analyze_sentiment(self, text: str) -> Dict:
        """
        Sentiment scorer with two backends:
          - "roberta" (default): HuggingFace Twitter RoBERTa, 1000-char window.
            Fast (local), but heavily biased toward 'neutral' on formal
            newspaper prose — see scripts/audit_sentiment.py for evidence.
          - "gemini": services.sentiment_gemini, full-article LLM scoring.
            Slower and costs an API call per article, but reads paragraph
            4-N where the editorial stance actually lives.

        Selected via Config.SENTIMENT_BACKEND (env var SENTIMENT_BACKEND).
        Always falls back to RoBERTa on Gemini failure so ingestion never
        stalls. The returned dict gains a `method` field so consumers /
        analytics can tell which scorer ran.
        """
        backend = getattr(self.config, 'SENTIMENT_BACKEND', 'roberta')
        if backend == 'gemini':
            try:
                from services.sentiment_gemini import analyze_sentiment_gemini
                result = analyze_sentiment_gemini(text)
                # Treat unparseable / no-key returns (confidence=0) as a miss
                # and fall back to RoBERTa so we always get *some* signal.
                if result.get('confidence', 0) > 0:
                    result['method'] = 'gemini'
                    return result
                print(f"[SENTIMENT] Gemini returned no signal ({result.get('reasoning', '')[:80]}); "
                      f"falling back to RoBERTa")
            except Exception as exc:
                print(f"[SENTIMENT] Gemini failed: {exc}; falling back to RoBERTa")

        # Legacy RoBERTa path (also the fallback).
        snippet = text[:1000]
        results = self.sentiment_analyzer(snippet)[0]
        label_map = {'negative': -1, 'neutral': 0, 'positive': 1}
        top_result = max(results, key=lambda x: x['score'])
        label = top_result['label'].lower()
        score = 0.0
        for r in results:
            lbl = r['label'].lower()
            score += label_map.get(lbl, 0) * r['score']
        return {
            'score': round(score, 3),
            'label': label,
            'confidence': round(top_result['score'], 3),
            'method': 'roberta',
        }

    def assign_topic(self, text: str) -> Dict:
        """Classify article text into a topic.

        Two backends, picked by Config.TOPIC_BACKEND (env TOPIC_BACKEND):

          - "curated" (default): services.topics_gemini classifies against the
            curated 38-topic taxonomy in data/topics_taxonomy.json. Returns
            stable, human-readable labels ("Crime & Violence", "Cricket"…)
            so the frontend doesn't need its TOPIC_NAME_MAP humanization
            shim. Routed through services.gemini_adapter so a Vertex Express
            key (AQ.*) lands on Vertex automatically.

          - "legacy": original code path that classifies against the
            BERTopic-derived taxonomy in data/topics_data.json and writes
            underscore-joined keyword strings ("kgs_grams_oil_40 kgs"…).
            Kept around so old labels stay queryable until backfill runs.

        Both paths return a dict with topic_id, topic_label, confidence, and
        a `method` field so consumers can tell which classifier ran.
        """
        backend = getattr(self.config, 'TOPIC_BACKEND', 'curated')

        if backend == 'curated':
            return self._assign_topic_curated(text)

        # Legacy path (BERTopic-derived taxonomy + underscore label format).
        return self._assign_topic_legacy(text)

    def _assign_topic_curated(self, text: str) -> Dict:
        """Classify against the curated taxonomy with key rotation."""
        from services.topics_gemini import classify_topic_gemini, _OTHER_ID, _OTHER_LABEL, _OTHER_KEY

        model_name = getattr(self.config, 'TOPIC_MODEL', 'gemini-2.5-flash')
        # Try each rotation key once on quota/rate errors. classify_topic_gemini
        # itself swallows errors and returns confidence=0; we re-call against
        # the next key when that happens AND the reasoning hints at quota.
        keys = self._topic_keys or [getattr(self.config, 'GEMINI_API_KEY', '') or '']
        attempts = max(1, len(keys))
        for attempt in range(attempts):
            cur_key = keys[self._topic_key_index] if keys else ''
            result = classify_topic_gemini(text, model_name=model_name, api_key=cur_key)
            reasoning = result.get('reasoning', '').lower()
            quota_hit = (
                result.get('confidence', 0.0) == 0.0
                and any(x in reasoning for x in ('quota', 'rate', '429', '403', 'permission'))
            )
            if not quota_hit:
                result['method'] = 'gemini-curated'
                return result
            # rotate and retry
            if keys:
                self._topic_key_index = (self._topic_key_index + 1) % len(keys)
                if attempt < attempts - 1:
                    print(f"  [INFO] Topic classifier rotating to key {self._topic_key_index + 1}")

        # All keys exhausted — return Other with method tag.
        print("  [ERROR] All API keys exhausted for topic classification")
        return {
            'topic_id': _OTHER_ID, 'topic_key': _OTHER_KEY, 'topic_label': _OTHER_LABEL,
            'confidence': 0.0, 'reasoning': 'all keys exhausted', 'method': 'gemini-curated',
        }

    def _assign_topic_legacy(self, text: str) -> Dict:
        """Original BERTopic-keyword classifier. Kept for back-compat."""
        if not self.topics_taxonomy:
            return {'topic_id': -1, 'topic_label': 'Uncategorized', 'method': 'legacy'}

        topic_list_str = self._build_topic_prompt()
        snippet = text[:1500]  # Limit text to keep prompt manageable

        prompt = f"""You are a newspaper article topic classifier for Dawn newspaper (Pakistan, 1990-1992).

Classify the following article into exactly ONE of these topics:

{topic_list_str}

If the article does not clearly fit any topic, respond with topic_id -1.

Article text:
\"\"\"
{snippet}
\"\"\"

Respond with ONLY valid JSON, no markdown:
{{"topic_id": <number>, "topic_label": "<topic name>", "confidence": <0.0-1.0>}}"""

        # Try Gemini classification
        keys_tried = 0
        while keys_tried < len(self._topic_keys):
            try:
                cur_key = self._topic_keys[self._topic_key_index]
                model = _create_gemini_model(cur_key, getattr(self.config, 'TOPIC_MODEL', 'gemini-2.5-flash'))
                response = model.generate_content(prompt)
                raw = response.text.strip() if response.parts else ""

                # Parse JSON from response
                if '```json' in raw:
                    raw = raw.split('```json')[1].split('```')[0].strip()
                elif '```' in raw:
                    raw = raw.split('```')[1].split('```')[0].strip()

                result = json.loads(raw)
                topic_id = int(result.get('topic_id', -1))

                # Validate topic_id exists in taxonomy
                valid_ids = {t['topic_id'] for t in self.topics_taxonomy}
                if topic_id not in valid_ids:
                    topic_id = -1

                if topic_id == -1:
                    return {'topic_id': -1, 'topic_label': 'Uncategorized', 'confidence': 0.0, 'method': 'legacy'}

                # Find the matching topic
                for t in self.topics_taxonomy:
                    if t['topic_id'] == topic_id:
                        return {
                            'topic_id': topic_id,
                            'topic_label': '_'.join(t.get('keywords', [])[:5]),
                            'confidence': float(result.get('confidence', 0.8)),
                            'method': 'legacy',
                        }

                return {'topic_id': -1, 'topic_label': 'Uncategorized', 'confidence': 0.0, 'method': 'legacy'}

            except Exception as e:
                if any(x in str(e).lower() for x in ['quota', '429', 'rate', '403']):
                    keys_tried += 1
                    self._topic_key_index = (self._topic_key_index + 1) % len(self._topic_keys)
                    if keys_tried < len(self._topic_keys):
                        print(f"  [INFO] Topic classifier rotating to key {self._topic_key_index + 1}")
                    continue
                else:
                    print(f"  [WARNING] Gemini topic classification failed: {e}")
                    return {'topic_id': -1, 'topic_label': 'Uncategorized', 'confidence': 0.0, 'method': 'legacy'}

        print("  [ERROR] All API keys exhausted for topic classification")
        return {'topic_id': -1, 'topic_label': 'Uncategorized', 'confidence': 0.0, 'method': 'legacy'}

    def assign_topics_batch(self, texts: List[str]) -> List[Dict]:
        """Classify multiple articles using Gemini API with batching.
        Sends up to 10 articles per Gemini call for efficiency."""
        if not self.topics_taxonomy:
            return [{'topic_id': -1, 'topic_label': 'Uncategorized'} for _ in texts]

        topic_list_str = self._build_topic_prompt()
        results = []
        batch_size = 10

        for i in range(0, len(texts), batch_size):
            batch = texts[i:i + batch_size]
            articles_block = ""
            for j, text in enumerate(batch):
                snippet = text[:800]
                articles_block += f"\n--- ARTICLE {j} ---\n{snippet}\n"

            prompt = f"""You are a newspaper article topic classifier for Dawn newspaper (Pakistan, 1990-1992).

Classify each article below into exactly ONE of these topics:

{topic_list_str}

If an article does not clearly fit any topic, use topic_id -1.

{articles_block}

Respond with ONLY a valid JSON array, no markdown:
[{{"article_index": 0, "topic_id": <number>, "topic_label": "<topic name>"}}, ...]"""

            keys_tried = 0
            classified = False
            while keys_tried < len(self._topic_keys):
                try:
                    cur_key = self._topic_keys[self._topic_key_index]
                    model = _create_gemini_model(cur_key, 'gemini-2.0-flash')
                    response = model.generate_content(prompt)
                    raw = response.text.strip() if response.parts else ""

                    if '```json' in raw:
                        raw = raw.split('```json')[1].split('```')[0].strip()
                    elif '```' in raw:
                        raw = raw.split('```')[1].split('```')[0].strip()

                    batch_results = json.loads(raw)
                    valid_ids = {t['topic_id'] for t in self.topics_taxonomy}

                    # Map results by article_index
                    result_map = {}
                    for r in batch_results:
                        idx = r.get('article_index', -1)
                        tid = int(r.get('topic_id', -1))
                        if tid not in valid_ids:
                            tid = -1
                        result_map[idx] = tid

                    for j in range(len(batch)):
                        tid = result_map.get(j, -1)
                        if tid == -1:
                            results.append({'topic_id': -1, 'topic_label': 'Uncategorized'})
                        else:
                            for t in self.topics_taxonomy:
                                if t['topic_id'] == tid:
                                    results.append({
                                        'topic_id': tid,
                                        'topic_label': '_'.join(t.get('keywords', [])[:5])
                                    })
                                    break
                            else:
                                results.append({'topic_id': -1, 'topic_label': 'Uncategorized'})

                    classified = True
                    break

                except Exception as e:
                    if any(x in str(e).lower() for x in ['quota', '429', 'rate', '403']):
                        keys_tried += 1
                        self._topic_key_index = (self._topic_key_index + 1) % len(self._topic_keys)
                        continue
                    else:
                        print(f"  [WARNING] Batch topic classification failed: {e}")
                        break

            if not classified:
                for _ in batch:
                    results.append({'topic_id': -1, 'topic_label': 'Uncategorized'})

            if (i + batch_size) % 50 == 0:
                print(f"  [INFO] Classified {min(i + batch_size, len(texts))}/{len(texts)} articles...")

        return results


class MediaScopePipeline:
    
    def __init__(self, config: Config):
        self.config = config
        self.db = MediaScopeDatabase(config)
        self.image_processor = ImageProcessor(config)
        self.nlp_processor = NLPProcessor(config)
    
    def initialize(self):
        self.db.connect()
    
    def process_single_newspaper(self, image_path: str, publication_date: datetime = None) -> bool:
        print(f"\n{'='*70}")
        print(f"Processing: {Path(image_path).name}")
        print(f"{'='*70}")

        try:
            # Open + enhance the page ONCE per newspaper. Previously each
            # of the three Gemini calls (metadata / ads / articles) opened
            # the file independently and re-applied enhance_image — that's
            # 3× JPEG decode + 3× rotation + 3× contrast/sharpness on a
            # 4032×3024 phone scan. Now the decoded RGB Image is shared
            # across all three calls. The downscale-for-Gemini step
            # remains per-call inside ImageProcessor (so detect_ads can
            # still crop the original full-res for ad images).
            try:
                page_img = Image.open(image_path)
                page_img = self.image_processor.enhance_image(page_img)
            except Exception as e:
                print(f"[WARNING] Could not open/enhance page image: {e} — "
                      f"falling back to per-call disk reads")
                page_img = None

            if page_img is None:
                # Without page_img we can't share, so fall back to legacy
                # per-call disk reads inside each helper.
                page_img = self.image_processor.enhance_image(Image.open(image_path))

            # The three page-level Gemini calls (metadata / detect_ads /
            # extract_articles) are independent — they all read page_img
            # and write to disjoint result containers. Run them in parallel
            # so the wall time collapses from sum(17s + 6s + 227s) to
            # max(17s, 6s, 227s) ≈ 227s on a typical page. Threads (not
            # processes) are correct here: each call is network-bound on
            # the Gemini API, and Python releases the GIL during socket
            # I/O so true concurrency happens despite the GIL.
            from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError

            def _run_metadata():
                if publication_date is not None:
                    fname_meta = self.image_processor.parse_filename_metadata(image_path)
                    # Page=1 used to be hardcoded here which is part of
                    # how 95% of the corpus ended up on page 1. Pass
                    # filename page through (may be None — that's fine).
                    return {'date': publication_date, 'page': fname_meta['page']}
                print("Detecting date and page number...")
                return self.image_processor.extract_metadata(
                    image_path, prepared_image=page_img
                )

            def _run_detect():
                print("Detecting advertisements...")
                try:
                    return self.image_processor.detect_ads(page_img)
                except Exception as e:
                    print(f"[WARNING] Ad detection failed: {e}")
                    return []

            def _run_articles():
                print("Extracting articles...")
                return self.image_processor.extract_articles(
                    image_path, prepared_image=page_img
                )

            # Per-future deadline = 1.5× the per-call Gemini timeout so a
            # genuine slow-but-progressing call still completes, but a
            # stuck recv() on a dead socket can't wedge the executor
            # forever. Without this belt-and-suspenders, even the SDK's
            # request-options timeout has been observed to be ignored on
            # rare network paths — the v4 8-hour stall happened with
            # the SDK theoretically capable of timing out.
            _PAGE_FUTURE_DEADLINE_S = 300.0

            with ThreadPoolExecutor(max_workers=3, thread_name_prefix='page') as ex:
                f_meta = ex.submit(_run_metadata)
                f_ads = ex.submit(_run_detect)
                f_arts = ex.submit(_run_articles)
                try:
                    metadata = f_meta.result(timeout=_PAGE_FUTURE_DEADLINE_S)
                    detected_ads = f_ads.result(timeout=_PAGE_FUTURE_DEADLINE_S)
                    articles = f_arts.result(timeout=_PAGE_FUTURE_DEADLINE_S)
                except FuturesTimeoutError as e:
                    # Cancel any still-running futures so the executor's
                    # __exit__ doesn't block forever on join().
                    for f in (f_meta, f_ads, f_arts):
                        f.cancel()
                    raise RuntimeError(
                        f"Page-level Gemini call exceeded {_PAGE_FUTURE_DEADLINE_S}s deadline — "
                        f"likely a stuck recv() on a closed socket. Skipping this page."
                    ) from e

            pub_date = metadata['date']
            page_num = metadata['page']

            newspaper_id = self.db.insert_newspaper(
                pub_date=pub_date,
                page_num=page_num,
                section='Main',
                image_path=image_path
            )
            print(f"[OK] Newspaper record created: {newspaper_id}")

            # Per-ad analyze_ad_image calls are also independent — fan
            # them out so a page with N ads costs ~max(per-ad) instead of
            # sum(per-ad). Cap the pool so a 20-ad page doesn't slam
            # Gemini all at once and trigger 429s.
            try:
                ads_saved = 0
                if detected_ads:
                    with ThreadPoolExecutor(
                        max_workers=min(4, len(detected_ads)),
                        thread_name_prefix='ad',
                    ) as ex:
                        analyses = list(ex.map(
                            self.image_processor.analyze_ad_image,
                            (ad['image'] for ad in detected_ads),
                        ))
                    for ad, analysis in zip(detected_ads, analyses):
                        ad['publication_date'] = pub_date
                        ad['page_number'] = page_num
                        ad['deep_analysis'] = analysis
                        if self.db.insert_ad(newspaper_id, ad):
                            ads_saved += 1
                print(f"[OK] Saved {ads_saved}/{len(detected_ads)} ads")
            except Exception as e:
                print(f"[WARNING] Ad save phase failed: {e}")

            print(f"[OK] Found {len(articles)} articles")

            articles_processed = 0
            articles_failed = 0

            # Batch-classify topics for ALL articles on this page in a
            # single Gemini call (well, ⌈N/10⌉ calls). Was ~13 round-trips
            # per page (one per article); now ~1-2. The dominant per-page
            # cost on text-heavy editions. Uses the same Gemini-only
            # classifier the backfill uses, so labels stay consistent.
            try:
                from services.topics_gemini import classify_topics_batch_gemini
                combined_texts = [
                    f"{a.get('headline','')}\n\n{a.get('text','')}" for a in articles
                ]
                batch_topics = classify_topics_batch_gemini(combined_texts)
                print(f"  [OK] Topic batch: classified {len(batch_topics)} articles "
                      f"in ⌈{len(articles)}/10⌉ Gemini call(s)")
            except Exception as e:
                print(f"  [WARNING] Topic batch failed, falling back to per-article: {e}")
                batch_topics = [None] * len(articles)

            for article, batch_topic in zip(articles, batch_topics):
                try:
                    print(f"\n  Article {article['number']}: {article['headline'][:50]}...")

                    print("    Extracting entities...")
                    entities = self.nlp_processor.extract_entities(article['text'])
                    print(f"    [OK] Found {len(entities)} entities")

                    print("    Analyzing sentiment...")
                    sentiment = self.nlp_processor.analyze_sentiment(article['text'])
                    print(f"    [OK] Sentiment: {sentiment['label']} ({sentiment['score']}) "
                          f"via {sentiment.get('method', 'roberta')}")

                    # Topic — use the batch result when available; only fall
                    # back to a per-article Gemini call if the batch failed
                    # entirely OR returned a confidence==0 fallback for this
                    # specific article.
                    combined_text = f"{article['headline']}\n\n{article['text']}"
                    if batch_topic and batch_topic.get('confidence', 0) > 0:
                        topic = {
                            'topic_id': batch_topic['topic_id'],
                            'topic_label': batch_topic['topic_label'],
                            'topic_key': batch_topic.get('topic_key'),
                            'confidence': batch_topic['confidence'],
                            'method': 'gemini-curated',
                        }
                        print(f"    [OK] Topic (batch): {topic['topic_label']} "
                              f"(id={topic['topic_id']}, conf={topic['confidence']:.2f})")
                    else:
                        print("    Classifying topic (per-article fallback)…")
                        topic = self.nlp_processor.assign_topic(combined_text)
                        print(f"    [OK] Topic: {topic.get('topic_label', 'N/A')} "
                              f"(id={topic.get('topic_id')}, via {topic.get('method', 'legacy')})")

                    article_data = {
                        'article_number': article['number'],
                        'headline': article['headline'],
                        'content': article['text'],
                        'word_count': article['word_count'],
                        'bounding_box': None,
                        'sentiment_score': sentiment['score'],
                        'sentiment_label': sentiment['label'],
                        'sentiment_method': sentiment.get('method', 'roberta'),
                        'topic_id': topic['topic_id'],
                        'topic_label': topic['topic_label'],
                        # New fields (curated path only — legacy path leaves them None):
                        'topic_key': topic.get('topic_key'),
                        'topic_confidence': topic.get('confidence'),
                        'topic_method': topic.get('method', 'legacy'),
                        'publication_date': pub_date,
                        'page_number': page_num
                    }

                    article_id = self.db.insert_article(newspaper_id, article_data)
                    print(f"    [OK] Article saved: {article_id}")

                    self.db.insert_entities(article_id, entities)

                    self.db.index_article_es(
                        article_id,
                        article_data,
                        entities,
                        pub_date
                    )

                    articles_processed += 1

                except Exception as e:
                    articles_failed += 1
                    print(f"    [ERROR] Failed to process article {article.get('number', '?')}: {e}")
                    import traceback
                    traceback.print_exc()
                    continue

            if articles_processed > 0:
                articles_query = self.db.db.db.collection('articles').where('newspaper_id', '==', newspaper_id).stream()
                total_sentiment = 0
                article_count = 0

                for article_doc in articles_query:
                    article_data = article_doc.to_dict()
                    total_sentiment += article_data.get('sentiment_score', 0)
                    article_count += 1

                avg_sentiment = total_sentiment / article_count if article_count > 0 else 0

                newspaper_ref = self.db.db.db.collection('newspapers').document(newspaper_id)
                newspaper_ref.update({
                    'article_count': article_count,
                    'avg_sentiment': round(avg_sentiment, 3)
                })
                print(f"[OK] Updated newspaper stats: {article_count} articles, avg sentiment: {avg_sentiment:.3f}")

            print(f"\n{'='*50}")
            print(f"[OK] Newspaper processing complete")
            print(f"   Articles processed: {articles_processed}")
            if articles_failed > 0:
                print(f"   Articles failed: {articles_failed}")
            print(f"{'='*50}")
            return True

        except Exception as e:
            print(f"\n[ERROR] Error processing newspaper: {e}")
            import traceback
            traceback.print_exc()
            return False
    
    def process_batch(self, image_folder: str, start_idx: int = 0, end_idx: int = None):
        image_files = []
        for ext in ['*.jpg', '*.jpeg', '*.png', '*.heic', '*.JPG', '*.JPEG', '*.PNG', '*.HEIC']:
            image_files.extend(Path(image_folder).glob(ext))
        
        if not image_files:
            print("[ERROR] No images found")
            return

        image_files.sort()

        if end_idx is None:
            end_idx = len(image_files)

        image_files = image_files[start_idx:end_idx]
        print(f"Processing newspapers {start_idx+1} to {min(end_idx, len(image_files)+start_idx)} (Total: {len(image_files)})")
        
        success_count = 0
        fail_count = 0
        
        for i, image_path in enumerate(image_files, 1):
            print(f"\n[{i}/{len(image_files)}]")
            
            if self.process_single_newspaper(str(image_path)):
                success_count += 1
            else:
                fail_count += 1
        
        print(f"\n{'='*70}")
        print("PROCESSING COMPLETE")
        print(f"{'='*70}")
        print(f"Successful: {success_count}")
        print(f"Failed: {fail_count}")
        print(f"Total: {len(image_files)}")
        print(f"{'='*70}")
    
    def close(self):
        self.db.close()


def main():
    print("""
╔══════════════════════════════════════════════════════════════════╗
║              MediaScope Processing Pipeline                      ║
║         Dawn Newspaper Archive (1990-1992)                       ║
╚══════════════════════════════════════════════════════════════════╝
    """)
    
    config = Config()
    
    pipeline = MediaScopePipeline(config)
    pipeline.initialize()
    
    try:
        import sys
        
        start = int(sys.argv[1]) if len(sys.argv) > 1 else 0
        end = int(sys.argv[2]) if len(sys.argv) > 2 else None
        
        if start > 0 or end:
            print(f"Processing range: {start+1} to {end if end else 'end'}")
        
        pipeline.process_batch(config.INPUT_FOLDER, start, end)
    finally:
        pipeline.close()


if __name__ == "__main__":
    main()