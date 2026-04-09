import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { Check, Plus, X, Trash2, Edit2, PartyPopper } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiRequest } from "@/lib/queryClient";
import { haptic } from "@/lib/haptics";
import type { DailyGoal, GoalTemplate } from "@shared/schema";

interface GoalsSectionProps {
  selectedDate: string;
  tomorrowMode?: boolean;
}

const MIN_VISIBLE_SLOTS = 3;

function triggerHaptic() { haptic("medium"); }
function triggerCelebrationHaptic() { haptic("success"); }

export default function GoalsSection({ selectedDate, tomorrowMode = false }: GoalsSectionProps) {
  const queryClient = useQueryClient();
  const [showAddInput, setShowAddInput] = useState(false);
  const [newGoalTitle, setNewGoalTitle] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const editCancelledRef = useRef(false);
  const [placeholderValues, setPlaceholderValues] = useState<Record<number, string>>({});
  const [submittingPlaceholder, setSubmittingPlaceholder] = useState<number | null>(null);
  const [showCelebration, setShowCelebration] = useState(false);
  const [prevCompletedCount, setPrevCompletedCount] = useState<number>(-1);
  const addInputRef = useRef<HTMLInputElement>(null);

  const { data: goals = [], isLoading } = useQuery<DailyGoal[]>({
    queryKey: ["/api/daily-goals", selectedDate],
    queryFn: () => fetch(`/api/daily-goals/${selectedDate}`, { credentials: "include", cache: "no-store" }).then(r => r.json()),
  });

  const { data: templates = [] } = useQuery<GoalTemplate[]>({
    queryKey: ["/api/goal-templates"],
  });

  const completedCount = goals.filter(g => g.completed).length;
  const totalGoals = goals.length;
  const displayTotal = Math.max(MIN_VISIBLE_SLOTS, totalGoals);
  // allComplete drives the UI attention ring (requires MIN_VISIBLE_SLOTS for meaningful indicator)
  const allComplete = totalGoals >= MIN_VISIBLE_SLOTS && completedCount === totalGoals;
  // allGoalsComplete drives the celebration — fires for any number of goals ≥ 1
  const allGoalsComplete = totalGoals > 0 && completedCount === totalGoals;
  const blankSlotsNeeded = Math.max(0, MIN_VISIBLE_SLOTS - totalGoals);

  useEffect(() => {
    if (prevCompletedCount >= 0 && completedCount > prevCompletedCount && allGoalsComplete) {
      setShowCelebration(true);
      triggerCelebrationHaptic();
      setTimeout(() => setShowCelebration(false), 3000);
    }
    setPrevCompletedCount(completedCount);
  }, [completedCount, allGoalsComplete]);

  useEffect(() => {
    if (showAddInput && addInputRef.current) {
      addInputRef.current.focus();
    }
  }, [showAddInput]);

  const toggleMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/daily-goals/${id}/toggle`);
      return res.json();
    },
    onSuccess: () => {
      triggerHaptic();
      queryClient.invalidateQueries({ queryKey: ["/api/daily-goals", selectedDate] });
    },
  });

  const addTemplateMutation = useMutation({
    mutationFn: async (title: string) => {
      const res = await apiRequest("POST", "/api/goal-templates", { title, date: selectedDate });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/goal-templates"] });
      queryClient.invalidateQueries({ queryKey: ["/api/daily-goals", selectedDate] });
      setNewGoalTitle("");
      setShowAddInput(false);
      if (submittingPlaceholder !== null) {
        setPlaceholderValues(prev => {
          const next = { ...prev };
          delete next[submittingPlaceholder];
          return next;
        });
      }
      setSubmittingPlaceholder(null);
    },
    onError: () => {
      setSubmittingPlaceholder(null);
    },
  });

  const deleteTemplateMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/goal-templates/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/goal-templates"] });
      queryClient.invalidateQueries({ queryKey: ["/api/daily-goals", selectedDate] });
    },
  });

  const updateTemplateMutation = useMutation({
    mutationFn: async ({ id, title }: { id: number; title: string }) => {
      const res = await apiRequest("PUT", `/api/goal-templates/${id}`, { title });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/goal-templates"] });
      queryClient.invalidateQueries({ queryKey: ["/api/daily-goals", selectedDate] });
      setEditingId(null);
    },
  });

  const handleEditKeyDown = (e: React.KeyboardEvent, templateId: number) => {
    if (e.key === "Enter") {
      e.preventDefault();
      (e.target as HTMLElement).blur(); // save is handled by onBlur
    }
    if (e.key === "Escape") {
      editCancelledRef.current = true; // tell onBlur not to save
      setEditingId(null);
    }
  };

  const handleAddGoal = () => {
    if (!newGoalTitle.trim()) return;
    addTemplateMutation.mutate(newGoalTitle.trim());
  };

  const handlePlaceholderSubmit = (slotIndex: number) => {
    const title = placeholderValues[slotIndex]?.trim();
    if (!title || submittingPlaceholder === slotIndex || addTemplateMutation.isPending) return;
    setSubmittingPlaceholder(slotIndex);
    addTemplateMutation.mutate(title);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleAddGoal();
    if (e.key === "Escape") { setShowAddInput(false); setNewGoalTitle(""); }
  };

  const handlePlaceholderKeyDown = (e: React.KeyboardEvent, slotIndex: number) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handlePlaceholderSubmit(slotIndex);
    }
    if (e.key === "Escape") {
      setPlaceholderValues(prev => {
        const next = { ...prev };
        delete next[slotIndex];
        return next;
      });
    }
  };

  const confettiColors = ["#F59E0B", "#10B981", "#8B5CF6", "#EC4899", "#3B82F6", "#EF4444"];

  return (
    <div className="relative">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          {tomorrowMode ? "Tomorrow's Goals" : "Today's Goals"}
          <span className="text-xs font-normal text-muted-foreground">
            {completedCount}/{displayTotal}
          </span>
        </h3>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowAddInput(true)}
          className="text-primary"
        >
          <Plus className="h-4 w-4 mr-1" />
          Add
        </Button>
      </div>

      <div className="w-full bg-muted rounded-full h-1 mb-3">
        <motion.div
          className="h-1 rounded-full bg-primary"
          initial={{ width: 0 }}
          animate={{ width: `${(completedCount / displayTotal) * 100}%` }}
          transition={{ duration: 0.3 }}
        />
      </div>

      <div className="space-y-2">
        {goals.map((goal, index) => {
          const isEditing = editingId === goal.goalTemplateId;
          return (
            <motion.div
              key={goal.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
              className={`group flex items-center gap-3 p-2.5 rounded-lg border transition-all ${
                goal.completed
                  ? "bg-primary/8 border-primary/20 opacity-70"
                  : "bg-card border-border/60 hover:border-border"
              }`}
            >
              <button
                onClick={() => toggleMutation.mutate(goal.id)}
                className={`flex-shrink-0 w-7 h-7 rounded-full border-2 flex items-center justify-center transition-all touch-manipulation ${
                  goal.completed
                    ? "bg-primary border-primary"
                    : "border-border hover:border-primary"
                }`}
              >
                <AnimatePresence>
                  {goal.completed && (
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      exit={{ scale: 0 }}
                    >
                      <Check className="h-3.5 w-3.5 text-white" />
                    </motion.div>
                  )}
                </AnimatePresence>
              </button>

              {isEditing ? (
                <Input
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  onKeyDown={(e) => handleEditKeyDown(e, goal.goalTemplateId)}
                  onBlur={() => {
                    if (editCancelledRef.current) {
                      editCancelledRef.current = false;
                      return;
                    }
                    const trimmed = editTitle.trim();
                    if (trimmed) {
                      updateTemplateMutation.mutate({ id: goal.goalTemplateId, title: trimmed });
                    } else {
                      setEditingId(null);
                    }
                  }}
                  className="flex-1 h-8 text-sm"
                  autoFocus
                />
              ) : (
                <span
                  className={`flex-1 text-sm ${
                    goal.completed ? "line-through text-muted-foreground" : "text-foreground"
                  }`}
                  onDoubleClick={() => {
                    setEditingId(goal.goalTemplateId);
                    setEditTitle(goal.title);
                  }}
                >
                  {goal.title}
                </span>
              )}

              {!isEditing && (
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => {
                      setEditingId(goal.goalTemplateId);
                      setEditTitle(goal.title);
                    }}
                    className="p-1 text-muted-foreground/40 hover:text-foreground"
                  >
                    <Edit2 className="h-3 w-3" />
                  </button>
                  <button
                    onClick={() => deleteTemplateMutation.mutate(goal.goalTemplateId)}
                    className="p-1 text-muted-foreground/40 hover:text-destructive"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              )}
            </motion.div>
          );
        })}

        {!isLoading && Array.from({ length: blankSlotsNeeded }).map((_, i) => (
          <motion.div
            key={`placeholder-${i}`}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: (totalGoals + i) * 0.05 }}
            className="flex items-center gap-3 p-2.5 rounded-lg border border-dashed border-border/50 bg-muted/30"
          >
            <div className="flex-shrink-0 w-7 h-7 rounded-full border-2 border-border/40" />
            <Input
              value={placeholderValues[i] || ""}
              onChange={(e) => setPlaceholderValues(prev => ({ ...prev, [i]: e.target.value }))}
              onKeyDown={(e) => handlePlaceholderKeyDown(e, i)}
              disabled={submittingPlaceholder === i}
              placeholder={`Add goal ${totalGoals + i + 1}...`}
              className="flex-1 h-7 text-sm border-none bg-transparent shadow-none focus-visible:ring-0 placeholder:text-muted-foreground/40"
            />
            {placeholderValues[i]?.trim() && (
              <button
                onClick={() => handlePlaceholderSubmit(i)}
                disabled={submittingPlaceholder === i}
                className="flex-shrink-0 w-7 h-7 rounded-full bg-primary flex items-center justify-center disabled:opacity-50"
              >
                <Check className="h-3.5 w-3.5 text-white" />
              </button>
            )}
          </motion.div>
        ))}

        {isLoading && (
          <div className="text-center py-4 text-muted-foreground text-sm">Loading goals...</div>
        )}
      </div>

      <AnimatePresence>
        {showAddInput && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-3 flex items-center gap-2"
          >
            <Input
              ref={addInputRef}
              value={newGoalTitle}
              onChange={(e) => setNewGoalTitle(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Enter a new goal..."
              className="flex-1 h-9 text-sm"
            />
            <Button
              size="sm"
              onClick={handleAddGoal}
              disabled={!newGoalTitle.trim() || addTemplateMutation.isPending}
              className="h-9"
            >
              Add
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setShowAddInput(false); setNewGoalTitle(""); }}
              className="h-9 px-2"
            >
              <X className="h-4 w-4" />
            </Button>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showCelebration && (
          <motion.div
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.5 }}
            className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none"
          >
            <div className="relative">
              {confettiColors.map((color, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 1, x: 0, y: 0, scale: 1 }}
                  animate={{
                    opacity: 0,
                    x: Math.cos((i / confettiColors.length) * Math.PI * 2) * 150,
                    y: Math.sin((i / confettiColors.length) * Math.PI * 2) * 150 - 50,
                    scale: 0.5,
                    rotate: Math.random() * 360,
                  }}
                  transition={{ duration: 1.5, delay: i * 0.05 }}
                  className="absolute w-3 h-3 rounded-full"
                  style={{ backgroundColor: color, left: "50%", top: "50%" }}
                />
              ))}
              {confettiColors.map((color, i) => (
                <motion.div
                  key={`s-${i}`}
                  initial={{ opacity: 1, x: 0, y: 0, scale: 1 }}
                  animate={{
                    opacity: 0,
                    x: Math.cos(((i + 0.5) / confettiColors.length) * Math.PI * 2) * 100,
                    y: Math.sin(((i + 0.5) / confettiColors.length) * Math.PI * 2) * 100 - 30,
                    scale: 0.3,
                    rotate: Math.random() * 720,
                  }}
                  transition={{ duration: 1.2, delay: i * 0.08 }}
                  className="absolute w-2 h-4"
                  style={{ backgroundColor: color, left: "50%", top: "50%", borderRadius: "1px" }}
                />
              ))}
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: [0, 1.3, 1] }}
                transition={{ duration: 0.5 }}
                className="bg-card shadow-xl rounded-2xl p-6 text-center border border-border"
              >
                <PartyPopper className="h-12 w-12 text-primary mx-auto mb-2" />
                <p className="text-lg font-bold text-foreground">All Goals Complete!</p>
                <p className="text-sm text-muted-foreground mt-1">Session complete. Outstanding execution.</p>
              </motion.div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
