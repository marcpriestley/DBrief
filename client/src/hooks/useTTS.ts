import { useState, useCallback, useEffect, useRef } from "react";

const TTS_STORAGE_KEY = "dbrief_tts_enabled";
const TTS_VOICE_KEY = "dbrief_tts_voice";

export type TTSVoice = "fable" | "onyx" | "echo" | "nova" | "shimmer" | "alloy";

export function warmAudioCtx() {}

function arrayBufferToObjectUrl(buffer: ArrayBuffer): string {
  const blob = new Blob([buffer], { type: "audio/mpeg" });
  return URL.createObjectURL(blob);
}

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
  const continuationRef = useRef<string | null>(null);
  // Pre-fetched audio buffer for the queued continuation — eliminates inter-fetch gap
  const pendingBufferRef = useRef<Promise<ArrayBuffer | null> | null>(null);
  const isSpeakingRef = useRef(false);

  const setSpeakingBoth = (val: boolean) => {
    isSpeakingRef.current = val;
    setSpeaking(val);
  };

  const cancel = useCallback(() => {
    continuationRef.current = null;
    pendingBufferRef.current = null;
    abortRef.current?.abort();
    abortRef.current = null;
    if (audioRef.current) {
      // Remove error handler BEFORE clearing src so the error event
      // doesn't trigger the speech-synthesis fallback on intentional cancel
      const a = audioRef.current;
      a.onerror = null;
      a.onended = null;
      a.pause();
      a.src = "";
      audioRef.current = null;
    }
    if (window.speechSynthesis?.speaking) {
      window.speechSynthesis.cancel();
    }
    utteranceRef.current = null;
    setSpeakingBoth(false);
  }, []);

  const doSpeakRef = useRef<(text: string, preFetched?: Promise<ArrayBuffer | null>) => Promise<void>>(async () => {});

  const _doSpeak = useCallback(async (text: string, preFetched?: Promise<ArrayBuffer | null>) => {
    const ac = new AbortController();
    abortRef.current = ac;
    setSpeakingBoth(true);

    const onDone = () => {
      setSpeakingBoth(false);
      const cont = continuationRef.current;
      continuationRef.current = null;
      const pending = pendingBufferRef.current;
      pendingBufferRef.current = null;
      if (cont && !ac.signal.aborted) {
        doSpeakRef.current(cont, pending ?? undefined);
      }
    };

    // ── Get audio buffer — use pre-fetched promise if available ───────────
    let buffer: ArrayBuffer | null = null;
    try {
      if (preFetched) {
        buffer = await preFetched;
        if (ac.signal.aborted) return;
      } else {
        const res = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ text, voice }),
          signal: ac.signal,
        });
        if (!res.ok) throw new Error(`tts-${res.status}`);
        buffer = await res.arrayBuffer();
        if (ac.signal.aborted) return;
      }
    } catch (err: any) {
      if (err?.name === "AbortError") return;
      console.warn("[TTS] fetch/decode failed:", err?.message, "→ SpeechSynthesis fallback");
    }

    if (ac.signal.aborted) { setSpeakingBoth(false); return; }

    if (!buffer) {
      utteranceRef.current = speakViaSynthesis(text, onDone);
      if (!utteranceRef.current) onDone();
      return;
    }

    // ── Play the buffer ───────────────────────────────────────────────────
    const objectUrl = arrayBufferToObjectUrl(buffer);

    const audio = new Audio();
    audioRef.current = audio;

    const cleanup = () => {
      URL.revokeObjectURL(objectUrl);
      if (audioRef.current === audio) audioRef.current = null;
    };

    audio.onended = () => { cleanup(); onDone(); };
    audio.onerror = () => {
      // Guard: if we intentionally cancelled, onerror fires because we cleared
      // audio.src — do NOT fall back to speech synthesis in that case.
      if (ac.signal.aborted) { cleanup(); return; }
      cleanup();
      console.warn("[TTS] audio element error → SpeechSynthesis fallback");
      utteranceRef.current = speakViaSynthesis(text, onDone);
      if (!utteranceRef.current) onDone();
    };

    audio.src = objectUrl;
    try {
      await audio.play();
    } catch (playErr: any) {
      console.warn("[TTS] play() rejected:", playErr?.name, "→ SpeechSynthesis fallback");
      cleanup();
      audioRef.current = null;
      if (ac.signal.aborted) return;
      utteranceRef.current = speakViaSynthesis(text, onDone);
      if (!utteranceRef.current) onDone();
    }
  }, [voice]);

  doSpeakRef.current = _doSpeak;

  const speak = useCallback((text: string) => {
    if (!enabled || !text.trim()) return Promise.resolve();
    cancel();
    return _doSpeak(text);
  }, [enabled, _doSpeak, cancel]);

  const speakNow = useCallback((text: string) => {
    if (!text.trim()) return Promise.resolve();
    cancel();
    return _doSpeak(text);
  }, [_doSpeak, cancel]);

  // Pre-fetch audio for a future continuation while current speech is still playing.
  // Call this as soon as the continuation text is known so the buffer is ready (or
  // nearly ready) when the current audio ends — eliminating the inter-fetch silence gap.
  const preFetchAudio = useCallback((text: string) => {
    if (!enabled || !text.trim()) return;
    const ac = abortRef.current;
    pendingBufferRef.current = fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ text, voice }),
      signal: ac?.signal,
    }).then(r => r.ok ? r.arrayBuffer() : null).catch(() => null);
  }, [enabled, voice]);

  const speakOrQueue = useCallback((text: string) => {
    if (!enabled || !text.trim()) return;
    if (isSpeakingRef.current) {
      continuationRef.current = text;
      // Only pre-fetch if not already pre-fetching for this continuation
      if (!pendingBufferRef.current) preFetchAudio(text);
    } else {
      _doSpeak(text);
    }
  }, [enabled, _doSpeak, preFetchAudio]);

  const toggle = useCallback(() => {
    setEnabled(prev => {
      const next = !prev;
      try { localStorage.setItem(TTS_STORAGE_KEY, String(next)); } catch {}
      if (!next) cancel();
      return next;
    });
  }, [cancel]);

  useEffect(() => () => { cancel(); }, [cancel]);

  return { enabled, speaking, isSupported: true, speak, speakNow, speakOrQueue, preFetchAudio, cancel, toggle };
}
