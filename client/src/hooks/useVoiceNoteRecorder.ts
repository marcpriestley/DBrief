import { useState, useRef, useCallback } from "react";

export interface VoiceNoteRecorderResult {
  blob: Blob;
  mimeType: string;
}

export interface VoiceNoteRecorder {
  isRecording: boolean;
  isSupported: boolean;
  start: (onUnexpectedStop?: () => void) => Promise<boolean>;
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
  const isActiveRef = useRef(false);
  const mimeTypeRef = useRef("");
  const isRestartingRef = useRef(false);
  const onUnexpectedStopRef = useRef<(() => void) | undefined>(undefined);

  // Forward ref so tryRestart can call attachRecorder without circular deps
  const tryRestartRef = useRef<() => Promise<void>>(async () => {});

  const isSupported =
    typeof navigator !== "undefined" &&
    typeof window !== "undefined" &&
    typeof MediaRecorder !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia;

  const attachStream = useCallback((stream: MediaStream) => {
    streamRef.current = stream;

    // Watch for iOS killing the audio track mid-session
    stream.getAudioTracks().forEach((track) => {
      track.onended = () => {
        if (!isActiveRef.current || isRestartingRef.current) return;
        console.warn("[VoiceNoteRecorder] audio track ended unexpectedly — restarting");
        tryRestartRef.current();
      };
    });

    const mimeType = getPreferredMimeType();
    mimeTypeRef.current = mimeType;

    let recorder: MediaRecorder;
    try {
      recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
    } catch {
      recorder = new MediaRecorder(stream);
      mimeTypeRef.current = recorder.mimeType || "audio/webm";
    }

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        chunksRef.current.push(e.data);
      }
    };

    recorder.onerror = () => {
      if (!isActiveRef.current || isRestartingRef.current) return;
      console.warn("[VoiceNoteRecorder] MediaRecorder error — restarting");
      tryRestartRef.current();
    };

    try {
      recorder.start(500);
    } catch (err) {
      console.error("[VoiceNoteRecorder] recorder.start() failed:", err);
      // Will be caught by onerror or the caller
    }

    mediaRecorderRef.current = recorder;
  }, []);

  // Defined as a plain async fn stored in a ref to avoid circular useCallback deps
  tryRestartRef.current = async () => {
    if (!isActiveRef.current || isRestartingRef.current) return;
    isRestartingRef.current = true;

    // Gracefully stop the current recorder (don't flush chunks — keep what we have)
    const oldRecorder = mediaRecorderRef.current;
    if (oldRecorder && oldRecorder.state !== "inactive") {
      try {
        oldRecorder.onstop = null;
        oldRecorder.stop();
      } catch { /* ignore */ }
    }
    mediaRecorderRef.current = null;

    // Stop old stream tracks
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      if (!isActiveRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        isRestartingRef.current = false;
        return;
      }

      attachStream(stream);
    } catch (err) {
      console.error("[VoiceNoteRecorder] restart failed — mic unavailable:", err);
      isActiveRef.current = false;
      setIsRecording(false);
      onUnexpectedStopRef.current?.();
    } finally {
      isRestartingRef.current = false;
    }
  };

  const start = useCallback(async (onUnexpectedStop?: () => void): Promise<boolean> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      chunksRef.current = [];
      isActiveRef.current = true;
      isRestartingRef.current = false;
      onUnexpectedStopRef.current = onUnexpectedStop;

      attachStream(stream);
      setIsRecording(true);
      return true;
    } catch (err) {
      console.error("[VoiceNoteRecorder] start error:", err);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      isActiveRef.current = false;
      return false;
    }
  }, [attachStream]);

  const stop = useCallback((): Promise<VoiceNoteRecorderResult | null> => {
    return new Promise((resolve) => {
      isActiveRef.current = false;
      const recorder = mediaRecorderRef.current;
      setIsRecording(false);

      const mimeType = recorder?.mimeType || mimeTypeRef.current || "audio/webm";

      const finish = () => {
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        mediaRecorderRef.current = null;
        if (chunksRef.current.length > 0) {
          const blob = new Blob(chunksRef.current, { type: mimeType });
          chunksRef.current = [];
          resolve({ blob, mimeType });
        } else {
          chunksRef.current = [];
          resolve(null);
        }
      };

      if (!recorder || recorder.state === "inactive") {
        finish();
        return;
      }

      recorder.onstop = finish;

      try {
        recorder.stop();
      } catch {
        finish();
      }
    });
  }, []);

  const cancel = useCallback(() => {
    isActiveRef.current = false;
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
