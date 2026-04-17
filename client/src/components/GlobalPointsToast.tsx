import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { haptic } from "@/lib/haptics";

/**
 * Always-rendered global component (lives in AuthenticatedRouter in App.tsx).
 *
 * Watches /api/me/points. When the value increases (driven by any mutation
 * that invalidates the query key), it:
 *  1. Dispatches "dbrief:points-earned" so PointsBanner can play its burst.
 *  2. Shows a floating amber pill at the top-centre of the screen for 2.5 s.
 *
 * Multiple rapid gains are merged into one pill per animation cycle.
 */

interface Toast {
  id: number;
  delta: number;
}

let _toastId = 0;

export default function GlobalPointsToast() {
  const { data } = useQuery<{ points: number; weeklyPoints: number }>({
    queryKey: ["/api/me/points"],
    staleTime: 0,
  });

  const points = data?.points ?? null;
  const prevRef = useRef<number | null>(null);
  const hasMounted = useRef(false);
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    if (points === null) return;

    if (!hasMounted.current) {
      hasMounted.current = true;
      prevRef.current = points;
      return;
    }

    const prev = prevRef.current ?? points;
    if (points > prev) {
      const delta = points - prev;

      // Notify PointsBanner (and any other listener)
      window.dispatchEvent(
        new CustomEvent("dbrief:points-earned", { detail: { delta } })
      );

      haptic("success");

      // Show floating pill
      const id = ++_toastId;
      setToasts(t => [...t, { id, delta }]);
      setTimeout(() => {
        setToasts(t => t.filter(x => x.id !== id));
      }, 2600);
    }

    prevRef.current = points;
  }, [points]);

  return (
    <div
      className="fixed inset-x-0 z-[80] flex flex-col items-center gap-2 pointer-events-none"
      style={{ top: "calc(env(safe-area-inset-top, 0px) + 4rem)" }}
    >
      <AnimatePresence>
        {toasts.map(toast => (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, y: -24, scale: 0.85 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -16, scale: 0.9 }}
            transition={{ type: "spring", stiffness: 420, damping: 26 }}
            className="bg-primary text-primary-foreground px-5 py-2 rounded-full shadow-lg font-black text-sm flex items-center gap-1.5 select-none"
          >
            ⚡ +{toast.delta} pts
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
