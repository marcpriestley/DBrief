import { useState, useEffect, useRef, useCallback } from "react";
import { Capacitor } from "@capacitor/core";

interface SpeechToTextHook {
  isRecording: boolean;
  isSupported: boolean;
  transcript: string;
  startRecording: () => void;
  stopRecording: () => void;
  resetTranscript: () => void;
}

declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

const MAX_RECORDING_MS = 5 * 60 * 1000; // 5-minute hard limit

export function useSpeechToText(): SpeechToTextHook {
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState("");

  const recognitionRef = useRef<any>(null);
  const isRecordingRef = useRef(false);
  // Text committed from completed recognition sessions (native restart loop)
  const accumulatedRef = useRef("");
  // Latest partial from the current native session
  const latestSegmentRef = useRef("");
  // Guards against double-restart when listeningState fires and a silence timer coincide
  const restartingRef = useRef(false);
  // Silence fallback timer (fires if no listeningState "stopped" event arrives)
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Hard 5-min limit timer
  const hardLimitRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Handles for current native listeners so we can remove them cleanly
  const nativeHandlesRef = useRef<Array<{ remove: () => Promise<void> }>>([]);

  const isNative = Capacitor.isNativePlatform();
  const isWebSpeechSupported =
    typeof window !== "undefined" &&
    ("webkitSpeechRecognition" in window || "SpeechRecognition" in window);
  const isSupported = isNative || isWebSpeechSupported;

  // ── helpers ────────────────────────────────────────────────────────────────
  const clearSilenceTimer = () => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  };

  const commitSegment = () => {
    const seg = latestSegmentRef.current.trim();
    if (seg) {
      accumulatedRef.current = accumulatedRef.current
        ? (accumulatedRef.current + " " + seg).trim()
        : seg;
      latestSegmentRef.current = "";
    }
  };

  // Remove all current native listeners
  const removeNativeListeners = async () => {
    const handles = nativeHandlesRef.current;
    nativeHandlesRef.current = [];
    for (const h of handles) {
      try { await h.remove(); } catch { /* ignore */ }
    }
  };

  // ── Web Speech API setup ───────────────────────────────────────────────────
  useEffect(() => {
    if (isNative || !isWebSpeechSupported) return;

    const SpeechRecognitionCtor =
      window.SpeechRecognition || (window as any).webkitSpeechRecognition;

    const recognition = new SpeechRecognitionCtor();
    recognitionRef.current = recognition;

    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = (event: any) => {
      let finalTranscript = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalTranscript += result[0].transcript + " ";
        }
      }
      if (finalTranscript.trim()) {
        accumulatedRef.current = (accumulatedRef.current + " " + finalTranscript).trim();
        setTranscript(accumulatedRef.current);
      }
    };

    recognition.onerror = (event: any) => {
      if (event.error === "no-speech" && isRecordingRef.current) return;
      console.error("Speech recognition error:", event.error);
    };

    // Restart when the browser ends the session mid-recording
    recognition.onend = () => {
      if (isRecordingRef.current) {
        try { recognition.start(); } catch { /* already starting */ }
      } else {
        setIsRecording(false);
      }
    };

    return () => {
      recognition.onend = null;
      try { recognition.abort(); } catch { /* ignore */ }
    };
  }, [isNative, isWebSpeechSupported]);

  // ── Native: start one recognition session and auto-restart on end ──────────
  const startNativeSession = useCallback(async () => {
    if (!isRecordingRef.current || restartingRef.current) return;
    restartingRef.current = true;

    try {
      const { SpeechRecognition } = await import("@capacitor-community/speech-recognition");

      // Clean up any previous session's listeners
      await removeNativeListeners();
      clearSilenceTimer();

      let sessionSegment = "";

      // ── partialResults: accumulate text for this session ──
      const partialHandle = await SpeechRecognition.addListener(
        "partialResults",
        (data: { matches: string[] }) => {
          if (!data.matches?.[0]) return;
          sessionSegment = data.matches[0];
          latestSegmentRef.current = sessionSegment;

          const full = accumulatedRef.current
            ? (accumulatedRef.current + " " + sessionSegment).trim()
            : sessionSegment.trim();
          setTranscript(full);

          // Silence fallback: if no new words for 3 s, iOS probably already stopped
          clearSilenceTimer();
          silenceTimerRef.current = setTimeout(async () => {
            if (!isRecordingRef.current || restartingRef.current) return;
            commitSegment();
            await new Promise<void>(r => setTimeout(r, 300));
            restartingRef.current = false;
            startNativeSession();
          }, 3000);
        }
      );
      nativeHandlesRef.current.push(partialHandle);

      // ── listeningState: primary signal that iOS stopped the recognizer ──
      const stateHandle = await SpeechRecognition.addListener(
        "listeningState",
        async (data: { status: string }) => {
          if (data.status !== "stopped") return;
          if (!isRecordingRef.current || restartingRef.current) return;

          clearSilenceTimer();
          commitSegment();

          // Brief pause before iOS accepts a new start() call
          await new Promise<void>(r => setTimeout(r, 300));

          if (!isRecordingRef.current) {
            setIsRecording(false);
            restartingRef.current = false;
            return;
          }

          restartingRef.current = false;
          startNativeSession();
        }
      );
      nativeHandlesRef.current.push(stateHandle);

      // Fire recognition
      await SpeechRecognition.start({
        language: "en-US",
        maxResults: 1,
        partialResults: true,
        popup: false,
      });

      // Initial silence timer: if no speech arrives within 5 s, restart anyway
      silenceTimerRef.current = setTimeout(async () => {
        if (!isRecordingRef.current || restartingRef.current) return;
        commitSegment();
        await new Promise<void>(r => setTimeout(r, 300));
        restartingRef.current = false;
        startNativeSession();
      }, 5000);

    } catch (error) {
      console.error("Native speech session error:", error);
      restartingRef.current = false;
      if (!isRecordingRef.current) {
        setIsRecording(false);
      } else {
        // Retry after a second
        await new Promise<void>(r => setTimeout(r, 1000));
        restartingRef.current = false;
        startNativeSession();
      }
    }

    restartingRef.current = false;
  }, []);

  // ── startRecording ─────────────────────────────────────────────────────────
  const startRecording = useCallback(async () => {
    accumulatedRef.current = "";
    latestSegmentRef.current = "";
    restartingRef.current = false;
    setTranscript("");
    isRecordingRef.current = true;
    setIsRecording(true);

    if (hardLimitRef.current) clearTimeout(hardLimitRef.current);
    hardLimitRef.current = setTimeout(() => {
      isRecordingRef.current = false;
      stopRecording();
    }, MAX_RECORDING_MS);

    if (isNative) {
      try {
        const { SpeechRecognition } = await import("@capacitor-community/speech-recognition");
        const permResult = await SpeechRecognition.requestPermissions();
        if (permResult.speechRecognition !== "granted") {
          console.error("Speech recognition permission denied");
          isRecordingRef.current = false;
          setIsRecording(false);
          return;
        }
      } catch (error) {
        console.error("Permission request error:", error);
        isRecordingRef.current = false;
        setIsRecording(false);
        return;
      }
      startNativeSession();
      return;
    }

    if (!recognitionRef.current) return;
    try {
      recognitionRef.current.start();
    } catch (error) {
      console.error("Error starting web speech recognition:", error);
    }
  }, [isNative, startNativeSession]);

  // ── stopRecording ──────────────────────────────────────────────────────────
  const stopRecording = useCallback(async () => {
    isRecordingRef.current = false;
    restartingRef.current = false;

    if (hardLimitRef.current) { clearTimeout(hardLimitRef.current); hardLimitRef.current = null; }
    clearSilenceTimer();

    if (isNative) {
      await removeNativeListeners();
      try {
        const { SpeechRecognition } = await import("@capacitor-community/speech-recognition");
        await SpeechRecognition.stop();
      } catch { /* ignore */ }
      // Commit any final in-flight segment
      commitSegment();
      const final = accumulatedRef.current;
      if (final) setTranscript(final);
      setIsRecording(false);
      return;
    }

    if (!recognitionRef.current) return;
    try {
      recognitionRef.current.stop();
    } catch { /* ignore */ }
  }, [isNative]);

  const resetTranscript = useCallback(() => {
    accumulatedRef.current = "";
    latestSegmentRef.current = "";
    setTranscript("");
  }, []);

  return { isRecording, isSupported, transcript, startRecording, stopRecording, resetTranscript };
}
