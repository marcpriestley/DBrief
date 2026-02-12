import { useState, useEffect } from "react";
import { Flame, Trophy, Star, Zap } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface StreakDisplayProps {
  streak: any;
}

const milestones = [
  { days: 3, label: "3 Day Streak!", icon: Flame, color: "text-orange-500" },
  { days: 7, label: "1 Week!", icon: Star, color: "text-yellow-500" },
  { days: 14, label: "2 Weeks!", icon: Zap, color: "text-blue-500" },
  { days: 30, label: "1 Month!", icon: Trophy, color: "text-purple-500" },
  { days: 50, label: "50 Days!", icon: Trophy, color: "text-emerald-500" },
  { days: 100, label: "100 Days!", icon: Trophy, color: "text-red-500" },
  { days: 365, label: "1 Year!", icon: Trophy, color: "text-amber-600" },
];

function getStreakMessage(days: number): string {
  if (days === 0) return "Start your streak today!";
  if (days === 1) return "Great start! Keep it going!";
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
  const longestStreak = streak?.longestStreak || 0;

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
      <div className="flex items-center space-x-2 bg-gray-50 px-3 py-1 rounded-full">
        <Flame className="h-4 w-4 text-gray-400" />
        <span className="text-sm text-gray-500">No streak yet</span>
      </div>
    );
  }

  const nextMilestone = getNextMilestone(currentStreak);
  const currentMilestone = [...milestones].reverse().find(m => m.days <= currentStreak);

  return (
    <div className="relative">
      <motion.div 
        className="flex items-center space-x-2 bg-amber-50 px-3 py-1 rounded-full cursor-pointer group"
        animate={showAnimation ? { scale: [1, 1.2, 1] } : {}}
        transition={{ duration: 0.5 }}
        title={`${getStreakMessage(currentStreak)}${nextMilestone ? ` Next milestone: ${nextMilestone.label}` : ''}`}
      >
        <motion.div
          animate={showAnimation ? {
            rotate: [0, -10, 10, -10, 10, 0],
            scale: [1, 1.3, 1.3, 1.3, 1.3, 1]
          } : {}}
          transition={{ duration: 0.6 }}
        >
          <Flame className="h-4 w-4 text-amber-500" />
        </motion.div>
        <span className="text-sm font-medium text-amber-700">
          {currentStreak} day{currentStreak !== 1 ? 's' : ''}
        </span>
        
        <AnimatePresence>
          {showAnimation && (
            <motion.div
              initial={{ opacity: 0, y: -10, scale: 0.5 }}
              animate={{ opacity: 1, y: -30, scale: 1.5 }}
              exit={{ opacity: 0, y: -40 }}
              transition={{ duration: 0.8 }}
              className="absolute -top-8 left-1/2 transform -translate-x-1/2 text-xl font-bold text-amber-500 whitespace-nowrap"
            >
              +1
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      <AnimatePresence>
        {showMilestone && currentMilestone && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.8 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.8 }}
            transition={{ duration: 0.5 }}
            className="absolute top-full mt-2 left-1/2 transform -translate-x-1/2 bg-white shadow-lg rounded-lg px-4 py-3 text-center z-50 border border-amber-200 whitespace-nowrap"
          >
            <div className="flex items-center space-x-2">
              <Trophy className="h-5 w-5 text-amber-500" />
              <span className="text-sm font-semibold text-gray-900">{currentMilestone.label}</span>
            </div>
            <p className="text-xs text-gray-500 mt-1">{getStreakMessage(currentStreak)}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
