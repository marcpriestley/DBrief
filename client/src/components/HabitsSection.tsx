import { useState, useCallback, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useDateContext } from "@/contexts/DateContext";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, Flame, X, ChevronRight, ChevronLeft, Check, Settings2, Trash2, Bell, BellOff, Repeat, Trophy } from "lucide-react";
import type { Habit } from "@shared/schema";
import { haptic } from "@/lib/haptics";
import { normalizeAnchor, normalizeHabitName, stackingSentence, habitNotificationBody } from "@shared/habitUtils";

// ─── Types ──────────────────────────────────────────────────────────────────

type HabitWithStatus = Habit & { todayCompleted: boolean; dueToday?: boolean; last7Days: boolean[]; last7Scheduled?: boolean[] };

// ─── Emoji + category options ────────────────────────────────────────────────

const EMOJIS = ["⭐", "🏃", "💧", "📚", "🧘", "💪", "🥗", "😴", "✍️", "🎯", "🧠", "🎵", "🚴", "🌅", "💊", "🫁", "❤️", "🌿", "🐶"];

const CATEGORIES = [
  { value: "health", label: "Health" },
  { value: "fitness", label: "Fitness" },
  { value: "mindfulness", label: "Mindfulness" },
  { value: "learning", label: "Learning" },
  { value: "productivity", label: "Productivity" },
  { value: "nutrition", label: "Nutrition" },
  { value: "sleep", label: "Sleep" },
  { value: "social", label: "Social" },
  { value: "creativity", label: "Creativity" },
  { value: "general", label: "Other" },
];

const MOTIVATION_OPTIONS = [
  "Better performance",
  "More energy",
  "Reduce stress",
  "Build discipline",
  "Improve health",
  "Feel in control",
  "Personal growth",
];

// ─── Milestone thresholds ────────────────────────────────────────────────────

function getMilestone(total: number): { next: number; label: string } {
  const milestones = [7, 21, 66, 100, 365];
  for (const m of milestones) {
    if (total < m) return { next: m, label: m === 66 ? "habit formed!" : `${m} days` };
  }
  return { next: 365, label: "365 days" };
}

// ─── Setup modal state ───────────────────────────────────────────────────────

const FREQUENCY_OPTIONS = [
  { value: "daily", label: "Every day" },
  { value: "multiple_daily", label: "Multiple times a day" },
  { value: "weekdays", label: "Weekdays" },
  { value: "weekends", label: "Weekends" },
  { value: "alternate", label: "Every other day" },
  { value: "weekly", label: "Once a week" },
  { value: "specific_days", label: "Specific days" },
];

const DAYS_OF_WEEK = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function frequencyLabel(frequency: string, specificDays?: string | null): string {
  switch (frequency) {
    case "daily": return "Every day";
    case "multiple_daily": return "Multiple daily";
    case "weekdays": return "Weekdays";
    case "weekends": return "Weekends";
    case "alternate": return "Every other day";
    case "weekly": return "Once a week";
    case "specific_days": {
      const days = (specificDays || "")
        .split(",").map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n))
        .map(n => DAYS_OF_WEEK[n]).filter(Boolean);
      return days.length > 0 ? days.join(", ") : "Specific days";
    }
    default: return frequency;
  }
}

type SetupState = {
  name: string;
  emoji: string;
  categories: string[];   // multi-select, stored as comma-separated in category field
  motivation: string;
  anchorHabit: string;
  reminderTime: string;
  reminderEnabled: boolean;
  reminderInterval: number | null; // null = once, or minutes between reminders
  reminderEndTime: string;         // end time for interval reminders
  frequency: string;
  specificDays: string[];          // for "specific_days" frequency: ["0","2","4"] = Sun,Tue,Thu
  startDate: string;               // YYYY-MM-DD — when the habit should first appear
};

const DEFAULT_SETUP: SetupState = {
  name: "",
  emoji: "⭐",
  categories: [],
  motivation: "",
  anchorHabit: "",
  reminderTime: "08:00",
  reminderEnabled: false,
  reminderInterval: null,
  reminderEndTime: "20:00",
  frequency: "daily",
  specificDays: [],
  startDate: "",  // populated dynamically in openSetup
};

// ─── Main component ──────────────────────────────────────────────────────────

export default function HabitsSection() {
  const { selectedDate } = useDateContext();
  const [showSetup, setShowSetup] = useState(false);
  const [setupStep, setSetupStep] = useState(0);
  const [setup, setSetup] = useState<SetupState>(DEFAULT_SETUP);
  const [editingHabit, setEditingHabit] = useState<HabitWithStatus | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [motivationFlash, setMotivationFlash] = useState<string | null>(null);
  const [milestoneCelebration, setMilestoneCelebration] = useState<{ milestone: number; habitName: string } | null>(null);
  const [allDoneCelebration, setAllDoneCelebration] = useState(false);

  const { data: habits = [], isLoading } = useQuery<HabitWithStatus[]>({
    queryKey: ["/api/habits", selectedDate],
    queryFn: () => fetch(`/api/habits?date=${selectedDate}`, { credentials: "include" }).then(r => r.json()),
  });

  const dueHabits = habits.filter(h => h.dueToday !== false);
  const completedToday = dueHabits.filter(h => h.todayCompleted).length;
  const totalHabits = dueHabits.length;

  const toggleMutation = useMutation({
    mutationFn: ({ id, date }: { id: number; date: string }) =>
      apiRequest("POST", `/api/habits/${id}/toggle`, { date }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/habits"] });
      queryClient.invalidateQueries({ queryKey: ["/api/me/points"] });
      haptic("success");
    },
  });

  const createMutation = useMutation({
    mutationFn: (data: SetupState) => apiRequest("POST", "/api/habits", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/habits"] });
      setShowSetup(false);
      setSetupStep(0);
      setSetup(DEFAULT_SETUP);
      haptic("success");
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<SetupState> }) =>
      apiRequest("PATCH", `/api/habits/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/habits"] });
      setEditingHabit(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/habits/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/habits"] });
      setConfirmDeleteId(null);
    },
  });

  const MILESTONE_THRESHOLDS = [7, 21, 66, 100, 365];

  const handleToggle = useCallback((habit: HabitWithStatus) => {
    if (habit.dueToday === false) return; // can't complete a rest day
    const isCompleting = !habit.todayCompleted;
    if (isCompleting && habit.motivation) {
      setMotivationFlash(habit.motivation);
      setTimeout(() => setMotivationFlash(null), 2800);
    }
    // Check if completing this will cross a milestone
    if (isCompleting) {
      const prevTotal = habit.totalCompletions || 0;
      const nextTotal = prevTotal + 1;
      const crossed = MILESTONE_THRESHOLDS.find(m => prevTotal < m && nextTotal >= m);
      if (crossed) {
        setTimeout(() => {
          setMilestoneCelebration({ milestone: crossed, habitName: habit.name });
          haptic("success");
        }, 600);
      }
      // Check if this completes ALL habits for the day
      // We get the current state from the query cache indirectly via the habits array in closure
      // completedToday is set before this callback, so if completedToday === totalHabits - 1, this is the last one
      const willCompleteAll = completedToday === totalHabits - 1 && totalHabits > 1;
      if (willCompleteAll) {
        setTimeout(() => {
          setAllDoneCelebration(true);
          haptic("success");
          setTimeout(() => setAllDoneCelebration(false), 3000);
        }, 700);
      }
    }
    toggleMutation.mutate({ id: habit.id, date: selectedDate });
  }, [toggleMutation, selectedDate, completedToday, totalHabits]);

  const handleCreate = useCallback(() => {
    if (!setup.name.trim()) return;
    const { categories, specificDays, startDate, ...rest } = setup;
    createMutation.mutate({
      ...rest,
      category: categories.length > 0 ? categories.join(",") : "general",
      specificDays: specificDays.length > 0 ? specificDays.join(",") : null,
      startDate: startDate || new Date().toISOString().split("T")[0],
      reminderInterval: setup.reminderEnabled ? setup.reminderInterval : null,
      reminderEndTime: setup.reminderEnabled && setup.reminderInterval ? setup.reminderEndTime : null,
    } as any);
  }, [createMutation, setup]);

  const openSetup = () => {
    const todayStr = new Date().toISOString().split("T")[0];
    setSetup({ ...DEFAULT_SETUP, startDate: todayStr });
    setSetupStep(0);
    setShowSetup(true);
  };

  const openEdit = (habit: HabitWithStatus) => {
    setEditingHabit(habit);
  };

  const STEPS = [
    { title: "Name your habit", subtitle: "What are you building?" },
    { title: "Your why", subtitle: "What's the payoff?" },
    { title: "Stack it", subtitle: "Attach it to an existing routine" },
    { title: "Remind me", subtitle: "Set a daily prompt (optional)" },
  ];

  return (
    <div className="relative bg-card rounded-2xl border border-border/50 shadow-sm p-5">
      {/* Motivation flash — fixed toast at the bottom of the screen */}
      <AnimatePresence>
        {motivationFlash && (
          <motion.div
            key="motivation-flash"
            drag="y"
            dragConstraints={{ top: -200, bottom: 0 }}
            onDragEnd={(_, info) => { if (info.offset.y < -40) setMotivationFlash(null); }}
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 24 }}
            transition={{ type: "spring", damping: 22, stiffness: 280 }}
            onClick={() => setMotivationFlash(null)}
            className="fixed bottom-24 left-4 right-4 z-50 bg-primary text-black text-sm font-semibold rounded-2xl px-4 py-3.5 shadow-xl flex items-center gap-2.5 cursor-grab active:cursor-grabbing touch-none"
          >
            <span className="text-lg">⚡</span>
            <span className="leading-snug flex-1">{motivationFlash}</span>
            <X className="h-4 w-4 opacity-50 flex-shrink-0" />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Milestone celebration overlay */}
      <AnimatePresence>
        {milestoneCelebration && (
          <MilestoneCelebration
            milestone={milestoneCelebration.milestone}
            habitName={milestoneCelebration.habitName}
            onClose={() => setMilestoneCelebration(null)}
          />
        )}
      </AnimatePresence>

      {/* All-habits-done celebration */}
      <AnimatePresence>
        {allDoneCelebration && (
          <motion.div
            key="all-done"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            transition={{ type: "spring", damping: 20, stiffness: 300 }}
            className="fixed bottom-24 left-4 right-4 z-50 bg-primary text-black rounded-2xl px-4 py-3.5 shadow-xl flex items-center gap-3"
          >
            <motion.span
              animate={{ rotate: [0, -15, 15, -10, 10, 0] }}
              transition={{ duration: 0.6, delay: 0.1 }}
              className="text-2xl shrink-0"
            >
              🎯
            </motion.span>
            <div className="flex-1">
              <p className="text-sm font-black leading-tight">All habits locked in!</p>
              <p className="text-xs font-medium opacity-75 mt-0.5">Perfect day on the telemetry.</p>
            </div>
            <button onClick={() => setAllDoneCelebration(false)}>
              <X className="h-4 w-4 opacity-50" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-semibold text-foreground">Habit Lab</h2>
          {totalHabits > 0 ? (
            <p className="text-sm text-muted-foreground mt-0.5">
              {completedToday === totalHabits
                ? "All habits locked in 🎯"
                : `${completedToday} of ${totalHabits} done today`}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground mt-0.5">Build routines that stick</p>
          )}
        </div>
        <button
          onClick={openSetup}
          className="flex items-center gap-1.5 text-xs font-medium text-primary bg-primary/10 hover:bg-primary/20 rounded-lg px-3 py-2 transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
          New habit
        </button>
      </div>

      {/* Habit list */}
      {isLoading ? (
        <div className="space-y-2">
          {[1, 2].map(i => (
            <div key={i} className="h-16 bg-muted/40 rounded-lg animate-pulse" />
          ))}
        </div>
      ) : habits.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          <div className="text-3xl mb-2">🏁</div>
          <p className="text-sm font-medium">No habits yet</p>
          <p className="text-xs mt-1 text-muted-foreground/70">Habits form when consistency is combined with time.</p>
        </div>
      ) : (
        <div className="space-y-2">
          <AnimatePresence>
            {habits.map(habit => (
              <HabitCard
                key={habit.id}
                habit={habit}
                onToggle={handleToggle}
                onEdit={openEdit}
                onDelete={(id) => setConfirmDeleteId(id)}
              />
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* Setup modal */}
      <AnimatePresence>
        {showSetup && (
          <SetupModal
            step={setupStep}
            steps={STEPS}
            setup={setup}
            setSetup={setSetup}
            onNext={() => setSetupStep(s => s + 1)}
            onBack={() => setSetupStep(s => s - 1)}
            onClose={() => { setShowSetup(false); setSetupStep(0); }}
            onSubmit={handleCreate}
            isSubmitting={createMutation.isPending}
          />
        )}
      </AnimatePresence>

      {/* Edit modal */}
      <AnimatePresence>
        {editingHabit && (
          <EditModal
            habit={editingHabit}
            onSave={(updates) => updateMutation.mutate({ id: editingHabit.id, data: updates })}
            onClose={() => setEditingHabit(null)}
            isSaving={updateMutation.isPending}
          />
        )}
      </AnimatePresence>

      {/* Delete confirm */}
      <AnimatePresence>
        {confirmDeleteId !== null && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 backdrop-blur-sm p-4"
            onClick={() => setConfirmDeleteId(null)}
          >
            <motion.div
              initial={{ y: 40, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 40, opacity: 0 }}
              onClick={e => e.stopPropagation()}
              className="bg-card rounded-2xl border border-border/50 p-5 w-full max-w-sm"
            >
              <p className="text-sm font-semibold text-foreground mb-1">Remove this habit?</p>
              <p className="text-xs text-muted-foreground mb-4">Your history will be preserved — you can always restart.</p>
              <div className="flex gap-2">
                <button
                  onClick={() => setConfirmDeleteId(null)}
                  className="flex-1 text-sm text-muted-foreground bg-muted/50 rounded-lg py-2.5"
                >
                  Cancel
                </button>
                <button
                  onClick={() => deleteMutation.mutate(confirmDeleteId!)}
                  className="flex-1 text-sm font-medium text-red-500 bg-red-500/10 rounded-lg py-2.5"
                >
                  Remove
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── 7-day dots ──────────────────────────────────────────────────────────────

function WeekDots({ days, scheduled }: { days: boolean[]; scheduled?: boolean[] }) {
  // days[0] = 6 days ago, days[6] = today
  const today = new Date();
  const dotDays = days.map((done, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() - (6 - i));
    const dayLabel = ["S","M","T","W","T","F","S"][d.getDay()];
    const isScheduled = !scheduled || scheduled[i];
    return { done, dayLabel, isScheduled };
  });

  return (
    <div className="flex items-center gap-1 mt-1.5">
      {dotDays.map(({ done, dayLabel, isScheduled }, i) => (
        <div key={i} className="flex flex-col items-center gap-0.5">
          {isScheduled ? (
            <motion.div
              className={`w-4 h-4 rounded-full ${done ? "bg-primary" : "bg-muted/60"}`}
              initial={false}
              animate={{ scale: done ? [1, 1.3, 1] : 1 }}
              transition={{ duration: 0.3 }}
            />
          ) : (
            <div className="relative w-4 h-4 flex items-center justify-center">
              <div className="w-2.5 h-2.5 rounded-full bg-muted/25" />
              <div className="absolute w-[14px] h-px bg-muted-foreground/30 rotate-45" />
            </div>
          )}
          <span className={`text-[8px] leading-none ${isScheduled ? "text-muted-foreground/50" : "text-muted-foreground/20"}`}>
            {dayLabel}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Habit card ──────────────────────────────────────────────────────────────

const PROTECTED_HABIT = "make someone smile";

function HabitCard({
  habit,
  onToggle,
  onEdit,
  onDelete,
}: {
  habit: HabitWithStatus;
  onToggle: (h: HabitWithStatus) => void;
  onEdit: (h: HabitWithStatus) => void;
  onDelete: (id: number) => void;
}) {
  const [showMenu, setShowMenu] = useState(false);
  const isProtected = habit.name.toLowerCase() === PROTECTED_HABIT;
  const total = habit.totalCompletions || 0;
  const { next: milestone, label: milestoneLabel } = getMilestone(total);
  const progress = Math.min(100, (total / milestone) * 100);
  const streak = habit.currentStreak || 0;

  const isRestDay = habit.dueToday === false;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className={`relative rounded-xl border transition-all ${
        isRestDay
          ? "border-border/30 bg-muted/10 opacity-60"
          : habit.todayCompleted
            ? "border-primary/30 bg-primary/5"
            : "border-border/50 bg-muted/20"
      }`}
    >
      <div className="flex items-center gap-3 p-4">
        {/* Completion toggle / rest day indicator */}
        {isRestDay ? (
          <div className="shrink-0 w-9 h-9 rounded-full border-2 border-border/30 bg-transparent flex items-center justify-center">
            <span className="text-base leading-none opacity-40">—</span>
          </div>
        ) : (
          <button
            onClick={() => onToggle(habit)}
            className={`shrink-0 w-9 h-9 rounded-full border-2 flex items-center justify-center transition-all text-lg ${
              habit.todayCompleted
                ? "border-primary bg-primary text-white"
                : "border-border/60 bg-transparent text-muted-foreground/30 hover:border-primary/50"
            }`}
          >
            {habit.todayCompleted ? (
              <Check className="h-4 w-4 text-white" />
            ) : (
              <span className="text-base leading-none">{habit.emoji}</span>
            )}
          </button>
        )}

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            {!habit.todayCompleted && <span className="text-sm" aria-hidden>{habit.emoji}</span>}
            <span className={`text-sm font-medium truncate ${habit.todayCompleted ? "text-primary line-through opacity-60" : "text-foreground"}`}>
              {habit.name}
            </span>
            {isRestDay && (
              <span className="text-[10px] text-muted-foreground/50 border border-border/30 rounded px-1 py-0.5 shrink-0">rest</span>
            )}
          </div>
          {habit.anchorHabit && (
            <p className="text-xs text-muted-foreground truncate mt-0.5">After {normalizeAnchor(habit.anchorHabit)}</p>
          )}
          {(habit as any).frequency && !["daily", "multiple_daily"].includes((habit as any).frequency) && (
            <p className="text-[10px] text-primary/70 mt-0.5 truncate">
              {frequencyLabel((habit as any).frequency, (habit as any).specificDays)}
            </p>
          )}
          {/* 7-day completion dots */}
          <WeekDots days={habit.last7Days ?? []} scheduled={habit.last7Scheduled} />
          {/* Progress bar to next milestone */}
          <div className="flex items-center gap-2 mt-1.5">
            <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden">
              <motion.div
                className="h-full bg-primary/60 rounded-full"
                initial={{ width: 0 }}
                animate={{ width: `${progress}%` }}
                transition={{ duration: 0.5, ease: "easeOut" }}
              />
            </div>
            <span className="text-[10px] text-muted-foreground shrink-0">{total}/{milestone}</span>
          </div>
        </div>

        {/* Streak — tap 🌱 to log today's completion */}
        <button
          onClick={() => !isRestDay && onToggle(habit)}
          disabled={isRestDay}
          className={`flex flex-col items-center shrink-0 min-w-[40px] transition-transform ${isRestDay ? "opacity-30 cursor-default" : "active:scale-95"}`}
        >
          {streak > 0 ? (
            <>
              <div className="flex items-center gap-0.5">
                <Flame className={`h-3.5 w-3.5 ${streak >= 66 ? "text-yellow-400" : streak >= 21 ? "text-orange-500" : "text-orange-400"}`} />
                <span className="text-sm font-bold text-foreground">{streak}</span>
              </div>
              <span className="text-[10px] text-muted-foreground">
                {streak >= 66 ? "elite" : streak >= 21 ? "locked in" : streak >= 7 ? "on pace" : "day" + (streak !== 1 ? "s" : "")}
              </span>
            </>
          ) : (
            <>
              <span className="text-lg leading-none">🌱</span>
              <span className="text-[10px] text-primary font-medium">start</span>
            </>
          )}
        </button>

        {/* Menu */}
        <button
          onClick={() => setShowMenu(v => !v)}
          className="shrink-0 p-1.5 text-muted-foreground/50 hover:text-muted-foreground rounded-md"
        >
          <Settings2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Inline menu */}
      <AnimatePresence>
        {showMenu && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-t border-border/30"
          >
            <div className="flex px-3 py-2 gap-2">
              <button
                onClick={() => { onEdit(habit); setShowMenu(false); }}
                className="flex-1 flex items-center justify-center gap-1.5 text-xs text-muted-foreground bg-muted/50 rounded-lg py-2"
              >
                <Settings2 className="h-3.5 w-3.5" /> Edit
              </button>
              {!isProtected && (
                <button
                  onClick={() => { onDelete(habit.id); setShowMenu(false); }}
                  className="flex-1 flex items-center justify-center gap-1.5 text-xs text-red-500 bg-red-500/10 rounded-lg py-2"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Remove
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ─── Setup modal ─────────────────────────────────────────────────────────────

function SetupModal({
  step,
  steps,
  setup,
  setSetup,
  onNext,
  onBack,
  onClose,
  onSubmit,
  isSubmitting,
}: {
  step: number;
  steps: { title: string; subtitle: string }[];
  setup: SetupState;
  setSetup: (s: SetupState) => void;
  onNext: () => void;
  onBack: () => void;
  onClose: () => void;
  onSubmit: () => void;
  isSubmitting: boolean;
}) {
  const isLast = step === steps.length - 1;
  const canNext = step === 0 ? setup.name.trim().length > 0 : true;

  const [aiSentence, setAiSentence] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const name = setup.name.trim();
    const anchor = setup.anchorHabit.trim();
    if (!name || !anchor) { setAiSentence(null); setAiLoading(false); return; }
    setAiLoading(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await apiRequest("POST", "/api/habits/suggest-stacking", { anchor, habitName: name });
        const data = await res.json();
        if (data.sentence) setAiSentence(data.sentence);
      } catch {
        setAiSentence(null);
      } finally {
        setAiLoading(false);
      }
    }, 700);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [setup.name, setup.anchorHabit]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 60, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 60, opacity: 0 }}
        transition={{ type: "spring", damping: 28, stiffness: 300 }}
        onClick={e => e.stopPropagation()}
        className="bg-card rounded-2xl border border-border/50 w-full max-w-md flex flex-col"
        style={{ maxHeight: "82dvh" }}
      >
        {/* Progress bar */}
        <div className="h-1 bg-muted shrink-0">
          <motion.div
            className="h-full bg-primary rounded-full"
            animate={{ width: `${((step + 1) / steps.length) * 100}%` }}
            transition={{ duration: 0.3 }}
          />
        </div>

        <div className="p-5 overflow-y-auto">
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-xs text-muted-foreground">Step {step + 1} of {steps.length}</p>
              <h3 className="text-base font-semibold text-foreground mt-0.5">{steps[step].title}</h3>
              <p className="text-xs text-muted-foreground">{steps[step].subtitle}</p>
            </div>
            <button onClick={onClose} className="text-muted-foreground/60 hover:text-muted-foreground p-1">
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Step content */}
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              {step === 0 && <Step1 setup={setup} setSetup={setSetup} />}
              {step === 1 && <Step2 setup={setup} setSetup={setSetup} />}
              {step === 2 && <Step3 setup={setup} setSetup={setSetup} />}
              {step === 3 && <Step4 setup={setup} setSetup={setSetup} aiSentence={aiSentence} />}
            </motion.div>
          </AnimatePresence>

          {/* Preview of implementation intention (if anchor set, show it) */}
          {step >= 2 && setup.anchorHabit && (
            <div className="mt-3 bg-primary/10 rounded-xl px-3 py-2.5 border border-primary/20">
              <p className="text-xs text-muted-foreground mb-0.5">Your implementation intention:</p>
              {aiLoading ? (
                <div className="h-3.5 bg-primary/25 rounded-full animate-pulse w-4/5 mt-1" />
              ) : (
                <p className="text-xs font-medium text-foreground">
                  "{aiSentence || stackingSentence(setup.anchorHabit, setup.name || "…")}"
                </p>
              )}
            </div>
          )}

          {/* Navigation */}
          <div className="flex gap-2 mt-4">
            {step > 0 && (
              <button
                onClick={onBack}
                className="flex items-center gap-1.5 text-sm text-muted-foreground bg-muted/50 rounded-xl px-4 py-2.5"
              >
                <ChevronLeft className="h-4 w-4" /> Back
              </button>
            )}
            <button
              onClick={isLast ? onSubmit : onNext}
              disabled={!canNext || isSubmitting}
              className="flex-1 flex items-center justify-center gap-1.5 text-sm font-semibold text-black bg-primary rounded-xl py-2.5 disabled:opacity-40"
            >
              {isLast ? (
                isSubmitting ? "Adding…" : "Add to Habit Lab"
              ) : (
                <>Next <ChevronRight className="h-4 w-4" /></>
              )}
            </button>
          </div>

          {/* Skip on optional steps */}
          {(step === 2 || step === 3) && (
            <button
              onClick={isLast ? onSubmit : onNext}
              className="w-full text-center text-xs text-muted-foreground/60 mt-2 py-1"
            >
              Skip this step
            </button>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── Step components ─────────────────────────────────────────────────────────

function Step1({ setup, setSetup }: { setup: SetupState; setSetup: (s: SetupState) => void }) {
  return (
    <div className="space-y-4">
      {/* Emoji picker */}
      <div>
        <label className="text-xs text-muted-foreground block mb-2">Choose an icon</label>
        <div className="grid grid-cols-9 gap-1">
          {EMOJIS.map(e => (
            <button
              key={e}
              onClick={() => setSetup({ ...setup, emoji: e })}
              className={`text-xl p-1.5 rounded-lg transition-all ${setup.emoji === e ? "bg-primary/30 scale-125 ring-2 ring-primary shadow-sm" : "hover:bg-muted/50"}`}
            >
              {e}
            </button>
          ))}
        </div>
      </div>

      {/* Name input */}
      <div>
        <label className="text-xs text-muted-foreground block mb-1.5">Habit name</label>
        <input
          type="text"
          value={setup.name}
          onChange={e => setSetup({ ...setup, name: e.target.value })}
          placeholder="e.g. Meditate, Cold shower, Read 20 pages…"
          className="w-full bg-muted/50 dark:bg-muted border border-border/50 rounded-xl px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 outline-none focus:border-primary/50"
        />
      </div>

      {/* Category — multi-select */}
      <div>
        <label className="text-xs text-muted-foreground block mb-2">Category <span className="opacity-50">(pick any)</span></label>
        <div className="flex flex-wrap gap-1.5">
          {CATEGORIES.map(c => {
            const selected = setup.categories.includes(c.value);
            return (
              <button
                key={c.value}
                onClick={() => {
                  const next = selected
                    ? setup.categories.filter(v => v !== c.value)
                    : [...setup.categories, c.value];
                  setSetup({ ...setup, categories: next });
                }}
                className={`text-xs px-2.5 py-1 rounded-lg border transition-all ${
                  selected
                    ? "border-primary/60 bg-primary/15 text-primary font-medium"
                    : "border-border/50 bg-muted/30 text-muted-foreground"
                }`}
              >
                {c.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Frequency */}
      <div>
        <label className="text-xs text-muted-foreground block mb-2">How often?</label>
        <div className="flex flex-wrap gap-1.5">
          {FREQUENCY_OPTIONS.map(f => (
            <button
              key={f.value}
              onClick={() => {
                const isMultiple = f.value === "multiple_daily";
                setSetup({
                  ...setup,
                  frequency: f.value,
                  // Auto-enable interval reminders for "multiple times a day"
                  ...(isMultiple && {
                    reminderEnabled: true,
                    reminderInterval: setup.reminderInterval ?? 120,
                    reminderEndTime: setup.reminderEndTime || "20:00",
                  }),
                  // Clear interval if switching away from multiple_daily
                  ...(!isMultiple && setup.frequency === "multiple_daily" && {
                    reminderInterval: null,
                  }),
                  // Clear specific days if switching away
                  ...(f.value !== "specific_days" && { specificDays: [] }),
                });
              }}
              className={`text-xs px-2.5 py-1 rounded-lg border transition-all ${
                setup.frequency === f.value
                  ? "border-primary/60 bg-primary/15 text-primary font-medium"
                  : "border-border/50 bg-muted/30 text-muted-foreground"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        {setup.frequency === "multiple_daily" && (
          <p className="text-[11px] text-primary mt-1.5">Interval reminders will be set up in the next steps.</p>
        )}
        {setup.frequency === "specific_days" && (
          <div className="mt-2.5">
            <label className="text-xs text-muted-foreground block mb-1.5">Which days?</label>
            <div className="flex gap-1">
              {DAYS_OF_WEEK.map((day, i) => {
                const key = String(i);
                const selected = setup.specificDays.includes(key);
                return (
                  <button
                    key={i}
                    onClick={() => {
                      const next = selected
                        ? setup.specificDays.filter(d => d !== key)
                        : [...setup.specificDays, key];
                      setSetup({ ...setup, specificDays: next });
                    }}
                    className={`flex-1 text-[11px] py-1.5 rounded-lg border transition-all font-medium ${
                      selected
                        ? "border-primary/60 bg-primary/15 text-primary"
                        : "border-border/50 bg-muted/30 text-muted-foreground"
                    }`}
                  >
                    {day}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Start date */}
      <StartDatePicker setup={setup} setSetup={setSetup} frequency={setup.frequency} />
    </div>
  );
}

function dateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function nextWeekday(targetDow: number): Date {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  const diff = (targetDow - d.getDay() + 7) % 7;
  d.setDate(d.getDate() + (diff === 0 ? 0 : diff));
  return d;
}

function StartDatePicker({ setup, setSetup, frequency }: { setup: SetupState; setSetup: (s: SetupState) => void; frequency: string }) {
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);

  const todayStr = dateStr(today);
  const tomorrowStr = dateStr(tomorrow);

  // For weekend habits, offer Saturday and Sunday
  const isWeekendFreq = frequency === "weekends";
  const satDate = nextWeekday(6); // Saturday
  const sunDate = nextWeekday(0); // Sunday
  const satStr = dateStr(satDate);
  const sunStr = dateStr(sunDate);

  const options: { label: string; value: string; hint?: string }[] = isWeekendFreq
    ? [
        { label: "Saturday", value: satStr, hint: satStr === todayStr ? "today" : undefined },
        { label: "Sunday",   value: sunStr, hint: sunStr === todayStr ? "today" : undefined },
      ]
    : [
        { label: "Today",    value: todayStr },
        { label: "Tomorrow", value: tomorrowStr },
      ];

  const selected = setup.startDate;
  const isDeferred = selected !== todayStr;

  return (
    <div>
      <label className="text-xs text-muted-foreground block mb-2">When do you want to start?</label>
      <div className="flex gap-2">
        {options.map(opt => (
          <button
            key={opt.value}
            onClick={() => setSetup({ ...setup, startDate: opt.value })}
            className={`flex-1 text-xs py-2 rounded-xl border font-medium transition-all ${
              selected === opt.value
                ? "border-primary/60 bg-primary/15 text-primary"
                : "border-border/50 bg-muted/30 text-muted-foreground"
            }`}
          >
            {opt.label}
            {opt.hint && <span className="ml-1 opacity-60">({opt.hint})</span>}
          </button>
        ))}
      </div>
      {isDeferred && (
        <p className="text-[11px] text-muted-foreground/60 mt-1.5">
          Today will show as a rest day. Your streak starts on your first active day.
        </p>
      )}
    </div>
  );
}

function Step2({ setup, setSetup }: { setup: SetupState; setSetup: (s: SetupState) => void }) {
  return (
    <div className="space-y-4">
      <div>
        <label className="text-xs text-muted-foreground block mb-2">What's driving this?</label>
        <div className="grid grid-cols-2 gap-2">
          {MOTIVATION_OPTIONS.map(m => (
            <button
              key={m}
              onClick={() => setSetup({ ...setup, motivation: m })}
              className={`text-xs text-left px-3 py-2 rounded-xl border transition-all ${
                setup.motivation === m
                  ? "border-primary/50 bg-primary/10 text-primary font-medium"
                  : "border-border/50 bg-muted/30 text-muted-foreground"
              }`}
            >
              {m}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="text-xs text-muted-foreground block mb-1.5">Or describe it in your own words</label>
        <textarea
          value={MOTIVATION_OPTIONS.includes(setup.motivation) ? "" : setup.motivation}
          onChange={e => setSetup({ ...setup, motivation: e.target.value })}
          placeholder="e.g. I want to feel less reactive under pressure…"
          rows={3}
          className="w-full bg-muted/50 dark:bg-muted border border-border/50 rounded-xl px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 outline-none focus:border-primary/50 resize-none"
        />
      </div>
    </div>
  );
}

function Step3({ setup, setSetup }: { setup: SetupState; setSetup: (s: SetupState) => void }) {
  const ANCHORS = [
    "waking up",
    "making coffee",
    "brushing my teeth",
    "showering",
    "finishing work",
    "eating dinner",
    "getting into bed",
  ];
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Habits stick when you <span className="font-medium text-foreground">attach them to something you already do</span>. Pick a daily anchor to chain your new habit to.
      </p>
      <div>
        <label className="text-xs text-muted-foreground block mb-2">After I…</label>
        <div className="grid grid-cols-2 gap-2">
          {ANCHORS.map(a => (
            <button
              key={a}
              onClick={() => setSetup({ ...setup, anchorHabit: setup.anchorHabit === a ? "" : a })}
              className={`text-xs text-left px-3 py-2 rounded-xl border transition-all ${
                setup.anchorHabit === a
                  ? "border-primary/50 bg-primary/10 text-primary font-medium"
                  : "border-border/50 bg-muted/30 text-muted-foreground"
              }`}
            >
              {a}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="text-xs text-muted-foreground block mb-1.5">Or write your own anchor</label>
        <input
          type="text"
          value={ANCHORS.includes(setup.anchorHabit) ? "" : setup.anchorHabit}
          onChange={e => setSetup({ ...setup, anchorHabit: e.target.value })}
          placeholder="e.g. finishing my morning run"
          className="w-full bg-muted/50 dark:bg-muted border border-border/50 rounded-xl px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 outline-none focus:border-primary/50"
        />
      </div>
    </div>
  );
}

const INTERVAL_OPTIONS = [
  { value: 30,  label: "Every 30 min" },
  { value: 60,  label: "Every hour" },
  { value: 90,  label: "Every 90 min" },
  { value: 120, label: "Every 2 hours" },
  { value: 180, label: "Every 3 hours" },
  { value: 240, label: "Every 4 hours" },
];

function Step4({ setup, setSetup, aiSentence }: { setup: SetupState; setSetup: (s: SetupState) => void; aiSentence?: string | null }) {
  const staticBody = setup.anchorHabit
    ? `After ${normalizeAnchor(setup.anchorHabit)}, time to ${normalizeHabitName(setup.name || "…")}.`
    : `Time to ${normalizeHabitName(setup.name || "…")}.`;
  const previewBody = aiSentence || staticBody;

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        A push notification keeps the habit front of mind. Set a daily time — or use interval reminders for habits like drinking water.
      </p>

      <div className="flex items-center justify-between bg-muted/40 rounded-xl px-4 py-3 border border-border/50">
        <div className="flex items-center gap-2.5">
          {setup.reminderEnabled ? (
            <Bell className="h-4 w-4 text-primary" />
          ) : (
            <BellOff className="h-4 w-4 text-muted-foreground" />
          )}
          <span className="text-sm font-medium text-foreground">Reminders</span>
        </div>
        <button
          onClick={() => setSetup({ ...setup, reminderEnabled: !setup.reminderEnabled })}
          className={`relative w-11 h-6 rounded-full transition-colors ${setup.reminderEnabled ? "bg-primary" : "bg-muted"}`}
        >
          <span className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${setup.reminderEnabled ? "translate-x-5" : "translate-x-0"}`} />
        </button>
      </div>

      {setup.reminderEnabled && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-4"
        >
          <div>
            <label className="text-xs text-muted-foreground block mb-1.5">
              {setup.reminderInterval ? "Start time" : "Reminder time"}
            </label>
            <input
              type="time"
              value={setup.reminderTime}
              onChange={e => setSetup({ ...setup, reminderTime: e.target.value })}
              className="w-full bg-muted/50 dark:bg-muted border border-border/50 rounded-xl px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary/50"
            />
          </div>

          {/* Interval toggle */}
          <div className="flex items-center justify-between bg-muted/40 rounded-xl px-4 py-3 border border-border/50">
            <div className="flex items-center gap-2.5">
              <Repeat className={`h-4 w-4 ${setup.reminderInterval ? "text-primary" : "text-muted-foreground"}`} />
              <span className="text-sm text-foreground">Repeat at intervals</span>
            </div>
            <button
              onClick={() => setSetup({ ...setup, reminderInterval: setup.reminderInterval ? null : 60 })}
              className={`relative w-11 h-6 rounded-full transition-colors ${setup.reminderInterval ? "bg-primary" : "bg-muted"}`}
            >
              <span className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${setup.reminderInterval ? "translate-x-5" : "translate-x-0"}`} />
            </button>
          </div>

          {setup.reminderInterval && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-3"
            >
              <div>
                <label className="text-xs text-muted-foreground block mb-2">Frequency</label>
                <div className="grid grid-cols-2 gap-2">
                  {INTERVAL_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => setSetup({ ...setup, reminderInterval: opt.value })}
                      className={`text-xs px-3 py-2 rounded-xl border transition-all text-left ${
                        setup.reminderInterval === opt.value
                          ? "border-primary/60 bg-primary/15 text-primary font-medium"
                          : "border-border/50 bg-muted/30 text-muted-foreground"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1.5">Stop reminders at</label>
                <input
                  type="time"
                  value={setup.reminderEndTime}
                  onChange={e => setSetup({ ...setup, reminderEndTime: e.target.value })}
                  className="w-full bg-muted/50 dark:bg-muted border border-border/50 rounded-xl px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary/50"
                />
              </div>
            </motion.div>
          )}

          <p className="text-xs text-muted-foreground/70 italic">Preview: "{previewBody}"</p>
        </motion.div>
      )}
    </div>
  );
}

// ─── Edit modal ───────────────────────────────────────────────────────────────

function EditModal({
  habit,
  onSave,
  onClose,
  isSaving,
}: {
  habit: HabitWithStatus;
  onSave: (updates: Partial<SetupState & { frequency: string }>) => void;
  onClose: () => void;
  isSaving: boolean;
}) {
  const [name, setName] = useState(habit.name);
  const [emoji, setEmoji] = useState(habit.emoji || "⭐");
  const [motivation, setMotivation] = useState(habit.motivation || "");
  const [categories, setCategories] = useState<string[]>(
    habit.category ? habit.category.split(",").filter(Boolean) : []
  );
  const [anchorHabit, setAnchorHabit] = useState(habit.anchorHabit || "");
  const [frequency, setFrequency] = useState((habit as any).frequency || "daily");
  const [specificDays, setSpecificDays] = useState<string[]>(
    (habit as any).specificDays ? (habit as any).specificDays.split(",").filter(Boolean) : []
  );
  const [reminderTime, setReminderTime] = useState(habit.reminderTime || "08:00");
  const [reminderEnabled, setReminderEnabled] = useState(habit.reminderEnabled ?? false);
  const [reminderInterval, setReminderInterval] = useState<number | null>((habit as any).reminderInterval ?? null);
  const [reminderEndTime, setReminderEndTime] = useState((habit as any).reminderEndTime || "20:00");

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 backdrop-blur-sm p-4 pb-safe"
      style={{ paddingBottom: "max(1rem, calc(env(safe-area-inset-bottom) + 1rem))" }}
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 40, opacity: 0 }}
        onClick={e => e.stopPropagation()}
        className="bg-card rounded-2xl border border-border/50 w-full max-w-md overflow-y-auto space-y-4"
        style={{ maxHeight: "80dvh" }}
      >
        <div className="p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold text-foreground">Edit habit</h3>
            <button onClick={onClose} className="text-muted-foreground/60 hover:text-muted-foreground p-1">
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Emoji */}
          <div className="grid grid-cols-9 gap-1">
            {EMOJIS.map(e => (
              <button
                key={e}
                onClick={() => setEmoji(e)}
                className={`text-xl p-1.5 rounded-lg transition-all ${emoji === e ? "bg-primary/30 scale-125 ring-2 ring-primary shadow-sm" : "hover:bg-muted/50"}`}
              >
                {e}
              </button>
            ))}
          </div>

          {/* Name */}
          <div>
            <label className="text-xs text-muted-foreground block mb-1.5">Name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full bg-muted/50 dark:bg-muted border border-border/50 rounded-xl px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary/50"
            />
          </div>

          {/* Category */}
          <div>
            <label className="text-xs text-muted-foreground block mb-2">Category <span className="opacity-50">(pick any)</span></label>
            <div className="flex flex-wrap gap-1.5">
              {CATEGORIES.map(c => {
                const selected = categories.includes(c.value);
                return (
                  <button
                    key={c.value}
                    onClick={() => setCategories(prev => selected ? prev.filter(v => v !== c.value) : [...prev, c.value])}
                    className={`text-xs px-2.5 py-1 rounded-lg border transition-all ${
                      selected ? "border-primary/60 bg-primary/15 text-primary font-medium" : "border-border/50 bg-muted/30 text-muted-foreground"
                    }`}
                  >
                    {c.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Frequency */}
          <div>
            <label className="text-xs text-muted-foreground block mb-2">How often?</label>
            <div className="flex flex-wrap gap-1.5">
              {FREQUENCY_OPTIONS.map(f => (
                <button
                  key={f.value}
                  onClick={() => {
                    setFrequency(f.value);
                    if (f.value !== "specific_days") setSpecificDays([]);
                  }}
                  className={`text-xs px-2.5 py-1 rounded-lg border transition-all ${
                    frequency === f.value ? "border-primary/60 bg-primary/15 text-primary font-medium" : "border-border/50 bg-muted/30 text-muted-foreground"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
            {frequency === "specific_days" && (
              <div className="mt-2.5">
                <label className="text-xs text-muted-foreground block mb-1.5">Which days?</label>
                <div className="flex gap-1">
                  {DAYS_OF_WEEK.map((day, i) => {
                    const key = String(i);
                    const selected = specificDays.includes(key);
                    return (
                      <button
                        key={i}
                        onClick={() => {
                          setSpecificDays(prev =>
                            selected ? prev.filter(d => d !== key) : [...prev, key]
                          );
                        }}
                        className={`flex-1 text-[11px] py-1.5 rounded-lg border transition-all font-medium ${
                          selected
                            ? "border-primary/60 bg-primary/15 text-primary"
                            : "border-border/50 bg-muted/30 text-muted-foreground"
                        }`}
                      >
                        {day}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Motivation */}
          <div>
            <label className="text-xs text-muted-foreground block mb-2">Your why</label>
            <div className="grid grid-cols-2 gap-2 mb-2">
              {MOTIVATION_OPTIONS.map(m => (
                <button
                  key={m}
                  onClick={() => setMotivation(m)}
                  className={`text-xs text-left px-3 py-2 rounded-xl border transition-all ${
                    motivation === m ? "border-primary/50 bg-primary/10 text-primary font-medium" : "border-border/50 bg-muted/30 text-muted-foreground"
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
            <textarea
              value={MOTIVATION_OPTIONS.includes(motivation) ? "" : motivation}
              onChange={e => setMotivation(e.target.value)}
              placeholder="Or describe it in your own words…"
              rows={2}
              className="w-full bg-muted/50 dark:bg-muted border border-border/50 rounded-xl px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 outline-none focus:border-primary/50 resize-none"
            />
          </div>

          {/* Anchor */}
          <div>
            <label className="text-xs text-muted-foreground block mb-1.5">Anchor routine (After I…)</label>
            <input
              type="text"
              value={anchorHabit}
              onChange={e => setAnchorHabit(e.target.value)}
              placeholder="e.g. waking up, brushing my teeth"
              className="w-full bg-muted/50 dark:bg-muted border border-border/50 rounded-xl px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 outline-none focus:border-primary/50"
            />
          </div>

          {/* Reminder */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              {reminderEnabled ? <Bell className="h-4 w-4 text-primary" /> : <BellOff className="h-4 w-4 text-muted-foreground" />}
              <span className="text-sm font-medium text-foreground">Reminders</span>
            </div>
            <button
              onClick={() => setReminderEnabled(v => !v)}
              className={`relative w-11 h-6 rounded-full transition-colors ${reminderEnabled ? "bg-primary" : "bg-muted"}`}
            >
              <span className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${reminderEnabled ? "translate-x-5" : "translate-x-0"}`} />
            </button>
          </div>

          {reminderEnabled && (
            <div className="space-y-3">
              <div>
                <label className="text-xs text-muted-foreground block mb-1.5">
                  {reminderInterval ? "Start time" : "Reminder time"}
                </label>
                <input
                  type="time"
                  value={reminderTime}
                  onChange={e => setReminderTime(e.target.value)}
                  className="w-full bg-muted/50 dark:bg-muted border border-border/50 rounded-xl px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary/50"
                />
              </div>

              <div className="flex items-center justify-between bg-muted/40 rounded-xl px-4 py-3 border border-border/50">
                <div className="flex items-center gap-2.5">
                  <Repeat className={`h-4 w-4 ${reminderInterval ? "text-primary" : "text-muted-foreground"}`} />
                  <span className="text-sm text-foreground">Repeat at intervals</span>
                </div>
                <button
                  onClick={() => setReminderInterval(v => v ? null : 60)}
                  className={`relative w-11 h-6 rounded-full transition-colors ${reminderInterval ? "bg-primary" : "bg-muted"}`}
                >
                  <span className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${reminderInterval ? "translate-x-5" : "translate-x-0"}`} />
                </button>
              </div>

              {reminderInterval && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    {INTERVAL_OPTIONS.map(opt => (
                      <button
                        key={opt.value}
                        onClick={() => setReminderInterval(opt.value)}
                        className={`text-xs px-3 py-2 rounded-xl border transition-all text-left ${
                          reminderInterval === opt.value
                            ? "border-primary/60 bg-primary/15 text-primary font-medium"
                            : "border-border/50 bg-muted/30 text-muted-foreground"
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1.5">Stop reminders at</label>
                    <input
                      type="time"
                      value={reminderEndTime}
                      onChange={e => setReminderEndTime(e.target.value)}
                      className="w-full bg-muted/50 dark:bg-muted border border-border/50 rounded-xl px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary/50"
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          <button
            onClick={() => onSave({
              name, emoji, motivation,
              category: categories.length > 0 ? categories.join(",") : "general",
              frequency, anchorHabit, reminderTime, reminderEnabled,
              specificDays: frequency === "specific_days" && specificDays.length > 0 ? specificDays.join(",") : null,
              reminderInterval: reminderEnabled ? reminderInterval : null,
              reminderEndTime: reminderEnabled && reminderInterval ? reminderEndTime : null,
            } as any)}
            disabled={!name.trim() || isSaving}
            className="w-full py-3 bg-primary text-black text-sm font-semibold rounded-xl disabled:opacity-40"
          >
            {isSaving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── Milestone Celebration ────────────────────────────────────────────────────

const MILESTONE_COPY: Record<number, { icon: string; title: string; subtitle: string; color: string }> = {
  7:   { icon: "🏁", title: "Checkpoint unlocked",   subtitle: "7 days in. You're building something real.", color: "from-primary/20 to-primary/5" },
  21:  { icon: "🔥", title: "Race pace achieved",    subtitle: "21 days. The habit is starting to wire in.", color: "from-orange-500/20 to-orange-500/5" },
  66:  { icon: "🏆", title: "Habit formed",          subtitle: "66 days. Neuroscience says it's automatic now.", color: "from-yellow-500/20 to-yellow-500/5" },
  100: { icon: "🥇", title: "Podium performance",   subtitle: "100 completions. Elite consistency.", color: "from-yellow-400/20 to-yellow-400/5" },
  365: { icon: "🚀", title: "World championship",   subtitle: "365 days. A full season of excellence.", color: "from-purple-500/20 to-purple-500/5" },
};

function MilestoneCelebration({
  milestone,
  habitName,
  onClose,
}: {
  milestone: number;
  habitName: string;
  onClose: () => void;
}) {
  const copy = MILESTONE_COPY[milestone] ?? {
    icon: "⭐", title: `${milestone}-day milestone`, subtitle: "Outstanding consistency.", color: "from-primary/20 to-primary/5",
  };

  useEffect(() => {
    const t = setTimeout(onClose, 5000);
    return () => clearTimeout(t);
  }, [onClose]);

  return (
    <motion.div
      key="milestone-celebration"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-6"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.7, opacity: 0, y: 40 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.85, opacity: 0, y: 20 }}
        transition={{ type: "spring", damping: 20, stiffness: 280 }}
        onClick={e => e.stopPropagation()}
        className={`bg-gradient-to-b ${copy.color} border border-primary/30 rounded-3xl p-8 text-center max-w-xs w-full shadow-2xl`}
        style={{ background: "var(--card)" }}
      >
        <motion.div
          animate={{ scale: [1, 1.15, 1] }}
          transition={{ repeat: Infinity, duration: 1.6, ease: "easeInOut" }}
          className="text-6xl mb-4 leading-none"
        >
          {copy.icon}
        </motion.div>

        <h2 className="text-xl font-bold text-foreground mb-1">{copy.title}</h2>
        <p className="text-sm text-muted-foreground mb-2">{copy.subtitle}</p>
        <p className="text-xs text-primary font-medium mb-6 truncate">{habitName}</p>

        <div className="flex justify-center gap-1.5 mb-5">
          {[..."⭐✨🔥💪🎯"].map((spark, i) => (
            <motion.span
              key={i}
              initial={{ opacity: 0, y: 0 }}
              animate={{ opacity: [0, 1, 0], y: -18 }}
              transition={{ delay: i * 0.12, duration: 1, repeat: Infinity, repeatDelay: 1.5 }}
              className="text-base leading-none"
            >
              {spark}
            </motion.span>
          ))}
        </div>

        <button
          onClick={onClose}
          className="w-full py-3 bg-primary text-black text-sm font-bold rounded-2xl"
        >
          Keep building →
        </button>
      </motion.div>
    </motion.div>
  );
}
