import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence, useMotionValue, useTransform, animate } from "framer-motion";
import { Check, Plus, X, Trash2, Edit2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiRequest } from "@/lib/queryClient";
import { haptic, hapticSequence } from "@/lib/haptics";
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
  { icon: "🏆", title: "Job List Cleared!", sub: "Session complete. Outstanding execution." },
  { icon: "🏁", title: "Chequered Flag!", sub: "Full points haul. Race pace confirmed." },
  { icon: "🥇", title: "Perfect Score!", sub: "P1 performance. Zero dropped objectives." },
  { icon: "⚡", title: "Clean Sheet!", sub: "All sectors green. Maximum output delivered." },
];

function triggerHaptic() { haptic("medium"); }
function triggerCelebrationHaptic() {
  hapticSequence([
    { type: "success", delay: 0 },
    { type: "heavy",   delay: 160 },
    { type: "medium",  delay: 310 },
    { type: "success", delay: 520 },
    { type: "heavy",   delay: 680 },
    { type: "medium",  delay: 820 },
    { type: "light",   delay: 960 },
    { type: "success", delay: 1150 },
    { type: "heavy",   delay: 1300 },
    { type: "medium",  delay: 1440 },
    { type: "light",   delay: 1560 },
  ]);
}

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
  const celebrationOpacity = useTransform(celebrationY, [-200, -60, 0], [0, 0.6, 1]);
  const prevCompletedCountRef = useRef<number>(-1);
  const prevTotalRef = useRef<number>(0);
  // Tracks whether goals data has finished its first load — prevents false
  // celebration fires when already-complete goals load in on mount/reopen.
  const initialLoadSettledRef = useRef<boolean>(false);
  // Session-only guard so the celebration fires once per completion streak per session
  const celebratedThisSessionRef = useRef<boolean>(false);

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

      // Big celebration only when the user ticks the very last goal
      if (allGoalsComplete && totalGoals > 0 && !celebratedThisSessionRef.current) {
        celebratedThisSessionRef.current = true;
        const msg = ALL_COMPLETE_MESSAGES[Math.floor(Math.random() * ALL_COMPLETE_MESSAGES.length)];
        setCelebrationMsg(msg);
        // Instant — no delay
        triggerCelebrationHaptic();
        setShowCelebration(true);
      }
      // Reset session guard if user un-completes a goal so they can celebrate again
      if (!allGoalsComplete) {
        celebratedThisSessionRef.current = false;
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
      queryClient.invalidateQueries({ queryKey: ["/api/me/points"] });
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
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
          {tomorrowMode ? "Tomorrow's Job List" : "Today's Job List"}
          <span className="text-sm font-normal text-muted-foreground">
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
              transition={{ duration: 0.2 }}
              style={{
                position: "fixed",
                inset: 0,
                zIndex: 9999,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: "rgba(0,0,0,0.65)",
              }}
            >
              {/* Particle burst — 12 dots flying out from center */}
              {Array.from({ length: 12 }).map((_, i) => {
                const angle = (i / 12) * 2 * Math.PI;
                const dist = 120 + Math.random() * 60;
                const colors = ["#F59E0B","#FCD34D","#10B981","#8B5CF6","#EC4899","#3B82F6","#EF4444","#F97316"];
                const color = colors[i % colors.length];
                return (
                  <motion.div
                    key={i}
                    initial={{ opacity: 1, x: 0, y: 0, scale: 0 }}
                    animate={{
                      opacity: [1, 1, 0],
                      x: Math.cos(angle) * dist,
                      y: Math.sin(angle) * dist,
                      scale: [0, 1.4, 0.6],
                    }}
                    transition={{ duration: 0.7, delay: i * 0.03, ease: "easeOut" }}
                    style={{
                      position: "absolute",
                      width: 10,
                      height: 10,
                      borderRadius: "50%",
                      backgroundColor: color,
                      pointerEvents: "none",
                    }}
                  />
                );
              })}

              {/* Main card — draggable upward to dismiss */}
              <motion.div
                drag="y"
                dragConstraints={{ top: -600, bottom: 0 }}
                dragElastic={{ top: 0.8, bottom: 0 }}
                style={{
                  y: celebrationY,
                  opacity: celebrationOpacity,
                  touchAction: "pan-y",
                  position: "relative",
                }}
                initial={{ scale: 0.6, opacity: 0, y: 30 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.8, opacity: 0, y: -120 }}
                transition={{ type: "spring", stiffness: 380, damping: 28 }}
                onDragEnd={(_e, info) => {
                  if (info.offset.y < -80 || info.velocity.y < -500) {
                    // Fly up and out
                    animate(celebrationY, -700, { type: "spring", stiffness: 300, damping: 30 });
                    setTimeout(() => { setShowCelebration(false); celebrationY.set(0); }, 350);
                  } else {
                    // Spring back to center
                    animate(celebrationY, 0, { type: "spring", stiffness: 400, damping: 30 });
                  }
                }}
              >
                <div
                  style={{
                    backgroundColor: "var(--card)",
                    borderRadius: "1.5rem",
                    padding: "2.5rem 2.25rem 2rem",
                    textAlign: "center",
                    boxShadow: "0 0 0 1px rgba(245,158,11,0.3), 0 32px 80px rgba(0,0,0,0.55), 0 0 60px rgba(245,158,11,0.12)",
                    maxWidth: "300px",
                    width: "88vw",
                  }}
                >
                  {/* Glowing amber top bar */}
                  <div style={{
                    position: "absolute",
                    top: 0,
                    left: "15%",
                    right: "15%",
                    height: 3,
                    borderRadius: "0 0 4px 4px",
                    background: "linear-gradient(90deg, transparent, #F59E0B, #FCD34D, #F59E0B, transparent)",
                    boxShadow: "0 0 16px 4px rgba(245,158,11,0.5)",
                  }} />

                  {/* Icon with wobble + scale-in */}
                  <motion.div
                    animate={{ rotate: [0, -12, 12, -7, 7, -3, 3, 0] }}
                    transition={{ duration: 0.8, delay: 0.05 }}
                    style={{ fontSize: "4rem", lineHeight: 1, marginBottom: "0.8rem", display: "block" }}
                  >
                    {celebrationMsg.icon}
                  </motion.div>

                  {/* Title */}
                  <p style={{
                    fontSize: "1.25rem",
                    fontWeight: 800,
                    color: "var(--foreground)",
                    margin: 0,
                    letterSpacing: "-0.02em",
                  }}>
                    {celebrationMsg.title}
                  </p>

                  {/* Subtitle */}
                  <p style={{
                    fontSize: "0.875rem",
                    color: "var(--muted-foreground)",
                    marginTop: "0.4rem",
                    lineHeight: 1.4,
                  }}>
                    {celebrationMsg.sub}
                  </p>

                  {/* Progress dots in amber */}
                  <div style={{ display: "flex", justifyContent: "center", gap: "6px", margin: "1.4rem 0 1.1rem" }}>
                    {Array.from({ length: 5 }).map((_, i) => (
                      <motion.div
                        key={i}
                        initial={{ scale: 0, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ delay: 0.12 + i * 0.08, type: "spring", stiffness: 400, damping: 18 }}
                        style={{
                          width: 8, height: 8, borderRadius: "50%",
                          background: i < 3 ? "#F59E0B" : i === 3 ? "#FCD34D" : "rgba(245,158,11,0.3)",
                          boxShadow: i < 4 ? "0 0 8px rgba(245,158,11,0.6)" : "none",
                        }}
                      />
                    ))}
                  </div>

                  {/* Swipe-up affordance */}
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                    <motion.div
                      animate={{ y: [0, -4, 0] }}
                      transition={{ repeat: Infinity, duration: 1.2, ease: "easeInOut" }}
                      style={{ color: "var(--muted-foreground)", opacity: 0.45 }}
                    >
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="18 15 12 9 6 15" />
                      </svg>
                    </motion.div>
                    <span style={{ fontSize: "0.68rem", color: "var(--muted-foreground)", opacity: 0.4, letterSpacing: "0.04em" }}>
                      SWIPE UP TO DISMISS
                    </span>
                  </div>
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
