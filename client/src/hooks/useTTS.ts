import { useState, useCallback, useEffect, useRef } from "react";

const TTS_STORAGE_KEY = "dbrief_tts_enabled";

// Preferred voice names in priority order — highest quality first
const VOICE_PRIORITY = [
  // iOS/macOS enhanced neural voices
  "Samantha (Enhanced)",
  "Nicky (Enhanced)",
  "Aaron (Enhanced)",
  "Stephanie (Enhanced)",
  "Siri Nicky",
  "Siri Female",
  // Google high-quality voices
  "Google UK English Female",
  "Google US English",
  "Google UK English Male",
  // Microsoft natural voices
  "Microsoft Aria Online (Natural)",
  "Microsoft Jenny Online (Natural)",
  "Microsoft Guy Online (Natural)",
  // Standard fallbacks
  "Samantha",
  "Karen",
  "Moira",
  "Tessa",
  "Fiona",
  "Victoria",
];

function pickBestVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  // Try priority list first
  for (const name of VOICE_PRIORITY) {
    const match = voices.find(v => v.name === name);
    if (match) return match;
  }
  // Fallback: any enhanced/premium en-US or en-GB voice
  const enhanced = voices.find(
    v => v.lang.startsWith("en") && (v.name.includes("Enhanced") || v.name.includes("Premium") || v.name.includes("Natural"))
  );
  if (enhanced) return enhanced;
  // Fallback: any English voice
  const english = voices.find(v => v.lang.startsWith("en"));
  return english || null;
}

// Split text into sentence-sized chunks to avoid iOS mid-sentence cutoffs
function splitIntoChunks(text: string): string[] {
  const sentences = text.match(/[^.!?]+[.!?]+\s*/g) || [text];
  const chunks: string[] = [];
  let current = "";
  for (const s of sentences) {
    if ((current + s).length > 180) {
      if (current.trim()) chunks.push(current.trim());
      current = s;
    } else {
      current += s;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.length > 0 ? chunks : [text];
}

export function useTTS() {
  const [enabled, setEnabled] = useState(() => {
    try { return localStorage.getItem(TTS_STORAGE_KEY) !== "false"; } catch { return true; }
  });
  const [speaking, setSpeaking] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const isSupported = typeof window !== "undefined" && "speechSynthesis" in window;
  const keepAliveRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const chunksRef = useRef<string[]>([]);
  const chunkIndexRef = useRef(0);

  // Load voices — browsers fire voiceschanged when ready
  useEffect(() => {
    if (!isSupported) return;
    const load = () => setVoices(window.speechSynthesis.getVoices());
    load();
    window.speechSynthesis.addEventListener("voiceschanged", load);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", load);
  }, [isSupported]);

  const stopKeepAlive = useCallback(() => {
    if (keepAliveRef.current) {
      clearInterval(keepAliveRef.current);
      keepAliveRef.current = null;
    }
  }, []);

  // Keep synthesis alive on Chrome/iOS which pauses after ~15s
  const startKeepAlive = useCallback(() => {
    stopKeepAlive();
    keepAliveRef.current = setInterval(() => {
      if (window.speechSynthesis.speaking && window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
      }
    }, 10000);
  }, [stopKeepAlive]);

  const speakChunk = useCallback((text: string, voice: SpeechSynthesisVoice | null, onDone: () => void) => {
    const utter = new SpeechSynthesisUtterance(text);
    if (voice) utter.voice = voice;
    utter.lang = voice?.lang || "en-US";
    utter.rate = 0.92;
    utter.pitch = 0.95;
    utter.volume = 1.0;
    utter.onend = onDone;
    utter.onerror = onDone;
    window.speechSynthesis.speak(utter);
  }, []);

  const speak = useCallback((text: string) => {
    if (!isSupported || !enabled) return;
    window.speechSynthesis.cancel();
    stopKeepAlive();

    const voice = pickBestVoice(voices.length > 0 ? voices : window.speechSynthesis.getVoices());
    const chunks = splitIntoChunks(text);
    chunksRef.current = chunks;
    chunkIndexRef.current = 0;

    setSpeaking(true);
    startKeepAlive();

    function speakNext() {
      const idx = chunkIndexRef.current;
      if (idx >= chunksRef.current.length) {
        setSpeaking(false);
        stopKeepAlive();
        return;
      }
      chunkIndexRef.current = idx + 1;
      speakChunk(chunksRef.current[idx], voice, speakNext);
    }

    speakNext();
  }, [isSupported, enabled, voices, speakChunk, startKeepAlive, stopKeepAlive]);

  const cancel = useCallback(() => {
    if (!isSupported) return;
    window.speechSynthesis.cancel();
    chunksRef.current = [];
    chunkIndexRef.current = 0;
    setSpeaking(false);
    stopKeepAlive();
  }, [isSupported, stopKeepAlive]);

  const toggle = useCallback(() => {
    setEnabled(prev => {
      const next = !prev;
      try { localStorage.setItem(TTS_STORAGE_KEY, String(next)); } catch {}
      if (!next) {
        window.speechSynthesis?.cancel();
        setSpeaking(false);
        stopKeepAlive();
      }
      return next;
    });
  }, [stopKeepAlive]);

  useEffect(() => () => {
    window.speechSynthesis?.cancel();
    stopKeepAlive();
  }, [stopKeepAlive]);

  return { enabled, speaking, isSupported, speak, cancel, toggle };
}
