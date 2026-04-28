import { useState, useRef, useEffect } from "react";
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

// Uses a native <input type="range"> so iOS WKWebView handles touch at the OS
// layer — bypasses JavaScript touch-event competition on cold starts.
function MoodSlider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const lastHapticVal = useRef<number | null>(null);
  const color = getMoodColor(value);
  const pct = Math.max(0, Math.min(100, value));

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value);
    onChange(v);
    if (lastHapticVal.current === null || Math.abs(v - lastHapticVal.current) >= 5) {
      haptic("light");
      lastHapticVal.current = v;
    }
  };

  const handleCommit = () => { lastHapticVal.current = null; };

  return (
    <input
      type="range"
      min={0}
      max={100}
      step={1}
      value={value}
      onChange={handleChange}
      onMouseUp={handleCommit}
      onTouchEnd={handleCommit}
      className="native-range w-full"
      style={{
        background: `linear-gradient(to right, ${color} ${pct}%, hsl(var(--muted)) ${pct}%)`,
        "--thumb-color": color,
      } as React.CSSProperties}
    />
  );
}

export default function MoodCheckinModal({ open, onClose }: MoodCheckinModalProps) {
  const [moodValue, setMoodValue] = useState(50);
  const seededRef = useRef(false);
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

  return (
    <AnimatePresence>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
          style={{ touchAction: 'none' }}
          onTouchStart={(e) => e.stopPropagation()}
          onTouchMove={(e) => { e.preventDefault(); e.stopPropagation(); }}
          onTouchEnd={(e) => e.stopPropagation()}
        >
          <motion.div
            className="fixed inset-0 bg-black/50"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            className="relative bg-background rounded-t-2xl sm:rounded-2xl shadow-xl w-full max-w-xs mx-0 sm:mx-4 z-10 pt-5 px-5"
            style={{ paddingBottom: 'calc(20px + var(--sai-bottom, env(safe-area-inset-bottom, 0px)))' }}
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
              {/* Emoji display */}
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

              {/* Native slider — reliable drag on iOS WKWebView */}
              <div className="px-2">
                <MoodSlider value={moodValue} onChange={setMoodValue} />
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
