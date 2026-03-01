#!/usr/bin/env python3
"""
MediaScope API - Main Application
Refactored version with modular route structure
"""

# this is the main app file that sets up all the routes and stuff
# it basically connects everything together

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import os
from dotenv import load_dotenv

from api.routes import articles, analytics, topics, newspapers, ads, stories

load_dotenv()

app = FastAPI(title="MediaScope API", version="2.0")

allowed_origins = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allow_headers=["*"],
    allow_credentials=True,
    max_age=3600
)

app.mount("/uploads/newspapers", StaticFiles(directory="uploads/newspapers"), name="newspapers")

app.include_router(articles.router)
app.include_router(analytics.router)
app.include_router(topics.router)
app.include_router(newspapers.router)
app.include_router(ads.router)
app.include_router(stories.router)


@app.get("/")
def root():
    # just returns basic info about the api
    return {"message": "MediaScope API", "version": "2.0", "status": "refactored"}


@app.get("/api/suggestions/keywords")
def keyword_suggestions(limit: int = 100):
    # gets keyword suggestions from the database for autocomplete
    # limit is how many keywords to return
    from database.firestore_db import get_db
    limit = min(limit, 200)
    try:
        db = get_db()
        keywords = db.get_top_keywords(limit=limit)
        return {"suggestions": keywords}
    except Exception as e:
        from fastapi import HTTPException
        raise HTTPException(500, f"Database error: {str(e)}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
