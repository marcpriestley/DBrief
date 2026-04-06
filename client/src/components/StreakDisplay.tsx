import { useState, useEffect, useRef } from "react";
import { Flame, Trophy, X, Zap, Target } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { haptic } from "@/lib/haptics";

interface StreakDisplayProps {
  streak: any;
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
  localStorage.setItem(SEEN_KEY, JSON.stringify([...seen]));
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
  onDismiss,
}: {
  milestone: typeof MILESTONES[0];
  onDismiss: () => void;
}) {
  useEffect(() => {
    haptic("success");
    const timer = setTimeout(onDismiss, 7000);
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
        initial={{ scale: 0.5, opacity: 0, y: 40 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.9, opacity: 0, y: -20 }}
        transition={{ type: "spring", damping: 16, stiffness: 280 }}
        className="relative mx-6 max-w-sm w-full"
        onClick={(e) => e.stopPropagation()}
      >
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
              <p className="text-lg font-bold text-amber-300 mb-6">{milestone.label}</p>

              <div className="rounded-xl bg-white/5 border border-white/10 p-4 mb-6">
                <p className="text-sm text-gray-300 leading-relaxed italic">
                  "{milestone.message}"
                </p>
              </div>

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

function StreakIncrement({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    haptic("medium");
    const t = setTimeout(onDone, 2500);
    return () => clearTimeout(t);
  }, []);

  return (
    <motion.div
      drag="y"
      dragConstraints={{ top: -200, bottom: 0 }}
      onDragEnd={(_, info) => { if (info.offset.y < -40) onDone(); }}
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

export default function StreakDisplay({ streak }: StreakDisplayProps) {
  const currentStreak = streak?.currentStreak || 0;
  const prevStreakRef = useRef<number>(currentStreak);
  const [showIncrement, setShowIncrement] = useState(false);
  const [activeMilestone, setActiveMilestone] = useState<typeof MILESTONES[0] | null>(null);
  const initializedRef = useRef(false);

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
        setActiveMilestone(newMilestone);
      } else {
        setShowIncrement(true);
      }
    } else {
      prevStreakRef.current = currentStreak;
    }
  }, [currentStreak]);

  const nextMilestone = getNextMilestone(currentStreak);

  return (
    <>
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

      <AnimatePresence>
        {showIncrement && (
          <StreakIncrement onDone={() => setShowIncrement(false)} />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {activeMilestone && (
          <MilestoneCelebration
            milestone={activeMilestone}
            onDismiss={() => setActiveMilestone(null)}
          />
        )}
      </AnimatePresence>
    </>
  );
}
