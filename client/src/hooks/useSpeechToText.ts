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

export function useSpeechToText(): SpeechToTextHook {
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const recognitionRef = useRef<any>(null);
  const isNative = Capacitor.isNativePlatform();

  const isWebSpeechSupported = typeof window !== "undefined" &&
    ("webkitSpeechRecognition" in window || "SpeechRecognition" in window);

  const isSupported = isNative || isWebSpeechSupported;

  useEffect(() => {
    if (isNative || !isWebSpeechSupported) return;

    const SpeechRecognition =
      window.SpeechRecognition || (window as any).webkitSpeechRecognition;

    recognitionRef.current = new SpeechRecognition();
    const recognition = recognitionRef.current;

    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onstart = () => {
      setIsRecording(true);
    };

    recognition.onresult = (event: any) => {
      let finalTranscript = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalTranscript += result[0].transcript + " ";
        }
      }

      if (finalTranscript.trim()) {
        setTranscript(prev => (prev + " " + finalTranscript).trim());
      }
    };

    recognition.onerror = (event: any) => {
      console.error("Speech recognition error:", event.error);
      setIsRecording(false);
    };

    recognition.onend = () => {
      setIsRecording(false);
    };

    return () => {
      if (recognition) {
        recognition.stop();
      }
    };
  }, [isNative, isWebSpeechSupported]);

  const startRecording = useCallback(async () => {
    setTranscript("");

    if (isNative) {
      try {
        const { SpeechRecognition } = await import("@capacitor-community/speech-recognition");

        const permResult = await SpeechRecognition.requestPermission();
        if (permResult.speechRecognition !== "granted") {
          console.error("Speech recognition permission denied");
          return;
        }

        setIsRecording(true);
        await SpeechRecognition.start({
          language: "en-US",
          maxResults: 1,
          partialResults: true,
          popup: false,
        });

        SpeechRecognition.addListener("partialResults", (data: { matches: string[] }) => {
          if (data.matches?.[0]) {
            setTranscript(data.matches[0]);
          }
        });

      } catch (error) {
        console.error("Native speech recognition error:", error);
        setIsRecording(false);
      }
      return;
    }

    if (!recognitionRef.current) return;
    try {
      recognitionRef.current.start();
    } catch (error) {
      console.error("Error starting speech recognition:", error);
    }
  }, [isNative]);

  const stopRecording = useCallback(async () => {
    if (isNative) {
      try {
        const { SpeechRecognition } = await import("@capacitor-community/speech-recognition");
        const result = await SpeechRecognition.stop();
        if (result?.matches?.[0]) {
          setTranscript(result.matches[0]);
        }
        setIsRecording(false);
      } catch (error) {
        console.error("Error stopping native speech recognition:", error);
        setIsRecording(false);
      }
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
    setTranscript("");
  }, []);

  return {
    isRecording,
    isSupported,
    transcript,
    startRecording,
    stopRecording,
    resetTranscript,
  };
}
