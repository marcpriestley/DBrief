import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";

interface BirthdayCelebrationProps {
  displayName?: string | null;
  dateOfBirth?: string | null;
}

function isTodayBirthday(dateOfBirth: string): boolean {
  if (!dateOfBirth) return false;
  try {
    const [, dobMonth, dobDay] = dateOfBirth.split("-");
    const today = new Date();
    const todayMonth = String(today.getMonth() + 1).padStart(2, "0");
    const todayDay = String(today.getDate()).padStart(2, "0");
    return dobMonth === todayMonth && dobDay === todayDay;
  } catch {
    return false;
  }
}

function computeAge(dateOfBirth: string): number {
  const [dobYear, dobMonth, dobDay] = dateOfBirth.split("-").map(Number);
  const today = new Date();
  let age = today.getFullYear() - dobYear;
  if (today.getMonth() + 1 < dobMonth || (today.getMonth() + 1 === dobMonth && today.getDate() < dobDay)) age--;
  return age;
}

export default function BirthdayCelebration({ displayName, dateOfBirth }: BirthdayCelebrationProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!dateOfBirth || !isTodayBirthday(dateOfBirth)) return;

    const year = new Date().getFullYear();
    const storageKey = `dbrief_birthday_celebrated_${year}`;
    if (localStorage.getItem(storageKey)) return;

    // Show after a short delay so the rest of the UI loads first
    const t = setTimeout(() => setVisible(true), 1800);
    return () => clearTimeout(t);
  }, [dateOfBirth]);

  const handleDismiss = () => {
    const year = new Date().getFullYear();
    localStorage.setItem(`dbrief_birthday_celebrated_${year}`, "true");
    setVisible(false);
  };

  const age = dateOfBirth ? computeAge(dateOfBirth) : null;
  const name = displayName?.split(" ")[0] || "Driver";

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
          onClick={handleDismiss}
        >
          <motion.div
            initial={{ scale: 0.8, opacity: 0, y: 40 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0, y: 20 }}
            transition={{ type: "spring", stiffness: 280, damping: 22 }}
            className="relative bg-card border border-border rounded-2xl p-7 max-w-sm w-full text-center shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Confetti-style ambient ring */}
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
              className="absolute inset-0 rounded-2xl border-2 border-primary/20 pointer-events-none"
            />

            {/* Cake emoji */}
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: [0, 1.3, 1] }}
              transition={{ delay: 0.2, duration: 0.5, times: [0, 0.6, 1] }}
              className="text-6xl mb-4 leading-none"
            >
              🎂
            </motion.div>

            {/* Headline */}
            <motion.h2
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.35 }}
              className="text-2xl font-bold text-foreground mb-1"
            >
              Happy Birthday, {name}
            </motion.h2>

            {age && (
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.45 }}
                className="text-sm font-medium text-primary mb-3"
              >
                {age} laps around the sun 🏁
              </motion.p>
            )}

            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.55 }}
              className="text-sm text-muted-foreground leading-relaxed mb-6"
            >
              Another year on the grid. Today is yours — run the debrief when you're ready.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.65 }}
            >
              <Button
                className="w-full"
                size="lg"
                onClick={handleDismiss}
              >
                Let's go 🚀
              </Button>
            </motion.div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
