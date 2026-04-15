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

const MAX_RETRIES    = 4;
const RETRY_DELAY_MS = [500, 1000, 2000, 3000]; // backoff per attempt

function getPreferredMimeType(): string {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  for (const type of candidates) {
    try {
      if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type)) return type;
    } catch { /* ignore */ }
  }
  return "";
}

export function useVoiceNoteRecorder(): VoiceNoteRecorder {
  const [isRecording, setIsRecording] = useState(false);

  const mediaRecorderRef    = useRef<MediaRecorder | null>(null);
  const chunksRef           = useRef<Blob[]>([]);
  const streamRef           = useRef<MediaStream | null>(null);
  const isActiveRef         = useRef(false);
  const mimeTypeRef         = useRef("");
  const isRestartingRef     = useRef(false);
  const heartbeatRef        = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioCtxRef         = useRef<AudioContext | null>(null);
  const keepAliveOscRef     = useRef<OscillatorNode | null>(null);
  const onUnexpectedStopRef = useRef<(() => void) | undefined>(undefined);
  // Timestamp of the last non-empty ondataavailable chunk — used to detect
  // silent streams where iOS returns a "live" track but sends no audio data.
  const lastChunkTimeRef    = useRef<number>(0);

  // visibilitychange handler stored in a ref so we can remove the exact same fn
  const visibilityHandlerRef = useRef<(() => void) | null>(null);

  // tryRestart in a ref — avoids circular useCallback deps
  const tryRestartRef = useRef<() => Promise<void>>(async () => {});

  const isSupported =
    typeof navigator !== "undefined" &&
    typeof window !== "undefined" &&
    typeof MediaRecorder !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia;

  // ── Keep-alive oscillator ──────────────────────────────────────────────────
  // Prevents iOS from suspending the WebKit audio session while recording.
  const startKeepAlive = useCallback(() => {
    try {
      const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx: AudioContext = new AudioCtx();
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.00001, ctx.currentTime); // completely inaudible
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      audioCtxRef.current    = ctx;
      keepAliveOscRef.current = osc;
    } catch { /* not critical */ }
  }, []);

  const stopKeepAlive = useCallback(() => {
    try { keepAliveOscRef.current?.stop(); } catch { /* ignore */ }
    keepAliveOscRef.current = null;
    try { audioCtxRef.current?.close(); } catch { /* ignore */ }
    audioCtxRef.current = null;
  }, []);

  const resumeKeepAlive = useCallback(() => {
    if (audioCtxRef.current?.state === "suspended") {
      audioCtxRef.current.resume().catch(() => {});
    }
  }, []);

  // ── Heartbeat ──────────────────────────────────────────────────────────────
  // Polls every 1.5 s. Checks BOTH MediaRecorder.state AND the underlying audio
  // track's readyState — iOS can kill the track without changing recorder state.
  const stopHeartbeat = useCallback(() => {
    if (heartbeatRef.current) { clearInterval(heartbeatRef.current); heartbeatRef.current = null; }
  }, []);

  const startHeartbeat = useCallback(() => {
    stopHeartbeat();
    heartbeatRef.current = setInterval(() => {
      if (!isActiveRef.current) { stopHeartbeat(); return; }
      if (isRestartingRef.current) return;
      const recState   = mediaRecorderRef.current?.state;
      const trackDead  = streamRef.current?.getAudioTracks()[0]?.readyState === "ended";
      // Data starvation: recorder claims to be running but no audio chunks have
      // arrived in the last 5 s. This catches iOS "silent stream" hangs.
      const now = Date.now();
      const dataStarved = lastChunkTimeRef.current > 0 && (now - lastChunkTimeRef.current) > 5000;
      if (recState !== "recording" || trackDead || dataStarved) {
        console.warn(`[VoiceNote] heartbeat: recState=${recState} trackDead=${trackDead} dataStarved=${dataStarved} — restarting`);
        tryRestartRef.current();
      }
    }, 1500);
  }, [stopHeartbeat]);

  // ── Visibility handler ─────────────────────────────────────────────────────
  // When the app returns to foreground after being backgrounded/locked, iOS may
  // have silently killed the audio stream while JS was suspended. We proactively
  // restart the stream a short moment after the page becomes visible again.
  const startVisibilityWatcher = useCallback(() => {
    if (visibilityHandlerRef.current) {
      document.removeEventListener("visibilitychange", visibilityHandlerRef.current);
    }
    const handler = () => {
      if (!isActiveRef.current || document.hidden) return;
      // Short delay lets iOS fully restore the audio session before we probe
      setTimeout(() => {
        if (!isActiveRef.current) return;
        resumeKeepAlive();
        const recState  = mediaRecorderRef.current?.state;
        const trackDead = streamRef.current?.getAudioTracks()[0]?.readyState === "ended";
        if (recState !== "recording" || trackDead) {
          console.warn("[VoiceNote] visibility: stream dead after foreground — restarting");
          tryRestartRef.current();
        }
      }, 300);
    };
    visibilityHandlerRef.current = handler;
    document.addEventListener("visibilitychange", handler);
  }, [resumeKeepAlive]);

  const stopVisibilityWatcher = useCallback(() => {
    if (visibilityHandlerRef.current) {
      document.removeEventListener("visibilitychange", visibilityHandlerRef.current);
      visibilityHandlerRef.current = null;
    }
  }, []);

  // ── attachStream ───────────────────────────────────────────────────────────
  const attachStream = useCallback((stream: MediaStream) => {
    streamRef.current = stream;

    stream.getAudioTracks().forEach((track) => {
      track.onended = () => {
        if (!isActiveRef.current || isRestartingRef.current) return;
        console.warn("[VoiceNote] track.onended — restarting");
        tryRestartRef.current();
      };
    });

    const mimeType = getPreferredMimeType();
    mimeTypeRef.current = mimeType;

    let recorder: MediaRecorder;
    try {
      recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    } catch {
      recorder = new MediaRecorder(stream);
      mimeTypeRef.current = recorder.mimeType || "audio/webm";
    }

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        chunksRef.current.push(e.data);
        lastChunkTimeRef.current = Date.now();
      }
    };

    recorder.onerror = () => {
      if (!isActiveRef.current || isRestartingRef.current) return;
      console.warn("[VoiceNote] MediaRecorder.onerror — restarting");
      tryRestartRef.current();
    };

    try {
      recorder.start(500);
    } catch (err) {
      console.error("[VoiceNote] recorder.start() threw:", err);
    }

    mediaRecorderRef.current = recorder;
  }, []);

  // ── tryRestart (ref — no circular deps) ───────────────────────────────────
  // Retries up to MAX_RETRIES times with an increasing backoff before giving up.
  // This handles the common iOS case where getUserMedia fails immediately after
  // an audio-session interruption but succeeds after a short wait.
  tryRestartRef.current = async () => {
    if (!isActiveRef.current || isRestartingRef.current) return;
    isRestartingRef.current = true;
    console.log("[VoiceNote] restarting stream...");

    const old = mediaRecorderRef.current;
    if (old && old.state !== "inactive") {
      try { old.onstop = null; old.stop(); } catch { /* ignore */ }
    }
    mediaRecorderRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;

    let lastErr: unknown;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (!isActiveRef.current) { isRestartingRef.current = false; return; }
      if (attempt > 0) {
        // Wait before retrying — lets iOS restore the audio session
        await new Promise<void>((res) => setTimeout(res, RETRY_DELAY_MS[attempt - 1]));
        if (!isActiveRef.current) { isRestartingRef.current = false; return; }
      }
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
        resumeKeepAlive();
        console.log(`[VoiceNote] restart OK (attempt ${attempt + 1})`);
        isRestartingRef.current = false;
        return;
      } catch (err) {
        lastErr = err;
        console.warn(`[VoiceNote] restart attempt ${attempt + 1} failed:`, err);
      }
    }

    // All retries exhausted — mic is genuinely unavailable
    console.error("[VoiceNote] all restart attempts failed:", lastErr);
    isActiveRef.current = false;
    stopHeartbeat();
    stopKeepAlive();
    stopVisibilityWatcher();
    setIsRecording(false);
    onUnexpectedStopRef.current?.();
    isRestartingRef.current = false;
  };

  // ── Public API ─────────────────────────────────────────────────────────────

  const start = useCallback(async (onUnexpectedStop?: () => void): Promise<boolean> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });

      chunksRef.current           = [];
      lastChunkTimeRef.current    = 0; // reset before first data arrives
      isActiveRef.current         = true;
      isRestartingRef.current     = false;
      onUnexpectedStopRef.current = onUnexpectedStop;

      attachStream(stream);
      startHeartbeat();
      startKeepAlive();
      startVisibilityWatcher();
      setIsRecording(true);
      return true;
    } catch (err) {
      console.error("[VoiceNote] start error:", err);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current   = null;
      isActiveRef.current = false;
      return false;
    }
  }, [attachStream, startHeartbeat, startKeepAlive, startVisibilityWatcher]);

  const stop = useCallback((): Promise<VoiceNoteRecorderResult | null> => {
    return new Promise((resolve) => {
      isActiveRef.current = false;
      stopHeartbeat();
      stopKeepAlive();
      stopVisibilityWatcher();
      const recorder = mediaRecorderRef.current;
      setIsRecording(false);

      const mimeType = recorder?.mimeType || mimeTypeRef.current || "audio/webm";

      const finish = () => {
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current      = null;
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

      if (!recorder || recorder.state === "inactive") { finish(); return; }
      recorder.onstop = finish;
      try { recorder.stop(); } catch { finish(); }
    });
  }, [stopHeartbeat, stopKeepAlive, stopVisibilityWatcher]);

  const cancel = useCallback(() => {
    isActiveRef.current = false;
    stopHeartbeat();
    stopKeepAlive();
    stopVisibilityWatcher();
    const recorder = mediaRecorderRef.current;
    setIsRecording(false);
    chunksRef.current = [];
    if (recorder && recorder.state !== "inactive") {
      try { recorder.onstop = null; recorder.stop(); } catch { /* ignore */ }
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current      = null;
    mediaRecorderRef.current = null;
  }, [stopHeartbeat, stopKeepAlive, stopVisibilityWatcher]);

  return { isRecording, isSupported, start, stop, cancel };
}
