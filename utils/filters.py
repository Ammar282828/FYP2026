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
            top_section = img.crop((0, 0, width, int(height * 0.2)))

            text = pytesseract.image_to_string(top_section)

            date_patterns = [
                r'(\d{1,2}[-/]\d{1,2}[-/]\d{4})',
                r'(\d{4}[-/]\d{1,2}[-/]\d{1,2})',
                r'((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4})',
                r'(\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4})',
            ]

            for pattern in date_patterns:
                match = re.search(pattern, text, re.IGNORECASE)
                if match:
                    date_str = match.group(1)
                    try:
                        from dateutil import parser
                        parsed_date = parser.parse(date_str, fuzzy=True)
                        if 1990 <= parsed_date.year <= 1992:
                            return parsed_date.strftime('%Y-%m-%d')
                    except:
                        continue
        except ImportError:
            pass

        return None
    except Exception as e:
        print(f"Date extraction error: {e}")
        return None
