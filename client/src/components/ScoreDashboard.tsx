import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { DailyScore, UserMetric } from "@shared/schema";

interface ScoreDashboardProps {
  selectedDate: string;
}

export default function ScoreDashboard({ selectedDate }: ScoreDashboardProps) {
  const [selectedMetric, setSelectedMetric] = useState<UserMetric | null>(null);
  const [scoreValue, setScoreValue] = useState<string>("");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: metrics = [] } = useQuery<UserMetric[]>({
    queryKey: ["/api/user-metrics"],
  });

  const { data: scores = [] } = useQuery<DailyScore[]>({
    queryKey: ["/api/daily-scores", selectedDate],
  });

  const { data: previousScores = [] } = useQuery<DailyScore[]>({
    queryKey: ["/api/daily-scores", getPreviousDate(selectedDate)],
  });

  const updateScoreMutation = useMutation({
    mutationFn: async (data: { date: string; metricName: string; value: number }) => {
      return apiRequest("POST", "/api/daily-scores", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/daily-scores"] });
      toast({
        title: "Score updated",
        description: "Your daily score has been saved successfully.",
      });
      setSelectedMetric(null);
      setScoreValue("");
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update score. Please try again.",
        variant: "destructive",
      });
    },
  });

  function getPreviousDate(date: string): string {
    const d = new Date(date);
    d.setDate(d.getDate() - 1);
    return d.toISOString().split('T')[0];
  }

  function getScoreForMetric(metricName: string): DailyScore | undefined {
    return scores.find(score => score.metricName === metricName);
  }

  function getPreviousScoreForMetric(metricName: string): DailyScore | undefined {
    return previousScores.find(score => score.metricName === metricName);
  }

  function getTrendText(current: number, previous?: number): string {
    if (previous === undefined) return "No previous data";
    const diff = current - previous;
    if (diff > 0) return `+${diff} from yesterday`;
    if (diff < 0) return `${diff} from yesterday`;
    return "No change";
  }

  const handleMetricClick = (metric: UserMetric) => {
    setSelectedMetric(metric);
    const existingScore = getScoreForMetric(metric.name);
    setScoreValue(existingScore?.value?.toString() || "");
  };

  const handleSaveScore = () => {
    if (!selectedMetric) return;
    
    const value = parseInt(scoreValue);
    if (isNaN(value) || value < 0 || value > 100) {
      toast({
        title: "Invalid score",
        description: "Please enter a score between 0 and 100.",
        variant: "destructive",
      });
      return;
    }

    updateScoreMutation.mutate({
      date: selectedDate,
      metricName: selectedMetric.name,
      value,
    });
  };

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
        {metrics.map((metric) => {
          const score = getScoreForMetric(metric.name);
          const previousScore = getPreviousScoreForMetric(metric.name);
          const value = score?.value || 0;
          const percentage = Math.min(100, Math.max(0, value));

          return (
            <div 
              key={metric.id} 
              onClick={() => handleMetricClick(metric)}
              className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 text-center cursor-pointer hover:shadow-md hover:-translate-y-0.5 transition-all duration-200"
            >
              <div className="relative w-16 h-16 mx-auto mb-3">
                <div 
                  className="w-full h-full rounded-full"
                  style={{
                    background: `conic-gradient(from 0deg, ${metric.color} ${percentage}%, #E5E7EB ${percentage}%)`
                  }}
                />
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-lg font-semibold text-gray-900">
                    {value}
                  </span>
                </div>
              </div>
              <h3 className="text-sm font-medium text-gray-700">{metric.name}</h3>
              <p className="text-xs text-gray-500 mt-1">
                {score?.isAutoSynced ? "Auto-synced" : getTrendText(value, previousScore?.value)}
              </p>
            </div>
          );
        })}
      </div>

      {/* Score Input Modal */}
      <Dialog open={!!selectedMetric} onOpenChange={() => setSelectedMetric(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Update {selectedMetric?.name} Score</DialogTitle>
            <DialogDescription>
              Enter a score from 0 to 100 for {selectedMetric?.name} on the selected date.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="text-center">
              <div 
                className="w-20 h-20 mx-auto mb-4 rounded-full"
                style={{
                  background: selectedMetric 
                    ? `conic-gradient(from 0deg, ${selectedMetric.color} ${Math.min(100, Math.max(0, parseInt(scoreValue) || 0))}%, #E5E7EB ${Math.min(100, Math.max(0, parseInt(scoreValue) || 0))}%)`
                    : '#E5E7EB'
                }}
              >
                <div className="w-full h-full flex items-center justify-center">
                  <span className="text-xl font-semibold text-gray-900">
                    {scoreValue || 0}
                  </span>
                </div>
              </div>
            </div>
            
            <div>
              <Label htmlFor="score">Score (0-100)</Label>
              <Input
                id="score"
                type="number"
                min="0"
                max="100"
                value={scoreValue}
                onChange={(e) => setScoreValue(e.target.value)}
                placeholder="Enter score from 0 to 100"
                className="mt-1"
              />
            </div>
            
            <div className="flex space-x-2">
              <Button 
                variant="outline" 
                className="flex-1"
                onClick={() => setSelectedMetric(null)}
                disabled={updateScoreMutation.isPending}
              >
                Cancel
              </Button>
              <Button 
                className="flex-1"
                onClick={handleSaveScore}
                disabled={updateScoreMutation.isPending}
              >
                {updateScoreMutation.isPending ? "Saving..." : "Save"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
