import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Lightbulb, X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { AIInsight } from "@shared/schema";

export default function AIInsights() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: insights = [] } = useQuery<AIInsight[]>({
    queryKey: ["/api/ai-insights"],
  });

  const generateInsightMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/ai-insights/generate", {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai-insights"] });
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
                  Generate personalized insights from your journal entries and daily scores.
                </p>
                <Button
                  variant="secondary"
                  onClick={() => generateInsightMutation.mutate()}
                  disabled={generateInsightMutation.isPending}
                >
                  {generateInsightMutation.isPending ? "Generating..." : "Generate Insight"}
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
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <h3 className="text-lg font-semibold mb-2 flex items-center">
                  <Lightbulb className="h-5 w-5 mr-2" />
                  AI Insights
                </h3>
                <p className="text-primary-100 mb-4">
                  Analyzing your journal entries and scores to find meaningful patterns...
                </p>
                <div className="flex items-center space-x-2">
                  <div className="w-4 h-4 bg-white bg-opacity-20 rounded-full animate-bounce" />
                  <div className="w-4 h-4 bg-white bg-opacity-20 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }} />
                  <div className="w-4 h-4 bg-white bg-opacity-20 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
                </div>
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
              {latestInsight.tags && latestInsight.tags.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {latestInsight.tags.map((tag, index) => (
                    <Badge 
                      key={index}
                      variant="secondary" 
                      className="bg-white bg-opacity-20 text-white border-0"
                    >
                      {tag}
                    </Badge>
                  ))}
                </div>
              )}
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
