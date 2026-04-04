import { useState, useCallback, useEffect, useRef } from "react";

const TTS_STORAGE_KEY = "dbrief_tts_enabled";
const TTS_VOICE_KEY = "dbrief_tts_voice";

export type TTSVoice = "nova" | "shimmer" | "echo" | "onyx" | "fable" | "alloy";

// Keep one AudioContext alive for the lifetime of the page.
// iOS requires AudioContext to be created/resumed during a user gesture.
// Reusing the same context means subsequent speaks (including auto-speak after
// streaming) work because the context is already in the "running" state.
let sharedAudioCtx: AudioContext | null = null;

function getAudioCtx(): AudioContext {
  if (!sharedAudioCtx || sharedAudioCtx.state === "closed") {
    sharedAudioCtx = new AudioContext();
  }
  return sharedAudioCtx;
}

// Call this inside any user-gesture handler to pre-warm the AudioContext so
// that subsequent auto-triggered speaks work without a gesture.
export async function warmAudioCtx() {
  try {
    const ctx = getAudioCtx();
    if (ctx.state === "suspended") {
      await ctx.resume();
    }
    // Play a silent buffer to fully unlock audio on iOS
    if (ctx.state === "running") {
      const silent = ctx.createBuffer(1, 1, ctx.sampleRate);
      const src = ctx.createBufferSource();
      src.buffer = silent;
      src.connect(ctx.destination);
      src.start(0);
    }
  } catch {}
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
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    try { sourceRef.current?.stop(); } catch {}
    sourceRef.current = null;
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

      // Reuse the shared AudioContext — it was already resumed during the
      // user's gesture (send / toggle), so auto-speak works without a new gesture.
      const audioCtx = getAudioCtx();
      if (audioCtx.state === "suspended") {
        await audioCtx.resume();
      }
      if (ac.signal.aborted) return;

      const decoded = await audioCtx.decodeAudioData(arrayBuffer);
      if (ac.signal.aborted) return;

      // Stop any previous source
      try { sourceRef.current?.stop(); } catch {}

      const source = audioCtx.createBufferSource();
      source.buffer = decoded;
      source.connect(audioCtx.destination);
      sourceRef.current = source;

      source.onended = () => {
        setSpeaking(false);
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
    // Warm AudioContext on toggle (user gesture) so auto-speak works after
    warmAudioCtx();
  }, [cancel]);

  useEffect(() => () => { cancel(); }, [cancel]);

  return { enabled, speaking, isSupported: true, speak, cancel, toggle };
}
