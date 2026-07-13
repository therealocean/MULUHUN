"""
MULUHUN Backend — v4.1
Database: SQLite (built into Python — zero setup, no external service needed)
Auth: JWT with bcrypt password hashing
Full: signup, login, profile, contacts, IMAP inbox, SMTP send, ASR, translation

Powered by Awarri Technologies · N-ATLaS · NCAIR
"""

import os, io, smtplib, imaplib, email, sqlite3, uuid, soundfile as sf, torch, numpy as np
from difflib import SequenceMatcher
from datetime import datetime, timedelta
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.header import decode_header
from email.utils import parseaddr
from contextlib import contextmanager
from pathlib import Path

from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from typing import Optional
from pydantic import BaseModel
from dotenv import load_dotenv

from transformers import WhisperProcessor, WhisperForConditionalGeneration
from deep_translator import GoogleTranslator
from pydub import AudioSegment
from passlib.context import CryptContext
from jose import jwt, JWTError

load_dotenv()

#
# APP
#
app = FastAPI(title="MULUHUN v4.1")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
)

#
# DATABASE — SQLite
#
DB_PATH = Path("muluhun.db")

@contextmanager
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row   # rows behave like dicts
    conn.execute("PRAGMA journal_mode=WAL")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

def init_db():
    """Create tables on first run."""
    with get_db() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS users (
                id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
                name       TEXT NOT NULL,
                email      TEXT NOT NULL UNIQUE,
                password   TEXT NOT NULL,
                language   TEXT DEFAULT '',
                smtp_email TEXT DEFAULT '',
                smtp_pass  TEXT DEFAULT '',
                created_at TEXT DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS contacts (
                id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
                user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                name          TEXT NOT NULL,
                voice_tag     TEXT NOT NULL,
                email_address TEXT NOT NULL,
                created_at    TEXT DEFAULT (datetime('now'))
            );
        """)
    print(f"[MULUHUN] Database ready at {DB_PATH}")

# Initialise on startup
try:
    init_db()
    print("[MULUHUN] ✓ Database initialised successfully")
except Exception as e:
    print(f"[MULUHUN] ✗ Database init FAILED: {e}")
    raise

#
# AUTH
#
JWT_SECRET       = os.getenv("JWT_SECRET", "muluhun-change-this-in-production")
JWT_ALGORITHM    = "HS256"
JWT_EXPIRE_HOURS = 72

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
bearer      = HTTPBearer()

def hash_password(plain: str) -> str:
    return pwd_context.hash(plain[:72])

def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain[:72], hashed)

def create_token(user_id: str) -> str:
    exp = datetime.utcnow() + timedelta(hours=JWT_EXPIRE_HOURS)
    return jwt.encode({"sub": user_id, "exp": exp}, JWT_SECRET, algorithm=JWT_ALGORITHM)

def decode_token(token: str) -> str:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])["sub"]
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired session. Please log in again.")

async def get_current_user(creds: HTTPAuthorizationCredentials = Depends(bearer)) -> dict:
    user_id = decode_token(creds.credentials)
    with get_db() as conn:
        row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=401, detail="User not found.")
    return dict(row)

def _safe_user(user: dict) -> dict:
    return {
        "id":         user["id"],
        "name":       user["name"],
        "email":      user["email"],
        "language":   user.get("language", ""),
        "smtp_email": user.get("smtp_email", ""),
    }

#
# ASR MODEL REGISTRY
#
MODEL_CONFIG = {
    "yoruba": {"processor_id": "NCAIR1/Yoruba-ASR", "model_id": "NCAIR1/Yoruba-ASR", "src_lang": "yo"},
    "hausa":  {"processor_id": "NCAIR-NG/Hausa",    "model_id": "NCAIR1/Hausa-ASR",  "src_lang": "ha"},
    "igbo":   {"processor_id": "NCAIR1/Igbo-ASR",   "model_id": "NCAIR1/Igbo-ASR",   "src_lang": "ig"},
}
_asr_cache: dict = {}

def load_asr(language: str) -> tuple:
    if language not in _asr_cache:
        cfg = MODEL_CONFIG[language]
        print(f"[MULUHUN] Loading {language} ASR…")
        proc  = WhisperProcessor.from_pretrained(cfg["processor_id"])
        model = WhisperForConditionalGeneration.from_pretrained(cfg["model_id"])
        model.eval()
        _asr_cache[language] = (proc, model)
    return _asr_cache[language]

# 
# GENERIC WHISPER
#
_base_whisper = None
def get_base_whisper():
    global _base_whisper
    if _base_whisper is None:
        import whisper as ow
        print("[MULUHUN] Loading Whisper base…")
        _base_whisper = ow.load_model("base")
    return _base_whisper

#
# AUDIO DECODE
#
async def decode_audio(file: UploadFile) -> np.ndarray:
    content = await file.read()
    try:
        seg = AudioSegment.from_file(io.BytesIO(content))
        seg = seg.set_frame_rate(16000).set_channels(1).set_sample_width(2)
        return np.array(seg.get_array_of_samples(), dtype=np.float32) / 32768.0
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Audio decode error: {e}")

#
# LANGUAGE DETECTION
#
ALTS = {
    "yoruba": ["yoruba","oruba","ruba","yoba","europa","your oba","uroba","oroba",
               "aruba","youruba","reba","yorub","yoru","jeruba","ioruba","eruba","roba"],
    "hausa":  ["hausa","howsa","husa","ausa","haous","haus","hawsa","how sa",
               "house a","howza","haws","houza","haas","hauz"],
    "igbo":   ["igbo","igbu","ibo","ebo","egbo","agbo","ego","iggo","ee bo",
               "i bo","igo","igboo","iboo","eebo"],
}

def fuzzy_detect(text: str) -> str:
    t = text.lower().strip()
    for lang, alts in ALTS.items():
        for alt in alts:
            if alt in t: return lang
    best_lang, best_score = "unknown", 0.0
    for word in t.split():
        for lang in ALTS:
            score = SequenceMatcher(None, word, lang).ratio()
            if score > best_score:
                best_score, best_lang = score, lang
    return best_lang if best_score >= 0.60 else "unknown"

#
# EMAIL HELPERS
# 
def _decode_header_str(raw) -> str:
    parts = decode_header(raw or "")
    out = []
    for byt, enc in parts:
        if isinstance(byt, bytes):
            out.append(byt.decode(enc or "utf-8", errors="replace"))
        else:
            out.append(str(byt))
    return " ".join(out).strip()

def _get_body(msg) -> str:
    if msg.is_multipart():
        for part in msg.walk():
            ct = part.get_content_type()
            cd = str(part.get("Content-Disposition", ""))
            if ct == "text/plain" and "attachment" not in cd:
                charset = part.get_content_charset() or "utf-8"
                return part.get_payload(decode=True).decode(charset, errors="replace")
    else:
        charset = msg.get_content_charset() or "utf-8"
        return msg.get_payload(decode=True).decode(charset, errors="replace")
    return ""

def translate_to_native(text: str, lang_code: str) -> str:
    try:
        return GoogleTranslator(source="en", target=lang_code).translate(text).strip()
    except Exception:
        return text

def translate_to_english(text: str, src_lang: str) -> str:
    try:
        return GoogleTranslator(source=src_lang, target="en").translate(text).strip()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Translation error: {e}")

ENV_EMAIL = os.getenv("EMAIL_USER", "")
ENV_PASS  = os.getenv("EMAIL_PASS", "")

def _smtp_creds(user: dict = {}) -> tuple:
    smtp_email = user.get("smtp_email", "") or ENV_EMAIL
    smtp_pass  = user.get("smtp_pass",  "") or ENV_PASS
    if not smtp_email or not smtp_pass:
        raise HTTPException(
            status_code=400,
            detail="Email credentials not set. Add EMAIL_USER and EMAIL_PASS to your .env file."
        )
    return smtp_email, smtp_pass

def _send_via_smtp(smtp_email: str, smtp_pass: str, to: str, subject: str,
                   body: str, sender_name: str, in_reply_to: str = "") -> None:
    msg            = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"]    = f"{sender_name} <{smtp_email}>"
    msg["To"]      = to
    if in_reply_to:
        msg["In-Reply-To"] = in_reply_to
        msg["References"]  = in_reply_to
    html = f"""<html><body style="font-family:Georgia,serif;font-size:16px;color:#1a1a1a;
        max-width:600px;margin:auto;padding:32px;line-height:1.8">
      <p>{body.replace(chr(10), '<br>')}</p>
      <hr style="margin-top:40px;border:none;border-top:1px solid #e5e5e5"/>
      <p style="font-size:11px;color:#999;margin-top:12px">
        Sent via <strong>MULUHUN</strong> — Voice Email for Everyone.<br>
        <em>Powered by Awarri Technologies · N-ATLaS · NCAIR</em>
      </p></body></html>"""
    msg.attach(MIMEText(body, "plain", "utf-8"))
    msg.attach(MIMEText(html, "html", "utf-8"))
    smtp_host = os.getenv("SMTP_HOST", "smtp.gmail.com")
    smtp_port = int(os.getenv("SMTP_PORT", "587"))
    try:
        with smtplib.SMTP(smtp_host, smtp_port) as s:
            s.ehlo(); s.starttls(); s.login(smtp_email, smtp_pass)
            s.sendmail(smtp_email, to, msg.as_string())
    except smtplib.SMTPAuthenticationError:
        raise HTTPException(status_code=401, detail="Gmail auth failed. Check your App Password.")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"SMTP error: {e}")

# 
# AUTH ENDPOINTS
#

class SignupRequest(BaseModel):
    name:       str
    email:      str
    password:   str
    language:   str = ""
    smtp_email: str = ""
    smtp_pass:  str = ""

class LoginRequest(BaseModel):
    email:    str
    password: str

class UpdateProfileRequest(BaseModel):
    name:       Optional[str] = None
    language:   Optional[str] = None
    smtp_email: Optional[str] = None
    smtp_pass:  Optional[str] = None

@app.post("/signup")
async def signup(payload: SignupRequest):
    try:
        with get_db() as conn:
            existing = conn.execute(
                "SELECT id FROM users WHERE email = ?", (payload.email,)
            ).fetchone()
            if existing:
                raise HTTPException(status_code=400, detail="An account with this email already exists.")

            user_id = str(uuid.uuid4())
            conn.execute(
                """INSERT INTO users (id, name, email, password, language, smtp_email, smtp_pass)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (user_id, payload.name, payload.email, hash_password(payload.password),
                 payload.language, payload.smtp_email, payload.smtp_pass)
            )
            user = dict(conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone())
        return {"token": create_token(user_id), "user": _safe_user(user)}
    except HTTPException:
        raise
    except Exception as e:
        print(f"[SIGNUP ERROR] {type(e).__name__}: {e}")
        raise HTTPException(status_code=500, detail=f"Signup failed: {str(e)}")

@app.post("/login")
async def login(payload: LoginRequest):
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM users WHERE email = ?", (payload.email,)
        ).fetchone()

    if not row:
        raise HTTPException(status_code=401, detail="No account found with that email address.")

    user = dict(row)
    if not verify_password(payload.password, user["password"]):
        raise HTTPException(status_code=401, detail="Incorrect password.")

    return {"token": create_token(user["id"]), "user": _safe_user(user)}

@app.get("/profile")
async def get_profile(current_user: dict = Depends(get_current_user)):
    return _safe_user(current_user)

@app.patch("/profile")
async def update_profile(
    payload: UpdateProfileRequest,
    current_user: dict = Depends(get_current_user),
):
    updates = {k: v for k, v in payload.model_dump().items() if v is not None}
    if not updates:
        return {"status": "nothing to update"}
    set_clause = ", ".join(f"{k} = ?" for k in updates)
    values     = list(updates.values()) + [current_user["id"]]
    with get_db() as conn:
        conn.execute(f"UPDATE users SET {set_clause} WHERE id = ?", values)
    return {"status": "updated", "updated_fields": list(updates.keys())}

#
# CONTACTS
#

class ContactRequest(BaseModel):
    name:          str
    voice_tag:     str
    email_address: str

@app.get("/contacts")
async def get_contacts(current_user: dict = Depends(get_current_user)):
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM contacts WHERE user_id = ?", (current_user["id"],)
        ).fetchall()
    return {"contacts": [dict(r) for r in rows]}

@app.post("/contacts")
async def add_contact(
    payload: ContactRequest,
    current_user: dict = Depends(get_current_user),
):
    contact_id = str(uuid.uuid4())
    with get_db() as conn:
        conn.execute(
            """INSERT INTO contacts (id, user_id, name, voice_tag, email_address)
               VALUES (?, ?, ?, ?, ?)""",
            (contact_id, current_user["id"], payload.name,
             payload.voice_tag.lower().strip(), payload.email_address)
        )
        row = conn.execute(
            "SELECT * FROM contacts WHERE id = ?", (contact_id,)
        ).fetchone()
    return {"status": "saved", "contact": dict(row)}

@app.delete("/contacts/{contact_id}")
async def delete_contact(
    contact_id: str,
    current_user: dict = Depends(get_current_user),
):
    with get_db() as conn:
        conn.execute(
            "DELETE FROM contacts WHERE id = ? AND user_id = ?",
            (contact_id, current_user["id"])
        )
    return {"status": "deleted"}

@app.get("/contacts/resolve")
async def resolve_contact(
    voice_tag: str,
    current_user: dict = Depends(get_current_user),
):
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM contacts WHERE user_id = ?", (current_user["id"],)
        ).fetchall()
    contacts = [dict(r) for r in rows]
    tag = voice_tag.lower().strip()
    best, best_score = None, 0.0
    for c in contacts:
        score = SequenceMatcher(None, tag, c["voice_tag"]).ratio()
        if tag in c["voice_tag"] or c["voice_tag"] in tag:
            score = max(score, 0.9)
        if score > best_score:
            best_score, best = score, c
    if best and best_score >= 0.55:
        return {"found": True, "contact": best}
    return {"found": False, "contact": None}

#
# VOICE / ASR
#

@app.post("/set-language")
async def set_language(file: UploadFile = File(...)):
    audio = await decode_audio(file)
    tmp   = "_lang.wav"
    sf.write(tmp, audio, 16000)
    try:
        w    = get_base_whisper()
        t1   = w.transcribe(tmp, language="en")["text"].lower().strip()
        lang = fuzzy_detect(t1)
        if lang == "unknown":
            t2   = w.transcribe(tmp)["text"].lower().strip()
            lang = fuzzy_detect(t2)
        return {"language": lang, "heard": t1}
    finally:
        if os.path.exists(tmp): os.remove(tmp)

@app.post("/translate-message")
async def translate_message(
    file:         UploadFile = File(...),
    language:     str        = Form(...),
):
    if language not in MODEL_CONFIG:
        raise HTTPException(status_code=400, detail=f"Unknown language: {language}")
    audio       = await decode_audio(file)
    proc, model = load_asr(language)
    feats       = proc(audio, sampling_rate=16000, return_tensors="pt").input_features
    with torch.no_grad():
        ids = model.generate(feats)
    native  = proc.batch_decode(ids, skip_special_tokens=True)[0].strip()
    english = translate_to_english(native, MODEL_CONFIG[language]["src_lang"])
    return {"native_text": native, "translated_text": english, "language": language}

#
# EMAIL
#

class SendEmailRequest(BaseModel):
    to_address:  str
    subject:     str
    body:        str
    in_reply_to: str = ""

@app.post("/send-email")
async def send_email(
    payload: SendEmailRequest,
):
    smtp_email, smtp_pass = _smtp_creds()
    sender_name = os.getenv("SENDER_NAME", "MULUHUN User")
    _send_via_smtp(smtp_email, smtp_pass, payload.to_address,
                   payload.subject, payload.body, sender_name,
                   payload.in_reply_to)
    return {"status": "sent", "to": payload.to_address}

@app.post("/reply-email")
async def reply_email(
    payload: SendEmailRequest,
):
    smtp_email, smtp_pass = _smtp_creds()
    sender_name = os.getenv("SENDER_NAME", "MULUHUN User")
    subject = payload.subject if payload.subject.startswith("Re:") else f"Re: {payload.subject}"
    _send_via_smtp(smtp_email, smtp_pass, payload.to_address,
                   subject, payload.body, sender_name,
                   payload.in_reply_to)
    return {"status": "replied", "to": payload.to_address}

@app.get("/inbox")
async def fetch_inbox(
    limit:    int = 15,
    language: str = "yoruba",
):
    smtp_email, smtp_pass = _smtp_creds()
    lang_code = MODEL_CONFIG.get(language, {}).get("src_lang", "yo")
    try:
        mail = imaplib.IMAP4_SSL(
            os.getenv("IMAP_HOST", "imap.gmail.com"),
            int(os.getenv("IMAP_PORT", "993"))
        )
        mail.login(smtp_email, smtp_pass)
        mail.select("INBOX")
        _, data    = mail.search(None, "ALL")
        all_ids    = data[0].split()
        recent_ids = list(reversed(all_ids[-limit:] if len(all_ids) >= limit else all_ids))

        emails = []
        for uid in recent_ids:
            _, msg_data  = mail.fetch(uid, "(RFC822)")
            msg          = email.message_from_bytes(msg_data[0][1])
            subject      = _decode_header_str(msg.get("Subject", "(no subject)"))
            from_raw     = msg.get("From", "")
            from_name, from_addr = parseaddr(from_raw)
            from_name    = _decode_header_str(from_name) or from_addr
            body_en      = _get_body(msg).strip()[:2000]

            subject_native = translate_to_native(subject, lang_code)
            body_native    = translate_to_native(body_en, lang_code) if body_en else ""
            sender_intro   = {
                "yo": f"Ifiranṣẹ lati ọdọ {from_name}",
                "ha": f"Sako daga {from_name}",
                "ig": f"Ozi si {from_name}",
            }.get(lang_code, f"Message from {from_name}")

            _, flags_data = mail.fetch(uid, "(FLAGS)")
            flags   = flags_data[0].decode() if flags_data[0] else ""
            is_read = "\\Seen" in flags

            emails.append({
                "id":                  uid.decode(),
                "subject":             subject,
                "subject_native":      subject_native,
                "from_name":           from_name,
                "from_address":        from_addr,
                "sender_intro_native": sender_intro,
                "date":                msg.get("Date", ""),
                "body_english":        body_en,
                "body_native":         body_native,
                "is_read":             is_read,
            })
        mail.logout()
        return {"emails": emails, "total": len(emails)}
    except imaplib.IMAP4.error as e:
        raise HTTPException(status_code=401, detail=f"IMAP login failed: {e}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Inbox error: {e}")

class MarkReadRequest(BaseModel):
    email_id: str

@app.post("/mark-read")
async def mark_read(
    payload: MarkReadRequest,
):
    smtp_email, smtp_pass = _smtp_creds()
    try:
        mail = imaplib.IMAP4_SSL(
            os.getenv("IMAP_HOST", "imap.gmail.com"),
            int(os.getenv("IMAP_PORT", "993"))
        )
        mail.login(smtp_email, smtp_pass)
        mail.select("INBOX")
        mail.store(payload.email_id.encode(), "+FLAGS", "\\Seen")
        mail.logout()
        return {"status": "marked_read"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Mark-read error: {e}")

#
# HEALTH
#
@app.get("/")
def health():
    return {
        "status":        "MULUHUN v4.1 running",
        "database":      str(DB_PATH),
        "db_exists":     DB_PATH.exists(),
        "models_loaded": list(_asr_cache.keys()) or "none yet",
    }

@app.get("/test-signup")
def test_signup():
    """Quick test to verify DB is working — visit this URL to confirm."""
    try:
        with get_db() as conn:
            count = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
        return {"status": "db_ok", "user_count": count}
    except Exception as e:
        return {"status": "db_error", "error": str(e)}