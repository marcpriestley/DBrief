import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";

// ── Burst animation overlay ──────────────────────────────────────────────────
// Restricted to the RIGHT half of the banner so it never covers the
// "Performance Points" label on the left.
function PointsBurst({ delta, onDone }: { delta: number; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 2400);
    return () => clearTimeout(t);
  }, [onDone]);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.7 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.8 }}
      transition={{ type: "spring", damping: 18, stiffness: 320 }}
      className="absolute right-0 top-0 bottom-0 w-1/2 flex items-center justify-center pointer-events-none z-10 overflow-hidden"
    >
      <div className="absolute inset-0 bg-primary/8 rounded-r-xl" />
      {[...Array(10)].map((_, i) => (
        <motion.div
          key={i}
          className="absolute w-1.5 h-1.5 rounded-full bg-primary"
          initial={{ x: 0, y: 0, opacity: 1 }}
          animate={{
            x: Math.cos((i / 10) * Math.PI * 2) * 44,
            y: Math.sin((i / 10) * Math.PI * 2) * 28,
            opacity: 0,
            scale: [1, 1.4, 0],
          }}
          transition={{ duration: 0.8, delay: i * 0.03, ease: "easeOut" }}
        />
      ))}
      <motion.span
        initial={{ scale: 0.5, opacity: 0 }}
        animate={{ scale: 1.1, opacity: 1 }}
        transition={{ type: "spring", damping: 12, stiffness: 400 }}
        className="text-primary font-black text-sm relative z-10"
      >
        +{delta} pts ⚡
      </motion.span>
    </motion.div>
  );
}

export default function PointsBanner() {
  const { data } = useQuery<{ points: number; weeklyPoints: number }>({
    queryKey: ["/api/me/points"],
    staleTime: 0,
  });

  const { data: rankData } = useQuery<{ rank: number; total: number }>({
    queryKey: ["/api/me/global-rank"],
    staleTime: 5 * 60 * 1000,
  });

  const points = data?.points ?? null;
  const weeklyPoints = data?.weeklyPoints ?? null;
  const [burst, setBurst] = useState<number | null>(null);   // delta for the burst
  const [displayPoints, setDisplayPoints] = useState<number | null>(null);
  const animRef = useRef<number | null>(null);
  const hasMounted = useRef(false);
  const prevPointsRef = useRef<number | null>(null);

  // Animate the counter whenever the live points value changes.
  // GlobalPointsToast is the single source of truth for detecting increases
  // and dispatching dbrief:points-earned; we do NOT trigger the burst here
  // to avoid double-firing when both this component and GlobalPointsToast see
  // the same cache update.
  useEffect(() => {
    if (points === null) return;
    if (!hasMounted.current) {
      hasMounted.current = true;
      prevPointsRef.current = points;
      setDisplayPoints(points);
      return;
    }
    const prev = prevPointsRef.current ?? points;
    if (points > prev) {
      const delta = points - prev;
      const duration = Math.min(delta * 30, 1000);
      const start = Date.now();
      const from = prev;
      if (animRef.current) cancelAnimationFrame(animRef.current);
      const tick = () => {
        const t = Math.min((Date.now() - start) / duration, 1);
        const eased = 1 - Math.pow(1 - t, 3);
        setDisplayPoints(Math.round(from + delta * eased));
        if (t < 1) animRef.current = requestAnimationFrame(tick);
      };
      animRef.current = requestAnimationFrame(tick);
    } else {
      setDisplayPoints(points);
    }
    prevPointsRef.current = points;
  }, [points]);

  // Burst plays only when GlobalPointsToast fires the event — single source of truth.
  useEffect(() => {
    const onEarned = (e: Event) => {
      const delta = (e as CustomEvent<{ delta: number }>).detail?.delta ?? 0;
      if (delta > 0) setBurst(delta);
    };
    window.addEventListener("dbrief:points-earned", onEarned);
    return () => window.removeEventListener("dbrief:points-earned", onEarned);
  }, []);

  if (displayPoints === null) return null;

  return (
    <div className="relative bg-card rounded-xl border border-border/50 shadow-sm px-4 py-2.5 flex items-center justify-between overflow-hidden">
      <AnimatePresence>
        {burst !== null && (
          <PointsBurst key={burst + Date.now()} delta={burst} onDone={() => setBurst(null)} />
        )}
      </AnimatePresence>
      <div className="flex items-center gap-2">
        <span className="text-base">🏆</span>
        <span className="text-xs font-medium text-muted-foreground">Performance Points</span>
      </div>
      <div className="flex items-center gap-3">
        {weeklyPoints !== null && (
          <div className="flex flex-col items-end">
            <span className="text-[10px] font-medium text-muted-foreground leading-none">This week</span>
            <span className="text-xs font-bold text-foreground tabular-nums">{weeklyPoints.toLocaleString()} pts</span>
          </div>
        )}
        <div className="w-px h-6 bg-border/60" />
        <div className="flex flex-col items-end">
          <span className="text-[10px] font-medium text-muted-foreground leading-none">Lifetime</span>
          <motion.span
            key={displayPoints}
            className="text-xs font-bold text-primary tabular-nums"
          >
            {displayPoints.toLocaleString()} pts
          </motion.span>
        </div>
        {rankData && (
          <>
            <div className="w-px h-6 bg-border/60" />
            <div className="flex flex-col items-end">
              <span className="text-[10px] font-medium text-muted-foreground leading-none">Global</span>
              <span className="text-xs font-bold text-foreground tabular-nums">
                #{rankData.rank.toLocaleString()}
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
