"""
MULUHUN Backend — v3.0
Full email automation: IMAP inbox fetch + SMTP send + NCAIR1 ASR + translation.

Powered by Awarri Technologies · N-ATLaS · NCAIR
"""

import os, io, smtplib, imaplib, email, json, soundfile as sf, torch, numpy as np
from difflib import SequenceMatcher
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.header import decode_header
from email.utils import parseaddr
from datetime import datetime

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

from transformers import WhisperProcessor, WhisperForConditionalGeneration
from deep_translator import GoogleTranslator
from pydub import AudioSegment

load_dotenv()

# ─────────────────────────────────────────────────────────────────────────────
# APP
# ─────────────────────────────────────────────────────────────────────────────
app = FastAPI(title="MULUHUN v3")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# ─────────────────────────────────────────────────────────────────────────────
# ENV / CREDENTIALS
# ─────────────────────────────────────────────────────────────────────────────
SMTP_HOST     = os.getenv("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT     = int(os.getenv("SMTP_PORT", "587"))
IMAP_HOST     = os.getenv("IMAP_HOST", "imap.gmail.com")
IMAP_PORT     = int(os.getenv("IMAP_PORT", "993"))
EMAIL_USER    = os.getenv("EMAIL_USER", "")       # your Gmail address
EMAIL_PASS    = os.getenv("EMAIL_PASS", "")       # Gmail App Password
SENDER_NAME   = os.getenv("SENDER_NAME", "MULUHUN User")

def _check_creds():
    if not EMAIL_USER or not EMAIL_PASS:
        raise HTTPException(
            status_code=500,
            detail="Email credentials missing. Set EMAIL_USER and EMAIL_PASS in your .env file."
        )

# ─────────────────────────────────────────────────────────────────────────────
# ASR MODEL REGISTRY  (NCAIR1 / Awarri)
# ─────────────────────────────────────────────────────────────────────────────
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

# ─────────────────────────────────────────────────────────────────────────────
# GENERIC WHISPER  (language detection only)
# ─────────────────────────────────────────────────────────────────────────────
_base_whisper = None
def get_base_whisper():
    global _base_whisper
    if _base_whisper is None:
        import whisper as ow
        print("[MULUHUN] Loading Whisper base…")
        _base_whisper = ow.load_model("base")
    return _base_whisper

# ─────────────────────────────────────────────────────────────────────────────
# AUDIO DECODE
# ─────────────────────────────────────────────────────────────────────────────
async def decode_audio(file: UploadFile) -> np.ndarray:
    content = await file.read()
    try:
        seg = AudioSegment.from_file(io.BytesIO(content))
        seg = seg.set_frame_rate(16000).set_channels(1).set_sample_width(2)
        arr = np.array(seg.get_array_of_samples(), dtype=np.float32) / 32768.0
        return arr
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Audio decode error: {e}")

# ─────────────────────────────────────────────────────────────────────────────
# FUZZY LANGUAGE DETECTION
# ─────────────────────────────────────────────────────────────────────────────
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
    # difflib fallback
    best_lang, best_score = "unknown", 0.0
    for word in t.split():
        for lang in ALTS:
            score = SequenceMatcher(None, word, lang).ratio()
            if score > best_score:
                best_score, best_lang = score, lang
    return best_lang if best_score >= 0.60 else "unknown"

# ─────────────────────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────────────────────
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
    """Extract plain-text body from an email.message.Message object."""
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

def translate_to_native(text: str, target_lang_code: str) -> str:
    """Translate English email body → native language for TTS readback."""
    try:
        return GoogleTranslator(source="en", target=target_lang_code).translate(text).strip()
    except Exception:
        return text  # fallback: return English if translation fails

def translate_to_english(text: str, src_lang_code: str) -> str:
    try:
        return GoogleTranslator(source=src_lang_code, target="en").translate(text).strip()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Translation error: {e}")

# ─────────────────────────────────────────────────────────────────────────────
# ENDPOINT 1 — Language detection
# ─────────────────────────────────────────────────────────────────────────────
@app.post("/set-language")
async def set_language(file: UploadFile = File(...)):
    audio = await decode_audio(file)
    tmp = "_lang.wav"
    sf.write(tmp, audio, 16000)
    try:
        w = get_base_whisper()
        r1 = w.transcribe(tmp, language="en")
        t1 = r1["text"].lower().strip()
        print(f"[lang] pass1: '{t1}'")
        lang = fuzzy_detect(t1)
        if lang == "unknown":
            r2 = w.transcribe(tmp)
            t2 = r2["text"].lower().strip()
            print(f"[lang] pass2: '{t2}'")
            lang = fuzzy_detect(t2)
        return {"language": lang, "heard": t1}
    finally:
        if os.path.exists(tmp): os.remove(tmp)

# ─────────────────────────────────────────────────────────────────────────────
# ENDPOINT 2 — Transcribe + translate voice message
# ─────────────────────────────────────────────────────────────────────────────
@app.post("/translate-message")
async def translate_message(file: UploadFile = File(...), language: str = Form(...)):
    if language not in MODEL_CONFIG:
        raise HTTPException(status_code=400, detail=f"Unknown language: {language}")
    audio = await decode_audio(file)
    proc, model = load_asr(language)
    feats = proc(audio, sampling_rate=16000, return_tensors="pt").input_features
    with torch.no_grad():
        ids = model.generate(feats)
    native = proc.batch_decode(ids, skip_special_tokens=True)[0].strip()
    print(f"[{language}] native: {native}")
    english = translate_to_english(native, MODEL_CONFIG[language]["src_lang"])
    print(f"[{language}] → en: {english}")
    return {"native_text": native, "translated_text": english, "language": language}

# ─────────────────────────────────────────────────────────────────────────────
# ENDPOINT 3 — Send email
# ─────────────────────────────────────────────────────────────────────────────
class SendEmailRequest(BaseModel):
    to_address: str
    subject: str
    body: str
    sender_display_name: str = SENDER_NAME

@app.post("/send-email")
async def send_email(payload: SendEmailRequest):
    _check_creds()
    msg            = MIMEMultipart("alternative")
    msg["Subject"] = payload.subject
    msg["From"]    = f"{payload.sender_display_name} <{EMAIL_USER}>"
    msg["To"]      = payload.to_address

    msg.attach(MIMEText(payload.body, "plain", "utf-8"))
    html = f"""<html><body style="font-family:Georgia,serif;font-size:16px;color:#1a1a1a;
        max-width:600px;margin:auto;padding:32px;line-height:1.8">
      <p>{payload.body.replace(chr(10),'<br>')}</p>
      <hr style="margin-top:40px;border:none;border-top:1px solid #e5e5e5"/>
      <p style="font-size:11px;color:#999;margin-top:12px">
        Sent via <strong>MULUHUN</strong> — Voice Email for Everyone.<br>
        <em>Powered by Awarri Technologies · N-ATLaS · NCAIR</em>
      </p></body></html>"""
    msg.attach(MIMEText(html, "html", "utf-8"))

    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as s:
            s.ehlo(); s.starttls(); s.login(EMAIL_USER, EMAIL_PASS)
            s.sendmail(EMAIL_USER, payload.to_address, msg.as_string())
        return {"status": "sent", "to": payload.to_address}
    except smtplib.SMTPAuthenticationError:
        raise HTTPException(status_code=401, detail="Gmail auth failed. Use an App Password.")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"SMTP error: {e}")

# ─────────────────────────────────────────────────────────────────────────────
# ENDPOINT 4 — Fetch inbox via IMAP  ← NEW
# ─────────────────────────────────────────────────────────────────────────────
@app.get("/inbox")
async def fetch_inbox(limit: int = 10, language: str = "yoruba"):
    """
    Connects via IMAP, fetches the {limit} most recent emails,
    and returns each with its English body + native-language translation for TTS.
    """
    _check_creds()
    lang_code = MODEL_CONFIG.get(language, {}).get("src_lang", "yo")

    try:
        mail = imaplib.IMAP4_SSL(IMAP_HOST, IMAP_PORT)
        mail.login(EMAIL_USER, EMAIL_PASS)
        mail.select("INBOX")

        # Fetch all message IDs, take the most recent {limit}
        _, data = mail.search(None, "ALL")
        all_ids = data[0].split()
        recent_ids = all_ids[-limit:] if len(all_ids) >= limit else all_ids
        recent_ids = list(reversed(recent_ids))   # newest first

        emails = []
        for uid in recent_ids:
            _, msg_data = mail.fetch(uid, "(RFC822)")
            raw = msg_data[0][1]
            msg = email.message_from_bytes(raw)

            subject   = _decode_header_str(msg.get("Subject", "(no subject)"))
            from_raw  = msg.get("From", "")
            from_name, from_addr = parseaddr(from_raw)
            from_name = _decode_header_str(from_name) or from_addr
            date_str  = msg.get("Date", "")
            body_en   = _get_body(msg).strip()[:2000]   # cap at 2000 chars

            # Translate subject and body to native language
            subject_native = translate_to_native(subject, lang_code) if subject else subject
            body_native    = translate_to_native(body_en, lang_code) if body_en else ""

            # Native-language sender announcement for TTS
            sender_intro_templates = {
                "yo": f"Ifiranṣẹ lati ọdọ {from_name}",
                "ha": f"Sako daga {from_name}",
                "ig": f"Ozi si {from_name}",
            }
            sender_intro_native = sender_intro_templates.get(
                lang_code, f"Message from {from_name}"
            )

            # Check if unread
            _, flags_data = mail.fetch(uid, "(FLAGS)")
            flags = flags_data[0].decode() if flags_data[0] else ""
            is_read = "\\Seen" in flags

            emails.append({
                "id":                  uid.decode(),
                "subject":             subject,
                "subject_native":      subject_native,
                "from_name":           from_name,
                "from_address":        from_addr,
                "sender_intro_native": sender_intro_native,
                "date":                date_str,
                "body_english":        body_en,
                "body_native":         body_native,
                "is_read":             is_read,
                "lang_code":           lang_code,
            })

        mail.logout()
        return {"emails": emails, "total": len(emails)}

    except imaplib.IMAP4.error as e:
        raise HTTPException(status_code=401, detail=f"IMAP login failed: {e}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Inbox error: {e}")

# ─────────────────────────────────────────────────────────────────────────────
# ENDPOINT 5 — Mark email as read
# ─────────────────────────────────────────────────────────────────────────────
class MarkReadRequest(BaseModel):
    email_id: str

@app.post("/mark-read")
async def mark_read(payload: MarkReadRequest):
    _check_creds()
    try:
        mail = imaplib.IMAP4_SSL(IMAP_HOST, IMAP_PORT)
        mail.login(EMAIL_USER, EMAIL_PASS)
        mail.select("INBOX")
        mail.store(payload.email_id.encode(), "+FLAGS", "\\Seen")
        mail.logout()
        return {"status": "marked_read", "id": payload.email_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Mark-read error: {e}")

# ─────────────────────────────────────────────────────────────────────────────
# ENDPOINT 6 — Reply to an email
# ─────────────────────────────────────────────────────────────────────────────
class ReplyRequest(BaseModel):
    to_address: str
    subject: str
    body: str
    in_reply_to: str = ""   # original Message-ID for threading
    sender_display_name: str = SENDER_NAME

@app.post("/reply-email")
async def reply_email(payload: ReplyRequest):
    _check_creds()
    msg            = MIMEMultipart("alternative")
    msg["Subject"] = payload.subject if payload.subject.startswith("Re:") else f"Re: {payload.subject}"
    msg["From"]    = f"{payload.sender_display_name} <{EMAIL_USER}>"
    msg["To"]      = payload.to_address
    if payload.in_reply_to:
        msg["In-Reply-To"] = payload.in_reply_to
        msg["References"]  = payload.in_reply_to

    msg.attach(MIMEText(payload.body, "plain", "utf-8"))
    html = f"""<html><body style="font-family:Georgia,serif;font-size:16px;color:#1a1a1a;
        max-width:600px;margin:auto;padding:32px;line-height:1.8">
      <p>{payload.body.replace(chr(10),'<br>')}</p>
      <hr style="margin-top:40px;border:none;border-top:1px solid #e5e5e5"/>
      <p style="font-size:11px;color:#999">
        Sent via <strong>MULUHUN</strong> — Voice Email for Everyone.<br>
        <em>Powered by Awarri Technologies · N-ATLaS · NCAIR</em>
      </p></body></html>"""
    msg.attach(MIMEText(html, "html", "utf-8"))

    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as s:
            s.ehlo(); s.starttls(); s.login(EMAIL_USER, EMAIL_PASS)
            s.sendmail(EMAIL_USER, payload.to_address, msg.as_string())
        return {"status": "replied", "to": payload.to_address}
    except smtplib.SMTPAuthenticationError:
        raise HTTPException(status_code=401, detail="Gmail auth failed. Use an App Password.")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Reply error: {e}")

# ─────────────────────────────────────────────────────────────────────────────
# HEALTH
# ─────────────────────────────────────────────────────────────────────────────
@app.get("/")
def health():
    return {
        "status": "MULUHUN v3 running",
        "email_configured": bool(EMAIL_USER and EMAIL_PASS),
        "models_loaded": list(_asr_cache.keys()) or "none yet",
    }