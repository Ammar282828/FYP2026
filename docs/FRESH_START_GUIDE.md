# Fresh Start Guide - MediaScope Database Reset

## What Was Done

### 1. Database Clearing Script
Created `clear_database.py` to wipe all existing data from Firestore.

### 2. Firebase Storage Integration
**Images now stored in Firebase Storage (no size limits!):**
- **Unlimited image size** - No more 1MB Firestore limits
- **Public URLs** - Images accessible via direct links
- **Automatic upload** during processing
- **Storage bucket**: `fyp2026-87a9b.appspot.com`

### 3. Pipeline Updates
**Enhanced `mediascope_complete_pipeline.py`:**
- **Newspaper documents saved to Firestore** with image URLs
- **Images uploaded to Firebase Storage** automatically
- **Newspaper statistics** (article count, avg sentiment) calculated and stored
- **Date detection from filenames** - tries filename parsing before OCR

### 3. API Updates
**Enhanced `mediascope_api.py`:**
- **New endpoint**: `GET /api/newspapers/{id}/image` - serves newspaper images
- **Updated endpoint**: `GET /api/newspapers` - fetches from newspapers collection
- Images displayed in Browse Newspaper section

## Prerequisites

### Enable Firebase Storage (One-time setup)

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Select your project: **fyp2026-87a9b**
3. Click **"Storage"** in the left sidebar
4. Click **"Get Started"**
5. Choose **"Start in production mode"** (or test mode for development)
6. Select your location (same as Firestore)
7. Click **"Done"**

**Important**: Set storage rules to allow public read:
```javascript
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /{allPaths=**} {
      allow read: if true;
      allow write: if request.auth != null;
    }
  }
}
```

## How to Start Fresh

### Step 1: Clear Existing Data

```bash
cd /Users/ammarmansa/Downloads/files
source venv/bin/activate
python clear_database.py
```

When prompted, type `yes` to confirm deletion.

### Step 2: Prepare Your Images

Put your newspaper images in a folder with dates in filenames (optional but recommended):

**Supported filename patterns:**
- `YYYY-MM-DD.jpg` (e.g., `1990-01-15.jpg`)
- `YYYY_MM_DD.jpg` (e.g., `1990_01_15.jpg`)
- `DD-MM-YYYY.jpg` (e.g., `15-01-1990.jpg`)
- `YYYYMMDD.jpg` (e.g., `19900115.jpg`)

Example structure:
```
/path/to/newspapers/
├── 1990-01-15.jpg
├── 1990-01-16.jpg
├── 1990-01-17_page1.jpg
└── 1990-01-17_page2.jpg
```

### Step 3: Run the Pipeline

```bash
# Process single newspaper
python process_single.py /path/to/newspaper.jpg

# OR process batch (recommended)
python process_batch.py /path/to/newspapers/
```

**What happens during processing:**
1. ✅ Date extracted from filename (if available)
2. ✅ Date extracted from OCR (fallback)
3. ✅ Image auto-rotated if needed (EXIF orientation)
4. ✅ Articles extracted with Gemini OCR
5. ✅ NER + Sentiment analysis
6. ✅ **Newspaper document saved with image**
7. ✅ All articles saved to Firestore
8. ✅ Newspaper stats updated (article count, avg sentiment)

### Step 4: View Results

**Start the backend:**
```bash
cd /Users/ammarmansa/Downloads/files
source venv/bin/activate
python mediascope_api.py
```

**Start the frontend:**
```bash
cd mediascope-frontend
npm start
```

**Browse Newspapers:**
- Go to "Browse Newspapers" tab
- Select date range
- Click on any newspaper to view:
  - **Newspaper image** (now displays!)
  - All articles with sentiment
  - AI summary
  - **Edit date button** (if needed)

## Key Features Now Available

### 1. Automatic Image Storage
- ✅ All newspaper images saved automatically
- ✅ Viewable in Browse Newspapers
- ✅ Served via `/api/newspapers/{id}/image`

### 2. Date Detection
- ✅ Filename parsing (fast, reliable)
- ✅ OCR fallback
- ✅ Manual override via UI

### 3. Image Processing
- ✅ Auto-rotation (EXIF)
- ✅ Contrast/sharpness enhancement
- ✅ Brightness adjustment

### 4. Edit Dates Later
- ✅ Click "Edit Date" button
- ✅ Updates newspaper + all articles
- ✅ No re-processing needed

## File Changes Summary

| File | Changes |
|------|---------|
| `clear_database.py` | NEW - Database clearing script |
| `mediascope_complete_pipeline.py` | Updated - Saves newspapers with images, filename date parsing, auto-rotation |
| `mediascope_api.py` | Updated - Image serving endpoint, updated newspapers endpoint |
| Frontend | Already built - Date editing UI ready |

## Database Collections

After processing, you'll have:

### `newspapers` collection
```json
{
  "id": "uuid",
  "publication_date": "1990-01-15",
  "page_number": 1,
  "section": "Main",
  "image_url": "https://storage.googleapis.com/fyp2026-87a9b.appspot.com/newspapers/uuid/1990-01-15.jpg",
  "image_filename": "1990-01-15.jpg",
  "article_count": 12,
  "avg_sentiment": 0.234
}
```

### `articles` collection
```json
{
  "id": "uuid",
  "newspaper_id": "newspaper-uuid",
  "headline": "Article headline",
  "content": "Full text...",
  "publication_date": "1990-01-15",
  "sentiment_score": 0.85,
  "entities": [...]
}
```

## Troubleshooting

**Q: Newspaper images not showing?**
- Check backend is running on port 8000
- Verify Firebase Storage is enabled in Firebase Console
- Check newspapers collection has `image_url` field (not `image_data`)
- Verify storage rules allow public read access
- Check browser console for CORS errors

**Q: Date detection not working?**
- Ensure filename has recognizable date pattern
- OCR will attempt as fallback
- Can manually edit date in UI

**Q: Pipeline fails on image?**
- Check image is valid (JPG/PNG)
- Ensure Gemini API key is set
- Check venv is activated

**Q: Want to reprocess everything?**
- Run `clear_database.py` again
- Reprocess images with pipeline
- All images will be saved fresh

## Commands Summary

```bash
# Clear database
python clear_database.py

# Process newspapers
python process_batch.py /path/to/images/

# Start backend
source venv/bin/activate && python mediascope_api.py

# Start frontend
cd mediascope-frontend && npm start

# View at
http://localhost:3000
```

Ready to start fresh! 🚀
