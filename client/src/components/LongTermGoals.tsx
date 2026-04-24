import { useState, useCallback, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { Target, Plus, X, Trash2, Edit2, ChevronDown, ChevronUp, CheckCircle2, Trophy, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import NativeSlider from "@/components/ui/native-slider";
import { apiRequest } from "@/lib/queryClient";
import { haptic, hapticSequence } from "@/lib/haptics";

interface LongTermGoal {
  id: number;
  title: string;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
  progress: number;
  isCompleted: boolean;
  completedAt: string | null;
  updatedAt: string | null;
}

const F1_CELEBRATIONS = [
  "Chequered flag! You've crossed the finish line.",
  "Mission accomplished. The engineers are cheering.",
  "P1. Outstanding execution from start to finish.",
  "Race complete. Textbook performance all the way.",
  "Box, box — and the trophy is yours.",
];

function CelebrationOverlay({ goal, onDismiss }: { goal: LongTermGoal; onDismiss: () => void }) {
  const message = F1_CELEBRATIONS[goal.id % F1_CELEBRATIONS.length];
  const particles = Array.from({ length: 36 }, (_, i) => i);

  useEffect(() => {
    // Punchy multi-hit haptic for goal completion
    hapticSequence([
      { type: "heavy", delay: 0 },
      { type: "success", delay: 200 },
      { type: "heavy", delay: 500 },
      { type: "success", delay: 850 },
    ]);
    const t = setTimeout(onDismiss, 6000);
    return () => clearTimeout(t);
  }, [onDismiss]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={onDismiss}
    >
      {/* Confetti particles */}
      {particles.map((i) => {
        const angle = (i / particles.length) * 360;
        const distance = 120 + Math.random() * 180;
        const size = 6 + Math.random() * 10;
        const colors = ["#f59e0b", "#fbbf24", "#ffffff", "#34d399", "#60a5fa", "#f472b6"];
        const color = colors[i % colors.length];
        const delay = Math.random() * 0.4;
        const rad = (angle * Math.PI) / 180;
        return (
          <motion.div
            key={i}
            className="absolute rounded-sm"
            style={{
              width: size,
              height: size * 0.5,
              background: color,
              top: "50%",
              left: "50%",
            }}
            initial={{ x: 0, y: 0, opacity: 1, rotate: 0, scale: 1 }}
            animate={{
              x: Math.cos(rad) * distance,
              y: Math.sin(rad) * distance - 60,
              opacity: 0,
              rotate: angle * 3,
              scale: 0.3,
            }}
            transition={{ duration: 1.4, delay, ease: "easeOut" }}
          />
        );
      })}

      <motion.div
        drag="y"
        dragConstraints={{ top: -500, bottom: 0 }}
        dragElastic={{ top: 1, bottom: 0 }}
        onDragEnd={(_, info) => {
          if (info.offset.y < -60 || info.velocity.y < -400) { haptic("light"); onDismiss(); }
        }}
        initial={{ scale: 0.5, opacity: 0, y: 30 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.9, opacity: 0, y: -60 }}
        transition={{ type: "spring", stiffness: 300, damping: 20, delay: 0.1 }}
        className="text-center px-8 max-w-sm cursor-grab active:cursor-grabbing"
        style={{ touchAction: "none" }}
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-white/30 text-[11px] mb-3 select-none">swipe up to dismiss</p>
        <motion.div
          animate={{ rotate: [0, -10, 10, -8, 8, 0], scale: [1, 1.15, 1] }}
          transition={{ duration: 0.8, delay: 0.3 }}
          className="text-7xl mb-4"
        >
          🏆
        </motion.div>
        <h2 className="text-2xl font-bold text-white mb-2">Target Achieved</h2>
        <p className="text-primary font-semibold text-lg mb-3">{goal.title}</p>
        <p className="text-white/70 text-sm leading-relaxed mb-6">{message}</p>
        <motion.button
          whileTap={{ scale: 0.95 }}
          onClick={onDismiss}
          onMouseDown={(e) => e.preventDefault()}
          tabIndex={-1}
          className="px-6 py-2.5 rounded-full bg-primary text-primary-foreground text-sm font-semibold"
        >
          Back to the pits
        </motion.button>
      </motion.div>
    </motion.div>
  );
}

function ReviewNudge({ staleGoals }: { staleGoals: LongTermGoal[] }) {
  const [dismissed, setDismissed] = useState(() => {
    try {
      const d = localStorage.getItem("ltg_nudge_dismissed");
      if (!d) return false;
      return Date.now() - parseInt(d) < 24 * 60 * 60 * 1000;
    } catch { return false; }
  });

  if (dismissed || staleGoals.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      className="flex items-start gap-2.5 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20"
    >
      <AlertCircle className="h-3.5 w-3.5 text-amber-600 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-[11px] font-semibold text-amber-700">Time for a progress check</p>
        <p className="text-[11px] text-amber-600 leading-relaxed">
          {staleGoals.length === 1
            ? `"${staleGoals[0].title}" hasn't been updated in a while.`
            : `${staleGoals.length} targets haven't been updated in 7+ days.`}{" "}
          Slide the bar to reflect where you are now.
        </p>
      </div>
      <button
        onClick={() => {
          setDismissed(true);
          try { localStorage.setItem("ltg_nudge_dismissed", String(Date.now())); } catch {}
        }}
        className="text-amber-500/60 hover:text-amber-600 shrink-0"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </motion.div>
  );
}

export default function LongTermGoals() {
  const queryClient = useQueryClient();
  const [isExpanded, setIsExpanded] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [celebratingGoal, setCelebratingGoal] = useState<LongTermGoal | null>(null);
  const [localProgress, setLocalProgress] = useState<Record<number, number>>({});

  const { data: goals = [] } = useQuery<LongTermGoal[]>({
    queryKey: ["/api/long-term-goals"],
  });

  // Sync local progress sliders from server data when it arrives
  useEffect(() => {
    setLocalProgress(prev => {
      const next = { ...prev };
      goals.forEach(g => {
        if (!(g.id in next)) next[g.id] = g.progress ?? 0;
      });
      return next;
    });
  }, [goals]);

  const updateMutation = useMutation({
    mutationFn: async (payload: { id: number; title?: string; description?: string; progress?: number; isCompleted?: boolean }) => {
      const { id, ...rest } = payload;
      const res = await apiRequest("PUT", `/api/long-term-goals/${id}`, rest);
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/long-term-goals"] }),
  });

  const addMutation = useMutation({
    mutationFn: async ({ title, description }: { title: string; description?: string }) => {
      const res = await apiRequest("POST", "/api/long-term-goals", { title, description });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/long-term-goals"] });
      setNewTitle("");
      setNewDescription("");
      setShowAddForm(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/long-term-goals/${id}`);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/long-term-goals"] }),
  });

  const handleAdd = () => {
    if (!newTitle.trim()) return;
    addMutation.mutate({ title: newTitle.trim(), description: newDescription.trim() || undefined });
  };

  const handleProgressCommit = useCallback((goal: LongTermGoal, value: number) => {
    if (value === 100 && !goal.isCompleted) {
      // Sliding to 100% counts as completing — trigger celebration
      haptic("heavy");
      // Blur any focused element so the keyboard doesn't open when the overlay mounts
      (document.activeElement as HTMLElement | null)?.blur();
      updateMutation.mutate({ id: goal.id, isCompleted: true, progress: 100 });
      setCelebratingGoal({ ...goal, progress: 100 });
    } else {
      updateMutation.mutate({ id: goal.id, progress: value });
    }
  }, [updateMutation]);

  const handleComplete = useCallback((goal: LongTermGoal) => {
    haptic("heavy");
    // Blur any focused element so the keyboard doesn't open when the overlay mounts
    (document.activeElement as HTMLElement | null)?.blur();
    // If already completed, un-complete it
    if (goal.isCompleted) {
      updateMutation.mutate({ id: goal.id, isCompleted: false, progress: goal.progress });
      return;
    }
    // Complete it
    setLocalProgress(prev => ({ ...prev, [goal.id]: 100 }));
    updateMutation.mutate({ id: goal.id, isCompleted: true, progress: 100 });
    setCelebratingGoal(goal);
  }, [updateMutation]);

  // Stale = active, not completed, updatedAt > 7 days ago
  const staleGoals = goals.filter(g => {
    if (g.isCompleted) return false;
    if (!g.updatedAt) return false;
    const daysSince = (Date.now() - new Date(g.updatedAt).getTime()) / (1000 * 60 * 60 * 24);
    return daysSince >= 7;
  });

  const activeGoals = goals.filter(g => !g.isCompleted);
  const completedGoals = goals.filter(g => g.isCompleted);

  if (goals.length === 0 && !isExpanded) {
    return (
      <button
        onClick={() => { setIsExpanded(true); setShowAddForm(true); }}
        className="w-full text-left flex items-center gap-3 p-3 rounded-xl border border-dashed border-border hover:border-primary/30 hover:bg-muted/30 transition-all"
      >
        <div className="w-7 h-7 rounded-lg bg-muted flex items-center justify-center shrink-0">
          <Target className="h-3.5 w-3.5 text-muted-foreground" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground">Set long-term targets</p>
          <p className="text-xs text-muted-foreground">Up to 3 bigger objectives you're working toward</p>
        </div>
        <Plus className="h-4 w-4 text-muted-foreground shrink-0" />
      </button>
    );
  }

  return (
    <>
      <AnimatePresence>
        {celebratingGoal && (
          <CelebrationOverlay
            goal={celebratingGoal}
            onDismiss={() => setCelebratingGoal(null)}
          />
        )}
      </AnimatePresence>

      <div className="bg-card rounded-xl border border-border/50 shadow-sm overflow-hidden">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="w-full flex items-center justify-between p-3 hover:bg-muted/30 transition-colors"
        >
          <div className="flex items-center gap-2.5">
            <Target className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold text-foreground">Long-Term Targets</h3>
            <span className="text-xs text-muted-foreground">{activeGoals.length}/3</span>
            {completedGoals.length > 0 && (
              <span className="text-[10px] bg-emerald-500/10 text-emerald-600 px-1.5 py-0.5 rounded-full font-medium">
                {completedGoals.length} done
              </span>
            )}
            {staleGoals.length > 0 && !isExpanded && (
              <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
            )}
          </div>
          {isExpanded ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </button>

        <AnimatePresence>
          {isExpanded && (
            <motion.div
              initial={{ height: 0 }}
              animate={{ height: "auto" }}
              exit={{ height: 0 }}
              className="overflow-hidden"
            >
              <div className="px-3 pb-3 space-y-2">
                {/* Review nudge */}
                <AnimatePresence>
                  {staleGoals.length > 0 && <ReviewNudge staleGoals={staleGoals} />}
                </AnimatePresence>

                {/* Active goals */}
                {activeGoals.map((goal, i) => {
                  const prog = localProgress[goal.id] ?? goal.progress ?? 0;
                  return (
                    <motion.div
                      key={goal.id}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.05 }}
                      className="group flex flex-col gap-2 p-2.5 rounded-lg bg-muted/30 border border-border/30"
                    >
                      <div className="flex items-start gap-2.5">
                        {/* Completion button */}
                        <button
                          onClick={() => handleComplete(goal)}
                          className="mt-0.5 shrink-0 w-5 h-5 rounded-full border-2 border-primary/30 hover:border-primary flex items-center justify-center transition-colors"
                          title="Mark as complete"
                        >
                          <span className="text-[9px] font-bold text-primary/50">{i + 1}</span>
                        </button>

                        {editingId === goal.id ? (
                          <Input
                            value={editTitle}
                            onChange={(e) => setEditTitle(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && editTitle.trim()) updateMutation.mutate({ id: goal.id, title: editTitle.trim() });
                              if (e.key === "Escape") setEditingId(null);
                            }}
                            onBlur={() => setEditingId(null)}
                            className="flex-1 h-7 text-sm"
                            autoFocus
                          />
                        ) : (
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-foreground">{goal.title}</p>
                            {goal.description && (
                              <p className="text-xs text-muted-foreground mt-0.5">{goal.description}</p>
                            )}
                          </div>
                        )}

                        {editingId !== goal.id && (
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                            <button
                              onClick={() => { setEditingId(goal.id); setEditTitle(goal.title); }}
                              className="p-1 text-muted-foreground hover:text-foreground"
                            >
                              <Edit2 className="h-3 w-3" />
                            </button>
                            <button
                              onClick={() => deleteMutation.mutate(goal.id)}
                              className="p-1 text-muted-foreground hover:text-red-500"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Progress slider */}
                      <div className="flex items-center gap-2.5 px-0.5">
                        <div className="flex-1">
                          <NativeSlider
                            value={prog}
                            min={0}
                            max={100}
                            step={5}
                            color={prog === 100
                              ? "hsl(142, 71%, 45%)"
                              : `hsl(${40 - (prog / 100) * 5}, ${80 + (prog / 100) * 15}%, ${48 + (prog / 100) * 4}%)`
                            }
                            onChange={(v) => setLocalProgress(prev => ({ ...prev, [goal.id]: v }))}
                            onCommit={(v) => handleProgressCommit(goal, v)}
                          />
                        </div>
                        <button
                          onClick={() => handleComplete(goal)}
                          className="shrink-0 flex items-center gap-1 text-[10px] font-semibold text-muted-foreground hover:text-emerald-600 transition-colors"
                          title="Mark complete"
                        >
                          <CheckCircle2 className="h-4 w-4" />
                          <span className="tabular-nums">{prog}%</span>
                        </button>
                      </div>
                    </motion.div>
                  );
                })}

                {/* Add form / button */}
                {activeGoals.length < 3 && !showAddForm && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowAddForm(true)}
                    className="w-full h-8 text-xs text-muted-foreground"
                  >
                    <Plus className="h-3 w-3 mr-1" />
                    Add target ({3 - activeGoals.length} remaining)
                  </Button>
                )}

                <AnimatePresence>
                  {showAddForm && activeGoals.length < 3 && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="space-y-2"
                    >
                      <Input
                        value={newTitle}
                        onChange={(e) => setNewTitle(e.target.value)}
                        placeholder="What's the target?"
                        className="h-8 text-sm"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleAdd();
                          if (e.key === "Escape") { setShowAddForm(false); setNewTitle(""); setNewDescription(""); }
                        }}
                        autoFocus
                      />
                      <Textarea
                        value={newDescription}
                        onChange={(e) => setNewDescription(e.target.value)}
                        placeholder="Brief description (optional)"
                        className="min-h-[40px] text-xs resize-none"
                        rows={1}
                      />
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          onClick={handleAdd}
                          disabled={!newTitle.trim() || addMutation.isPending}
                          className="h-7 text-xs"
                        >
                          Add
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => { setShowAddForm(false); setNewTitle(""); setNewDescription(""); }}
                          className="h-7 text-xs"
                        >
                          Cancel
                        </Button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Completed goals */}
                {completedGoals.length > 0 && (
                  <div className="space-y-1.5 pt-1">
                    <p className="text-[10px] uppercase tracking-widest text-muted-foreground/60 font-semibold px-0.5">Crossed the line</p>
                    {completedGoals.map((goal) => (
                      <div
                        key={goal.id}
                        className="flex items-center gap-2.5 p-2 rounded-lg bg-emerald-500/5 border border-emerald-500/15"
                      >
                        <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-muted-foreground line-through">{goal.title}</p>
                          {goal.completedAt && (
                            <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                              Completed {new Date(goal.completedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                            </p>
                          )}
                        </div>
                        <button
                          onClick={() => handleComplete(goal)}
                          className="text-[10px] text-muted-foreground/50 hover:text-muted-foreground transition-colors shrink-0"
                          title="Reopen target"
                        >
                          Reopen
                        </button>
                        <button
                          onClick={() => deleteMutation.mutate(goal.id)}
                          className="p-1 text-muted-foreground/40 hover:text-red-500 shrink-0"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </>
  );
}
