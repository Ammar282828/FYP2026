"""
Newspaper and OCR-related API routes
"""

from fastapi import APIRouter, UploadFile, File, Body, HTTPException
from fastapi.responses import RedirectResponse
from typing import List, Optional
import os
import uuid
from datetime import datetime
from database.firestore_db import get_firestore_db
from utils.filters import extract_date_from_image


router = APIRouter(prefix="/api", tags=["newspapers", "ocr"])

_pipeline = None


def _init_pipeline():
    global _pipeline

    if _pipeline is not None:
        return _pipeline

    try:
        from services.pipeline import MediaScopePipeline, Config
        config = Config()
        _pipeline = MediaScopePipeline(config)
        _pipeline.initialize()
        print("[OK] MediaScope OCR Pipeline initialized")
        return _pipeline
    except Exception as e:
        print(f"[WARNING] Pipeline initialization failed: {e}")
        return None


@router.post("/ocr/upload")
async def upload_newspaper_for_ocr(file: UploadFile = File(...)):
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


# uploads multiple newspaper images at once
@router.post("/ocr/upload-bulk")
async def upload_bulk_newspapers(files: List[UploadFile] = File(...)):
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


# processes all images from a folder on the server
@router.post("/ocr/process-folder")
def process_local_folder(request: dict):
    folder_path = request.get('folder_path')

    if not folder_path:
        raise HTTPException(400, "folder_path is required")

    folder_path = os.path.expanduser(folder_path)
    folder_path = os.path.abspath(folder_path)

    if not os.path.exists(folder_path):
        raise HTTPException(404, f"Folder not found: {folder_path}")

    if not os.path.isdir(folder_path):
        raise HTTPException(400, f"Path is not a directory: {folder_path}")

    active_pipeline = _init_pipeline()

    if not active_pipeline:
        raise HTTPException(503, "OCR pipeline not available")

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
        raise HTTPException(400, f"No image files found in folder: {folder_path}")

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
                "status": "completed" if success else "failed"
            })
        except Exception as e:
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
        "results": results
    }


# runs OCR processing on an uploaded newspaper
@router.post("/ocr/process")
def trigger_ocr_processing(request: dict):
    """
    Process a single uploaded newspaper image.

    Uses the SAME lightweight pipeline as /tmp/bulk_ingest.py: ImageProcessor
    for OCR + ad detection, services.sentiment_gemini for sentiment, and
    services.topics_gemini for topic classification. The legacy
    MediaScopePipeline path needed torch + spaCy for entity extraction;
    this path delegates everything to Gemini and matches what the running
    bulk-ingest workers produce, so single-page uploads land with the same
    article schema as the corpus.
    """
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

    parsed_date = None
    if publication_date:
        try:
            parsed_date = datetime.strptime(publication_date, '%Y-%m-%d')
        except Exception:
            pass

    try:
        from services.pipeline import Config, ImageProcessor, MediaScopeDatabase
        from services.sentiment_gemini import analyze_sentiment_gemini
        from services.topics_gemini import classify_topics_batch_gemini
        from PIL import Image
        import uuid as _uuid
        from concurrent.futures import ThreadPoolExecutor

        config = Config()
        ip = ImageProcessor(config)
        db = MediaScopeDatabase(config)
        db.connect()
        api_key = (config.GEMINI_API_KEYS[0] if config.GEMINI_API_KEYS else config.GEMINI_API_KEY) or ''

        raw = Image.open(file_path)
        page_img = ip.enhance_image(raw)

        # Metadata first — date + page from the masthead. If the user
        # provided a publication_date in the request, it overrides what
        # OCR finds (manual entry is more trustworthy than masthead OCR
        # on a single-page upload).
        meta = ip.extract_metadata(file_path, prepared_image=page_img)
        pub_date = parsed_date or meta.get('date')
        page_num = meta.get('page')

        # Detect ads + extract articles in parallel — same fan-out as
        # bulk_ingest.process_one. 600s/1200s timeouts mirror the
        # production limits so a dense classifieds page can finish.
        with ThreadPoolExecutor(max_workers=2, thread_name_prefix='page') as ex:
            f_ads = ex.submit(ip.detect_ads, page_img)
            f_arts = ex.submit(ip.extract_articles, file_path, page_img)
            ads = f_ads.result(timeout=600)
            articles = f_arts.result(timeout=1200)

        newspaper_id = db.insert_newspaper(
            pub_date=pub_date, page_num=page_num,
            section='Main', image_path=file_path,
        )

        n_ads = 0
        if ads:
            with ThreadPoolExecutor(max_workers=min(4, len(ads))) as ex:
                analyses = list(ex.map(ip.analyze_ad_image, (a['image'] for a in ads)))
            for ad, an in zip(ads, analyses):
                ad['publication_date'] = pub_date
                ad['page_number'] = page_num
                ad['deep_analysis'] = an
                if db.insert_ad(newspaper_id, ad):
                    n_ads += 1

        n_articles = 0
        if articles:
            article_texts = [(a.get('headline','') + '\n\n' + a.get('text','')) for a in articles]
            try:
                batch_topics = classify_topics_batch_gemini(article_texts, api_key=api_key)
            except Exception:
                batch_topics = [{} for _ in articles]

            for art, top in zip(articles, batch_topics):
                text_for_sent = (art.get('headline', '') + '\n\n' + art.get('text', ''))[:4000]
                try:
                    sent = analyze_sentiment_gemini(text_for_sent, api_key=api_key)
                except Exception:
                    sent = {'label': 'neutral', 'score': 0.0, 'confidence': 0.0}

                article_data = {
                    'id': str(_uuid.uuid4()),
                    'newspaper_id': newspaper_id,
                    'article_number': art.get('number'),
                    'headline': art.get('headline', '')[:500],
                    'content': art.get('text', ''),
                    'word_count': art.get('word_count', 0),
                    'bounding_box': None,
                    'sentiment_score': sent.get('score', 0.0),
                    'sentiment_label': sent.get('label', 'neutral'),
                    'sentiment_method': 'gemini',
                    'sentiment_confidence': sent.get('confidence'),
                    'topic_id': top.get('topic_id'),
                    'topic_label': top.get('topic_label'),
                    'topic_method': 'gemini-curated',
                    'topic_confidence': top.get('confidence'),
                    'publication_date': pub_date,
                    'page_number': page_num,
                    'created_at': datetime.utcnow(),
                }
                # MediaScopeDatabase wraps FirestoreDB; the raw firestore
                # client is two levels deep (db.db = FirestoreDB,
                # db.db.db = google client). Mirrors bulk_ingest's `fs`.
                db.db.db.collection('articles').document(article_data['id']).set(article_data)
                n_articles += 1

        return {
            "file_id": file_id,
            "file_path": file_path,
            "newspaper_id": newspaper_id,
            "publication_date": pub_date.isoformat() if pub_date and hasattr(pub_date, 'isoformat') else None,
            "page_number": page_num,
            "articles": n_articles,
            "ads": n_ads,
            "status": "completed",
            "message": f"OCR completed: {n_articles} articles, {n_ads} ads",
        }
    except Exception as e:
        import traceback as _tb
        print(f"[OCR /process] error: {e}\n{_tb.format_exc()}", flush=True)
        raise HTTPException(500, f"OCR processing error: {str(e)}")


# redirects to the newspaper image URL
@router.get("/newspapers/{newspaper_id}/image")
def get_newspaper_image(newspaper_id: str):
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
        raise HTTPException(500, f"Failed to fetch image: {str(e)}")


# gets a list of all newspapers that have been uploaded
@router.get("/newspapers")
def search_newspapers(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    page_number: Optional[int] = None,
    limit: int = 50
):
    """Search newspapers by date and page number"""
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
        raise HTTPException(500, f"Database error: {str(e)}")


# gets one specific newspaper and its articles by id
@router.post("/newspapers/{newspaper_id}/summarize")
def summarize_newspaper_page(newspaper_id: str):
    """Generate an AI summary of all articles on this newspaper page."""
    try:
        from services.gemini_adapter import create_model as _create_gemini_model
    except ImportError:
        raise HTTPException(500, "Gemini adapter not available")

    gemini_key = os.getenv("GEMINI_API_KEY")
    if not gemini_key:
        raise HTTPException(500, "GEMINI_API_KEY not configured")

    try:
        db = get_firestore_db()
        articles_stream = db.db.collection('articles').where('newspaper_id', '==', newspaper_id).stream()
        articles = [doc.to_dict() for doc in articles_stream]

        if not articles:
            raise HTTPException(404, "No articles found for this newspaper page")

        articles.sort(key=lambda x: x.get('article_number', 0))

        pub_date = articles[0].get('publication_date', '')
        if hasattr(pub_date, 'strftime'):
            date_str = pub_date.strftime('%B %d, %Y')
        else:
            date_str = str(pub_date)[:10]

        blocks = []
        for i, a in enumerate(articles[:25], 1):
            headline = (a.get('headline') or 'Untitled').strip()
            excerpt = (a.get('content') or '')[:600].strip()
            blocks.append(f"Article {i}: {headline}\n{excerpt}")

        prompt = f"""You are a historian analyzing a page of the Dawn newspaper from {date_str}.

Below are {len(articles)} articles from a single newspaper page. Write a concise summary (4-6 sentences) that captures:
- The main themes covered on this page
- The most significant events or announcements
- The overall tone of the coverage
- Any notable people, places, or institutions mentioned repeatedly

ARTICLES:

{chr(10).join(blocks)}

Write in clear, flowing prose. Do not use bullet points.

Summary:"""

        model = _create_gemini_model(gemini_key, 'gemini-2.5-flash')
        response = model.generate_content(prompt)
        summary = response.text.strip()

        return {
            "newspaper_id": newspaper_id,
            "summary": summary,
            "article_count": len(articles),
            "model": "gemini-2.5-flash",
        }
    except HTTPException:
        raise
    except Exception as e:
        return {"error": str(e), "newspaper_id": newspaper_id}


@router.get("/newspapers/{newspaper_id}")
def get_newspaper_page(newspaper_id: str):
    try:
        db = get_firestore_db()
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


# updates the publication date of a newspaper
@router.patch("/newspapers/{newspaper_id}/date")
def update_newspaper_date(newspaper_id: str, new_date: str = Body(..., embed=True)):
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
                raise HTTPException(400, f"Invalid date format: {new_date}")

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
        raise HTTPException(500, f"Failed to update date: {str(e)}")


@router.delete("/newspapers/{newspaper_id}")
def delete_newspaper(newspaper_id: str, delete_articles: bool = True):
    """
    Delete a newspaper and optionally its associated articles.
    
    Query params:
        delete_articles: If true (default), also delete all articles from this newspaper
    """
    try:
        db = get_firestore_db()
        
        # Check if newspaper exists
        newspaper_ref = db.db.collection('newspapers').document(newspaper_id)
        newspaper_doc = newspaper_ref.get()
        
        if not newspaper_doc.exists:
            raise HTTPException(404, "Newspaper not found")
        
        # Count articles before deletion
        articles_query = db.db.collection('articles').where('newspaper_id', '==', newspaper_id).stream()
        article_count = len(list(articles_query))
        
        # Delete the newspaper (and articles if specified)
        success = db.delete_newspaper(newspaper_id, delete_articles=delete_articles)
        
        if success:
            return {
                "success": True,
                "message": f"Newspaper {newspaper_id} deleted successfully",
                "newspaper_id": newspaper_id,
                "articles_deleted": article_count if delete_articles else 0
            }
        else:
            raise HTTPException(500, "Failed to delete newspaper")
            
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Failed to delete newspaper: {str(e)}")

