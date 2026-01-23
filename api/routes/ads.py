"""
Advertisement image analysis routes
"""

from fastapi import APIRouter, UploadFile, File, HTTPException
from typing import Optional
import os
import uuid
from datetime import datetime
import json

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
        import google.generativeai as genai

        gemini_key = os.getenv("GEMINI_API_KEY")
        if not gemini_key:
            raise HTTPException(500, "GEMINI_API_KEY not configured")

        genai.configure(api_key=gemini_key)

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

        model = genai.GenerativeModel('gemini-2.5-pro')
        response = model.generate_content([prompt, img])

        analysis_text = response.text

        analysis_data = {
            "detected_text": analysis_text,
            "timestamp": datetime.now().isoformat(),
            "model": "gemini-2.5-pro",
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
