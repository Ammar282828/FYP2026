"""
Advertisement image analysis routes
"""

from fastapi import APIRouter, UploadFile, File, HTTPException
from typing import Optional, List
import os
import uuid
from datetime import datetime
import json
import requests
import re
from database.firestore_db import get_firestore_db

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
    parent's image URL to do that. This helper batches the lookups by unique
    newspaper_id so we make at most ~N/200 reads instead of one per ad.
    """
    ids = sorted({(ad.get('newspaper_id') or '').strip() for ad in ads})
    ids = [i for i in ids if i]
    if not ids:
        return
    cache: dict[str, str] = {}
    # Firestore .get() can take individual doc refs; do a small batch loop.
    for nid in ids:
        try:
            snap = db.db.collection('newspapers').document(nid).get()
            if snap.exists:
                cache[nid] = (snap.to_dict() or {}).get('image_url') or ''
        except Exception:
            cache[nid] = ''
    for ad in ads:
        nid = (ad.get('newspaper_id') or '').strip()
        ad['newspaper_image_url'] = cache.get(nid, '')


@router.get("/browse")
def browse_advertisements(
    limit: int = 50,
    offset: int = 0,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    category: Optional[str] = None
):
    # Browse all advertisements with filtering
    try:
        from datetime import datetime as dt

        limit = min(limit, 200)
        db = get_firestore_db()

        query = db.db.collection('advertisements')

        # Apply filters
        if start_date:
            start_dt = dt.fromisoformat(start_date)
            query = query.where('publication_date', '>=', start_dt)

        if end_date:
            end_dt = dt.fromisoformat(end_date)
            query = query.where('publication_date', '<=', end_dt)

        query = query.limit(500)

        ads_docs = list(query.stream())

        # Sort in Python to avoid requiring a Firestore composite index
        def _sort_key(doc):
            pub = doc.to_dict().get('publication_date')
            if pub is None:
                return ''
            return pub.isoformat() if hasattr(pub, 'isoformat') else str(pub)

        ads_docs.sort(key=_sort_key, reverse=True)
        ads_docs = ads_docs[offset:offset + limit]

        ads = []
        for doc in ads_docs:
            ad_data = doc.to_dict()
            ad_data['id'] = doc.id

            # Convert datetime to string
            if 'publication_date' in ad_data and hasattr(ad_data['publication_date'], 'isoformat'):
                ad_data['publication_date'] = ad_data['publication_date'].isoformat()
            if 'created_at' in ad_data and hasattr(ad_data['created_at'], 'isoformat'):
                ad_data['created_at'] = ad_data['created_at'].isoformat()

            # Extract category from analysis if available
            if category:
                analysis_text = ad_data.get('analysis', '').lower()
                if category.lower() not in analysis_text:
                    continue

            ads.append(ad_data)

        # Attach parent newspaper image URLs so the client can render
        # accurate crops from the source image (the stored ad image_url
        # is often a degraded pre-cut crop).
        _attach_newspaper_image_urls(db, ads)

        return {
            "ads": ads,
            "total": len(ads),
            "limit": limit,
            "offset": offset
        }

    except Exception as e:
        raise HTTPException(500, f"Error browsing ads: {str(e)}")


@router.post("/search")
def search_advertisements(request: dict):
    # Search advertisements by keyword
    keyword = request.get('keyword', '').strip()
    limit = min(request.get('limit', 50), 200)
    offset = max(request.get('offset', 0), 0)

    if not keyword:
        raise HTTPException(400, "Keyword is required")

    try:
        db = get_firestore_db()

        # Get all ads (Firestore doesn't support full-text search natively)
        ads_docs = list(db.db.collection('advertisements').stream())

        # Filter by keyword in memory
        keyword_lower = keyword.lower()
        matching_ads = []

        for doc in ads_docs:
            ad_data = doc.to_dict()
            ad_data['id'] = doc.id

            # Search in analysis, identifier, and description
            searchable_text = ' '.join([
                ad_data.get('analysis', ''),
                ad_data.get('identifier', ''),
                ad_data.get('description', '')
            ]).lower()

            if keyword_lower in searchable_text:
                # Convert datetime to string
                if 'publication_date' in ad_data and hasattr(ad_data['publication_date'], 'isoformat'):
                    ad_data['publication_date'] = ad_data['publication_date'].isoformat()
                if 'created_at' in ad_data and hasattr(ad_data['created_at'], 'isoformat'):
                    ad_data['created_at'] = ad_data['created_at'].isoformat()

                matching_ads.append(ad_data)

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
    try:
        db = get_firestore_db()
        ads_docs = list(db.db.collection('advertisements').stream())

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

            # Category
            cat = (
                ad.get('category')
                or (analysis.get('brand') or {}).get('category', '')
                or 'other'
            )
            cat = cat.strip().lower() or 'other'
            categories[cat] = categories.get(cat, 0) + 1

            # Brand name
            brand = (
                ad.get('brand')
                or (analysis.get('brand') or {}).get('name', '')
                or ''
            )
            if brand:
                brand = brand.strip()
                brands[brand] = brands.get(brand, 0) + 1

            # Sentiment
            sentiment = (analysis.get('assessment') or {}).get('sentiment', '').lower()
            if sentiment in ('positive', 'neutral', 'negative'):
                sentiments[sentiment] = sentiments.get(sentiment, 0) + 1

            # Design style
            style = (analysis.get('visualAnalysis') or {}).get('designStyle', '')
            if style:
                style = style.strip().lower()
                design_styles[style] = design_styles.get(style, 0) + 1

            # Emotional appeal
            appeal = (analysis.get('advertisingStrategy') or {}).get('emotionalAppeal', '')
            if appeal:
                appeal = appeal.strip().lower()
                emotional_appeals[appeal] = emotional_appeals.get(appeal, 0) + 1

            # Monthly volume (YYYY-MM)
            pub = ad.get('publication_date')
            if pub:
                pub_str = pub.isoformat() if hasattr(pub, 'isoformat') else str(pub)
                month_key = pub_str[:7]  # YYYY-MM
                monthly_volume[month_key] = monthly_volume.get(month_key, 0) + 1

        # Sort brands by frequency, keep top 30
        top_brands = dict(sorted(brands.items(), key=lambda x: x[1], reverse=True)[:30])

        return {
            "total_ads": len(ads_docs),
            "categories": dict(sorted(categories.items(), key=lambda x: x[1], reverse=True)),
            "brands": top_brands,
            "sentiments": sentiments,
            "design_styles": dict(sorted(design_styles.items(), key=lambda x: x[1], reverse=True)),
            "emotional_appeals": dict(sorted(emotional_appeals.items(), key=lambda x: x[1], reverse=True)),
            "monthly_volume": dict(sorted(monthly_volume.items()))
        }

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
