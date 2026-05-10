"""
Advertisement image analysis routes
"""

from fastapi import APIRouter, UploadFile, File, HTTPException
from typing import Optional, List
import os
import uuid
import time
import threading
from datetime import datetime
import json
import requests
import re
from database.firestore_db import get_firestore_db


# Process-local cache for the analytics summary. The endpoint streams
# the entire ads collection (~2.5k docs with heavy `analysis` blobs),
# which costs ~12s end-to-end. Most users hit the page repeatedly while
# scrolling around — a 5-minute cache cuts that to <50ms after the
# first load. Invalidates implicitly on TTL; ingest writes don't push
# updates because freshness within a 5-minute window doesn't matter for
# this dashboard.
_ADS_SUMMARY_CACHE_TTL = 300  # seconds
_ads_summary_cache = {'value': None, 'ts': 0.0}
_ads_summary_lock = threading.Lock()


# Same-pattern cache for the ads-list / ads-browse endpoints, which also
# stream the whole collection. They paginate client-side so the server
# always returns the full set anyway. 60s TTL is enough that a fresh
# load is cheap but new ingests appear within a minute.
_ADS_LIST_CACHE_TTL = 60
_ads_list_cache = {}  # keyed by query signature
_ads_list_lock = threading.Lock()

try:
    import google.generativeai as genai
    from PIL import Image
    GENAI_AVAILABLE = True
except ImportError as e:
    genai = None
    Image = None
    GENAI_AVAILABLE = False
    print(f"Warning: Google Generative AI or PIL not available: {e}")

try:
    from services.gemini_adapter import create_model as _create_gemini_model
except ImportError:
    _create_gemini_model = None

router = APIRouter(prefix="/api/ads", tags=["ads"])

# ── Crop-quality helpers ─────────────────────────────────────────────────────
MIN_CROP_PX = 60        # minimum width/height in pixels
MAX_AREA_FRACTION = 0.70 # skip regions covering > 70 % of the page
MIN_ASPECT_RATIO = 0.15  # skip extreme slivers (width/height or height/width)
CROP_PAD_FRACTION = 0.02 # 2 % padding added around each detected region


def _validate_and_pad_crop(left_pct, top_pct, width_pct, height_pct, img_w, img_h):
    """Convert percentage coordinates to clamped pixel coords with padding.

    Returns (left, top, right, bottom) in pixels, or None if the region
    should be skipped (too small, too large, or degenerate aspect ratio).
    """
    # Add small padding so crops aren't excessively tight
    pad_w = img_w * CROP_PAD_FRACTION
    pad_h = img_h * CROP_PAD_FRACTION

    left = int((left_pct / 100) * img_w - pad_w)
    top = int((top_pct / 100) * img_h - pad_h)
    right = int(((left_pct + width_pct) / 100) * img_w + pad_w)
    bottom = int(((top_pct + height_pct) / 100) * img_h + pad_h)

    # Clamp to image bounds
    left = max(0, left)
    top = max(0, top)
    right = min(img_w, right)
    bottom = min(img_h, bottom)

    crop_w = right - left
    crop_h = bottom - top

    # Skip tiny crops
    if crop_w < MIN_CROP_PX or crop_h < MIN_CROP_PX:
        return None

    # Skip crops covering most of the page
    if (crop_w * crop_h) / (img_w * img_h) > MAX_AREA_FRACTION:
        return None

    # Skip degenerate aspect ratios (extreme slivers)
    aspect = min(crop_w, crop_h) / max(crop_w, crop_h)
    if aspect < MIN_ASPECT_RATIO:
        return None

    return left, top, right, bottom


@router.post("/upload")
async def upload_ad_image(file: UploadFile = File(...)):
    # uploads an advertisement image for analysis
    try:
        if not file.content_type or not file.content_type.startswith('image/'):
            raise HTTPException(400, "File must be an image")

        upload_dir = "uploads/ads"
        os.makedirs(upload_dir, exist_ok=True)

        file_id = str(uuid.uuid4())
        file_ext = file.filename.split('.')[-1] if '.' in file.filename else 'jpg'
        file_path = f"{upload_dir}/{file_id}.{file_ext}"

        contents = await file.read()
        with open(file_path, "wb") as f:
            f.write(contents)

        return {
            "file_id": file_id,
            "filename": file.filename,
            "path": file_path,
            "size": len(contents),
            "status": "uploaded",
            "message": "Advertisement uploaded successfully"
        }
    except Exception as e:
        raise HTTPException(500, f"Upload error: {str(e)}")


@router.post("/analyze")
async def analyze_ad_image(request: dict):
    # analyzes an uploaded ad image using gemini AI
    # extracts text, identifies brand, describes visuals, etc
    file_id = request.get('file_id')

    if not file_id:
        raise HTTPException(400, "file_id is required")

    upload_dir = "uploads/ads"
    if not os.path.exists(upload_dir):
        raise HTTPException(404, "Upload directory not found")

    ad_files = [f for f in os.listdir(upload_dir) if f.startswith(file_id)]

    if not ad_files:
        raise HTTPException(404, "Advertisement file not found")

    file_path = f"{upload_dir}/{ad_files[0]}"

    try:
        if not GENAI_AVAILABLE:
            raise HTTPException(500, "Google Generative AI or PIL not installed")

        gemini_key = os.getenv("GEMINI_API_KEY")
        if not gemini_key:
            raise HTTPException(500, "GEMINI_API_KEY not configured")

        # Load and convert image to RGB if needed
        img = Image.open(file_path)
        
        # Use full resolution for better ad analysis
        print(f"Processing ad image at full resolution: {img.size[0]}x{img.size[1]}")

        # Convert MPO or other unsupported formats to JPEG
        if img.format in ['MPO', 'WEBP'] or img.mode not in ['RGB', 'RGBA']:
            # Convert to RGB
            if img.mode == 'RGBA':
                # Create white background for transparent images
                background = Image.new('RGB', img.size, (255, 255, 255))
                background.paste(img, mask=img.split()[3] if len(img.split()) == 4 else None)
                img = background
            elif img.mode != 'RGB':
                img = img.convert('RGB')

            # Save as JPEG
            temp_path = file_path.rsplit('.', 1)[0] + '_converted.jpg'
            img.save(temp_path, 'JPEG', quality=95)
            file_path = temp_path
            img = Image.open(file_path)

        prompt = """Analyze this historical advertisement image in detail. Provide a comprehensive analysis in JSON format.

Return ONLY valid JSON (no markdown, no code blocks) in this exact structure:

{
  "textContent": {
    "headlines": ["list of headlines"],
    "bodyCopy": ["list of body text paragraphs"],
    "brandElements": ["logos, trademarks, brand names"],
    "contactInfo": {"phone": "", "address": "", "other": ""}
  },
  "brand": {
    "name": "Brand name",
    "product": "Product/service being advertised",
    "category": "Product category"
  },
  "visualAnalysis": {
    "colors": ["list of dominant colors"],
    "imagery": "Description of key visual elements",
    "designStyle": "Overall aesthetic",
    "layout": "How elements are arranged"
  },
  "targetAudience": {
    "demographics": "Age, gender, income level, location",
    "psychographics": "Interests, lifestyle, values"
  },
  "advertisingStrategy": {
    "mainMessage": "Core value proposition",
    "emotionalAppeal": "Emotion being evoked",
    "persuasionTechniques": ["list of techniques used"],
    "callToAction": "What action is requested"
  },
  "culturalContext": {
    "timePeriod": "Era (1990-1992)",
    "timePeriodIndicators": ["specific indicators"],
    "culturalReferences": ["cultural themes"]
  },
  "assessment": {
    "sentiment": "Positive/Neutral/Negative",
    "effectiveness": "Assessment of likely impact",
    "keyInsights": ["3-5 most important insights"]
  }
}

Be thorough and specific. Return ONLY the JSON object, nothing else."""

        # Use the adapter so AQ.* (Vertex) keys also work; model name
        # is normalized to a real Vertex/Gemini model.
        model = _create_gemini_model(gemini_key, 'gemini-3.1-pro-preview')

        response = model.generate_content([prompt, img])

        analysis_text = response.text.strip()
        
        # Try to extract JSON from response
        try:
            # Remove markdown code blocks if present
            if '```json' in analysis_text:
                analysis_text = analysis_text.split('```json')[1].split('```')[0].strip()
            elif '```' in analysis_text:
                analysis_text = analysis_text.split('```')[1].split('```')[0].strip()
            
            analysis_json = json.loads(analysis_text)
        except json.JSONDecodeError:
            # Fallback: wrap raw text
            analysis_json = {
                "rawAnalysis": analysis_text,
                "error": "Could not parse structured format"
            }

        analysis_data = {
            "analysis": analysis_json,
            "timestamp": datetime.now().isoformat(),
            "model": "gemini-3.1-pro-preview",
            "file_id": file_id,
            "file_path": file_path
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
        import traceback
        print(f"Ad analysis error: {str(e)}")
        print(traceback.format_exc())
        raise HTTPException(500, f"Analysis failed: {str(e)}")


@router.get("/list")
def list_ads(limit: int = 50, offset: int = 0):
    # lists all uploaded advertisement images
    limit = min(limit, 200)
    try:
        upload_dir = "uploads/ads"
        if not os.path.exists(upload_dir):
            return {"ads": [], "total": 0}

        files = []
        for filename in os.listdir(upload_dir):
            if filename.endswith(('.jpg', '.jpeg', '.png', '.gif')):
                file_path = os.path.join(upload_dir, filename)
                file_id = filename.split('.')[0]

                json_path = f"uploads/ads/analysis/{file_id}.json"
                analysis_status = "analyzed" if os.path.exists(json_path) else "pending"

                files.append({
                    "id": file_id,
                    "filename": filename,
                    "upload_date": datetime.fromtimestamp(os.path.getctime(file_path)).isoformat(),
                    "file_size": os.path.getsize(file_path),
                    "analysis_status": analysis_status
                })

        files.sort(key=lambda x: x['upload_date'], reverse=True)

        total = len(files)
        files = files[offset:offset + limit]

        return {
            "ads": files,
            "total": total,
            "limit": limit,
            "offset": offset
        }
    except Exception as e:
        raise HTTPException(500, f"Error listing ads: {str(e)}")


@router.post("/analyze-newspaper/{newspaper_id}")
async def analyze_newspaper_ads(newspaper_id: str):
    # analyzes all separate advertisement images within a newspaper page
    try:
        import io

        if not GENAI_AVAILABLE:
            raise HTTPException(500, "Google Generative AI or PIL not installed")

        # Get newspaper data from database
        db = get_firestore_db()
        newspaper_ref = db.db.collection('newspapers').document(newspaper_id)
        newspaper_doc = newspaper_ref.get()

        if not newspaper_doc.exists:
            raise HTTPException(404, "Newspaper not found")

        newspaper_data = newspaper_doc.to_dict()
        image_url = newspaper_data.get('image_url')

        if not image_url:
            raise HTTPException(404, "Newspaper has no image URL")

        # Configure Gemini
        gemini_key = os.getenv("GEMINI_API_KEY")
        if not gemini_key:
            raise HTTPException(500, "GEMINI_API_KEY not configured")

        # Download the newspaper image
        response = requests.get(image_url)
        if response.status_code != 200:
            raise HTTPException(500, f"Failed to download image from {image_url}")

        img = Image.open(io.BytesIO(response.content))

        # Convert MPO or other unsupported formats to RGB
        if img.format in ['MPO', 'WEBP'] or img.mode not in ['RGB', 'RGBA']:
            if img.mode == 'RGBA':
                background = Image.new('RGB', img.size, (255, 255, 255))
                background.paste(img, mask=img.split()[3] if len(img.split()) == 4 else None)
                img = background
            elif img.mode != 'RGB':
                img = img.convert('RGB')

        # Step 1: Use Gemini to identify ad locations (Vertex-aware adapter)
        model = _create_gemini_model(gemini_key, 'gemini-3.1-pro-preview')

        detection_prompt = """Analyze this newspaper page and identify ONLY commercial display advertisements.

IMPORTANT — DO NOT include:
- Job listings / employment / recruitment / vacancy notices
- Real estate listings (properties for sale or rent)
- Classified columns (lost & found, personals, matrimonial)
- Tender notices / government procurement notices
- Public announcements / legal notices
- Editorial content or news articles

ONLY identify genuine brand/product/service commercial advertisements — display ads that promote a brand, product, or commercial service with visual design elements (logos, images, styled typography).

For each commercial advertisement found, provide:
1. A brief description of its location (e.g., "top-left corner", "bottom half center", "right side banner")
2. Approximate position as percentages (left%, top%, width%, height%) from 0-100
3. The brand name and product/service being advertised

Format your response as a JSON array:
[
  {
    "id": 1,
    "description": "Car advertisement in top-right",
    "location": "top-right corner",
    "left": 70,
    "top": 5,
    "width": 25,
    "height": 20,
    "identifier": "Toyota car dealership ad",
    "brand": "Toyota",
    "category": "automotive"
  },
  ...
]

If no commercial display advertisements are found, return an empty array: []
Return ONLY the JSON array, no other text."""

        detection_response = model.generate_content([detection_prompt, img])
        detection_text = detection_response.text.strip()

        # Extract JSON from response
        import re
        json_match = re.search(r'\[.*\]', detection_text, re.DOTALL)
        if not json_match:
            return {
                "newspaper_id": newspaper_id,
                "publication_date": newspaper_data.get('publication_date'),
                "total_ads": 0,
                "ads": [],
                "message": "No commercial advertisements detected in this newspaper page"
            }

        ad_regions = json.loads(json_match.group(0))

        if not ad_regions:
            return {
                "newspaper_id": newspaper_id,
                "total_ads": 0,
                "ads": [],
                "message": "No commercial advertisements detected in this newspaper page"
            }

        # Step 2: Crop and analyze each ad region
        analyzed_ads = []
        width, height = img.size
        pub_date = newspaper_data.get('publication_date')
        db = get_firestore_db()

        for ad_region in ad_regions:
            try:
                # Validate and pad crop coordinates
                coords = _validate_and_pad_crop(
                    ad_region['left'], ad_region['top'],
                    ad_region['width'], ad_region['height'],
                    width, height
                )
                if coords is None:
                    print(f"  [SKIP] Ad region {ad_region.get('id', '?')} failed crop validation (too small, too large, or degenerate)")
                    continue
                left, top, right, bottom = coords

                # Crop the ad region
                ad_img = img.crop((left, top, right, bottom))

                # Analyze the cropped ad — structured JSON output
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

                analysis_response = model.generate_content([analysis_prompt, ad_img])
                analysis_raw = analysis_response.text.strip()

                # Parse JSON from response
                try:
                    if '```json' in analysis_raw:
                        analysis_raw = analysis_raw.split('```json')[1].split('```')[0].strip()
                    elif '```' in analysis_raw:
                        analysis_raw = analysis_raw.split('```')[1].split('```')[0].strip()
                    analysis_json = json.loads(analysis_raw)
                except json.JSONDecodeError:
                    analysis_json = {"rawAnalysis": analysis_raw, "parseError": True}

                # Save the cropped ad image
                ad_id = f"{newspaper_id}_ad_{ad_region['id']}"
                ads_dir = "uploads/newspaper_ads"
                os.makedirs(ads_dir, exist_ok=True)

                ad_image_path = f"{ads_dir}/{ad_id}.jpg"
                ad_img.save(ad_image_path, "JPEG")

                # Build the structured record
                analysis_data = {
                    "ad_id": ad_id,
                    "newspaper_id": newspaper_id,
                    "region_id": ad_region['id'],
                    "identifier": ad_region.get('identifier', f"Ad {ad_region['id']}"),
                    "brand": ad_region.get('brand', ''),
                    "category": ad_region.get('category', analysis_json.get('brand', {}).get('category', 'other')),
                    "location": ad_region.get('location', ''),
                    "description": ad_region.get('description', ''),
                    "coordinates": {
                        "left": ad_region['left'],
                        "top": ad_region['top'],
                        "width": ad_region['width'],
                        "height": ad_region['height']
                    },
                    "pixel_coordinates": {
                        "left": left,
                        "top": top,
                        "right": right,
                        "bottom": bottom
                    },
                    "analysis": analysis_json,
                    "image_path": ad_image_path,
                    "publication_date": pub_date.isoformat() if hasattr(pub_date, 'isoformat') else str(pub_date) if pub_date else None,
                    "timestamp": datetime.now().isoformat(),
                    "model": "gemini-3.1-pro-preview"
                }

                # Save to JSON file
                analysis_json_dir = "uploads/newspaper_ads/analysis"
                os.makedirs(analysis_json_dir, exist_ok=True)
                json_path = f"{analysis_json_dir}/{ad_id}.json"
                with open(json_path, 'w', encoding='utf-8') as f:
                    json.dump(analysis_data, f, indent=2, ensure_ascii=False)

                # Save to Firestore advertisements collection
                try:
                    firestore_doc = {
                        **analysis_data,
                        "publication_date": pub_date,
                        "created_at": datetime.now(),
                    }
                    db.db.collection('advertisements').document(ad_id).set(firestore_doc)
                except Exception as fs_err:
                    print(f"Firestore save failed for {ad_id}: {fs_err}")

                analyzed_ads.append(analysis_data)

            except Exception as e:
                print(f"Error analyzing ad region {ad_region['id']}: {str(e)}")
                analyzed_ads.append({
                    "ad_id": f"{newspaper_id}_ad_{ad_region['id']}",
                    "region_id": ad_region['id'],
                    "identifier": ad_region.get('identifier', f"Ad {ad_region['id']}"),
                    "error": str(e),
                    "status": "failed"
                })

        return {
            "newspaper_id": newspaper_id,
            "publication_date": pub_date.isoformat() if hasattr(pub_date, 'isoformat') else str(pub_date) if pub_date else None,
            "total_ads": len(analyzed_ads),
            "successful": sum(1 for ad in analyzed_ads if "error" not in ad),
            "failed": sum(1 for ad in analyzed_ads if "error" in ad),
            "ads": analyzed_ads,
            "message": f"Analyzed {len(analyzed_ads)} commercial advertisements from newspaper"
        }

    except HTTPException:
        raise
    except Exception as e:
        import traceback
        print(f"Newspaper ad analysis error: {str(e)}")
        print(traceback.format_exc())
        raise HTTPException(500, f"Analysis failed: {str(e)}")


@router.get("/newspaper/{newspaper_id}")
def get_newspaper_ads(newspaper_id: str):
    # retrieves all analyzed ads for a specific newspaper
    try:
        analysis_dir = "uploads/newspaper_ads/analysis"
        if not os.path.exists(analysis_dir):
            return {
                "newspaper_id": newspaper_id,
                "ads": [],
                "total": 0,
                "message": "No ads analyzed for this newspaper yet"
            }

        # Find all analysis files for this newspaper
        prefix = f"{newspaper_id}_ad_"
        ad_files = [f for f in os.listdir(analysis_dir) if f.startswith(prefix) and f.endswith('.json')]

        if not ad_files:
            return {
                "newspaper_id": newspaper_id,
                "ads": [],
                "total": 0,
                "message": "No ads analyzed for this newspaper yet"
            }

        ads = []
        for filename in ad_files:
            file_path = os.path.join(analysis_dir, filename)
            try:
                with open(file_path, 'r', encoding='utf-8') as f:
                    ad_data = json.load(f)
                    ads.append(ad_data)
            except Exception as e:
                print(f"Error reading {filename}: {str(e)}")

        # Sort by region_id
        ads.sort(key=lambda x: x.get('region_id', 0))

        return {
            "newspaper_id": newspaper_id,
            "ads": ads,
            "total": len(ads)
        }

    except Exception as e:
        raise HTTPException(500, f"Error retrieving newspaper ads: {str(e)}")


@router.post("/analyze-image")
async def analyze_image_ads(request: dict):
    # analyzes all advertisement regions in a newspaper image from file path
    file_path = request.get('file_path')
    newspaper_id = request.get('newspaper_id', f"local_{uuid.uuid4()}")

    if not file_path:
        raise HTTPException(400, "file_path is required")

    if not os.path.exists(file_path):
        raise HTTPException(404, f"Image file not found: {file_path}")

    try:
        if not GENAI_AVAILABLE:
            raise HTTPException(500, "Google Generative AI or PIL not installed")

        # Configure Gemini
        gemini_key = os.getenv("GEMINI_API_KEY")
        if not gemini_key:
            raise HTTPException(500, "GEMINI_API_KEY not configured")

        genai.configure(api_key=gemini_key)

        # Load the image
        img = Image.open(file_path)

        # Convert MPO or other unsupported formats to RGB
        if img.format in ['MPO', 'WEBP'] or img.mode not in ['RGB', 'RGBA']:
            if img.mode == 'RGBA':
                background = Image.new('RGB', img.size, (255, 255, 255))
                background.paste(img, mask=img.split()[3] if len(img.split()) == 4 else None)
                img = background
            elif img.mode != 'RGB':
                img = img.convert('RGB')

        # Step 1: Use Gemini to identify ad locations (Vertex-aware adapter)
        model = _create_gemini_model(gemini_key, 'gemini-3.1-pro-preview')

        detection_prompt = """Analyze this newspaper page and identify ONLY commercial display advertisements.

IMPORTANT — DO NOT include:
- Job listings / employment / recruitment / vacancy notices
- Real estate listings (properties for sale or rent)
- Classified columns (lost & found, personals, matrimonial)
- Tender notices / government procurement notices
- Public announcements / legal notices
- Editorial content or news articles

ONLY identify genuine brand/product/service commercial advertisements — display ads that promote a brand, product, or commercial service with visual design elements (logos, images, styled typography).

For each commercial advertisement found, provide:
1. A brief description of its location (e.g., "top-left corner", "bottom half center", "right side banner")
2. Approximate position as percentages (left%, top%, width%, height%) from 0-100
3. The brand name and product/service being advertised

Format your response as a JSON array:
[
  {
    "id": 1,
    "description": "Car advertisement in top-right",
    "location": "top-right corner",
    "left": 70,
    "top": 5,
    "width": 25,
    "height": 20,
    "identifier": "Toyota car dealership ad",
    "brand": "Toyota",
    "category": "automotive"
  },
  ...
]

If no commercial display advertisements are found, return an empty array: []
Return ONLY the JSON array, no other text."""

        detection_response = model.generate_content([detection_prompt, img])
        detection_text = detection_response.text.strip()

        # Extract JSON from response
        import re
        json_match = re.search(r'\[.*\]', detection_text, re.DOTALL)
        if not json_match:
            return {
                "file_path": file_path,
                "newspaper_id": newspaper_id,
                "total_ads": 0,
                "ads": [],
                "message": "No commercial advertisements detected in this image"
            }

        ad_regions = json.loads(json_match.group(0))

        if not ad_regions:
            return {
                "file_path": file_path,
                "newspaper_id": newspaper_id,
                "total_ads": 0,
                "ads": [],
                "message": "No commercial advertisements detected in this image"
            }

        # Step 2: Crop and analyze each ad region
        analyzed_ads = []
        width, height = img.size
        db = get_firestore_db()

        # Try to get publication date from newspaper doc if newspaper_id is not a local UUID
        pub_date = None
        if not newspaper_id.startswith('local_'):
            try:
                np_ref = db.db.collection('newspapers').document(newspaper_id).get()
                if np_ref.exists:
                    pub_date = np_ref.to_dict().get('publication_date')
            except Exception:
                pass

        for ad_region in ad_regions:
            try:
                # Validate and pad crop coordinates
                coords = _validate_and_pad_crop(
                    ad_region['left'], ad_region['top'],
                    ad_region['width'], ad_region['height'],
                    width, height
                )
                if coords is None:
                    print(f"  [SKIP] Ad region {ad_region.get('id', '?')} failed crop validation (too small, too large, or degenerate)")
                    continue
                left, top, right, bottom = coords

                # Crop the ad region
                ad_img = img.crop((left, top, right, bottom))

                # Analyze the cropped ad — structured JSON output
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

                analysis_response = model.generate_content([analysis_prompt, ad_img])
                analysis_raw = analysis_response.text.strip()

                # Parse JSON from response
                try:
                    if '```json' in analysis_raw:
                        analysis_raw = analysis_raw.split('```json')[1].split('```')[0].strip()
                    elif '```' in analysis_raw:
                        analysis_raw = analysis_raw.split('```')[1].split('```')[0].strip()
                    analysis_json = json.loads(analysis_raw)
                except json.JSONDecodeError:
                    analysis_json = {"rawAnalysis": analysis_raw, "parseError": True}

                # Save the cropped ad image
                ad_id = f"{newspaper_id}_ad_{ad_region['id']}"
                ads_dir = "uploads/newspaper_ads"
                os.makedirs(ads_dir, exist_ok=True)

                ad_image_path = f"{ads_dir}/{ad_id}.jpg"
                ad_img.save(ad_image_path, "JPEG")

                # Build the structured record
                pub_date_str = pub_date.isoformat() if hasattr(pub_date, 'isoformat') else str(pub_date) if pub_date else None
                analysis_data = {
                    "ad_id": ad_id,
                    "newspaper_id": newspaper_id,
                    "source_file": file_path,
                    "region_id": ad_region['id'],
                    "identifier": ad_region.get('identifier', f"Ad {ad_region['id']}"),
                    "brand": ad_region.get('brand', ''),
                    "category": ad_region.get('category', analysis_json.get('brand', {}).get('category', 'other')),
                    "location": ad_region.get('location', ''),
                    "description": ad_region.get('description', ''),
                    "coordinates": {
                        "left": ad_region['left'],
                        "top": ad_region['top'],
                        "width": ad_region['width'],
                        "height": ad_region['height']
                    },
                    "pixel_coordinates": {
                        "left": left,
                        "top": top,
                        "right": right,
                        "bottom": bottom
                    },
                    "analysis": analysis_json,
                    "image_path": ad_image_path,
                    "publication_date": pub_date_str,
                    "timestamp": datetime.now().isoformat(),
                    "model": "gemini-3.1-pro-preview"
                }

                # Save to JSON file
                analysis_json_dir = "uploads/newspaper_ads/analysis"
                os.makedirs(analysis_json_dir, exist_ok=True)
                json_path = f"{analysis_json_dir}/{ad_id}.json"
                with open(json_path, 'w', encoding='utf-8') as f:
                    json.dump(analysis_data, f, indent=2, ensure_ascii=False)

                # Save to Firestore advertisements collection
                try:
                    firestore_doc = {
                        **analysis_data,
                        "publication_date": pub_date,
                        "created_at": datetime.now(),
                    }
                    db.db.collection('advertisements').document(ad_id).set(firestore_doc)
                except Exception as fs_err:
                    print(f"Firestore save failed for {ad_id}: {fs_err}")

                analyzed_ads.append(analysis_data)

            except Exception as e:
                print(f"Error analyzing ad region {ad_region['id']}: {str(e)}")
                analyzed_ads.append({
                    "ad_id": f"{newspaper_id}_ad_{ad_region['id']}",
                    "region_id": ad_region['id'],
                    "identifier": ad_region.get('identifier', f"Ad {ad_region['id']}"),
                    "error": str(e),
                    "status": "failed"
                })

        return {
            "file_path": file_path,
            "newspaper_id": newspaper_id,
            "total_ads": len(analyzed_ads),
            "successful": sum(1 for ad in analyzed_ads if "error" not in ad),
            "failed": sum(1 for ad in analyzed_ads if "error" in ad),
            "ads": analyzed_ads,
            "message": f"Analyzed {len(analyzed_ads)} commercial advertisements from image"
        }

    except HTTPException:
        raise
    except Exception as e:
        import traceback
        print(f"Image ad analysis error: {str(e)}")
        print(traceback.format_exc())
        raise HTTPException(500, f"Analysis failed: {str(e)}")


def _attach_newspaper_image_urls(db, ads: list) -> None:
    """Mutate `ads` in place to add `newspaper_image_url` per ad.

    Many stored ad crops are bad — Gemini's bounding-box detection occasionally
    saves a region that's mostly whitespace with a sliver of text, leaving the
    cached crop visually empty. The frontend can re-derive a clean crop from
    the parent newspaper image + the stored coordinate %s, but it needs the
    parent's image URL to do that.

    Performance history: previously this did one *sequential* Firestore
    `.get()` per unique newspaper_id, which on a 2,000-ad page meant
    ~1,400 round-trips and 600+ seconds wall time (worse than the
    article snapshot scan we paged earlier). Two changes:
      1. Process-local persistent cache so identical ads visiting the
         endpoint reuse newspaper-id lookups across requests, not just
         within one request.
      2. Concurrent fetches via ThreadPoolExecutor — gRPC bear the
         per-call latency just fine in parallel, so 16 workers cut the
         60s cold-cache pull to ~6s.
    """
    ids = sorted({(ad.get('newspaper_id') or '').strip() for ad in ads})
    ids = [i for i in ids if i]
    if not ids:
        return

    # Reuse cross-request lookups so the second visit to /browse is fast
    # even if the per-query cache missed.
    global _NP_IMG_URL_CACHE
    cache = _NP_IMG_URL_CACHE
    missing = [i for i in ids if i not in cache]

    if missing:
        from concurrent.futures import ThreadPoolExecutor
        def _one(nid):
            try:
                snap = db.db.collection('newspapers').document(nid).get()
                return nid, ((snap.to_dict() or {}).get('image_url') or '') if snap.exists else ''
            except Exception:
                return nid, ''
        # 16 workers is a sweet spot for Firestore gRPC: enough parallelism
        # to mask per-call latency, low enough to avoid rate limits.
        with ThreadPoolExecutor(max_workers=16) as ex:
            for nid, url in ex.map(_one, missing):
                cache[nid] = url

        # Bound the cache. Newspaper image URLs never change post-upload,
        # so eviction is purely about memory not freshness — drop the
        # oldest insertions once we pass 10k entries. Without this the
        # cache grows linearly with newspaper-id space (currently ~4k,
        # but no upper limit as ingest continues).
        _MAX_CACHE = 10_000
        if len(cache) > _MAX_CACHE:
            # Trim from the oldest insertions (Python 3.7+ dict ordering
            # preserves insertion order). Pop until we're back at limit.
            for k in list(cache.keys())[: len(cache) - _MAX_CACHE]:
                cache.pop(k, None)

    for ad in ads:
        nid = (ad.get('newspaper_id') or '').strip()
        ad['newspaper_image_url'] = cache.get(nid, '')


# Process-local cache of newspaper_id → image_url. Newspaper image URLs
# never change after upload, so this can grow unbounded without staleness
# concerns. Cap at 10k entries to be safe.
_NP_IMG_URL_CACHE: dict = {}


@router.get("/browse")
def browse_advertisements(
    limit: int = 200,
    offset: int = 0,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    category: Optional[str] = None
):
    """Browse all advertisements with optional filtering.

    Pulls from the in-memory ads cache (refreshed every 5 min) so the
    full 980-ad collection is available without a Firestore round-trip
    per request. `total` is the count AFTER filtering but BEFORE
    pagination, so the UI can show "Found N advertisements" honestly.

    Cap is now 1000 per page (was 200). Asking for `limit=2000` returns
    the whole collection in one shot — small enough for the client.

    A second-tier response cache keyed by query signature avoids
    re-running the filter loop and the per-newspaper image-URL fetch
    on identical repeat requests (the AdBrowser page issues the same
    `limit=2000` query on every navigation back to the tab — without
    this, that hit cost ~13s of newspaper-image lookups).
    """
    cache_key = f'browse:{limit}:{offset}:{start_date}:{end_date}:{category}'
    now_ts = time.time()
    with _ads_list_lock:
        hit = _ads_list_cache.get(cache_key)
        if hit and now_ts - hit['ts'] < _ADS_LIST_CACHE_TTL:
            return hit['value']
    try:
        from datetime import datetime as dt, timezone

        limit = min(max(limit, 1), 2000)
        db = get_firestore_db()

        # Pull from cache; falls back to a fresh stream the first time.
        all_ads = _get_ads_cached(db)

        def _to_naive(d):
            """Strip tz so comparisons work uniformly. Firestore returns
            offset-aware datetimes; date-string filters from the UI parse
            as naive. Mixing them raises TypeError."""
            if d is None:
                return None
            if d.tzinfo is not None:
                d = d.astimezone(timezone.utc).replace(tzinfo=None)
            return d

        # In-memory filters (cheap on lowercase string blobs).
        start_dt = _to_naive(dt.fromisoformat(start_date)) if start_date else None
        end_dt = _to_naive(dt.fromisoformat(end_date)) if end_date else None
        cat_low = (category or '').lower()

        def _within_range(ad):
            pub = ad.get('publication_date')
            if not pub:
                return start_dt is None and end_dt is None
            try:
                pub_dt = dt.fromisoformat(pub) if isinstance(pub, str) else pub
            except Exception:
                return start_dt is None and end_dt is None
            pub_dt = _to_naive(pub_dt)
            if start_dt and pub_dt < start_dt: return False
            if end_dt and pub_dt > end_dt:     return False
            return True

        filtered = [a for a in all_ads if _within_range(a)]
        if cat_low:
            filtered = [a for a in filtered if cat_low in a.get('_search_blob', '')]

        # Sort by publication_date desc.
        filtered.sort(key=lambda a: a.get('publication_date') or '', reverse=True)

        total = len(filtered)
        page = [dict(a) for a in filtered[offset:offset + limit]]
        for a in page:
            a.pop('_search_blob', None)

        # Attach parent newspaper image URLs so the client can render
        # accurate crops from the source image.
        _attach_newspaper_image_urls(db, page)

        result = {
            "ads": page,
            "total": total,           # full filtered count (was: page-only count)
            "shown": len(page),
            "limit": limit,
            "offset": offset,
        }
        with _ads_list_lock:
            _ads_list_cache[cache_key] = {'value': result, 'ts': time.time()}
            # Trim cache: keep only the 24 most recent keys so it doesn't
            # grow unbounded across many filter combinations.
            if len(_ads_list_cache) > 24:
                oldest = sorted(_ads_list_cache.items(), key=lambda kv: kv[1]['ts'])[:len(_ads_list_cache) - 24]
                for k, _ in oldest:
                    _ads_list_cache.pop(k, None)
        return result

    except Exception as e:
        raise HTTPException(500, f"Error browsing ads: {str(e)}")


# In-memory cache of the ads collection. Restreaming Firestore on every
# search request was the dominant latency cost (3000+ ads per call).
# We invalidate after _ADS_CACHE_TTL seconds so freshly-ingested ads
# eventually surface; for an archive that updates slowly this is fine.
_ADS_CACHE: list = []
_ADS_CACHE_AT: float = 0.0
_ADS_CACHE_TTL: float = 300.0  # 5 min


def _flatten_analysis(v) -> str:
    """`analysis` may be a dict (structured Gemini output) or a string.
    Return a flat searchable string regardless."""
    if not v:
        return ''
    if isinstance(v, str):
        return v
    if isinstance(v, dict):
        # Walk one level — dict values may be strings, lists, or nested dicts
        parts = []
        for val in v.values():
            if isinstance(val, str):
                parts.append(val)
            elif isinstance(val, list):
                parts.extend(str(x) for x in val if x)
            elif isinstance(val, dict):
                parts.extend(str(x) for x in val.values() if x)
        return ' '.join(parts)
    return str(v)


def _get_ads_cached(db) -> list:
    """Return all ads as plain dicts, refreshing every TTL seconds.

    Each cached entry has a precomputed `_search_blob` (lowercased
    analysis+identifier+description+brand+category) so per-request
    keyword matching is a cheap substring search.
    """
    import time as _time
    global _ADS_CACHE, _ADS_CACHE_AT
    now = _time.time()
    if _ADS_CACHE and now - _ADS_CACHE_AT < _ADS_CACHE_TTL:
        return _ADS_CACHE
    out = []
    for doc in db.db.collection('advertisements').stream():
        a = doc.to_dict()
        # Read-time filters. Underlying Firestore docs stay for
        # forensic purposes; only the UI-facing path strips them.
        if _is_house_promo(a):           # Dawn/Herald self-promos
            continue
        if _has_illegible_brand(a):      # brand="[ILLEGIBLE]"
            continue
        if not _ad_in_valid_date(a):     # date outside 1990 + Jan-91
            continue
        a['id'] = doc.id
        # Datetime → str (json-safe)
        for k in ('publication_date', 'created_at'):
            v = a.get(k)
            if v is not None and hasattr(v, 'isoformat'):
                a[k] = v.isoformat()
        # Precompute the search corpus
        a['_search_blob'] = ' '.join([
            _flatten_analysis(a.get('analysis')),
            a.get('identifier') or '',
            a.get('description') or '',
            a.get('brand') or '',
            a.get('category') or '',
        ]).lower()
        out.append(a)
    _ADS_CACHE = out
    _ADS_CACHE_AT = now
    return out


def _is_house_promo(ad: dict) -> bool:
    """True if the ad is a Dawn / Herald self-promo and should be hidden.

    Catches partial brand strings ("ST WEEK (Pakistan Herald Publications)",
    "Dawn Group of Newspapers", "Anonymous Company (via Dawn Newspaper P.O.
    Box)") that the earlier exact-match deletion missed.
    """
    brand = (ad.get('brand') or '').lower()
    iden = (ad.get('identifier') or '').lower()
    if not brand and not iden:
        return False
    for token in ('dawn', 'herald'):
        if token in brand:
            return True
        # Identifier is sometimes the only place the masthead leaks in
        # (brand="" + identifier="DAWN SUPPLEMENT NATIONAL DAY").
        if token in iden and len(iden) < 50:
            return True
    return False


# Valid publication-date window for the corpus. Anything outside is
# either an OCR misread or a stray ingested-from-elsewhere doc; we
# hide them from every UI surface.
_VALID_AD_YEAR_MONTHS = {f'1990-{m:02d}' for m in range(1, 13)} | {'1991-01'}


def _ad_in_valid_date(ad: dict) -> bool:
    """Filter out ads whose date is outside the corpus window.

    Catches the 1996/1995 stray bars that polluted the Monthly Ad
    Volume chart — those came from OCR-misread dates that the date
    cleanup deleted from the article corpus but left in `ads`.
    """
    pd = ad.get('publication_date')
    if not pd:
        return False  # no date → can't trust it
    try:
        if hasattr(pd, 'isoformat'):
            ym = pd.isoformat()[:7]
        else:
            ym = str(pd)[:7]
    except Exception:
        return False
    return ym in _VALID_AD_YEAR_MONTHS


# Brand strings that are pure OCR noise when sorted alphabetically the
# user sees these at the top of "Brand A → Z" because [ comes before A.
_ILLEGIBLE_BRAND_RE = re.compile(r'\[\s*(illegible|unreadable|unclear|no\s+visible)', re.I)


def _has_illegible_brand(ad: dict) -> bool:
    brand = (ad.get('brand') or '').strip()
    return bool(_ILLEGIBLE_BRAND_RE.search(brand)) or brand in ('[]', '[ ]', '[—]', '[-]')


def _ad_quality_score(ad: dict) -> int:
    """Quality-aware ranking for ads. Higher = better.

    Boosts ads with the full Gemini analysis pipeline run (analysis,
    identifier, description) over bare image-only records that haven't
    been processed yet. Mirrors article _quality_score in spirit.

    `analysis` may be a dict (structured Gemini output) or a string —
    flatten before measuring length.
    """
    score = 0
    analysis = _flatten_analysis(ad.get('analysis')).strip()
    desc = (ad.get('description') or '').strip() if isinstance(ad.get('description'), str) else _flatten_analysis(ad.get('description')).strip()
    ident_v = ad.get('identifier')
    ident = ident_v.strip() if isinstance(ident_v, str) else ''
    if analysis: score += 25 + min(len(analysis.split()) // 20, 15)  # up to 40
    if desc:     score += 20 + min(len(desc.split()) // 10, 10)      # up to 30
    if ident and len(ident) > 2: score += 15
    if ad.get('topic'):           score += 10
    if ad.get('image_path') or ad.get('crop_url'): score += 10
    if ad.get('publication_date'): score += 8
    if ad.get('page_number'):      score += 4
    return score


@router.post("/search")
def search_advertisements(request: dict):
    # Search advertisements by keyword
    keyword = request.get('keyword', '').strip()
    limit = min(request.get('limit', 50), 200)
    offset = max(request.get('offset', 0), 0)
    sort_by = request.get('sort_by', 'relevance')

    if not keyword:
        raise HTTPException(400, "Keyword is required")

    try:
        db = get_firestore_db()
        # In-memory cache + precomputed search blob — first call may be
        # slow (full collection scan), subsequent calls are millisecond
        # substring filters.
        all_ads = _get_ads_cached(db)
        keyword_lower = keyword.lower()
        # Shallow copy each match so we don't mutate the cache when
        # _attach_newspaper_image_urls writes thumbnails onto it.
        matching_ads = [dict(a) for a in all_ads if keyword_lower in a.get('_search_blob', '')]
        # Drop the internal cache helper field before returning
        for a in matching_ads:
            a.pop('_search_blob', None)

        # Sort: quality-aware default puts fully-analyzed ads first,
        # then breaks ties by publication_date desc.
        if sort_by == 'relevance':
            matching_ads.sort(
                key=lambda a: (_ad_quality_score(a), a.get('publication_date') or ''),
                reverse=True,
            )
        elif sort_by == 'date':
            matching_ads.sort(key=lambda a: a.get('publication_date') or '', reverse=True)

        # Apply pagination
        total = len(matching_ads)
        matching_ads = matching_ads[offset:offset + limit]

        # Same enrichment as /browse — let the client re-crop from source.
        _attach_newspaper_image_urls(db, matching_ads)

        return {
            "ads": matching_ads,
            "total": total,
            "keyword": keyword,
            "limit": limit,
            "offset": offset
        }

    except Exception as e:
        raise HTTPException(500, f"Error searching ads: {str(e)}")


@router.get("/analytics/summary")
def get_ad_analytics():
    """
    Aggregate analytics across all stored advertisements.
    Returns category distribution, brand frequency, sentiment breakdown,
    visual style breakdown, and monthly volume timeline.
    """
    # Cache check first — see _ads_summary_cache comment above.
    now = time.time()
    cached = _ads_summary_cache.get('value')
    if cached is not None and now - _ads_summary_cache.get('ts', 0) < _ADS_SUMMARY_CACHE_TTL:
        return cached
    try:
        db = get_firestore_db()
        # Apply the same UI filters that /browse and /search use, so
        # `total_ads` here matches the count the user sees in the grid.
        # Previously /summary said 2,818 while /browse showed ~1,000;
        # the difference was Dawn/Herald promos + ILLEGIBLE-brand ads
        # + 1996-stray dates being counted in summary but hidden from
        # the grid.
        ads_docs = [
            d for d in db.db.collection('advertisements').stream()
            if not _is_house_promo(d.to_dict() or {})
            and not _has_illegible_brand(d.to_dict() or {})
            and _ad_in_valid_date(d.to_dict() or {})
        ]

        if not ads_docs:
            return {
                "total_ads": 0,
                "categories": {},
                "brands": {},
                "sentiments": {},
                "design_styles": {},
                "emotional_appeals": {},
                "monthly_volume": {}
            }

        categories = {}
        brands = {}
        sentiments = {}
        design_styles = {}
        emotional_appeals = {}
        monthly_volume = {}

        for doc in ads_docs:
            ad = doc.to_dict()
            analysis = ad.get('analysis', {})
            if not isinstance(analysis, dict):
                continue

            # All `.lower()` calls below need defensive `or ''` because
            # Firestore can store explicit None values for these fields
            # when an analysis run partially failed. Without this, one
            # bad ad blows up the whole aggregator.

            # Category
            cat = (
                ad.get('category')
                or ((analysis.get('brand') or {}).get('category') if isinstance(analysis.get('brand'), dict) else None)
                or 'other'
            )
            cat = (cat or '').strip().lower() or 'other'
            # Hide "[NO VISIBLE TEXT]" / "[ILLEGIBLE]" pseudo-categories.
            if cat.startswith('[') and cat.endswith(']'):
                cat = 'other'
            categories[cat] = categories.get(cat, 0) + 1

            # Brand name
            brand = (
                ad.get('brand')
                or ((analysis.get('brand') or {}).get('name') if isinstance(analysis.get('brand'), dict) else None)
                or ''
            )
            if brand:
                brand = (brand or '').strip()
                # Filter Dawn/Herald house promos and bracketed placeholders.
                bl = brand.lower()
                if (bl in {'dawn','the dawn','dawn newspaper','herald','the herald'}
                        or bl.startswith('[') or bl.startswith('the dawn')):
                    pass
                else:
                    brands[brand] = brands.get(brand, 0) + 1

            # Sentiment
            sentiment = ((analysis.get('assessment') or {}).get('sentiment') or '').lower()
            if sentiment in ('positive', 'neutral', 'negative'):
                sentiments[sentiment] = sentiments.get(sentiment, 0) + 1

            # Design style
            style = ((analysis.get('visualAnalysis') or {}).get('designStyle') or '').strip().lower()
            if style and not style.startswith('['):
                design_styles[style] = design_styles.get(style, 0) + 1

            # Emotional appeal
            appeal = ((analysis.get('advertisingStrategy') or {}).get('emotionalAppeal') or '').strip().lower()
            if appeal and not appeal.startswith('['):
                emotional_appeals[appeal] = emotional_appeals.get(appeal, 0) + 1

            # Monthly volume (YYYY-MM)
            pub = ad.get('publication_date')
            if pub:
                pub_str = pub.isoformat() if hasattr(pub, 'isoformat') else str(pub)
                month_key = pub_str[:7]  # YYYY-MM
                monthly_volume[month_key] = monthly_volume.get(month_key, 0) + 1

        # Sort brands by frequency, keep top 30
        top_brands = dict(sorted(brands.items(), key=lambda x: x[1], reverse=True)[:30])

        result = {
            "total_ads": len(ads_docs),
            "categories": dict(sorted(categories.items(), key=lambda x: x[1], reverse=True)),
            "brands": top_brands,
            "sentiments": sentiments,
            "design_styles": dict(sorted(design_styles.items(), key=lambda x: x[1], reverse=True)),
            "emotional_appeals": dict(sorted(emotional_appeals.items(), key=lambda x: x[1], reverse=True)),
            "monthly_volume": dict(sorted(monthly_volume.items()))
        }
        with _ads_summary_lock:
            _ads_summary_cache['value'] = result
            _ads_summary_cache['ts'] = time.time()
        return result

    except Exception as e:
        raise HTTPException(500, f"Error computing analytics: {str(e)}")


@router.get("/{ad_id}")
def get_ad(ad_id: str):
    # gets one specific ad and its analysis
    try:
        upload_dir = "uploads/ads"
        ad_files = [f for f in os.listdir(upload_dir) if f.startswith(ad_id)] if os.path.exists(upload_dir) else []

        if not ad_files:
            raise HTTPException(404, "Advertisement not found")

        file_path = f"{upload_dir}/{ad_files[0]}"
        json_path = f"uploads/ads/analysis/{ad_id}.json"

        ad_data = {
            "id": ad_id,
            "filename": ad_files[0],
            "file_path": file_path,
            "file_size": os.path.getsize(file_path),
            "upload_date": datetime.fromtimestamp(os.path.getctime(file_path)).isoformat()
        }

        if os.path.exists(json_path):
            with open(json_path, 'r', encoding='utf-8') as f:
                analysis = json.load(f)
                ad_data["analysis"] = analysis
                ad_data["analysis_status"] = "completed"
        else:
            ad_data["analysis_status"] = "pending"

        return ad_data

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Error retrieving ad: {str(e)}")


@router.get("/{ad_id}/details")
def get_advertisement_details(ad_id: str):
    # Get detailed information about a specific advertisement
    try:
        db = get_firestore_db()
        ad_ref = db.db.collection('advertisements').document(ad_id)
        ad_doc = ad_ref.get()

        if not ad_doc.exists:
            raise HTTPException(404, "Advertisement not found")

        ad_data = ad_doc.to_dict()
        ad_data['id'] = ad_doc.id

        # Convert datetime to string
        if 'publication_date' in ad_data and hasattr(ad_data['publication_date'], 'isoformat'):
            ad_data['publication_date'] = ad_data['publication_date'].isoformat()
        if 'created_at' in ad_data and hasattr(ad_data['created_at'], 'isoformat'):
            ad_data['created_at'] = ad_data['created_at'].isoformat()

        return ad_data

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Error retrieving advertisement: {str(e)}")
