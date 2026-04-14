import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Target, X, Flame, Lock, RefreshCw, Volume2, Square, PauseCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { AIInsight } from "@shared/schema";
import { useTTS } from "@/hooks/useTTS";

type StreakResponse = {
  currentStreak: number;
  longestStreak: number;
  lastEntryDate: string | null;
  recentActiveDays: number;
  insightsUnlocked: boolean;
};

const UNLOCK_THRESHOLD = 7;
const MAINTAIN_THRESHOLD = 5;

export default function AIInsights() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const tts = useTTS();

  const { data: insights = [] } = useQuery<AIInsight[]>({
    queryKey: ["/api/ai-insights"],
  });

  const { data: streak, isLoading: streakLoading } = useQuery<StreakResponse>({
    queryKey: ["/api/streak"],
  });

  const generateInsightMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/ai-insights/generate", {});
      return res.json();
    },
    onSuccess: (data) => {
      if (data.needsStreak) {
        toast({
          title: "Keep building",
          description: `Log 7 consecutive days to unlock Mission Intelligence. You're at ${data.currentStreak} days.`,
        });
      } else if (data.needsDataRichness) {
        toast({
          title: "Insufficient data",
          description: `Log today's telemetry to restore analysis. You have ${data.recentActiveDays}/7 recent days.`,
        });
      } else {
        queryClient.invalidateQueries({ queryKey: ["/api/ai-insights"] });
      }
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to run trajectory analysis.", variant: "destructive" });
    },
  });

  const dismissInsightMutation = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/ai-insights/${id}`, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/ai-insights"] }),
  });

  const latestInsight = insights[0];
  if (streakLoading) return null;

  const currentStreak    = streak?.currentStreak    ?? 0;
  const longestStreak    = streak?.longestStreak    ?? 0;
  const recentActiveDays = streak?.recentActiveDays ?? 0;
  const insightsUnlocked = streak?.insightsUnlocked ?? false;
  const everUnlocked     = longestStreak >= UNLOCK_THRESHOLD;

  // ── State 1: Never unlocked ───────────────────────────────────────────────
  if (!everUnlocked) {
    const progress = Math.min(100, Math.round((currentStreak / UNLOCK_THRESHOLD) * 100));
    return (
      <Card className="border-0 shadow-sm bg-card">
        <CardContent className="p-5">
          <div className="flex items-center gap-2 mb-1">
            <Lock className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold text-foreground">Mission Intelligence</h3>
            <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full ml-1">Locked</span>
          </div>
          <p className="text-xs text-muted-foreground mb-1 opacity-70">90-day trajectory · goal alignment</p>
          <p className="text-sm text-muted-foreground mb-3 mt-2">
            Build a 7-day streak to unlock long-term analysis. Once unlocked, one missed day won't cost you access.
          </p>
          <div className="flex items-center gap-3">
            <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-orange-400 to-amber-400 rounded-full transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className="text-xs font-medium text-muted-foreground flex items-center gap-1">
              <Flame className="h-3.5 w-3.5 text-orange-400" />
              {currentStreak}/{UNLOCK_THRESHOLD}
            </span>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ── State 2: Unlocked but data window thin ────────────────────────────────
  if (!insightsUnlocked) {
    const daysNeeded = MAINTAIN_THRESHOLD - recentActiveDays;
    const progress = Math.min(100, Math.round((recentActiveDays / MAINTAIN_THRESHOLD) * 100));
    return (
      <Card className="border-0 shadow-sm bg-card">
        <CardContent className="p-5">
          <div className="flex items-center gap-2 mb-1">
            <PauseCircle className="h-4 w-4 text-amber-500" />
            <h3 className="text-sm font-semibold text-foreground">Mission Intelligence</h3>
            <span className="text-xs bg-amber-500/15 text-amber-600 px-2 py-0.5 rounded-full ml-1 font-medium">Standby</span>
          </div>
          <p className="text-xs text-muted-foreground mb-3 opacity-70">90-day trajectory · goal alignment</p>
          <p className="text-sm text-muted-foreground mb-3">
            {daysNeeded === 1
              ? "Log today's telemetry to bring long-term analysis back online."
              : `Log data on ${daysNeeded} more day${daysNeeded !== 1 ? "s" : ""} this week to restore trajectory analysis.`
            }
          </p>
          <div className="flex items-center gap-3">
            <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-amber-400 to-amber-500 rounded-full transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className="text-xs font-medium text-muted-foreground">
              {recentActiveDays}/{MAINTAIN_THRESHOLD} days
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-2 opacity-70">
            No need to rebuild your streak — just log today.
          </p>
        </CardContent>
      </Card>
    );
  }

  // ── State 3: Generating ───────────────────────────────────────────────────
  if (generateInsightMutation.isPending) {
    return (
      <Card className="border-0 shadow-sm bg-primary/5">
        <CardContent className="p-5">
          <div className="flex items-center gap-2 mb-1">
            <Target className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold text-foreground">Mission Intelligence</h3>
          </div>
          <p className="text-xs text-muted-foreground mb-3 opacity-70">90-day trajectory · goal alignment</p>
          <p className="text-sm text-muted-foreground mb-3">Scanning 90-day trajectory against your goals…</p>
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-primary/40 animate-bounce" style={{ animationDelay: "0ms" }} />
            <div className="w-1.5 h-1.5 rounded-full bg-primary/40 animate-bounce" style={{ animationDelay: "150ms" }} />
            <div className="w-1.5 h-1.5 rounded-full bg-primary/40 animate-bounce" style={{ animationDelay: "300ms" }} />
          </div>
        </CardContent>
      </Card>
    );
  }

  // ── State 4: Ready — no analysis yet ─────────────────────────────────────
  if (!latestInsight) {
    return (
      <Card className="border-0 shadow-sm bg-primary/5">
        <CardContent className="p-5">
          <div className="flex items-center gap-2 mb-1">
            <Target className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold text-foreground">Mission Intelligence</h3>
          </div>
          <p className="text-xs text-muted-foreground mb-3 opacity-70">90-day trajectory · goal alignment</p>
          <p className="text-sm text-muted-foreground mb-3">
            Analyses your 90-day performance arc against your Infinite Goal and Long-Term Targets — not a weekly summary, not a tip. A strategic read on whether your trajectory is pointing the right direction.
          </p>
          <Button size="sm" onClick={() => generateInsightMutation.mutate()}>
            Analyse Trajectory
          </Button>
        </CardContent>
      </Card>
    );
  }

  // ── State 5: Analysis ready ───────────────────────────────────────────────
  return (
    <Card className="border-0 shadow-sm bg-primary/5">
      <CardContent className="p-5">
        <div className="flex items-start justify-between mb-1">
          <div className="flex items-center gap-2">
            <Target className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold text-foreground">Mission Intelligence</h3>
          </div>
          <div className="flex items-center gap-0.5">
            {tts.isSupported && (
              <Button
                variant="ghost"
                size="icon"
                className={`h-7 w-7 ${tts.speaking ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
                onClick={() => {
                  if (tts.speaking) {
                    tts.cancel();
                  } else {
                    tts.speakNow(latestInsight.insight);
                  }
                }}
                title={tts.speaking ? "Stop" : "Read aloud"}
              >
                {tts.speaking ? (
                  <Square className="h-3.5 w-3.5 fill-current" />
                ) : (
                  <Volume2 className="h-3.5 w-3.5" />
                )}
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              onClick={() => { tts.cancel(); dismissInsightMutation.mutate(latestInsight.id); }}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mb-3 opacity-70">90-day trajectory · goal alignment</p>
        <p className="text-sm text-foreground leading-relaxed mb-3">
          {latestInsight.insight}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {latestInsight.tags?.map((tag, i) => (
            <Badge key={i} variant="secondary" className="text-xs">{tag}</Badge>
          ))}
          <Button
            variant="ghost"
            size="sm"
            className="text-xs text-muted-foreground hover:text-foreground ml-auto h-7"
            onClick={() => { tts.cancel(); generateInsightMutation.mutate(); }}
            disabled={generateInsightMutation.isPending}
          >
            <RefreshCw className="h-3 w-3 mr-1" />
            Refresh
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
