import { useState, useEffect, useRef, useCallback } from "react";
import { haptic } from "@/lib/haptics";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { MessageCircle, Send, CheckCircle, Flag, Loader2, RotateCcw, Mic, MicOff, ArrowRight, Volume2, VolumeX, Square, ChevronDown, Trash2, Keyboard, BookOpen, X, Paperclip, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { motion, AnimatePresence } from "framer-motion";
import { Capacitor } from "@capacitor/core";
import { openAppSettings } from "@/hooks/useNativeNotifications";
import { useTTS, warmAudioCtx } from "@/hooks/useTTS";
import { useRealtimeVoice, type RealtimeTranscript } from "@/hooks/useRealtimeVoice";
import { useVoiceNoteRecorder } from "@/hooks/useVoiceNoteRecorder";
import { useSubscription } from "@/hooks/useSubscription";
import { usePaywall } from "@/contexts/PaywallContext";

interface DebriefMessage {
  id: number;
  debriefId: number;
  role: string;
  content: string;
  attachmentUrl?: string | null;
  attachmentType?: string | null;
  createdAt: string;
}

interface PendingAttachment {
  objectPath: string;
  previewUrl: string;
}

interface QuickLogPhoto {
  objectPath: string;
  previewUrl: string;
  filename: string;
  contentType: string;
  size: number;
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
  // Text accumulated before each iOS keep-alive restart — preserved across session boundaries
  const nativeCommittedTextRef = useRef("");
  // stopRef lets timers call stop() without a forward-reference problem
  const stopRef = useRef<() => Promise<void>>(async () => {});
  // Configurable silence timeout and callback for conversation mode
  const autoStopMsRef = useRef<number>(AUTO_STOP_SILENCE_MS);
  const onSilenceStopRef = useRef<((text: string) => void) | null>(null);
  // When true, silence NEVER auto-stops the mic — only an explicit stop() call does
  const noSilenceStopRef = useRef<boolean>(false);
  // How long of silence before native keep-alive restarts recognition.
  const restartThresholdMsRef = useRef<number>(NATIVE_RESTART_POLL_MS);
  // How often to run the keep-alive poll. Shorter = faster detection of iOS killing recognition.
  const restartPollMsRef = useRef<number>(NATIVE_RESTART_POLL_MS);

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
      // Guard: ignore stale onend callbacks from replaced/stopped instances
      if (recognitionRef.current !== recognition) return;
      // Clear ref FIRST so the next startRecognitionRef.current() sees a clean slate
      recognitionRef.current = null;

      if (shouldListenRef.current) {
        // We're about to restart — DON'T wipe interimText so the transcript doesn't
        // flash away during the 300ms gap between stop and the next start.
        // Give the browser 300ms to fully release the audio device before reopening
        restartTimerRef.current = setTimeout(() => {
          if (shouldListenRef.current) startRecognitionRef.current();
        }, 300);
      } else {
        setInterimText("");
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
    async (onFinal: (text: string) => void, opts?: { autoStopMs?: number; onSilenceStop?: (text: string) => void; noSilenceStop?: boolean; restartThresholdMs?: number; restartPollMs?: number }) => {
      if (!isSupported) return;

      accumulatedRef.current = "";
      nativeCommittedTextRef.current = "";
      onFinalRef.current = onFinal;
      autoStopMsRef.current = opts?.autoStopMs ?? AUTO_STOP_SILENCE_MS;
      onSilenceStopRef.current = opts?.onSilenceStop ?? null;
      noSilenceStopRef.current = opts?.noSilenceStop ?? false;
      restartThresholdMsRef.current = opts?.restartThresholdMs ?? NATIVE_RESTART_POLL_MS;
      restartPollMsRef.current = opts?.restartPollMs ?? NATIVE_RESTART_POLL_MS;
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
            // Combine text committed before the last keep-alive restart with new speech.
            // This prevents text from disappearing when iOS kills & restarts recognition.
            const committed = nativeCommittedTextRef.current;
            const combined = committed
              ? (partial ? committed + " " + partial : committed)
              : partial;
            setInterimText(""); // native plugin gives full running transcript via combined; no separate interim needed
            accumulatedRef.current = combined;
            onFinalRef.current?.(combined);
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
                // Commit accumulated text so partialResults handler can prefix it after restart
                nativeCommittedTextRef.current = accumulatedRef.current;
                await SpeechRecognition.stop().catch(() => {});
                if (!shouldListenRef.current || isStoppingRef.current) { nativeIsRestartingRef.current = false; return; }
                await SpeechRecognition.start({
                  language: "en-US",
                  maxResults: 1,
                  partialResults: true,
                  popup: false,
                });
                // Reset the clock so we don't restart again immediately on the next tick
                lastSpeechTimeRef.current = Date.now();
              } catch {
                // ignore — next tick will retry
              } finally {
                nativeIsRestartingRef.current = false;
              }
            }
          }, restartPollMsRef.current);

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
  const { isPremium } = useSubscription();
  const { openPaywall } = usePaywall();
  const [userInput, setUserInput] = useState("");
  const [textMode, setTextMode] = useState(false);
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
  const [actionNotifications, setActionNotifications] = useState<Array<{ type: string; message: string; success: boolean; id: number }>>([]);
  const [showAllMessages, setShowAllMessages] = useState(false);
  const [expandedSessions, setExpandedSessions] = useState<Set<number>>(new Set());
  // Tracks the ID of a freshly-started user-led session (0 messages, no AI reply yet).
  // Cleared automatically once the debrief gets an AI reply or is completed.
  const [userLedDebriefId, setUserLedDebriefId] = useState<number | null>(null);
  const [showQuickLog, setShowQuickLog] = useState(false);
  const [quickLogText, setQuickLogText] = useState("");
  const [quickLogMode, setQuickLogMode] = useState<'voice' | 'keyboard'>('voice');
  const [pendingAttachment, setPendingAttachment] = useState<PendingAttachment | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingQuickLogPhoto, setPendingQuickLogPhoto] = useState<QuickLogPhoto | null>(null);
  const [isQuickLogUploading, setIsQuickLogUploading] = useState(false);
  const quickLogFileInputRef = useRef<HTMLInputElement>(null);
  const toggleSession = (id: number) => setExpandedSessions(prev => {
    const s = new Set(prev);
    s.has(id) ? s.delete(id) : s.add(id);
    return s;
  });

  // Long-press to delete a user message
  const [selectedMsgId, setSelectedMsgId] = useState<number | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Long-press to delete an entire debrief session
  const [selectedDebriefId, setSelectedDebriefId] = useState<number | null>(null);
  const longPressDebriefTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const deleteDebriefMutation = useMutation({
    mutationFn: (debriefId: number) =>
      apiRequest("DELETE", `/api/debriefs/${debriefId}`).then(r => r.json()),
    onSuccess: () => {
      haptic("success");
      setSelectedDebriefId(null);
      queryClient.invalidateQueries({ queryKey: ["/api/debriefs", selectedDate] });
      queryClient.invalidateQueries({ queryKey: ["/api/dates-with-data"] });
      queryClient.invalidateQueries({ queryKey: ["/api/streak"] });
    },
    onError: () => {
      haptic("error");
      setSelectedDebriefId(null);
    },
  });

  const startDebriefLongPress = (debriefId: number) => {
    longPressDebriefTimerRef.current = setTimeout(() => {
      haptic("medium");
      setSelectedDebriefId(debriefId);
    }, 500);
  };
  const cancelDebriefLongPress = () => {
    if (longPressDebriefTimerRef.current) {
      clearTimeout(longPressDebriefTimerRef.current);
      longPressDebriefTimerRef.current = null;
    }
  };

  const deleteMsgMutation = useMutation({
    mutationFn: (messageId: number) =>
      apiRequest("DELETE", `/api/debrief/messages/${messageId}`).then(r => r.json()),
    onSuccess: (_data, _messageId) => {
      haptic("success");
      setSelectedMsgId(null);
      queryClient.invalidateQueries({ queryKey: ["/api/debriefs"] });
    },
    onError: () => {
      haptic("error");
      setSelectedMsgId(null);
    },
  });

  const quickLogMutation = useMutation({
    mutationFn: async ({ content, date, photo }: { content: string; date: string; photo?: QuickLogPhoto | null }) =>
      apiRequest("POST", "/api/debriefs/log-moment", {
        content: content || "",
        date,
        ...(photo ? { attachmentUrl: photo.objectPath, attachmentType: "image" } : {}),
      }).then(r => r.json()),
    onSuccess: () => {
      haptic("success");
      setPendingQuickLogPhoto(null);
      setShowQuickLog(false);
      setQuickLogText("");
      queryClient.invalidateQueries({ queryKey: ["/api/debriefs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/debriefs", selectedDate] });
      queryClient.invalidateQueries({ queryKey: ["/api/dates-with-data"] });
      queryClient.invalidateQueries({ queryKey: ["/api/streak"] });
      toast({ title: "Moment logged", description: "Your entry has been saved." });
    },
    onError: () => {
      haptic("error");
      toast({ title: "Failed to save", description: "Please try again." });
    },
  });

  // Voice note mode — long-form voice dump that only sends on explicit Submit
  const [voiceNoteMode, setVoiceNoteMode] = useState(false);
  const [voiceNoteSeconds, setVoiceNoteSeconds] = useState(0);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [usingMediaRecorder, setUsingMediaRecorder] = useState(false);
  const voiceNoteTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const voiceNoteAutoStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const voiceNoteTextRef = useRef(""); // accumulated transcript (mirrors voice.interimText continuously)
  // Forward ref so startVoiceNote can call submitVoiceNote without circular dependency
  const submitVoiceNoteRef = useRef<() => void | Promise<void>>(() => {});
  const voiceNoteRecorder = useVoiceNoteRecorder();

  const VISIBLE_MESSAGES = 6;
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const debriefCardRef = useRef<HTMLDivElement>(null);
  const streamingMsgRef = useRef<HTMLDivElement>(null);
  // When true, suppress auto-scroll-to-bottom so the user reads the response from the start.
  // Reset in sendMessage so the next outgoing message can scroll normally.
  const lockScrollAfterStreamRef = useRef(false);
  const hasScrolledToStreamStart = useRef(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const focusMountedRef = useRef(false);
  // Index into `accumulated` where the first sentence ends (0 = no sentence spoken yet)
  const ttsFirstSentenceRef = useRef<number>(0);
  // Tracks the most recently COMPLETED AI streaming response so the speaker
  // button always plays the right message even if the query cache hasn't
  // refreshed yet after invalidateQueries.
  const lastStreamedAiMsgRef = useRef<string>("");
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
      const response = await fetch(resolveUrl(`/api/debriefs/${selectedDate}`), { credentials: "include" });
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
  // Active = an in-progress debrief that has at least one AI response (moments never qualify).
  // OR it's the specific user-led session we just started this session (tracked by ID).
  const debrief =
    safeDebriefs.find(d => !d.isComplete && (d.messages || []).some((m: any) => m.role === "assistant")) ??
    (userLedDebriefId
      ? safeDebriefs.find(d => d.id === userLedDebriefId && !d.isComplete) ?? null
      : null);
  // Completed list = fully finished sessions OR moments (no AI response), excluding the active user-led session.
  // Also exclude sessions with no visible content (0-message abandoned starters or all-blank messages).
  const completedDebriefs = safeDebriefs.filter(d => {
    if (d.id === debrief?.id) return false;
    if (!d.isComplete && !(d.messages || []).some((m: any) => m.role === "assistant")) {
      // It's a "moment" — only show it if at least one message has real content or an attachment
      const hasContent = (d.messages || []).some(
        (m: any) => (m.content && m.content.trim().length > 0) || m.attachmentUrl
      );
      if (!hasContent) return false;
    }
    return true;
  });

  const userMessageCount = debrief?.messages?.filter(m => m.role === "user").length || 0;
  const assistantMessageCount = debrief?.messages?.filter(m => m.role === "assistant").length || 0;

  // Show End Session / Go Deeper after every completed AI response
  const lastMsg = debrief?.messages?.slice(-1)[0];
  const showCheckpoint =
    !!debrief &&
    !debrief.isComplete &&
    !isStreaming &&
    lastMsg?.role === "assistant";

  // Keep activeDebriefId in sync so the realtime voice hook always knows which debrief to save to
  useEffect(() => {
    if (debrief?.id && debrief.id !== activeDebriefId) setActiveDebriefId(debrief.id);
  }, [debrief?.id]);

  // Clear the user-led tracking ID once the debrief gets an AI reply or is completed —
  // at that point the normal filter takes over and we no longer need the override.
  // IMPORTANT: only clear when we actually find the debrief in the loaded data.
  // If it's not found yet (query still refetching), keep the ID so we don't lose it.
  useEffect(() => {
    if (!userLedDebriefId) return;
    const d = safeDebriefs.find(s => s.id === userLedDebriefId);
    if (d && (d.isComplete || (d.messages || []).some((m: any) => m.role === "assistant"))) {
      setUserLedDebriefId(null);
    }
  }, [safeDebriefs, userLedDebriefId]);

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
      // Retry helper: Android WebView can drop connections on first attempt.
      // We try up to 2 times before surfacing the error to the user.
      const attemptFetch = async (attempt: number): Promise<Response> => {
        try {
          const r = await fetch(resolveUrl("/api/debriefs/start"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ date: selectedDate, fresh: !!opts.fresh, userLed: !!opts.userLed }),
          });
          if (!r.ok && attempt < 2) {
            await new Promise(res => setTimeout(res, 1200));
            return attemptFetch(attempt + 1);
          }
          return r;
        } catch (err) {
          if (attempt < 2) {
            await new Promise(res => setTimeout(res, 1200));
            return attemptFetch(attempt + 1);
          }
          throw err;
        }
      };

      const response = await attemptFetch(1);
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
      if (!reader) {
        // Android WebView doesn't expose ReadableStream — the debrief was
        // created server-side; query invalidation in onSuccess will load it.
        return null;
      }
      const decoder = new TextDecoder();
      let accumulated = "";

      outer: while (true) {
        let done: boolean, value: Uint8Array | undefined;
        try {
          ({ done, value } = await reader.read());
        } catch {
          // Android WebView can drop the SSE stream mid-read — the debrief
          // record is already saved server-side, refetch will load it.
          reader.cancel().catch(() => {});
          break;
        }
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
      if (accumulated) {
        const remainder = ttsFirstSentenceRef.current
          ? accumulated.slice(ttsFirstSentenceRef.current).trim()
          : accumulated;
        if (remainder && tts.enabled) tts.speakOrQueue(remainder);
        // Speculatively pre-fetch audio for the speaker button when TTS is off
        if (!tts.enabled) tts.preFetchForButton(accumulated);
        lastStreamedAiMsgRef.current = accumulated;
      }

      return null;
    },
    onSuccess: async (data) => {
      // User-led path returns the debrief JSON directly — track its ID so the panel
      // can show it as "active" even though it has no AI messages yet.
      if (data && (data as any).id) setUserLedDebriefId((data as any).id);
      // Wait for the debriefs query to refetch BEFORE clearing isOpeningStreaming.
      // Without this there is a brief window where isOpeningStreaming=false AND
      // debrief=null (query still fetching) which re-shows the "start" panel,
      // making users think the first tap failed and causing them to tap twice.
      await queryClient.invalidateQueries({ queryKey: ["/api/debriefs", selectedDate] });
      queryClient.invalidateQueries({ queryKey: ["/api/dates-with-data"] });
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

  const sendMessage = async (text: string, attachment?: PendingAttachment, onUserMessageId?: (id: number) => void) => {
    if (!text.trim() && !attachment) return;
    if (!debrief || isStreaming) return;

    setUserInput("");
    // Dismiss keyboard, then scroll so the debrief card's top sits just below the sticky header.
    // We must NOT use scrollIntoView({ block: "start" }) because that scrolls the card's top
    // to viewport position 0 — the sticky header then covers it, making the messages invisible.
    inputRef.current?.blur();
    hasScrolledToStreamStart.current = false;
    lockScrollAfterStreamRef.current = false; // Allow scroll-to-bottom for the outgoing message
    setTimeout(() => {
      const card = debriefCardRef.current;
      const root = document.getElementById("root");
      const header = document.querySelector("header");
      if (!card || !root) return;
      const headerH = header?.getBoundingClientRect().height ?? 130;
      const cardAbsTop = card.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop;
      root.scrollTo({ top: cardAbsTop - headerH - 4, behavior: "smooth" });
    // 350 ms gives iOS time to finish the keyboard-dismiss animation before we
    // read getBoundingClientRect() — at 80 ms the layout is still in flux.
    }, 350);
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
      attachmentUrl: attachment?.previewUrl ?? null,
      attachmentType: attachment ? "image" : null,
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
      const response = await fetch(resolveUrl(`/api/debriefs/${debrief.id}/respond`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          content: text.trim(),
          ...(attachment ? { attachmentUrl: attachment.objectPath, attachmentType: "image" } : {}),
        }),
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
              // The server emits userMessageId as the first SSE event after inserting the
              // user message. Deliver it to the caller so they can bind Whisper correction
              // to this specific message ID (each call gets its own local closure).
              if (data.userMessageId && onUserMessageId) {
                onUserMessageId(data.userMessageId);
              }
              if (data.content) {
                accumulated += data.content;
                setStreamingContent(accumulated);
                // On the very first token: scroll chat container so the start
                // of the streaming response is visible at the top of the chat area.
                // Done here (in the streaming loop) rather than relying on the
                // streamingMsgRef useEffect, because framer-motion may not have
                // attached that ref yet when the effect fires on the first token.
                if (!hasScrolledToStreamStart.current) {
                  hasScrolledToStreamStart.current = true;
                  lockScrollAfterStreamRef.current = true;
                  // Helper that scrolls the chat container so the streaming bubble
                  // sits 8px from the top of the visible area. Retries up to
                  // maxAttempts times (16ms apart) so framer-motion has time to
                  // attach the ref before we give up.
                  const pinStreamingBubble = (attempt = 0) => {
                    const c = chatContainerRef.current;
                    const el = streamingMsgRef.current;
                    if (!c) return;
                    if (el) {
                      const targetScrollTop = c.scrollTop + (el.getBoundingClientRect().top - c.getBoundingClientRect().top) - 8;
                      c.scrollTop = Math.max(0, Math.min(targetScrollTop, c.scrollHeight - c.clientHeight));
                    } else if (attempt < 8) {
                      // Ref not yet attached — retry after one animation frame
                      requestAnimationFrame(() => pinStreamingBubble(attempt + 1));
                    }
                    // If we exhausted retries, do NOT fall back to scrollHeight —
                    // that would scroll to the bottom and hide the response start.
                  };
                  requestAnimationFrame(() => requestAnimationFrame(() => pinStreamingBubble()));
                }
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
                if (data.actions.some((a: any) => a.type === "suggest_metric" && a.success)) {
                  queryClient.invalidateQueries({ queryKey: ["/api/user-metrics"] });
                }
              }
            } catch {}
          }
        }
      }

      // Capture the completed response NOW so the speaker button has the right
      // text even before the query cache refetch lands.
      if (accumulated) lastStreamedAiMsgRef.current = accumulated;
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
        // Always speculatively pre-fetch the full response audio so the speaker
        // button plays instantly — whether TTS auto-played or not. The user may
        // want to replay, and the cache hit eliminates the API round-trip delay.
        tts.preFetchForButton(accumulated);
      }
      // After streaming ends, always scroll to bottom — this reveals the
      // End Session / Go Deeper buttons that appear after the response.
      // Reset the lock first so the useEffect doesn't suppress it.
      lockScrollAfterStreamRef.current = false;
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }, 120);
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
    if (!textToSend && !pendingAttachment) return;
    // Auto-stop mic before sending so the recording never blocks the next state
    if (voice.isListening) voice.stop();
    haptic("medium");
    // Warm the AudioContext during this user gesture so auto-speak works after streaming
    warmAudioCtx();
    const attachment = pendingAttachment;
    setPendingAttachment(null);
    sendMessage(textToSend, attachment ?? undefined);
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

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploading(true);
    try {
      const urlRes = await apiRequest("POST", "/api/uploads/request-url", {
        name: file.name,
        size: file.size,
        contentType: file.type,
      });
      const { uploadURL, objectPath } = await urlRes.json();
      await fetch(uploadURL, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      setPendingAttachment({ objectPath, previewUrl: URL.createObjectURL(file) });
    } catch {
      toast({ title: "Upload failed", description: "Couldn't attach the photo. Please try again.", variant: "destructive" });
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
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
      }, { restartPollMs: 400, restartThresholdMs: 1_200 });
    }
  };

  const handleGoDeeper = async () => {
    if (!debrief || isStreaming) return;
    haptic("medium");
    warmAudioCtx();
    setIsStreaming(true);
    setStreamingContent("");
    ttsFirstSentenceRef.current = 0;
    hadTtsResponseRef.current = false;
    tts.cancel();

    try {
      const response = await fetch(resolveUrl(`/api/debriefs/${debrief.id}/go-deeper`), {
        method: "POST",
        credentials: "include",
      });
      if (!response.ok || !response.body) throw new Error("Failed");

      hasScrolledToStreamStart.current = false;
      lockScrollAfterStreamRef.current = false;

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";
      let buffer = "";

      outer: while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.error) { toast({ title: "Error", description: data.error, variant: "destructive" }); break outer; }
            if (data.content) {
              accumulated += data.content;
              setStreamingContent(accumulated);
              if (!hasScrolledToStreamStart.current) {
                hasScrolledToStreamStart.current = true;
                lockScrollAfterStreamRef.current = true;
                const pinStreamingBubble2 = (attempt = 0) => {
                  const c = chatContainerRef.current;
                  const el = streamingMsgRef.current;
                  if (!c) return;
                  if (el) {
                    const targetScrollTop = c.scrollTop + (el.getBoundingClientRect().top - c.getBoundingClientRect().top) - 8;
                    c.scrollTop = Math.max(0, Math.min(targetScrollTop, c.scrollHeight - c.clientHeight));
                  } else if (attempt < 8) {
                    requestAnimationFrame(() => pinStreamingBubble2(attempt + 1));
                  }
                };
                requestAnimationFrame(() => requestAnimationFrame(() => pinStreamingBubble2()));
              }
              if (tts.enabled && !tts.speaking && !hadTtsResponseRef.current) {
                const end = findFirstSentenceEnd(accumulated);
                if (end > 0 && ttsFirstSentenceRef.current === 0) {
                  ttsFirstSentenceRef.current = end;
                  tts.speakNow(accumulated.slice(0, end).trim());
                }
              }
            }
            if (data.done) break outer;
          } catch {}
        }
      }

      if (accumulated) {
        const remainder = ttsFirstSentenceRef.current ? accumulated.slice(ttsFirstSentenceRef.current).trim() : accumulated;
        if (remainder && tts.enabled) tts.speakOrQueue(remainder);
        tts.preFetchForButton(accumulated);
        lastStreamedAiMsgRef.current = accumulated;
      }

      // After Go Deeper streaming ends, scroll to show the End Session / Go Deeper buttons.
      lockScrollAfterStreamRef.current = false;
      await queryClient.invalidateQueries({ queryKey: ["/api/debriefs", selectedDate] });
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }, 200);
    } catch {
      toast({ title: "Couldn't go deeper", description: "Please try again.", variant: "destructive" });
    } finally {
      setIsStreaming(false);
      setStreamingContent("");
    }
  };

  const handleWrapUp = () => {
    haptic("medium");
    if (debrief) {
      completeDebriefMutation.mutate(debrief.id);
    }
  };

  // ── Voice note mode handlers ──────────────────────────────────────────────

  const VOICE_NOTE_MAX_SECS = 300; // 5-minute hard limit

  const startVoiceNote = useCallback(async () => {
    haptic("medium");
    voiceNoteTextRef.current = "";
    setVoiceNoteSeconds(0);
    setVoiceNoteMode(true);
    setIsTranscribing(false);
    setUserInput("");
    // Seconds counter
    if (voiceNoteTimerRef.current) clearInterval(voiceNoteTimerRef.current);
    voiceNoteTimerRef.current = setInterval(() => {
      setVoiceNoteSeconds(s => s + 1);
    }, 1000);
    // 5-minute hard stop — auto-submits the recording
    if (voiceNoteAutoStopRef.current) clearTimeout(voiceNoteAutoStopRef.current);
    voiceNoteAutoStopRef.current = setTimeout(() => {
      submitVoiceNoteRef.current();
    }, VOICE_NOTE_MAX_SECS * 1000);
    // Primary path: MediaRecorder — records continuously with no silence cutoffs.
    // No restart loops, no session limits — just raw audio until submit.
    // onUnexpectedStop fires only if the mic truly cannot be recovered after an iOS interruption.
    if (voiceNoteRecorder.isSupported) {
      const started = await voiceNoteRecorder.start(() => {
        // Mic became permanently unavailable mid-session — submit whatever we have
        toast({ title: "Mic interrupted", description: "Recording stopped. Submitting what was captured.", variant: "default" });
        submitVoiceNoteRef.current();
      });
      if (started) {
        setUsingMediaRecorder(true);
        // Also run Web Speech API alongside MediaRecorder to build a live transcript
        // that can be used to fire the AI immediately on Submit — without waiting for Whisper.
        // The live transcript populates voiceNoteTextRef; MediaRecorder captures the full
        // audio for Whisper to produce an accurate transcript in the background.
        voice.start(
          (text) => { voiceNoteTextRef.current = text; },
          { noSilenceStop: true, restartPollMs: 500, restartThresholdMs: 2500 },
        );
        return;
      }
    }
    // Fallback: STT restart loop (older devices / unsupported browsers)
    setUsingMediaRecorder(false);
    voice.start(
      (text) => { voiceNoteTextRef.current = text; setUserInput(text); },
      { noSilenceStop: true, restartPollMs: 500, restartThresholdMs: 2500 },
    );
  }, [voice, voiceNoteRecorder]);

  const stopVoiceNoteTimers = () => {
    if (voiceNoteTimerRef.current) { clearInterval(voiceNoteTimerRef.current); voiceNoteTimerRef.current = null; }
    if (voiceNoteAutoStopRef.current) { clearTimeout(voiceNoteAutoStopRef.current); voiceNoteAutoStopRef.current = null; }
  };

  const cancelVoiceNote = useCallback(() => {
    haptic("light");
    stopVoiceNoteTimers();
    voiceNoteRecorder.cancel();
    voice.stop();
    setVoiceNoteMode(false);
    setVoiceNoteSeconds(0);
    setIsTranscribing(false);
    setUsingMediaRecorder(false);
    voiceNoteTextRef.current = "";
    setUserInput("");
  }, [voice, voiceNoteRecorder]);

  const submitVoiceNote = useCallback(async () => {
    stopVoiceNoteTimers();
    setVoiceNoteMode(false);
    setVoiceNoteSeconds(0);

    // MediaRecorder path — hybrid: fire AI immediately with live transcript,
    // run Whisper in the background, then silently correct if transcripts differ.
    if (usingMediaRecorder) {
      setUsingMediaRecorder(false);
      // Stop Web Speech API that was running alongside MediaRecorder for live transcript
      voice.stop();

      // Capture live STT transcript at the moment Submit is tapped
      const liveText = voiceNoteTextRef.current.trim();
      voiceNoteTextRef.current = "";
      setUserInput("");

      // Snapshot the debrief ID before any awaits so it's stable for correction
      const correctionDebriefId = debrief?.id ?? null;

      // Stop the MediaRecorder to get the audio blob (runs in parallel with AI stream)
      const recorderStopPromise = voiceNoteRecorder.stop();

      if (liveText) {
        // ── Fast path: live transcript available — fire AI immediately ──────────
        haptic("medium");
        warmAudioCtx();

        // Per-call local variable — captures the DB message ID for THIS specific send.
        // Not a shared ref, so concurrent/overlapping sends cannot overwrite each other.
        let thisCallMessageId: number | null = null;

        sendMessage(liveText, undefined, (id: number) => {
          thisCallMessageId = id;
        });

        // Run Whisper in the background — don't await, don't block the AI stream
        recorderStopPromise.then(async (result) => {
          if (!result || result.blob.size < 100 || !correctionDebriefId) return;
          try {
            const arrayBuffer = await result.blob.arrayBuffer();
            const controller = new AbortController();
            const fetchTimeout = setTimeout(() => controller.abort(), 30_000);
            let response: Response;
            try {
              response = await fetch(resolveUrl("/api/voice-note/transcribe"), {
                method: "POST",
                headers: {
                  "Content-Type": "application/octet-stream",
                  "X-Mime-Type": result.mimeType,
                },
                body: arrayBuffer,
                credentials: "include",
                signal: controller.signal,
              });
            } finally {
              clearTimeout(fetchTimeout);
            }
            if (!response.ok) return; // Whisper failed — live transcript is fine as-is
            const data = await response.json();
            const whisperText = data.text?.trim() ?? "";
            if (!whisperText) return;
            // Semantic comparison — ignore punctuation and casing differences.
            // Only correct if the actual words differ, not just formatting.
            const normalize = (s: string) =>
              s.toLowerCase().replace(/[^\w\s]/g, "").replace(/\s+/g, " ").trim();
            if (normalize(whisperText) === normalize(liveText)) return;
            // Use the per-call message ID — bound to this invocation's closure only.
            // If Whisper returned unusually fast and the SSE ID hasn't arrived yet,
            // wait briefly (up to 3 s) before giving up.
            if (!thisCallMessageId) {
              await new Promise<void>((resolve) => {
                const start = Date.now();
                const poll = setInterval(() => {
                  if (thisCallMessageId || Date.now() - start > 3000) {
                    clearInterval(poll);
                    resolve();
                  }
                }, 100);
              });
            }
            if (!thisCallMessageId) return; // ID never arrived — skip correction safely
            const patchRes = await fetch(resolveUrl(`/api/debriefs/${correctionDebriefId}/messages/${thisCallMessageId}/correct-text`), {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify({ correctedText: whisperText }),
            });
            if (patchRes.ok) {
              // Refresh query cache so the corrected text shows in the chat bubble
              queryClient.invalidateQueries({ queryKey: ["/api/debriefs", selectedDate] });
            }
          } catch (err) {
            // Whisper correction failed — live transcript remains, no regression
            console.warn("[VoiceNote] Background Whisper correction failed:", err);
          }
        }).catch(() => {
          // Recorder stop failed — nothing to transcribe, live text already sent
        });
      } else {
        // ── Fallback path: no live transcript (Speech API unavailable or silent) ─
        // Await Whisper before sending — show a brief non-blocking indicator
        setIsTranscribing(true);
        try {
          const result = await recorderStopPromise;
          if (!result || result.blob.size < 100) {
            setIsTranscribing(false);
            toast({
              title: "No audio captured",
              description: "Nothing was recorded — tap the mic and try again.",
              variant: "destructive",
            });
            return;
          }
          const arrayBuffer = await result.blob.arrayBuffer();
          const controller = new AbortController();
          const fetchTimeout = setTimeout(() => controller.abort(), 30_000);
          let response: Response;
          try {
            response = await fetch(resolveUrl("/api/voice-note/transcribe"), {
              method: "POST",
              headers: {
                "Content-Type": "application/octet-stream",
                "X-Mime-Type": result.mimeType,
              },
              body: arrayBuffer,
              credentials: "include",
              signal: controller.signal,
            });
          } finally {
            clearTimeout(fetchTimeout);
          }
          if (!response.ok) throw new Error(`Transcribe HTTP ${response.status}`);
          const data = await response.json();
          const text = data.text?.trim() ?? "";
          setIsTranscribing(false);
          if (text) {
            haptic("medium");
            warmAudioCtx();
            sendMessage(text);
          } else {
            toast({ title: "Nothing to transcribe", description: "The recording was silent — try again.", variant: "default" });
          }
        } catch (err) {
          console.error("[VoiceNote] Transcription failed:", err);
          setIsTranscribing(false);
          toast({ title: "Transcription failed", description: "Couldn't process the recording. Please try again.", variant: "destructive" });
        }
      }
      return;
    }

    // STT fallback path — text is already accumulated in voiceNoteTextRef
    const text = voiceNoteTextRef.current.trim() || userInput.trim();
    voice.stop();
    voiceNoteTextRef.current = "";
    setUserInput("");
    if (text) {
      haptic("medium");
      warmAudioCtx();
      sendMessage(text);
    }
  }, [voice, voiceNoteRecorder, usingMediaRecorder, userInput, sendMessage, debrief, selectedDate, queryClient]);

  // Keep the forward ref in sync so startVoiceNote's 5-min timeout always calls latest version
  submitVoiceNoteRef.current = submitVoiceNote;

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
    const container = chatContainerRef.current;
    if (!container) return;

    if (isStreaming && streamingContent) {
      // First content token: scroll so the START of the streaming bubble is visible.
      // Lock out further auto-scrolls so the user can read from the beginning.
      // IMPORTANT: only lock if we successfully scrolled — framer-motion can attach
      // the ref slightly after the useEffect fires (on the same render cycle but
      // after layout), so el may be null on the very first token.  If we lock
      // without scrolling, both the container auto-scroll AND the final
      // scrollIntoView after streaming are suppressed, leaving the response
      // invisible below the fold.  Not locking lets the next token retry.
      if (!hasScrolledToStreamStart.current) {
        const el = streamingMsgRef.current;
        if (el) {
          hasScrolledToStreamStart.current = true;
          lockScrollAfterStreamRef.current = true;
          // Scroll the internal chat container so the streaming bubble sits
          // near the top of its visible area.
          // Formula: position within the scrollable content = current scrollTop +
          // (element's viewport top - container's viewport top).
          // Using getBoundingClientRect deltas is safe here because the container
          // is an overflow scroll box — elements it clips still report their full
          // viewport position (possibly below the visible fold), so the delta
          // correctly gives us how far to scroll the container.
          const elRect = el.getBoundingClientRect();
          const containerRect = container.getBoundingClientRect();
          const targetScrollTop = container.scrollTop + (elRect.top - containerRect.top) - 8;
          container.scrollTop = Math.max(0, Math.min(targetScrollTop, container.scrollHeight - container.clientHeight));
        }
      }
      // Subsequent tokens: do NOT chase scrollHeight — keep start of response pinned.
      return;
    }

    if (!isStreaming) {
      hasScrolledToStreamStart.current = false;
      // Streaming just finished (or DB refetch after finish): stay at the start of the response.
      if (lockScrollAfterStreamRef.current) return;
    }
    // Non-streaming (page load / history navigation): show latest message.
    container.scrollTop = container.scrollHeight;
  }, [debrief?.messages, streamingContent, realtimeMessages, isStreaming]);

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
    if (voiceNoteMode || isTranscribing) {
      stopVoiceNoteTimers();
      voiceNoteRecorder.cancel();
      voice.stop();
      setVoiceNoteMode(false);
      setVoiceNoteSeconds(0);
      setIsTranscribing(false);
      setUsingMediaRecorder(false);
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
  const dateLabel = isToday ? "Today" : new Date(selectedDate + "T12:00:00").toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

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

  // ── Shared quick-log helpers (used by both hero states) ─────────────────────
  const closeQuickLog = () => {
    if (voice.isListening) voice.stop();
    setShowQuickLog(false);
    setQuickLogText("");
    setPendingQuickLogPhoto(null);
  };

  const handleQuickLogFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsQuickLogUploading(true);
    try {
      const urlRes = await apiRequest("POST", "/api/uploads/request-url", {
        name: file.name,
        size: file.size,
        contentType: file.type,
      });
      const { uploadURL, objectPath } = await urlRes.json();
      await fetch(uploadURL, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      setPendingQuickLogPhoto({
        objectPath,
        previewUrl: URL.createObjectURL(file),
        filename: file.name,
        contentType: file.type,
        size: file.size,
      });
    } catch {
      toast({ title: "Upload failed", description: "Couldn't attach the photo. Please try again.", variant: "destructive" });
    } finally {
      setIsQuickLogUploading(false);
      if (quickLogFileInputRef.current) quickLogFileInputRef.current.value = "";
    }
  };

  const quickLogOverlay = showQuickLog ? (
    <div className="fixed inset-0 z-[300] flex items-end justify-center" style={{ touchAction: 'none' }}>
      <div className="absolute inset-0 bg-black/60" onClick={closeQuickLog} />
      <div
        className="relative w-full max-w-lg rounded-t-2xl bg-background border-t border-border/50 p-5 space-y-4"
        style={{ paddingBottom: 'calc(1.25rem + env(safe-area-inset-bottom))' }}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">Log a moment</h3>
          <button onClick={closeQuickLog} className="text-muted-foreground hover:text-foreground p-1">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Mode toggle — only shown when voice is supported */}
        {voice.isSupported && (
          <div className="flex items-center gap-1 p-1 bg-muted rounded-xl">
            <button
              onClick={() => {
                if (!isPremium) { openPaywall("Voice Notes"); return; }
                haptic("light"); setQuickLogMode('voice');
              }}
              className={`flex-1 h-8 rounded-lg flex items-center justify-center gap-1.5 text-xs font-medium transition-all ${
                quickLogMode === 'voice'
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Mic className="h-3.5 w-3.5" />
              Voice Note
            </button>
            <button
              onClick={() => { haptic("light"); if (voice.isListening) voice.stop(); setQuickLogMode('keyboard'); }}
              className={`flex-1 h-8 rounded-lg flex items-center justify-center gap-1.5 text-xs font-medium transition-all ${
                quickLogMode === 'keyboard'
                  ? "bg-background text-foreground shadow-sm border border-border/60"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Keyboard className="h-3.5 w-3.5" />
              Keyboard
            </button>
          </div>
        )}

        {/* Voice mode */}
        {(quickLogMode === 'voice' && voice.isSupported && isPremium) && (
          <div className="space-y-3">
            <div className="min-h-[88px] bg-muted/50 rounded-xl px-4 py-3 text-sm text-foreground leading-relaxed">
              {quickLogText || voice.interimText ? (
                <p>
                  {quickLogText}
                  {voice.interimText && <span className="text-muted-foreground"> {voice.interimText}</span>}
                </p>
              ) : (
                <p className="text-muted-foreground/60 italic text-[13px]">
                  {voice.isListening ? "Listening…" : "Tap the mic and speak freely"}
                </p>
              )}
            </div>
            {voice.micError && (
              <p className="text-xs text-destructive px-1">{voice.micError}</p>
            )}
            <button
              onClick={() => {
                if (voice.isListening) {
                  haptic("light"); voice.stop();
                } else {
                  haptic("medium");
                  voice.start(
                    (text) => setQuickLogText(prev => prev + (prev ? ' ' : '') + text),
                    { noSilenceStop: true },
                  );
                }
              }}
              className={`w-full h-12 rounded-xl flex items-center justify-center gap-2 text-sm font-medium transition-all border ${
                voice.isListening
                  ? "bg-red-500/10 border-red-500/30 text-red-500"
                  : "bg-muted border-border text-foreground"
              }`}
            >
              {voice.isListening ? (
                <><span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" /><MicOff className="h-4 w-4" /> Tap to stop</>
              ) : (
                <><Mic className="h-4 w-4" />{quickLogText ? "Continue recording" : "Start recording"}</>
              )}
            </button>
            {quickLogText && (
              <button onClick={() => { haptic("light"); setQuickLogText(""); }}
                className="w-full text-[11px] text-muted-foreground/60 hover:text-muted-foreground transition-colors text-center">
                Clear
              </button>
            )}
          </div>
        )}

        {/* Keyboard mode */}
        {(quickLogMode === 'keyboard' || !voice.isSupported || !isPremium) && (
          <textarea
            autoFocus
            rows={5}
            value={quickLogText}
            onChange={e => setQuickLogText(e.target.value)}
            placeholder="How's it going? What's on your mind right now…"
            className="w-full bg-muted/50 border border-border/50 rounded-xl px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/60 outline-none resize-none leading-relaxed"
          />
        )}

        {/* Photo preview */}
        {pendingQuickLogPhoto && (
          <div className="flex items-center gap-3">
            <div className="relative">
              <img
                src={pendingQuickLogPhoto.previewUrl}
                alt="photo preview"
                className="h-16 w-16 rounded-lg object-cover border border-border/50"
              />
              <button
                onClick={() => setPendingQuickLogPhoto(null)}
                className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full bg-background border border-border flex items-center justify-center"
              >
                <X className="h-2.5 w-2.5 text-muted-foreground" />
              </button>
            </div>
            <button
              onClick={() => quickLogFileInputRef.current?.click()}
              className="text-xs text-primary underline underline-offset-2"
            >
              Change photo
            </button>
          </div>
        )}

        {/* Hidden file input */}
        <input
          ref={quickLogFileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleQuickLogFileSelect}
        />

        <div className="flex gap-2">
          {/* Camera button — only shown if no photo attached yet */}
          {!pendingQuickLogPhoto && (
            <button
              onClick={() => quickLogFileInputRef.current?.click()}
              disabled={isQuickLogUploading || quickLogMutation.isPending}
              className="h-11 w-11 shrink-0 rounded-xl border border-border/60 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40"
            >
              {isQuickLogUploading
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <Paperclip className="h-4 w-4" />
              }
            </button>
          )}
          <Button
            className="flex-1 h-11 font-semibold rounded-xl"
            style={{ background: 'hsl(38,92%,50%)', color: '#0a0a0a' }}
            disabled={!(quickLogText.trim() || voice.interimText?.trim() || pendingQuickLogPhoto) || quickLogMutation.isPending || isQuickLogUploading}
            onClick={() => {
              const finalText = [quickLogText, voice.interimText].filter(Boolean).join(' ').trim();
              if (!finalText && !pendingQuickLogPhoto) return;
              if (voice.isListening) voice.stop();
              haptic("medium");
              quickLogMutation.mutate({ content: finalText, date: selectedDate, photo: pendingQuickLogPhoto });
            }}
          >
            {quickLogMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save entry"}
          </Button>
        </div>
      </div>
    </div>
  ) : null;

  // No debriefs at all — show the start prompt
  if (!debrief && completedDebriefs.length === 0) {
    const hour = new Date().getHours();
    const greeting = hour < 12 ? "Morning debrief" : hour < 17 ? "Afternoon debrief" : "Evening debrief";
    return (
      <div className="debrief-hero-card rounded-2xl overflow-hidden relative">
        {/* Subtle top amber strip */}
        <div className="absolute top-0 left-0 right-0 h-[2px]" style={{ background: 'linear-gradient(90deg, transparent, rgba(245,158,11,0.7) 30%, rgba(245,158,11,0.9) 50%, rgba(245,158,11,0.7) 70%, transparent)' }} />

        <div className="px-5 pt-5 pb-6 space-y-5">
          {/* Header row */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
              <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-primary/90">
                {isToday ? greeting : `Debrief · ${dateLabel}`}
              </span>
            </div>
            <span className="text-[11px] text-muted-foreground/60 font-medium">Session ready</span>
          </div>

          {/* Main prompt */}
          <div>
            <h2 className="text-[22px] font-black text-foreground leading-tight tracking-tight">
              {isToday ? "Debrief Now." : "Reflect on this day."}
            </h2>
            <p className="text-sm text-muted-foreground/80 mt-1.5 leading-relaxed">
              {isToday
                ? "Your AI performance engineer is ready. Let's break down the day."
                : "Log a reflection for this day with your AI engineer."}
            </p>
          </div>

          {/* Three options */}
          <div className="space-y-2.5">
            <Button
              onPointerDown={(e) => { e.preventDefault(); if (startDebriefMutation.isPending) return; haptic("medium"); warmAudioCtx(); startDebriefMutation.mutate({ fresh: false, userLed: true }); }}
              disabled={startDebriefMutation.isPending}
              className="w-full h-12 text-sm font-bold rounded-xl"
              style={{ background: 'hsl(38,92%,50%)', color: '#0a0a0a', touchAction: 'manipulation' }}
            >
              {startDebriefMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <><MessageCircle className="h-4 w-4 mr-1.5" />New session</>
              )}
            </Button>
            <div className="grid grid-cols-2 gap-2.5">
              <Button
                onPointerDown={(e) => { e.preventDefault(); haptic("light"); setShowQuickLog(true); }}
                variant="outline"
                className="h-11 text-xs font-medium rounded-xl border-border/40 text-foreground"
                style={{ touchAction: 'manipulation' }}
              >
                <BookOpen className="h-3.5 w-3.5 mr-1.5" />Log a moment
              </Button>
              <Button
                onPointerDown={(e) => { e.preventDefault(); if (startDebriefMutation.isPending) return; haptic("light"); warmAudioCtx(); startDebriefMutation.mutate({ fresh: false, userLed: false }); }}
                disabled={startDebriefMutation.isPending}
                variant="outline"
                className="h-11 text-xs font-medium rounded-xl border-primary/30 text-primary/80 hover:bg-primary/5"
                style={{ touchAction: 'manipulation' }}
              >
                <Zap className="h-3.5 w-3.5 mr-1.5" />Engineer prompt
              </Button>
            </div>
            <p className="text-center text-[10px] text-muted-foreground/40 leading-tight">
              Engineer prompt — your AI analyses your data and opens the session
            </p>
          </div>
        </div>

        {quickLogOverlay}
      </div>
    );
  }

  // All debriefs complete — collapsible history + prominent new session CTA
  if (!debrief && completedDebriefs.length > 0) {
    return (
      <div className="space-y-3">
        {/* New session hero — full prominence even after a session exists */}
        <div className="debrief-hero-card rounded-2xl overflow-hidden relative">
          <div className="absolute top-0 left-0 right-0 h-[2px]" style={{ background: 'linear-gradient(90deg, transparent, rgba(245,158,11,0.7) 30%, rgba(245,158,11,0.9) 50%, rgba(245,158,11,0.7) 70%, transparent)' }} />
          <div className="px-5 pt-5 pb-6 space-y-5">
            <div className="flex items-center gap-1.5">
              <CheckCircle className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
              <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-emerald-400/90">Session logged</span>
            </div>
            <div className="text-center">
              <h2 className="text-[32px] font-black text-foreground leading-none tracking-tight">
                Debrief Now
              </h2>
              <p className="text-sm text-muted-foreground/80 mt-2 leading-relaxed">
                {isToday
                  ? "Start a new session with your AI engineer, or log a quick moment."
                  : `Add another reflection for ${dateLabel}.`}
              </p>
            </div>
            <div className="space-y-2.5">
              <Button
                onPointerDown={(e) => { e.preventDefault(); if (startDebriefMutation.isPending) return; haptic("medium"); warmAudioCtx(); startDebriefMutation.mutate({ fresh: true, userLed: true }); }}
                disabled={startDebriefMutation.isPending}
                className="w-full h-12 text-sm font-bold rounded-xl"
                style={{ background: 'hsl(38,92%,50%)', color: '#0a0a0a', touchAction: 'manipulation' }}
              >
                {startDebriefMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <><MessageCircle className="h-4 w-4 mr-1.5" />New session</>
                )}
              </Button>
              <div className="grid grid-cols-2 gap-2.5">
                <Button
                  onPointerDown={(e) => { e.preventDefault(); haptic("light"); setShowQuickLog(true); }}
                  variant="outline"
                  className="h-11 text-xs font-medium rounded-xl border-border/40 text-foreground"
                  style={{ touchAction: 'manipulation' }}
                >
                  <BookOpen className="h-3.5 w-3.5 mr-1.5" />Log a moment
                </Button>
                <Button
                  onPointerDown={(e) => { e.preventDefault(); if (startDebriefMutation.isPending) return; haptic("light"); warmAudioCtx(); startDebriefMutation.mutate({ fresh: true, userLed: false }); }}
                  disabled={startDebriefMutation.isPending}
                  variant="outline"
                  className="h-11 text-xs font-medium rounded-xl border-primary/30 text-primary/80 hover:bg-primary/5"
                  style={{ touchAction: 'manipulation' }}
                >
                  <Zap className="h-3.5 w-3.5 mr-1.5" />Engineer prompt
                </Button>
              </div>
              <p className="text-center text-[10px] text-muted-foreground/40 leading-tight">
                Engineer prompt — your AI analyses your data and opens the session
              </p>
            </div>
          </div>

          {quickLogOverlay}
        </div>

        {/* Past sessions — collapsed below the CTA */}
        <Card className="border border-border/30 shadow-sm bg-card/70 overflow-hidden">
          <CardContent className="p-0">
            <div className="divide-y divide-border/30">
              {(() => {
                let sessionCount = 0;
                return completedDebriefs.map((d) => {
                  const msgs = d.messages || [];
                  const isMoment = !msgs.some((m: any) => m.role === "assistant");
                  if (!isMoment) sessionCount++;
                  const isExpanded = expandedSessions.has(d.id);
                  const sessionText = msgs.filter((m: any) => m.role === "assistant").map((m: any) => m.content).join(" ");
                  const userMsg = msgs.find((m: any) => m.role === "user");
                  const momentText = userMsg?.content || "";
                  const momentPhoto = userMsg?.attachmentUrl;

                  if (isMoment) {
                    const isDebriefSelected = selectedDebriefId === d.id;
                    return (
                      <div key={d.id} className={`px-5 py-3 transition-colors ${isDebriefSelected ? "bg-destructive/5" : ""}`}>
                        <button
                          onClick={() => { if (isDebriefSelected) { setSelectedDebriefId(null); return; } haptic("select"); toggleSession(d.id); }}
                          onTouchStart={() => startDebriefLongPress(d.id)}
                          onTouchEnd={cancelDebriefLongPress}
                          onTouchMove={cancelDebriefLongPress}
                          onMouseDown={() => startDebriefLongPress(d.id)}
                          onMouseUp={cancelDebriefLongPress}
                          onMouseLeave={cancelDebriefLongPress}
                          className="w-full flex items-center gap-2 text-left"
                        >
                          <BookOpen className="h-3.5 w-3.5 text-primary/70 shrink-0" />
                          <span className="text-[10px] font-bold uppercase tracking-widest text-primary/70 shrink-0">Moment</span>
                          <span className="text-[10px] text-muted-foreground/60 shrink-0">{formatMsgTime(d.createdAt)}</span>
                          {momentText && !isExpanded && (
                            <span className="text-xs text-muted-foreground truncate flex-1 ml-1">{momentText}</span>
                          )}
                          {momentPhoto && !isExpanded && (
                            <Paperclip className="h-3 w-3 text-muted-foreground/50 shrink-0" />
                          )}
                          <span className="ml-auto shrink-0 flex items-center gap-1 text-[10px] text-muted-foreground">
                            {isExpanded ? "Hide" : "Show"}
                            <ChevronDown className={`h-3 w-3 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                          </span>
                        </button>
                        {isDebriefSelected && (
                          <div className="flex items-center justify-between mt-2 pt-2 border-t border-destructive/20">
                            <span className="text-[11px] text-destructive/80">Delete this moment?</span>
                            <div className="flex gap-2">
                              <button onClick={() => setSelectedDebriefId(null)} className="text-[11px] text-muted-foreground px-2 py-1">Cancel</button>
                              <button
                                onClick={() => { haptic("medium"); deleteDebriefMutation.mutate(d.id); }}
                                disabled={deleteDebriefMutation.isPending}
                                className="text-[11px] font-semibold text-destructive px-2 py-1 rounded-md bg-destructive/10 hover:bg-destructive/20"
                              >
                                {deleteDebriefMutation.isPending ? "Deleting…" : "Delete"}
                              </button>
                            </div>
                          </div>
                        )}
                        {isExpanded && !isDebriefSelected && (
                          <div className="mt-3 space-y-3">
                            {momentText && (
                              <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">{momentText}</p>
                            )}
                            {momentPhoto && (
                              <img
                                src={momentPhoto}
                                alt="Attached photo"
                                className="rounded-xl max-h-64 w-auto object-cover border border-border/30"
                              />
                            )}
                          </div>
                        )}
                      </div>
                    );
                  }

                  const isDebriefSelected2 = selectedDebriefId === d.id;
                  return (
                    <div key={d.id} className={`px-5 py-3 transition-colors ${isDebriefSelected2 ? "bg-destructive/5" : ""}`}>
                      <button
                        onClick={() => { if (isDebriefSelected2) { setSelectedDebriefId(null); return; } haptic("select"); toggleSession(d.id); }}
                        onTouchStart={() => startDebriefLongPress(d.id)}
                        onTouchEnd={cancelDebriefLongPress}
                        onTouchMove={cancelDebriefLongPress}
                        onMouseDown={() => startDebriefLongPress(d.id)}
                        onMouseUp={cancelDebriefLongPress}
                        onMouseLeave={cancelDebriefLongPress}
                        className="w-full flex items-center gap-2 text-left"
                      >
                        <CheckCircle className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                        <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground shrink-0">
                          Session {sessionCount}
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
                      {isDebriefSelected2 && (
                        <div className="flex items-center justify-between mt-2 pt-2 border-t border-destructive/20">
                          <span className="text-[11px] text-destructive/80">Delete this session?</span>
                          <div className="flex gap-2">
                            <button onClick={() => setSelectedDebriefId(null)} className="text-[11px] text-muted-foreground px-2 py-1">Cancel</button>
                            <button
                              onClick={() => { haptic("medium"); deleteDebriefMutation.mutate(d.id); }}
                              disabled={deleteDebriefMutation.isPending}
                              className="text-[11px] font-semibold text-destructive px-2 py-1 rounded-md bg-destructive/10 hover:bg-destructive/20"
                            >
                              {deleteDebriefMutation.isPending ? "Deleting…" : "Delete"}
                            </button>
                          </div>
                        </div>
                      )}
                      {isExpanded && (
                        <div className="mt-3 space-y-2">
                          {d.summary && (
                            <p className="text-xs text-muted-foreground italic leading-relaxed pb-2 border-b border-border/30">{d.summary}</p>
                          )}
                          <div className="space-y-2 max-h-[300px] overflow-y-auto">
                            {(d.messages || []).map((msg: any) => (
                              <div key={msg.id} className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"}`}>
                                <div className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
                                  msg.role === "user"
                                    ? "bg-primary text-primary-foreground rounded-br-md"
                                    : "bg-muted text-foreground rounded-bl-md"
                                }`}>
                                  {msg.content}
                                </div>
                                {msg.attachmentUrl && msg.attachmentType === "image" && (
                                  <img
                                    src={msg.attachmentUrl}
                                    alt="Attached photo"
                                    className="mt-1.5 rounded-xl max-h-48 w-auto object-cover border border-border/30"
                                  />
                                )}
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
                });
              })()}
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

  return (
    <div className="space-y-3">
    {/* Active session card — viewport-height constrained so header + input always visible */}
    <Card
      ref={debriefCardRef}
      className="bg-card flex flex-col overflow-hidden"
      style={{
        border: '1px solid rgba(245,158,11,0.5)',
        boxShadow: '0 0 0 3px rgba(245,158,11,0.1), 0 4px 24px rgba(245,158,11,0.12)',
        maxHeight: 'calc(var(--visual-height, 100dvh) - env(safe-area-inset-top) - env(safe-area-inset-bottom) - 7rem)',
      }}
    >
      <CardContent className="p-0 flex flex-col flex-1 overflow-hidden">
        <div
          className="px-3 py-2.5 border-b border-border/50 flex items-center gap-2 flex-shrink-0"
          onTouchStart={() => startDebriefLongPress(debrief.id)}
          onTouchEnd={cancelDebriefLongPress}
          onTouchMove={cancelDebriefLongPress}
          onMouseDown={() => startDebriefLongPress(debrief.id)}
          onMouseUp={cancelDebriefLongPress}
          onMouseLeave={cancelDebriefLongPress}
        >
          {selectedDebriefId === debrief.id ? (
            <div className="flex items-center justify-between w-full">
              <span className="text-[11px] text-destructive/80 font-medium">Delete this session?</span>
              <div className="flex gap-2">
                <button onClick={() => setSelectedDebriefId(null)} className="text-[11px] text-muted-foreground px-2 py-1">Cancel</button>
                <button
                  onClick={() => { haptic("medium"); deleteDebriefMutation.mutate(debrief.id); }}
                  disabled={deleteDebriefMutation.isPending}
                  className="text-[11px] font-semibold text-destructive px-2 py-1 rounded-md bg-destructive/10"
                >
                  {deleteDebriefMutation.isPending ? "Deleting…" : "Delete"}
                </button>
              </div>
            </div>
          ) : (
            <>
          {/* Left: title + progress dots — shrinks to give room to buttons */}
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
            <span className="text-sm font-medium text-foreground shrink-0">Debrief</span>
            {assistantMessageCount > 0 && (
              <span className="text-[10px] text-muted-foreground shrink-0">
                {assistantMessageCount} {assistantMessageCount === 1 ? "exchange" : "exchanges"}
              </span>
            )}
          </div>
          {/* Right: action buttons — icon-only to avoid overflow on narrow screens */}
          <div className="flex items-center gap-0.5 flex-shrink-0">
            {tts.isSupported && !realtimeVoice.isActive && !isConversationMode && (() => {
              // Prefer the ref (set the moment streaming ends) over the query cache
              // — the cache refetch from invalidateQueries may not have landed yet
              // when the user taps the speaker immediately after a response.
              const lastAiMsg =
                lastStreamedAiMsgRef.current ||
                ((debrief.messages || []).filter(m => m.role === "assistant").slice(-1)[0]?.content ?? "");
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
            {!showCheckpoint && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => completeDebriefMutation.mutate(debrief.id)}
                disabled={completeDebriefMutation.isPending}
                className="h-7 px-2 gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                title="End debrief"
              >
                {completeDebriefMutation.isPending ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Flag className="h-3 w-3" />
                )}
                Finish session
              </Button>
            )}
          </div>
            </>
          )}
        </div>

        <div ref={chatContainerRef} className="flex-1 min-h-0 px-5 py-4 space-y-3 overflow-y-auto overscroll-y-contain">
          {(debrief.messages || []).length === 0 && !isStreaming && (
            <p className="text-sm text-muted-foreground text-center py-4">
              Your session, your opening. What's on your mind?
            </p>
          )}

          {!showAllMessages && (debrief.messages || []).length > VISIBLE_MESSAGES && (
            <button
              onClick={() => setShowAllMessages(true)}
              className="w-full flex items-center justify-center gap-1.5 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <ChevronDown className="h-3.5 w-3.5" />
              Show {(debrief.messages || []).length - VISIBLE_MESSAGES} earlier messages
            </button>
          )}

          <AnimatePresence initial={false}>
            {(showAllMessages ? (debrief.messages || []) : (debrief.messages || []).slice(-VISIBLE_MESSAGES)).map((msg) => {
              const isSelected = selectedMsgId === msg.id;
              const isUser = msg.role === "user";
              return (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: isUser ? 40 : -40, scale: 0.9 }}
                  transition={{ duration: 0.2 }}
                  className={`flex flex-col ${isUser ? "items-end" : "items-start"}`}
                >
                  <div
                    onTouchStart={() => {
                      if (!isUser) return;
                      longPressTimerRef.current = setTimeout(() => {
                        haptic("medium");
                        setSelectedMsgId(msg.id);
                      }, 450);
                    }}
                    onTouchEnd={() => {
                      if (longPressTimerRef.current) {
                        clearTimeout(longPressTimerRef.current);
                        longPressTimerRef.current = null;
                      }
                    }}
                    onTouchMove={() => {
                      if (longPressTimerRef.current) {
                        clearTimeout(longPressTimerRef.current);
                        longPressTimerRef.current = null;
                      }
                    }}
                    onMouseDown={() => {
                      if (!isUser) return;
                      longPressTimerRef.current = setTimeout(() => {
                        setSelectedMsgId(msg.id);
                      }, 450);
                    }}
                    onMouseUp={() => {
                      if (longPressTimerRef.current) {
                        clearTimeout(longPressTimerRef.current);
                        longPressTimerRef.current = null;
                      }
                    }}
                    className={`max-w-[85%] rounded-2xl text-sm leading-relaxed select-none transition-opacity cursor-default overflow-hidden ${
                      isUser
                        ? "bg-primary text-primary-foreground rounded-br-md"
                        : "bg-muted text-foreground rounded-bl-md"
                    } ${isSelected ? "opacity-70" : ""} ${msg.attachmentUrl ? "p-0" : "px-4 py-2.5"}`}
                  >
                    {msg.attachmentUrl && (
                      <img
                        src={msg.attachmentUrl}
                        alt="session photo"
                        className="w-full max-w-[240px] rounded-2xl object-cover"
                        style={{ maxHeight: 200 }}
                      />
                    )}
                    {msg.content && (
                      <div className={msg.attachmentUrl ? "px-4 py-2.5" : ""}>
                        {msg.content}
                      </div>
                    )}
                  </div>

                  {/* Timestamp + delete controls */}
                  <div className={`flex items-center gap-2 mt-0.5 px-1 ${isUser ? "flex-row-reverse" : "flex-row"}`}>
                    {msg.createdAt && (
                      <span className="text-[10px] text-muted-foreground/60">
                        {formatMsgTime(msg.createdAt)}
                      </span>
                    )}
                    <AnimatePresence>
                      {isSelected && isUser && (
                        <motion.div
                          initial={{ opacity: 0, scale: 0.8, x: 8 }}
                          animate={{ opacity: 1, scale: 1, x: 0 }}
                          exit={{ opacity: 0, scale: 0.8, x: 8 }}
                          transition={{ duration: 0.15 }}
                          className="flex items-center gap-1.5"
                        >
                          <button
                            onClick={() => deleteMsgMutation.mutate(msg.id)}
                            disabled={deleteMsgMutation.isPending}
                            className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-destructive/10 border border-destructive/30 text-destructive text-[10px] font-medium hover:bg-destructive/20 transition-colors disabled:opacity-50"
                          >
                            {deleteMsgMutation.isPending && deleteMsgMutation.variables === msg.id
                              ? <Loader2 className="h-2.5 w-2.5 animate-spin" />
                              : <Trash2 className="h-2.5 w-2.5" />}
                            Delete
                          </button>
                          <button
                            onClick={() => setSelectedMsgId(null)}
                            className="text-[10px] text-muted-foreground/60 hover:text-muted-foreground transition-colors"
                          >
                            Cancel
                          </button>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>

          {realtimeVoice.status === "user_speaking" && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Mic className="h-3 w-3 animate-pulse text-primary" />
              <span>Listening…</span>
            </div>
          )}

          {isStreaming && streamingContent && (
            <motion.div
              ref={streamingMsgRef}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
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
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, delay: 0.15 }}
              className="pt-1 pb-1"
            >
              <div className="flex items-center justify-center gap-2.5">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleWrapUp}
                  disabled={completeDebriefMutation.isPending}
                  className="h-8 px-4 text-xs font-medium border-border/60 text-muted-foreground hover:text-foreground"
                >
                  {completeDebriefMutation.isPending ? (
                    <Loader2 className="h-3 w-3 animate-spin mr-1.5" />
                  ) : (
                    <CheckCircle className="h-3 w-3 mr-1.5" />
                  )}
                  End Session
                </Button>
                <Button
                  size="sm"
                  onClick={handleGoDeeper}
                  disabled={isStreaming}
                  className="h-8 px-4 text-xs font-medium bg-primary hover:bg-primary/90 text-primary-foreground"
                >
                  Go Deeper
                  <ArrowRight className="h-3 w-3 ml-1.5" />
                </Button>
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
            {isTranscribing ? (
            /* Fallback-only: no live transcript — briefly preparing before sending */
            <div className="flex items-center gap-2 py-1 px-0.5">
              <Loader2 className="h-3.5 w-3.5 text-muted-foreground animate-spin shrink-0" />
              <p className="text-xs text-muted-foreground">Preparing note…</p>
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
                    <span className="text-[10px] text-muted-foreground/60 ml-auto">
                      {VOICE_NOTE_MAX_SECS - voiceNoteSeconds <= 60
                        ? <span className="text-amber-500 font-medium">{formatVoiceTime(VOICE_NOTE_MAX_SECS - voiceNoteSeconds)} left</span>
                        : "Submit when done"}
                    </span>
                  </div>
                  {/* Time progress bar — turns amber in last 60 s */}
                  <div className="h-0.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-1000 ${
                        VOICE_NOTE_MAX_SECS - voiceNoteSeconds <= 60 ? "bg-amber-500" : "bg-red-500/60"
                      }`}
                      style={{ width: `${Math.min(100, (voiceNoteSeconds / VOICE_NOTE_MAX_SECS) * 100)}%` }}
                    />
                  </div>
                  {/* Live transcript (STT fallback) or static prompt (MediaRecorder mode) */}
                  {!usingMediaRecorder && (userInput || voice.interimText) ? (
                    <p className="text-sm text-foreground leading-relaxed line-clamp-4">
                      {userInput.length > 300 ? "…" + userInput.slice(-300) : userInput}
                      {voice.interimText ? <span className="text-muted-foreground"> {voice.interimText}</span> : null}
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground italic">Speak freely — take your time, long pauses are fine, mic stays live until you submit…</p>
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
                  onClick={() => submitVoiceNote()}
                  disabled={!usingMediaRecorder && !(userInput.trim()) && !(voice.interimText?.trim())}
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
              {/* ── Input mode toggle — Voice Note vs Keyboard ── */}
              {voice.isSupported && (
                <div className="flex gap-1.5 mb-2">
                  <button
                    disabled={isStreaming}
                    onClick={() => {
                      if (textMode) {
                        haptic("light");
                        setTextMode(false);
                      } else {
                        if (!isPremium) {
                          openPaywall("Voice Notes");
                          return;
                        }
                        haptic("medium");
                        warmAudioCtx();
                        startVoiceNote();
                      }
                    }}
                    className={`flex-1 h-8 rounded-lg flex items-center justify-center gap-1.5 text-xs font-medium transition-all disabled:opacity-40 ${
                      !textMode
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "bg-muted text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Mic className="h-3.5 w-3.5" />
                    Voice Note
                  </button>
                  <button
                    disabled={isStreaming}
                    onClick={() => {
                      if (!textMode) {
                        haptic("light");
                        setTextMode(true);
                        if (voice.isListening) voice.stop();
                        setTimeout(() => inputRef.current?.focus(), 50);
                      }
                    }}
                    className={`flex-1 h-8 rounded-lg flex items-center justify-center gap-1.5 text-xs font-medium transition-all disabled:opacity-40 ${
                      textMode
                        ? "bg-muted text-foreground border border-border/60"
                        : "bg-muted text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Keyboard className="h-3.5 w-3.5" />
                    Keyboard
                  </button>
                </div>
              )}

              {/* Mic error banner */}
              {voice.micError && (
                <div className="flex items-start gap-2 mb-2 px-2 py-1.5 bg-destructive/10 rounded-lg">
                  {voice.micError === "SETTINGS_NEEDED" ? (
                    <div className="flex-1 space-y-1.5">
                      <span className="text-xs text-destructive block">Microphone access denied. Enable it in iPhone Settings → DBrief App → Microphone.</span>
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

              {/* Text input row — only shown in keyboard mode (or when voice unsupported) */}
              {(textMode || !voice.isSupported) && (
                <div className="flex flex-col gap-1.5 bg-muted/50 rounded-xl border border-border/50 p-2">
                  {/* Pending photo preview */}
                  {pendingAttachment && (
                    <div className="flex items-center gap-3 px-1">
                      <div className="relative">
                        <img
                          src={pendingAttachment.previewUrl}
                          alt="photo preview"
                          className="h-16 w-16 rounded-lg object-cover border border-border/50"
                        />
                        <button
                          onClick={() => setPendingAttachment(null)}
                          className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full bg-background border border-border flex items-center justify-center"
                        >
                          <X className="h-2.5 w-2.5 text-muted-foreground" />
                        </button>
                      </div>
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        className="text-xs text-primary underline underline-offset-2"
                      >
                        Change photo
                      </button>
                    </div>
                  )}
                  <div className="flex items-end gap-2">
                    {/* Hidden file input — images only */}
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleFileSelect}
                    />
                    {/* Paperclip — hidden once a photo has been sent this session or one is pending */}
                    {!pendingAttachment && !debrief?.messages?.some(m => m.attachmentUrl) && (
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isStreaming || isUploading}
                        className="shrink-0 h-8 w-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40"
                      >
                        {isUploading
                          ? <Loader2 className="h-4 w-4 animate-spin" />
                          : <Paperclip className="h-4 w-4" />
                        }
                      </button>
                    )}
                    <textarea
                      ref={inputRef}
                      rows={1}
                      value={displayInput}
                      onChange={(e) => setUserInput(e.target.value)}
                      onKeyDown={handleKeyDown}
                      onInput={handleTextareaInput}
                      placeholder="Type your message…"
                      className="flex-1 min-w-0 bg-transparent border-0 outline-none text-sm placeholder:text-muted-foreground/60 text-foreground p-1 resize-none overflow-hidden leading-5"
                      style={{ height: "20px" }}
                      disabled={isStreaming}
                    />
                    <Button
                      size="icon"
                      onClick={handleSend}
                      disabled={(!userInput.trim() && !pendingAttachment) || isStreaming || isUploading}
                      className="h-8 w-8 rounded-lg shrink-0"
                    >
                      <Send className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  {/* Secure channel indicator — sits flush below the input bar */}
                  <div className="flex items-center justify-center gap-1 pb-0.5">
                    <svg width="9" height="10" viewBox="0 0 9 10" fill="none" xmlns="http://www.w3.org/2000/svg" className="opacity-40">
                      <rect x="1" y="4" width="7" height="5.5" rx="1" fill="currentColor"/>
                      <path d="M2.5 4V3a2 2 0 0 1 4 0v1" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" fill="none"/>
                    </svg>
                    <span className="text-[10px] text-muted-foreground/50 tracking-wide">Secure channel · encrypted end-to-end</span>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </CardContent>
    </Card>

      {/* Completed sessions / moments from earlier — collapsible, below the active input */}
      {(() => {
        let sessionCount = 0;
        return completedDebriefs.map((d) => {
          const msgs2 = d.messages || [];
          const isMoment = !msgs2.some((m: any) => m.role === "assistant");
          if (!isMoment) sessionCount++;
          const isExpanded = expandedSessions.has(d.id);
          const userMsg = msgs2.find((m: any) => m.role === "user");
          const momentText = userMsg?.content || "";
          const momentPhoto = userMsg?.attachmentUrl;

          if (isMoment) {
            return (
              <Card key={d.id} className="border border-border/30 shadow-sm bg-card/60 overflow-hidden">
                <CardContent className="p-0">
                  <button
                    onClick={() => { haptic("select"); toggleSession(d.id); }}
                    className="w-full flex items-center gap-2 px-5 py-3 text-left"
                  >
                    <BookOpen className="h-3.5 w-3.5 text-primary/70 shrink-0" />
                    <span className="text-xs font-medium text-primary/70 shrink-0">
                      Moment · {formatMsgTime(d.createdAt)}
                    </span>
                    {momentText && !isExpanded && (
                      <span className="text-xs text-muted-foreground truncate flex-1 ml-1">{momentText}</span>
                    )}
                    {momentPhoto && !isExpanded && (
                      <Paperclip className="h-3 w-3 text-muted-foreground/50 shrink-0" />
                    )}
                    <span className="ml-auto shrink-0 flex items-center gap-1 text-[10px] text-muted-foreground">
                      {isExpanded ? "Hide" : "Show"}
                      <ChevronDown className={`h-3 w-3 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                    </span>
                  </button>
                  {isExpanded && (
                    <div className="px-5 pb-4 space-y-3 border-t border-border/30 pt-3">
                      {momentText && (
                        <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">{momentText}</p>
                      )}
                      {momentPhoto && (
                        <img
                          src={momentPhoto}
                          alt="Attached photo"
                          className="rounded-xl max-h-64 w-auto object-cover border border-border/30"
                        />
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          }

          return (
            <Card key={d.id} className="border border-border/30 shadow-sm bg-card/60 overflow-hidden">
              <CardContent className="p-0">
                <button
                  onClick={() => { haptic("select"); toggleSession(d.id); }}
                  className="w-full flex items-center gap-2 px-5 py-3 text-left"
                >
                  <CheckCircle className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                  <span className="text-xs font-medium text-muted-foreground shrink-0">
                    Session {sessionCount} · {formatMsgTime(d.createdAt)}
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
                      {(d.messages || []).map((msg: any) => (
                        <div key={msg.id} className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"}`}>
                          <div className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
                            msg.role === "user"
                              ? "bg-primary text-primary-foreground rounded-br-md"
                              : "bg-muted text-foreground rounded-bl-md"
                          }`}>
                            {msg.content}
                          </div>
                          {msg.attachmentUrl && msg.attachmentType === "image" && (
                            <img
                              src={msg.attachmentUrl}
                              alt="Attached photo"
                              className="mt-1.5 rounded-xl max-h-48 w-auto object-cover border border-border/30"
                            />
                          )}
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
        });
      })()}
    </div>
  );
}
