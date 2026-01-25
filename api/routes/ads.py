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

router = APIRouter(prefix="/api/ads", tags=["ads"])


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

        genai.configure(api_key=gemini_key)

        # Load and convert image to RGB if needed
        img = Image.open(file_path)

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

        prompt = """Analyze this historical advertisement image in detail. Structure your response EXACTLY in this format:

## TEXT CONTENT
[List all visible text: headlines, body copy, slogans, taglines, phone numbers, addresses]

## BRAND AND PRODUCT
Brand Name: [Brand name if visible]
Product/Service: [What's being advertised]
Category: [Product category, e.g., automotive, food and beverage, retail, etc.]

## VISUAL ANALYSIS
Colors: [Dominant colors used]
Imagery: [Key visual elements, photos, illustrations]
Design Style: [Overall aesthetic - modern, vintage, minimalist, etc.]
Layout: [How elements are arranged]

## TARGET AUDIENCE
Demographics: [Age group, gender, income level, etc.]
Psychographics: [Interests, lifestyle, values being appealed to]

## ADVERTISING STRATEGY
Main Message: [Core value proposition]
Emotional Appeal: [What emotion is being evoked]
Persuasion Techniques: [Scarcity, social proof, authority, etc.]
Call to Action: [What action is the ad requesting]

## CULTURAL AND HISTORICAL CONTEXT
Time Period Indicators: [1990-1992 era references, style, technology]
Cultural References: [Any cultural themes or references]

## OVERALL ASSESSMENT
Sentiment: [Positive/Neutral/Negative]
Effectiveness: [Brief assessment of the ad's likely impact]

Be thorough and specific in your analysis."""

        model = genai.GenerativeModel('gemini-3-pro-preview')
        response = model.generate_content([prompt, img])

        analysis_text = response.text

        analysis_data = {
            "detected_text": analysis_text,
            "timestamp": datetime.now().isoformat(),
            "model": "gemini-3-pro-preview",
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

        genai.configure(api_key=gemini_key)

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

        # Step 1: Use Gemini to identify ad locations
        model = genai.GenerativeModel('gemini-3-pro-preview')

        detection_prompt = """Analyze this newspaper page and identify all advertisements.

For each advertisement you find, provide:
1. A brief description of its location (e.g., "top-left corner", "bottom half center", "right side banner")
2. Approximate position as percentages (left%, top%, width%, height%) from 0-100
3. A brief identifier (e.g., "Car ad", "Restaurant ad", "Classified ads")

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
    "identifier": "Car dealership ad"
  },
  ...
]

Return ONLY the JSON array, no other text."""

        detection_response = model.generate_content([detection_prompt, img])
        detection_text = detection_response.text.strip()

        # Extract JSON from response
        import re
        json_match = re.search(r'\[.*\]', detection_text, re.DOTALL)
        if not json_match:
            raise HTTPException(500, "Failed to parse ad locations from Gemini response")

        ad_regions = json.loads(json_match.group(0))

        if not ad_regions:
            return {
                "newspaper_id": newspaper_id,
                "total_ads": 0,
                "ads": [],
                "message": "No advertisements detected in this newspaper page"
            }

        # Step 2: Crop and analyze each ad region
        analyzed_ads = []
        width, height = img.size

        for ad_region in ad_regions:
            try:
                # Calculate pixel coordinates from percentages
                left = int((ad_region['left'] / 100) * width)
                top = int((ad_region['top'] / 100) * height)
                right = int(((ad_region['left'] + ad_region['width']) / 100) * width)
                bottom = int(((ad_region['top'] + ad_region['height']) / 100) * height)

                # Crop the ad region
                ad_img = img.crop((left, top, right, bottom))

                # Analyze the cropped ad
                analysis_prompt = """Analyze this historical advertisement image in detail. Structure your response EXACTLY in this format:

## TEXT CONTENT
[List all visible text: headlines, body copy, slogans, taglines, phone numbers, addresses]

## BRAND & PRODUCT
Brand Name: [Brand name if visible]
Product/Service: [What's being advertised]
Category: [Product category, e.g., automotive, food & beverage, retail, etc.]

## VISUAL ANALYSIS
Colors: [Dominant colors used]
Imagery: [Key visual elements, photos, illustrations]
Design Style: [Overall aesthetic - modern, vintage, minimalist, etc.]
Layout: [How elements are arranged]

## TARGET AUDIENCE
Demographics: [Age group, gender, income level, etc.]
Psychographics: [Interests, lifestyle, values being appealed to]

## ADVERTISING STRATEGY
Main Message: [Core value proposition]
Emotional Appeal: [What emotion is being evoked]
Persuasion Techniques: [Scarcity, social proof, authority, etc.]
Call to Action: [What action is the ad requesting]

## CULTURAL & HISTORICAL CONTEXT
Time Period Indicators: [1990-1992 era references, style, technology]
Cultural References: [Any cultural themes or references]

## OVERALL ASSESSMENT
Sentiment: [Positive/Neutral/Negative]
Effectiveness: [Brief assessment of the ad's likely impact]

Be thorough and specific in your analysis."""

                analysis_response = model.generate_content([analysis_prompt, ad_img])
                analysis_text = analysis_response.text

                # Save the cropped ad image
                ad_id = f"{newspaper_id}_ad_{ad_region['id']}"
                ads_dir = "uploads/newspaper_ads"
                os.makedirs(ads_dir, exist_ok=True)

                ad_image_path = f"{ads_dir}/{ad_id}.jpg"
                ad_img.save(ad_image_path, "JPEG")

                # Save analysis
                analysis_data = {
                    "ad_id": ad_id,
                    "newspaper_id": newspaper_id,
                    "region_id": ad_region['id'],
                    "identifier": ad_region.get('identifier', f"Ad {ad_region['id']}"),
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
                    "analysis": analysis_text,
                    "image_path": ad_image_path,
                    "timestamp": datetime.now().isoformat(),
                    "model": "gemini-3-pro-preview"
                }

                # Save to JSON
                analysis_json_dir = "uploads/newspaper_ads/analysis"
                os.makedirs(analysis_json_dir, exist_ok=True)
                json_path = f"{analysis_json_dir}/{ad_id}.json"

                with open(json_path, 'w', encoding='utf-8') as f:
                    json.dump(analysis_data, f, indent=2, ensure_ascii=False)

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
            "publication_date": newspaper_data.get('publication_date'),
            "total_ads": len(analyzed_ads),
            "successful": sum(1 for ad in analyzed_ads if "error" not in ad),
            "failed": sum(1 for ad in analyzed_ads if "error" in ad),
            "ads": analyzed_ads,
            "message": f"Analyzed {len(analyzed_ads)} advertisements from newspaper"
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

        # Step 1: Use Gemini to identify ad locations
        model = genai.GenerativeModel('gemini-3-pro-preview')

        detection_prompt = """Analyze this newspaper page and identify all advertisements.

For each advertisement you find, provide:
1. A brief description of its location (e.g., "top-left corner", "bottom half center", "right side banner")
2. Approximate position as percentages (left%, top%, width%, height%) from 0-100
3. A brief identifier (e.g., "Car ad", "Restaurant ad", "Classified ads")

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
    "identifier": "Car dealership ad"
  },
  ...
]

Return ONLY the JSON array, no other text."""

        detection_response = model.generate_content([detection_prompt, img])
        detection_text = detection_response.text.strip()

        # Extract JSON from response
        import re
        json_match = re.search(r'\[.*\]', detection_text, re.DOTALL)
        if not json_match:
            raise HTTPException(500, "Failed to parse ad locations from Gemini response")

        ad_regions = json.loads(json_match.group(0))

        if not ad_regions:
            return {
                "file_path": file_path,
                "newspaper_id": newspaper_id,
                "total_ads": 0,
                "ads": [],
                "message": "No advertisements detected in this image"
            }

        # Step 2: Crop and analyze each ad region
        analyzed_ads = []
        width, height = img.size

        for ad_region in ad_regions:
            try:
                # Calculate pixel coordinates from percentages
                left = int((ad_region['left'] / 100) * width)
                top = int((ad_region['top'] / 100) * height)
                right = int(((ad_region['left'] + ad_region['width']) / 100) * width)
                bottom = int(((ad_region['top'] + ad_region['height']) / 100) * height)

                # Crop the ad region
                ad_img = img.crop((left, top, right, bottom))

                # Analyze the cropped ad
                analysis_prompt = """Analyze this historical advertisement image in detail. Structure your response EXACTLY in this format:

## TEXT CONTENT
[List all visible text: headlines, body copy, slogans, taglines, phone numbers, addresses]

## BRAND & PRODUCT
Brand Name: [Brand name if visible]
Product/Service: [What's being advertised]
Category: [Product category, e.g., automotive, food & beverage, retail, etc.]

## VISUAL ANALYSIS
Colors: [Dominant colors used]
Imagery: [Key visual elements, photos, illustrations]
Design Style: [Overall aesthetic - modern, vintage, minimalist, etc.]
Layout: [How elements are arranged]

## TARGET AUDIENCE
Demographics: [Age group, gender, income level, etc.]
Psychographics: [Interests, lifestyle, values being appealed to]

## ADVERTISING STRATEGY
Main Message: [Core value proposition]
Emotional Appeal: [What emotion is being evoked]
Persuasion Techniques: [Scarcity, social proof, authority, etc.]
Call to Action: [What action is the ad requesting]

## CULTURAL & HISTORICAL CONTEXT
Time Period Indicators: [1990-1992 era references, style, technology]
Cultural References: [Any cultural themes or references]

## OVERALL ASSESSMENT
Sentiment: [Positive/Neutral/Negative]
Effectiveness: [Brief assessment of the ad's likely impact]

Be thorough and specific in your analysis."""

                analysis_response = model.generate_content([analysis_prompt, ad_img])
                analysis_text = analysis_response.text

                # Save the cropped ad image
                ad_id = f"{newspaper_id}_ad_{ad_region['id']}"
                ads_dir = "uploads/newspaper_ads"
                os.makedirs(ads_dir, exist_ok=True)

                ad_image_path = f"{ads_dir}/{ad_id}.jpg"
                ad_img.save(ad_image_path, "JPEG")

                # Save analysis
                analysis_data = {
                    "ad_id": ad_id,
                    "newspaper_id": newspaper_id,
                    "source_file": file_path,
                    "region_id": ad_region['id'],
                    "identifier": ad_region.get('identifier', f"Ad {ad_region['id']}"),
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
                    "analysis": analysis_text,
                    "image_path": ad_image_path,
                    "timestamp": datetime.now().isoformat(),
                    "model": "gemini-3-pro-preview"
                }

                # Save to JSON
                analysis_json_dir = "uploads/newspaper_ads/analysis"
                os.makedirs(analysis_json_dir, exist_ok=True)
                json_path = f"{analysis_json_dir}/{ad_id}.json"

                with open(json_path, 'w', encoding='utf-8') as f:
                    json.dump(analysis_data, f, indent=2, ensure_ascii=False)

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
            "message": f"Analyzed {len(analyzed_ads)} advertisements from image"
        }

    except HTTPException:
        raise
    except Exception as e:
        import traceback
        print(f"Image ad analysis error: {str(e)}")
        print(traceback.format_exc())
        raise HTTPException(500, f"Analysis failed: {str(e)}")


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

        # Order by publication date descending
        query = query.order_by('publication_date', direction='DESCENDING')
        query = query.limit(limit + offset)

        ads_docs = list(query.stream())
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
        query = db.db.collection('advertisements').order_by('publication_date', direction='DESCENDING')
        ads_docs = list(query.stream())

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

        return {
            "ads": matching_ads,
            "total": total,
            "keyword": keyword,
            "limit": limit,
            "offset": offset
        }

    except Exception as e:
        raise HTTPException(500, f"Error searching ads: {str(e)}")


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
