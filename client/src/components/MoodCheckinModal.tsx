import { useState, useRef, useEffect, useLayoutEffect, useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
  if (value >= 80) return { icon: Heart, color: "text-pink-500", bg: "bg-pink-50 dark:bg-pink-950/30", label: "Amazing" };
  if (value >= 60) return { icon: Smile, color: "text-emerald-500", bg: "bg-emerald-50 dark:bg-emerald-950/30", label: "Good" };
  if (value >= 40) return { icon: Meh, color: "text-amber-500", bg: "bg-amber-50 dark:bg-amber-950/30", label: "Okay" };
  if (value >= 20) return { icon: Frown, color: "text-orange-500", bg: "bg-orange-50 dark:bg-orange-950/30", label: "Low" };
  return { icon: Frown, color: "text-red-500", bg: "bg-red-50 dark:bg-red-950/30", label: "Struggling" };
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

// Static style — never regenerated. Track fill + thumb colour come from CSS vars
// set directly on the slider wrapper via ref, avoiding per-frame style recalculation.
const SLIDER_STYLE = `
  .mood-slider {
    -webkit-appearance: none;
    appearance: none;
    width: 100%;
    height: 48px;
    background: transparent;
    cursor: pointer;
    touch-action: none;
  }
  .mood-slider::-webkit-slider-runnable-track {
    height: 8px;
    border-radius: 9999px;
    background: linear-gradient(
      to right,
      var(--mood-color) var(--mood-pct),
      hsl(var(--border)) var(--mood-pct)
    );
  }
  .mood-slider::-moz-range-track {
    height: 8px;
    border-radius: 9999px;
    background: hsl(var(--border));
  }
  .mood-slider::-moz-range-progress {
    height: 8px;
    border-radius: 9999px;
    background: var(--mood-color);
  }
  .mood-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: var(--mood-color);
    border: 2px solid white;
    box-shadow: 0 2px 6px rgba(0,0,0,0.25);
    margin-top: -10px;
    transition: transform 0.1s ease;
  }
  .mood-slider:active::-webkit-slider-thumb { transform: scale(1.15); }
  .mood-slider::-moz-range-thumb {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: var(--mood-color);
    border: 2px solid white;
    box-shadow: 0 2px 6px rgba(0,0,0,0.25);
    cursor: pointer;
  }
  .mood-slider:focus { outline: none; }
`;

export default function MoodCheckinModal({ open, onClose }: MoodCheckinModalProps) {
  const [moodValue, setMoodValue] = useState(50);
  const seededRef = useRef(false);
  const lastHapticVal = useRef<number | null>(null);
  const sliderWrapRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const mood = getMoodEmoji(moodValue);
  const MoodIcon = mood.icon;
  const timeOfDay = getTimeOfDayLabel();
  const moodColor = getMoodColor(moodValue);

  const todayStr = new Date().toLocaleDateString("en-CA");
  const { data: todayCheckins } = useQuery<Array<{ value: number; label: string }>>({
    queryKey: ["/api/mood-checkins", todayStr],
    queryFn: async () => {
      const res = await fetch(`/api/mood-checkins/${todayStr}`, { credentials: "include" });
      return res.json();
    },
    enabled: open,
    staleTime: 0,
  });

  useEffect(() => {
    if (!open) { seededRef.current = false; return; }
    if (seededRef.current || !todayCheckins) return;
    const matching = [...todayCheckins].reverse().find(c => c.label === timeOfDay);
    if (matching) setMoodValue(matching.value);
    seededRef.current = true;
  }, [open, todayCheckins, timeOfDay]);

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
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save mood check-in.", variant: "destructive" });
    },
  });

  useEffect(() => {
    if (open) {
      const prev = document.documentElement.style.overflow;
      document.documentElement.style.overflow = "hidden";
      return () => { document.documentElement.style.overflow = prev; };
    }
  }, [open]);

  // Directly update CSS vars on the wrapper element — no style tag recreation, no forced layout.
  const syncCssVars = useCallback((val: number) => {
    const el = sliderWrapRef.current;
    if (!el) return;
    const color = getMoodColor(val);
    el.style.setProperty("--mood-color", color);
    el.style.setProperty("--mood-pct", `${val}%`);
  }, []);

  // Sync CSS vars before paint whenever the modal opens or the value changes.
  // useLayoutEffect ensures vars are set synchronously after the ref div mounts,
  // preventing the transparent-slider flash caused by useEffect running post-paint.
  useLayoutEffect(() => {
    if (open) syncCssVars(moodValue);
  }, [open, moodValue, syncCssVars]);

  function handleSliderChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = parseInt(e.target.value, 10);
    syncCssVars(val);   // update track/thumb instantly via CSS vars — no layout stall
    setMoodValue(val);  // update displayed number + emoji (less frequent re-render cost)
    if (lastHapticVal.current === null || Math.abs(val - lastHapticVal.current) >= 5) {
      haptic("light");
      lastHapticVal.current = val;
    }
  }

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
              {/* Emoji display — only animates when label category changes */}
              <div className="text-center">
                <AnimatePresence mode="wait">
                  <motion.div
                    key={mood.label}
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.8, opacity: 0 }}
                    transition={{ duration: 0.15 }}
                    className={`inline-flex items-center justify-center w-16 h-16 rounded-2xl ${mood.bg}`}
                  >
                    <MoodIcon className={`h-8 w-8 ${mood.color}`} />
                  </motion.div>
                </AnimatePresence>
                <p className="text-sm font-semibold mt-2 transition-colors duration-150" style={{ color: moodColor }}>
                  {mood.label}
                </p>
                <p className="text-2xl font-bold text-foreground mt-0.5 tabular-nums">{moodValue}</p>
              </div>

              {/* Range slider — track fill/thumb colour driven by CSS vars on the wrapper, */}
              {/* updated directly via DOM ref to avoid per-frame style tag recreation.      */}
              <div className="px-2" ref={sliderWrapRef}>
                <style dangerouslySetInnerHTML={{ __html: SLIDER_STYLE }} />
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={moodValue}
                  onChange={handleSliderChange}
                  className="mood-slider"
                />
                <div className="flex justify-between mt-1 text-[10px] text-muted-foreground">
                  <span>0</span>
                  <span>50</span>
                  <span>100</span>
                </div>
              </div>

              {/* Quick-pick presets */}
              <div className="flex gap-1.5 px-1">
                {[20, 40, 60, 80].map((preset) => {
                  const p = getMoodEmoji(preset);
                  const PIcon = p.icon;
                  return (
                    <button
                      key={preset}
                      onClick={() => { haptic("select"); setMoodValue(preset); }}
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
