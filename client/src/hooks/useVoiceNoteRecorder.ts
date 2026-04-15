import { useState, useRef, useCallback } from "react";

export interface VoiceNoteRecorderResult {
  blob: Blob;
  mimeType: string;
}

export interface VoiceNoteRecorder {
  isRecording: boolean;
  isSupported: boolean;
  start: () => Promise<boolean>;
  stop: () => Promise<VoiceNoteRecorderResult | null>;
  cancel: () => void;
}

function getPreferredMimeType(): string {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
  ];
  for (const type of candidates) {
    try {
      if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type)) {
        return type;
      }
    } catch { /* ignore */ }
  }
  return "";
}

export function useVoiceNoteRecorder(): VoiceNoteRecorder {
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const isSupported =
    typeof navigator !== "undefined" &&
    typeof window !== "undefined" &&
    typeof MediaRecorder !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia;

  const start = useCallback(async (): Promise<boolean> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;
      chunksRef.current = [];

      const mimeType = getPreferredMimeType();
      let recorder: MediaRecorder;
      try {
        recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      } catch {
        recorder = new MediaRecorder(stream);
      }
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      recorder.onerror = (e) => {
        console.error("[VoiceNoteRecorder] MediaRecorder error:", e);
      };

      recorder.start(500);
      setIsRecording(true);
      return true;
    } catch (err) {
      console.error("[VoiceNoteRecorder] start error:", err);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      return false;
    }
  }, []);

  const stop = useCallback((): Promise<VoiceNoteRecorderResult | null> => {
    return new Promise((resolve) => {
      const recorder = mediaRecorderRef.current;
      setIsRecording(false);

      if (!recorder || recorder.state === "inactive") {
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        mediaRecorderRef.current = null;
        resolve(null);
        return;
      }

      const mimeType = recorder.mimeType || "audio/webm";

      recorder.onstop = () => {
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        mediaRecorderRef.current = null;
        const blob = new Blob(chunksRef.current, { type: mimeType });
        chunksRef.current = [];
        resolve({ blob, mimeType });
      };

      try {
        recorder.stop();
      } catch {
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        mediaRecorderRef.current = null;
        resolve(null);
      }
    });
  }, []);

  const cancel = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    setIsRecording(false);
    chunksRef.current = [];
    if (recorder && recorder.state !== "inactive") {
      try {
        recorder.onstop = null;
        recorder.stop();
      } catch { /* ignore */ }
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    mediaRecorderRef.current = null;
  }, []);

  return { isRecording, isSupported, start, stop, cancel };
}
