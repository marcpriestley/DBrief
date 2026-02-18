import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Lightbulb, X, Flame, Lock } from "lucide-react";
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
      toast({
        title: "Error",
        description: "Failed to generate AI insight. Please try again.",
        variant: "destructive",
      });
    },
  });

  const dismissInsightMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest("DELETE", `/api/ai-insights/${id}`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai-insights"] });
    },
  });

  const latestInsight = insights[0];

  if (streakLoading) return null;

  if (!streakUnlocked) {
    const progress = Math.min(100, Math.round((currentStreak / 7) * 100));
    return (
      <section className="mb-8">
        <Card className="bg-gradient-to-r from-gray-700 to-gray-800 text-white">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <h3 className="text-lg font-semibold mb-2 flex items-center">
                  <Lock className="h-5 w-5 mr-2 opacity-70" />
                  AI Insights
                  <span className="ml-2 text-xs bg-white bg-opacity-20 px-2 py-0.5 rounded-full">Locked</span>
                </h3>
                <p className="text-gray-300 mb-3 text-sm">
                  Build a 7-day streak to unlock personalized insights from your data.
                </p>
                <div className="flex items-center gap-3">
                  <div className="flex-1 h-2 bg-white bg-opacity-20 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-gradient-to-r from-orange-400 to-yellow-400 rounded-full transition-all duration-500"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <span className="text-sm font-medium flex items-center gap-1">
                    <Flame className="h-4 w-4 text-orange-400" />
                    {currentStreak}/7
                  </span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </section>
    );
  }

  if (!latestInsight && !generateInsightMutation.isPending) {
    return (
      <section className="mb-8">
        <Card className="bg-gradient-to-r from-primary to-purple-500 text-white">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <h3 className="text-lg font-semibold mb-2 flex items-center">
                  <Lightbulb className="h-5 w-5 mr-2" />
                  AI Insights
                </h3>
                <p className="text-primary-100 mb-4">
                  Get personalized insights from your scores, mood, journal entries, and goals.
                </p>
                <Button
                  variant="secondary"
                  onClick={() => generateInsightMutation.mutate()}
                  disabled={generateInsightMutation.isPending}
                >
                  Generate Insight
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </section>
    );
  }

  if (generateInsightMutation.isPending) {
    return (
      <section className="mb-8">
        <Card className="bg-gradient-to-r from-primary to-purple-500 text-white">
          <CardContent className="p-6">
            <div className="flex-1">
              <h3 className="text-lg font-semibold mb-2 flex items-center">
                <Lightbulb className="h-5 w-5 mr-2" />
                AI Insights
              </h3>
              <p className="text-primary-100 mb-4">
                Analyzing your scores, mood, journal, and goals...
              </p>
              <div className="flex items-center space-x-2">
                <div className="w-4 h-4 bg-white bg-opacity-20 rounded-full animate-bounce" />
                <div className="w-4 h-4 bg-white bg-opacity-20 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }} />
                <div className="w-4 h-4 bg-white bg-opacity-20 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
              </div>
            </div>
          </CardContent>
        </Card>
      </section>
    );
  }

  if (!latestInsight) return null;

  return (
    <section className="mb-8">
      <Card className="bg-gradient-to-r from-primary to-purple-500 text-white">
        <CardContent className="p-6">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <h3 className="text-lg font-semibold mb-2 flex items-center">
                <Lightbulb className="h-5 w-5 mr-2" />
                AI Insights
              </h3>
              <p className="text-primary-100 mb-4">
                {latestInsight.insight}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {latestInsight.tags && latestInsight.tags.length > 0 && latestInsight.tags.map((tag, index) => (
                  <Badge 
                    key={index}
                    variant="secondary" 
                    className="bg-white bg-opacity-20 text-white border-0"
                  >
                    {tag}
                  </Badge>
                ))}
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-white text-xs hover:bg-white hover:bg-opacity-10 ml-auto"
                  onClick={() => generateInsightMutation.mutate()}
                  disabled={generateInsightMutation.isPending}
                >
                  Refresh
                </Button>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="text-primary-100 hover:text-white hover:bg-white hover:bg-opacity-10 ml-4"
              onClick={() => dismissInsightMutation.mutate(latestInsight.id)}
              disabled={dismissInsightMutation.isPending}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
