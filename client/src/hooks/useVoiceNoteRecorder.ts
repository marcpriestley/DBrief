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
const RETRY_DELAY_MS = [500, 1000, 2000, 3000]; // ms per attempt

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
  const lastChunkTimeRef    = useRef<number>(0);
  const visibilityHandlerRef = useRef<(() => void) | null>(null);

  // ── Session ID ────────────────────────────────────────────────────────────
  // Incremented on every start(). tryRestart captures this value so that any
  // async restart spawned by session N bails out immediately when session N+1
  // starts — preventing stale restarts from overwriting the new session's stream.
  const sessionIdRef = useRef(0);

  const tryRestartRef = useRef<(sessionId: number) => Promise<void>>(async () => {});

  const isSupported =
    typeof navigator !== "undefined" &&
    typeof window !== "undefined" &&
    typeof MediaRecorder !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia;

  // ── Keep-alive oscillator ─────────────────────────────────────────────────
  const startKeepAlive = useCallback(() => {
    try {
      const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx: AudioContext = new AudioCtx();
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.00001, ctx.currentTime);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      audioCtxRef.current     = ctx;
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

  // ── Heartbeat ─────────────────────────────────────────────────────────────
  const stopHeartbeat = useCallback(() => {
    if (heartbeatRef.current) { clearInterval(heartbeatRef.current); heartbeatRef.current = null; }
  }, []);

  const startHeartbeat = useCallback((sessionId: number) => {
    stopHeartbeat();
    heartbeatRef.current = setInterval(() => {
      if (!isActiveRef.current || sessionIdRef.current !== sessionId) { stopHeartbeat(); return; }
      if (isRestartingRef.current) return;
      const recState  = mediaRecorderRef.current?.state;
      const trackDead = streamRef.current?.getAudioTracks()[0]?.readyState === "ended";
      const now       = Date.now();
      const dataStarved = lastChunkTimeRef.current > 0 && (now - lastChunkTimeRef.current) > 5000;
      if (recState !== "recording" || trackDead || dataStarved) {
        console.warn(`[VoiceNote] heartbeat: recState=${recState} trackDead=${trackDead} dataStarved=${dataStarved}`);
        tryRestartRef.current(sessionId);
      }
    }, 1500);
  }, [stopHeartbeat]);

  // ── Visibility watcher ────────────────────────────────────────────────────
  const stopVisibilityWatcher = useCallback(() => {
    if (visibilityHandlerRef.current) {
      document.removeEventListener("visibilitychange", visibilityHandlerRef.current);
      visibilityHandlerRef.current = null;
    }
  }, []);

  const startVisibilityWatcher = useCallback((sessionId: number) => {
    stopVisibilityWatcher();
    const handler = () => {
      if (!isActiveRef.current || document.hidden || sessionIdRef.current !== sessionId) return;
      setTimeout(() => {
        if (!isActiveRef.current || sessionIdRef.current !== sessionId) return;
        resumeKeepAlive();
        const recState  = mediaRecorderRef.current?.state;
        const trackDead = streamRef.current?.getAudioTracks()[0]?.readyState === "ended";
        if (recState !== "recording" || trackDead) {
          console.warn("[VoiceNote] visibility: stream dead on foreground — restarting");
          tryRestartRef.current(sessionId);
        }
      }, 300);
    };
    visibilityHandlerRef.current = handler;
    document.addEventListener("visibilitychange", handler);
  }, [resumeKeepAlive, stopVisibilityWatcher]);

  // ── attachStream ──────────────────────────────────────────────────────────
  const attachStream = useCallback((stream: MediaStream, sessionId: number) => {
    streamRef.current = stream;

    stream.getAudioTracks().forEach((track) => {
      track.onended = () => {
        if (!isActiveRef.current || isRestartingRef.current || sessionIdRef.current !== sessionId) return;
        console.warn("[VoiceNote] track.onended — restarting");
        tryRestartRef.current(sessionId);
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
      if (!isActiveRef.current || isRestartingRef.current || sessionIdRef.current !== sessionId) return;
      console.warn("[VoiceNote] MediaRecorder.onerror — restarting");
      tryRestartRef.current(sessionId);
    };

    try { recorder.start(500); } catch (err) {
      console.error("[VoiceNote] recorder.start() threw:", err);
    }

    mediaRecorderRef.current = recorder;
  }, []);

  // ── tryRestart ────────────────────────────────────────────────────────────
  // Takes a sessionId — if the ID no longer matches the active session, the
  // restart bails without touching any state (prevents cross-session corruption).
  tryRestartRef.current = async (sessionId: number) => {
    if (!isActiveRef.current || isRestartingRef.current) return;
    if (sessionIdRef.current !== sessionId) return; // stale — different session started
    isRestartingRef.current = true;
    console.log("[VoiceNote] restarting stream (session", sessionId, ")...");

    const old = mediaRecorderRef.current;
    if (old && old.state !== "inactive") {
      try { old.onstop = null; old.stop(); } catch { /* ignore */ }
    }
    mediaRecorderRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;

    let lastErr: unknown;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      // Bail if session changed or recording was cancelled
      if (!isActiveRef.current || sessionIdRef.current !== sessionId) {
        isRestartingRef.current = false; return;
      }
      if (attempt > 0) {
        await new Promise<void>((res) => setTimeout(res, RETRY_DELAY_MS[attempt - 1]));
        if (!isActiveRef.current || sessionIdRef.current !== sessionId) {
          isRestartingRef.current = false; return;
        }
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
        if (!isActiveRef.current || sessionIdRef.current !== sessionId) {
          stream.getTracks().forEach((t) => t.stop());
          isRestartingRef.current = false; return;
        }
        attachStream(stream, sessionId);
        resumeKeepAlive();
        console.log(`[VoiceNote] restart OK (session ${sessionId}, attempt ${attempt + 1})`);
        isRestartingRef.current = false;
        return;
      } catch (err) {
        lastErr = err;
        console.warn(`[VoiceNote] restart attempt ${attempt + 1} failed:`, err);
      }
    }

    // Only give up if still the active session
    if (sessionIdRef.current !== sessionId) { isRestartingRef.current = false; return; }
    console.error("[VoiceNote] all restart attempts failed:", lastErr);
    isActiveRef.current = false;
    stopHeartbeat();
    stopKeepAlive();
    stopVisibilityWatcher();
    setIsRecording(false);
    onUnexpectedStopRef.current?.();
    isRestartingRef.current = false;
  };

  // ── Public API ────────────────────────────────────────────────────────────

  const start = useCallback(async (onUnexpectedStop?: () => void): Promise<boolean> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });

      // Increment session ID — invalidates any in-flight tryRestart from previous session
      const sessionId = ++sessionIdRef.current;

      chunksRef.current           = [];
      lastChunkTimeRef.current    = 0;
      isActiveRef.current         = true;
      isRestartingRef.current     = false;
      onUnexpectedStopRef.current = onUnexpectedStop;

      attachStream(stream, sessionId);
      startHeartbeat(sessionId);
      startKeepAlive();
      startVisibilityWatcher(sessionId);
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
        streamRef.current        = null;
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
    streamRef.current        = null;
    mediaRecorderRef.current = null;
  }, [stopHeartbeat, stopKeepAlive, stopVisibilityWatcher]);

  return { isRecording, isSupported, start, stop, cancel };
}
