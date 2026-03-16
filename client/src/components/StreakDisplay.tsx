import { useState, useEffect } from "react";
import { Flame, Trophy } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface StreakDisplayProps {
  streak: any;
}

const milestones = [
  { days: 3, label: "3 Day Streak!" },
  { days: 7, label: "1 Week!" },
  { days: 14, label: "2 Weeks!" },
  { days: 30, label: "1 Month!" },
  { days: 50, label: "50 Days!" },
  { days: 100, label: "100 Days!" },
  { days: 365, label: "1 Year!" },
];

function getStreakMessage(days: number): string {
  if (days === 0) return "Start your streak today!";
  if (days === 1) return "Great start!";
  if (days < 3) return "Building momentum!";
  if (days < 7) return "You're on fire!";
  if (days < 14) return "Incredible consistency!";
  if (days < 30) return "Unstoppable!";
  if (days < 50) return "Legendary dedication!";
  if (days < 100) return "You're a champion!";
  return "Absolute legend!";
}

function getNextMilestone(days: number): { days: number; label: string } | null {
  return milestones.find(m => m.days > days) || null;
}

export default function StreakDisplay({ streak }: StreakDisplayProps) {
  const [previousStreak, setPreviousStreak] = useState<number>(0);
  const [showAnimation, setShowAnimation] = useState(false);
  const [showMilestone, setShowMilestone] = useState(false);
  
  const currentStreak = streak?.currentStreak || 0;

  useEffect(() => {
    if (currentStreak > 0 && previousStreak > 0 && currentStreak > previousStreak) {
      setShowAnimation(true);
      setTimeout(() => setShowAnimation(false), 2000);
      
      const milestone = milestones.find(m => m.days === currentStreak);
      if (milestone) {
        setShowMilestone(true);
        setTimeout(() => setShowMilestone(false), 3000);
      }
    }
    if (currentStreak > 0) {
      setPreviousStreak(currentStreak);
    }
  }, [currentStreak]);

  if (!streak || currentStreak === 0) {
    return (
      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-muted/60">
        <Flame className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">0</span>
      </div>
    );
  }

  const nextMilestone = getNextMilestone(currentStreak);
  const currentMilestone = [...milestones].reverse().find(m => m.days <= currentStreak);

  return (
    <div className="relative">
      <motion.div 
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/10 cursor-pointer"
        animate={showAnimation ? { scale: [1, 1.15, 1] } : {}}
        transition={{ duration: 0.4 }}
        title={`${getStreakMessage(currentStreak)}${nextMilestone ? ` Next: ${nextMilestone.label}` : ''}`}
      >
        <motion.div
          animate={showAnimation ? {
            rotate: [0, -10, 10, -10, 0],
            scale: [1, 1.2, 1.2, 1.2, 1]
          } : {}}
          transition={{ duration: 0.5 }}
        >
          <Flame className="h-3.5 w-3.5 text-amber-500" />
        </motion.div>
        <span className="text-xs font-semibold text-amber-600">
          {currentStreak}
        </span>
        
        <AnimatePresence>
          {showAnimation && (
            <motion.span
              initial={{ opacity: 0, y: 0, scale: 0.5 }}
              animate={{ opacity: 1, y: -20, scale: 1.2 }}
              exit={{ opacity: 0, y: -28 }}
              transition={{ duration: 0.6 }}
              className="absolute -top-5 left-1/2 -translate-x-1/2 text-xs font-bold text-amber-500"
            >
              +1
            </motion.span>
          )}
        </AnimatePresence>
      </motion.div>

      <AnimatePresence>
        {showMilestone && currentMilestone && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.9 }}
            className="absolute top-full mt-2 left-1/2 -translate-x-1/2 bg-card shadow-lg rounded-lg px-3 py-2 text-center z-50 border border-amber-200 whitespace-nowrap"
          >
            <div className="flex items-center gap-1.5">
              <Trophy className="h-4 w-4 text-amber-500" />
              <span className="text-xs font-semibold text-foreground">{currentMilestone.label}</span>
            </div>
            <p className="text-[10px] text-muted-foreground mt-0.5">{getStreakMessage(currentStreak)}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
