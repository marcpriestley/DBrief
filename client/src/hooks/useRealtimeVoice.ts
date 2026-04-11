import { useRef, useState, useCallback, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

export type RealtimeVoiceStatus =
  | "idle"
  | "connecting"
  | "ready"
  | "user_speaking"
  | "ai_speaking"
  | "error";

export interface RealtimeTranscript {
  role: "user" | "assistant";
  text: string;
}

interface UseRealtimeVoiceOptions {
  debriefId: number | null;
  date: string;
  onTranscript?: (t: RealtimeTranscript) => void;
  onToolExecuted?: (tool: string) => void;
  onError?: (msg: string) => void;
}

const SAMPLE_RATE = 24000;
const BUFFER_SIZE = 2048;

export function useRealtimeVoice({
  debriefId,
  date,
  onTranscript,
  onToolExecuted,
  onError,
}: UseRealtimeVoiceOptions) {
  const [status, setStatus] = useState<RealtimeVoiceStatus>("idle");
  // Use refs so connect() always has the latest values without stale closures
  const debriefIdRef = useRef(debriefId);
  debriefIdRef.current = debriefId;
  const dateRef = useRef(date);
  dateRef.current = date;
  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scheduledSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const nextAudioTimeRef = useRef<number>(0);
  const isAiSpeakingRef = useRef(false); // gate: suppress mic while AI audio plays
  const queryClient = useQueryClient();

  // ──────────────────────────────────────────────
  // Audio playback helpers
  // ──────────────────────────────────────────────

  const getPlaybackCtx = useCallback((): AudioContext => {
    if (!audioCtxRef.current || audioCtxRef.current.state === "closed") {
      audioCtxRef.current = new AudioContext({ sampleRate: SAMPLE_RATE });
    }
    if (audioCtxRef.current.state === "suspended") {
      audioCtxRef.current.resume().catch(() => {});
    }
    return audioCtxRef.current;
  }, []);

  const queueAudioChunk = useCallback((base64: string) => {
    try {
      const ctx = getPlaybackCtx();
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

      const int16 = new Int16Array(bytes.buffer);
      const float32 = new Float32Array(int16.length);
      for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768;

      const buffer = ctx.createBuffer(1, float32.length, SAMPLE_RATE);
      buffer.copyToChannel(float32, 0);

      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(ctx.destination);

      const startAt = Math.max(ctx.currentTime + 0.02, nextAudioTimeRef.current);
      src.start(startAt);
      nextAudioTimeRef.current = startAt + buffer.duration;

      scheduledSourcesRef.current.push(src);
      src.onended = () => {
        scheduledSourcesRef.current = scheduledSourcesRef.current.filter((s) => s !== src);
      };
    } catch {}
  }, [getPlaybackCtx]);

  const cancelAudio = useCallback(() => {
    scheduledSourcesRef.current.forEach((s) => { try { s.stop(); } catch {} });
    scheduledSourcesRef.current = [];
    nextAudioTimeRef.current = 0;
  }, []);

  // ──────────────────────────────────────────────
  // Microphone capture helpers
  // ──────────────────────────────────────────────

  const stopMic = useCallback(() => {
    try { processorRef.current?.disconnect(); } catch {}
    try { sourceRef.current?.disconnect(); } catch {}
    processorRef.current = null;
    sourceRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const startMic = useCallback(async (ws: WebSocket) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: SAMPLE_RATE,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;

      const ctx = getPlaybackCtx();
      const source = ctx.createMediaStreamSource(stream);
      sourceRef.current = source;

      // ScriptProcessorNode — deprecated but universally supported incl. Capacitor WebView
      const processor = ctx.createScriptProcessor(BUFFER_SIZE, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (e) => {
        if (ws.readyState !== WebSocket.OPEN) return;
        // Always send mic audio — even while AI is speaking — so OpenAI's server VAD
        // can detect barge-in and automatically cancel the current response.
        const float32 = e.inputBuffer.getChannelData(0);
        const int16 = new Int16Array(float32.length);
        for (let i = 0; i < float32.length; i++) {
          const clamped = Math.max(-1, Math.min(1, float32[i]));
          int16[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
        }
        const bytes = new Uint8Array(int16.buffer);
        let binary = "";
        for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
        ws.send(JSON.stringify({ type: "audio.append", audio: btoa(binary) }));
      };

      source.connect(processor);
      // Connect to destination with zero gain so we don't hear our own mic
      const gainNode = ctx.createGain();
      gainNode.gain.value = 0;
      processor.connect(gainNode);
      gainNode.connect(ctx.destination);
    } catch (err) {
      console.error("[RealtimeVoice] Mic error:", err);
      onError?.("Microphone access denied");
    }
  }, [getPlaybackCtx, onError]);

  // ──────────────────────────────────────────────
  // Connect / disconnect
  // ──────────────────────────────────────────────

  const connect = useCallback(async () => {
    if (wsRef.current) return;
    setStatus("connecting");

    const currentDate = dateRef.current;
    const currentDebriefId = debriefIdRef.current;
    const params = new URLSearchParams({ date: currentDate });
    if (currentDebriefId) params.set("debriefId", String(currentDebriefId));

    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const wsUrl = `${protocol}://${window.location.host}/api/realtime/voice?${params}`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      // Mic capture starts once session is ready (server sends session.ready)
    };

    ws.onmessage = async (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        switch (msg.type) {
          case "session.ready":
            setStatus("ready");
            await startMic(ws);
            break;

          case "audio.delta":
            isAiSpeakingRef.current = true; // gate mic while AI audio plays
            setStatus("ai_speaking");
            queueAudioChunk(msg.audio);
            break;

          case "audio.done": {
            // Wait for all scheduled audio to finish, then re-open the mic with a
            // 500 ms buffer so the tail of the AI voice doesn't leak into the mic.
            const waitForPlaybackEnd = () => {
              if (scheduledSourcesRef.current.length === 0) {
                setTimeout(() => {
                  isAiSpeakingRef.current = false;
                  setStatus("ready");
                }, 500);
              } else {
                setTimeout(waitForPlaybackEnd, 100);
              }
            };
            setTimeout(waitForPlaybackEnd, 100);
            break;
          }

          case "ai.responding":
            isAiSpeakingRef.current = true;
            setStatus("ai_speaking");
            break;

          case "ai.done":
            // Will flip back to ready once audio.done + playback finishes
            break;

          case "user.speaking":
            // Server VAD detected the real user voice — allow barge-in
            isAiSpeakingRef.current = false;
            cancelAudio();
            setStatus("user_speaking");
            break;

          case "user.silent":
            setStatus("ready");
            break;

          case "transcript.user":
            if (msg.text?.trim()) onTranscript?.({ role: "user", text: msg.text.trim() });
            break;

          case "transcript.ai":
            if (msg.text?.trim()) onTranscript?.({ role: "assistant", text: msg.text.trim() });
            break;

          case "tool.executed":
            onToolExecuted?.(msg.tool);
            // Invalidate relevant queries so UI refreshes
            queryClient.invalidateQueries({ queryKey: ["/api/goal-templates"] });
            queryClient.invalidateQueries({ queryKey: ["/api/daily-goals", date] });
            queryClient.invalidateQueries({ queryKey: ["/api/habits"] });
            queryClient.invalidateQueries({ queryKey: ["/api/long-term-goals"] });
            break;

          case "error":
            setStatus("error");
            onError?.(msg.message || "Voice session error");
            break;
        }
      } catch {}
    };

    ws.onerror = () => {
      setStatus("error");
      onError?.("Connection failed");
    };

    ws.onclose = () => {
      wsRef.current = null;
      stopMic();
      cancelAudio();
      setStatus("idle");
    };
  }, [startMic, stopMic, cancelAudio, queueAudioChunk, onTranscript, onToolExecuted, onError, queryClient]);

  const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    stopMic();
    cancelAudio();
    setStatus("idle");
  }, [stopMic, cancelAudio]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      wsRef.current?.close();
      stopMic();
      cancelAudio();
      try { audioCtxRef.current?.close(); } catch {}
    };
  }, []);

  const isActive = status !== "idle" && status !== "error";

  const promptEngineer = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "prompt.engineer" }));
    }
  }, []);

  // Explicit barge-in: cancel AI audio locally and tell OpenAI to stop the response
  const interrupt = useCallback(() => {
    cancelAudio();
    isAiSpeakingRef.current = false;
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "interrupt" }));
    }
    setStatus("ready");
  }, [cancelAudio]);

  return { status, isActive, connect, disconnect, promptEngineer, interrupt };
}
