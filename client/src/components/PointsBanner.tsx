import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { haptic } from "@/lib/haptics";

const STORAGE_KEY = "dbrief_last_points";

function PointsCelebration({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 2800);
    return () => clearTimeout(t);
  }, [onDone]);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.7, y: 8 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.8, y: -8 }}
      transition={{ type: "spring", damping: 18, stiffness: 320 }}
      className="absolute inset-0 flex items-center justify-center rounded-xl pointer-events-none z-10 overflow-hidden"
    >
      <div className="absolute inset-0 bg-primary/10 rounded-xl" />
      {[...Array(12)].map((_, i) => (
        <motion.div
          key={i}
          className="absolute w-1.5 h-1.5 rounded-full bg-primary"
          initial={{ x: 0, y: 0, opacity: 1 }}
          animate={{
            x: (Math.cos((i / 12) * Math.PI * 2) * 60),
            y: (Math.sin((i / 12) * Math.PI * 2) * 40),
            opacity: 0,
            scale: [1, 1.5, 0],
          }}
          transition={{ duration: 0.9, delay: i * 0.03, ease: "easeOut" }}
        />
      ))}
      <motion.span
        initial={{ scale: 0.5, opacity: 0 }}
        animate={{ scale: 1.1, opacity: 1 }}
        transition={{ type: "spring", damping: 12, stiffness: 400 }}
        className="text-primary font-black text-lg relative z-10"
      >
        +pts ⚡
      </motion.span>
    </motion.div>
  );
}

export default function PointsBanner() {
  const { data } = useQuery<{ points: number }>({
    queryKey: ["/api/me/points"],
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
  });

  const points = data?.points ?? null;
  const prevPointsRef = useRef<number | null>(null);
  const [celebrating, setCelebrating] = useState(false);
  const [displayPoints, setDisplayPoints] = useState<number | null>(null);
  const animRef = useRef<number | null>(null);
  const hasMounted = useRef(false);

  useEffect(() => {
    if (points === null) return;

    const stored = localStorage.getItem(STORAGE_KEY);
    const lastKnown = stored ? parseInt(stored, 10) : null;

    if (!hasMounted.current) {
      hasMounted.current = true;
      prevPointsRef.current = points;
      setDisplayPoints(points);
      if (lastKnown !== null) {
        localStorage.setItem(STORAGE_KEY, String(points));
      }
      return;
    }

    const prev = prevPointsRef.current ?? lastKnown ?? points;
    if (points > prev) {
      haptic("success");
      setCelebrating(true);
      // Animate the counter from prev to new
      const diff = points - prev;
      const duration = Math.min(diff * 30, 1200);
      const start = Date.now();
      const from = prev;

      if (animRef.current) cancelAnimationFrame(animRef.current);
      const tick = () => {
        const elapsed = Date.now() - start;
        const t = Math.min(elapsed / duration, 1);
        const eased = 1 - Math.pow(1 - t, 3);
        setDisplayPoints(Math.round(from + diff * eased));
        if (t < 1) animRef.current = requestAnimationFrame(tick);
      };
      animRef.current = requestAnimationFrame(tick);
    } else {
      setDisplayPoints(points);
    }

    prevPointsRef.current = points;
    localStorage.setItem(STORAGE_KEY, String(points));
  }, [points]);

  if (displayPoints === null) return null;

  return (
    <div className="relative bg-card rounded-xl border border-border/50 shadow-sm px-4 py-2.5 flex items-center justify-between overflow-hidden">
      <AnimatePresence>
        {celebrating && (
          <PointsCelebration onDone={() => setCelebrating(false)} />
        )}
      </AnimatePresence>
      <div className="flex items-center gap-2">
        <span className="text-base">🏆</span>
        <span className="text-xs font-medium text-muted-foreground">Performance Points</span>
      </div>
      <motion.span
        key={displayPoints}
        className="text-sm font-bold text-primary tabular-nums"
      >
        {displayPoints.toLocaleString()} pts
      </motion.span>
    </div>
  );
}
