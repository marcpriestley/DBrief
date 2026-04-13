import { useState, useEffect, useRef, useCallback } from "react";
import { haptic } from "@/lib/haptics";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { MessageCircle, Send, CheckCircle, Loader2, RotateCcw, Mic, MicOff, ArrowRight, Volume2, VolumeX, Square, ChevronDown, Radio, Waves, AudioLines } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { motion, AnimatePresence } from "framer-motion";
import { Capacitor } from "@capacitor/core";
import { openAppSettings } from "@/hooks/useNativeNotifications";
import { useTTS, warmAudioCtx } from "@/hooks/useTTS";
import { useRealtimeVoice, type RealtimeTranscript } from "@/hooks/useRealtimeVoice";

interface DebriefMessage {
  id: number;
  debriefId: number;
  role: string;
  content: string;
  createdAt: string;
}

interface Debrief {
  id: number;
  userId: number;
  date: string;
  summary: string | null;
  isComplete: boolean;
  createdAt: string;
  messages: DebriefMessage[];
}

interface DebriefPanelProps {
  selectedDate: string;
}

const CORE_EXCHANGES = 3;

function formatMsgTime(isoStr: string) {
  try {
    const d = new Date(isoStr);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

// How long of unbroken silence (no new speech) before the mic auto-stops
const AUTO_STOP_SILENCE_MS = 30_000;
// Default poll interval for native keep-alive. Shorter = faster restart, more stop/start churn.
const NATIVE_RESTART_POLL_MS = 1_200;
// For regular chat mic: restart less aggressively so natural speech pauses (1-2 s) aren't
// interrupted by a stop/start cycle that creates a brief dead-mic window.
const NATIVE_RESTART_POLL_CHAT_MS = 2_500;

function useInlineVoice() {
  const [isListening, setIsListening] = useState(false);
  const [interimText, setInterimText] = useState("");
  const [micError, setMicError] = useState<string | null>(null);
  const recognitionRef = useRef<any>(null);
  const accumulatedRef = useRef("");
  const shouldListenRef = useRef(false);
  const isStoppingRef = useRef(false);
  const onFinalRef = useRef<((text: string) => void) | null>(null);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const watchdogRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const nativeListenerRef = useRef<any>(null);
  const micPermGrantedRef = useRef(false);
  // Silence tracking — auto-stop only after this many ms with no speech
  const lastSpeechTimeRef = useRef<number>(0);
  const silenceAutoStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nativeSilenceCheckRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const nativeIsRestartingRef = useRef(false); // prevents concurrent restart sequences
  // stopRef lets timers call stop() without a forward-reference problem
  const stopRef = useRef<() => Promise<void>>(async () => {});
  // Configurable silence timeout and callback for conversation mode
  const autoStopMsRef = useRef<number>(AUTO_STOP_SILENCE_MS);
  const onSilenceStopRef = useRef<((text: string) => void) | null>(null);
  // When true, silence NEVER auto-stops the mic — only an explicit stop() call does
  const noSilenceStopRef = useRef<boolean>(false);
  // How long of silence before native keep-alive restarts recognition. Lower = faster recovery
  // but risks stopping a recognition that's still alive (creating a brief dead-mic window).
  const restartThresholdMsRef = useRef<number>(NATIVE_RESTART_POLL_MS);

  const isNative = Capacitor.isNativePlatform();
  const isSupported =
    isNative || // on native we always try (plugin or web speech fallback)
    (typeof window !== "undefined" &&
      ("webkitSpeechRecognition" in window || "SpeechRecognition" in window));

  const startRecognitionRef = useRef<() => void>(() => {});

  startRecognitionRef.current = () => {
    if (!isSupported || !shouldListenRef.current) return;

    // If a recognition is already running, don't double-start
    if (recognitionRef.current) return;

    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }

    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const recognition = new SR();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.lang = "en-US";

    recognition.onstart = () => {
      if (shouldListenRef.current) setIsListening(true);
    };

    recognition.onresult = (e: any) => {
      let finalChunk = "";
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalChunk += t;
        else interim += t;
      }
      if (finalChunk) {
        accumulatedRef.current += (accumulatedRef.current ? " " : "") + finalChunk.trim();
        onFinalRef.current?.(accumulatedRef.current);
      }
      setInterimText(interim);
      // Any speech resets the silence auto-stop timer (skipped in noSilenceStop mode)
      lastSpeechTimeRef.current = Date.now();
      if (!noSilenceStopRef.current) {
        if (silenceAutoStopRef.current) clearTimeout(silenceAutoStopRef.current);
        silenceAutoStopRef.current = setTimeout(async () => {
          if (!shouldListenRef.current) return;
          onSilenceStopRef.current?.(accumulatedRef.current);
          await stopRef.current();
        }, autoStopMsRef.current);
      }
    };

    recognition.onerror = (e: any) => {
      // Transient/recoverable errors — ignore and let onend restart recognition
      if (e.error === "aborted" || e.error === "no-speech" || e.error === "audio-capture" || e.error === "network") return;
      shouldListenRef.current = false;
      setIsListening(false);
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        setMicError("SETTINGS_NEEDED");
      } else {
        setMicError("ERR:" + e.error);
      }
    };

    recognition.onend = () => {
      setInterimText("");
      // Guard: ignore stale onend callbacks from replaced/stopped instances
      if (recognitionRef.current !== recognition) return;
      // Clear ref FIRST so the next startRecognitionRef.current() sees a clean slate
      recognitionRef.current = null;

      if (shouldListenRef.current) {
        // Give the browser 300ms to fully release the audio device before reopening
        restartTimerRef.current = setTimeout(() => {
          if (shouldListenRef.current) startRecognitionRef.current();
        }, 300);
      } else {
        setIsListening(false);
      }
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      recognitionRef.current = null;
      if (shouldListenRef.current) {
        restartTimerRef.current = setTimeout(() => {
          if (shouldListenRef.current) startRecognitionRef.current();
        }, 500);
      }
    }
  };

  const start = useCallback(
    async (onFinal: (text: string) => void, opts?: { autoStopMs?: number; onSilenceStop?: (text: string) => void; noSilenceStop?: boolean; restartThresholdMs?: number }) => {
      if (!isSupported) return;

      accumulatedRef.current = "";
      onFinalRef.current = onFinal;
      autoStopMsRef.current = opts?.autoStopMs ?? AUTO_STOP_SILENCE_MS;
      onSilenceStopRef.current = opts?.onSilenceStop ?? null;
      noSilenceStopRef.current = opts?.noSilenceStop ?? false;
      restartThresholdMsRef.current = opts?.restartThresholdMs ?? NATIVE_RESTART_POLL_MS;
      // Clear any stale silence timer from a previous session
      if (silenceAutoStopRef.current) { clearTimeout(silenceAutoStopRef.current); silenceAutoStopRef.current = null; }

      // --- Native iOS path via Capacitor plugin (with Web Speech API fallback) ---
      if (isNative) {
        let pluginWorked = false;
        try {
          const { SpeechRecognition } = await import("@capacitor-community/speech-recognition");

          let permResult = await SpeechRecognition.checkPermissions();
          console.log("[Voice] Capacitor plugin available. Permission state:", permResult);

          if (permResult.speechRecognition === "denied" || permResult.microphone === "denied") {
            setMicError("SETTINGS_NEEDED");
            setIsListening(false);
            return;
          }

          if (permResult.speechRecognition !== "granted" || permResult.microphone !== "granted") {
            permResult = await SpeechRecognition.requestPermissions();
          }

          if (permResult.speechRecognition !== "granted" || permResult.microphone !== "granted") {
            setMicError("SETTINGS_NEEDED");
            setIsListening(false);
            return;
          }

          pluginWorked = true;
          isStoppingRef.current = false;
          setIsListening(true);
          if (nativeListenerRef.current) {
            nativeListenerRef.current.remove();
            nativeListenerRef.current = null;
          }
          nativeListenerRef.current = await SpeechRecognition.addListener("partialResults", (data: { matches: string[] }) => {
            if (isStoppingRef.current) return;
            const partial = data.matches?.[0] || "";
            setInterimText(partial);
            accumulatedRef.current = partial;
            onFinalRef.current?.(partial);
            // Track last speech so the silence-check loop can restart iOS recognition
            if (partial) {
              lastSpeechTimeRef.current = Date.now();
              if (!noSilenceStopRef.current) {
                if (silenceAutoStopRef.current) clearTimeout(silenceAutoStopRef.current);
                silenceAutoStopRef.current = setTimeout(async () => {
                  if (!shouldListenRef.current) return;
                  onSilenceStopRef.current?.(accumulatedRef.current);
                  await stopRef.current();
                }, autoStopMsRef.current);
              }
            }
          });

          lastSpeechTimeRef.current = Date.now();

          // iOS kills speech recognition after a short pause (~1–2 s of silence).
          // This loop silently restarts it so the mic stays hot until the user taps stop
          // or the auto-stop timer above fires.
          nativeIsRestartingRef.current = false;
          if (nativeSilenceCheckRef.current) clearInterval(nativeSilenceCheckRef.current);
          nativeSilenceCheckRef.current = setInterval(async () => {
            if (!shouldListenRef.current || isStoppingRef.current || nativeIsRestartingRef.current) return;
            const silenceDuration = Date.now() - lastSpeechTimeRef.current;
            // If iOS has been quiet for ≥ restartThresholdMs and we haven't hit the
            // auto-stop ceiling in timed mode, restart recognition.
            const pastRestartThreshold = silenceDuration >= restartThresholdMsRef.current;
            const belowAutoStop = noSilenceStopRef.current || silenceDuration < autoStopMsRef.current;
            if (pastRestartThreshold && belowAutoStop) {
              nativeIsRestartingRef.current = true;
              try {
                await SpeechRecognition.stop().catch(() => {});
                if (!shouldListenRef.current || isStoppingRef.current) { nativeIsRestartingRef.current = false; return; }
                await SpeechRecognition.start({
                  language: "en-US",
                  maxResults: 1,
                  partialResults: true,
                  popup: false,
                });
                // Reset the clock so we don't fire again immediately on the very next tick
                lastSpeechTimeRef.current = Date.now();
              } catch {
                // ignore — next tick will retry
              } finally {
                nativeIsRestartingRef.current = false;
              }
            }
          }, NATIVE_RESTART_POLL_MS);

          await SpeechRecognition.start({
            language: "en-US",
            maxResults: 1,
            partialResults: true,
            popup: false,
          });
          return;
        } catch (err: any) {
          const msg = String(err?.message || err || "");
          if (msg.toLowerCase().includes("not implemented") || msg.toLowerCase().includes("not available")) {
            // Plugin not registered in this build — fall through to Web Speech API
            console.log("[Voice] Native plugin not registered, falling back to Web Speech API");
          } else if (msg.toLowerCase().includes("denied") || msg.toLowerCase().includes("permission") || msg.toLowerCase().includes("not authorized")) {
            setMicError("SETTINGS_NEEDED");
            setIsListening(false);
            return;
          } else if (!pluginWorked) {
            console.log("[Voice] Plugin error, falling back to Web Speech API:", msg);
          } else {
            setMicError("ERR:" + msg);
            setIsListening(false);
            return;
          }
        }
      }

      // --- Web Speech API path (browser + native fallback) ---
      const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (!SR) {
        setMicError("Voice not supported in this environment.");
        return;
      }

      // Request microphone permission — only needed once (subsequent calls can hang on iOS WKWebView)
      if (!micPermGrantedRef.current && navigator.mediaDevices?.getUserMedia) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          stream.getTracks().forEach((t) => t.stop());
          micPermGrantedRef.current = true;
        } catch {
          setMicError("SETTINGS_NEEDED");
          return;
        }
      }

      shouldListenRef.current = true;
      startRecognitionRef.current();
      if (watchdogRef.current) clearInterval(watchdogRef.current);
      watchdogRef.current = setInterval(() => {
        if (shouldListenRef.current && !recognitionRef.current && !restartTimerRef.current) {
          startRecognitionRef.current();
        }
      }, 2000);
    },
    [isSupported, isNative],
  );

  const stop = useCallback(async () => {
    // Set stopping flag FIRST to block any pending partialResults callbacks
    isStoppingRef.current = true;
    setInterimText("");
    setIsListening(false);
    shouldListenRef.current = false;
    if (watchdogRef.current) { clearInterval(watchdogRef.current); watchdogRef.current = null; }
    if (restartTimerRef.current) { clearTimeout(restartTimerRef.current); restartTimerRef.current = null; }
    if (nativeSilenceCheckRef.current) { clearInterval(nativeSilenceCheckRef.current); nativeSilenceCheckRef.current = null; }
    if (silenceAutoStopRef.current) { clearTimeout(silenceAutoStopRef.current); silenceAutoStopRef.current = null; }
    nativeIsRestartingRef.current = false;

    if (isNative) {
      // Remove listener FIRST so no more partialResults fire during/after stop
      if (nativeListenerRef.current) {
        try { nativeListenerRef.current.remove(); } catch {}
        nativeListenerRef.current = null;
      }
      // Then tell the plugin to stop (may take a moment on older iOS)
      try {
        const { SpeechRecognition } = await import("@capacitor-community/speech-recognition");
        await Promise.race([
          SpeechRecognition.stop(),
          new Promise<void>(res => setTimeout(res, 500)), // 500ms timeout safety net
        ]);
      } catch {}
    }

    // Always clean up Web Speech API (used as fallback on native too)
    const old = recognitionRef.current;
    recognitionRef.current = null;
    try { old?.abort(); } catch {}
  }, [isNative]);

  // Keep stopRef in sync so timers can call stop() without a forward-reference issue
  stopRef.current = stop;

  useEffect(() => {
    return () => {
      shouldListenRef.current = false;
      if (watchdogRef.current) clearInterval(watchdogRef.current);
      if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
      if (nativeSilenceCheckRef.current) clearInterval(nativeSilenceCheckRef.current);
      if (silenceAutoStopRef.current) clearTimeout(silenceAutoStopRef.current);
      const old = recognitionRef.current;
      recognitionRef.current = null;
      try { old?.abort(); } catch {}
      if (nativeListenerRef.current) {
        nativeListenerRef.current.remove();
        nativeListenerRef.current = null;
      }
      if (isNative) {
        import("@capacitor-community/speech-recognition").then(({ SpeechRecognition }) => {
          SpeechRecognition.stop().catch(() => {});
        });
      }
    };
  }, [isNative]);

  const clearMicError = useCallback(() => setMicError(null), []);
  return { isListening, interimText, isSupported, start, stop, micError, clearMicError };
}

export default function DebriefPanel({ selectedDate }: DebriefPanelProps) {
  const [userInput, setUserInput] = useState("");
  const [streamingContent, setStreamingContent] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [openingStreamContent, setOpeningStreamContent] = useState("");
  const [isOpeningStreaming, setIsOpeningStreaming] = useState(false);
  const [isConversationMode, setIsConversationMode] = useState(false);
  const conversationActiveRef = useRef(false);
  const conversationWaitingForTtsRef = useRef(false);
  const prevTtsSpeakingRef = useRef(false);
  const hadTtsResponseRef = useRef(false);
  // Always up-to-date function for starting a conversation voice turn (ref avoids stale closures)
  const startConversationVoiceRef = useRef<() => void>(() => {});
  const bargeInRecognitionRef = useRef<any>(null);
  const [continuedPastCheckpoint, setContinuedPastCheckpoint] = useState(false);
  const [actionNotifications, setActionNotifications] = useState<Array<{ type: string; message: string; success: boolean; id: number }>>([]);
  const [showAllMessages, setShowAllMessages] = useState(false);
  const [expandedSessions, setExpandedSessions] = useState<Set<number>>(new Set());
  const toggleSession = (id: number) => setExpandedSessions(prev => {
    const s = new Set(prev);
    s.has(id) ? s.delete(id) : s.add(id);
    return s;
  });

  // Voice note mode — long-form voice dump that only sends on explicit Submit
  const [voiceNoteMode, setVoiceNoteMode] = useState(false);
  // "live" or "voice" — which quick-start chip is selected when there are no messages yet
  const [inputStartMode, setInputStartMode] = useState<"live" | "voice">("voice");
  const [voiceNoteSeconds, setVoiceNoteSeconds] = useState(0);
  const voiceNoteTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const voiceNoteTextRef = useRef(""); // accumulated transcript (mirrors voice.interimText continuously)

  const VISIBLE_MESSAGES = 6;
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const debriefCardRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const focusMountedRef = useRef(false);
  // Index into `accumulated` where the first sentence ends (0 = no sentence spoken yet)
  const ttsFirstSentenceRef = useRef<number>(0);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const voice = useInlineVoice();
  const tts = useTTS();

  // ── Realtime (OpenAI Realtime API) voice mode ──────────────────────────────
  const [realtimeMessages, setRealtimeMessages] = useState<RealtimeTranscript[]>([]);
  // activeDebriefId is set below after query loads; the hook reads it via a ref so it always uses latest
  const [activeDebriefId, setActiveDebriefId] = useState<number | null>(null);
  const realtimeVoice = useRealtimeVoice({
    debriefId: activeDebriefId,
    date: selectedDate,
    onTranscript: (t) => setRealtimeMessages((prev) => [...prev, t]),
    onToolExecuted: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/goal-templates"] });
      queryClient.invalidateQueries({ queryKey: ["/api/habits"] });
      queryClient.invalidateQueries({ queryKey: ["/api/long-term-goals"] });
    },
    onError: (msg) => toast({ title: "Voice error", description: msg, variant: "destructive" }),
  });

  const { data: allDebriefs = [], isLoading } = useQuery<Debrief[]>({
    queryKey: ["/api/debriefs", selectedDate],
    queryFn: async () => {
      const response = await fetch(`/api/debriefs/${selectedDate}`, { credentials: "include" });
      if (!response.ok) return [];
      const data = await response.json();
      return Array.isArray(data) ? data : (data ? [data] : []);
    },
    staleTime: 5 * 60 * 1000,
  });

  // Normalise — old cache entries could be a single object or null; always work with an array
  const safeDebriefs: Debrief[] = Array.isArray(allDebriefs)
    ? allDebriefs
    : allDebriefs ? [allDebriefs as unknown as Debrief] : [];
  // Active = the one in-progress debrief for this day (if any)
  const debrief = safeDebriefs.find(d => !d.isComplete) ?? null;
  // All completed debriefs, oldest first
  const completedDebriefs = safeDebriefs.filter(d => d.isComplete);

  const userMessageCount = debrief?.messages?.filter(m => m.role === "user").length || 0;
  const assistantMessageCount = debrief?.messages?.filter(m => m.role === "assistant").length || 0;

  const isAtCheckpoint =
    !debrief?.isComplete &&
    !isStreaming &&
    userMessageCount >= CORE_EXCHANGES &&
    assistantMessageCount > userMessageCount - 1 &&
    !continuedPastCheckpoint;

  const isAtExtendedCheckpoint =
    !debrief?.isComplete &&
    !isStreaming &&
    continuedPastCheckpoint &&
    userMessageCount > CORE_EXCHANGES &&
    assistantMessageCount > userMessageCount - 1 &&
    (userMessageCount - CORE_EXCHANGES) % 2 === 0;

  const showCheckpoint = isAtCheckpoint || isAtExtendedCheckpoint;

  // Keep activeDebriefId in sync so the realtime voice hook always knows which debrief to save to
  useEffect(() => {
    if (debrief?.id && debrief.id !== activeDebriefId) setActiveDebriefId(debrief.id);
  }, [debrief?.id]);

  const toggleRealtimeVoice = async () => {
    haptic("medium");
    if (realtimeVoice.isActive) {
      realtimeVoice.disconnect();
      // Sync DB messages after session ends
      setTimeout(() => queryClient.invalidateQueries({ queryKey: ["/api/debriefs", selectedDate] }), 800);
    } else {
      if (!debrief) {
        toast({ title: "Start a debrief first", description: "Open a session before going live." });
        return;
      }
      setRealtimeMessages([]);
      realtimeVoice.connect();
    }
  };

  const startDebriefMutation = useMutation({
    mutationFn: async (opts: { fresh?: boolean; userLed?: boolean } = {}) => {
      const response = await fetch("/api/debriefs/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ date: selectedDate, fresh: !!opts.fresh, userLed: !!opts.userLed }),
      });

      if (!response.ok) throw new Error("Failed to start debrief");

      const contentType = response.headers.get("Content-Type") || "";

      // Resuming an existing session or user-led mode returns JSON — no streaming needed
      if (contentType.includes("application/json")) {
        return response.json() as Promise<Debrief>;
      }

      // AI-led new debrief: the server streams the opening message via SSE
      setIsOpeningStreaming(true);
      setOpeningStreamContent("");
      ttsFirstSentenceRef.current = 0;

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No stream");
      const decoder = new TextDecoder();
      let accumulated = "";

      outer: while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split("\n")) {
          if (!line.startsWith("data: ")) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.error) throw new Error(data.error);
            if (data.content) {
              accumulated += data.content;
              setOpeningStreamContent(accumulated);
              // TTS: speak first complete sentence immediately
              if (tts.enabled && ttsFirstSentenceRef.current === 0) {
                const sentMatch = /[^.!?\n]{15,}[.!?][\s\n]/.exec(accumulated);
                if (sentMatch) {
                  const end = sentMatch.index + sentMatch[0].length;
                  ttsFirstSentenceRef.current = end;
                  tts.speakNow(accumulated.slice(0, end).trim());
                }
              }
            }
            if (data.done) break outer;
          } catch {}
        }
      }

      // TTS remainder after streaming completes
      if (accumulated && tts.enabled) {
        const remainder = ttsFirstSentenceRef.current
          ? accumulated.slice(ttsFirstSentenceRef.current).trim()
          : accumulated;
        if (remainder) tts.speakOrQueue(remainder);
      }

      return null;
    },
    onSuccess: () => {
      // Always re-fetch from server so all sessions (including previous ones) are in the list
      queryClient.invalidateQueries({ queryKey: ["/api/debriefs", selectedDate] });
      queryClient.invalidateQueries({ queryKey: ["/api/dates-with-data"] });
      setContinuedPastCheckpoint(false);
      setIsOpeningStreaming(false);
      setOpeningStreamContent("");
    },
    onError: () => {
      setIsOpeningStreaming(false);
      setOpeningStreamContent("");
      toast({ title: "Couldn't start debrief", description: "Please try again.", variant: "destructive" });
    },
  });

  const completeDebriefMutation = useMutation({
    mutationFn: async (debriefId: number) => {
      const response = await apiRequest("POST", `/api/debriefs/${debriefId}/complete`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/debriefs", selectedDate] });
      queryClient.invalidateQueries({ queryKey: ["/api/journal-entries", selectedDate] });
      queryClient.invalidateQueries({ queryKey: ["/api/streak"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dates-with-data"] });
      // Always end conversation mode when a debrief is completed
      conversationActiveRef.current = false;
      conversationWaitingForTtsRef.current = false;
      setIsConversationMode(false);
    },
  });

  const sendMessage = async (text: string) => {
    if (!text.trim() || !debrief || isStreaming) return;

    setUserInput("");
    // Scroll the page to top so the debrief conversation is in view (not Goals or other sections)
    // Small delay lets iOS keyboard dismissal settle before we move the scroll position
    setTimeout(() => window.scrollTo({ top: 0, behavior: "smooth" }), 80);
    setIsStreaming(true);
    setStreamingContent("");
    ttsFirstSentenceRef.current = 0;
    hadTtsResponseRef.current = false;

    if (voice.isListening) voice.stop();
    tts.cancel();

    const optimisticMsg: DebriefMessage = {
      id: Date.now(),
      debriefId: debrief.id,
      role: "user",
      content: text.trim(),
      createdAt: new Date().toISOString(),
    };

    queryClient.setQueryData(["/api/debriefs", selectedDate], (old: Debrief[] | undefined) => {
      if (!old) return old;
      return old.map(d => {
        if (!d.isComplete && d.id === (debrief?.id ?? d.id)) {
          return { ...d, messages: [...d.messages, optimisticMsg] };
        }
        return d;
      });
    });

    try {
      const response = await fetch(`/api/debriefs/${debrief.id}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ content: text.trim() }),
      });

      if (!response.ok) throw new Error("Failed to send");

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response stream");

      const decoder = new TextDecoder();
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.done) break;
              if (data.content) {
                accumulated += data.content;
                setStreamingContent(accumulated);
                // Speak the first complete sentence immediately (minimum latency TTS)
                if (tts.enabled && ttsFirstSentenceRef.current === 0) {
                  const sentMatch = /[^.!?\n]{15,}[.!?][\s\n]/.exec(accumulated);
                  if (sentMatch) {
                    const end = sentMatch.index + sentMatch[0].length;
                    ttsFirstSentenceRef.current = end;
                    tts.speakNow(accumulated.slice(0, end).trim());
                  }
                }
              }
              if (data.actions) {
                const newNotifications = data.actions.map((a: any, i: number) => ({
                  id: Date.now() + i,
                  type: a.type,
                  message: a.message,
                  success: a.success,
                }));
                setActionNotifications(prev => [...prev, ...newNotifications]);
                if (data.actions.some((a: any) => (a.type === "add_daily_goal" || a.type === "remove_daily_goal") && a.success)) {
                  queryClient.invalidateQueries({ queryKey: ["/api/goal-templates"] });
                  queryClient.invalidateQueries({ queryKey: ["/api/daily-goals"] });
                }
                if (data.actions.some((a: any) => a.type === "add_long_term_goal" && a.success)) {
                  queryClient.invalidateQueries({ queryKey: ["/api/long-term-goals"] });
                }
                if (data.actions.some((a: any) => (a.type === "add_habit" || a.type === "remove_habit") && a.success)) {
                  queryClient.invalidateQueries({ queryKey: ["/api/habits"] });
                }
              }
            } catch {}
          }
        }
      }

      queryClient.invalidateQueries({ queryKey: ["/api/debriefs", selectedDate] });
      // Speak: if first sentence was already started, queue the rest; otherwise speak all.
      // Pre-fetch the remainder audio NOW (before first sentence finishes) to eliminate
      // the inter-fetch silence gap between the two TTS calls.
      if (accumulated) {
        const remainder = ttsFirstSentenceRef.current
          ? accumulated.slice(ttsFirstSentenceRef.current).trim()
          : accumulated;
        if (remainder) {
          if (ttsFirstSentenceRef.current && tts.enabled) {
            // First sentence is already playing — start fetching remainder in background
            tts.preFetchAudio(remainder);
          }
          tts.speakOrQueue(remainder);
          hadTtsResponseRef.current = tts.enabled;
        }
      }
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }, 100);
    } catch {
      toast({ title: "Error", description: "Failed to send message. Try again.", variant: "destructive" });
    } finally {
      setIsStreaming(false);
      setStreamingContent("");
      // Conversation mode: if no TTS was queued, restart mic immediately after response
      if (conversationActiveRef.current && !hadTtsResponseRef.current) {
        setTimeout(() => {
          if (conversationActiveRef.current) startConversationVoiceRef.current();
        }, 600);
      } else if (conversationActiveRef.current && hadTtsResponseRef.current) {
        conversationWaitingForTtsRef.current = true;
      }
    }
  };

  const handleSend = () => {
    const textToSend = userInput.trim();
    if (!textToSend) return;
    // Auto-stop mic before sending so the recording never blocks the next state
    if (voice.isListening) voice.stop();
    haptic("medium");
    // Warm the AudioContext during this user gesture so auto-speak works after streaming
    warmAudioCtx();
    if (showCheckpoint) setContinuedPastCheckpoint(true);
    sendMessage(textToSend);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleTextareaInput = (e: React.FormEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  };

  const micLastToggleRef = useRef(0);
  const handleMicToggle = () => {
    // Debounce: ignore taps within 400ms of last toggle to prevent double-tap races
    const now = Date.now();
    if (now - micLastToggleRef.current < 400) return;
    micLastToggleRef.current = now;
    if (voice.isListening) {
      haptic("light");
      voice.stop();
    } else {
      haptic("medium");
      voice.clearMicError();
      setUserInput("");
      voice.start((finalText) => {
        setUserInput(finalText);
      }, { restartThresholdMs: NATIVE_RESTART_POLL_CHAT_MS });
    }
  };

  const handleContinue = () => {
    haptic("medium");
    setContinuedPastCheckpoint(true);
  };

  const handleWrapUp = () => {
    haptic("medium");
    if (debrief) {
      completeDebriefMutation.mutate(debrief.id);
    }
  };

  // ── Voice note mode handlers ──────────────────────────────────────────────

  const startVoiceNote = useCallback(() => {
    haptic("medium");
    voiceNoteTextRef.current = "";
    setVoiceNoteSeconds(0);
    setVoiceNoteMode(true);
    setUserInput("");
    // Timer counts up while recording
    voiceNoteTimerRef.current = setInterval(() => {
      setVoiceNoteSeconds(s => s + 1);
    }, 1000);
    // Voice note mode: mic stays open indefinitely — only submit/cancel stops it.
    // restartThresholdMs=3000 so the keep-alive loop only restarts after iOS has definitely
    // killed recognition (~1-2 s of silence), not mid-pause during normal thinking.
    voice.start(
      (text) => { voiceNoteTextRef.current = text; setUserInput(text); },
      { noSilenceStop: true, restartThresholdMs: 3_000 },
    );
  }, [voice]);

  const stopVoiceNoteTimer = () => {
    if (voiceNoteTimerRef.current) {
      clearInterval(voiceNoteTimerRef.current);
      voiceNoteTimerRef.current = null;
    }
  };

  const cancelVoiceNote = useCallback(() => {
    haptic("light");
    stopVoiceNoteTimer();
    voice.stop();
    setVoiceNoteMode(false);
    setVoiceNoteSeconds(0);
    voiceNoteTextRef.current = "";
    setUserInput("");
  }, [voice]);

  const submitVoiceNote = useCallback(() => {
    const text = voiceNoteTextRef.current.trim() || userInput.trim();
    stopVoiceNoteTimer();
    voice.stop();
    setVoiceNoteMode(false);
    setVoiceNoteSeconds(0);
    voiceNoteTextRef.current = "";
    setUserInput("");
    if (text) {
      haptic("medium");
      warmAudioCtx();
      sendMessage(text);
    }
  }, [voice, userInput, sendMessage]);

  // Format mm:ss for voice note timer
  const formatVoiceTime = (secs: number) => {
    const m = Math.floor(secs / 60).toString().padStart(2, "0");
    const s = (secs % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  };

  const toggleConversation = () => {
    haptic("medium");
    if (conversationActiveRef.current) {
      // End conversation
      conversationActiveRef.current = false;
      conversationWaitingForTtsRef.current = false;
      setIsConversationMode(false);
      if (voice.isListening) voice.stop();
      tts.cancel();
    } else {
      // Start conversation
      conversationActiveRef.current = true;
      setIsConversationMode(true);
      setUserInput("");
      warmAudioCtx();
      startConversationVoiceRef.current();
    }
  };

  useEffect(() => {
    // Scroll the chat container to its bottom so the latest message is visible.
    // This only moves the inner fixed-height div — it does NOT touch page scroll.
    const container = chatContainerRef.current;
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }, [debrief?.messages, streamingContent, realtimeMessages]);

  useEffect(() => {
    if (!focusMountedRef.current) {
      focusMountedRef.current = true;
      return;
    }
    // Don't auto-focus on native/mobile — it pops the keyboard over the AI response
    if (!Capacitor.isNativePlatform() && !voice.isListening && !isStreaming) {
      inputRef.current?.focus({ preventScroll: true });
    }
  }, [voice.isListening, isStreaming]);

  // Reset textarea height when input is cleared (e.g. after sending)
  useEffect(() => {
    if (!userInput && inputRef.current) {
      inputRef.current.style.height = "20px";
    }
  }, [userInput]);

  useEffect(() => {
    setShowAllMessages(false);
    setRealtimeMessages([]);
    // End conversation mode when switching dates
    if (conversationActiveRef.current) {
      conversationActiveRef.current = false;
      conversationWaitingForTtsRef.current = false;
      setIsConversationMode(false);
      voice.stop();
      tts.cancel();
    }
    // End voice note mode when switching dates
    if (voiceNoteMode) {
      stopVoiceNoteTimer();
      voice.stop();
      setVoiceNoteMode(false);
      setVoiceNoteSeconds(0);
      voiceNoteTextRef.current = "";
      setUserInput("");
    }
    // End realtime session when switching dates
    if (realtimeVoice.isActive) realtimeVoice.disconnect();
  }, [selectedDate]);

  // Detect TTS finishing → restart mic for next conversation turn
  useEffect(() => {
    const wasSpeaking = prevTtsSpeakingRef.current;
    prevTtsSpeakingRef.current = tts.speaking;
    if (wasSpeaking && !tts.speaking && conversationWaitingForTtsRef.current) {
      conversationWaitingForTtsRef.current = false;
      setTimeout(() => {
        if (conversationActiveRef.current) startConversationVoiceRef.current();
      }, 200);
    }
  }, [tts.speaking]);

  // Barge-in: arm a lightweight background recogniser while TTS is playing.
  // The instant it detects speech (≥3 chars), cancel TTS and fire the main mic.
  useEffect(() => {
    const stopBargeIn = () => {
      if (bargeInRecognitionRef.current) {
        try { bargeInRecognitionRef.current.stop(); } catch {}
        bargeInRecognitionRef.current = null;
      }
    };

    if (!isConversationMode || !tts.speaking || isStreaming || voice.isListening) {
      stopBargeIn();
      return;
    }

    // Wait 700ms before arming — lets the start of TTS audio settle so the mic
    // doesn't pick up the AI's own voice as a barge-in trigger.
    const armTimer = setTimeout(() => {
      if (!tts.speaking || !conversationActiveRef.current || voice.isListening) return;

      const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (!SR) return;

      const rec = new SR();
      rec.continuous = true;
      rec.interimResults = true;
      rec.maxAlternatives = 1;
      rec.lang = "en-US";

      let didBarge = false;
      rec.onresult = (e: any) => {
        if (didBarge || !conversationActiveRef.current) return;
        let text = "";
        for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
        if (text.trim().length >= 3) {
          didBarge = true;
          tts.cancel();
          stopBargeIn();
          conversationWaitingForTtsRef.current = false;
          setTimeout(() => {
            if (conversationActiveRef.current) startConversationVoiceRef.current();
          }, 150);
        }
      };
      rec.onerror = () => { bargeInRecognitionRef.current = null; };
      rec.onend = () => { if (bargeInRecognitionRef.current === rec) bargeInRecognitionRef.current = null; };

      bargeInRecognitionRef.current = rec;
      try { rec.start(); } catch { bargeInRecognitionRef.current = null; }
    }, 700);

    return () => {
      clearTimeout(armTimer);
      stopBargeIn();
    };
  }, [isConversationMode, tts.speaking, isStreaming, voice.isListening]);

  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const isToday = selectedDate === todayStr;
  const dateLabel = isToday ? "Today" : new Date(selectedDate + "T12:00:00").toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

  if (isLoading) {
    return (
      <Card className="border border-border/50 shadow-sm bg-card">
        <CardContent className="p-6 flex items-center justify-center min-h-[200px]">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  // Opening message is streaming — show a live chat card so the text appears immediately
  if (isOpeningStreaming) {
    return (
      <Card className="border border-border/50 shadow-sm bg-card">
        <CardContent className="p-0">
          <div className="px-5 py-3 border-b border-border/50 flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-sm font-medium text-foreground">Debrief</span>
          </div>
          <div className="px-5 py-4 space-y-3 min-h-[120px]">
            <AnimatePresence>
              {openingStreamContent ? (
                <motion.div
                  key="opening"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex justify-start"
                >
                  <div className="max-w-[85%] rounded-2xl rounded-bl-md px-4 py-2.5 text-sm leading-relaxed bg-muted text-foreground">
                    {openingStreamContent}
                    <span className="inline-block w-1.5 h-4 bg-foreground/40 ml-0.5 animate-pulse align-text-bottom" />
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  key="dots"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex justify-start"
                >
                  <div className="rounded-2xl rounded-bl-md px-4 py-3 bg-muted">
                    <div className="flex items-center gap-1.5">
                      <div className="w-1.5 h-1.5 rounded-full bg-foreground/30 animate-bounce" style={{ animationDelay: "0ms" }} />
                      <div className="w-1.5 h-1.5 rounded-full bg-foreground/30 animate-bounce" style={{ animationDelay: "150ms" }} />
                      <div className="w-1.5 h-1.5 rounded-full bg-foreground/30 animate-bounce" style={{ animationDelay: "300ms" }} />
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </CardContent>
      </Card>
    );
  }

  // No debriefs at all — show the start prompt
  if (!debrief && completedDebriefs.length === 0) {
    return (
      <Card className="border border-border/50 shadow-sm bg-card overflow-hidden">
        <CardContent className="p-0">
          <div className="p-6 text-center">
            <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-primary/10 flex items-center justify-center">
              <MessageCircle className="h-6 w-6 text-primary" />
            </div>
            <h3 className="text-lg font-semibold text-foreground mb-1">
              {isToday ? "Ready for your debrief?" : `Debrief for ${dateLabel}`}
            </h3>
            <p className="text-sm text-muted-foreground mb-5 max-w-xs mx-auto">
              {isToday
                ? "How do you want to open your debrief session?"
                : "Reflect on this day — choose how you want to start."
              }
            </p>
            <div className="flex items-center justify-center gap-2 flex-wrap">
              <Button
                onClick={() => { haptic("medium"); warmAudioCtx(); startDebriefMutation.mutate({ fresh: false, userLed: true }); }}
                disabled={startDebriefMutation.isPending}
                variant="outline"
                className="flex-1 min-w-[110px] max-w-[150px]"
              >
                {startDebriefMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <ArrowRight className="h-4 w-4 mr-2" />
                    I'll start
                  </>
                )}
              </Button>
              <Button
                onClick={() => { haptic("medium"); warmAudioCtx(); startDebriefMutation.mutate({ fresh: false }); }}
                disabled={startDebriefMutation.isPending}
                className="flex-1 min-w-[110px] max-w-[150px]"
              >
                {startDebriefMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <MessageCircle className="h-4 w-4 mr-2" />
                    Prompt me
                  </>
                )}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // All debriefs complete — collapsible history + prominent new session CTA
  if (!debrief && completedDebriefs.length > 0) {
    return (
      <div className="space-y-3">
        {/* New session card — always first, always visible */}
        <Card className="border border-border/50 shadow-sm bg-card overflow-hidden">
          <CardContent className="p-0">
            <div className="p-6 text-center">
              <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-primary/10 flex items-center justify-center">
                <MessageCircle className="h-6 w-6 text-primary" />
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-1">
                {isToday ? "Another session?" : `Debrief for ${dateLabel}`}
              </h3>
              <p className="text-sm text-muted-foreground mb-5 max-w-xs mx-auto">
                {isToday
                  ? "Your previous session is saved below. How do you want to open this one?"
                  : "Log another reflection for this day."}
              </p>
              <div className="flex items-center justify-center gap-2 flex-wrap">
                <Button
                  onClick={() => { haptic("medium"); warmAudioCtx(); startDebriefMutation.mutate({ fresh: true, userLed: true }); }}
                  disabled={startDebriefMutation.isPending}
                  variant="outline"
                  className="flex-1 min-w-[110px] max-w-[150px]"
                >
                  {startDebriefMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      <ArrowRight className="h-4 w-4 mr-2" />
                      I'll start
                    </>
                  )}
                </Button>
                <Button
                  onClick={() => { haptic("medium"); warmAudioCtx(); startDebriefMutation.mutate({ fresh: true }); }}
                  disabled={startDebriefMutation.isPending}
                  className="flex-1 min-w-[110px] max-w-[150px]"
                >
                  {startDebriefMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      <MessageCircle className="h-4 w-4 mr-2" />
                      Prompt me
                    </>
                  )}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Past sessions — collapsed below the CTA */}
        <Card className="border border-border/30 shadow-sm bg-card/70 overflow-hidden">
          <CardContent className="p-0">
            <div className="divide-y divide-border/30">
              {completedDebriefs.map((d, idx) => {
                const isExpanded = expandedSessions.has(d.id);
                const sessionText = d.messages.filter(m => m.role === "assistant").map(m => m.content).join(" ");
                return (
                  <div key={d.id} className="px-5 py-3">
                    <button
                      onClick={() => { haptic("select"); toggleSession(d.id); }}
                      className="w-full flex items-center gap-2 text-left"
                    >
                      <CheckCircle className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                      <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground shrink-0">
                        Session {idx + 1}
                      </span>
                      <span className="text-[10px] text-muted-foreground/60 shrink-0">{formatMsgTime(d.createdAt)}</span>
                      {d.summary && !isExpanded && (
                        <span className="text-xs text-muted-foreground italic truncate flex-1 ml-1">{d.summary}</span>
                      )}
                      <span className="ml-auto shrink-0 flex items-center gap-1 text-[10px] text-muted-foreground">
                        {isExpanded ? "Hide" : "Show"}
                        <ChevronDown className={`h-3 w-3 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                      </span>
                    </button>
                    {isExpanded && (
                      <div className="mt-3 space-y-2">
                        {d.summary && (
                          <p className="text-xs text-muted-foreground italic leading-relaxed pb-2 border-b border-border/30">{d.summary}</p>
                        )}
                        <div className="space-y-2 max-h-[300px] overflow-y-auto">
                          {d.messages.map((msg) => (
                            <div key={msg.id} className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"}`}>
                              <div className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
                                msg.role === "user"
                                  ? "bg-primary text-primary-foreground rounded-br-md"
                                  : "bg-muted text-foreground rounded-bl-md"
                              }`}>
                                {msg.content}
                              </div>
                              {msg.createdAt && (
                                <span className="text-[10px] text-muted-foreground/60 mt-0.5 px-1">{formatMsgTime(msg.createdAt)}</span>
                              )}
                            </div>
                          ))}
                        </div>
                        {tts.isSupported && sessionText && (
                          <button
                            onClick={() => tts.speaking ? tts.cancel() : tts.speakNow(sessionText)}
                            className="flex items-center gap-1.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors pt-1"
                          >
                            {tts.speaking ? <Square className="h-3 w-3 fill-current" /> : <Volume2 className="h-3 w-3" />}
                            {tts.speaking ? "Stop" : "Listen"}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const displayInput = voice.isListening && voice.interimText
    ? userInput + (userInput ? " " : "") + voice.interimText
    : userInput;

  // Keep this ref current so timers can call the latest version without stale closures
  startConversationVoiceRef.current = () => {
    if (!conversationActiveRef.current || !debrief || debrief.isComplete) return;
    setUserInput("");
    voice.start(
      (text) => setUserInput(text),
      {
        autoStopMs: 3000,
        onSilenceStop: (finalText) => {
          if (finalText.trim() && conversationActiveRef.current) {
            sendMessage(finalText);
          }
        },
      }
    );
  };

  const progressDots = Math.min(userMessageCount, CORE_EXCHANGES);

  return (
    <div className="space-y-3">
    {/* Active session card — viewport-height constrained so header + input always visible */}
    <Card
      ref={debriefCardRef}
      className="border border-border/50 shadow-sm bg-card flex flex-col"
      style={{ maxHeight: 'calc(var(--visual-height, 100dvh) - env(safe-area-inset-top) - env(safe-area-inset-bottom) - 15rem)' }}
    >
      <CardContent className="p-0 flex flex-col flex-1 overflow-hidden">
        <div className="px-5 py-3 border-b border-border/50 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-sm font-medium text-foreground">Debrief</span>
            <div className="flex items-center gap-1 ml-1">
              {Array.from({ length: CORE_EXCHANGES }).map((_, i) => (
                <div
                  key={i}
                  className={`w-1.5 h-1.5 rounded-full transition-colors ${
                    i < progressDots ? "bg-primary" : "bg-border"
                  }`}
                />
              ))}
              {userMessageCount > CORE_EXCHANGES && (
                <span className="text-[10px] text-primary font-medium ml-0.5">+{userMessageCount - CORE_EXCHANGES}</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1">
            {debrief && !debrief.isComplete && (
              <Button
                variant="ghost"
                size="sm"
                onClick={toggleRealtimeVoice}
                className={`h-7 w-7 p-0 ${realtimeVoice.isActive ? "text-primary" : "text-muted-foreground"}`}
                title={realtimeVoice.isActive ? "End live voice session" : "Start live voice conversation"}
              >
                {realtimeVoice.status === "connecting" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : realtimeVoice.status === "user_speaking" ? (
                  <Mic className="h-3.5 w-3.5 animate-pulse text-primary" />
                ) : realtimeVoice.status === "ai_speaking" ? (
                  <Waves className="h-3.5 w-3.5 animate-pulse text-primary" />
                ) : (
                  <Radio className={`h-3.5 w-3.5 ${realtimeVoice.isActive ? "animate-pulse" : ""}`} />
                )}
              </Button>
            )}
            {debrief && !debrief.isComplete && voice.isSupported && !realtimeVoice.isActive && !isConversationMode && (
              <Button
                variant="ghost"
                size="sm"
                onClick={voiceNoteMode ? cancelVoiceNote : startVoiceNote}
                className={`h-7 w-7 p-0 ${voiceNoteMode ? "text-primary" : "text-muted-foreground"}`}
                title={voiceNoteMode ? "Cancel voice note" : "Voice note — mic stays open until you hit Submit"}
              >
                <AudioLines className={`h-3.5 w-3.5 ${voiceNoteMode ? "animate-pulse" : ""}`} />
              </Button>
            )}
            {tts.isSupported && !realtimeVoice.isActive && !isConversationMode && (() => {
              const lastAiMsg = debrief.messages.filter(m => m.role === "assistant").slice(-1)[0]?.content ?? "";
              const handleSpeaker = () => {
                haptic("select");
                if (tts.speaking) {
                  // Immediately silence whatever is playing
                  tts.cancel();
                } else if (lastAiMsg) {
                  // Play last AI response regardless of enabled state
                  // (speakNow bypasses the enabled flag)
                  tts.speakNow(lastAiMsg);
                } else {
                  // No messages yet — just toggle the setting
                  tts.toggle();
                }
              };
              return (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleSpeaker}
                  className={`h-7 w-7 p-0 ${tts.speaking ? "text-primary" : tts.enabled ? "text-primary/70" : "text-muted-foreground"}`}
                  title={tts.speaking ? "Stop playback" : lastAiMsg ? "Play last response" : tts.enabled ? "Voice on" : "Voice off"}
                >
                  {tts.speaking ? (
                    <Volume2 className="h-3.5 w-3.5 animate-pulse" />
                  ) : tts.enabled ? (
                    <Volume2 className="h-3.5 w-3.5" />
                  ) : (
                    <VolumeX className="h-3.5 w-3.5" />
                  )}
                </Button>
              );
            })()}
            {userMessageCount >= 1 && !showCheckpoint && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => completeDebriefMutation.mutate(debrief.id)}
                disabled={completeDebriefMutation.isPending}
                className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                title="End debrief"
              >
                {completeDebriefMutation.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <CheckCircle className="h-3.5 w-3.5" />
                )}
              </Button>
            )}
          </div>
        </div>

        <div ref={chatContainerRef} className="px-5 py-4 space-y-3 flex-1 overflow-y-auto min-h-0 overscroll-y-contain">
          {debrief.messages.length === 0 && realtimeMessages.length === 0 && !isStreaming && !realtimeVoice.isActive && (
            <p className="text-sm text-muted-foreground text-center py-4">
              Your session, your opening. What's on your mind?
            </p>
          )}
          {realtimeVoice.status === "connecting" && (
            <p className="text-sm text-muted-foreground text-center py-4 animate-pulse">
              Connecting to your engineer…
            </p>
          )}

          {!showAllMessages && debrief.messages.length > VISIBLE_MESSAGES && (
            <button
              onClick={() => setShowAllMessages(true)}
              className="w-full flex items-center justify-center gap-1.5 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <ChevronDown className="h-3.5 w-3.5" />
              Show {debrief.messages.length - VISIBLE_MESSAGES} earlier messages
            </button>
          )}

          <AnimatePresence initial={false}>
            {(showAllMessages ? debrief.messages : debrief.messages.slice(-VISIBLE_MESSAGES)).map((msg) => (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 }}
                className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"}`}
              >
                <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground rounded-br-md"
                    : "bg-muted text-foreground rounded-bl-md"
                }`}>
                  {msg.content}
                </div>
                {msg.createdAt && (
                  <span className="text-[10px] text-muted-foreground/60 mt-0.5 px-1">
                    {formatMsgTime(msg.createdAt)}
                  </span>
                )}
              </motion.div>
            ))}
          </AnimatePresence>

          {/* Live realtime transcripts shown during active voice session */}
          <AnimatePresence>
            {realtimeMessages.map((msg, i) => (
              <motion.div
                key={`rt-${i}`}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 }}
                className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"}`}
              >
                <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground rounded-br-md"
                    : "bg-muted text-foreground rounded-bl-md"
                }`}>
                  {msg.text}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>

          {/* AI responding indicator for realtime mode */}
          {realtimeVoice.status === "ai_speaking" && (
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <Waves className="h-3 w-3 animate-pulse text-primary" />
              <span>Engineer speaking…</span>
              <button
                onClick={() => realtimeVoice.interrupt?.()}
                className="ml-1 px-2 py-0.5 rounded-full bg-muted hover:bg-destructive/20 text-muted-foreground hover:text-destructive border border-border text-xs transition-colors"
              >
                Interrupt
              </button>
            </div>
          )}
          {realtimeVoice.status === "user_speaking" && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Mic className="h-3 w-3 animate-pulse text-primary" />
              <span>Listening…</span>
            </div>
          )}

          {isStreaming && streamingContent && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex justify-start"
            >
              <div className="max-w-[85%] rounded-2xl rounded-bl-md px-4 py-2.5 text-sm leading-relaxed bg-muted text-foreground">
                {streamingContent}
                <span className="inline-block w-1.5 h-4 bg-foreground/40 ml-0.5 animate-pulse" />
              </div>
            </motion.div>
          )}

          {isStreaming && !streamingContent && (
            <div className="flex justify-start">
              <div className="rounded-2xl rounded-bl-md px-4 py-3 bg-muted">
                <div className="flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-foreground/30 animate-bounce" style={{ animationDelay: "0ms" }} />
                  <div className="w-1.5 h-1.5 rounded-full bg-foreground/30 animate-bounce" style={{ animationDelay: "150ms" }} />
                  <div className="w-1.5 h-1.5 rounded-full bg-foreground/30 animate-bounce" style={{ animationDelay: "300ms" }} />
                </div>
              </div>
            </div>
          )}

          {showCheckpoint && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.2 }}
              className="pt-2"
            >
              <div className="text-center space-y-3 py-3">
                <p className="text-xs text-muted-foreground">
                  {isAtCheckpoint
                    ? "That covers the essentials. Want to go deeper?"
                    : "Want to keep going?"
                  }
                </p>
                <div className="flex items-center justify-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleWrapUp}
                    disabled={completeDebriefMutation.isPending}
                    className="text-xs"
                  >
                    {completeDebriefMutation.isPending ? (
                      <Loader2 className="h-3 w-3 animate-spin mr-1" />
                    ) : (
                      <CheckCircle className="h-3 w-3 mr-1" />
                    )}
                    That's enough for now
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleContinue}
                    className="text-xs"
                  >
                    Keep going
                    <ArrowRight className="h-3 w-3 ml-1" />
                  </Button>
                </div>
              </div>
            </motion.div>
          )}

          <AnimatePresence>
            {actionNotifications.map((notif) => (
              <motion.div
                key={notif.id}
                initial={{ opacity: 0, scale: 0.95, y: 6 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.2 }}
                className="flex justify-start"
              >
                <div className={`flex items-center gap-2 rounded-2xl rounded-bl-md px-3.5 py-2 text-xs font-medium border ${
                  notif.success
                    ? "bg-primary/10 border-primary/20 text-primary"
                    : "bg-muted border-border text-muted-foreground"
                }`}>
                  <span>{notif.success ? "✓" : "✗"}</span>
                  <span>{notif.message}</span>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>

          <div ref={messagesEndRef} />
        </div>

        <div className="px-4 pb-4 pt-2 flex-shrink-0">
          {/* Realtime live voice mode — full-width status display */}
          {realtimeVoice.isActive ? (
            <div className="flex items-center gap-3 bg-muted/50 rounded-xl border border-primary/30 p-3">
              <div className="flex-1 min-w-0">
                {realtimeVoice.status === "connecting" && (
                  <span className="text-xs text-muted-foreground animate-pulse">Connecting to your engineer…</span>
                )}
                {realtimeVoice.status === "ai_speaking" && (
                  <div className="flex items-center gap-2">
                    <div className="flex gap-0.5 shrink-0">
                      {[0, 80, 160, 240, 320].map((d) => (
                        <span key={d} className="w-0.5 h-3.5 bg-primary rounded-full animate-pulse" style={{ animationDelay: `${d}ms` }} />
                      ))}
                    </div>
                    <span className="text-xs text-muted-foreground">Engineer speaking…</span>
                    <button
                      onClick={() => realtimeVoice.interrupt?.()}
                      className="ml-1 px-2 py-0.5 rounded-full bg-background hover:bg-destructive/20 text-muted-foreground hover:text-destructive border border-border text-xs transition-colors"
                    >
                      Interrupt
                    </button>
                  </div>
                )}
                {realtimeVoice.status === "user_speaking" && (
                  <div className="flex items-center gap-2">
                    <div className="flex gap-0.5 shrink-0">
                      {[0, 100, 200, 300].map((d) => (
                        <span key={d} className="w-0.5 h-3 bg-red-400 rounded-full animate-bounce" style={{ animationDelay: `${d}ms` }} />
                      ))}
                    </div>
                    <span className="text-xs text-muted-foreground">Listening…</span>
                  </div>
                )}
                {realtimeVoice.status === "ready" && (
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-muted-foreground">Live — speak when ready</span>
                    <button
                      onClick={() => realtimeVoice.promptEngineer?.()}
                      className="text-[11px] font-medium text-primary bg-primary/10 hover:bg-primary/20 px-2 py-0.5 rounded-md transition-colors"
                    >
                      Prompt engineer
                    </button>
                  </div>
                )}
              </div>
              <button
                onClick={toggleRealtimeVoice}
                className="h-8 px-3 rounded-lg shrink-0 flex items-center gap-1.5 text-xs font-medium bg-muted hover:bg-muted/80 text-foreground transition-colors"
              >
                <Square className="h-3 w-3 fill-current" />
                End
              </button>
            </div>
          ) : voiceNoteMode ? (
            <div className="space-y-2">
              {/* Voice note recording panel */}
              <div className="flex items-start gap-3 bg-muted/50 rounded-xl border border-red-500/30 p-3">
                <div className="flex-1 min-w-0 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse shrink-0" />
                    <span className="text-xs font-medium text-red-500">Recording</span>
                    <span className="text-xs text-muted-foreground font-mono">{formatVoiceTime(voiceNoteSeconds)}</span>
                    <span className="text-[10px] text-muted-foreground/60 ml-auto">Submit when done</span>
                  </div>
                  {/* Live transcript preview */}
                  {(userInput || voice.interimText) ? (
                    <p className="text-sm text-foreground leading-relaxed line-clamp-3">
                      {userInput}{voice.interimText ? <span className="text-muted-foreground"> {voice.interimText}</span> : null}
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground italic">Speak freely — pauses are fine, mic stays open until you submit…</p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={cancelVoiceNote}
                  className="flex-1 h-8 rounded-lg flex items-center justify-center gap-1.5 text-xs font-medium bg-muted hover:bg-muted/80 text-muted-foreground transition-colors"
                >
                  <Square className="h-3 w-3 fill-current" />
                  Cancel
                </button>
                <button
                  onClick={submitVoiceNote}
                  disabled={!(userInput.trim()) && !(voice.interimText?.trim())}
                  className="flex-1 h-8 rounded-lg flex items-center justify-center gap-1.5 text-xs font-semibold bg-primary hover:bg-primary/90 text-primary-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Send className="h-3 w-3" />
                  Submit to engineer
                </button>
              </div>
            </div>
          ) : isConversationMode ? (
            <div className="flex items-center gap-3 bg-muted/50 rounded-xl border border-primary/30 p-3">
              <div className="flex-1 min-w-0">
                {isStreaming ? (
                  <div className="flex items-center gap-2">
                    <div className="flex gap-1">
                      <span className="w-1 h-3 bg-primary rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                      <span className="w-1 h-4 bg-primary rounded-full animate-bounce" style={{ animationDelay: "100ms" }} />
                      <span className="w-1 h-3 bg-primary rounded-full animate-bounce" style={{ animationDelay: "200ms" }} />
                    </div>
                    <span className="text-xs text-muted-foreground">Engineer thinking...</span>
                  </div>
                ) : tts.speaking ? (
                  <div className="flex items-center gap-2">
                    <Volume2 className="h-3.5 w-3.5 text-primary animate-pulse shrink-0" />
                    <span className="text-xs text-muted-foreground">Engineer speaking...</span>
                  </div>
                ) : voice.isListening ? (
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="flex gap-0.5 shrink-0">
                      <span className="w-0.5 h-2.5 bg-primary rounded-full animate-pulse" style={{ animationDelay: "0ms" }} />
                      <span className="w-0.5 h-4 bg-primary rounded-full animate-pulse" style={{ animationDelay: "120ms" }} />
                      <span className="w-0.5 h-3 bg-primary rounded-full animate-pulse" style={{ animationDelay: "240ms" }} />
                      <span className="w-0.5 h-4.5 bg-primary rounded-full animate-pulse" style={{ animationDelay: "360ms" }} />
                      <span className="w-0.5 h-2.5 bg-primary rounded-full animate-pulse" style={{ animationDelay: "480ms" }} />
                    </div>
                    {displayInput ? (
                      <span className="text-sm text-foreground truncate">{displayInput}</span>
                    ) : (
                      <span className="text-xs text-muted-foreground">Listening... speak, then pause</span>
                    )}
                  </div>
                ) : (
                  <span className="text-xs text-muted-foreground">Starting mic...</span>
                )}
              </div>
              <button
                onClick={toggleConversation}
                className="h-8 px-3 rounded-lg shrink-0 flex items-center gap-1.5 text-xs font-medium bg-muted hover:bg-muted/80 text-foreground transition-colors"
              >
                <Square className="h-3 w-3 fill-current" />
                End
              </button>
            </div>
          ) : (
            <>
              {/* Quick-start mode selector — show when session just opened with no messages yet */}
              {debrief.messages.length === 0 && !isStreaming && voice.isSupported && (
                <div className="flex items-center gap-1.5 mb-2">
                  <button
                    onClick={() => { haptic("select"); setInputStartMode("live"); }}
                    className={`flex items-center gap-1.5 h-7 px-3 rounded-full text-xs font-medium transition-colors border ${
                      inputStartMode === "live"
                        ? "bg-primary/10 text-primary border-primary/30"
                        : "bg-transparent text-muted-foreground border-border/40 hover:bg-muted/60"
                    }`}
                  >
                    <Radio className="h-3 w-3" />
                    Live chat
                  </button>
                  <button
                    onClick={() => { haptic("select"); setInputStartMode("voice"); }}
                    className={`flex items-center gap-1.5 h-7 px-3 rounded-full text-xs font-medium transition-colors border ${
                      inputStartMode === "voice"
                        ? "bg-primary/10 text-primary border-primary/30"
                        : "bg-transparent text-muted-foreground border-border/40 hover:bg-muted/60"
                    }`}
                  >
                    <AudioLines className="h-3 w-3" />
                    Voice note
                  </button>
                </div>
              )}
              {/* Normal mode — mic waveform indicator */}
              {voice.isListening && (
                <div className="flex items-center gap-2 mb-2 px-2">
                  <div className="flex items-center gap-1">
                    <span className="w-1 h-3 bg-red-500 rounded-full animate-pulse" />
                    <span className="w-1 h-4 bg-red-500 rounded-full animate-pulse" style={{ animationDelay: "150ms" }} />
                    <span className="w-1 h-2.5 bg-red-500 rounded-full animate-pulse" style={{ animationDelay: "300ms" }} />
                    <span className="w-1 h-3.5 bg-red-500 rounded-full animate-pulse" style={{ animationDelay: "100ms" }} />
                  </div>
                  <span className="text-xs text-red-500 font-medium">Recording — tap mic to stop</span>
                </div>
              )}
              {voice.micError && (
                <div className="flex items-start gap-2 mb-2 px-2 py-1.5 bg-destructive/10 rounded-lg">
                  {voice.micError === "SETTINGS_NEEDED" ? (
                    <div className="flex-1 space-y-1.5">
                      <span className="text-xs text-destructive block">Microphone access denied. Enable it in iPhone Settings → DBrief → Microphone.</span>
                      <button
                        onClick={() => { openAppSettings(); voice.clearMicError(); }}
                        className="text-[11px] font-medium text-destructive underline underline-offset-2"
                      >
                        Open iPhone Settings →
                      </button>
                    </div>
                  ) : voice.micError?.startsWith("ERR:") ? (
                    <span className="text-xs text-destructive flex-1">Voice error: {voice.micError.slice(4)}</span>
                  ) : (
                    <span className="text-xs text-destructive flex-1">{voice.micError}</span>
                  )}
                  <button onClick={voice.clearMicError} className="text-destructive/60 hover:text-destructive text-xs shrink-0">✕</button>
                </div>
              )}
              <div className="flex items-end gap-2 bg-muted/50 rounded-xl border border-border/50 p-2">
                {voice.isSupported && (
                  <button
                    onClick={() => {
                      // When no messages yet, mic button also respects the selected start mode
                      if (debrief.messages.length === 0 && !isStreaming) {
                        haptic("medium");
                        warmAudioCtx();
                        if (inputStartMode === "live") {
                          toggleConversation();
                        } else {
                          startVoiceNote();
                        }
                      } else {
                        handleMicToggle();
                      }
                    }}
                    disabled={isStreaming}
                    className={`h-8 w-8 rounded-lg shrink-0 flex items-center justify-center transition-all ${
                      voice.isListening
                        ? "bg-red-500 text-white shadow-sm shadow-red-200"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted"
                    } ${isStreaming ? "opacity-40 cursor-not-allowed" : ""}`}
                    aria-label={voice.isListening ? "Stop listening" : "Start voice input"}
                  >
                    {voice.isListening ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
                  </button>
                )}
                <textarea
                  ref={inputRef}
                  rows={1}
                  value={displayInput}
                  onChange={(e) => setUserInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  onInput={handleTextareaInput}
                  onFocus={() => {
                    // When no messages yet, tapping the input row launches the selected mode
                    // rather than opening the keyboard to type
                    if (debrief.messages.length === 0 && !isStreaming && voice.isSupported) {
                      inputRef.current?.blur();
                      warmAudioCtx();
                      if (inputStartMode === "live") {
                        toggleConversation();
                      } else {
                        startVoiceNote();
                      }
                    }
                  }}
                  placeholder={voice.isListening ? "Speak freely — pausing is fine, mic stays on..." : "Talk to your engineer..."}
                  className="flex-1 min-w-0 bg-transparent border-0 outline-none text-sm placeholder:text-muted-foreground/60 text-foreground p-1 resize-none overflow-hidden leading-5"
                  style={{ height: "20px" }}
                  disabled={isStreaming}
                />
            <Button
              size="icon"
              onClick={handleSend}
              disabled={!userInput.trim() || isStreaming}
              className="h-8 w-8 rounded-lg shrink-0"
            >
              <Send className="h-3.5 w-3.5" />
            </Button>
              </div>
            </>
          )}
        </div>
      </CardContent>
    </Card>

      {/* Completed sessions from earlier — collapsible, below the active input */}
      {completedDebriefs.map((d, idx) => {
        const isExpanded = expandedSessions.has(d.id);
        return (
          <Card key={d.id} className="border border-border/30 shadow-sm bg-card/60 overflow-hidden">
            <CardContent className="p-0">
              <button
                onClick={() => { haptic("select"); toggleSession(d.id); }}
                className="w-full flex items-center gap-2 px-5 py-3 text-left"
              >
                <CheckCircle className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                <span className="text-xs font-medium text-muted-foreground shrink-0">
                  Session {idx + 1} · {formatMsgTime(d.createdAt)}
                </span>
                {d.summary && !isExpanded && (
                  <span className="text-xs text-muted-foreground italic truncate flex-1 ml-1">{d.summary}</span>
                )}
                <span className="ml-auto shrink-0 flex items-center gap-1 text-[10px] text-muted-foreground">
                  {isExpanded ? "Hide" : "Show"}
                  <ChevronDown className={`h-3 w-3 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                </span>
              </button>
              {isExpanded && (
                <div className="px-5 pb-4 space-y-2 border-t border-border/30 pt-3">
                  {d.summary && (
                    <p className="text-xs text-muted-foreground italic leading-relaxed pb-2 border-b border-border/20">{d.summary}</p>
                  )}
                  <div className="space-y-2 max-h-[280px] overflow-y-auto">
                    {d.messages.map((msg) => (
                      <div key={msg.id} className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"}`}>
                        <div className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
                          msg.role === "user"
                            ? "bg-primary text-primary-foreground rounded-br-md"
                            : "bg-muted text-foreground rounded-bl-md"
                        }`}>
                          {msg.content}
                        </div>
                        {msg.createdAt && (
                          <span className="text-[10px] text-muted-foreground/60 mt-0.5 px-1">{formatMsgTime(msg.createdAt)}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
