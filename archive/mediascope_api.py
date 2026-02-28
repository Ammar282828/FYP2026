
#!/usr/bin/env python3
from fastapi import FastAPI, HTTPException, UploadFile, File, Form, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from typing import Optional, List
from contextlib import contextmanager
import os
from dotenv import load_dotenv
import uuid
from datetime import datetime
import base64
import re
import json
from pathlib import Path
import google.generativeai as genai

from firestore_db import get_db as get_firestore_db

PIPELINE_AVAILABLE = False
pipeline = None

load_dotenv()

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)

app = FastAPI(title="MediaScope API", version="2.0")

allowed_origins = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
    allow_credentials=True,
    max_age=3600
)

app.mount("/input_newspapers", StaticFiles(directory="input_newspapers"), name="newspapers")

def _init_pipeline():
    """Initialize pipeline on first use to avoid import errors on startup"""
    global pipeline, PIPELINE_AVAILABLE

    if pipeline is not None:
        return pipeline

    try:
        from mediascope_complete_pipeline import MediaScopePipeline, Config
        config = Config()
        pipeline = MediaScopePipeline(config)
        pipeline.initialize()
        PIPELINE_AVAILABLE = True
        print("[OK] MediaScope OCR Pipeline initialized")

        try:
            if pipeline.nlp_processor.load_topic_model("topic_model"):
                print("[OK] Topic model loaded from disk")
            else:
                print("[INFO] No saved topic model found. Train it using POST /api/topics/train")
        except Exception as load_error:
            print(f"[WARNING] Failed to load topic model: {load_error}")

        return pipeline
    except Exception as e:
        print(f"[WARNING] Pipeline initialization failed: {e}")
        print(f"   OCR features will be unavailable. Install missing dependencies with: pip install spacy transformers bertopic")
        PIPELINE_AVAILABLE = False
        return None

def get_db():
    """Get Firestore database instance"""
    return get_firestore_db()

@contextmanager
def get_db_cursor():
    """Context manager for database operations (Firestore compatibility layer)"""
    db = get_db()
    try:
        yield db
    except Exception as e:
        raise
    finally:
        pass

def filter_and_normalize_entities(entities):
    """Filter out noise entities and normalize similar ones"""
    if not entities or entities == '[]':
        return []

    NOISE_WORDS = {
        'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
        'first', 'second', 'third', 'last', 'next', 'today', 'yesterday', 'tomorrow',
        'this', 'that', 'these', 'those', 'the', 'a', 'an', 'and', 'or', 'but',
        'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
        'jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'
    }

    filtered = []
    seen_normalized = {}

    for entity in entities:
        text = entity.get('text', '').strip()
        entity_type = entity.get('type', '')

        if not text or len(text) < 2:
            continue

        if text.isdigit():
            continue

        if text.lower() in NOISE_WORDS:
            continue

        if not any(c.isalnum() for c in text):
            continue

        if entity_type in ['DATE', 'TIME', 'CARDINAL', 'ORDINAL', 'MONEY', 'PERCENT', 'QUANTITY']:
            continue

        normalized = text.lower().rstrip('s')

        if normalized in seen_normalized:
            existing = seen_normalized[normalized]
            if len(text) > len(existing['text']):
                seen_normalized[normalized] = entity
        else:
            seen_normalized[normalized] = entity

    return list(seen_normalized.values())

def extract_date_from_image(image_path: str) -> Optional[str]:
    """Extract publication date from newspaper image using OCR"""
    try:
        try:
            import pytesseract
            from PIL import Image

            img = Image.open(image_path)
            width, height = img.size
            top_section = img.crop((0, 0, width, int(height * 0.2)))

            text = pytesseract.image_to_string(top_section)

            date_patterns = [
                r'(\d{1,2}[-/]\d{1,2}[-/]\d{4})',
                r'(\d{4}[-/]\d{1,2}[-/]\d{1,2})',
                r'((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4})',
                r'(\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4})',
            ]

            for pattern in date_patterns:
                match = re.search(pattern, text, re.IGNORECASE)
                if match:
                    date_str = match.group(1)
                    try:
                        from dateutil import parser
                        parsed_date = parser.parse(date_str, fuzzy=True)
                        if 1990 <= parsed_date.year <= 1992:
                            return parsed_date.strftime('%Y-%m-%d')
                    except:
                        continue
        except ImportError:
            pass

        return None
    except Exception as e:
        print(f"Date extraction error: {e}")
        return None

@app.get("/api/articles")
def list_articles(limit: int = 100, offset: int = 0):
    """List articles with proper connection management"""
    try:
        db = get_db()
        articles_ref = db.db.collection('articles').order_by('publication_date', direction='DESCENDING').limit(limit + offset)
        articles_docs = list(articles_ref.stream())

        articles_docs = articles_docs[offset:offset + limit]

        articles = []
        for doc in articles_docs:
            data = doc.to_dict()
            data['content_preview'] = data.get('content', '')[:200]
            articles.append(data)

        return {"articles": articles}
    except Exception as e:
        raise HTTPException(500, f"Database error: {str(e)}")

@app.get("/api/analytics/total-articles")
def count_articles():
    """Get total count of articles in database"""
    try:
        db = get_db()
        count = 0
        for _ in db.db.collection('articles').stream():
            count += 1
        return {"total_articles": count}
    except Exception as e:
        raise HTTPException(500, f"Database error: {str(e)}")

@app.get("/api/articles/{article_id}")
def get_article(article_id: str):
    """Get single article by ID"""
    try:
        db = get_db()
        article = db.get_article(article_id)
        if not article:
            raise HTTPException(404, "Article not found")
        return article
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Database error: {str(e)}")

@app.get("/api/analytics/articles-over-time")
def articles_over_time():
    """Get article count over time with proper error handling"""
    try:
        db = get_db()
        timeline = db.get_analytics_articles_over_time()
        return {"timeline": timeline}
    except Exception as e:
        raise HTTPException(500, f"Database error: {str(e)}")

@app.get("/api/analytics/sentiment-over-time")
def sentiment_over_time():
    """Get sentiment distribution over time with proper error handling"""
    try:
        db = get_db()
        timeline = db.get_analytics_sentiment_over_time()
        return {"timeline": timeline}
    except Exception as e:
        raise HTTPException(500, f"Database error: {str(e)}")

@app.get("/api/analytics/top-keywords")
def top_keywords(limit: int = 30):
    """Get top keywords with proper error handling"""
    limit = min(limit, 100)
    try:
        db = get_db()
        keywords = db.get_top_keywords(limit=limit)
        return {"keywords": keywords}
    except Exception as e:
        raise HTTPException(500, f"Database error: {str(e)}")

@app.get("/api/suggestions/keywords")
def keyword_suggestions(limit: int = 100):
    """Get keyword suggestions with proper error handling"""
    limit = min(limit, 200)
    try:
        db = get_db()
        keywords = db.get_top_keywords(limit=limit)
        return {"suggestions": keywords}
    except Exception as e:
        raise HTTPException(500, f"Database error: {str(e)}")

@app.get("/api/analytics/top-entities-fixed")
def top_entities(entity_type: Optional[str] = None, limit: int = 15,
                start_date: Optional[str] = None, end_date: Optional[str] = None):
    """Get top entities with proper error handling"""
    limit = min(limit, 100)
    try:
        db = get_db()
        entities = db.get_top_entities(entity_type=entity_type, limit=limit,
                                      start_date=start_date, end_date=end_date)
        return {"entities": entities}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Database error: {str(e)}")

@app.get("/api/analytics/sentiment-fixed")
def sentiment_overview():
    """Get sentiment overview with proper error handling"""
    try:
        with get_db_cursor() as cur:
            cur.execute("""
                SELECT sentiment_label, COUNT(*) as count FROM articles
                WHERE sentiment_label IS NOT NULL GROUP BY sentiment_label
            """)
            data = {"positive": 0, "neutral": 0, "negative": 0, "total": 0}
            for r in cur.fetchall():
                data[r['sentiment_label']] = r['count']
                data['total'] += r['count']
            return data
    except Exception as e:
        raise HTTPException(500, f"Database error: {str(e)}")

@app.post("/api/analytics/keyword-trend")
def keyword_trend(request: dict):
    """Get keyword trends over time with proper validation and error handling"""
    keywords = request.get('keywords', [])
    start_date = request.get('start_date')
    end_date = request.get('end_date')

    if not keywords or not isinstance(keywords, list):
        raise HTTPException(400, "Keywords must be a non-empty list")

    if not start_date or not end_date:
        raise HTTPException(400, "start_date and end_date are required")

    try:
        from datetime import datetime
        from collections import defaultdict

        db = get_db()

        from datetime import timezone
        start = datetime.fromisoformat(start_date.replace('Z', '+00:00'))
        if start.tzinfo is None:
            start = start.replace(tzinfo=timezone.utc)
        end = datetime.fromisoformat(end_date.replace('Z', '+00:00'))
        if end.tzinfo is None:
            end = end.replace(tzinfo=timezone.utc)

        articles_stream = db.db.collection('articles').limit(1000).stream()
        articles = [doc.to_dict() for doc in articles_stream]

        trends = {}
        for keyword in keywords[:5]:
            date_counts = defaultdict(int)

            for data in articles:
                pub_date = data.get('publication_date')

                if not pub_date:
                    continue

                if isinstance(pub_date, str):
                    pub_date = datetime.fromisoformat(pub_date.replace('Z', '+00:00'))

                if pub_date.tzinfo is None:
                    pub_date = pub_date.replace(tzinfo=timezone.utc)

                if not (start <= pub_date <= end):
                    continue

                entities = data.get('entities', [])
                keyword_found = False

                for entity in entities:
                    entity_text = entity.get('text', '')
                    if keyword.lower() in entity_text.lower():
                        keyword_found = True
                        break

                if not keyword_found:
                    content = data.get('content', '') + ' ' + data.get('headline', '')
                    if keyword.lower() in content.lower():
                        keyword_found = True

                if keyword_found:
                    date_key = pub_date.strftime('%Y-%m-%d')
                    date_counts[date_key] += 1

            trends[keyword] = [
                {"date": date, "count": count}
                for date, count in sorted(date_counts.items())
            ]

            articles = db.db.collection('articles').stream()

        return {"trends": trends}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Database error: {str(e)}")

@app.post("/api/search/keyword")
def search_keyword(request: dict):
    """Search articles by keyword with validation, sorting, and error handling"""
    keyword = request.get('keyword') or request.get('query', '')
    limit = min(request.get('limit', 100), 1000)
    offset = max(request.get('offset', 0), 0)
    sort_by = request.get('sort_by', 'date')

    if not keyword or len(keyword) < 1:
        raise HTTPException(400, "Keyword is required and must be at least 1 character")

    if len(keyword) > 200:
        raise HTTPException(400, "Keyword must be less than 200 characters")

    try:
        db = get_db()
        articles = db.search_articles(keyword, limit=limit)

        total = len(articles)
        articles = articles[offset:offset + limit]

        articles_list = []
        for article in articles:
            article['content_preview'] = article.get('content', '')[:200]
            article['entities'] = filter_and_normalize_entities(article.get('entities', []))
            articles_list.append(article)

        if sort_by == 'date':
            articles_list.sort(key=lambda x: x.get('publication_date', ''), reverse=True)
        elif sort_by == 'date_asc':
            articles_list.sort(key=lambda x: x.get('publication_date', ''))
        elif sort_by == 'sentiment':
            articles_list.sort(key=lambda x: x.get('sentiment_score', 0), reverse=True)
        elif sort_by == 'sentiment_asc':
            articles_list.sort(key=lambda x: x.get('sentiment_score', 0))

        return {
            "articles": articles_list,
            "total": total,
            "keyword": keyword,
            "sort_by": sort_by
        }
    except Exception as e:
        raise HTTPException(500, f"Database error: {str(e)}")

@app.post("/api/search/entity")
def search_entity(request: dict):
    """Search articles by entity name"""
    entity_name = request.get('entity_name', '') or request.get('query', '')
    limit = min(request.get('limit', 100), 1000)
    offset = max(request.get('offset', 0), 0)

    if not entity_name or len(entity_name) < 1:
        raise HTTPException(400, "Entity name is required")

    try:
        db = get_db()
        articles = db.search_by_entity(entity_name, limit=limit)

        total = len(articles)
        articles = articles[offset:offset + limit]

        articles_list = []
        for article in articles:
            article['content_preview'] = article.get('content', '')[:200]
            article['entities'] = filter_and_normalize_entities(article.get('entities', []))
            articles_list.append(article)

        return {
            "articles": articles_list,
            "total": total,
            "entity_name": entity_name
        }
    except Exception as e:
        raise HTTPException(500, f"Database error: {str(e)}")

@app.post("/api/ocr/upload")
async def upload_newspaper_for_ocr(file: UploadFile = File(...)):
    """Upload newspaper image for OCR processing with automatic date extraction"""
    try:
        if not file.content_type or not file.content_type.startswith('image/'):
            raise HTTPException(400, "File must be an image")

        upload_dir = "uploads/newspapers"
        os.makedirs(upload_dir, exist_ok=True)

        file_id = str(uuid.uuid4())
        file_ext = file.filename.split('.')[-1] if '.' in file.filename else 'jpg'
        file_path = f"{upload_dir}/{file_id}.{file_ext}"

        contents = await file.read()
        with open(file_path, "wb") as f:
            f.write(contents)

        extracted_date = extract_date_from_image(file_path)

        return {
            "file_id": file_id,
            "filename": file.filename,
            "path": file_path,
            "size": len(contents),
            "extracted_date": extracted_date,
            "status": "uploaded",
            "message": f"File uploaded successfully. {'Date auto-detected: ' + extracted_date if extracted_date else 'No date detected - you can set it manually.'}"
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Upload error: {str(e)}")

@app.post("/api/ocr/upload-bulk")
async def upload_bulk_newspapers(files: List[UploadFile] = File(...)):
    """Upload multiple newspaper images for batch OCR processing"""
    try:
        if not files:
            raise HTTPException(400, "No files provided")

        upload_dir = "uploads/newspapers"
        os.makedirs(upload_dir, exist_ok=True)

        results = []
        for file in files:
            try:
                if not file.content_type or not file.content_type.startswith('image/'):
                    results.append({
                        "filename": file.filename,
                        "status": "error",
                        "message": "Not an image file"
                    })
                    continue

                file_id = str(uuid.uuid4())
                file_ext = file.filename.split('.')[-1] if '.' in file.filename else 'jpg'
                file_path = f"{upload_dir}/{file_id}.{file_ext}"

                contents = await file.read()
                with open(file_path, "wb") as f:
                    f.write(contents)

                extracted_date = extract_date_from_image(file_path)

                results.append({
                    "file_id": file_id,
                    "filename": file.filename,
                    "path": file_path,
                    "size": len(contents),
                    "extracted_date": extracted_date,
                    "status": "uploaded"
                })
            except Exception as e:
                results.append({
                    "filename": file.filename,
                    "status": "error",
                    "message": str(e)
                })

        successful = sum(1 for r in results if r.get("status") == "uploaded")

        return {
            "total_files": len(files),
            "successful": successful,
            "failed": len(files) - successful,
            "results": results,
            "message": f"Uploaded {successful} of {len(files)} files successfully"
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Bulk upload error: {str(e)}")

@app.post("/api/ocr/process-folder")
def process_local_folder(request: dict):
    """Process all newspaper images from a local folder without uploading"""
    folder_path = request.get('folder_path')

    if not folder_path:
        raise HTTPException(400, "folder_path is required")

    folder_path = os.path.expanduser(folder_path)
    folder_path = os.path.abspath(folder_path)

    print(f"[DEBUG] Attempting to access folder: {folder_path}")

    if not os.path.exists(folder_path):
        raise HTTPException(404, f"Folder not found: {folder_path}. Please check the path and try again.")

    if not os.path.isdir(folder_path):
        raise HTTPException(400, f"Path is not a directory: {folder_path}")

    active_pipeline = _init_pipeline()

    if not active_pipeline:
        raise HTTPException(503, "OCR pipeline not available. Missing dependencies (spaCy, transformers, etc.). Check server logs.")

    image_extensions = {'.jpg', '.jpeg', '.png', '.heic', '.HEIC', '.JPG', '.JPEG', '.PNG'}
    image_files = []

    try:
        for root, dirs, files in os.walk(folder_path):
            for filename in files:
                _, ext = os.path.splitext(filename)
                if ext in image_extensions:
                    file_path = os.path.join(root, filename)
                    relative_path = os.path.relpath(file_path, folder_path)
                    image_files.append((relative_path, file_path))

        image_files.sort(key=lambda x: x[0])
    except Exception as e:
        raise HTTPException(500, f"Error reading folder: {str(e)}")

    if not image_files:
        raise HTTPException(400, f"No image files found in folder (searched recursively): {folder_path}")

    results = []
    for idx, (filename, file_path) in enumerate(image_files, 1):
        try:
            print(f"\n[{idx}/{len(image_files)}] Processing: {filename}")

            extracted_date = extract_date_from_image(file_path)

            parsed_date = None
            if extracted_date:
                try:
                    parsed_date = datetime.strptime(extracted_date, '%Y-%m-%d')
                except:
                    pass

            success = active_pipeline.process_single_newspaper(file_path, publication_date=parsed_date)

            results.append({
                "filename": filename,
                "path": file_path,
                "extracted_date": extracted_date,
                "status": "completed" if success else "failed",
                "message": "OCR processing completed successfully" if success else "OCR processing failed"
            })
            print(f"[OK] {filename}: {'Success' if success else 'Failed'}")
        except Exception as e:
            print(f"[ERROR] {filename}: {str(e)}")
            import traceback
            traceback.print_exc()
            results.append({
                "filename": filename,
                "path": file_path,
                "status": "error",
                "message": str(e)
            })

    successful = sum(1 for r in results if r.get("status") == "completed")

    return {
        "folder_path": folder_path,
        "total_files": len(image_files),
        "successful": successful,
        "failed": len(image_files) - successful,
        "results": results,
        "message": f"Processed {successful} of {len(image_files)} files successfully"
    }

@app.post("/api/ocr/process")
def trigger_ocr_processing(request: dict):
    """Trigger OCR processing for uploaded newspaper using MediaScope pipeline"""
    file_id = request.get('file_id')
    file_path = request.get('file_path')
    publication_date = request.get('publication_date')

    if not file_id and not file_path:
        raise HTTPException(400, "file_id or file_path is required")

    if not file_path:
        upload_dir = "uploads/newspapers"
        for ext in ['jpg', 'jpeg', 'png', 'HEIC', 'heic']:
            potential_path = f"{upload_dir}/{file_id}.{ext}"
            if os.path.exists(potential_path):
                file_path = potential_path
                break

        if not file_path:
            raise HTTPException(404, f"File not found for file_id: {file_id}")

    active_pipeline = _init_pipeline()

    if not active_pipeline:
        raise HTTPException(503, "OCR pipeline not available. Missing dependencies (spaCy, transformers, etc.). Check server logs.")

    parsed_date = None
    if publication_date:
        try:
            parsed_date = datetime.strptime(publication_date, '%Y-%m-%d')
        except:
            pass

    try:
        success = active_pipeline.process_single_newspaper(file_path, publication_date=parsed_date)

        if success:
            return {
                "file_id": file_id,
                "file_path": file_path,
                "status": "completed",
                "message": "OCR processing completed successfully. Articles extracted and stored in database."
            }
        else:
            return {
                "file_id": file_id,
                "file_path": file_path,
                "status": "failed",
                "message": "OCR processing failed. Check server logs for details."
            }
    except Exception as e:
        raise HTTPException(500, f"OCR processing error: {str(e)}")

@app.get("/api/ocr/status/{file_id}")
def get_ocr_status(file_id: str):
    """Get OCR processing status"""
    return {
        "file_id": file_id,
        "status": "processing",
        "progress": 45,
        "message": "Extracting text from newspaper image..."
    }

@app.post("/api/ads/upload")
async def upload_ad_image(file: UploadFile = File(...), metadata: Optional[str] = None):
    """Upload advertisement image for analysis"""
    try:
        if not file.content_type.startswith('image/'):
            raise HTTPException(400, "File must be an image")

        upload_dir = "uploads/ads"
        os.makedirs(upload_dir, exist_ok=True)

        file_id = str(uuid.uuid4())
        file_ext = file.filename.split('.')[-1] if '.' in file.filename else 'jpg'
        file_path = f"{upload_dir}/{file_id}.{file_ext}"

        contents = await file.read()
        with open(file_path, "wb") as f:
            f.write(contents)

        try:
            with get_db_cursor() as cur:
                cur.execute("""
                    INSERT INTO ad_images (id, filename, file_path, upload_date, file_size)
                    VALUES (%s, %s, %s, %s, %s)
                    RETURNING id
                """, (file_id, file.filename, file_path, datetime.now(), len(contents)))

                return {
                    "file_id": file_id,
                    "filename": file.filename,
                    "path": file_path,
                    "size": len(contents),
                    "status": "uploaded",
                    "message": "Advertisement uploaded successfully"
                }
        except Exception:
            return {
                "file_id": file_id,
                "filename": file.filename,
                "path": file_path,
                "size": len(contents),
                "status": "uploaded",
                "message": "Advertisement uploaded (DB table not configured)"
            }
    except Exception as e:
        raise HTTPException(500, f"Upload error: {str(e)}")

@app.post("/api/ads/analyze")
async def analyze_ad_image(request: dict):
    """Analyze uploaded advertisement image using Gemini Vision API"""
    file_id = request.get('file_id')

    if not file_id:
        raise HTTPException(400, "file_id is required")

    upload_dir = "uploads/ads"
    ad_files = [f for f in os.listdir(upload_dir) if f.startswith(file_id)] if os.path.exists(upload_dir) else []

    if not ad_files:
        raise HTTPException(404, "Advertisement file not found")

    file_path = f"{upload_dir}/{ad_files[0]}"

    try:
        if GEMINI_API_KEY:
            import PIL.Image

            img = PIL.Image.open(file_path)

            prompt = """Analyze this advertisement image in detail. Provide a structured analysis with:

1. **Text Content**: All visible text in the ad (headlines, body copy, slogans)
2. **Brand Information**: Brand names, logos, product names mentioned
3. **Visual Elements**: Colors, imagery, layout, design style
4. **Target Audience**: Demographics, interests, lifestyle indicators
5. **Advertising Strategy**: Message, tone, persuasion techniques
6. **Product Category**: Type of product/service being advertised
7. **Cultural Context**: Any cultural references, themes, or period indicators (1990-1992 era)
8. **Sentiment**: Overall emotional tone (positive, neutral, negative)

Provide your analysis in a clear, structured format."""

            model = genai.GenerativeModel('gemini-1.5-flash')
            response = model.generate_content([prompt, img])

            analysis_text = response.text

            analysis_data = {
                "detected_text": analysis_text,
                "timestamp": datetime.now().isoformat(),
                "model": "gemini-1.5-flash",
                "file_id": file_id,
                "file_path": file_path
            }

        else:
            analysis_data = {
                "detected_text": "No analysis available - Gemini API key not configured",
                "timestamp": datetime.now().isoformat(),
                "file_id": file_id,
                "file_path": file_path,
                "error": "API key not configured"
            }

        json_dir = "uploads/ads/analysis"
        os.makedirs(json_dir, exist_ok=True)
        json_path = f"{json_dir}/{file_id}.json"

        with open(json_path, 'w', encoding='utf-8') as f:
            json.dump(analysis_data, f, indent=2, ensure_ascii=False)

        return {
            "file_id": file_id,
            "analysis": analysis_data,
            "json_path": json_path,
            "status": "completed"
        }

    except Exception as e:
        print(f"Ad analysis error: {str(e)}")
        raise HTTPException(500, f"Analysis failed: {str(e)}")

@app.get("/api/ads/list")
def list_ads(limit: int = 50, offset: int = 0):
    """List uploaded advertisements"""
    limit = min(limit, 200)
    try:
        with get_db_cursor() as cur:
            cur.execute("""
                SELECT id, filename, upload_date, file_size, analysis_status
                FROM ad_images
                ORDER BY upload_date DESC
                LIMIT %s OFFSET %s
            """, (limit, offset))
            ads = cur.fetchall()
            return {"ads": [dict(ad) for ad in ads]}
    except Exception:
        return {"ads": [], "message": "Ad database table not configured"}

@app.get("/api/analytics/sentiment-by-entity")
def sentiment_by_entity(entity_type: Optional[str] = None, limit: int = 20):
    """Get sentiment breakdown for top entities"""
    limit = min(limit, 100)
    try:
        db = get_db()
        entities = db.get_sentiment_by_entity(entity_type=entity_type, limit=limit)
        return {
            "entities": entities,
            "entity_type": entity_type
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Database error: {str(e)}")

@app.get("/api/analytics/entity-cooccurrence")
def entity_cooccurrence(entity_type: Optional[str] = None, min_count: int = 3, limit: int = 50):
    """Get entity pairs that frequently appear together in articles (Firestore version)"""
    limit = min(limit, 200)
    try:
        db = get_db()
        pairs = db.get_entity_cooccurrence(entity_type=entity_type, min_count=min_count, limit=limit)

        return {
            "pairs": pairs,
            "entity_type": entity_type,
            "min_count": min_count
        }
    except Exception as e:
        raise HTTPException(500, f"Database error: {str(e)}")

@app.get("/api/analytics/topic-distribution")
def topic_distribution():
    """Get topic distribution across all articles"""
    try:
        db = get_db()
        topics = db.get_topic_distribution()

        return {
            "topics": topics,
            "total_topics": len(topics)
        }
    except Exception as e:
        raise HTTPException(500, f"Database error: {str(e)}")

@app.get("/api/newspapers/{newspaper_id}/image")
def get_newspaper_image(newspaper_id: str):
    """Get newspaper image URL from Firebase Storage"""
    from fastapi.responses import RedirectResponse

    try:
        db = get_firestore_db()
        newspaper_ref = db.db.collection('newspapers').document(newspaper_id)
        newspaper_doc = newspaper_ref.get()

        if not newspaper_doc.exists:
            raise HTTPException(404, "Newspaper not found")

        newspaper_data = newspaper_doc.to_dict()
        image_url = newspaper_data.get('image_url')

        if not image_url:
            raise HTTPException(404, "No image URL found")

        return RedirectResponse(url=image_url)

    except HTTPException:
        raise
    except Exception as e:
        print(f"Error fetching newspaper image: {e}")
        raise HTTPException(500, f"Failed to fetch image: {str(e)}")

@app.get("/api/newspapers")
def search_newspapers(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    page_number: Optional[int] = None,
    limit: int = 50
):
    """Search newspapers by date and page number (Firestore version)"""
    limit = min(limit, 200)
    try:
        from datetime import datetime as dt

        db = get_firestore_db()

        query = db.db.collection('newspapers')

        if start_date:
            start_dt = dt.fromisoformat(start_date)
            query = query.where('publication_date', '>=', start_dt)

        if end_date:
            end_dt = dt.fromisoformat(end_date)
            query = query.where('publication_date', '<=', end_dt)

        if page_number is not None:
            query = query.where('page_number', '==', page_number)

        newspapers_stream = query.limit(limit).stream()

        newspapers = []
        for doc in newspapers_stream:
            data = doc.to_dict()

            pub_date = data.get('publication_date')
            if hasattr(pub_date, 'isoformat'):
                pub_date_str = pub_date.isoformat()
            else:
                pub_date_str = str(pub_date)

            newspapers.append({
                'id': data.get('id'),
                'publication_date': pub_date_str,
                'page_number': data.get('page_number', 1),
                'section': data.get('section', 'Main'),
                'article_count': data.get('article_count', 0),
                'avg_sentiment': data.get('avg_sentiment', 0.0)
            })

        newspapers.sort(key=lambda x: (x['publication_date'], x['page_number']), reverse=True)

        return {
            "newspapers": newspapers,
            "count": len(newspapers)
        }
    except Exception as e:
        print(f"Error searching newspapers: {e}")
        raise HTTPException(500, f"Database error: {str(e)}")

@app.get("/api/newspapers/{newspaper_id}")
def get_newspaper_page(newspaper_id: str):
    """Get newspaper page with all its articles (Firestore version)"""
    try:
        db = get_db()
        articles_stream = db.db.collection('articles').where('newspaper_id', '==', newspaper_id).stream()

        articles = []
        newspaper_info = None

        for doc in articles_stream:
            data = doc.to_dict()
            articles.append(data)

            if not newspaper_info:
                newspaper_info = {
                    'id': newspaper_id,
                    'publication_date': data.get('publication_date'),
                    'page_number': data.get('page_number', 1),
                    'section': 'Main'
                }

        if not newspaper_info:
            raise HTTPException(404, "Newspaper page not found")

        articles.sort(key=lambda x: x.get('article_number', 0))

        return {
            "newspaper": newspaper_info,
            "articles": articles,
            "article_count": len(articles)
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Database error: {str(e)}")

@app.post("/api/newspapers/{newspaper_id}/summarize")
def summarize_newspaper_page(newspaper_id: str):
    """Generate AI summary for an entire newspaper page"""
    try:
        with get_db_cursor() as cur:
            cur.execute("""
                SELECT publication_date, page_number, section
                FROM newspapers
                WHERE id = %s
            """, (newspaper_id,))

            newspaper = cur.fetchone()
            if not newspaper:
                raise HTTPException(404, "Newspaper page not found")

            cur.execute("""
                SELECT headline, content
                FROM articles
                WHERE newspaper_id = %s
                ORDER BY article_number
            """, (newspaper_id,))

            articles = cur.fetchall()

            if not articles:
                return {
                    "error": "No articles found for this newspaper page"
                }

            page_content = f"Newspaper: Dawn, Date: {newspaper['publication_date']}, Page: {newspaper['page_number']}\n\n"
            for article in articles:
                page_content += f"Headline: {article['headline']}\n{article['content'][:500]}\n\n"

            gemini_api_key = os.getenv("GEMINI_API_KEY")
            if not gemini_api_key:
                raise HTTPException(500, "GEMINI_API_KEY not configured")

            genai.configure(api_key=gemini_api_key)
            model = genai.GenerativeModel('gemini-pro')

            prompt = f"""Provide a comprehensive summary of this newspaper page from {newspaper['publication_date']}.
Include the main topics covered, key events, and important details mentioned across all articles.

{page_content[:5000]}

Summary:"""

            response = model.generate_content(prompt)

            return {
                "newspaper_id": newspaper_id,
                "publication_date": str(newspaper['publication_date']),
                "page_number": newspaper['page_number'],
                "article_count": len(articles),
                "summary": response.text
            }

    except Exception as e:
        print(f"Error generating summary: {e}")
        return {"error": f"Failed to generate summary: {str(e)}"}

@app.patch("/api/newspapers/{newspaper_id}/date")
def update_newspaper_date(newspaper_id: str, new_date: str = Body(..., embed=True)):
    """Update newspaper publication date and propagate to all articles"""
    try:
        from datetime import datetime
        try:
            parsed_date = datetime.fromisoformat(new_date.replace('Z', '+00:00'))
        except:
            for fmt in ['%Y-%m-%d', '%d-%m-%Y', '%m/%d/%Y']:
                try:
                    parsed_date = datetime.strptime(new_date, fmt)
                    break
                except:
                    continue
            else:
                raise HTTPException(400, f"Invalid date format: {new_date}. Use YYYY-MM-DD")

        db = get_firestore_db()

        newspaper_ref = db.db.collection('newspapers').document(newspaper_id)
        newspaper_doc = newspaper_ref.get()

        if not newspaper_doc.exists:
            raise HTTPException(404, "Newspaper not found")

        newspaper_ref.update({
            'publication_date': parsed_date
        })

        articles_query = db.db.collection('articles').where('newspaper_id', '==', newspaper_id).stream()

        updated_count = 0
        for article_doc in articles_query:
            article_doc.reference.update({
                'publication_date': parsed_date
            })
            updated_count += 1

        return {
            "status": "success",
            "newspaper_id": newspaper_id,
            "new_date": parsed_date.strftime('%Y-%m-%d'),
            "articles_updated": updated_count
        }

    except HTTPException:
        raise
    except Exception as e:
        print(f"Error updating newspaper date: {e}")
        raise HTTPException(500, f"Failed to update date: {str(e)}")

@app.get("/api/articles/{article_id}/related")
def get_related_articles(article_id: str, limit: int = 10):
    """Get articles from the same newspaper"""
    limit = min(limit, 50)
    try:
        with get_db_cursor() as cur:
            cur.execute("""
                SELECT newspaper_id FROM articles WHERE id = %s
            """, (article_id,))

            result = cur.fetchone()
            if not result:
                raise HTTPException(404, "Article not found")

            newspaper_id = result['newspaper_id']

            cur.execute("""
                SELECT a.id, a.headline, a.sentiment_label, a.sentiment_score,
                       LEFT(a.content, 150) as content_preview
                FROM articles a
                WHERE a.newspaper_id = %s AND a.id != %s
                ORDER BY a.id
                LIMIT %s
            """, (newspaper_id, article_id, limit))

            articles = cur.fetchall()

            return {
                "related_articles": [dict(a) for a in articles],
                "newspaper_id": newspaper_id,
                "count": len(articles)
            }
    except Exception as e:
        raise HTTPException(500, f"Database error: {str(e)}")

@app.get("/api/articles/{article_id}/full")
def get_article_full(article_id: str):
    """Get complete article details including newspaper image"""
    try:
        db = get_db()
        article = db.get_article(article_id)

        if not article:
            raise HTTPException(404, "Article not found")

        article['entities'] = filter_and_normalize_entities(article.get('entities', []))

        return {"article": article}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Database error: {str(e)}")

@app.post("/api/articles/{article_id}/summary")
def generate_article_summary(article_id: str):
    """Generate AI summary for a specific article using Gemini"""
    try:
        with get_db_cursor() as cur:
            cur.execute("""
                SELECT headline, content FROM articles WHERE id = %s
            """, (article_id,))

            article = cur.fetchone()

            if not article:
                raise HTTPException(404, "Article not found")

            if not GEMINI_API_KEY:
                raise HTTPException(500, "Gemini API key not configured")

            try:
                model = genai.GenerativeModel('gemini-2.0-flash-exp')

                prompt = f"""You are analyzing a historical newspaper article from 1990-1992.

Article Headline: {article['headline']}

Article Content:
{article['content']}

Please provide a concise, professional summary (3-5 sentences) covering:
1. Main topic and key events
2. Key people, organizations, or locations mentioned
3. Historical significance or context
4. Overall tone and perspective

Summary:"""

                response = model.generate_content(prompt)
                summary = response.text.strip()

            except Exception as e:
                summary = f"AI Summary temporarily unavailable. Article discusses: {article['headline']}"
                print(f"Gemini API error: {str(e)}")

            return {
                "article_id": article_id,
                "summary": summary,
                "headline": article['headline']
            }
    except Exception as e:
        raise HTTPException(500, f"Database error: {str(e)}")

@app.post("/api/analytics/ai-summary")
def generate_date_range_summary(request: dict):
    """Generate AI-powered summary for articles in a date range using Gemini"""
    start_date = request.get('start_date', '1990-01-01')
    end_date = request.get('end_date', '1992-12-31')
    topic = request.get('topic')

    try:
        with get_db_cursor() as cur:
            query = """
                SELECT a.headline, a.content, a.sentiment_label, a.topic_label,
                       n.publication_date,
                       COALESCE(json_agg(DISTINCT e.entity_text) FILTER (WHERE e.entity_type IN ('PERSON', 'ORG', 'GPE')), '[]') as key_entities
                FROM articles a
                LEFT JOIN newspapers n ON a.newspaper_id = n.id
                LEFT JOIN entities e ON a.id = e.article_id
                WHERE n.publication_date BETWEEN %s AND %s
            """

            params = [start_date, end_date]

            if topic:
                query += " AND a.topic_label ILIKE %s"
                params.append(f'%{topic}%')

            query += """
                GROUP BY a.id, a.headline, a.content, a.sentiment_label, a.topic_label, n.publication_date
                ORDER BY n.publication_date DESC
                LIMIT 100
            """

            cur.execute(query, params)
            articles = cur.fetchall()

            if not articles:
                return {
                    "error": "No articles found in this date range",
                    "date_range": f"{start_date} to {end_date}",
                    "article_count": 0
                }

            if not GEMINI_API_KEY:
                raise HTTPException(500, "Gemini API key not configured")

            try:
                model = genai.GenerativeModel('gemini-2.0-flash-exp')

                article_count = len(articles)

                all_entities = []
                for article in articles:
                    if article['key_entities'] and article['key_entities'] != '[]':
                        all_entities.extend(article['key_entities'])

                from collections import Counter
                entity_counts = Counter(all_entities)
                top_entities = [entity for entity, count in entity_counts.most_common(10)]

                sentiment_counts = Counter([a['sentiment_label'] for a in articles if a['sentiment_label']])

                sample_headlines = [a['headline'] for a in articles[:20]]

                prompt = f"""You are analyzing {article_count} historical newspaper articles from Pakistan's Dawn newspaper, published between {start_date} and {end_date}.

KEY STATISTICS:
- Total Articles: {article_count}
- Date Range: {start_date} to {end_date}
- Sentiment Distribution: {dict(sentiment_counts)}
- Top Entities: {', '.join(top_entities[:8])}

SAMPLE HEADLINES:
{chr(10).join(['- ' + h for h in sample_headlines[:15]])}

Please provide a comprehensive summary (5-7 paragraphs) covering:

1. **Main Themes & Events**: What were the dominant news topics and major events during this period?

2. **Key Figures & Organizations**: Who were the important people, institutions, and organizations in the news?

3. **Geographic Focus**: Which cities, regions, or countries were prominently featured?

4. **Sentiment & Tone**: What was the overall tone of coverage (based on sentiment analysis)?

5. **Historical Context**: What was happening in Pakistan and globally during this time that influenced the news?

6. **Notable Patterns**: Any interesting trends, recurring themes, or significant patterns in coverage?

Write in a professional, analytical tone suitable for academic or research purposes. Focus on insights that would be valuable for understanding this historical period.

SUMMARY:"""

                response = model.generate_content(prompt)
                summary_text = response.text.strip()

            except Exception as e:
                summary_text = f"AI Summary generation failed. Analyzed {article_count} articles from {start_date} to {end_date}. Top entities include: {', '.join(top_entities[:5])}."
                print(f"Gemini API error: {str(e)}")

            return {
                "date_range": f"{start_date} to {end_date}",
                "article_count": article_count,
                "summary": summary_text,
                "top_entities": top_entities[:8],
                "sentiment_distribution": dict(sentiment_counts)
            }

    except Exception as e:
        raise HTTPException(500, f"Database error: {str(e)}")

@app.post("/api/topics/train")
def train_topic_model():
    """Train BERTopic model on existing articles in Firestore"""
    try:
        _init_pipeline()

        if not PIPELINE_AVAILABLE:
            raise HTTPException(503, "NLP pipeline not available")

        db = get_firestore_db()

        print("Fetching all articles from Firestore...")
        documents = []
        article_ids = []
        article_metadata = []

        batch_size = 1000
        last_doc = None
        total_fetched = 0

        while True:
            if last_doc:
                articles_query = db.db.collection('articles').order_by('__name__').start_after(last_doc).limit(batch_size)
            else:
                articles_query = db.db.collection('articles').order_by('__name__').limit(batch_size)

            batch_docs = list(articles_query.stream())

            if not batch_docs:
                break

            for doc in batch_docs:
                data = doc.to_dict()
                content = data.get('content', '')
                headline = data.get('headline', '')

                combined_text = f"{headline}\n{content}"

                if combined_text.strip():
                    documents.append(combined_text)
                    article_ids.append(data.get('id'))
                    article_metadata.append({
                        'id': data.get('id'),
                        'headline': headline,
                        'publication_date': data.get('publication_date')
                    })

            total_fetched += len(batch_docs)
            print(f"Fetched {total_fetched} articles so far...")

            last_doc = batch_docs[-1]

            if len(batch_docs) < batch_size:
                break

        print(f"Total articles fetched: {len(documents)}")

        if len(documents) < 10:
            raise HTTPException(400, f"Not enough articles for topic modeling. Found {len(documents)}, need at least 10.")

        print(f"Training topic model on {len(documents)} articles...")
        pipeline.nlp_processor.train_topic_model(documents)

        pipeline.nlp_processor.article_metadata = article_metadata

        print("Updating articles with topic assignments...")
        topic_assignments = pipeline.nlp_processor.topic_assignments
        updated_count = 0
        failed_count = 0

        batch_size = 500
        total_articles = len(article_ids)

        for i in range(0, total_articles, batch_size):
            batch = db.db.batch()
            batch_items = 0

            for article_id, topic_id in zip(article_ids[i:i+batch_size], topic_assignments[i:i+batch_size]):
                if article_id:
                    try:
                        article_ref = db.db.collection('articles').document(article_id)
                        batch.update(article_ref, {'topic_id': int(topic_id)})
                        batch_items += 1
                    except Exception as e:
                        print(f"Warning: Failed to add article {article_id} to batch: {e}")
                        failed_count += 1

            try:
                batch.commit()
                updated_count += batch_items
                print(f"  Progress: {updated_count}/{total_articles} articles updated ({100*updated_count//total_articles}%)")
            except Exception as e:
                print(f"Warning: Failed to commit batch: {e}")
                failed_count += batch_items

        print(f"Updated {updated_count} articles with topic assignments ({failed_count} failed)")

        print("Saving topic model to disk...")
        pipeline.nlp_processor.save_topic_model("topic_model")
        print("Topic model saved successfully")

        topic_info = pipeline.nlp_processor.topic_model.get_topic_info()
        topics = []

        for _, row in topic_info.iterrows():
            if row['Topic'] != -1:
                topic_words = pipeline.nlp_processor.topic_model.get_topic(row['Topic'])
                topics.append({
                    'topic_id': int(row['Topic']),
                    'count': int(row['Count']),
                    'keywords': [word for word, _ in topic_words[:5]],
                    'name': row.get('Name', f"Topic {row['Topic']}")
                })

        return {
            "status": "success",
            "message": f"Topic model trained on {len(documents)} articles",
            "topic_count": len(topics),
            "topics": topics
        }

    except Exception as e:
        print(f"Topic training error: {str(e)}")
        raise HTTPException(500, f"Failed to train topic model: {str(e)}")

@app.get("/api/topics")
def get_topics():
    """Get discovered topics from trained model with representative documents"""
    try:
        _init_pipeline()

        if not PIPELINE_AVAILABLE or not pipeline.nlp_processor.topic_model:
            raise HTTPException(400, "Topic model not trained yet. Train it first using POST /api/topics/train")

        topic_info = pipeline.nlp_processor.topic_model.get_topic_info()
        topics = []

        db = get_firestore_db()

        for _, row in topic_info.iterrows():
            if row['Topic'] != -1:
                topic_id = int(row['Topic'])
                topic_words = pipeline.nlp_processor.topic_model.get_topic(topic_id)

                representative_docs = []
                try:
                    articles_query = db.db.collection('articles').where('topic_id', '==', topic_id).limit(5)
                    for doc in articles_query.stream():
                        article = doc.to_dict()
                        representative_docs.append({
                            'headline': article.get('headline', 'No headline'),
                            'id': article.get('id')
                        })
                except Exception as e:
                    print(f"Warning: Failed to get representative docs for topic {topic_id}: {e}")

                top_keywords = [word for word, _ in topic_words[:3]]
                topic_name = ' • '.join([k.title() for k in top_keywords])

                topics.append({
                    'topic_id': topic_id,
                    'count': int(row['Count']),
                    'keywords': [word for word, score in topic_words[:10]],
                    'keyword_scores': [(word, round(float(score), 3)) for word, score in topic_words[:10]],
                    'name': topic_name,
                    'representative_docs': representative_docs
                })

        return {
            "topic_count": len(topics),
            "topics": topics
        }

    except Exception as e:
        print(f"Get topics error: {str(e)}")
        raise HTTPException(500, f"Failed to get topics: {str(e)}")

@app.get("/api/analytics/topic-trends-over-time")
def get_topic_trends_over_time(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    granularity: str = 'month'
):
    """Get topic distribution over time to see how topics evolve"""
    try:
        _init_pipeline()

        if not PIPELINE_AVAILABLE or not pipeline.nlp_processor.topic_model:
            raise HTTPException(400, "Topic model not trained yet")

        from datetime import datetime as dt
        from collections import defaultdict

        db = get_firestore_db()

        articles_query = db.db.collection('articles')

        if start_date:
            start_dt = dt.fromisoformat(start_date)
            articles_query = articles_query.where('publication_date', '>=', start_dt)

        if end_date:
            end_dt = dt.fromisoformat(end_date)
            articles_query = articles_query.where('publication_date', '<=', end_dt)

        articles_stream = articles_query.stream()

        time_topic_counts = defaultdict(lambda: defaultdict(int))

        for article_doc in articles_stream:
            article_data = article_doc.to_dict()
            pub_date = article_data.get('publication_date')
            topic_id = article_data.get('topic_id')

            if not pub_date or topic_id is None or topic_id == -1:
                continue

            if hasattr(pub_date, 'strftime'):
                date_obj = pub_date
            else:
                try:
                    date_obj = dt.fromisoformat(str(pub_date).replace('Z', '+00:00'))
                except:
                    continue

            if granularity == 'year':
                period = date_obj.strftime('%Y')
            elif granularity == 'month':
                period = date_obj.strftime('%Y-%m')
            else:
                period = date_obj.strftime('%Y-%m-%d')

            time_topic_counts[period][topic_id] += 1

        topic_info = pipeline.nlp_processor.topic_model.get_topic_info()
        topic_names = {}
        for _, row in topic_info.iterrows():
            if row['Topic'] != -1:
                topic_words = pipeline.nlp_processor.topic_model.get_topic(row['Topic'])
                top_keywords = [word for word, _ in topic_words[:3]]
                topic_names[int(row['Topic'])] = ' • '.join([k.title() for k in top_keywords])

        periods = sorted(time_topic_counts.keys())
        trends = []

        for period in periods:
            period_data = {
                'period': period,
                'topics': []
            }

            for topic_id, count in time_topic_counts[period].items():
                period_data['topics'].append({
                    'topic_id': topic_id,
                    'topic_name': topic_names.get(topic_id, f'Topic {topic_id}'),
                    'count': count
                })

            period_data['topics'].sort(key=lambda x: x['count'], reverse=True)
            trends.append(period_data)

        return {
            "granularity": granularity,
            "periods": len(periods),
            "trends": trends
        }

    except HTTPException:
        raise
    except Exception as e:
        print(f"Topic trends error: {str(e)}")
        raise HTTPException(500, f"Failed to get topic trends: {str(e)}")

@app.get("/api/analytics/topic-sentiment-over-time")
def get_topic_sentiment_over_time(
    topic_id: Optional[int] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    granularity: str = 'month'
):
    """Get average sentiment for topics over time"""
    try:
        from datetime import datetime as dt
        from collections import defaultdict

        db = get_firestore_db()
        articles_query = db.db.collection('articles')

        if start_date:
            articles_query = articles_query.where('publication_date', '>=', dt.fromisoformat(start_date))
        if end_date:
            articles_query = articles_query.where('publication_date', '<=', dt.fromisoformat(end_date))

        period_topic_sentiments = defaultdict(lambda: defaultdict(list))

        for article_doc in articles_query.stream():
            article = article_doc.to_dict()
            pub_date = article.get('publication_date')
            article_topic_id = article.get('topic_id')
            sentiment_score = article.get('sentiment_score')

            if not pub_date or article_topic_id is None or article_topic_id == -1 or sentiment_score is None:
                continue

            if topic_id is not None and article_topic_id != topic_id:
                continue

            if hasattr(pub_date, 'strftime'):
                date_obj = pub_date
            else:
                try:
                    date_obj = dt.fromisoformat(str(pub_date).replace('Z', '+00:00'))
                except:
                    continue

            if granularity == 'year':
                period = date_obj.strftime('%Y')
            elif granularity == 'month':
                period = date_obj.strftime('%Y-%m')
            else:
                period = date_obj.strftime('%Y-%m-%d')

            period_topic_sentiments[period][article_topic_id].append(sentiment_score)

        trends = []
        for period in sorted(period_topic_sentiments.keys()):
            period_data = {
                'period': period,
                'topics': []
            }

            for t_id, scores in period_topic_sentiments[period].items():
                avg_sentiment = sum(scores) / len(scores) if scores else 0
                period_data['topics'].append({
                    'topic_id': t_id,
                    'avg_sentiment': round(avg_sentiment, 3),
                    'article_count': len(scores)
                })

            trends.append(period_data)

        return {
            "granularity": granularity,
            "topic_id": topic_id,
            "trends": trends
        }

    except Exception as e:
        print(f"Topic sentiment error: {str(e)}")
        raise HTTPException(500, f"Failed to get topic sentiment: {str(e)}")

@app.get("/api/analytics/entity-sentiment-over-time")
def get_entity_sentiment_over_time(
    entity: str,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    granularity: str = 'month'
):
    """Get average sentiment for articles mentioning an entity over time"""
    try:
        from datetime import datetime as dt
        from collections import defaultdict

        db = get_firestore_db()
        articles_query = db.db.collection('articles')

        if start_date:
            articles_query = articles_query.where('publication_date', '>=', dt.fromisoformat(start_date))
        if end_date:
            articles_query = articles_query.where('publication_date', '<=', dt.fromisoformat(end_date))

        period_sentiments = defaultdict(list)

        for article_doc in articles_query.stream():
            article = article_doc.to_dict()
            pub_date = article.get('publication_date')
            sentiment_score = article.get('sentiment_score')
            entities = article.get('entities', [])

            if not pub_date or sentiment_score is None:
                continue

            entity_found = False
            if isinstance(entities, list):
                for ent in entities:
                    if isinstance(ent, dict) and ent.get('text', '').lower() == entity.lower():
                        entity_found = True
                        break

            if not entity_found:
                continue

            if hasattr(pub_date, 'strftime'):
                date_obj = pub_date
            else:
                try:
                    date_obj = dt.fromisoformat(str(pub_date).replace('Z', '+00:00'))
                except:
                    continue

            if granularity == 'year':
                period = date_obj.strftime('%Y')
            elif granularity == 'month':
                period = date_obj.strftime('%Y-%m')
            else:
                period = date_obj.strftime('%Y-%m-%d')

            period_sentiments[period].append(sentiment_score)

        trends = []
        for period in sorted(period_sentiments.keys()):
            scores = period_sentiments[period]
            avg_sentiment = sum(scores) / len(scores) if scores else 0
            trends.append({
                'period': period,
                'avg_sentiment': round(avg_sentiment, 3),
                'article_count': len(scores)
            })

        return {
            "entity": entity,
            "granularity": granularity,
            "trends": trends
        }

    except Exception as e:
        print(f"Entity sentiment error: {str(e)}")
        raise HTTPException(500, f"Failed to get entity sentiment: {str(e)}")

@app.get("/api/analytics/keyword-sentiment-over-time")
def get_keyword_sentiment_over_time(
    keyword: str,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    granularity: str = 'month'
):
    """Get average sentiment for articles containing a keyword over time"""
    try:
        from datetime import datetime as dt
        from collections import defaultdict

        db = get_firestore_db()
        articles_query = db.db.collection('articles')

        if start_date:
            articles_query = articles_query.where('publication_date', '>=', dt.fromisoformat(start_date))
        if end_date:
            articles_query = articles_query.where('publication_date', '<=', dt.fromisoformat(end_date))

        period_sentiments = defaultdict(list)
        keyword_lower = keyword.lower()

        for article_doc in articles_query.stream():
            article = article_doc.to_dict()
            pub_date = article.get('publication_date')
            sentiment_score = article.get('sentiment_score')
            content = article.get('content', '') + ' ' + article.get('headline', '')

            if not pub_date or sentiment_score is None:
                continue

            if keyword_lower not in content.lower():
                continue

            if hasattr(pub_date, 'strftime'):
                date_obj = pub_date
            else:
                try:
                    date_obj = dt.fromisoformat(str(pub_date).replace('Z', '+00:00'))
                except:
                    continue

            if granularity == 'year':
                period = date_obj.strftime('%Y')
            elif granularity == 'month':
                period = date_obj.strftime('%Y-%m')
            else:
                period = date_obj.strftime('%Y-%m-%d')

            period_sentiments[period].append(sentiment_score)

        trends = []
        for period in sorted(period_sentiments.keys()):
            scores = period_sentiments[period]
            avg_sentiment = sum(scores) / len(scores) if scores else 0
            trends.append({
                'period': period,
                'avg_sentiment': round(avg_sentiment, 3),
                'article_count': len(scores)
            })

        return {
            "keyword": keyword,
            "granularity": granularity,
            "trends": trends
        }

    except Exception as e:
        print(f"Keyword sentiment error: {str(e)}")
        raise HTTPException(500, f"Failed to get keyword sentiment: {str(e)}")

@app.get("/api/analytics/keyword-frequency-over-time")
def get_keyword_frequency_over_time(
    keyword: str,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    granularity: str = 'month'
):
    """Get keyword mention frequency over time"""
    try:
        db = get_firestore_db()
        data = db.get_keyword_frequency_over_time(keyword, start_date, end_date, granularity)
        return {"keyword": keyword, "data": data}
    except Exception as e:
        print(f"Keyword frequency over time error: {str(e)}")
        raise HTTPException(500, f"Failed to get keyword frequency: {str(e)}")

@app.get("/api/analytics/entity-mentions-over-time")
def get_entity_mentions_over_time(
    entity: str,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    granularity: str = 'month'
):
    """Get entity mention frequency over time with sentiment"""
    try:
        db = get_firestore_db()
        data = db.get_entity_mentions_over_time(entity, start_date, end_date, granularity)
        return {"entity": entity, "data": data}
    except Exception as e:
        print(f"Entity mentions over time error: {str(e)}")
        raise HTTPException(500, f"Failed to get entity mentions: {str(e)}")

@app.get("/api/analytics/compare-entities")
def compare_entities(
    entities: str,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None
):
    """Compare multiple entities across various metrics"""
    try:
        db = get_firestore_db()
        entity_list = [e.strip() for e in entities.split(',')]
        if len(entity_list) > 5:
            raise HTTPException(400, "Maximum 5 entities allowed for comparison")
        data = db.compare_entities(entity_list, start_date, end_date)
        return {"entities": entity_list, "comparison": data}
    except HTTPException:
        raise
    except Exception as e:
        print(f"Entity comparison error: {str(e)}")
        raise HTTPException(500, f"Failed to compare entities: {str(e)}")

@app.get("/api/analytics/topic-volume-over-time")
def get_topic_volume_over_time(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    granularity: str = 'month'
):
    """Get topic distribution over time"""
    try:
        db = get_firestore_db()
        data = db.get_topic_volume_over_time(start_date, end_date, granularity)
        return {"data": data}
    except Exception as e:
        print(f"Topic volume over time error: {str(e)}")
        raise HTTPException(500, f"Failed to get topic volume: {str(e)}")

@app.get("/api/analytics/location-analytics")
def get_location_analytics(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None
):
    """Get geographic analytics"""
    try:
        db = get_firestore_db()
        data = db.get_location_analytics(start_date, end_date)
        return data
    except Exception as e:
        print(f"Location analytics error: {str(e)}")
        raise HTTPException(500, f"Failed to get location analytics: {str(e)}")

@app.get("/api/analytics/entity-cooccurrence")
def get_entity_cooccurrence(
    entity_type: Optional[str] = None,
    min_count: int = 3,
    limit: int = 50
):
    """Get entity pairs that frequently appear together"""
    try:
        db = get_firestore_db()
        data = db.get_entity_cooccurrence(entity_type, min_count, limit)
        return {"cooccurrences": data}
    except Exception as e:
        print(f"Entity co-occurrence error: {str(e)}")
        raise HTTPException(500, f"Failed to get entity co-occurrence: {str(e)}")

@app.get("/api/analytics/topic-distribution")
def get_topic_distribution():
    """Get topic distribution across all articles"""
    try:
        db = get_firestore_db()
        data = db.get_topic_distribution()
        return {"topics": data}
    except Exception as e:
        print(f"Topic distribution error: {str(e)}")
        raise HTTPException(500, f"Failed to get topic distribution: {str(e)}")

@app.get("/")
def root():
    return {"message": "MediaScope API", "version": "2.0"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
