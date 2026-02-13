import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { DailyScore, UserMetric } from "@shared/schema";
import { RefreshCw, Edit } from "lucide-react";
import MetricTrendChart from "./MetricTrendChart";

interface ScoreDashboardProps {
  selectedDate: string;
}

type DialogMode = 'trend' | 'edit';

export default function ScoreDashboard({ selectedDate }: ScoreDashboardProps) {
  const [selectedMetric, setSelectedMetric] = useState<UserMetric | null>(null);
  const [dialogMode, setDialogMode] = useState<DialogMode>('trend');
  const [scoreValue, setScoreValue] = useState<string>("");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const today = (() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  })();

  const isToday = selectedDate === today;

  const { data: metrics = [] } = useQuery<UserMetric[]>({
    queryKey: ["/api/user-metrics"],
  });

  const { data: scores = [] } = useQuery<DailyScore[]>({
    queryKey: ["/api/daily-scores", selectedDate],
    queryFn: () => fetch(`/api/daily-scores/${selectedDate}`).then(res => res.json()),
  });

  const { data: metricHistory = [] } = useQuery<DailyScore[]>({
    queryKey: ["/api/metric-history", selectedMetric?.name],
    queryFn: () => {
      if (!selectedMetric) return Promise.resolve([]);
      return fetch(`/api/metric-history/${selectedMetric.name}?days=14`).then(res => res.json());
    },
    enabled: !!selectedMetric,
  });

  const syncOuraMutation = useMutation({
    mutationFn: async (date: string) => {
      return apiRequest("POST", `/api/oura/sync/${date}`, {});
    },
    onSuccess: (data, date) => {
      queryClient.invalidateQueries({ queryKey: ["/api/daily-scores", date] });
      toast({
        title: "Oura data synced",
        description: "Your Oura ring data has been updated successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Sync failed",
        description: error.message || "Failed to sync Oura data. Please try again.",
        variant: "destructive",
      });
    },
  });

  useEffect(() => {
    if (!isToday) return;
    const hasOuraMetrics = metrics.some(m => 
      m.name === "Sleep Quality" || m.name === "Readiness"
    );
    const hasAutoSyncedScores = scores.some(s => s.isAutoSynced);
    
    if (hasOuraMetrics && !hasAutoSyncedScores && !syncOuraMutation.isPending) {
      syncOuraMutation.mutate(today);
    }
  }, [metrics, scores, syncOuraMutation.isPending, today, isToday]);

  const updateScoreMutation = useMutation({
    mutationFn: async (data: { date: string; metricName: string; value: number }) => {
      return apiRequest("POST", "/api/daily-scores", data);
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/daily-scores", selectedDate] });
      // Also invalidate streak query to show animation
      queryClient.invalidateQueries({ queryKey: ["/api/streak"] });
      
      const metricName = selectedMetric?.name;
      toast({
        title: "Score updated",
        description: "Your daily score has been saved successfully.",
      });
      if (metricName) {
        queryClient.invalidateQueries({ queryKey: ["/api/metric-history", metricName] });
      }
      setDialogMode('trend');
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

  function getScoreForMetric(metricName: string): DailyScore | undefined {
    return scores.find(score => score.metricName === metricName);
  }

  const handleMetricClick = (metric: UserMetric) => {
    setSelectedMetric(metric);
    setDialogMode(isToday ? 'edit' : 'trend');
    const existingScore = getScoreForMetric(metric.name);
    setScoreValue(existingScore?.value?.toString() || "");
  };

  const handleViewTrendsClick = () => {
    setDialogMode('trend');
  };

  const handleCloseDialog = () => {
    setSelectedMetric(null);
    setDialogMode('trend');
    setScoreValue("");
  };

  const handleSaveScore = () => {
    if (!selectedMetric || !isToday) return;
    
    const value = parseInt(scoreValue);
    const maxValue = selectedMetric.maxValue || 100;
    
    if (isNaN(value) || value < 0 || value > maxValue) {
      toast({
        title: "Invalid score",
        description: `Please enter a score between 0 and ${maxValue}.`,
        variant: "destructive",
      });
      return;
    }

    updateScoreMutation.mutate({
      date: today,
      metricName: selectedMetric.name,
      value,
    });
  };

  const handleSyncOura = () => {
    syncOuraMutation.mutate(today);
  };

  return (
    <>
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold text-gray-900">
          {isToday ? "Daily Scores" : `Scores for ${new Date(selectedDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}
        </h2>
        {isToday && (
          <Button 
            variant="outline" 
            size="sm"
            onClick={handleSyncOura}
            disabled={syncOuraMutation.isPending}
            data-testid="button-sync-oura"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${syncOuraMutation.isPending ? 'animate-spin' : ''}`} />
            {syncOuraMutation.isPending ? "Syncing..." : "Sync Oura"}
          </Button>
        )}
      </div>
      
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
        {metrics.map((metric) => {
          const score = getScoreForMetric(metric.name);
          const value = score?.value;
          const displayValue = value !== undefined ? value : "";
          const maxValue = metric.maxValue || 100;
          const percentage = value !== undefined ? Math.min(100, Math.max(0, (value / maxValue) * 100)) : 0;

          return (
            <div 
              key={metric.id} 
              onClick={() => handleMetricClick(metric)}
              className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 text-center cursor-pointer hover:shadow-md hover:-translate-y-0.5 transition-all duration-200"
              data-testid={`circle-${metric.name.toLowerCase().replace(/\s+/g, '-')}`}
            >
              <div className="relative w-16 h-16 mx-auto mb-3">
                <div 
                  className="w-full h-full rounded-full"
                  style={{
                    background: value !== undefined
                      ? `conic-gradient(from 0deg, ${metric.color} ${percentage}%, #E5E7EB ${percentage}%)`
                      : '#F3F4F6'
                  }}
                />
                <div className="absolute inset-0 flex items-center justify-center">
                  {value !== undefined ? (
                    <span className="text-lg font-semibold text-gray-900">
                      {value}
                    </span>
                  ) : (
                    <span className="text-sm text-gray-400">--</span>
                  )}
                </div>
              </div>
              <h3 className="text-sm font-medium text-gray-700">{metric.name}</h3>
              <p className="text-xs text-gray-500 mt-1">
                {!isToday ? (value !== undefined ? "View trends" : "No data") : (score?.isAutoSynced ? "Auto-synced" : (value !== undefined ? "Tap to edit" : "Tap to add"))}
              </p>
            </div>
          );
        })}
      </div>

      {/* Metric Dialog - Trend and Edit */}
      <Dialog open={!!selectedMetric} onOpenChange={(open) => !open && handleCloseDialog()}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {dialogMode === 'trend' ? `${selectedMetric?.name} Trends` : `Update ${selectedMetric?.name} Score`}
            </DialogTitle>
            <DialogDescription>
              {dialogMode === 'trend' 
                ? `14-day trend for ${selectedMetric?.name}. Tap Edit to update today's score.`
                : `Enter a score from 0 to ${selectedMetric?.maxValue || 100} for ${selectedMetric?.name} for today.`
              }
            </DialogDescription>
          </DialogHeader>
          
          <div className="py-4">
            {dialogMode === 'trend' && selectedMetric ? (
              <div className="space-y-4">
                <MetricTrendChart 
                  metric={selectedMetric} 
                  history={metricHistory} 
                  selectedDate={today}
                />
                {isToday && (
                  <div className="flex justify-end">
                    <Button 
                      onClick={() => setDialogMode('edit')}
                      data-testid="button-edit-score"
                    >
                      <Edit className="w-4 h-4 mr-2" />
                      Edit Score
                    </Button>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                <div className="text-center">
                  <div 
                    className="w-20 h-20 mx-auto mb-4 rounded-full"
                    style={{
                      background: selectedMetric 
                        ? `conic-gradient(from 0deg, ${selectedMetric.color} ${Math.min(100, Math.max(0, ((parseInt(scoreValue) || 0) / (selectedMetric.maxValue || 100)) * 100))}%, #E5E7EB ${Math.min(100, Math.max(0, ((parseInt(scoreValue) || 0) / (selectedMetric.maxValue || 100)) * 100))}%)`
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
                  <Label htmlFor="score">Score (0-{selectedMetric?.maxValue || 100})</Label>
                  <Input
                    id="score"
                    type="number"
                    min="0"
                    max={selectedMetric?.maxValue || 100}
                    value={scoreValue}
                    onChange={(e) => setScoreValue(e.target.value)}
                    placeholder={`Enter score from 0 to ${selectedMetric?.maxValue || 100}`}
                    className="mt-1"
                    data-testid="input-score"
                  />
                </div>
                
                <div className="flex space-x-2">
                  <Button 
                    variant="outline" 
                    className="flex-1"
                    onClick={handleViewTrendsClick}
                    disabled={updateScoreMutation.isPending}
                    data-testid="button-view-trends"
                  >
                    View Trends
                  </Button>
                  <Button 
                    className="flex-1"
                    onClick={handleSaveScore}
                    disabled={updateScoreMutation.isPending}
                    data-testid="button-save-score"
                  >
                    {updateScoreMutation.isPending ? "Saving..." : "Save"}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
