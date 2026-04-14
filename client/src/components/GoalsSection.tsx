import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence, useMotionValue, useTransform } from "framer-motion";
import { Check, Plus, X, Trash2, Edit2 } from "lucide-react";
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

const GOAL_MESSAGES = [
  { icon: "⚡", text: "Sector cleared." },
  { icon: "🏎", text: "Clean execution." },
  { icon: "🏁", text: "Point scored." },
  { icon: "💨", text: "On pace." },
  { icon: "🔥", text: "Locked in." },
  { icon: "✅", text: "Gap closed." },
  { icon: "🎯", text: "Direct hit." },
  { icon: "⬆️", text: "Position gained." },
];

const ALL_COMPLETE_MESSAGES = [
  { icon: "🏆", title: "All Goals Complete!", sub: "Session complete. Outstanding execution." },
  { icon: "🏁", title: "Chequered Flag!", sub: "Full points haul. Race pace confirmed." },
  { icon: "🥇", title: "Perfect Score!", sub: "P1 performance. Zero dropped objectives." },
  { icon: "⚡", title: "Clean Sheet!", sub: "All sectors green. Maximum output delivered." },
];

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
  const addInputRef = useRef<HTMLInputElement>(null);

  // Per-goal reward toast
  const [goalToast, setGoalToast] = useState<{ icon: string; text: string } | null>(null);
  const goalToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // All-goals celebration
  const [showCelebration, setShowCelebration] = useState(false);
  const [celebrationMsg, setCelebrationMsg] = useState(ALL_COMPLETE_MESSAGES[0]);
  const celebrationY = useMotionValue(0);
  const celebrationOpacity = useTransform(celebrationY, [-120, 0], [0, 1]);
  const prevCompletedCountRef = useRef<number>(-1);
  const prevTotalRef = useRef<number>(0);
  // Tracks whether goals data has finished its first load — prevents false
  // celebration fires when already-complete goals load in on mount/reopen.
  const initialLoadSettledRef = useRef<boolean>(false);

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
  const allComplete = totalGoals >= MIN_VISIBLE_SLOTS && completedCount === totalGoals;
  const allGoalsComplete = totalGoals > 0 && completedCount === totalGoals;
  const blankSlotsNeeded = Math.max(0, MIN_VISIBLE_SLOTS - totalGoals);

  // Fire per-goal reward when any single goal is newly completed
  const showGoalReward = () => {
    const msg = GOAL_MESSAGES[Math.floor(Math.random() * GOAL_MESSAGES.length)];
    if (goalToastTimerRef.current) clearTimeout(goalToastTimerRef.current);
    setGoalToast(msg);
    goalToastTimerRef.current = setTimeout(() => setGoalToast(null), 1800);
  };

  // Mark initial load as settled once goals data arrives so we don't fire on remount
  useEffect(() => {
    if (!isLoading) {
      // Sync refs to current values without triggering celebration
      prevCompletedCountRef.current = completedCount;
      prevTotalRef.current = totalGoals;
      initialLoadSettledRef.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);

  // Fire all-complete celebration when everything is done
  useEffect(() => {
    if (!initialLoadSettledRef.current) return;

    const prev = prevCompletedCountRef.current;
    prevCompletedCountRef.current = completedCount;
    prevTotalRef.current = totalGoals;

    if (prev >= 0 && completedCount > prev) {
      // Always reward any individual completion
      showGoalReward();
      triggerHaptic();

      // Big celebration only when the user ticks the very last goal,
      // and only if we haven't already shown it for this date this session.
      const celebratedKey = `dbrief_goals_celebrated_${selectedDate}`;
      const alreadyCelebrated = localStorage.getItem(celebratedKey) === "1";
      if (allGoalsComplete && totalGoals > 0 && !alreadyCelebrated) {
        localStorage.setItem(celebratedKey, "1");
        const msg = ALL_COMPLETE_MESSAGES[Math.floor(Math.random() * ALL_COMPLETE_MESSAGES.length)];
        setCelebrationMsg(msg);
        setTimeout(() => {
          triggerCelebrationHaptic();
          setShowCelebration(true);
        }, 600);
      }
    }
  }, [completedCount, allGoalsComplete, totalGoals, selectedDate]);

  useEffect(() => {
    if (showAddInput && addInputRef.current) addInputRef.current.focus();
  }, [showAddInput]);

  const toggleMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/daily-goals/${id}/toggle`);
      return res.json();
    },
    onSuccess: () => {
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
        setPlaceholderValues(prev => { const next = { ...prev }; delete next[submittingPlaceholder]; return next; });
      }
      setSubmittingPlaceholder(null);
    },
    onError: () => { setSubmittingPlaceholder(null); },
  });

  const deleteTemplateMutation = useMutation({
    mutationFn: async (id: number) => { await apiRequest("DELETE", `/api/goal-templates/${id}`); },
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
    if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLElement).blur(); }
    if (e.key === "Escape") { editCancelledRef.current = true; setEditingId(null); }
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
    if (e.key === "Enter") { e.preventDefault(); handlePlaceholderSubmit(slotIndex); }
    if (e.key === "Escape") {
      setPlaceholderValues(prev => { const next = { ...prev }; delete next[slotIndex]; return next; });
    }
  };

  return (
    <div className="relative">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          {tomorrowMode ? "Tomorrow's Goals" : "Today's Goals"}
          <span className="text-xs font-normal text-muted-foreground">
            {completedCount}/{displayTotal}
          </span>
        </h3>
        <Button variant="ghost" size="sm" onClick={() => setShowAddInput(true)} className="text-primary">
          <Plus className="h-4 w-4 mr-1" />
          Add
        </Button>
      </div>

      <div className="w-full bg-muted rounded-full h-1 mb-3">
        <motion.div
          className="h-1 rounded-full bg-primary"
          initial={{ width: 0 }}
          animate={{ width: `${(completedCount / displayTotal) * 100}%` }}
          transition={{ duration: 0.4, ease: "easeOut" }}
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
              <motion.button
                onClick={() => toggleMutation.mutate(goal.id)}
                whileTap={{ scale: 0.85 }}
                className={`flex-shrink-0 w-7 h-7 rounded-full border-2 flex items-center justify-center transition-all touch-manipulation ${
                  goal.completed
                    ? "bg-primary border-primary"
                    : "border-border hover:border-primary"
                }`}
              >
                <AnimatePresence>
                  {goal.completed && (
                    <motion.div
                      initial={{ scale: 0, rotate: -20 }}
                      animate={{ scale: 1, rotate: 0 }}
                      exit={{ scale: 0 }}
                      transition={{ type: "spring", stiffness: 400, damping: 20 }}
                    >
                      <Check className="h-3.5 w-3.5 text-white" />
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.button>

              {isEditing ? (
                <Input
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  onKeyDown={(e) => handleEditKeyDown(e, goal.goalTemplateId)}
                  onBlur={() => {
                    if (editCancelledRef.current) { editCancelledRef.current = false; return; }
                    const trimmed = editTitle.trim();
                    if (trimmed) updateTemplateMutation.mutate({ id: goal.goalTemplateId, title: trimmed });
                    else setEditingId(null);
                  }}
                  className="flex-1 h-8 text-sm"
                  autoFocus
                />
              ) : (
                <span
                  className={`flex-1 text-sm ${goal.completed ? "line-through text-muted-foreground" : "text-foreground"}`}
                  onDoubleClick={() => { setEditingId(goal.goalTemplateId); setEditTitle(goal.title); }}
                >
                  {goal.title}
                </span>
              )}

              {!isEditing && (
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => { setEditingId(goal.goalTemplateId); setEditTitle(goal.title); }}
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
            <Button size="sm" onClick={handleAddGoal} disabled={!newGoalTitle.trim() || addTemplateMutation.isPending} className="h-9">Add</Button>
            <Button variant="ghost" size="sm" onClick={() => { setShowAddInput(false); setNewGoalTitle(""); }} className="h-9 px-2">
              <X className="h-4 w-4" />
            </Button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Per-goal toast reward ─────────────────────────────────────── */}
      {createPortal(
        <AnimatePresence>
          {goalToast && (
            <motion.div
              key="goal-toast"
              initial={{ opacity: 0, y: -24, scale: 0.92 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -16, scale: 0.95 }}
              transition={{ duration: 0.22, ease: "easeOut" }}
              style={{
                position: "fixed",
                top: "env(safe-area-inset-top, 20px)",
                left: "50%",
                transform: "translateX(-50%)",
                zIndex: 9998,
                pointerEvents: "none",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  backgroundColor: "var(--card)",
                  border: "1px solid var(--primary)",
                  borderRadius: "999px",
                  padding: "8px 18px",
                  boxShadow: "0 4px 20px rgba(0,0,0,0.35)",
                  whiteSpace: "nowrap",
                }}
              >
                <span style={{ fontSize: "1.1rem" }}>{goalToast.icon}</span>
                <span style={{ fontSize: "0.875rem", fontWeight: 600, color: "var(--foreground)" }}>
                  {goalToast.text}
                </span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}

      {/* ── All-goals complete celebration ────────────────────────────── */}
      {createPortal(
        <AnimatePresence>
          {showCelebration && (
            <motion.div
              key="all-celebration"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
              onClick={() => { celebrationY.set(0); setShowCelebration(false); }}
              style={{
                position: "fixed",
                inset: 0,
                zIndex: 9999,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: "rgba(0,0,0,0.5)",
              }}
            >
              <motion.div
                drag="y"
                dragConstraints={{ top: -500, bottom: 0 }}
                dragElastic={{ top: 1, bottom: 0 }}
                style={{
                  y: celebrationY,
                  opacity: celebrationOpacity,
                  touchAction: "none",
                  backgroundColor: "var(--card)",
                  border: "1px solid var(--border)",
                  borderRadius: "1.25rem",
                  padding: "2.25rem 2.5rem",
                  textAlign: "center",
                  boxShadow: "0 24px 64px rgba(0,0,0,0.45)",
                  maxWidth: "290px",
                  width: "90%",
                }}
                initial={{ scale: 0.7, opacity: 0, y: 20 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.85, opacity: 0, y: -40 }}
                transition={{ type: "spring", stiffness: 340, damping: 26 }}
                onClick={(e) => e.stopPropagation()}
                onDragEnd={(_e, info) => {
                  if (info.offset.y < -60 || info.velocity.y < -400) {
                    setShowCelebration(false);
                    celebrationY.set(0);
                  } else {
                    celebrationY.set(0);
                  }
                }}
              >
                <motion.div
                  animate={{ rotate: [0, -10, 10, -6, 6, 0] }}
                  transition={{ duration: 0.6, delay: 0.1 }}
                  style={{ fontSize: "3.25rem", marginBottom: "0.6rem" }}
                >
                  {celebrationMsg.icon}
                </motion.div>
                <p style={{ fontSize: "1.15rem", fontWeight: 700, color: "var(--foreground)", margin: 0 }}>
                  {celebrationMsg.title}
                </p>
                <p style={{ fontSize: "0.85rem", color: "var(--muted-foreground)", marginTop: "0.35rem" }}>
                  {celebrationMsg.sub}
                </p>
                <p style={{ fontSize: "0.72rem", color: "var(--muted-foreground)", marginTop: "0.5rem", opacity: 0.5 }}>
                  swipe up to dismiss
                </p>

                {/* animated dots */}
                <div style={{ display: "flex", justifyContent: "center", gap: "6px", marginTop: "1.25rem" }}>
                  {["#F59E0B","#10B981","#8B5CF6","#EC4899","#3B82F6","#EF4444"].map((color, i) => (
                    <motion.div
                      key={i}
                      initial={{ scale: 0, y: 0 }}
                      animate={{ scale: [0, 1.3, 1], y: [0, -10, 0] }}
                      transition={{ delay: 0.15 + i * 0.07, duration: 0.45, type: "spring" }}
                      style={{ width: 9, height: 9, borderRadius: "50%", backgroundColor: color }}
                    />
                  ))}
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </div>
  );
}
