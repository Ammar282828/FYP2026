"""
Utility functions for filtering and normalizing data
"""

from typing import List, Dict, Optional
import re
from datetime import datetime


def filter_and_normalize_entities(entities) -> List[Dict]:
    # removes noise entities and combines similar ones
    # like combining "Pakistani" and "Pakistan" into one
    if not entities or entities == '[]':
        return []

    NOISE_WORDS = {
        'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
        'first', 'second', 'third', 'last', 'next', 'today', 'yesterday', 'tomorrow',
        'this', 'that', 'these', 'those', 'the', 'a', 'an', 'and', 'or', 'but',
        'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
        'jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'
    }

    filtered = []
    seen_normalized = {}

    for entity in entities:
        text = entity.get('text', '').strip()
        entity_type = entity.get('type', '')

        if not text or len(text) < 2:
            continue

        if text.isdigit():
            continue

        if text.lower() in NOISE_WORDS:
            continue

        if not any(c.isalnum() for c in text):
            continue

        if entity_type in ['DATE', 'TIME', 'CARDINAL', 'ORDINAL', 'MONEY', 'PERCENT', 'QUANTITY']:
            continue

        normalized = text.lower().rstrip('s')

        if normalized in seen_normalized:
            existing = seen_normalized[normalized]
            if len(text) > len(existing['text']):
                seen_normalized[normalized] = entity
        else:
            seen_normalized[normalized] = entity

    return list(seen_normalized.values())


def extract_date_from_image(image_path: str) -> Optional[str]:
    # tries to find the date on a newspaper image using OCR
    # looks at the top part where dates usually are
    try:
        try:
            import pytesseract
            from PIL import Image

            img = Image.open(image_path)
            width, height = img.size
            # Look at top 25% of image where mastheads/dates usually are
            top_section = img.crop((0, 0, width, int(height * 0.25)))

            text = pytesseract.image_to_string(top_section)
            
            # Comprehensive date patterns (most specific first)
            date_patterns = [
                # "Monday, December 21, 1992" with day name
                r'(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+(\w+)\s+(\d{1,2}),?\s+(\d{4})',
                # "December 21, 1992" or "Dec 21, 1992"
                r'((?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec))\s+(\d{1,2}),?\s+(\d{4})',
                # "21 December 1992" or "21 Dec 1992"
                r'(\d{1,2})\s+((?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec))\s+(\d{4})',
                # ISO format "1992-12-21"
                r'(\d{4})[-/](\d{1,2})[-/](\d{1,2})',
                # "21/12/1992" or "21-12-1992"
                r'(\d{1,2})[-/](\d{1,2})[-/](\d{4})',
            ]
            
            month_names = {
                'january': 1, 'jan': 1, 'february': 2, 'feb': 2,
                'march': 3, 'mar': 3, 'april': 4, 'apr': 4,
                'may': 5, 'june': 6, 'jun': 6, 'july': 7, 'jul': 7,
                'august': 8, 'aug': 8, 'september': 9, 'sep': 9, 'sept': 9,
                'october': 10, 'oct': 10, 'november': 11, 'nov': 11,
                'december': 12, 'dec': 12
            }

            for pattern in date_patterns:
                match = re.search(pattern, text, re.IGNORECASE)
                if match:
                    groups = match.groups()
                    try:
                        # Parse based on number of groups
                        if len(groups) == 3:
                            g1, g2, g3 = groups
                            
                            # Check if first group is a month name
                            if g1.lower() in month_names:
                                month = month_names[g1.lower()]
                                day = int(g2)
                                year = int(g3)
                            # Check if second group is a month name
                            elif g2.lower() in month_names:
                                day = int(g1)
                                month = month_names[g2.lower()]
                                year = int(g3)
                            # Check if first group is a 4-digit year
                            elif len(g1) == 4:
                                year = int(g1)
                                month = int(g2)
                                day = int(g3)
                            # Assume day/month/year format
                            else:
                                day = int(g1)
                                month = int(g2)
                                year = int(g3)
                            
                            # Validate date components
                            if 1900 <= year <= 2030 and 1 <= month <= 12 and 1 <= day <= 31:
                                parsed_date = datetime(year, month, day)
                                return parsed_date.strftime('%Y-%m-%d')
                    except (ValueError, KeyError):
                        continue
        except ImportError:
            pass

        return None
    except Exception as e:
        print(f"Date extraction error: {e}")
        return None
