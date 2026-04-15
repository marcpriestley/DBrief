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
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const keepAliveOscRef = useRef<OscillatorNode | null>(null);

  // tryRestart lives in a ref so heartbeat + track.onended can call it without circular deps
  const tryRestartRef = useRef<() => Promise<void>>(async () => {});

  const isSupported =
    typeof navigator !== "undefined" &&
    typeof window !== "undefined" &&
    typeof MediaRecorder !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia;

  // ── Keep-alive oscillator ──────────────────────────────────────────────────
  // Prevents iOS from suspending the WebKit audio session mid-recording.
  // The gain is set to an inaudible level so it produces no sound.
  const startKeepAlive = useCallback(() => {
    try {
      const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx: AudioContext = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.00001, ctx.currentTime);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      audioCtxRef.current = ctx;
      keepAliveOscRef.current = osc;
    } catch { /* not critical — skip silently */ }
  }, []);

  const stopKeepAlive = useCallback(() => {
    try { keepAliveOscRef.current?.stop(); } catch { /* ignore */ }
    keepAliveOscRef.current = null;
    try { audioCtxRef.current?.close(); } catch { /* ignore */ }
    audioCtxRef.current = null;
  }, []);

  // ── Heartbeat ──────────────────────────────────────────────────────────────
  // Polls every 1.5 s. If the MediaRecorder is no longer in "recording" state
  // (iOS can kill it silently without firing any event), it triggers a restart.
  const stopHeartbeat = useCallback(() => {
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
  }, []);

  const startHeartbeat = useCallback(() => {
    stopHeartbeat();
    heartbeatRef.current = setInterval(() => {
      if (!isActiveRef.current) { stopHeartbeat(); return; }
      if (isRestartingRef.current) return;
      const state = mediaRecorderRef.current?.state;
      if (state !== "recording") {
        console.warn("[VoiceNote] heartbeat: recorder state=" + state + " — restarting");
        tryRestartRef.current();
      }
    }, 1500);
  }, [stopHeartbeat]);

  // ── attachStream ───────────────────────────────────────────────────────────
  const attachStream = useCallback((stream: MediaStream) => {
    streamRef.current = stream;

    // Watch for iOS terminating individual audio tracks
    stream.getAudioTracks().forEach((track) => {
      track.onended = () => {
        if (!isActiveRef.current || isRestartingRef.current) return;
        console.warn("[VoiceNote] audio track ended — restarting");
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
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorder.onerror = () => {
      if (!isActiveRef.current || isRestartingRef.current) return;
      console.warn("[VoiceNote] MediaRecorder error — restarting");
      tryRestartRef.current();
    };

    try {
      recorder.start(500);
    } catch (err) {
      console.error("[VoiceNote] recorder.start() threw:", err);
    }

    mediaRecorderRef.current = recorder;
  }, []);

  // ── tryRestart (ref-stored, no deps) ──────────────────────────────────────
  tryRestartRef.current = async () => {
    if (!isActiveRef.current || isRestartingRef.current) return;
    isRestartingRef.current = true;
    console.log("[VoiceNote] restarting stream...");

    // Flush and discard old recorder — keep accumulated chunks
    const old = mediaRecorderRef.current;
    if (old && old.state !== "inactive") {
      try { old.onstop = null; old.stop(); } catch { /* ignore */ }
    }
    mediaRecorderRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });

      if (!isActiveRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        isRestartingRef.current = false;
        return;
      }

      attachStream(stream);
      console.log("[VoiceNote] restart OK");
    } catch (err) {
      // Mic genuinely unavailable — notify the parent so it can submit/cancel gracefully
      console.error("[VoiceNote] restart failed:", err);
      isActiveRef.current = false;
      stopHeartbeat();
      stopKeepAlive();
      setIsRecording(false);
      onUnexpectedStopRef.current?.();
    } finally {
      isRestartingRef.current = false;
    }
  };

  // ── Public API ─────────────────────────────────────────────────────────────

  const start = useCallback(async (onUnexpectedStop?: () => void): Promise<boolean> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });

      chunksRef.current = [];
      isActiveRef.current = true;
      isRestartingRef.current = false;
      onUnexpectedStopRef.current = onUnexpectedStop;

      attachStream(stream);
      startHeartbeat();
      startKeepAlive();
      setIsRecording(true);
      return true;
    } catch (err) {
      console.error("[VoiceNote] start error:", err);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      isActiveRef.current = false;
      return false;
    }
  }, [attachStream, startHeartbeat, startKeepAlive]);

  const stop = useCallback((): Promise<VoiceNoteRecorderResult | null> => {
    return new Promise((resolve) => {
      isActiveRef.current = false;
      stopHeartbeat();
      stopKeepAlive();
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
  }, [stopHeartbeat, stopKeepAlive]);

  const cancel = useCallback(() => {
    isActiveRef.current = false;
    stopHeartbeat();
    stopKeepAlive();
    const recorder = mediaRecorderRef.current;
    setIsRecording(false);
    chunksRef.current = [];
    if (recorder && recorder.state !== "inactive") {
      try { recorder.onstop = null; recorder.stop(); } catch { /* ignore */ }
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    mediaRecorderRef.current = null;
  }, [stopHeartbeat, stopKeepAlive]);

  return { isRecording, isSupported, start, stop, cancel };
}
