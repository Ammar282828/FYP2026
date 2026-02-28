# MediaScope - Dawn Newspaper Archive System (1990-1992)

Historical newspaper archive with AI-powered search, sentiment analysis, and interactive visualizations.

## Quick Start

### 1. Install Prerequisites

Download and install these (in order):

1. **Python 3.9-3.12** → [python.org/downloads](https://www.python.org/downloads/)
2. **Node.js 16+** → [nodejs.org](https://nodejs.org/)
3. **Git** → [git-scm.com/downloads](https://git-scm.com/downloads)

**Note:** Firebase credentials are already included in the repository - no additional setup needed!

### 2. Clone & Setup

```bash
# Clone the repository
git clone https://github.com/Ammar282828/mediascope.git
cd mediascope

# Run automatic setup
# Mac/Linux:
chmod +x setup.sh && ./setup.sh

# Windows:
setup.bat
```

That's it! The setup script does everything automatically.

### 3. Start the App

**Terminal 1 - Backend:**
```bash
# Mac/Linux:
source venv/bin/activate
python mediascope_api.py

# Windows:
venv\Scripts\activate
python mediascope_api.py
```

**Terminal 2 - Frontend:**
```bash
cd mediascope-frontend
npm start
```

**Open:** http://localhost:3000

### 4. Upload Sample Newspapers (Optional)

The database starts empty. To add sample newspapers:

1. Open http://localhost:3000
2. Look for the upload/OCR section in the UI
3. Upload newspapers from the `input_newspapers/` folder
4. The system will process them automatically with OCR and sentiment analysis

Or use the API directly:
```bash
curl -X POST "http://localhost:8000/api/ocr/upload-bulk" \
  -F "files=@input_newspapers/Mar_25_90_p1.jpg"
```

---

## Firebase Setup

MediaScope uses Firebase Firestore as its cloud database. **You need to set this up before running the app.**

### Step 1: Create Firebase Project

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Click "Add project" or select an existing project
3. Follow the setup wizard (you can disable Google Analytics)

### Step 2: Enable Firestore

1. In your Firebase project, click "Firestore Database" in the left sidebar
2. Click "Create database"
3. Choose "Start in production mode"
4. Select a location (choose closest to your region)

### Step 3: Firebase Credentials (Already Included)

**The Firebase service account credentials are already included in this repository** as `firebase-service-account.json`. This means:

✅ **No additional setup needed** - Team members can clone and run immediately
✅ **Shared Firebase access** - Everyone uses the same Firestore database
✅ **Simplified deployment** - No credential management required

**Note:** The `.env` file already points to `firebase-service-account.json` by default.

### How It Works

When you start the application, it automatically:

1. **Loads** the `firebase-service-account.json` credentials from the repository
2. **Initializes** Firebase Admin SDK (preventing duplicate initialization)
3. **Connects** to the shared Firestore database

You'll see `[OK] Connected to Firebase Firestore` when the connection succeeds.

**All team members share the same Firebase project and data!**

---

## What It Does

- **Search** - Find articles by keywords, entities, dates
- **Analytics** - View trends, sentiment analysis, statistics
- **AI Summaries** - Get article summaries powered by Google Gemini
- **Visualizations** - Interactive charts and graphs

## Tech Stack

**Backend:** Python, FastAPI, Firebase Firestore
**Frontend:** React, TypeScript, Recharts
**AI:** Google Gemini, spaCy NLP
**Database:** Firebase Firestore (Cloud NoSQL)

## Project Structure

```
mediascope/
├── mediascope_api.py          # Backend API server
├── mediascope-frontend/       # React frontend app
├── requirements.txt           # Python packages
├── .env                       # Your config (don't commit!)
├── setup.sh / setup.bat       # Automatic setup scripts
└── README.md                  # This file
```

## Troubleshooting

### "Firestore connection error"
```bash
# Verify the credentials file exists
ls firebase-service-account.json

# Check if the JSON file is valid
python3 -c "import json; json.load(open('firebase-service-account.json'))"

# Ensure you have internet connection (Firestore is cloud-based)
ping -c 3 firestore.googleapis.com
```

### "No module named 'firestore_db'"
```bash
# Make sure you're in the project directory and virtual environment is activated
source venv/bin/activate  # Mac/Linux
# or
venv\Scripts\activate     # Windows

# Then verify the file exists
ls firestore_db.py
```

### "Port already in use"
```bash
# Kill the process on port 8000 or 3000
# Mac/Linux:
lsof -ti:8000 | xargs kill

# Windows:
netstat -ano | findstr :8000
# Then: taskkill /PID <number> /F
```

### "Module not found"
```bash
# Activate virtual environment first!
# Mac/Linux:
source venv/bin/activate

# Windows:
venv\Scripts\activate

# Then install:
pip install -r requirements.txt
```

### Python Version Compatibility

This project is compatible with Python 3.9-3.14. The requirements.txt file has been optimized for:
- Python 3.13+ compatibility (updated dependencies)
- Flexible version constraints for better package resolution
- Firebase Admin SDK for cloud database access
- Latest PyTorch and Transformers for AI features

If you encounter dependency conflicts, try:
```bash
pip install --upgrade pip setuptools wheel
pip install -r requirements.txt
```

## Features

### Search
- Full-text keyword search
- Entity search (people, places, organizations)
- Date range filtering
- Sentiment filtering

### Analytics
- Keyword trends over time
- Sentiment analysis timeline
- Top keywords and entities
- Article statistics

### AI Features
- Article summarization
- Named entity recognition
- Sentiment classification
- Topic detection

## API Endpoints

Backend runs on `http://localhost:8000`

- `GET /api/articles` - Search articles
- `GET /api/articles/{id}` - Get article details
- `GET /api/analytics/sentiment-over-time` - Sentiment trends
- `GET /api/analytics/top-keywords` - Popular keywords
- `POST /api/ai/summarize` - Generate summary

**Full API docs:** http://localhost:8000/docs

## Team

**Developers:**
- Ammar Murtaza - Backend & ML
- Izbal Mengal - Frontend & UI
- Mahnoor Aminullah - Data & QA
- Mohammad Arqam Nakhuda - Analytics

**Supervisor:** Dr. Faisal Alvi
**Institution:** Habib University

## License

Educational project for Habib University Kaavish program.

---

**Questions?** Open an issue on GitHub or contact am08721@st.habib.edu.pk
