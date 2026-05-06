'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';

// ─── Constants ────────────────────────────────────────────────────────────────
const BACKEND = 'http://127.0.0.1:8080';

const LANG_META: Record<string, {
  label: string; bcp47: string; thanks: string; prompt: string; greeting: string;
  cmdPrompt: string; cmdNotUnderstood: string; cmdComposing: string;
  cmdReplying: string; cmdReading: string; cmdSending: string; cmdRedoing: string;
}> = {
  yoruba: {
    label: 'Yorùbá', bcp47: 'yo-NG',
    greeting:          "Ẹ n lẹ, ti ede rẹ ba jẹ Yorùbá, sọ 'Yoruba'.",
    thanks:            'O ṣeun. Ede Yorùbá ti yan. Tẹ ibikibi tabi tẹ bọtini eyikeyi lati fun aṣẹ.',
    prompt:            'Sọ ifiranṣẹ rẹ ni bayi.',
    cmdPrompt:         'Sọ aṣẹ rẹ.',
    cmdNotUnderstood:  'Mi ò gbọ. Jọwọ tún gbiyanju.',
    cmdComposing:      'Ṣiṣi ifiranṣẹ tuntun.',
    cmdReplying:       'Ṣiṣi esi.',
    cmdReading:        'Kika ifiranṣẹ.',
    cmdSending:        'Fifiranṣẹ.',
    cmdRedoing:        'Tún gbọ.',
  },
  hausa: {
    label: 'Hausa', bcp47: 'ha-NG',
    greeting:          "Sannu, idan yarenka Hausa ne, kace 'Hausa'.",
    thanks:            'Nagode. An zaɓi Hausa. Taɓa ko danna maɓalli don ba da umarni.',
    prompt:            'Yanzu faɗi saƙonka.',
    cmdPrompt:         'Faɗi umarninka.',
    cmdNotUnderstood:  'Ban ji ba. Don Allah sake.',
    cmdComposing:      'Buɗe saƙo sabon.',
    cmdReplying:       'Buɗe amsa.',
    cmdReading:        'Karanta saƙo.',
    cmdSending:        'Aika saƙo.',
    cmdRedoing:        'Sake yin rikodin.',
  },
  igbo: {
    label: 'Igbo', bcp47: 'ig-NG',
    greeting:          "Nnọọ, ọ bụrụ na asụsụ gị bụ Igbo, sị 'Igbo'.",
    thanks:            'Imela. Asụsụ Igbo etọọla. Kụọ ebe ọ bụla ma ọ bụ tinye igodo iji nye iwu.',
    prompt:            'Kwuo ozi gị ugbu a.',
    cmdPrompt:         'Kwuo iwu gị.',
    cmdNotUnderstood:  'Abịghị m nụ. Biko nwaa ọzọ.',
    cmdComposing:      'Ime ozi ọhụrụ.',
    cmdReplying:       'Ime nzaghachi.',
    cmdReading:        'Ịgụ ozi.',
    cmdSending:        'Iziga ozi.',
    cmdRedoing:        'Debe ọzọ.',
  },
};

// ─── Voice Command Maps ───────────────────────────────────────────────────────
// Each command maps to an action string. We check if any keyword appears in
// the transcribed text (in native language OR english fallback).
const COMMANDS = {
  compose:   ['kọ ifiranṣẹ','kọ','rubuta saƙo','rubuta','dee ozi','dee','compose','write','new email','new message'],
  read:      ['ka ifiranṣẹ','ka ifiranṣẹ ikẹhin','karanta saƙo','karanta','gụọ ozi','gụọ','read','read email','read last','open email'],
  reply:     ['dahun','amsa','zaghachi','reply','respond'],
  inbox:     ['apoti ifiranṣẹ','akwatin saƙo','igbe ozi','inbox','go to inbox','check inbox'],
  readAloud: ['sọ fun mi','karanta','gụọ ya','read aloud','play','listen'],
  send:      ['firanṣẹ','aika','zipu','send','send email','send it'],
  redo:      ['tún ṣe','yi shi','mee ọzọ','redo','again','try again','record again'],
  next:      ['atẹle','na gaba','nke ọzọ','next','next email'],
  stop:      ['dáwọ dúró','tsaya','kwụsị','stop','stop reading','quiet'],
};

function matchCommand(text: string): string | null {
  const t = text.toLowerCase();
  for (const [cmd, keywords] of Object.entries(COMMANDS)) {
    if (keywords.some(k => t.includes(k))) return cmd;
  }
  return null;
}

// ─── Types ────────────────────────────────────────────────────────────────────
type Screen = 'onboard' | 'inbox' | 'read' | 'compose' | 'reply';
type RecordStage =
  | 'idle' | 'greeting' | 'listening_lang' | 'processing_lang' | 'confirm_lang'
  | 'listening_msg' | 'processing_msg' | 'review' | 'sending' | 'done' | 'error';
type CmdState = 'off' | 'listening' | 'processing';

interface Email {
  id: string; subject: string; subject_native: string;
  from_name: string; from_address: string; sender_intro_native: string;
  date: string; body_english: string; body_native: string; is_read: boolean;
}

// ─── Speak helper ─────────────────────────────────────────────────────────────
function speak(text: string, lang: string, onEnd?: () => void) {
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang; u.rate = 0.85;
  if (onEnd) u.onend = onEnd;
  window.speechSynthesis.speak(u);
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const PAGE: React.CSSProperties = {
  fontFamily: "'Cormorant Garamond', 'Palatino Linotype', Georgia, serif",
  background: '#080c14', minHeight: '100vh', color: '#e8e4dc',
};
const CARD: React.CSSProperties = {
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.09)', borderRadius: 16,
};
const LABEL: React.CSSProperties = {
  color: '#6b7280', fontSize: '0.72rem', letterSpacing: '0.2em',
  textTransform: 'uppercase', display: 'block', marginBottom: 8,
};
const INPUT: React.CSSProperties = {
  width: '100%', padding: '13px 16px', boxSizing: 'border-box',
  background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 12, color: '#e8e4dc', fontSize: '1rem',
  fontFamily: "'Cormorant Garamond', Georgia, serif", outline: 'none',
};
const btn = (bg = '#1e40af', extra: React.CSSProperties = {}): React.CSSProperties => ({
  padding: '13px 22px', borderRadius: 12, border: 'none', background: bg,
  color: '#fff', cursor: 'pointer', fontFamily: "'Cormorant Garamond', Georgia, serif",
  fontSize: '1rem', letterSpacing: '0.06em', transition: 'opacity 0.2s', ...extra,
});

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function Home() {
  // Core state
  const [screen, setScreen]             = useState<Screen>('onboard');
  const [language, setLanguage]         = useState('');
  const [emails, setEmails]             = useState<Email[]>([]);
  const [loadingInbox, setLoadingInbox] = useState(false);
  const [activeEmail, setActiveEmail]   = useState<Email | null>(null);
  const [isSpeaking, setIsSpeaking]     = useState(false);
  const [activeEmailIndex, setActiveEmailIndex] = useState(0);

  // Compose state
  const [composeStage, setComposeStage] = useState<RecordStage>('idle');
  const [recipient, setRecipient]       = useState('');
  const [subject, setSubject]           = useState('');
  const [nativeText, setNativeText]     = useState('');
  const [translation, setTranslation]   = useState('');
  const [errorMsg, setErrorMsg]         = useState('');
  const [secondsLeft, setSecondsLeft]   = useState(0);
  const [isReply, setIsReply]           = useState(false);

  // Voice command state
  const [cmdState, setCmdState]         = useState<CmdState>('off');
  const [cmdFeedback, setCmdFeedback]   = useState('');

  // Refs
  const chunksRef      = useRef<Blob[]>([]);
  const timerRef       = useRef<ReturnType<typeof setInterval> | null>(null);
  const cmdChunksRef   = useRef<Blob[]>([]);
  const cmdRecorderRef = useRef<MediaRecorder | null>(null);
  const screenRef      = useRef<Screen>('onboard');
  const emailsRef      = useRef<Email[]>([]);
  const activeEmailRef = useRef<Email | null>(null);
  const composeStageRef = useRef<RecordStage>('idle');
  const activeIndexRef = useRef(0);
  const languageRef    = useRef('');

  // Keep refs in sync with state (so command handler always sees current values)
  useEffect(() => { screenRef.current = screen; }, [screen]);
  useEffect(() => { emailsRef.current = emails; }, [emails]);
  useEffect(() => { activeEmailRef.current = activeEmail; }, [activeEmail]);
  useEffect(() => { composeStageRef.current = composeStage; }, [composeStage]);
  useEffect(() => { activeIndexRef.current = activeEmailIndex; }, [activeEmailIndex]);
  useEffect(() => { languageRef.current = language; }, [language]);

  // ── Recording (for message composition) ───────────────────────────────────
  const startRecording = useCallback(async (secs: number, onStop: (b: Blob) => void) => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mr = new MediaRecorder(stream, { mimeType: 'audio/webm' });
    chunksRef.current = [];
    mr.ondataavailable = e => chunksRef.current.push(e.data);
    mr.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      onStop(new Blob(chunksRef.current, { type: 'audio/webm' }));
    };
    mr.start();
    setSecondsLeft(secs);
    timerRef.current = setInterval(() => {
      setSecondsLeft(s => {
        if (s <= 1) { clearInterval(timerRef.current!); mr.stop(); return 0; }
        return s - 1;
      });
    }, 1000);
  }, []);

  // ── Inbox fetch ────────────────────────────────────────────────────────────
  const fetchInbox = useCallback(async (lang: string) => {
    setLoadingInbox(true);
    try {
      const res  = await fetch(`${BACKEND}/inbox?limit=15&language=${lang}`);
      const data = await res.json();
      if (data.emails) setEmails(data.emails);
    } catch { /* show empty state */ }
    finally { setLoadingInbox(false); }
  }, []);

  useEffect(() => {
    if (screen === 'inbox' && language) fetchInbox(language);
  }, [screen, language, fetchInbox]);

  // ── Open email ─────────────────────────────────────────────────────────────
  const openEmail = useCallback((em: Email, index: number) => {
    setActiveEmail(em);
    setActiveEmailIndex(index);
    setScreen('read');
    if (!em.is_read) {
      fetch(`${BACKEND}/mark-read`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email_id: em.id }),
      });
      setEmails(prev => prev.map(e => e.id === em.id ? { ...e, is_read: true } : e));
    }
    speak(em.sender_intro_native || `Message from ${em.from_name}`, LANG_META[language]?.bcp47 || 'en-NG');
  }, [language]);

  // ── TTS helpers ────────────────────────────────────────────────────────────
  const readAloud = useCallback((em: Email) => {
    setIsSpeaking(true);
    const meta = LANG_META[language];
    const fullText = `${em.subject_native || em.subject}. ${em.body_native || em.body_english}`;
    speak(fullText, meta.bcp47, () => setIsSpeaking(false));
  }, [language]);

  const stopSpeaking = () => { window.speechSynthesis.cancel(); setIsSpeaking(false); };

  // ── Compose helpers ────────────────────────────────────────────────────────
  const startCompose = useCallback((reply = false, em?: Email) => {
    setIsReply(reply);
    setNativeText(''); setTranslation(''); setErrorMsg(''); setComposeStage('idle');
    if (reply && em) {
      setRecipient(em.from_address);
      setSubject(em.subject.startsWith('Re:') ? em.subject : `Re: ${em.subject}`);
      setScreen('reply');
    } else {
      setRecipient(''); setSubject(''); setScreen('compose');
    }
  }, []);

  const handleMsgBlob = useCallback(async (blob: Blob) => {
    setComposeStage('processing_msg');
    const form = new FormData();
    form.append('file', new File([blob], 'msg.webm', { type: blob.type }));
    form.append('language', languageRef.current);
    try {
      const res  = await fetch(`${BACKEND}/translate-message`, { method: 'POST', body: form });
      const data = await res.json();
      setNativeText(data.native_text || '');
      setTranslation(data.translated_text);
      setComposeStage('review');
      speak(
        `${LANG_META[languageRef.current]?.cmdSending || 'Your message'}. ${data.translated_text}. ${
          languageRef.current === 'yoruba' ? 'Tẹ ki o firanṣẹ, tabi tẹ ki o tún ṣe.' :
          languageRef.current === 'hausa'  ? 'Danna aika, ko kuma danna sake yi.' :
          'Pịa zipu, ma ọ bụ pịa mee ọzọ.'
        }`,
        LANG_META[languageRef.current]?.bcp47 || 'en-NG'
      );
    } catch {
      setErrorMsg('Translation failed.'); setComposeStage('error');
    }
  }, []);

  const handleSend = useCallback(async (toAddr: string, subj: string, body: string, reply: boolean) => {
    setComposeStage('sending');
    try {
      const res = await fetch(`${BACKEND}/${reply ? 'reply-email' : 'send-email'}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to_address: toAddr, subject: subj, body }),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.detail || 'Failed'); }
      setComposeStage('done');
      speak(
        languageRef.current === 'yoruba' ? 'Ifiranṣẹ ti firanṣẹ.' :
        languageRef.current === 'hausa'  ? 'An aika saƙon.' :
        'Ezigara ozi.',
        LANG_META[languageRef.current]?.bcp47 || 'en-NG'
      );
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : 'Unknown error');
      setComposeStage('error');
    }
  }, []);

  const handleRedo = useCallback(() => {
    setNativeText(''); setTranslation('');
    const meta = LANG_META[languageRef.current];
    setComposeStage('listening_msg');
    speak(meta.prompt, meta.bcp47, () => startRecording(10, handleMsgBlob));
  }, [startRecording, handleMsgBlob]);

  const resetCompose = () => {
    setComposeStage('idle'); setNativeText(''); setTranslation(''); setErrorMsg('');
    setScreen('inbox');
  };

  // ── VOICE COMMAND ENGINE ───────────────────────────────────────────────────
  // Activated by: tap anywhere on screen OR keypress anywhere
  // Records 3s of audio → sends to /set-language endpoint (reuses Whisper base)
  // → matches against COMMANDS map → executes action

  const executeCommand = useCallback((cmd: string) => {
    const lang = languageRef.current;
    const meta = LANG_META[lang];
    const currentScreen = screenRef.current;
    const currentEmails = emailsRef.current;
    const currentActiveEmail = activeEmailRef.current;
    const currentComposeStage = composeStageRef.current;
    const currentIndex = activeIndexRef.current;

    switch (cmd) {

      case 'compose':
        setCmdFeedback(meta.cmdComposing);
        speak(meta.cmdComposing, meta.bcp47, () => startCompose(false));
        break;

      case 'read':
        if (currentEmails.length > 0) {
          const em = currentEmails[0];
          setCmdFeedback(meta.cmdReading);
          speak(meta.cmdReading, meta.bcp47, () => openEmail(em, 0));
        }
        break;

      case 'next':
        if (currentScreen === 'inbox' && currentEmails.length > 0) {
          const nextIdx = Math.min(currentIndex + 1, currentEmails.length - 1);
          const em = currentEmails[nextIdx];
          speak(meta.cmdReading, meta.bcp47, () => openEmail(em, nextIdx));
        } else if (currentScreen === 'read' && currentEmails.length > 0) {
          const nextIdx = Math.min(currentIndex + 1, currentEmails.length - 1);
          if (nextIdx !== currentIndex) {
            const em = currentEmails[nextIdx];
            speak(meta.cmdReading, meta.bcp47, () => openEmail(em, nextIdx));
          }
        }
        break;

      case 'reply':
        if (currentActiveEmail && currentScreen === 'read') {
          setCmdFeedback(meta.cmdReplying);
          speak(meta.cmdReplying, meta.bcp47, () => startCompose(true, currentActiveEmail));
        }
        break;

      case 'inbox':
        speak(
          lang === 'yoruba' ? 'Ipadabọ si apoti ifiranṣẹ.' :
          lang === 'hausa'  ? 'Komawa akwatin saƙo.' :
          'Laghachi na igbe ozi.',
          meta.bcp47, () => setScreen('inbox')
        );
        break;

      case 'readAloud':
        if (currentActiveEmail && currentScreen === 'read') {
          speak(meta.cmdReading, meta.bcp47, () => readAloud(currentActiveEmail));
        }
        break;

      case 'send':
        if (currentComposeStage === 'review') {
          setCmdFeedback(meta.cmdSending);
          // We read recipient/subject/translation from state via a one-time handler
          setComposeStage(prev => {
            if (prev === 'review') {
              // trigger send — we'll read from state in the send handler
              setTimeout(() => {
                const toAddr   = (document.getElementById('_recipient') as HTMLInputElement)?.value || '';
                const subj     = (document.getElementById('_subject')   as HTMLInputElement)?.value || '';
                const body     = (document.getElementById('_body')      as HTMLTextAreaElement)?.value || '';
                const isRep    = (document.getElementById('_isreply')   as HTMLInputElement)?.value === 'true';
                handleSend(toAddr, subj, body, isRep);
              }, 100);
            }
            return prev;
          });
        }
        break;

      case 'redo':
        if (currentComposeStage === 'review' || currentComposeStage === 'listening_msg') {
          setCmdFeedback(meta.cmdRedoing);
          speak(meta.cmdRedoing, meta.bcp47, () => handleRedo());
        }
        break;

      case 'stop':
        stopSpeaking();
        break;

      default:
        break;
    }
  }, [startCompose, openEmail, readAloud, handleSend, handleRedo]);

  const startCommandListening = useCallback(async () => {
    // Don't intercept if we're in onboarding or already recording a message
    const currentStage = composeStageRef.current;
    if (
      screenRef.current === 'onboard' ||
      currentStage === 'listening_lang' ||
      currentStage === 'listening_msg' ||
      currentStage === 'processing_msg' ||
      currentStage === 'sending' ||
      cmdState === 'listening' ||
      cmdState === 'processing'
    ) return;

    const lang = languageRef.current;
    if (!lang) return;

    try {
      setCmdState('listening');
      setCmdFeedback(LANG_META[lang].cmdPrompt);
      speak(LANG_META[lang].cmdPrompt, LANG_META[lang].bcp47);

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      cmdChunksRef.current = [];
      cmdRecorderRef.current = mr;

      mr.ondataavailable = e => cmdChunksRef.current.push(e.data);
      mr.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        setCmdState('processing');
        setCmdFeedback('...');

        const blob = new Blob(cmdChunksRef.current, { type: 'audio/webm' });
        const form = new FormData();
        // We reuse /set-language because it gives us the raw transcription
        // But we need raw text, so we use /translate-message with a trick:
        // actually we call a dedicated /transcribe endpoint — let's send to
        // /set-language and read the 'heard' field which is the raw transcript
        form.append('file', new File([blob], 'cmd.webm', { type: blob.type }));

        try {
          // Use the heard field from /set-language which returns raw Whisper text
          const res  = await fetch(`${BACKEND}/set-language`, { method: 'POST', body: form });
          const data = await res.json();
          const heard = (data.heard || '').toLowerCase();
          console.log('[cmd] heard:', heard);

          const cmd = matchCommand(heard);
          if (cmd) {
            executeCommand(cmd);
          } else {
            const meta = LANG_META[languageRef.current];
            setCmdFeedback(meta.cmdNotUnderstood);
            speak(meta.cmdNotUnderstood, meta.bcp47);
          }
        } catch {
          setCmdFeedback('Error.');
        } finally {
          setTimeout(() => { setCmdState('off'); setCmdFeedback(''); }, 2500);
        }
      };

      mr.start();
      // Auto-stop after 3 seconds
      setTimeout(() => {
        if (mr.state === 'recording') mr.stop();
      }, 3000);

    } catch {
      setCmdState('off');
      setCmdFeedback('');
    }
  }, [cmdState, executeCommand]);

  // ── Global tap + keypress listener (active after language is set) ──────────
  useEffect(() => {
    if (!language) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger when user is typing in an input field
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      startCommandListening();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [language, startCommandListening]);

  // ── Onboarding: language selection ────────────────────────────────────────
  const handleTap = useCallback(async () => {
    if (composeStage !== 'idle') return;
    setComposeStage('greeting');
    const greetings = Object.values(LANG_META).map(m => ({ text: m.greeting, lang: m.bcp47 }));
    let i = 0;
    const sayNext = () => {
      if (i >= greetings.length) {
        setComposeStage('listening_lang');
        startRecording(4, handleLangBlob);
        return;
      }
      speak(greetings[i].text, greetings[i].lang, sayNext);
      i++;
    };
    sayNext();
  }, [composeStage, startRecording]);

  const handleLangBlob = useCallback(async (blob: Blob) => {
    setComposeStage('processing_lang');
    const form = new FormData();
    form.append('file', new File([blob], 'lang.webm', { type: blob.type }));
    try {
      const res  = await fetch(`${BACKEND}/set-language`, { method: 'POST', body: form });
      const data = await res.json();
      if (data.language === 'unknown') {
        speak('I did not catch that. Tap to try again.', 'en-NG', () => setComposeStage('idle'));
        return;
      }
      const meta = LANG_META[data.language];
      setLanguage(data.language);
      setComposeStage('confirm_lang');
      speak(meta.thanks, meta.bcp47, () => { setScreen('inbox'); setComposeStage('idle'); });
    } catch {
      setErrorMsg('Could not reach backend.'); setComposeStage('error');
    }
  }, []);

  // ─── Floating Command Button (shown on all post-onboard screens) ───────────
  const FloatingMic = () => {
    if (screen === 'onboard' || !language) return null;
    const colors = {
      off:        'linear-gradient(145deg,#1e3a8a,#4c1d95)',
      listening:  'linear-gradient(145deg,#7f1d1d,#dc2626)',
      processing: 'linear-gradient(145deg,#14532d,#16a34a)',
    };
    return (
      <button
        onClick={e => { e.stopPropagation(); startCommandListening(); }}
        style={{
          position: 'fixed', bottom: 28, right: 24, zIndex: 999,
          width: 64, height: 64, borderRadius: '50%', border: 'none',
          background: colors[cmdState],
          boxShadow: cmdState === 'listening'
            ? '0 0 0 8px rgba(220,38,38,0.25), 0 0 40px rgba(220,38,38,0.4)'
            : '0 0 30px rgba(99,102,241,0.4)',
          cursor: 'pointer', fontSize: '1.6rem',
          animation: cmdState === 'listening' ? 'breathe 1s ease-in-out infinite alternate' : 'none',
          transition: 'background 0.3s, box-shadow 0.3s',
        }}
        aria-label="Voice command"
        title="Tap to give a voice command"
      >
        {cmdState === 'listening'  ? '🔴' :
         cmdState === 'processing' ? '⚙️' : '🎙️'}
      </button>
    );
  };

  // ── Command feedback toast ─────────────────────────────────────────────────
  const CmdToast = () => {
    if (!cmdFeedback) return null;
    return (
      <div style={{
        position: 'fixed', bottom: 104, right: 16, zIndex: 998,
        background: 'rgba(15,20,40,0.95)', border: '1px solid rgba(99,102,241,0.4)',
        borderRadius: 12, padding: '10px 18px', maxWidth: 260,
        color: '#c4b5fd', fontSize: '0.9rem', letterSpacing: '0.04em',
        boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        animation: 'fadeIn 0.2s ease',
      }}>
        {cmdState === 'listening' && <span style={{ color: '#f87171', marginRight: 8 }}>●</span>}
        {cmdFeedback}
      </div>
    );
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // ONBOARD
  // ═══════════════════════════════════════════════════════════════════════════
  if (screen === 'onboard') return (
    <main onClick={handleTap} style={{ ...PAGE, display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', padding: '2rem', position: 'relative' }}>
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none',
        background: 'radial-gradient(ellipse 70% 55% at 50% 35%, rgba(30,64,175,0.18) 0%, transparent 70%)' }} />

      <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
        <h1 style={{ fontSize: 'clamp(3rem,10vw,5.5rem)', fontWeight: 700, letterSpacing: '0.2em', margin: 0,
          background: 'linear-gradient(135deg,#93c5fd 0%,#c4b5fd 50%,#f9a8d4 100%)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>MULUHUN</h1>
        <p style={{ color: '#374151', letterSpacing: '0.35em', fontSize: '0.65rem', marginTop: 6 }}>
          VOICE FOR EVERY TONGUE
        </p>
      </div>

      {composeStage === 'idle' && (
        <button  style={{ width: 190, height: 190, borderRadius: '50%',
          border: 'none', cursor: 'pointer', background: 'linear-gradient(145deg,#1e3a8a,#4c1d95)',
          boxShadow: '0 0 80px rgba(99,102,241,0.35)', fontSize: '4rem',
          animation: 'pulse 2.5s ease-in-out infinite' }} aria-label="Tap to begin">🎙️</button>
      )}
      {(composeStage === 'listening_lang') && (
        <div style={{ width: 190, height: 190, borderRadius: '50%',
          background: 'linear-gradient(145deg,#7f1d1d,#dc2626)',
          boxShadow: '0 0 80px rgba(220,38,38,0.5)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          animation: 'breathe 1s ease-in-out infinite alternate' }}>
          <span style={{ fontSize: '3.5rem' }}>🔴</span>
          {secondsLeft > 0 && <span style={{ color: '#fca5a5', fontSize: '1.4rem', marginTop: 4 }}>{secondsLeft}s</span>}
        </div>
      )}
      {(composeStage === 'greeting' || composeStage === 'confirm_lang') && (
        <div style={{ width: 190, height: 190, borderRadius: '50%',
          background: 'linear-gradient(145deg,#064e3b,#059669)',
          boxShadow: '0 0 60px rgba(16,185,129,0.3)',
          display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ fontSize: '4rem' }}>🔊</span>
        </div>
      )}
      {['processing_lang'].includes(composeStage) && (
        <div style={{ width: 190, height: 190, borderRadius: '50%',
          border: '3px solid #4f46e5', background: 'rgba(30,27,75,0.6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          animation: 'spin 1.5s linear infinite' }}>
          <span style={{ fontSize: '3.5rem' }}>⚙️</span>
        </div>
      )}

      <p style={{ marginTop: '2rem', letterSpacing: '0.14em', textTransform: 'uppercase',
        color: '#60a5fa', fontSize: '1rem' }}>
        {({
          idle: 'Tap to begin', greeting: 'Speaking greeting…',
          listening_lang: 'Say your language…', processing_lang: 'Detecting…',
          confirm_lang: 'Got it!', listening_msg: '', processing_msg: '',
          review: '', sending: '', done: '', error: errorMsg,
        } as Record<RecordStage, string>)[composeStage] ?? ''}
      </p>

      <style>{`
        @keyframes pulse{0%,100%{box-shadow:0 0 80px rgba(99,102,241,0.35)}50%{box-shadow:0 0 130px rgba(99,102,241,0.65)}}
        @keyframes breathe{from{transform:scale(1)}to{transform:scale(1.07)}}
        @keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
        @keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
      `}</style>
    </main>
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // INBOX
  // ═══════════════════════════════════════════════════════════════════════════
  if (screen === 'inbox') return (
    <main onClick={startCommandListening} style={{ ...PAGE, display: 'flex', flexDirection: 'column', cursor: 'default' }}>
      <header style={{ padding: '1.4rem 1.5rem 1rem', borderBottom: '1px solid rgba(255,255,255,0.07)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.6rem', fontWeight: 700, letterSpacing: '0.15em',
            background: 'linear-gradient(135deg,#93c5fd,#c4b5fd)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>MULUHUN</h1>
          <p style={{ margin: '2px 0 0', color: '#4b5563', fontSize: '0.68rem', letterSpacing: '0.2em' }}>
            {LANG_META[language]?.label?.toUpperCase()} · INBOX
          </p>
        </div>
        <button onClick={e => { e.stopPropagation(); fetchInbox(language); }}
          style={btn('rgba(255,255,255,0.07)', { padding: '10px 14px' })}>↻</button>
      </header>

      {/* Voice command hint bar */}
      <div style={{ padding: '8px 16px', background: 'rgba(99,102,241,0.08)',
        borderBottom: '1px solid rgba(99,102,241,0.15)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: '0.75rem', color: '#6b7280' }}>🎙️</span>
        <span style={{ fontSize: '0.72rem', color: '#4b5563', letterSpacing: '0.05em' }}>
          {language === 'yoruba'
            ? `Tẹ ibikibi · "kọ ifiranṣẹ" · "ka ifiranṣẹ" · "atẹle"`
            : language === 'hausa'
            ? `Taɓa ko'ina · "rubuta saƙo" · "karanta saƙo" · "na gaba"`
            : `Kụọ ebe ọ bụla · "dee ozi" · "gụọ ozi" · "nke ọzọ"`}
        </span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '1rem 1.2rem' }}>
        {loadingInbox ? (
          <div style={{ textAlign: 'center', padding: '4rem', color: '#374151' }}>
            <div style={{ fontSize: '2.5rem', animation: 'spin 1.5s linear infinite', display: 'inline-block', marginBottom: 12 }}>⚙️</div>
            <p style={{ letterSpacing: '0.1em' }}>Fetching inbox…</p>
          </div>
        ) : emails.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '4rem', color: '#374151' }}>
            <p style={{ fontSize: '3rem', marginBottom: 12 }}>📭</p>
            <p style={{ letterSpacing: '0.1em' }}>No emails found</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {emails.map((em, idx) => (
              <button key={em.id} onClick={e => { e.stopPropagation(); openEmail(em, idx); }} style={{
                ...CARD, padding: '14px 18px', cursor: 'pointer', textAlign: 'left', width: '100%',
                border: `1px solid ${em.is_read ? 'rgba(255,255,255,0.07)' : 'rgba(99,102,241,0.4)'}`,
                background: em.is_read ? 'rgba(255,255,255,0.02)' : 'rgba(99,102,241,0.07)',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                  <span style={{ fontWeight: em.is_read ? 400 : 700, color: em.is_read ? '#6b7280' : '#e8e4dc', fontSize: '0.92rem' }}>
                    {em.from_name || em.from_address}
                  </span>
                  <span style={{ color: '#374151', fontSize: '0.72rem' }}>
                    {new Date(em.date).toLocaleDateString('en-NG', { month: 'short', day: 'numeric' })}
                  </span>
                </div>
                <p style={{ margin: '0 0 3px', color: em.is_read ? '#4b5563' : '#d1d5db',
                  fontSize: '0.88rem', fontWeight: em.is_read ? 400 : 600 }}>
                  {em.subject_native || em.subject}
                </p>
                <p style={{ margin: 0, color: '#374151', fontSize: '0.78rem',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {(em.body_native || em.body_english).slice(0, 85)}…
                </p>
              </button>
            ))}
          </div>
        )}
      </div>

      <FloatingMic />
      <CmdToast />
      <style>{`
        @keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
        @keyframes breathe{from{transform:scale(1)}to{transform:scale(1.07)}}
        @keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
      `}</style>
    </main>
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // READ EMAIL
  // ═══════════════════════════════════════════════════════════════════════════
  if (screen === 'read' && activeEmail) return (
    <main onClick={startCommandListening} style={{ ...PAGE, display: 'flex', flexDirection: 'column', cursor: 'default' }}>
      <header style={{ padding: '1.2rem 1.4rem', borderBottom: '1px solid rgba(255,255,255,0.07)',
        display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={e => { e.stopPropagation(); stopSpeaking(); setScreen('inbox'); }}
          style={btn('rgba(255,255,255,0.06)', { padding: '8px 14px' })}>← Back</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={LABEL}>FROM</p>
          <p style={{ margin: 0, fontSize: '0.88rem', color: '#93c5fd',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {activeEmail.from_name} · {activeEmail.from_address}
          </p>
        </div>
      </header>

      {/* Voice hint */}
      <div style={{ padding: '8px 16px', background: 'rgba(99,102,241,0.08)',
        borderBottom: '1px solid rgba(99,102,241,0.15)' }}>
        <span style={{ fontSize: '0.72rem', color: '#4b5563', letterSpacing: '0.05em' }}>
          🎙️ {language === 'yoruba' ? '"sọ fun mi" · "dahun" · "atẹle"' :
               language === 'hausa'  ? '"karanta" · "amsa" · "na gaba"' :
                                       '"gụọ ya" · "zaghachi" · "nke ọzọ"'}
        </span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '1.4rem' }}>
        <h2 style={{ margin: '0 0 0.4rem', fontSize: '1.3rem', lineHeight: 1.4, color: '#e8e4dc' }}>
          {activeEmail.subject_native || activeEmail.subject}
        </h2>
        {activeEmail.subject_native && activeEmail.subject_native !== activeEmail.subject && (
          <p style={{ margin: '0 0 0.4rem', color: '#4b5563', fontSize: '0.8rem', fontStyle: 'italic' }}>
            {activeEmail.subject}
          </p>
        )}
        <p style={{ margin: '0 0 1.4rem', color: '#374151', fontSize: '0.78rem' }}>
          {new Date(activeEmail.date).toLocaleString('en-NG')}
        </p>

        {activeEmail.body_native && (
          <div style={{ ...CARD, padding: '16px 18px', marginBottom: 14,
            borderColor: 'rgba(99,102,241,0.25)', background: 'rgba(99,102,241,0.05)' }}>
            <p style={LABEL}>{LANG_META[language]?.label} TRANSLATION</p>
            <p style={{ margin: 0, lineHeight: 1.9, color: '#c4b5fd', fontSize: '1rem' }}>{activeEmail.body_native}</p>
          </div>
        )}
        <div style={{ ...CARD, padding: '16px 18px', marginBottom: 24 }}>
          <p style={LABEL}>ORIGINAL ENGLISH</p>
          <p style={{ margin: 0, lineHeight: 1.85, color: '#6b7280', fontSize: '0.92rem', whiteSpace: 'pre-wrap' }}>
            {activeEmail.body_english}
          </p>
        </div>
      </div>

      <div style={{ padding: '1rem 1.4rem', borderTop: '1px solid rgba(255,255,255,0.07)', display: 'flex', gap: 10 }}>
        <button onClick={e => { e.stopPropagation(); isSpeaking ? stopSpeaking() : readAloud(activeEmail); }}
          style={btn(isSpeaking ? '#7f1d1d' : '#064e3b', { flex: 1 })}>
          {isSpeaking ? '⏹ Stop' : '🔊 Read Aloud'}
        </button>
        <button onClick={e => { e.stopPropagation(); startCompose(true, activeEmail); }}
          style={btn('#1e3a8a', { flex: 2, fontWeight: 700 })}>
          🎙️ Voice Reply
        </button>
      </div>

      <FloatingMic />
      <CmdToast />
      <style>{`
        @keyframes breathe{from{transform:scale(1)}to{transform:scale(1.07)}}
        @keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
      `}</style>
    </main>
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // COMPOSE / REPLY
  // ═══════════════════════════════════════════════════════════════════════════
  if (screen === 'compose' || screen === 'reply') {
    const meta = LANG_META[language];
    return (
      <main onClick={startCommandListening} style={{ ...PAGE, display: 'flex', flexDirection: 'column', cursor: 'default' }}>
        {/* Hidden fields so voice send command can read current values */}
        <input id="_recipient" type="hidden" value={recipient} />
        <input id="_subject"   type="hidden" value={subject} />
        <textarea id="_body"   style={{ display: 'none' }} value={translation} readOnly />
        <input id="_isreply"   type="hidden" value={String(isReply)} />

        <header style={{ padding: '1.2rem 1.4rem', borderBottom: '1px solid rgba(255,255,255,0.07)',
          display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={e => { e.stopPropagation(); resetCompose(); }}
            style={btn('rgba(255,255,255,0.06)', { padding: '8px 14px' })}>← Back</button>
          <h2 style={{ margin: 0, fontSize: '1.05rem', letterSpacing: '0.1em', color: '#93c5fd' }}>
            {isReply ? '🎙️ Voice Reply' : '🎙️ New Email'}
          </h2>
          {language && <span style={{ marginLeft: 'auto', color: '#374151', fontSize: '0.78rem' }}>{meta?.label}</span>}
        </header>

        {/* Voice hint */}
        <div style={{ padding: '8px 16px', background: 'rgba(99,102,241,0.08)',
          borderBottom: '1px solid rgba(99,102,241,0.15)' }}>
          <span style={{ fontSize: '0.72rem', color: '#4b5563', letterSpacing: '0.05em' }}>
            🎙️ {language === 'yoruba' ? '"firanṣẹ" · "tún ṣe" · "apoti ifiranṣẹ"' :
                 language === 'hausa'  ? '"aika" · "yi shi" · "akwatin saƙo"' :
                                         '"zipu" · "mee ọzọ" · "igbe ozi"'}
          </span>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '1.4rem',
          display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>

          <div>
            <label style={LABEL}>TO</label>
            <input value={recipient} onChange={e => setRecipient(e.target.value)}
              onClick={e => e.stopPropagation()}
              placeholder="recipient@email.com" type="email"
              disabled={isReply} style={{ ...INPUT, opacity: isReply ? 0.55 : 1 }} />
          </div>

          <div>
            <label style={LABEL}>SUBJECT</label>
            <input value={subject} onChange={e => setSubject(e.target.value)}
              onClick={e => e.stopPropagation()}
              placeholder="e.g. Message from Mama" style={INPUT} />
          </div>

          {composeStage === 'idle' && (
            <button onClick={e => {
              e.stopPropagation();
              if (!subject.trim() || !recipient.includes('@')) return;
              setComposeStage('listening_msg');
              speak(meta.prompt, meta.bcp47, () => startRecording(10, handleMsgBlob));
            }}
              disabled={!recipient.includes('@') || !subject.trim()}
              style={btn(!recipient.includes('@') || !subject.trim() ? '#1f2937' : '#1e3a8a',
                { width: '100%', padding: '17px', fontSize: '1.05rem',
                  cursor: !recipient.includes('@') || !subject.trim() ? 'not-allowed' : 'pointer' })}>
              🎙️ Record Voice Message
            </button>
          )}

          {composeStage === 'listening_msg' && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '1.5rem 0' }}>
              <div style={{ width: 110, height: 110, borderRadius: '50%',
                background: 'linear-gradient(145deg,#7f1d1d,#dc2626)',
                boxShadow: '0 0 60px rgba(220,38,38,0.45)',
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                animation: 'breathe 1s ease-in-out infinite alternate' }}>
                <span style={{ fontSize: '2.2rem' }}>🔴</span>
                {secondsLeft > 0 && <span style={{ color: '#fca5a5', fontSize: '1.1rem' }}>{secondsLeft}s</span>}
              </div>
              <p style={{ color: '#f87171', letterSpacing: '0.1em', fontSize: '0.82rem', margin: 0 }}>RECORDING…</p>
            </div>
          )}

          {composeStage === 'processing_msg' && (
            <div style={{ textAlign: 'center', padding: '2rem 0', color: '#374151' }}>
              <div style={{ fontSize: '2rem', display: 'inline-block', marginBottom: 10, animation: 'spin 1.5s linear infinite' }}>⚙️</div>
              <p style={{ letterSpacing: '0.1em', margin: 0 }}>Translating…</p>
            </div>
          )}

          {composeStage === 'review' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {nativeText && (
                <div style={{ ...CARD, padding: '15px 18px', borderColor: 'rgba(99,102,241,0.25)', background: 'rgba(99,102,241,0.05)' }}>
                  <p style={LABEL}>YOU SAID ({meta?.label})</p>
                  <p style={{ margin: 0, color: '#c4b5fd', lineHeight: 1.85 }}>{nativeText}</p>
                </div>
              )}
              <div style={{ ...CARD, padding: '15px 18px' }}>
                <p style={LABEL}>WILL BE SENT (ENGLISH)</p>
                <p style={{ margin: 0, color: '#e8e4dc', lineHeight: 1.85 }}>{translation}</p>
              </div>
              <p style={{ color: '#374151', fontSize: '0.78rem', margin: 0 }}>To: {recipient} · {subject}</p>
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={e => { e.stopPropagation(); handleRedo(); }}
                  style={btn('rgba(255,255,255,0.06)', { flex: 1 })}>🔄 Redo</button>
                <button onClick={e => { e.stopPropagation(); handleSend(recipient, subject, translation, isReply); }}
                  style={btn('#065f46', { flex: 2, fontWeight: 700 })}>📨 Send Email</button>
              </div>
            </div>
          )}

          {composeStage === 'sending' && (
            <div style={{ textAlign: 'center', padding: '2rem 0', color: '#374151' }}>
              <div style={{ fontSize: '2rem', display: 'inline-block', marginBottom: 10, animation: 'spin 1.5s linear infinite' }}>📤</div>
              <p style={{ letterSpacing: '0.1em', margin: 0 }}>Sending…</p>
            </div>
          )}

          {composeStage === 'done' && (
            <div style={{ textAlign: 'center', padding: '2rem 0' }}>
              <p style={{ fontSize: '3.5rem', marginBottom: 12 }}>✅</p>
              <p style={{ color: '#6ee7b7', fontSize: '1.1rem', marginBottom: 24, letterSpacing: '0.05em' }}>Email sent!</p>
              <button onClick={e => { e.stopPropagation(); resetCompose(); }}
                style={btn('#1e40af', { padding: '14px 32px' })}>Back to Inbox</button>
            </div>
          )}

          {composeStage === 'error' && (
            <div style={{ textAlign: 'center', padding: '2rem 0' }}>
              <p style={{ color: '#f87171', marginBottom: 20, fontSize: '0.95rem' }}>{errorMsg}</p>
              <button onClick={e => { e.stopPropagation(); setComposeStage('idle'); }}
                style={btn('rgba(239,68,68,0.15)', { border: '1px solid rgba(239,68,68,0.35)', color: '#fca5a5' })}>
                Try Again
              </button>
            </div>
          )}
        </div>

        <FloatingMic />
        <CmdToast />
        <style>{`
          @keyframes breathe{from{transform:scale(1)}to{transform:scale(1.07)}}
          @keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
          @keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
          input:focus{border-color:rgba(139,92,246,0.6)!important;box-shadow:0 0 0 3px rgba(139,92,246,0.1);}
        `}</style>
      </main>
    );
  }

  return null;
}