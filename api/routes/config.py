"""
Configuration endpoint — exposes archive defaults, feature flags, and UI settings
so the frontend doesn't hardcode them.
"""

import os
from fastapi import APIRouter

router = APIRouter(prefix="/api/config", tags=["config"])


@router.get("")
def get_config():
    """Return runtime config for the frontend."""
    return {
        "archive": {
            "name": os.getenv("ARCHIVE_NAME", "Dawn Newspaper Archive"),
            "start_date": os.getenv("ARCHIVE_START_DATE", "1990-01-01"),
            "end_date": os.getenv("ARCHIVE_END_DATE", "1992-12-31"),
            "default_start_date": os.getenv("ARCHIVE_DEFAULT_START_DATE", "1990-01-01"),
            "default_end_date": os.getenv("ARCHIVE_DEFAULT_END_DATE", "1992-12-31"),
        },
        "features": {
            "stories": True,
            "ads": True,
            "image_analysis": True,
            "bookmarks": True,
            "chat": os.getenv("FEATURE_CHAT", "true").lower() == "true",
        },
        "limits": {
            "search_max_results": int(os.getenv("SEARCH_MAX_RESULTS", "100")),
            "narrative_timeout_seconds": int(os.getenv("NARRATIVE_TIMEOUT_SECONDS", "120")),
        },
    }
