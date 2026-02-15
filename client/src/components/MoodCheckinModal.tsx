import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Smile, Frown, Meh, Heart, X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface MoodCheckinModalProps {
  open: boolean;
  onClose: () => void;
}

function getMoodEmoji(value: number) {
  if (value >= 80) return { icon: Heart, color: "text-pink-500", label: "Amazing" };
  if (value >= 60) return { icon: Smile, color: "text-green-500", label: "Good" };
  if (value >= 40) return { icon: Meh, color: "text-yellow-500", label: "Okay" };
  if (value >= 20) return { icon: Frown, color: "text-orange-500", label: "Low" };
  return { icon: Frown, color: "text-red-500", label: "Struggling" };
}

function getMoodColor(value: number) {
  if (value >= 80) return "#EC4899";
  if (value >= 60) return "#22C55E";
  if (value >= 40) return "#EAB308";
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
      const res = await apiRequest("POST", "/api/mood-checkins", {
        value,
        label: timeOfDay,
      });
      return res.json();
    },
    onSuccess: () => {
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
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-center">{timeLabels[timeOfDay]}</DialogTitle>
          <DialogDescription className="text-center">
            How are you feeling right now?
          </DialogDescription>
        </DialogHeader>

        <div className="py-6 space-y-8">
          <div className="text-center">
            <motion.div
              key={mood.label}
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 300 }}
              className="inline-block"
            >
              <MoodIcon className={`h-16 w-16 mx-auto ${mood.color}`} />
            </motion.div>
            <motion.p
              key={`label-${mood.label}`}
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-lg font-semibold mt-3"
              style={{ color: getMoodColor(moodValue) }}
            >
              {mood.label}
            </motion.p>
            <p className="text-3xl font-bold text-gray-900 mt-1">{moodValue}</p>
          </div>

          <div className="px-4">
            <Slider
              value={[moodValue]}
              onValueChange={(v) => setMoodValue(v[0])}
              min={0}
              max={100}
              step={1}
              className="w-full"
            />
            <div className="flex justify-between mt-2 text-xs text-gray-400">
              <span>0</span>
              <span>50</span>
              <span>100</span>
            </div>
          </div>

          <div className="flex gap-2 px-4">
            {[20, 40, 60, 80].map((preset) => {
              const p = getMoodEmoji(preset);
              const PIcon = p.icon;
              return (
                <button
                  key={preset}
                  onClick={() => setMoodValue(preset)}
                  className={`flex-1 py-2 rounded-lg border text-center transition-all ${
                    Math.abs(moodValue - preset) < 10
                      ? "border-primary bg-primary/5"
                      : "border-gray-200 hover:border-gray-300"
                  }`}
                >
                  <PIcon className={`h-5 w-5 mx-auto ${p.color}`} />
                  <span className="text-xs text-gray-500 mt-1 block">{preset}</span>
                </button>
              );
            })}
          </div>

          <Button
            onClick={() => saveMutation.mutate(moodValue)}
            disabled={saveMutation.isPending}
            className="w-full"
            size="lg"
          >
            {saveMutation.isPending ? "Saving..." : "Log Mood"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
