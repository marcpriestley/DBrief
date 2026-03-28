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
  const abortRef = useRef<AbortController | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    try { sourceRef.current?.stop(); } catch {}
    sourceRef.current = null;
    try { audioCtxRef.current?.close(); } catch {}
    audioCtxRef.current = null;
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

      // AudioContext works reliably in WKWebView (Capacitor iOS).
      // HTMLAudioElement with blob URLs does NOT work in WKWebView.
      const audioCtx = new AudioContext();
      audioCtxRef.current = audioCtx;

      // On iOS the AudioContext may start suspended — resume it
      if (audioCtx.state === "suspended") {
        await audioCtx.resume();
      }
      if (ac.signal.aborted) { audioCtx.close(); return; }

      const decoded = await audioCtx.decodeAudioData(arrayBuffer);
      if (ac.signal.aborted) { audioCtx.close(); return; }

      const source = audioCtx.createBufferSource();
      source.buffer = decoded;
      source.connect(audioCtx.destination);
      sourceRef.current = source;

      source.onended = () => {
        setSpeaking(false);
        try { audioCtx.close(); } catch {}
        if (audioCtxRef.current === audioCtx) audioCtxRef.current = null;
        if (sourceRef.current === source) sourceRef.current = null;
      };

      source.start(0);
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
