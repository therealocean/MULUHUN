<div align="center">

# 🎙️ MULUHUN
### Voice for Every Tongue

**A voice-based email system for the visually impaired with indigenous Nigerian language support**

[![Next.js](https://img.shields.io/badge/Frontend-Next.js%2015-black?style=flat-square&logo=next.js)](https://nextjs.org)
[![FastAPI](https://img.shields.io/badge/Backend-FastAPI-009688?style=flat-square&logo=fastapi)](https://fastapi.tiangolo.com)
[![Python](https://img.shields.io/badge/Python-3.10%2B-3776AB?style=flat-square&logo=python)](https://python.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-3178C6?style=flat-square&logo=typescript)](https://typescriptlang.org)
[![HuggingFace](https://img.shields.io/badge/AI-HuggingFace%20Transformers-FFD21E?style=flat-square&logo=huggingface)](https://huggingface.co)
[![License](https://img.shields.io/badge/License-MIT-purple?style=flat-square)](LICENSE)

<br/>

**Yoruba · Hausa · Igbo · English**

*Designed for the 4 million visually impaired Nigerians excluded from digital communication by English-centric, visual-heavy interfaces.*

</div>

---

## 📖 Table of Contents

- [Overview](#-overview)
- [Key Features](#-key-features)
- [System Architecture](#-system-architecture)
- [Tech Stack](#-tech-stack)
- [AI Models](#-ai-models)
- [Voice Commands](#-voice-commands)
- [Installation](#-installation)
- [Configuration](#-configuration)
- [Running the System](#-running-the-system)
- [API Reference](#-api-reference)
- [Project Structure](#-project-structure)
- [Roadmap](#-roadmap)
- [Attribution](#-attribution)
- [Author](#-author)

---

## Overview

**MULUHUN** (derived from the word for *"voice"* across Yoruba, Hausa, and Igbo) is a full-stack web application that enables visually impaired Nigerians to compose, send, receive, and manage emails entirely through voice — in their mother tongue.

The system bridges two critical barriers simultaneously:

| Barrier | How MULUHUN Solves It |
|---|---|
| **Visual dependency** | Fully voice-driven UI — no reading required |
| **English-only interfaces** | Complete support for Yoruba, Hausa, and Igbo |

Users speak in their native language. The system transcribes using **language-specific Nigerian AI models**, translates to professional English, and sends the email — without the user needing to type a single character.

Incoming emails are fetched, translated to the user's language, and read aloud automatically. The inbox announces unread counts, assigns a number to each email, and responds to spoken navigation commands in the user's language.

---

## Key Features

- 🎙️ **Hands-free voice interface** — tap anywhere or press any key to activate the command mic
- 🔊 **Automatic inbox announcement** — system reads unread count and email summaries aloud on load
- 🔢 **Number-based navigation** — say "one" / "ọkan" / "ɗaya" / "otu" to open any email instantly
- 🌐 **Three indigenous languages** — full Yoruba, Hausa, and Igbo support throughout
- 📨 **Voice compose & send** — speak in your language, recipient gets professional English
- 📥 **Email reading** — incoming emails translated and read aloud in the user's language
- 💬 **Threaded voice replies** — proper `In-Reply-To` headers for full email threading
- 🧠 **9 voice commands** — compose, reply, read aloud, send, redo, next, inbox, stop, open by number
- ⚡ **Fuzzy command matching** — handles accented speech and transcription imperfections via difflib
- 🗃️ **SQLite database** — zero-config local storage for user profiles and contacts
- 🔐 **JWT authentication** — secure session management with bcrypt password hashing

---

## System Architecture

```
┌──────────────────────────────────────────────────────────────┐
│               USER (Visually Impaired)                        │
│           Speaks in Yoruba / Hausa / Igbo                     │
└─────────────────────┬────────────────────────────────────────┘
                      │  Tap / Keypress → 3–10s recording
                      ▼
┌──────────────────────────────────────────────────────────────┐
│                  NEXT.JS 15 FRONTEND                          │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────────┐ │
│  │ Onboarding  │  │    Inbox     │  │  Compose / Reply     │ │
│  │ (Lang Det.) │  │  (Numbered)  │  │  (Voice Recording)   │ │
│  └─────────────┘  └──────────────┘  └──────────────────────┘ │
│       MediaRecorder API  ·  Web Speech API (TTS)              │
└─────────────────────┬────────────────────────────────────────┘
                      │  HTTP / REST  (multipart audio, JSON)
                      ▼
┌──────────────────────────────────────────────────────────────┐
│                    FASTAPI BACKEND                            │
│  ┌───────────────┐  ┌────────────────┐  ┌─────────────────┐  │
│  │/set-language  │  │/translate-msg  │  │   /inbox        │  │
│  │ Whisper Base  │  │ NCAIR1 ASR  →  │  │   IMAP SSL      │  │
│  │ + Fuzzy Match │  │ Google Transl. │  │   + Translation │  │
│  └───────────────┘  └────────────────┘  └─────────────────┘  │
│  ┌───────────────┐  ┌────────────────┐  ┌─────────────────┐  │
│  │ /send-email   │  │ /reply-email   │  │  /mark-read     │  │
│  │ SMTP STARTTLS │  │ Thread headers │  │  IMAP \Seen     │  │
│  └───────────────┘  └────────────────┘  └─────────────────┘  │
└───────────────┬──────────────────────┬───────────────────────┘
                │                      │
                ▼                      ▼
    ┌─────────────────┐     ┌──────────────────┐
    │   SQLite DB     │     │  Gmail Servers   │
    │ Users, Contacts │     │  IMAP 993 (SSL)  │
    │  (muluhun.db)   │     │  SMTP 587 (TLS)  │
    └─────────────────┘     └──────────────────┘
```

---

## Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| **Frontend** | Next.js 15 (TypeScript) | Reactive voice-driven UI |
| **Styling** | Tailwind CSS | High-contrast accessible design |
| **Backend** | FastAPI (Python) | REST API, ASR pipeline, email |
| **ASR** | HuggingFace Transformers | NCAIR1 indigenous language models |
| **Language Detection** | OpenAI Whisper Base | Detect spoken language name |
| **Translation** | deep_translator (Google Translate) | Native ↔ English translation |
| **TTS** | Web Speech API (SpeechSynthesis) | Speak emails aloud in native language |
| **Audio** | MediaRecorder API + pydub | Browser recording + audio processing |
| **Email (Inbound)** | imaplib — IMAP SSL port 993 | Fetch Gmail inbox |
| **Email (Outbound)** | smtplib — SMTP STARTTLS port 587 | Send emails via Gmail |
| **Database** | SQLite + Python sqlite3 | Users, contacts, session data |
| **Auth** | python-jose (JWT) + passlib (bcrypt) | Secure session management |
| **Fuzzy Matching** | Python difflib SequenceMatcher | Robust voice command recognition |

---

## AI Models

MULUHUN uses **two categories** of speech recognition, selected by task:

### Language Detection — Whisper Base (OpenAI)
Used to detect which of the three languages the user is speaking. A dual-pass approach (with and without language hint) combined with a curated phonetic near-miss list ensures detection works even with strong Nigerian accents.

### Message Transcription — NCAIR1 Models (Awarri Technologies)

| Model | HuggingFace ID | Language |
|---|---|---|
| Yoruba ASR | `NCAIR1/Yoruba-ASR` | Yoruba |
| Hausa ASR | `NCAIR1/Hausa-ASR` | Hausa (processor: `NCAIR-NG/Hausa`) |
| Igbo ASR | `NCAIR1/Igbo-ASR` | Igbo |

These are **fine-tuned Whisper Small** variants trained on **600+ hours** of Nigerian indigenous speech collected from all six geopolitical zones, under the **N-ATLaS** initiative of the Federal Ministry of Communications, Innovation and Digital Economy.

> Models are **lazy-loaded** on first request (~500MB per language) and cached in memory. Cold start takes ~38 seconds; subsequent requests complete in 4–5 seconds.

---

## Voice Commands

All commands work in **Yoruba, Hausa, Igbo, and English**. Activate by tapping anywhere or pressing any key. A floating mic button is always visible in the bottom-right corner.

| Action | Yoruba | Hausa | Igbo | English |
|---|---|---|---|---|
| Compose new email | kọ ifiranṣẹ | rubuta saƙo | dee ozi | compose / write |
| Read latest email | ka ifiranṣẹ | karanta saƙo | gụọ ozi | read email |
| Open email by number | sọ nọmba | faɗi lamba | kwuo nọmba | say digit (1, 2…) |
| Reply to email | dahun | amsa | zaghachi | reply |
| Go to inbox | apoti ifiranṣẹ | akwatin saƙo | igbe ozi | inbox |
| Read email aloud | sọ fun mi | karanta | gụọ ya | read aloud |
| Send (on review screen) | firanṣẹ | aika | zipu | send |
| Redo recording | tún ṣe | yi shi | mee ọzọ | redo / again |
| Next email | atẹle | na gaba | nke ọzọ | next |
| Stop reading | dáwọ dúró | tsaya | kwụsị | stop |

Number words also work in all four languages: ọkan / ɗaya / otu / one = 1, through to ten.

---

## Installation

### Prerequisites

- Python **3.10+**
- Node.js **18+** and npm
- A **Gmail account** with:
  - 2-Step Verification enabled
  - IMAP access enabled *(Gmail → Settings → Forwarding and POP/IMAP → Enable IMAP)*
  - An **App Password** from [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords)
- A microphone-enabled device
- Stable internet connection (for IMAP, SMTP, and translation API)

---

### Step 1 — Clone the Repository

```bash
git clone https://github.com/therealocean/MULUHUN.git
cd MULUHUN
```

### Step 2 — Backend Setup

```bash
cd backend

# Create virtual environment
python -m venv venv

# Activate — Windows
venv\Scripts\activate

# Activate — macOS / Linux
source venv/bin/activate

# Install all dependencies
pip install fastapi uvicorn python-multipart transformers torch torchaudio \
            librosa soundfile pydub deep-translator openai-whisper \
            python-dotenv passlib[bcrypt] python-jose httpx
```

### Step 3 — Frontend Setup

```bash
cd ../frontend
npm install
```

---

## ⚙️ Configuration

Create a `.env` file inside the `backend/` folder:

```env
# ── Gmail credentials ─────────────────────────────────────────
EMAIL_USER=your_gmail@gmail.com
EMAIL_PASS=xxxx xxxx xxxx xxxx     # 16-char App Password — NOT your Gmail password

# Display name in the From field of outgoing emails
SENDER_NAME=Your Full Name

# ── Session security ──────────────────────────────────────────
JWT_SECRET=replace-with-a-long-random-secret-string

# ── Gmail SMTP (outgoing) ────────────────────────────────────
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587

# ── Gmail IMAP (incoming) ────────────────────────────────────
IMAP_HOST=imap.gmail.com
IMAP_PORT=993
```

> ⚠️ **Never commit `.env` to version control.** It is already listed in `.gitignore`.

---

## Running the System

### Start the Backend

```bash
cd backend
venv\Scripts\activate          # Windows
# source venv/bin/activate     # macOS / Linux

uvicorn muluhun_backend_v4:app --host 127.0.0.1 --port 8080 --reload
```

Expected output:
```
[MULUHUN] Database ready at backend/muluhun.db
INFO:     Uvicorn running on http://127.0.0.1:8080
INFO:     Application startup complete.
```

Visit [http://127.0.0.1:8080](http://127.0.0.1:8080) to confirm:
```json
{
  "status": "MULUHUN v4 running",
  "db_exists": true,
  "models_loaded": "none yet"
}
```

### Start the Frontend

```bash
cd frontend
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in Chrome or Edge and **grant microphone permission** when prompted.

> 💡 The first voice request for each language triggers a one-time model download from HuggingFace (~500MB). This takes ~38 seconds. All subsequent requests for that language complete in 4–5 seconds from cache.

---

## 📡 API Reference

| Endpoint | Method | Description |
|---|---|---|
| `/` | GET | Health check — confirms server and DB status |
| `/set-language` | POST | Detect spoken language via Whisper Base + fuzzy matching |
| `/translate-message` | POST | Transcribe indigenous voice (NCAIR1 ASR) → English |
| `/inbox` | GET | Fetch inbox via IMAP + return native-language translations |
| `/send-email` | POST | Send a new email via Gmail SMTP |
| `/reply-email` | POST | Send a threaded reply with `In-Reply-To` headers |
| `/mark-read` | POST | Set `\Seen` IMAP flag on a specified email |
| `/contacts` | GET / POST | List or add voice-tagged contacts |
| `/contacts/resolve` | GET | Fuzzy-match spoken voice tag to a contact's email |

### Example — Translate Voice Message

```bash
curl -X POST http://127.0.0.1:8080/translate-message \
  -F "file=@recording.webm" \
  -F "language=yoruba"
```

```json
{
  "native_text": "Mo fẹ fi ifiranṣẹ ranṣẹ si ọ nípa ìpàdé wa",
  "translated_text": "I want to send you a message about our meeting",
  "language": "yoruba"
}
```

### Example — Fetch Inbox (Hausa)

```bash
curl "http://127.0.0.1:8080/inbox?limit=10&language=hausa"
```

Each email in the response includes `subject_native`, `body_native`, and `sender_intro_native` — all pre-translated for immediate TTS playback.

---


## 📁 Project Structure

```
MULUHUN/
│
├── backend/
│   ├── main.py     # Main FastAPI application
│   ├── muluhun.db                # SQLite database
│   ├── .env                      # Environment variables (not committed)
│   ├── .env.example              # Environment variable template
│   └── requirements.txt          # Python dependencies
│
├── frontend/
│   ├── app/
│   │   └── page.tsx              # Main application (voice UI, 1,100+ lines)
│   ├── public/
│   ├── next.config.ts
│   └── package.json
│
├── docs/
│   └── screenshots/              # Application screenshots
│
├── .gitignore
├── LICENSE
└── README.md
```

---

## Roadmap

- [x] Voice language detection (Yoruba / Hausa / Igbo)
- [x] NCAIR1 ASR transcription pipeline
- [x] IMAP inbox fetch with native language translation
- [x] Voice compose and send via SMTP
- [x] Threaded voice replies
- [x] 9-command voice command engine (tap / keypress activated)
- [x] Automatic inbox announcement with email numbering
- [x] Number-based email navigation (supports all four languages)
- [x] SQLite user profiles and contacts
- [x] JWT authentication infrastructure
- [ ] Phone OTP login (accessibility-first auth)
- [ ] Voice-activated contact book ("email my daughter")
- [ ] Native Android / iOS application with TalkBack & VoiceOver
- [ ] Expand to Efik, Tiv, Ibibio, Fulfulde via N-ATLaS
- [ ] Offline PWA mode with inbox caching
- [ ] Production deployment (Vercel + cloud backend)
- [ ] Formal usability testing with visually impaired target users

---

## 📜 Attribution

The NCAIR1 ASR models used in this project are developed by **Awarri Technologies** in partnership with the **Federal Government of Nigeria**, as part of the **N-ATLaS** (Nigeria – Automatic Transcription and Language Systems) initiative of the **Federal Ministry of Communications, Innovation and Digital Economy**.

> *Powered by Awarri Technologies · N-ATLaS · NCAIR*

Please ensure proper attribution when using or referencing these models in any derivative work.


---

## 👨🏾‍💻 Author

**Jumbo Nelson Ogah**
B.Sc. Computer Science — Trinity University, Lagos (2025)

---

<div align="center">

*"Digital communication should be accessible to every tongue — regardless of sight or language."*

**MULUHUN · Voice for Every Tongue**

</div>
