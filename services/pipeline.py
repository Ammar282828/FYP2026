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
    GEMINI_API_KEY: str = os.getenv("GEMINI_API_KEY", "AIzaSyBtUk2lUskKgLDhpmxFf6Lfz6IAh7RH5bg")
    GEMINI_MODEL: str = "gemini-3-pro-preview"
    
    DB_HOST: str = "localhost"
    DB_PORT: int = 5432
    DB_NAME: str = "mediascope"
    DB_USER: str = "mediascope_user"
    DB_PASSWORD: str = "your_password"
    
    ES_HOST: str = "localhost"
    ES_PORT: int = 9200
    ES_INDEX: str = "mediascope_articles"
    
    INPUT_FOLDER: str = "./input_newspapers"
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
        genai.configure(api_key=config.GEMINI_API_KEY)

        self.safety_settings = {
            "HARM_CATEGORY_HARASSMENT": "BLOCK_NONE",
            "HARM_CATEGORY_HATE_SPEECH": "BLOCK_NONE",
            "HARM_CATEGORY_SEXUALLY_EXPLICIT": "BLOCK_NONE",
            "HARM_CATEGORY_DANGEROUS_CONTENT": "BLOCK_NONE",
        }

        self.model = genai.GenerativeModel(
            config.GEMINI_MODEL,
            safety_settings=self.safety_settings
        )
    
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

            prompt = """Extract from this newspaper scan:
1. Publication date (month, day, year)
2. Page number

Respond ONLY in this format:
MONTH: [month name]
DAY: [day number]
YEAR: [4-digit year like 1990]
PAGE: [page number]

If not found, write UNKNOWN."""

            response = self.model.generate_content(
                [prompt, img],
                safety_settings=self.safety_settings
            )
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
            
            prompt = """You are digitizing historical newspaper archives for educational research and preservation.

Your task: Extract text from this 1990s newspaper page for academic archival purposes.

Output each article found using this format:
ARTICLE_START
NUMBER: [number]
HEADLINE: [headline]
CONTENT: [full article text]
ARTICLE_END

Note: This is archive digitization work under fair use for educational purposes."""

            response = self.model.generate_content(
                [prompt, img],
                safety_settings=self.safety_settings
            )

            if not response.parts:
                print(f"  [WARNING] Response blocked - attempting with modified prompt")
                fallback_prompt = """Extract and transcribe text from this newspaper scan for historical archive database. Provide article headlines and text content in structured format."""
                response = self.model.generate_content(
                    [fallback_prompt, img],
                    safety_settings=self.safety_settings
                )

            text = response.text if response.parts else ""
            
            articles = []
            article_blocks = re.findall(
                r'ARTICLE_START(.*?)ARTICLE_END', 
                text, 
                re.DOTALL
            )
            
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
            
            return articles

        except Exception as e:
            print(f"  [ERROR] Article extraction failed: {e}")
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
                pub_date = datetime(1990, 1, 1)
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
                articles_query = self.db.db.collection('articles').where('newspaper_id', '==', newspaper_id).stream()
                total_sentiment = 0
                article_count = 0

                for article_doc in articles_query:
                    article_data = article_doc.to_dict()
                    total_sentiment += article_data.get('sentiment_score', 0)
                    article_count += 1

                avg_sentiment = total_sentiment / article_count if article_count > 0 else 0

                newspaper_ref = self.db.db.collection('newspapers').document(newspaper_id)
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