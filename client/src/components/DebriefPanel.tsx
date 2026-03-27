import { useState, useEffect, useRef, useCallback } from "react";
import { haptic } from "@/lib/haptics";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { MessageCircle, Send, CheckCircle, Loader2, RotateCcw, Mic, MicOff, ArrowRight, Volume2, VolumeX, Square, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { motion, AnimatePresence } from "framer-motion";
import { Capacitor } from "@capacitor/core";
import { openAppSettings } from "@/hooks/useNativeNotifications";
import { useTTS } from "@/hooks/useTTS";

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
    };

    recognition.onerror = (e: any) => {
      if (e.error === "aborted" || e.error === "no-speech") return;
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
    async (onFinal: (text: string) => void) => {
      if (!isSupported) return;

      accumulatedRef.current = "";
      onFinalRef.current = onFinal;

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
          });
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

  useEffect(() => {
    return () => {
      shouldListenRef.current = false;
      if (watchdogRef.current) clearInterval(watchdogRef.current);
      if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
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
  const [continuedPastCheckpoint, setContinuedPastCheckpoint] = useState(false);
  const [actionNotifications, setActionNotifications] = useState<Array<{ type: string; message: string; success: boolean; id: number }>>([]);
  const [showAllMessages, setShowAllMessages] = useState(false);

  const VISIBLE_MESSAGES = 6;
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const debriefCardRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const hasMountedRef = useRef(false);
  const focusMountedRef = useRef(false);
  const prevMessageCountRef = useRef(0);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const voice = useInlineVoice();
  const tts = useTTS();

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

  const startDebriefMutation = useMutation({
    mutationFn: async (opts: { fresh?: boolean; userLed?: boolean } = {}) => {
      const response = await apiRequest("POST", "/api/debriefs/start", { date: selectedDate, fresh: !!opts.fresh, userLed: !!opts.userLed });
      return response.json() as Promise<Debrief>;
    },
    onSuccess: () => {
      // Always re-fetch from server so all sessions (including previous ones) are in the list
      queryClient.invalidateQueries({ queryKey: ["/api/debriefs", selectedDate] });
      queryClient.invalidateQueries({ queryKey: ["/api/dates-with-data"] });
      setContinuedPastCheckpoint(false);
    },
    onError: () => {
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
    },
  });

  const sendMessage = async (text: string) => {
    if (!text.trim() || !debrief || isStreaming) return;

    setUserInput("");
    setIsStreaming(true);
    setStreamingContent("");

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
              }
              if (data.actions) {
                const newNotifications = data.actions.map((a: any, i: number) => ({
                  id: Date.now() + i,
                  type: a.type,
                  message: a.message,
                  success: a.success,
                }));
                setActionNotifications(prev => [...prev, ...newNotifications]);
                if (data.actions.some((a: any) => a.type === "add_daily_goal" && a.success)) {
                  queryClient.invalidateQueries({ queryKey: ["/api/goal-templates"] });
                  queryClient.invalidateQueries({ queryKey: ["/api/daily-goals"] });
                }
                if (data.actions.some((a: any) => a.type === "add_long_term_goal" && a.success)) {
                  queryClient.invalidateQueries({ queryKey: ["/api/long-term-goals"] });
                }
              }
            } catch {}
          }
        }
      }

      queryClient.invalidateQueries({ queryKey: ["/api/debriefs", selectedDate] });
      if (accumulated) tts.speak(accumulated);
    } catch {
      toast({ title: "Error", description: "Failed to send message. Try again.", variant: "destructive" });
    } finally {
      setIsStreaming(false);
      setStreamingContent("");
    }
  };

  const handleSend = () => {
    const textToSend = userInput.trim();
    if (!textToSend) return;
    // Auto-stop mic before sending so the recording never blocks the next state
    if (voice.isListening) voice.stop();
    haptic("medium");
    if (showCheckpoint) setContinuedPastCheckpoint(true);
    sendMessage(textToSend);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSend();
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
      });
    }
  };

  const handleContinue = () => {
    setContinuedPastCheckpoint(true);
  };

  const handleWrapUp = () => {
    if (debrief) {
      completeDebriefMutation.mutate(debrief.id);
    }
  };

  const currentMessageCount = debrief?.messages?.length ?? 0;

  useEffect(() => {
    // Always scroll the chat container to its bottom internally
    const container = chatContainerRef.current;
    if (container) {
      container.scrollTop = container.scrollHeight;
    }

    // On the very first data load don't scroll the page at all — the dashboard
    // already starts at the top. Only scroll the page when a brand new message
    // actually arrives after mount.
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      prevMessageCountRef.current = currentMessageCount;
      return;
    }

    const isNewMessage = currentMessageCount > prevMessageCountRef.current;
    prevMessageCountRef.current = currentMessageCount;

    if (isNewMessage && debriefCardRef.current) {
      // Bring the top of the debrief card to the top of the viewport so the
      // AI response is immediately visible without the user having to scroll.
      debriefCardRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [debrief?.messages, streamingContent, showCheckpoint, currentMessageCount]);

  useEffect(() => {
    if (!focusMountedRef.current) {
      focusMountedRef.current = true;
      return;
    }
    if (!voice.isListening && !isStreaming) {
      inputRef.current?.focus({ preventScroll: true });
    }
  }, [voice.isListening, isStreaming]);

  useEffect(() => {
    setShowAllMessages(false);
  }, [selectedDate]);

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
            <div className="flex items-center justify-center gap-3">
              <Button
                onClick={() => startDebriefMutation.mutate({ fresh: false, userLed: true })}
                disabled={startDebriefMutation.isPending}
                variant="outline"
                className="flex-1 max-w-[160px]"
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
                onClick={() => startDebriefMutation.mutate({ fresh: false })}
                disabled={startDebriefMutation.isPending}
                className="flex-1 max-w-[160px]"
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

  // All debriefs complete — show full history + start new button
  if (!debrief && completedDebriefs.length > 0) {
    const latestSession = completedDebriefs[completedDebriefs.length - 1];
    const sessionText = latestSession?.messages
      .filter(m => m.role === "assistant")
      .map(m => m.content)
      .join(" ");

    return (
      <Card className="border border-border/50 shadow-sm bg-card">
        <CardContent className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <CheckCircle className="h-5 w-5 text-emerald-500" />
            <h3 className="text-lg font-semibold text-foreground">
              {completedDebriefs.length === 1 ? "Debrief Complete" : `${completedDebriefs.length} Sessions`}
            </h3>
            <div className="flex items-center gap-1 ml-auto">
              {tts.isSupported && sessionText && (
                <Button
                  variant="ghost"
                  size="icon"
                  className={`h-7 w-7 ${tts.speaking ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
                  onClick={() => tts.speaking ? tts.cancel() : tts.speak(sessionText)}
                  title={tts.speaking ? "Stop" : "Listen to debrief"}
                >
                  {tts.speaking
                    ? <Square className="h-3.5 w-3.5 fill-current" />
                    : <Volume2 className="h-3.5 w-3.5" />
                  }
                </Button>
              )}
              <span className="text-xs text-muted-foreground">{dateLabel}</span>
            </div>
          </div>

          <div className="space-y-4">
            {completedDebriefs.map((d, idx) => (
              <div key={d.id} className={completedDebriefs.length > 1 ? "pb-4 border-b border-border/50 last:border-0 last:pb-0" : ""}>
                {completedDebriefs.length > 1 && (
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                    Session {idx + 1}
                  </p>
                )}
                {d.summary && (
                  <p className="text-sm text-muted-foreground italic leading-relaxed">
                    {d.summary}
                  </p>
                )}
                {d.messages.length > 0 && (
                  <>
                    <button
                      onClick={() => setShowAllMessages(v => !v)}
                      className="flex items-center gap-1.5 mt-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showAllMessages ? "rotate-180" : ""}`} />
                      {showAllMessages ? "Hide transcript" : `Show transcript (${d.messages.length} messages)`}
                    </button>
                    {showAllMessages && (
                      <div className="space-y-2 mt-3 max-h-[400px] overflow-y-auto">
                        {d.messages.map((msg) => (
                          <div key={msg.id} className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"}`}>
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
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>

          <div className="mt-4 pt-3 border-t border-border">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => startDebriefMutation.mutate({ fresh: true })}
              disabled={startDebriefMutation.isPending}
              className="text-muted-foreground hover:text-foreground"
            >
              {startDebriefMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              ) : (
                <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
              )}
              Start New Session
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const displayInput = voice.isListening && voice.interimText
    ? userInput + (userInput ? " " : "") + voice.interimText
    : userInput;

  const progressDots = Math.min(userMessageCount, CORE_EXCHANGES);

  return (
    <div className="space-y-3">
      {/* Completed sessions from earlier in the day — collapsed summaries */}
      {completedDebriefs.map((d, idx) => (
        <Card key={d.id} className="border border-border/30 shadow-sm bg-card/60">
          <CardContent className="px-5 py-3">
            <div className="flex items-center gap-2 mb-1.5">
              <CheckCircle className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
              <span className="text-xs font-medium text-muted-foreground">
                Session {idx + 1} — {formatMsgTime(d.createdAt)}
              </span>
            </div>
            {d.summary && (
              <p className="text-xs text-muted-foreground italic leading-relaxed">{d.summary}</p>
            )}
          </CardContent>
        </Card>
      ))}

    <Card ref={debriefCardRef} className="border border-border/50 shadow-sm bg-card">
      <CardContent className="p-0">
        <div className="px-5 py-3 border-b border-border/50 flex items-center justify-between">
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
            {tts.isSupported && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => { haptic("select"); tts.toggle(); }}
                className={`h-7 w-7 p-0 ${tts.enabled ? "text-primary" : "text-muted-foreground"}`}
                title={tts.enabled ? "Voice readback on" : "Voice readback off"}
              >
                {tts.enabled ? (
                  <Volume2 className={`h-3.5 w-3.5 ${tts.speaking ? "animate-pulse" : ""}`} />
                ) : (
                  <VolumeX className="h-3.5 w-3.5" />
                )}
              </Button>
            )}
            {userMessageCount >= 1 && !showCheckpoint && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => completeDebriefMutation.mutate(debrief.id)}
                disabled={completeDebriefMutation.isPending}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                {completeDebriefMutation.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <>
                    <CheckCircle className="h-3.5 w-3.5 mr-1" />
                    Finish
                  </>
                )}
              </Button>
            )}
          </div>
        </div>

        <div ref={chatContainerRef} className="px-5 py-4 space-y-3 max-h-[350px] overflow-y-auto">
          {debrief.messages.length === 0 && !isStreaming && (
            <p className="text-sm text-muted-foreground text-center py-4">
              Your session, your opening. What's on your mind?
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

        <div className="px-4 pb-4 pt-2">
          {voice.isListening && (
            <div className="flex items-center gap-2 mb-2 px-2">
              <div className="flex items-center gap-1">
                <span className="w-1 h-3 bg-red-500 rounded-full animate-pulse" />
                <span className="w-1 h-4 bg-red-500 rounded-full animate-pulse" style={{ animationDelay: "150ms" }} />
                <span className="w-1 h-2.5 bg-red-500 rounded-full animate-pulse" style={{ animationDelay: "300ms" }} />
                <span className="w-1 h-3.5 bg-red-500 rounded-full animate-pulse" style={{ animationDelay: "100ms" }} />
              </div>
              <span className="text-xs text-red-500 font-medium">Listening...</span>
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
          <div className="flex items-center gap-2 bg-muted/50 rounded-xl border border-border/50 p-2">
            {voice.isSupported && (
              <button
                onClick={handleMicToggle}
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
            <input
              ref={inputRef}
              type="text"
              value={displayInput}
              onChange={(e) => setUserInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={voice.isListening ? "Listening — speak freely..." : "Type or tap the mic to talk..."}
              className="flex-1 min-w-0 bg-transparent border-0 outline-none text-sm placeholder:text-muted-foreground/60 text-foreground p-1"
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
        </div>
      </CardContent>
    </Card>
    </div>
  );
}
