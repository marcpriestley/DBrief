import { useState, useCallback, useEffect, useRef } from "react";

const TTS_STORAGE_KEY = "dbrief_tts_enabled";
const TTS_VOICE_KEY = "dbrief_tts_voice";

export type TTSVoice = "nova" | "shimmer" | "echo" | "onyx" | "fable" | "alloy";

// No-op kept for import compatibility
export function warmAudioCtx() {}

// Convert ArrayBuffer → base64 data URL via FileReader (reliable in WKWebView).
function arrayBufferToDataUrl(buffer: ArrayBuffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([buffer], { type: "audio/mpeg" });
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// SpeechSynthesis fallback — works in Capacitor WKWebView on iOS 14+ and
// does not need a user gesture when called from within an event handler chain.
function speakViaSynthesis(text: string, onEnd: () => void): SpeechSynthesisUtterance | null {
  if (!window.speechSynthesis) { onEnd(); return null; }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 0.95;
  utterance.pitch = 1.0;
  utterance.onend = onEnd;
  utterance.onerror = onEnd;
  window.speechSynthesis.speak(utterance);
  return utterance;
}

export function useTTS() {
  const [enabled, setEnabled] = useState(() => {
    try { return localStorage.getItem(TTS_STORAGE_KEY) !== "false"; } catch { return true; }
  });
  const [voice] = useState<TTSVoice>(() => {
    try { return (localStorage.getItem(TTS_VOICE_KEY) as TTSVoice) || "nova"; } catch { return "nova"; }
  });
  const [speaking, setSpeaking] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
      audioRef.current = null;
    }
    if (window.speechSynthesis?.speaking) {
      window.speechSynthesis.cancel();
    }
    utteranceRef.current = null;
    setSpeaking(false);
  }, []);

  // Core implementation — shared by speak() and speakNow().
  const _doSpeak = useCallback(async (text: string) => {
    cancel();
    setSpeaking(true);

    const ac = new AbortController();
    abortRef.current = ac;

    // ── Phase 1: OpenAI TTS via data URL ─────────────────────────────────
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ text, voice }),
        signal: ac.signal,
      });

      if (!res.ok) throw new Error(`tts-${res.status}`);

      const buffer = await res.arrayBuffer();
      if (ac.signal.aborted) return;

      const dataUrl = await arrayBufferToDataUrl(buffer);
      if (ac.signal.aborted) return;

      const audio = new Audio();
      audioRef.current = audio;

      const done = () => {
        setSpeaking(false);
        if (audioRef.current === audio) audioRef.current = null;
      };

      audio.onended = done;
      audio.onerror = () => {
        audioRef.current = null;
        console.warn("[TTS] audio element error → SpeechSynthesis fallback");
        utteranceRef.current = speakViaSynthesis(text, () => setSpeaking(false));
        if (!utteranceRef.current) setSpeaking(false);
      };

      audio.src = dataUrl;
      try {
        await audio.play();
        return; // success
      } catch (playErr: any) {
        console.warn("[TTS] play() rejected:", playErr?.name, "→ SpeechSynthesis fallback");
        audio.src = "";
        audioRef.current = null;
      }
    } catch (err: any) {
      if (err?.name === "AbortError") return;
      console.warn("[TTS] fetch/decode failed:", err?.message, "→ SpeechSynthesis fallback");
    }

    if (ac.signal.aborted) { setSpeaking(false); return; }

    // ── Phase 2: SpeechSynthesis fallback ────────────────────────────────
    utteranceRef.current = speakViaSynthesis(text, () => setSpeaking(false));
    if (!utteranceRef.current) setSpeaking(false);
  }, [voice, cancel]);

  // Auto-speak (after AI responses) — respects the user's enabled toggle.
  const speak = useCallback((text: string) => {
    if (!enabled || !text.trim()) return Promise.resolve();
    return _doSpeak(text);
  }, [enabled, _doSpeak]);

  // Manual play — always works regardless of the auto-speak toggle state.
  const speakNow = useCallback((text: string) => {
    if (!text.trim()) return Promise.resolve();
    return _doSpeak(text);
  }, [_doSpeak]);

  const toggle = useCallback(() => {
    setEnabled(prev => {
      const next = !prev;
      try { localStorage.setItem(TTS_STORAGE_KEY, String(next)); } catch {}
      if (!next) cancel();
      return next;
    });
  }, [cancel]);

  useEffect(() => () => { cancel(); }, [cancel]);

  return { enabled, speaking, isSupported: true, speak, speakNow, cancel, toggle };
}
