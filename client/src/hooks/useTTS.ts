import { useState, useCallback, useEffect, useRef } from "react";

const TTS_STORAGE_KEY = "dbrief_tts_enabled";
const TTS_VOICE_KEY = "dbrief_tts_voice";

export type TTSVoice = "fable" | "onyx" | "echo" | "nova" | "shimmer" | "alloy";

// No-op kept for import compatibility
export function warmAudioCtx() {}

// Convert ArrayBuffer → object URL (synchronous, no FileReader delay).
function arrayBufferToObjectUrl(buffer: ArrayBuffer): string {
  const blob = new Blob([buffer], { type: "audio/mpeg" });
  return URL.createObjectURL(blob);
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
    try { return (localStorage.getItem(TTS_VOICE_KEY) as TTSVoice) || "fable"; } catch { return "fable"; }
  });
  const [speaking, setSpeaking] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  // Text queued to play immediately after the current speech ends
  const continuationRef = useRef<string | null>(null);
  // Ref mirror of speaking so callbacks don't capture stale state
  const isSpeakingRef = useRef(false);

  const setSpeakingBoth = (val: boolean) => {
    isSpeakingRef.current = val;
    setSpeaking(val);
  };

  const cancel = useCallback(() => {
    continuationRef.current = null;
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
    setSpeakingBoth(false);
  }, []);

  // Forward declaration so onended callbacks can reference it
  const doSpeakRef = useRef<(text: string) => Promise<void>>(async () => {});

  const _doSpeak = useCallback(async (text: string) => {
    // Reset continuation but don't cancel existing speech — caller decides
    const ac = new AbortController();
    abortRef.current = ac;
    setSpeakingBoth(true);

    // Helper: called when audio finishes — plays continuation if any
    const onDone = () => {
      setSpeakingBoth(false);
      const cont = continuationRef.current;
      continuationRef.current = null;
      if (cont && !ac.signal.aborted) {
        doSpeakRef.current(cont);
      }
    };

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

      // Synchronous — no FileReader async delay
      const objectUrl = arrayBufferToObjectUrl(buffer);
      if (ac.signal.aborted) { URL.revokeObjectURL(objectUrl); return; }

      const audio = new Audio();
      audioRef.current = audio;

      const cleanup = () => {
        URL.revokeObjectURL(objectUrl);
        if (audioRef.current === audio) audioRef.current = null;
      };
      audio.onended = () => { cleanup(); onDone(); };
      audio.onerror = () => {
        cleanup();
        console.warn("[TTS] audio element error → SpeechSynthesis fallback");
        utteranceRef.current = speakViaSynthesis(text, onDone);
        if (!utteranceRef.current) onDone();
      };

      audio.src = objectUrl;
      try {
        await audio.play();
        return; // success — onended will fire onDone
      } catch (playErr: any) {
        console.warn("[TTS] play() rejected:", playErr?.name, "→ SpeechSynthesis fallback");
        cleanup();
        audioRef.current = null;
      }
    } catch (err: any) {
      if (err?.name === "AbortError") return;
      console.warn("[TTS] fetch/decode failed:", err?.message, "→ SpeechSynthesis fallback");
    }

    if (ac.signal.aborted) { setSpeakingBoth(false); return; }

    // ── Phase 2: SpeechSynthesis fallback ────────────────────────────────
    utteranceRef.current = speakViaSynthesis(text, onDone);
    if (!utteranceRef.current) onDone();
  }, [voice]);

  // Keep doSpeakRef current so onDone closures can call the latest version
  doSpeakRef.current = _doSpeak;

  // Auto-speak (after AI responses) — respects the user's enabled toggle.
  // Cancels any in-progress speech and clears the continuation queue.
  const speak = useCallback((text: string) => {
    if (!enabled || !text.trim()) return Promise.resolve();
    cancel();
    return _doSpeak(text);
  }, [enabled, _doSpeak, cancel]);

  // Manual play — always works regardless of the auto-speak toggle state.
  // Cancels any in-progress speech and clears the continuation queue.
  const speakNow = useCallback((text: string) => {
    if (!text.trim()) return Promise.resolve();
    cancel();
    return _doSpeak(text);
  }, [_doSpeak, cancel]);

  // Queue text to play after the current speech ends (no interruption).
  // If nothing is playing, starts immediately. Respects the enabled toggle.
  const speakOrQueue = useCallback((text: string) => {
    if (!enabled || !text.trim()) return;
    if (isSpeakingRef.current) {
      // Chain it: play after whatever is currently speaking (or already queued)
      continuationRef.current = text;
    } else {
      _doSpeak(text);
    }
  }, [enabled, _doSpeak]);

  const toggle = useCallback(() => {
    setEnabled(prev => {
      const next = !prev;
      try { localStorage.setItem(TTS_STORAGE_KEY, String(next)); } catch {}
      if (!next) cancel();
      return next;
    });
  }, [cancel]);

  useEffect(() => () => { cancel(); }, [cancel]);

  return { enabled, speaking, isSupported: true, speak, speakNow, speakOrQueue, cancel, toggle };
}
