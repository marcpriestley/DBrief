import { useState, useEffect, useRef } from "react";
import { Flame, Zap, Snowflake, ShieldCheck, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { haptic, hapticSequence } from "@/lib/haptics";

interface FreezEvent {
  id: number;
  userId: number;
  eventType: "earned" | "used";
  reason: string;
  amount: number;
  createdAt: string | null;
}

interface FreezeData {
  freezeBalance: number;
  recentEvents: FreezEvent[];
  streakWasProtected: boolean;
  freezeUsedDate: string | null;
}

interface StreakProps {
  currentStreak: number | null;
  longestStreak: number | null;
  lastEntryDate: string | null;
  streakFreezes?: number | null;
  freezeUsedDate?: string | null;
  recentActiveDays?: number;
  insightsUnlocked?: boolean;
  dataDays?: number;
}

interface StreakDisplayProps {
  streak: StreakProps | null | undefined;
}

const MILESTONES = [
  {
    days: 7,
    label: "One Week",
    sublabel: "7 Days",
    message: "A full week of telemetry. You've established the baseline — now we build on it.",
    icon: "🔥",
    color: "from-amber-500 to-orange-500",
  },
  {
    days: 30,
    label: "One Month",
    sublabel: "30 Days",
    message: "30 days of consistent data. This is the kind of commitment that wins championships.",
    icon: "⚡",
    color: "from-yellow-400 to-amber-500",
  },
  {
    days: 90,
    label: "Quarter Season",
    sublabel: "90 Days",
    message: "Three months of high-performance living. The patterns are clear. The gains are real.",
    icon: "🏆",
    color: "from-amber-400 to-yellow-300",
  },
  {
    days: 180,
    label: "Half Season",
    sublabel: "180 Days",
    message: "Six months in. You're not trying anymore — this is just who you are.",
    icon: "🎯",
    color: "from-orange-500 to-red-500",
  },
  {
    days: 250,
    label: "Race Veteran",
    sublabel: "250 Days",
    message: "250 days. You've outlasted most drivers who started the season with you. Elite territory.",
    icon: "🏎️",
    color: "from-red-500 to-pink-500",
  },
  {
    days: 365,
    label: "Full Season",
    sublabel: "365 Days",
    message: "One complete season. 365 days of debriefs. This is what the world championship looks like.",
    icon: "👑",
    color: "from-purple-500 to-amber-500",
  },
];

const SEEN_KEY = "dbrief_seen_milestones";
const INCREMENT_DATE_KEY = "dbrief_streak_increment_date";
const SEEN_FREEZE_KEY = "dbrief_seen_freeze_event_ids";
const PROTECTED_SHOWN_KEY = "dbrief_freeze_protected_shown_id";

function getSeenMilestones(): Set<number> {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as number[]);
  } catch {
    return new Set();
  }
}

function markMilestoneSeen(days: number) {
  const seen = getSeenMilestones();
  seen.add(days);
  localStorage.setItem(SEEN_KEY, JSON.stringify(Array.from(seen)));
}

function getSeenFreezeEventIds(): Set<number> {
  try {
    const raw = localStorage.getItem(SEEN_FREEZE_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as number[]);
  } catch {
    return new Set();
  }
}

function markFreezeEventSeen(id: number) {
  const seen = getSeenFreezeEventIds();
  seen.add(id);
  const arr = Array.from(seen).slice(-200);
  localStorage.setItem(SEEN_FREEZE_KEY, JSON.stringify(arr));
}

function todayDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

function hasShownIncrementToday(): boolean {
  return localStorage.getItem(INCREMENT_DATE_KEY) === todayDateString();
}

function markIncrementShownToday(): void {
  localStorage.setItem(INCREMENT_DATE_KEY, todayDateString());
}

function getStreakMessage(days: number): string {
  if (days === 0) return "Start your streak today";
  if (days === 1) return "Session 1 in the books";
  if (days < 7) return "Building momentum";
  if (days < 30) return "Locked in";
  if (days < 90) return "Race pace";
  if (days < 180) return "Championship contender";
  if (days < 365) return "Elite tier";
  return "World champion";
}

function getNextMilestone(days: number) {
  return MILESTONES.find(m => m.days > days) || null;
}

function humanReason(reason: string): string {
  if (reason === "missed-day-protection") return "Missed day — streak protected";
  if (reason.startsWith("activity-points-")) {
    const pts = reason.replace("activity-points-", "");
    return `${pts} activity point threshold`;
  }
  return `${reason} milestone`;
}

const PARTICLE_COLORS = ["#F59E0B", "#FCD34D", "#EF4444", "#8B5CF6", "#10B981", "#3B82F6", "#F97316", "#EC4899"];

function Particle({ color, delay, angle }: { color: string; delay: number; angle: number }) {
  const distance = 200 + Math.random() * 180;
  const x = Math.cos(angle) * distance;
  const y = Math.sin(angle) * distance;
  const size = 6 + Math.random() * 8;
  const isRect = Math.random() > 0.5;

  return (
    <motion.div
      initial={{ opacity: 1, x: 0, y: 0, scale: 1, rotate: 0 }}
      animate={{
        opacity: [1, 1, 0],
        x,
        y,
        scale: [1, 1.2, 0.4],
        rotate: Math.random() > 0.5 ? 360 : -360,
      }}
      transition={{ duration: 1.4 + Math.random() * 0.6, delay, ease: "easeOut" }}
      style={{
        position: "absolute",
        width: isRect ? size * 0.6 : size,
        height: isRect ? size * 1.6 : size,
        backgroundColor: color,
        borderRadius: isRect ? 2 : "50%",
        left: "50%",
        top: "50%",
        marginLeft: -(isRect ? size * 0.3 : size / 2),
        marginTop: -(isRect ? size * 0.8 : size / 2),
      }}
    />
  );
}

function MilestoneCelebration({
  milestone,
  freezeAwarded,
  onDismiss,
}: {
  milestone: typeof MILESTONES[0];
  freezeAwarded: number;
  onDismiss: () => void;
}) {
  useEffect(() => {
    hapticSequence([
      { type: "heavy", delay: 0 },
      { type: "success", delay: 180 },
      { type: "heavy", delay: 450 },
      { type: "success", delay: 750 },
      { type: "heavy", delay: 1100 },
    ]);
    const timer = setTimeout(onDismiss, 8000);
    return () => clearTimeout(timer);
  }, []);

  const particles = Array.from({ length: 60 }, (_, i) => ({
    color: PARTICLE_COLORS[i % PARTICLE_COLORS.length],
    delay: Math.random() * 0.4,
    angle: (i / 60) * Math.PI * 2 + Math.random() * 0.3,
  }));

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.85)" }}
      onClick={onDismiss}
    >
      <motion.div
        drag="y"
        dragConstraints={{ top: -500, bottom: 0 }}
        dragElastic={{ top: 1, bottom: 0 }}
        onDragEnd={(_, info) => {
          if (info.offset.y < -60 || info.velocity.y < -400) { haptic("light"); onDismiss(); }
        }}
        initial={{ scale: 0.5, opacity: 0, y: 40 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.9, opacity: 0, y: -60 }}
        transition={{ type: "spring", damping: 16, stiffness: 280 }}
        className="relative mx-6 max-w-sm w-full cursor-grab active:cursor-grabbing"
        style={{ touchAction: "none" }}
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-center text-white/30 text-[11px] mb-2 select-none">swipe up to dismiss</p>

        <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-[#111] shadow-2xl">
          <div className={`absolute inset-0 bg-gradient-to-br ${milestone.color} opacity-10`} />

          <div className="relative px-8 pt-10 pb-8 text-center">
            <div className="relative inline-flex items-center justify-center mb-6">
              {particles.map((p, i) => (
                <Particle key={i} color={p.color} delay={p.delay} angle={p.angle} />
              ))}
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: [0, 1.3, 1] }}
                transition={{ duration: 0.6, delay: 0.2 }}
                className={`w-24 h-24 rounded-full bg-gradient-to-br ${milestone.color} flex items-center justify-center shadow-lg`}
              >
                <span className="text-4xl">{milestone.icon}</span>
              </motion.div>
            </div>

            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
            >
              <p className="text-xs font-semibold tracking-[0.2em] uppercase text-amber-400 mb-1">
                Streak Milestone
              </p>
              <h2 className="text-3xl font-black text-white mb-1">{milestone.sublabel}</h2>
              <p className="text-lg font-bold text-amber-300 mb-4">{milestone.label}</p>

              <div className="rounded-xl bg-white/5 border border-white/10 p-4 mb-4">
                <p className="text-sm text-gray-300 leading-relaxed italic">
                  "{milestone.message}"
                </p>
              </div>

              {freezeAwarded > 0 && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.75 }}
                  className="rounded-xl bg-blue-500/10 border border-blue-400/25 p-3 mb-4 flex items-center gap-3"
                >
                  <Snowflake className="h-5 w-5 text-blue-400 shrink-0" />
                  <div className="text-left">
                    <p className="text-xs font-bold text-blue-300">
                      Pit Stop Shield{freezeAwarded > 1 ? "s" : ""} Earned
                    </p>
                    <p className="text-[11px] text-blue-400/70">
                      +{freezeAwarded} streak freeze{freezeAwarded > 1 ? "s" : ""} added to your reserves
                    </p>
                  </div>
                </motion.div>
              )}

              <motion.button
                whileTap={{ scale: 0.95 }}
                onClick={onDismiss}
                className={`w-full py-3.5 rounded-xl font-bold text-sm text-black bg-gradient-to-r ${milestone.color} shadow-lg`}
              >
                Keep the streak alive →
              </motion.button>
            </motion.div>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

function FreezeProtectedToast({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    hapticSequence([
      { type: "success", delay: 0 },
      { type: "light", delay: 300 },
    ]);
    const t = setTimeout(onDone, 4500);
    return () => clearTimeout(t);
  }, []);

  return (
    <motion.div
      drag="y"
      dragConstraints={{ top: -200, bottom: 0 }}
      onDragEnd={(_, info) => { if (info.offset.y < -40) { haptic("light"); onDone(); } }}
      onClick={onDone}
      initial={{ opacity: 0, y: 60, x: "-50%" }}
      animate={{ opacity: 1, y: 0, x: "-50%" }}
      exit={{ opacity: 0, y: -20, x: "-50%" }}
      transition={{ type: "spring", damping: 18, stiffness: 260 }}
      className="fixed bottom-24 left-1/2 z-50 flex items-center gap-2.5 px-5 py-3 rounded-full bg-blue-600 shadow-lg shadow-blue-600/30 cursor-grab active:cursor-grabbing touch-none"
    >
      <ShieldCheck className="h-4 w-4 text-white" />
      <span className="text-sm font-bold text-white">Pit Stop Shield used — streak protected</span>
    </motion.div>
  );
}

function StreakIncrement({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    hapticSequence([
      { type: "heavy", delay: 0 },
      { type: "success", delay: 220 },
    ]);
    const t = setTimeout(onDone, 2500);
    return () => clearTimeout(t);
  }, []);

  return (
    <motion.div
      drag="y"
      dragConstraints={{ top: -200, bottom: 0 }}
      onDragEnd={(_, info) => { if (info.offset.y < -40) { haptic("light"); onDone(); } }}
      onClick={onDone}
      initial={{ opacity: 0, y: 60, x: "-50%" }}
      animate={{ opacity: 1, y: 0, x: "-50%" }}
      exit={{ opacity: 0, y: -20, x: "-50%" }}
      transition={{ type: "spring", damping: 18, stiffness: 260 }}
      className="fixed bottom-24 left-1/2 z-50 flex items-center gap-2.5 px-5 py-3 rounded-full bg-amber-500 shadow-lg shadow-amber-500/30 cursor-grab active:cursor-grabbing touch-none"
    >
      <Flame className="h-4 w-4 text-black" />
      <span className="text-sm font-bold text-black">Streak extended +1</span>
      <Zap className="h-4 w-4 text-black" />
    </motion.div>
  );
}

function FreezePopover({
  freezeBalance,
  recentEvents,
  streakWasProtected,
  onClose,
}: {
  freezeBalance: number;
  recentEvents: FreezEvent[];
  streakWasProtected: boolean;
  onClose: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[90] flex items-end justify-center pb-28"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 20, opacity: 0 }}
        transition={{ type: "spring", damping: 22, stiffness: 320 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm mx-4 rounded-2xl bg-[#1a1a1a] border border-white/10 shadow-2xl overflow-hidden"
      >
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <div className="flex items-center gap-2">
            <Snowflake className="h-4 w-4 text-blue-400" />
            <span className="text-sm font-bold text-white">Pit Stop Shields</span>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-4 pb-4">
          <div className="flex items-center gap-3 bg-white/5 rounded-xl p-3 mb-3">
            <div className="w-10 h-10 rounded-full bg-blue-500/20 flex items-center justify-center shrink-0">
              <Snowflake className="h-5 w-5 text-blue-400" />
            </div>
            <div>
              <p className="text-xl font-black text-white">{freezeBalance}<span className="text-sm font-medium text-gray-500"> / 5</span></p>
              <p className="text-[11px] text-gray-400">shields in reserve</p>
            </div>
          </div>

          {streakWasProtected && (
            <div className="flex items-center gap-2 bg-blue-500/10 border border-blue-400/20 rounded-xl p-2.5 mb-3">
              <ShieldCheck className="h-4 w-4 text-blue-400 shrink-0" />
              <p className="text-xs text-blue-300 font-medium">Your streak was protected recently</p>
            </div>
          )}

          <p className="text-[11px] text-gray-500 leading-relaxed mb-3">
            Shields absorb one missed day to keep your streak alive. Earn them at 7-day intervals and activity point milestones, with bonus drops at 30, 90, and 365 days.
          </p>

          {recentEvents.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] font-semibold tracking-widest uppercase text-gray-600 mb-2">Recent</p>
              {recentEvents.map((ev) => (
                <div key={ev.id} className="flex items-center gap-2.5 text-[11px]">
                  <span className={`font-bold ${ev.eventType === "earned" ? "text-blue-400" : "text-amber-400"}`}>
                    {ev.eventType === "earned" ? `+${ev.amount}` : `-${ev.amount}`}
                  </span>
                  <span className={ev.eventType === "earned" ? "text-blue-400" : "text-amber-400"}>
                    {ev.eventType === "earned" ? "❄️" : "🛡️"}
                  </span>
                  <span className="text-gray-400 truncate">{humanReason(ev.reason)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

export default function StreakDisplay({ streak }: StreakDisplayProps) {
  const currentStreak = streak?.currentStreak || 0;
  const prevStreakRef = useRef<number>(currentStreak);
  const [showIncrement, setShowIncrement] = useState(false);
  const [showProtected, setShowProtected] = useState(false);
  const [activeMilestone, setActiveMilestone] = useState<typeof MILESTONES[0] | null>(null);
  const [activeMilestoneFreezeAwarded, setActiveMilestoneFreezeAwarded] = useState(0);
  const [showFreezePopover, setShowFreezePopover] = useState(false);
  const initializedRef = useRef(false);

  const { data: freezeData } = useQuery<FreezeData>({
    queryKey: ["/api/streak-freezes"],
    refetchInterval: 30_000,
  });

  const freezeBalance = freezeData?.freezeBalance ?? 0;
  const recentEvents: FreezEvent[] = freezeData?.recentEvents ?? [];
  const streakWasProtected = freezeData?.streakWasProtected ?? false;

  // Show "protected" toast once when a new missed-day-protection event is detected
  useEffect(() => {
    if (!freezeData) return;
    const seen = getSeenFreezeEventIds();
    const unseenProtection = recentEvents.find(
      (e) => e.eventType === "used" && e.reason === "missed-day-protection" && !seen.has(e.id),
    );
    if (!unseenProtection) return;
    markFreezeEventSeen(unseenProtection.id);
    const shownKey = localStorage.getItem(PROTECTED_SHOWN_KEY);
    if (shownKey !== String(unseenProtection.id)) {
      localStorage.setItem(PROTECTED_SHOWN_KEY, String(unseenProtection.id));
      setShowProtected(true);
    }
  }, [freezeData]);

  useEffect(() => {
    if (!initializedRef.current) {
      initializedRef.current = true;
      prevStreakRef.current = currentStreak;
      return;
    }

    const prev = prevStreakRef.current;
    if (currentStreak > prev && currentStreak > 0) {
      prevStreakRef.current = currentStreak;

      const seen = getSeenMilestones();
      const newMilestone = MILESTONES.find(m => m.days === currentStreak && !seen.has(m.days));

      if (newMilestone) {
        markMilestoneSeen(newMilestone.days);
        // Check for an unseen freeze-earned event to announce in the celebration
        const seenIds = getSeenFreezeEventIds();
        const unseenEarned = recentEvents.find(
          (e) =>
            e.eventType === "earned" &&
            !e.reason.startsWith("activity-points-") &&
            !seenIds.has(e.id),
        );
        const awarded = unseenEarned?.amount ?? 0;
        if (unseenEarned) markFreezeEventSeen(unseenEarned.id);
        setActiveMilestoneFreezeAwarded(awarded);
        setActiveMilestone(newMilestone);
      } else if (!hasShownIncrementToday()) {
        markIncrementShownToday();
        setShowIncrement(true);
      }
    } else {
      prevStreakRef.current = currentStreak;
    }
  }, [currentStreak]);

  const nextMilestone = getNextMilestone(currentStreak);

  return (
    <>
      <div className="flex items-center gap-1.5">
        {/* Streak pill */}
        <motion.div
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/10 cursor-pointer"
          whileTap={{ scale: 0.92 }}
          title={`${getStreakMessage(currentStreak)}${nextMilestone ? ` · Next: ${nextMilestone.sublabel}` : " · Full season complete!"}`}
        >
          <Flame className={`h-3.5 w-3.5 ${currentStreak > 0 ? "text-amber-500" : "text-muted-foreground"}`} />
          <span className={`text-xs font-semibold ${currentStreak > 0 ? "text-amber-600" : "text-muted-foreground"}`}>
            {currentStreak}
          </span>
          {nextMilestone && currentStreak > 0 && (
            <span className="text-[10px] text-amber-500/60 font-medium">
              /{nextMilestone.days}
            </span>
          )}
        </motion.div>

        {/* Freeze pill — tap for popover */}
        <motion.div
          className={`flex items-center gap-1 px-2 py-1 rounded-full cursor-pointer transition-colors ${
            streakWasProtected
              ? "bg-blue-500/20 border border-blue-400/30"
              : freezeBalance > 0
              ? "bg-blue-500/10"
              : "bg-muted/30"
          }`}
          whileTap={{ scale: 0.92 }}
          onClick={() => { haptic("light"); setShowFreezePopover(true); }}
          title={`${freezeBalance} Pit Stop Shield${freezeBalance !== 1 ? "s" : ""}`}
        >
          {streakWasProtected ? (
            <ShieldCheck className="h-3.5 w-3.5 text-blue-400" />
          ) : (
            <Snowflake className={`h-3.5 w-3.5 ${freezeBalance > 0 ? "text-blue-400" : "text-muted-foreground"}`} />
          )}
          <span className={`text-xs font-semibold ${freezeBalance > 0 ? "text-blue-400" : "text-muted-foreground"}`}>
            {freezeBalance}
          </span>
        </motion.div>
      </div>

      <AnimatePresence>
        {showIncrement && (
          <StreakIncrement onDone={() => setShowIncrement(false)} />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showProtected && (
          <FreezeProtectedToast onDone={() => setShowProtected(false)} />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {activeMilestone && (
          <MilestoneCelebration
            milestone={activeMilestone}
            freezeAwarded={activeMilestoneFreezeAwarded}
            onDismiss={() => {
              setActiveMilestone(null);
              setActiveMilestoneFreezeAwarded(0);
            }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showFreezePopover && (
          <FreezePopover
            freezeBalance={freezeBalance}
            recentEvents={recentEvents}
            streakWasProtected={streakWasProtected}
            onClose={() => setShowFreezePopover(false)}
          />
        )}
      </AnimatePresence>
    </>
  );
}
