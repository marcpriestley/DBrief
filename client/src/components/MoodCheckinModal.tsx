import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { haptic } from "@/lib/haptics";
import { motion } from "framer-motion";
import { Smile, Frown, Meh, Heart } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
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

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xs">
        <DialogHeader className="text-center">
          <DialogTitle className="text-base">{timeLabels[timeOfDay]}</DialogTitle>
          <DialogDescription className="text-xs">How are you feeling right now?</DialogDescription>
        </DialogHeader>

        <div className="py-4 space-y-6">
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
            <input
              type="range"
              value={moodValue}
              onChange={(e) => setMoodValue(Number(e.target.value))}
              min={0}
              max={100}
              step={1}
              className="w-full h-2 rounded-full appearance-none cursor-pointer"
              style={{
                touchAction: "none",
                accentColor: "hsl(40, 95%, 48%)",
              }}
            />
            <div className="flex justify-between mt-1.5 text-[10px] text-muted-foreground">
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
      </DialogContent>
    </Dialog>
  );
}
