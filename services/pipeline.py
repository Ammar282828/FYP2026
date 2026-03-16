#!/usr/bin/env python3
"""
MediaScope Complete Processing Pipeline
- OCR with Gemini
- Layout Detection
- Named Entity Recognition (spaCy)
- Sentiment Analysis (RoBERTa/DistilBERT)
- Topic Modeling (BERTopic)
- Database Storage (PostgreSQL + Elasticsearch)
"""

# this is the main processing pipeline that does OCR and NLP stuff
# it uses gemini for OCR, spacy for entities, and bertopic for topics

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

import spacy
from transformers import pipeline
from bertopic import BERTopic
from sentence_transformers import SentenceTransformer

from database.firestore_db import get_db as get_firestore_db

from dataclasses import dataclass

@dataclass
class Config:
    GEMINI_API_KEY: str = os.getenv("GEMINI_API_KEY", "AIzaSyDp1jVDg9M8Da6EHFA2rlDImEDI5r_B-mw")
    GEMINI_API_KEYS: tuple = (
        "AIzaSyDp1jVDg9M8Da6EHFA2rlDImEDI5r_B-mw",
        "AIzaSyBEw0r3jugyGTKj4OTEMVNwPsjSikmzweo",
        "AIzaSyDDOoeD__L-xXzb2d4K3L5iq0wtjtAhVHs",
        "AIzaSyBAzxW1_gTyaQWL58fQtngWMsVTo6I61Vo",
    )
    GEMINI_MODEL: str = "gemini-3.1-pro-preview"
    
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
    EMBEDDING_MODEL: str = "all-MiniLM-L6-v2"


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
            'publication_date': article_data.get('publication_date', datetime(1990, 1, 1)),
            'page_number': article_data.get('page_number', 1),
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

        genai.configure(api_key=self._keys[self._key_index])
        self.model = genai.GenerativeModel(
            config.GEMINI_MODEL,
            safety_settings=self.safety_settings
        )

    def _rotate_key(self):
        """Switch to the next API key and reinitialise the model."""
        self._key_index = (self._key_index + 1) % len(self._keys)
        new_key = self._keys[self._key_index]
        print(f"  [INFO] Rotating to API key {self._key_index + 1}/{len(self._keys)}")
        genai.configure(api_key=new_key)
        self.model = genai.GenerativeModel(
            self.config.GEMINI_MODEL,
            safety_settings=self.safety_settings
        )

    def _generate(self, prompt_parts):
        """Call generate_content, rotating keys on quota errors."""
        keys_tried = 0
        while keys_tried < len(self._keys):
            try:
                return self.model.generate_content(
                    prompt_parts,
                    safety_settings=self.safety_settings
                )
            except Exception as e:
                if any(x in str(e).lower() for x in ['quota', '429', 'rate', '403', 'permission', 'leaked']):
                    keys_tried += 1
                    if keys_tried < len(self._keys):
                        self._rotate_key()
                    else:
                        print(f"  [ERROR] All API keys exhausted quota")
                        raise
                else:
                    raise
    
    def extract_date_from_filename(self, image_path: str) -> Optional[datetime]:
        filename = Path(image_path).stem

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

                    date = datetime(year, month, day)
                    print(f"  [OK] Extracted date from filename: {date.strftime('%Y-%m-%d')}")
                    return date
                except (ValueError, IndexError):
                    continue

        return None

    def extract_metadata(self, image_path: str) -> Dict:
        filename_date = self.extract_date_from_filename(image_path)

        try:
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

If not found, write UNKNOWN."""

            response = self._generate([prompt, img])
            text = response.text if response.parts else ""

            month_match = re.search(r'MONTH:\s*(\w+)', text, re.IGNORECASE)
            day_match = re.search(r'DAY:\s*(\d+)', text, re.IGNORECASE)
            year_match = re.search(r'YEAR:\s*(\d+)', text, re.IGNORECASE)
            page_match = re.search(r'PAGE:\s*(\d+)', text, re.IGNORECASE)

            if filename_date and (not month_match or not day_match or not year_match):
                pub_date = filename_date
                print(f"  [OK] Using filename date: {pub_date.strftime('%Y-%m-%d')}")
            else:
                month = month_match.group(1) if month_match else "January"
                day = int(day_match.group(1)) if day_match else 1
                year = int(year_match.group(1)) if year_match else 1990

                month_num = datetime.strptime(month[:3], '%b').month
                pub_date = datetime(year, month_num, day)

            page = int(page_match.group(1)) if page_match else 1
            print(f"  [OK] Date detected: {pub_date.strftime('%Y-%m-%d')} | Page: {page}")

            return {
                'date': pub_date,
                'page': page,
                'success': True
            }

        except Exception as e:
            print(f"  [WARNING] Metadata extraction failed: {e}")
            if filename_date:
                return {
                    'date': filename_date,
                    'page': 1,
                    'success': True
                }
            return {
                'date': datetime(1990, 1, 1),
                'page': 1,
                'success': False
            }
    
    def enhance_image(self, image: Image.Image) -> Image.Image:
        try:
            image = ImageOps.exif_transpose(image)
        except Exception:
            pass

        if image.width > image.height:
            print("  [INFO] Rotating landscape image to portrait")
            image = image.rotate(90, expand=True)

        if image.mode != 'RGB':
            image = image.convert('RGB')

        enhancer = ImageEnhance.Contrast(image)
        image = enhancer.enhance(1.3)

        enhancer = ImageEnhance.Sharpness(image)
        image = enhancer.enhance(1.2)

        enhancer = ImageEnhance.Brightness(image)
        image = enhancer.enhance(1.1)

        return image
    
    def extract_articles(self, image_path: str) -> List[Dict]:
        try:
            img = Image.open(image_path)
            img = self.enhance_image(img)

            print(f"  [INFO] Attempting OCR extraction (attempt 1/2)...")
            prompt = """What text do you see in this image? Extract all readable text."""
            response = self._generate([prompt, img])

            text = ""
            if hasattr(response, 'parts') and response.parts:
                try:
                    text = response.text
                    print(f"  [OK] Got response ({len(text)} chars)")
                except Exception as e:
                    print(f"  [WARNING] Could not get text from response: {e}")

            if not text or len(text) < 50:
                print(f"  [WARNING] Response too short or empty, retrying...")
                print(f"  [INFO] Attempting OCR extraction (attempt 2/2)...")
                response = self._generate(["Transcribe this document.", img])
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

                # Try to find something that looks like a headline (short line, capitalized)
                headline = "Extracted Text"
                content_start = 0

                for i, line in enumerate(lines[:10]):  # Check first 10 lines for headline
                    line = line.strip()
                    if line and len(line) < 100 and len(line.split()) > 2:
                        headline = line
                        content_start = i + 1
                        break

                content = '\n'.join(lines[content_start:]).strip()

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

            response = self._generate([analysis_prompt, ad_image])
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

            response = self._generate([prompt, image])
            text = response.text if response.parts else ""

            json_match = re.search(r'\{[\s\S]*\}', text)
            if not json_match:
                return []

            data = json.loads(json_match.group())
            raw_ads = data.get('ads', [])

            cropped_ads = []
            for ad in raw_ads:
                try:
                    x1 = int(float(ad['x1']) * width)
                    y1 = int(float(ad['y1']) * height)
                    x2 = int(float(ad['x2']) * width)
                    y2 = int(float(ad['y2']) * height)

                    x1 = max(0, min(x1, width - 1))
                    y1 = max(0, min(y1, height - 1))
                    x2 = max(x1 + 20, min(x2, width))
                    y2 = max(y1 + 20, min(y2, height))

                    # Skip regions that are too large (likely the whole page, not an ad)
                    region_fraction = ((x2 - x1) * (y2 - y1)) / (width * height)
                    if region_fraction > 0.7:
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

        print("Loading topic modeling...")
        self.embedding_model = SentenceTransformer(config.EMBEDDING_MODEL, device='cpu')
        self.topic_model = None

        print("[OK] NLP models loaded")
    
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
        text = text[:1000]
        
        results = self.sentiment_analyzer(text)[0]
        
        label_map = {'negative': -1, 'neutral': 0, 'positive': 1}
        
        top_result = max(results, key=lambda x: x['score'])
        label = top_result['label'].lower()
        
        score = 0
        for result in results:
            lbl = result['label'].lower()
            score += label_map.get(lbl, 0) * result['score']
        
        return {
            'score': round(score, 3),
            'label': label,
            'confidence': round(top_result['score'], 3)
        }
    
    def train_topic_model(self, documents: List[str]) -> BERTopic:
        print("Training topic model...")

        from sklearn.feature_extraction.text import CountVectorizer

        vectorizer_model = CountVectorizer(
            ngram_range=(1, 2),
            stop_words="english",
            min_df=2,
            max_df=0.7
        )

        self.topic_model = BERTopic(
            embedding_model=self.embedding_model,
            vectorizer_model=vectorizer_model,
            nr_topics="auto",
            min_topic_size=15,
            calculate_probabilities=True,
            verbose=True
        )

        topics, probs = self.topic_model.fit_transform(documents)

        self.topic_documents = documents
        self.topic_assignments = topics

        print(f"[OK] Discovered {len(set(topics))} topics")
        return self.topic_model

    def save_topic_model(self, path: str = "data/topic_model"):
        if self.topic_model is None:
            raise ValueError("No topic model to save. Train the model first.")

        import os
        os.makedirs(os.path.dirname(path) if os.path.dirname(path) else ".", exist_ok=True)

        self.topic_model.save(path, serialization="pickle", save_ctfidf=True, save_embedding_model=False)
        print(f"Topic model saved to {path}")

    def load_topic_model(self, path: str = "data/topic_model"):
        import os
        if not os.path.exists(path):
            return False

        self.topic_model = BERTopic.load(path, embedding_model=self.embedding_model)

        self.topic_assignments = []
        self.article_metadata = []
        self.topic_documents = []

        print(f"Topic model loaded from {path}")
        return True

    def assign_topic(self, text: str) -> Dict:
        if not self.topic_model:
            return {'topic_id': -1, 'topic_label': 'Uncategorized'}
        
        topic, prob = self.topic_model.transform([text])
        
        if topic[0] == -1:
            return {'topic_id': -1, 'topic_label': 'Uncategorized'}
        
        topic_info = self.topic_model.get_topic(topic[0])
        keywords = [word for word, _ in topic_info[:5]]
        
        return {
            'topic_id': int(topic[0]),
            'topic_label': '_'.join(keywords),
            'confidence': float(prob[0])
        }


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
            if publication_date is None:
                print("Detecting date and page number...")
                metadata = self.image_processor.extract_metadata(image_path)
                pub_date = metadata['date']
                page_num = metadata['page']
            else:
                pub_date = publication_date
                page_num = 1
            
            newspaper_id = self.db.insert_newspaper(
                pub_date=pub_date,
                page_num=page_num,
                section='Main',
                image_path=image_path
            )
            print(f"[OK] Newspaper record created: {newspaper_id}")

            # Detect and save advertisements
            print("Detecting advertisements...")
            try:
                page_img = Image.open(image_path)
                page_img = self.image_processor.enhance_image(page_img)
                detected_ads = self.image_processor.detect_ads(page_img)
                ads_saved = 0
                for ad in detected_ads:
                    ad['publication_date'] = pub_date
                    ad['page_number'] = page_num
                    ad['deep_analysis'] = self.image_processor.analyze_ad_image(ad['image'])
                    if self.db.insert_ad(newspaper_id, ad):
                        ads_saved += 1
                print(f"[OK] Saved {ads_saved}/{len(detected_ads)} ads")
            except Exception as e:
                print(f"[WARNING] Ad detection skipped: {e}")

            print("Extracting articles...")
            articles = self.image_processor.extract_articles(image_path)
            print(f"[OK] Found {len(articles)} articles")
            
            articles_processed = 0
            articles_failed = 0

            for article in articles:
                try:
                    print(f"\n  Article {article['number']}: {article['headline'][:50]}...")

                    print("    Extracting entities...")
                    entities = self.nlp_processor.extract_entities(article['text'])
                    print(f"    [OK] Found {len(entities)} entities")

                    print("    Analyzing sentiment...")
                    sentiment = self.nlp_processor.analyze_sentiment(article['text'])
                    print(f"    [OK] Sentiment: {sentiment['label']} ({sentiment['score']})")

                    topic = {'topic_id': None, 'topic_label': None}

                    article_data = {
                        'article_number': article['number'],
                        'headline': article['headline'],
                        'content': article['text'],
                        'word_count': article['word_count'],
                        'bounding_box': None,
                        'sentiment_score': sentiment['score'],
                        'sentiment_label': sentiment['label'],
                        'topic_id': topic['topic_id'],
                        'topic_label': topic['topic_label'],
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