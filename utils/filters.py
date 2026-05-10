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

    # Markdown / Gemini-extraction artefacts that ended up stored on entity
    # records during article ingestion (`**`, `###`, stray newlines, leading
    # bullets, etc). We strip these before deciding whether the entity is
    # usable, and reject anything that's still mostly punctuation afterwards.
    _MARKDOWN_NOISE_RE = re.compile(r'[*#>`_~\[\]]+')

    for entity in entities:
        raw = entity.get('text', '') or ''
        # Strip markdown chars and collapse whitespace/newlines.
        cleaned = _MARKDOWN_NOISE_RE.sub('', raw)
        cleaned = re.sub(r'\s+', ' ', cleaned).strip(' .,:;-—\t\n')
        text = cleaned
        entity_type = entity.get('type', '')

        if not text or len(text) < 2:
            continue

        if text.isdigit():
            continue

        if text.lower() in NOISE_WORDS:
            continue

        if not any(c.isalnum() for c in text):
            continue

        # Reject obvious leftover prompt fragments — these aren't real
        # entities, they're slabs of Gemini's narration that the NER step
        # later mistook for ORG/PERSON tags.
        lower = text.lower()
        if any(frag in lower for frag in (
            'following operations', 'the image', 'the article',
            'transcribed', 'extracted from', 'main advertisement',
        )):
            continue

        if entity_type in ['DATE', 'TIME', 'CARDINAL', 'ORDINAL', 'MONEY', 'PERCENT', 'QUANTITY']:
            continue

        # Use the cleaned form going forward so callers don't get junk back.
        entity = {**entity, 'text': text}
        normalized = text.lower().rstrip('s')

        if normalized in seen_normalized:
            existing = seen_normalized[normalized]
            if len(text) > len(existing['text']):
                seen_normalized[normalized] = entity
        else:
            seen_normalized[normalized] = entity

    return list(seen_normalized.values())


def extract_date_from_image(image_path: str) -> Optional[str]:
    """Try to read the publication date off the masthead.

    Two-pass strategy:
      1. Tesseract on the top 25% of the image. Cheap and fast — works
         on plain typography. Falls through to step 2 on no match.
      2. Gemini-Vision on the same crop. Catches fancy mastheads,
         angled scans, and partial occlusion that Tesseract chokes on.

    Returns YYYY-MM-DD on success, None on total miss (UI then prompts
    the user to enter the date manually).
    """
    try:
        try:
            import pytesseract
            from PIL import Image, ImageOps
            try:
                from pillow_heif import register_heif_opener
                register_heif_opener()
            except Exception:
                pass

            img = Image.open(image_path)
            # Apply EXIF rotation BEFORE cropping — iPhone photos often
            # carry an EXIF orientation tag that PIL ignores by default,
            # so the "top" of the image was actually the side and we
            # were OCR'ing rotated text.
            try:
                img = ImageOps.exif_transpose(img)
            except Exception:
                pass
            if img.mode != 'RGB':
                img = img.convert('RGB')
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

        # Tesseract pass found nothing — fall back to Gemini Vision on
        # the same crop. Gemini reads stylised mastheads, angled scans,
        # and partial occlusion that Tesseract gives up on. ~$0.001 per
        # call on flash, well worth it for a single uploaded page.
        try:
            return _gemini_extract_date(image_path)
        except Exception as e:
            print(f"Gemini date fallback failed: {e}")
            return None
    except Exception as e:
        print(f"Date extraction error: {e}")
        return None


def _gemini_extract_date(image_path: str) -> Optional[str]:
    """Ask Gemini-Vision for the masthead date. Returns YYYY-MM-DD or None."""
    import os
    import re as _re
    try:
        from PIL import Image, ImageOps
        try:
            from pillow_heif import register_heif_opener
            register_heif_opener()
        except Exception:
            pass
        from services.gemini_adapter import create_model
    except Exception:
        return None

    keys = (os.getenv('GEMINI_API_KEYS') or '').strip()
    api_key = (keys.split(',')[0].strip() if keys else os.getenv('GEMINI_API_KEY') or '').strip()
    if not api_key:
        return None

    img = Image.open(image_path)
    try:
        img = ImageOps.exif_transpose(img)
    except Exception:
        pass
    if img.mode != 'RGB':
        img = img.convert('RGB')
    width, height = img.size
    # Crop top 30% — masthead is up there, but Dawn prints the date below
    # the title bar and the previous 25% crop was clipping it on the
    # phone-photo aspect ratios used by the team.
    crop = img.crop((0, 0, width, int(height * 0.30)))
    # 2.5-pro reads small Dawn print better than flash; cap the long edge
    # to keep round-trip time reasonable.
    if max(crop.size) > 2400:
        ratio = 2400 / max(crop.size)
        crop = crop.resize((int(crop.width * ratio), int(crop.height * ratio)), Image.LANCZOS)

    # Anchoring the prompt to the actual corpus window stops the model
    # hallucinating off-decade dates (flash was returning 1950 / 1999
    # on these mastheads).
    prompt = (
        "This is a Dawn newspaper masthead from 1990 or January 1991. "
        "Read the publication date printed on the masthead. "
        "Return ONLY the date in YYYY-MM-DD format. If no date is visible "
        "or you can't read it, return exactly the word NONE. No other text."
    )
    model = create_model(api_key, 'gemini-2.5-pro')
    resp = model.generate_content([prompt, crop])
    raw = (getattr(resp, 'text', '') or '').strip()
    m = _re.search(r'\b(19[89]\d|20\d{2})-(\d{1,2})-(\d{1,2})\b', raw)
    if not m:
        return None
    yr, mo, dy = (int(x) for x in m.groups())
    if not (1990 <= yr <= 1995 and 1 <= mo <= 12 and 1 <= dy <= 31):
        # Reject obvious hallucinations — corpus is 1990-1992
        return None
    return f'{yr:04d}-{mo:02d}-{dy:02d}'
