import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Sparkles, X, Flame, Lock, RefreshCw, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { AIInsight, Streak } from "@shared/schema";

export default function AIInsights() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: insights = [] } = useQuery<AIInsight[]>({
    queryKey: ["/api/ai-insights"],
  });

  const { data: streak, isLoading: streakLoading } = useQuery<Streak>({
    queryKey: ["/api/streak"],
  });

  const currentStreak = streak?.currentStreak || 0;
  const streakUnlocked = currentStreak >= 7;

  const generateInsightMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/ai-insights/generate", {});
      return res.json();
    },
    onSuccess: (data) => {
      if (data.needsStreak) {
        toast({
          title: "Keep going!",
          description: `You need a 7-day streak to unlock AI Insights. You're at ${data.currentStreak} days.`,
        });
      } else {
        queryClient.invalidateQueries({ queryKey: ["/api/ai-insights"] });
      }
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to generate insight.", variant: "destructive" });
    },
  });

  const dismissInsightMutation = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/ai-insights/${id}`, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/ai-insights"] }),
  });

  const latestInsight = insights[0];
  if (streakLoading) return null;

  if (!streakUnlocked) {
    const progress = Math.min(100, Math.round((currentStreak / 7) * 100));
    return (
      <Card className="border-0 shadow-sm bg-card">
        <CardContent className="p-5">
          <div className="flex items-center gap-2 mb-3">
            <Lock className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold text-foreground">AI Insights</h3>
            <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full ml-1">Locked</span>
          </div>
          <p className="text-sm text-muted-foreground mb-3">
            Build a 7-day streak to unlock personalized insights.
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
              {currentStreak}/7
            </span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (generateInsightMutation.isPending) {
    return (
      <Card className="border-0 shadow-sm bg-primary/5">
        <CardContent className="p-5">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold text-foreground">AI Insights</h3>
          </div>
          <p className="text-sm text-muted-foreground mb-3">Analyzing your data...</p>
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-primary/40 animate-bounce" style={{ animationDelay: "0ms" }} />
            <div className="w-1.5 h-1.5 rounded-full bg-primary/40 animate-bounce" style={{ animationDelay: "150ms" }} />
            <div className="w-1.5 h-1.5 rounded-full bg-primary/40 animate-bounce" style={{ animationDelay: "300ms" }} />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!latestInsight) {
    return (
      <Card className="border-0 shadow-sm bg-primary/5">
        <CardContent className="p-5">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold text-foreground">AI Insights</h3>
          </div>
          <p className="text-sm text-muted-foreground mb-3">
            Get personalized insights from your scores, mood, and debriefs.
          </p>
          <Button
            size="sm"
            onClick={() => generateInsightMutation.mutate()}
          >
            Generate Insight
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-0 shadow-sm bg-primary/5">
      <CardContent className="p-5">
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold text-foreground">AI Insights</h3>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            onClick={() => dismissInsightMutation.mutate(latestInsight.id)}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
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
            onClick={() => generateInsightMutation.mutate()}
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
