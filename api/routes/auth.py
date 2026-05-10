"""
Authentication API routes - user registration, login, and profile management.
Uses Firebase Firestore for user storage and JWT for session tokens.
"""

from fastapi import APIRouter, HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, EmailStr
from typing import Optional
from datetime import datetime, timedelta
import os
import uuid
import jwt
import bcrypt
from database.firestore_db import get_firestore_db

router = APIRouter(prefix="/api/auth", tags=["auth"])
security = HTTPBearer(auto_error=False)

# JWT config — read from env, fall back to a (logged) random secret on
# dev machines that haven't set one. The hardcoded literal that lived
# here previously was visible in source control and let anyone who saw
# the repo forge tokens for any user.
import secrets as _secrets
JWT_SECRET = (os.getenv("JWT_SECRET") or "").strip()
if not JWT_SECRET:
    JWT_SECRET = _secrets.token_urlsafe(48)
    print(
        "[AUTH WARNING] JWT_SECRET not set in environment — generated an "
        "ephemeral one for this process. Set JWT_SECRET in .env to keep "
        "sessions valid across restarts.",
        flush=True,
    )
JWT_ALGORITHM = "HS256"
JWT_EXPIRY_HOURS = 72


# --- Models ---

class RegisterRequest(BaseModel):
    email: str
    password: str
    name: str

class LoginRequest(BaseModel):
    email: str
    password: str

class UpdateProfileRequest(BaseModel):
    name: Optional[str] = None
    avatar_color: Optional[str] = None


# --- Helpers ---

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode('utf-8'), hashed.encode('utf-8'))

def create_token(user_id: str, email: str) -> str:
    payload = {
        "user_id": user_id,
        "email": email,
        "exp": datetime.utcnow() + timedelta(hours=JWT_EXPIRY_HOURS),
        "iat": datetime.utcnow()
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(401, "Invalid token")


def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    """Dependency that extracts and validates the current user from JWT token."""
    if not credentials:
        raise HTTPException(401, "Not authenticated")
    payload = decode_token(credentials.credentials)
    return payload


def get_optional_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    """Dependency that returns user if authenticated, None otherwise."""
    if not credentials:
        return None
    try:
        return decode_token(credentials.credentials)
    except jwt.ExpiredSignatureError:
        # Common, not a bug — user's session expired. Don't spam logs.
        return None
    except jwt.InvalidTokenError as e:
        # Tampered or wrong-signature token: log so we can spot
        # mass-forgery attempts. Don't 401 — caller might still be OK
        # to serve as anonymous.
        print(f"[AUTH] invalid token rejected: {e}", flush=True)
        return None
    except Exception as e:
        # Anything else (network blip on a JWT-aware backend, etc.) —
        # surface it once instead of silently swallowing.
        print(f"[AUTH WARN] unexpected token decode failure: {e!r}", flush=True)
        return None


# --- Routes ---

@router.post("/register")
def register(req: RegisterRequest):
    """Register a new user account."""
    db = get_firestore_db()

    # Check if email already exists
    existing = list(db.db.collection('users').where('email', '==', req.email.lower()).limit(1).stream())
    if existing:
        raise HTTPException(400, "Email already registered")

    if len(req.password) < 6:
        raise HTTPException(400, "Password must be at least 6 characters")

    if not req.name.strip():
        raise HTTPException(400, "Name is required")

    user_id = str(uuid.uuid4())
    # Pick a random avatar color
    import random
    colors = ['#2563eb', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16']

    user_doc = {
        'id': user_id,
        'email': req.email.lower().strip(),
        'password_hash': hash_password(req.password),
        'name': req.name.strip(),
        'avatar_color': random.choice(colors),
        'created_at': datetime.utcnow(),
        'bookmark_count': 0
    }

    db.db.collection('users').document(user_id).set(user_doc)

    token = create_token(user_id, user_doc['email'])

    return {
        "token": token,
        "user": {
            "id": user_id,
            "email": user_doc['email'],
            "name": user_doc['name'],
            "avatar_color": user_doc['avatar_color'],
            "bookmark_count": 0
        }
    }


@router.post("/login")
def login(req: LoginRequest):
    """Login with email and password."""
    db = get_firestore_db()

    users = list(db.db.collection('users').where('email', '==', req.email.lower().strip()).limit(1).stream())
    if not users:
        raise HTTPException(401, "Invalid email or password")

    user_data = users[0].to_dict()

    if not verify_password(req.password, user_data['password_hash']):
        raise HTTPException(401, "Invalid email or password")

    token = create_token(user_data['id'], user_data['email'])

    return {
        "token": token,
        "user": {
            "id": user_data['id'],
            "email": user_data['email'],
            "name": user_data['name'],
            "avatar_color": user_data.get('avatar_color', '#2563eb'),
            "bookmark_count": user_data.get('bookmark_count', 0)
        }
    }


@router.get("/me")
def get_profile(user=Depends(get_current_user)):
    """Get the current user's profile."""
    db = get_firestore_db()
    user_doc = db.db.collection('users').document(user['user_id']).get()

    if not user_doc.exists:
        raise HTTPException(404, "User not found")

    data = user_doc.to_dict()
    return {
        "id": data['id'],
        "email": data['email'],
        "name": data['name'],
        "avatar_color": data.get('avatar_color', '#2563eb'),
        "bookmark_count": data.get('bookmark_count', 0),
        "created_at": str(data.get('created_at', ''))
    }


@router.put("/me")
def update_profile(req: UpdateProfileRequest, user=Depends(get_current_user)):
    """Update the current user's profile."""
    db = get_firestore_db()
    updates = {}

    if req.name is not None and req.name.strip():
        updates['name'] = req.name.strip()
    if req.avatar_color is not None:
        updates['avatar_color'] = req.avatar_color

    if not updates:
        raise HTTPException(400, "No fields to update")

    db.db.collection('users').document(user['user_id']).update(updates)
    return {"status": "updated", **updates}
