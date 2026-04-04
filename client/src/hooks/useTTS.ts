import { useState, useCallback, useEffect, useRef } from "react";

const TTS_STORAGE_KEY = "dbrief_tts_enabled";
const TTS_VOICE_KEY = "dbrief_tts_voice";

export type TTSVoice = "nova" | "shimmer" | "echo" | "onyx" | "fable" | "alloy";

// Convert an ArrayBuffer to a base64 data URL so it can be played by
// HTMLAudioElement in Capacitor's WKWebView without blob-URL restrictions
// or AudioContext gesture requirements.
function arrayBufferToDataUrl(buffer: ArrayBuffer, mimeType = "audio/mpeg"): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  // Process in chunks to avoid call-stack limits on large audio files
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}

// No-op kept for import compatibility — AudioContext warm-up is no longer needed
export function warmAudioCtx() {}

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

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
      audioRef.current = null;
    }
    setSpeaking(false);
  }, []);

  const speak = useCallback(async (text: string) => {
    if (!enabled || !text.trim()) return;
    cancel();

    const ac = new AbortController();
    abortRef.current = ac;
    setSpeaking(true);

    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ text, voice }),
        signal: ac.signal,
      });

      if (!res.ok) throw new Error(`TTS ${res.status}`);

      const arrayBuffer = await res.arrayBuffer();
      if (ac.signal.aborted) return;

      // Use a data URL so the audio plays in Capacitor WKWebView without
      // needing a user gesture or AudioContext unlock dance
      const dataUrl = arrayBufferToDataUrl(arrayBuffer);
      const audio = new Audio(dataUrl);
      audioRef.current = audio;

      const cleanup = () => {
        setSpeaking(false);
        if (audioRef.current === audio) audioRef.current = null;
      };

      audio.onended = cleanup;
      audio.onerror = () => {
        console.warn("[TTS] Audio element error");
        cleanup();
      };

      if (ac.signal.aborted) { audio.src = ""; return; }
      await audio.play();
    } catch (err: any) {
      if (err?.name !== "AbortError") {
        console.warn("[TTS] Error:", err?.message);
      }
      setSpeaking(false);
    }
  }, [enabled, voice, cancel]);

  const toggle = useCallback(() => {
    setEnabled(prev => {
      const next = !prev;
      try { localStorage.setItem(TTS_STORAGE_KEY, String(next)); } catch {}
      if (!next) cancel();
      return next;
    });
  }, [cancel]);

  useEffect(() => () => { cancel(); }, [cancel]);

  return { enabled, speaking, isSupported: true, speak, cancel, toggle };
}
