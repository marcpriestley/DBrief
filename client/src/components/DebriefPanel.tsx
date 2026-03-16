import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { MessageCircle, Send, CheckCircle, Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
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

export default function DebriefPanel({ selectedDate }: DebriefPanelProps) {
  const [userInput, setUserInput] = useState("");
  const [streamingContent, setStreamingContent] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: debrief, isLoading } = useQuery<Debrief | null>({
    queryKey: ["/api/debriefs", selectedDate],
    queryFn: async () => {
      const response = await fetch(`/api/debriefs/${selectedDate}`, { credentials: "include" });
      if (!response.ok) return null;
      const data = await response.json();
      return data;
    },
    staleTime: 5 * 60 * 1000,
  });

  const startDebriefMutation = useMutation({
    mutationFn: async (fresh?: boolean) => {
      const response = await apiRequest("POST", "/api/debriefs/start", { date: selectedDate, fresh: !!fresh });
      return response.json() as Promise<Debrief>;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/debriefs", selectedDate], data);
      queryClient.invalidateQueries({ queryKey: ["/api/dates-with-data"] });
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

  const handleSendMessage = async () => {
    if (!userInput.trim() || !debrief || isStreaming) return;

    const messageText = userInput.trim();
    setUserInput("");
    setIsStreaming(true);
    setStreamingContent("");

    const optimisticMsg: DebriefMessage = {
      id: Date.now(),
      debriefId: debrief.id,
      role: "user",
      content: messageText,
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
        body: JSON.stringify({ content: messageText }),
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
              if (data.done) {
                break;
              }
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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [debrief?.messages, streamingContent]);

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
                ? "A quick guided reflection on your day. Takes about 2 minutes."
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

  return (
    <Card className="border-0 shadow-md bg-gradient-to-br from-slate-50 to-white">
      <CardContent className="p-0">
        <div className="px-5 py-3 border-b border-border/50 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-sm font-medium text-foreground">Debrief in progress</span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => completeDebriefMutation.mutate(debrief.id)}
            disabled={completeDebriefMutation.isPending || debrief.messages.filter(m => m.role === "user").length < 1}
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

          <div ref={messagesEndRef} />
        </div>

        <div className="px-4 pb-4 pt-2">
          <div className="flex items-end gap-2 bg-muted/50 rounded-xl border border-border/50 p-2">
            <Textarea
              ref={textareaRef}
              value={userInput}
              onChange={(e) => setUserInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type your response..."
              className="min-h-[40px] max-h-[120px] resize-none border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 text-sm p-1"
              rows={1}
              disabled={isStreaming}
            />
            <Button
              size="icon"
              onClick={handleSendMessage}
              disabled={!userInput.trim() || isStreaming}
              className="h-8 w-8 rounded-lg shrink-0"
            >
              <Send className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
