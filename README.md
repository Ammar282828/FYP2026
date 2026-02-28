# MediaScope API

A FastAPI-based newspaper analysis system with OCR, NLP, sentiment analysis, and topic modeling capabilities.

## Project Structure

```
/
├── app.py                    # Main FastAPI application entry point
├── requirements.txt          # Python dependencies
├── README.md                 # This file
│
├── api/                      # API layer
│   └── routes/              # API endpoint modules
│       ├── articles.py       # Article CRUD and search
│       ├── analytics.py      # Analytics and insights
│       ├── topics.py         # Topic modeling
│       └── newspapers.py     # OCR processing
│
├── database/                 # Database layer
│   └── firestore_db.py       # Firebase Firestore handler
│
├── services/                 # Business logic
│   └── pipeline.py           # Complete NLP pipeline
│
├── scripts/                  # Utility scripts
│   ├── extract_topics.py     # Extract topics from model
│   ├── assign_topics_to_firestore.py  # Batch topic assignment
│   └── shell/               # Shell scripts
│       ├── setup.sh          # Environment setup
│       ├── start.sh          # Start services
│       ├── start_backend.sh  # Start backend only
│       └── stop.sh           # Stop services
│
├── utils/                    # Helper utilities
│   └── filters.py            # Data filtering/normalization
│
├── config/                   # Configuration
│   ├── firebase-service-account.json  # Firebase credentials
│   └── database_schema.sql   # Database schema reference
│
├── data/                     # Data files
│   ├── topic_model           # Trained BERTopic model
│   └── topics_data.json      # Extracted topic metadata
│
├── logs/                     # Application logs
│
├── docs/                     # Documentation
│   ├── FIREBASE_SETUP.md     # Firebase setup guide
│   ├── FRESH_START_GUIDE.md  # Fresh installation guide
│   ├── MIGRATION_GUIDE.md    # Migration instructions
│   ├── TOPICS_WORKING.md     # Topic modeling guide
│   └── REFACTORING_SUMMARY.md # Refactoring history
│
├── archive/                  # Archived code
│   ├── mediascope_api.py     # Legacy monolithic API
│   └── backups/              # Old backup files
│
├── uploads/                  # User uploads
│   └── newspapers/           # Uploaded newspaper images
│
└── mediascope-frontend/      # React frontend
```

## Quick Start

### 1. Install Dependencies

```bash
pip install -r requirements.txt
```

### 2. Set Environment Variables

Create a `.env` file:

```env
GEMINI_API_KEY=your_gemini_api_key
FIREBASE_SERVICE_ACCOUNT_PATH=config/firebase-service-account.json
FIREBASE_STORAGE_BUCKET=your-bucket-name.appspot.com
ALLOWED_ORIGINS=http://localhost:3000
```

Place your Firebase service account JSON file in `config/firebase-service-account.json`

### 3. Run the Server

```bash
python app.py
```

Or with uvicorn:

```bash
uvicorn app:app --host 0.0.0.0 --port 8000 --reload
```

## API Endpoints

### Articles
- `GET /api/articles` - List articles
- `GET /api/articles/{id}` - Get article by ID
- `GET /api/search` - Search articles by keyword
- `GET /api/search/entity` - Search by entity

### Analytics
- `GET /api/analytics/articles-over-time` - Article count trends
- `GET /api/analytics/sentiment-over-time` - Sentiment trends
- `GET /api/analytics/top-entities` - Most mentioned entities
- `GET /api/analytics/entity-cooccurrence` - Entity relationships
- `GET /api/analytics/sentiment-by-entity` - Entity sentiment analysis

### Topics
- `GET /api/topics` - Get all topics
- `POST /api/topics/train` - Train new topic model
- `GET /api/topics/distribution` - Topic distribution
- `POST /api/topics/assign` - Assign topics to articles

### Newspapers
- `POST /api/newspapers/upload` - Upload and process newspaper image
- `GET /api/newspapers` - List newspapers
- `GET /api/newspapers/{id}` - Get newspaper by ID

## Scripts

### Extract Topics from Model
```bash
python scripts/extract_topics.py
```

### Assign Topics to Existing Articles
```bash
python scripts/assign_topics_to_firestore.py
```

## Features

- **OCR Processing**: Gemini AI-powered OCR for newspaper images
- **Named Entity Recognition**: spaCy-based entity extraction
- **Sentiment Analysis**: RoBERTa/DistilBERT sentiment classification
- **Topic Modeling**: BERTopic for unsupervised topic discovery
- **Cloud Storage**: Firebase Firestore + Storage
- **RESTful API**: FastAPI with automatic documentation

## Tech Stack

- FastAPI
- Firebase (Firestore + Storage)
- Google Gemini AI
- spaCy
- Transformers (Hugging Face)
- BERTopic
- sentence-transformers
