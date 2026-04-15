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
  // True while the user wants to keep recording (even across auto-restarts)
  const isRecordingRef = useRef(false);
  // Text committed from completed recognition sessions (before each restart)
  const accumulatedRef = useRef("");
  // Latest segment from the current session (may still be interim)
  const latestSegmentRef = useRef("");
  // Timer used on native to detect when recognition has silently stopped
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Hard 5-min limit timer
  const hardLimitRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isNative = Capacitor.isNativePlatform();
  const isWebSpeechSupported =
    typeof window !== "undefined" &&
    ("webkitSpeechRecognition" in window || "SpeechRecognition" in window);
  const isSupported = isNative || isWebSpeechSupported;

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
      // "no-speech" is benign — just restart
      if (event.error === "no-speech" && isRecordingRef.current) return;
      console.error("Speech recognition error:", event.error);
      if (!isRecordingRef.current) setIsRecording(false);
    };

    // onend fires whenever recognition stops, including after a pause in speech.
    // If the user hasn't explicitly stopped, restart immediately so recording
    // continues uninterrupted through silences.
    recognition.onend = () => {
      if (isRecordingRef.current) {
        try {
          recognition.start();
        } catch {
          // Already started — safe to ignore
        }
      } else {
        setIsRecording(false);
      }
    };

    return () => {
      recognition.onend = null;
      try { recognition.abort(); } catch { /* ignore */ }
    };
  }, [isNative, isWebSpeechSupported]);

  // ── Native (iOS Capacitor) continuous recording ────────────────────────────
  // Strategy: after recognition stops due to silence, commit the last segment,
  // wait briefly, and restart. Repeat until stopRecording() is called.
  const nativeRestartIfNeeded = useCallback(async () => {
    if (!isRecordingRef.current) return;

    try {
      const { SpeechRecognition } = await import("@capacitor-community/speech-recognition");
      await SpeechRecognition.stop();
    } catch { /* ignore */ }

    // Commit the segment that was captured before the pause
    if (latestSegmentRef.current.trim()) {
      accumulatedRef.current = accumulatedRef.current
        ? (accumulatedRef.current + " " + latestSegmentRef.current).trim()
        : latestSegmentRef.current.trim();
      latestSegmentRef.current = "";
    }

    if (!isRecordingRef.current) {
      setIsRecording(false);
      return;
    }

    // Brief pause before restart so iOS doesn't reject the back-to-back call
    await new Promise<void>(r => setTimeout(r, 400));
    if (!isRecordingRef.current) { setIsRecording(false); return; }

    try {
      const { SpeechRecognition } = await import("@capacitor-community/speech-recognition");
      await SpeechRecognition.removeAllListeners();

      SpeechRecognition.addListener("partialResults", (data: { matches: string[] }) => {
        if (!data.matches?.[0]) return;
        latestSegmentRef.current = data.matches[0];
        const full = accumulatedRef.current
          ? (accumulatedRef.current + " " + data.matches[0]).trim()
          : data.matches[0].trim();
        setTranscript(full);

        // Reset the silence timer each time new speech arrives
        if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = setTimeout(() => nativeRestartIfNeeded(), 2000);
      });

      await SpeechRecognition.start({
        language: "en-US",
        maxResults: 1,
        partialResults: true,
        popup: false,
      });

      // Arm the initial silence timer in case no speech arrives at all
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = setTimeout(() => nativeRestartIfNeeded(), 3000);
    } catch (e) {
      console.error("Native speech restart error:", e);
      if (isRecordingRef.current) {
        setTimeout(() => nativeRestartIfNeeded(), 1000);
      } else {
        setIsRecording(false);
      }
    }
  }, []);

  // ── startRecording ─────────────────────────────────────────────────────────
  const startRecording = useCallback(async () => {
    accumulatedRef.current = "";
    latestSegmentRef.current = "";
    setTranscript("");
    isRecordingRef.current = true;
    setIsRecording(true);

    // Hard 5-minute limit
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

        await SpeechRecognition.removeAllListeners();

        SpeechRecognition.addListener("partialResults", (data: { matches: string[] }) => {
          if (!data.matches?.[0]) return;
          latestSegmentRef.current = data.matches[0];
          const full = accumulatedRef.current
            ? (accumulatedRef.current + " " + data.matches[0]).trim()
            : data.matches[0].trim();
          setTranscript(full);

          // Reset silence timer on each new word
          if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
          silenceTimerRef.current = setTimeout(() => nativeRestartIfNeeded(), 2000);
        });

        await SpeechRecognition.start({
          language: "en-US",
          maxResults: 1,
          partialResults: true,
          popup: false,
        });

        // Arm the initial silence timer
        if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = setTimeout(() => nativeRestartIfNeeded(), 3000);
      } catch (error) {
        console.error("Native speech recognition error:", error);
        isRecordingRef.current = false;
        setIsRecording(false);
      }
      return;
    }

    // Web path
    if (!recognitionRef.current) return;
    try {
      recognitionRef.current.start();
    } catch (error) {
      console.error("Error starting speech recognition:", error);
    }
  }, [isNative, nativeRestartIfNeeded]);

  // ── stopRecording ──────────────────────────────────────────────────────────
  const stopRecording = useCallback(async () => {
    isRecordingRef.current = false;

    if (hardLimitRef.current) { clearTimeout(hardLimitRef.current); hardLimitRef.current = null; }
    if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }

    if (isNative) {
      try {
        const { SpeechRecognition } = await import("@capacitor-community/speech-recognition");
        await SpeechRecognition.removeAllListeners();
        await SpeechRecognition.stop();
      } catch (error) {
        console.error("Error stopping native speech recognition:", error);
      }
      // Commit any final segment
      if (latestSegmentRef.current.trim()) {
        const final = accumulatedRef.current
          ? (accumulatedRef.current + " " + latestSegmentRef.current).trim()
          : latestSegmentRef.current.trim();
        setTranscript(final);
      }
      setIsRecording(false);
      return;
    }

    if (!recognitionRef.current) return;
    try {
      recognitionRef.current.stop();
    } catch (error) {
      console.error("Error stopping speech recognition:", error);
    }
  }, [isNative]);

  const resetTranscript = useCallback(() => {
    accumulatedRef.current = "";
    latestSegmentRef.current = "";
    setTranscript("");
  }, []);

  return { isRecording, isSupported, transcript, startRecording, stopRecording, resetTranscript };
}
