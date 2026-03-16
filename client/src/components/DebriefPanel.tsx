import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { MessageCircle, Send, CheckCircle, Loader2, RotateCcw, Mic, MicOff, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { motion, AnimatePresence } from "framer-motion";

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

function useInlineVoice() {
  const [isListening, setIsListening] = useState(false);
  const [interimText, setInterimText] = useState("");
  const recognitionRef = useRef<any>(null);
  const accumulatedRef = useRef("");

  const isSupported =
    typeof window !== "undefined" &&
    ("webkitSpeechRecognition" in window || "SpeechRecognition" in window);

  const start = useCallback(
    (onFinal: (text: string) => void) => {
      if (!isSupported) return;
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      const recognition = new SR();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = "en-US";

      accumulatedRef.current = "";

      recognition.onstart = () => setIsListening(true);

      recognition.onresult = (e: any) => {
        let finalChunk = "";
        let interim = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const t = e.results[i][0].transcript;
          if (e.results[i].isFinal) {
            finalChunk += t;
          } else {
            interim += t;
          }
        }
        if (finalChunk) {
          accumulatedRef.current += (accumulatedRef.current ? " " : "") + finalChunk.trim();
          onFinal(accumulatedRef.current);
        }
        setInterimText(interim);
      };

      recognition.onerror = () => setIsListening(false);
      recognition.onend = () => {
        setIsListening(false);
        setInterimText("");
      };

      recognitionRef.current = recognition;
      try {
        recognition.start();
      } catch {}
    },
    [isSupported],
  );

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
    setInterimText("");
  }, []);

  return { isListening, interimText, isSupported, start, stop };
}

export default function DebriefPanel({ selectedDate }: DebriefPanelProps) {
  const [userInput, setUserInput] = useState("");
  const [streamingContent, setStreamingContent] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [continuedPastCheckpoint, setContinuedPastCheckpoint] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const voice = useInlineVoice();

  const { data: debrief, isLoading } = useQuery<Debrief | null>({
    queryKey: ["/api/debriefs", selectedDate],
    queryFn: async () => {
      const response = await fetch(`/api/debriefs/${selectedDate}`, { credentials: "include" });
      if (!response.ok) return null;
      return response.json();
    },
    staleTime: 5 * 60 * 1000,
  });

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
    mutationFn: async (fresh?: boolean) => {
      const response = await apiRequest("POST", "/api/debriefs/start", { date: selectedDate, fresh: !!fresh });
      return response.json() as Promise<Debrief>;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/debriefs", selectedDate], data);
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

    const optimisticMsg: DebriefMessage = {
      id: Date.now(),
      debriefId: debrief.id,
      role: "user",
      content: text.trim(),
      createdAt: new Date().toISOString(),
    };

    queryClient.setQueryData(["/api/debriefs", selectedDate], (old: Debrief | null) => {
      if (!old) return old;
      return { ...old, messages: [...old.messages, optimisticMsg] };
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
            } catch {}
          }
        }
      }

      queryClient.invalidateQueries({ queryKey: ["/api/debriefs", selectedDate] });
    } catch {
      toast({ title: "Error", description: "Failed to send message. Try again.", variant: "destructive" });
    } finally {
      setIsStreaming(false);
      setStreamingContent("");
    }
  };

  const handleSend = () => sendMessage(userInput);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSend();
    }
  };

  const handleMicToggle = () => {
    if (voice.isListening) {
      voice.stop();
    } else {
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

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [debrief?.messages, streamingContent, showCheckpoint]);

  useEffect(() => {
    if (!voice.isListening && !isStreaming && !showCheckpoint) {
      inputRef.current?.focus();
    }
  }, [voice.isListening, isStreaming, debrief?.messages, showCheckpoint]);

  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const isToday = selectedDate === todayStr;
  const dateLabel = isToday ? "Today" : new Date(selectedDate + "T12:00:00").toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

  if (isLoading) {
    return (
      <Card className="border-0 shadow-md bg-gradient-to-br from-slate-50 to-white">
        <CardContent className="p-6 flex items-center justify-center min-h-[200px]">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (!debrief) {
    return (
      <Card className="border-0 shadow-md bg-gradient-to-br from-slate-50 to-white overflow-hidden">
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
                ? "Three quick prompts to reflect on your day. Talk or type — whatever feels natural."
                : "Reflect on this day with a guided conversation."
              }
            </p>
            <Button
              onClick={() => startDebriefMutation.mutate()}
              disabled={startDebriefMutation.isPending}
              className="px-6"
            >
              {startDebriefMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Starting...
                </>
              ) : (
                <>
                  <MessageCircle className="h-4 w-4 mr-2" />
                  Start Debrief
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (debrief.isComplete) {
    return (
      <Card className="border-0 shadow-md bg-gradient-to-br from-slate-50 to-white">
        <CardContent className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <CheckCircle className="h-5 w-5 text-emerald-500" />
            <h3 className="text-lg font-semibold text-foreground">Debrief Complete</h3>
            <span className="text-xs text-muted-foreground ml-auto">{dateLabel}</span>
          </div>

          {debrief.summary && (
            <p className="text-sm text-muted-foreground mb-4 italic leading-relaxed">
              {debrief.summary}
            </p>
          )}

          <div className="space-y-3 max-h-[400px] overflow-y-auto">
            {debrief.messages.map((msg) => (
              <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground rounded-br-md"
                    : "bg-muted text-foreground rounded-bl-md"
                }`}>
                  {msg.content}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 pt-3 border-t border-border">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => startDebriefMutation.mutate(true)}
              disabled={startDebriefMutation.isPending}
              className="text-muted-foreground hover:text-foreground"
            >
              <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
              New Debrief
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
    <Card className="border-0 shadow-md bg-gradient-to-br from-slate-50 to-white">
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

        <div className="px-5 py-4 space-y-3 max-h-[350px] overflow-y-auto">
          <AnimatePresence initial={false}>
            {debrief.messages.map((msg) => (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 }}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground rounded-br-md"
                    : "bg-muted text-foreground rounded-bl-md"
                }`}>
                  {msg.content}
                </div>
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

          <div ref={messagesEndRef} />
        </div>

        {!showCheckpoint && (
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
            <p className="text-[10px] text-muted-foreground/50 text-center mt-1.5">
              Press Enter to send
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
