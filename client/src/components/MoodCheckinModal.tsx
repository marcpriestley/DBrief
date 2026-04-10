import { useState, useRef, useEffect, useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { haptic } from "@/lib/haptics";
import { motion, AnimatePresence } from "framer-motion";
import { Smile, Frown, Meh, Heart, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface MoodCheckinModalProps {
  open: boolean;
  onClose: () => void;
}

function getMoodEmoji(value: number) {
  if (value >= 80) return { icon: Heart, color: "text-pink-500", bg: "bg-pink-50", label: "Amazing" };
  if (value >= 60) return { icon: Smile, color: "text-emerald-500", bg: "bg-emerald-50", label: "Good" };
  if (value >= 40) return { icon: Meh, color: "text-amber-500", bg: "bg-amber-50", label: "Okay" };
  if (value >= 20) return { icon: Frown, color: "text-orange-500", bg: "bg-orange-50", label: "Low" };
  return { icon: Frown, color: "text-red-500", bg: "bg-red-50", label: "Struggling" };
}

function getMoodColor(value: number) {
  if (value >= 80) return "#EC4899";
  if (value >= 60) return "#10B981";
  if (value >= 40) return "#F59E0B";
  if (value >= 20) return "#F97316";
  return "#EF4444";
}

const timeLabels: Record<string, string> = {
  morning: "Morning Check-in",
  afternoon: "Afternoon Check-in",
  evening: "Evening Check-in",
};

function getTimeOfDayLabel(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}

function MoodSlider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const lastHapticVal = useRef<number | null>(null);
  // Keep a stable ref to the latest value so computeValue never rebuilds mid-drag
  const valueRef = useRef(value);
  useEffect(() => { valueRef.current = value; }, [value]);
  const moodColor = getMoodColor(value);

  // Stable: no reactive deps — reads from the DOM and the ref, never from closure-captured value
  const computeValue = useCallback((clientX: number): number => {
    if (!trackRef.current) return valueRef.current;
    const rect = trackRef.current.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return Math.round(pct * 100);
  }, []);

  const emitValue = useCallback((clientX: number) => {
    const newVal = computeValue(clientX);
    onChange(newVal);
    if (lastHapticVal.current === null || Math.abs(newVal - lastHapticVal.current) >= 5) {
      haptic("light");
      lastHapticVal.current = newVal;
    }
  }, [computeValue, onChange]);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    isDragging.current = true;
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    emitValue(e.clientX);
  }, [emitValue]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging.current) return;
    emitValue(e.clientX);
  }, [emitValue]);

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    isDragging.current = false;
    emitValue(e.clientX);
  }, [emitValue]);

  return (
    <div
      ref={trackRef}
      className="relative w-full select-none"
      style={{ height: 48, touchAction: "none", cursor: "pointer" }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      {/* Track background */}
      <div className="absolute top-1/2 -translate-y-1/2 inset-x-0 h-2 rounded-full bg-border" />
      {/* Filled portion */}
      <div
        className="absolute top-1/2 -translate-y-1/2 left-0 h-2 rounded-full pointer-events-none"
        style={{ width: `${value}%`, backgroundColor: moodColor }}
      />
      {/* Thumb */}
      <div
        className="absolute top-1/2 -translate-y-1/2 w-7 h-7 rounded-full shadow-md border-2 border-white pointer-events-none"
        style={{ left: `calc(${value}% - 14px)`, backgroundColor: moodColor }}
      />
    </div>
  );
}

export default function MoodCheckinModal({ open, onClose }: MoodCheckinModalProps) {
  const [moodValue, setMoodValue] = useState(50);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const mood = getMoodEmoji(moodValue);
  const MoodIcon = mood.icon;
  const timeOfDay = getTimeOfDayLabel();

  const saveMutation = useMutation({
    mutationFn: async (value: number) => {
      const res = await apiRequest("POST", "/api/mood-checkins", { value, label: timeOfDay });
      return res.json();
    },
    onSuccess: () => {
      haptic("success");
      toast({ title: "Mood logged", description: `Your ${timeLabels[timeOfDay].toLowerCase()} has been saved.` });
      queryClient.invalidateQueries({ queryKey: ["/api/mood-checkins"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dates-with-data"] });
      onClose();
      setMoodValue(50);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save mood check-in.", variant: "destructive" });
    },
  });

  useEffect(() => {
    if (open) {
      // Prevent background scroll by hiding overflow on the root element.
      // This avoids the visible "jump to top" that position:fixed causes on iOS.
      const prev = document.documentElement.style.overflow;
      document.documentElement.style.overflow = "hidden";
      return () => {
        document.documentElement.style.overflow = prev;
      };
    }
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <motion.div
            className="fixed inset-0 bg-black/50"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            className="relative bg-background rounded-t-2xl sm:rounded-2xl shadow-xl w-full max-w-xs mx-0 sm:mx-4 z-10 p-5"
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 40 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <button
              className="absolute top-3 right-3 text-muted-foreground hover:text-foreground p-1"
              onClick={onClose}
            >
              <X className="h-4 w-4" />
            </button>

            <div className="mb-4">
              <h2 className="text-base font-semibold">{timeLabels[timeOfDay]}</h2>
              <p className="text-xs text-muted-foreground">How are you feeling right now?</p>
            </div>

            <div className="py-2 space-y-6">
              <div className="text-center">
                <motion.div
                  key={mood.label}
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: "spring", stiffness: 300 }}
                  className={`inline-flex items-center justify-center w-16 h-16 rounded-2xl ${mood.bg}`}
                >
                  <MoodIcon className={`h-8 w-8 ${mood.color}`} />
                </motion.div>
                <motion.p
                  key={`label-${mood.label}`}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-sm font-semibold mt-2"
                  style={{ color: getMoodColor(moodValue) }}
                >
                  {mood.label}
                </motion.p>
                <p className="text-2xl font-bold text-foreground mt-0.5">{moodValue}</p>
              </div>

              <div className="px-2">
                <MoodSlider value={moodValue} onChange={setMoodValue} />
                <div className="flex justify-between mt-1 text-[10px] text-muted-foreground">
                  <span>0</span>
                  <span>50</span>
                  <span>100</span>
                </div>
              </div>

              <div className="flex gap-1.5 px-1">
                {[20, 40, 60, 80].map((preset) => {
                  const p = getMoodEmoji(preset);
                  const PIcon = p.icon;
                  return (
                    <button
                      key={preset}
                      onClick={() => setMoodValue(preset)}
                      className={`flex-1 py-2 rounded-lg border text-center transition-all ${
                        Math.abs(moodValue - preset) < 10
                          ? "border-primary bg-primary/5 shadow-sm"
                          : "border-border hover:border-border/80"
                      }`}
                    >
                      <PIcon className={`h-4 w-4 mx-auto ${p.color}`} />
                      <span className="text-[10px] text-muted-foreground mt-0.5 block">{preset}</span>
                    </button>
                  );
                })}
              </div>

              <Button
                onClick={() => saveMutation.mutate(moodValue)}
                disabled={saveMutation.isPending}
                className="w-full h-9 text-sm"
              >
                {saveMutation.isPending ? "Saving..." : "Log Mood"}
              </Button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
