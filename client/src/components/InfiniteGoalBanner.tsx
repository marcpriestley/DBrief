import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { Compass, Sparkles, X, ArrowRight, Loader2, Edit2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface InfiniteGoal {
  id: number;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export default function InfiniteGoalBanner() {
  const [isSetupOpen, setIsSetupOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [input, setInput] = useState("");
  const [aiSuggestion, setAiSuggestion] = useState<string | null>(null);
  const [conversationStep, setConversationStep] = useState<"initial" | "refining" | "confirming">("initial");

  const { data: infiniteGoal, isLoading } = useQuery<InfiniteGoal | null>({
    queryKey: ["/api/infinite-goal"],
  });

  const saveMutation = useMutation({
    mutationFn: async (content: string) => {
      const res = await apiRequest("POST", "/api/infinite-goal", { content });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/infinite-goal"] });
      setIsSetupOpen(false);
      setIsEditing(false);
      setInput("");
      setAiSuggestion(null);
      setConversationStep("initial");
    },
  });

  const aiAssistMutation = useMutation({
    mutationFn: async (userInput: string) => {
      const res = await apiRequest("POST", "/api/infinite-goal/ai-assist", { input: userInput });
      return res.json();
    },
    onSuccess: (data) => {
      const suggestion = data.suggestion;
      if (suggestion.includes("?")) {
        setAiSuggestion(suggestion);
        setConversationStep("refining");
      } else {
        setAiSuggestion(suggestion);
        setConversationStep("confirming");
      }
    },
  });

  const handleAiAssist = () => {
    aiAssistMutation.mutate(input || "Help me figure out my infinite goal");
  };

  const handleAcceptSuggestion = () => {
    if (aiSuggestion) {
      saveMutation.mutate(aiSuggestion);
    }
  };

  const handleSaveCustom = () => {
    if (input.trim()) {
      saveMutation.mutate(input.trim());
    }
  };

  if (isLoading) return null;

  if (infiniteGoal && !isEditing) {
    return (
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <div className="bg-card/70 backdrop-blur-sm border border-primary/30 rounded-2xl px-5 py-4 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
              <Compass className="h-4 w-4 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-medium uppercase tracking-wider text-primary/60 mb-0.5">Infinite Goal</p>
              <p className="text-base font-medium text-foreground leading-snug">{infiniteGoal.content}</p>
            </div>
            <button
              onClick={() => {
                setIsEditing(true);
                setInput(infiniteGoal.content);
                setIsSetupOpen(true);
              }}
              className="p-1.5 text-muted-foreground/50 hover:text-foreground transition-colors"
            >
              <Edit2 className="h-3 w-3" />
            </button>
          </div>
        </div>
      </motion.div>
    );
  }

  if (!infiniteGoal && !isSetupOpen) {
    return (
      <motion.button
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        onClick={() => setIsSetupOpen(true)}
        className="w-full text-left bg-card/70 backdrop-blur-sm border border-dashed border-primary/30 rounded-xl px-4 py-3 hover:border-primary/50 hover:bg-primary/5 transition-all"
      >
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <Compass className="h-3.5 w-3.5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground">Set your infinite goal</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              The overarching target that drives everything you do — like an F1 team chasing perfection.
            </p>
          </div>
          <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
        </div>
      </motion.button>
    );
  }

  return (
    <AnimatePresence>
      {isSetupOpen && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          className="bg-card border border-border/50 rounded-xl p-4 shadow-sm"
        >
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Compass className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold text-foreground">
                {isEditing ? "Edit your infinite goal" : "Define your infinite goal"}
              </h3>
            </div>
            <button
              onClick={() => {
                setIsSetupOpen(false);
                setIsEditing(false);
                setInput("");
                setAiSuggestion(null);
                setConversationStep("initial");
              }}
              className="p-1 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <p className="text-xs text-muted-foreground mb-3 leading-relaxed">
            Your infinite goal is a direction, not a destination. Something you can always strive toward but never fully complete. It's the north star behind every lap you run.
          </p>

          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={"e.g. \"Continuously push the limits of what I'm capable of\" or \"Master the balance between intensity and recovery\""}
            className="min-h-[60px] text-sm resize-none mb-3"
            rows={2}
          />

          {aiSuggestion && (
            <motion.div
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-primary/5 border border-primary/15 rounded-lg p-3 mb-3"
            >
              <p className="text-xs text-primary/60 font-medium mb-1">
                {conversationStep === "refining" ? "AI follow-up" : "Suggested infinite goal"}
              </p>
              <p className="text-sm text-foreground">{aiSuggestion}</p>
              {conversationStep === "confirming" && (
                <div className="flex gap-2 mt-2">
                  <Button
                    size="sm"
                    onClick={handleAcceptSuggestion}
                    disabled={saveMutation.isPending}
                    className="h-7 text-xs"
                  >
                    {saveMutation.isPending ? "Saving..." : "Use this"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setInput(aiSuggestion);
                      setAiSuggestion(null);
                      setConversationStep("initial");
                    }}
                    className="h-7 text-xs"
                  >
                    Edit it
                  </Button>
                </div>
              )}
            </motion.div>
          )}

          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={handleAiAssist}
              disabled={aiAssistMutation.isPending}
              className="h-8 text-xs gap-1.5"
            >
              {aiAssistMutation.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Sparkles className="h-3 w-3" />
              )}
              {input.trim() ? "Refine with AI" : "Help me find it"}
            </Button>
            {input.trim() && (
              <Button
                size="sm"
                onClick={handleSaveCustom}
                disabled={saveMutation.isPending}
                className="h-8 text-xs"
              >
                {saveMutation.isPending ? "Saving..." : "Save as is"}
              </Button>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
