import { useState, useCallback, useEffect, useRef } from "react";

const TTS_STORAGE_KEY = "dbrief_tts_enabled";
const TTS_VOICE_KEY = "dbrief_tts_voice";

export type TTSVoice = "nova" | "shimmer" | "echo" | "onyx" | "fable" | "alloy";

export function useTTS() {
  const [enabled, setEnabled] = useState(() => {
    try { return localStorage.getItem(TTS_STORAGE_KEY) !== "false"; } catch { return true; }
  });
  const [voice] = useState<TTSVoice>(() => {
    try { return (localStorage.getItem(TTS_VOICE_KEY) as TTSVoice) || "nova"; } catch { return "nova"; }
  });
  const [speaking, setSpeaking] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const blobUrlRef = useRef<string | null>(null);

  const revokeBlobUrl = useCallback(() => {
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
      audioRef.current = null;
    }
    revokeBlobUrl();
    setSpeaking(false);
  }, [revokeBlobUrl]);

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

      if (!res.ok) throw new Error("TTS request failed");

      const blob = await res.blob();
      if (ac.signal.aborted) return;

      const url = URL.createObjectURL(blob);
      blobUrlRef.current = url;

      const audio = new Audio(url);
      audioRef.current = audio;

      audio.onended = () => {
        setSpeaking(false);
        revokeBlobUrl();
        audioRef.current = null;
      };
      audio.onerror = () => {
        setSpeaking(false);
        revokeBlobUrl();
        audioRef.current = null;
      };

      await audio.play();
    } catch (err: any) {
      if (err?.name !== "AbortError") {
        console.warn("[TTS] Error:", err?.message);
      }
      setSpeaking(false);
    }
  }, [enabled, voice, cancel, revokeBlobUrl]);

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
