import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { DailyScore, UserMetric } from "@shared/schema";
import { RefreshCw, Edit, Plus, Settings, Trash2, X } from "lucide-react";
import MetricTrendChart from "./MetricTrendChart";

interface ScoreDashboardProps {
  selectedDate: string;
}

type DialogMode = 'trend' | 'edit' | 'manage' | 'addMetric' | 'editMetric';

const METRIC_COLORS = [
  "#10B981", "#4F46E5", "#F59E0B", "#EC4899", "#8B5CF6",
  "#EF4444", "#06B6D4", "#84CC16", "#F97316", "#6366F1",
  "#14B8A6", "#E11D48", "#7C3AED", "#0EA5E9",
];

export default function ScoreDashboard({ selectedDate }: ScoreDashboardProps) {
  const [selectedMetric, setSelectedMetric] = useState<UserMetric | null>(null);
  const [dialogMode, setDialogMode] = useState<DialogMode>('trend');
  const [scoreValue, setScoreValue] = useState<string>("");
  const [newMetricName, setNewMetricName] = useState("");
  const [newMetricColor, setNewMetricColor] = useState(METRIC_COLORS[0]);
  const [editMetricName, setEditMetricName] = useState("");
  const [editMetricColor, setEditMetricColor] = useState("");
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
    queryFn: () => fetch(`/api/daily-scores/${selectedDate}`, { credentials: "include" }).then(res => res.json()),
    staleTime: 0,
  });

  const { data: metricHistory = [] } = useQuery<DailyScore[]>({
    queryKey: ["/api/metric-history", selectedMetric?.name],
    queryFn: () => {
      if (!selectedMetric) return Promise.resolve([]);
      return fetch(`/api/metric-history/${selectedMetric.name}?days=14`, { credentials: "include" }).then(res => res.json());
    },
    enabled: !!selectedMetric,
  });

  const { data: ouraStatus } = useQuery<{ configured: boolean }>({
    queryKey: ["/api/oura/status"],
  });

  const syncOuraMutation = useMutation({
    mutationFn: async (date: string) => {
      return apiRequest("POST", `/api/oura/sync/${date}`, {});
    },
    onSuccess: (data, date) => {
      queryClient.invalidateQueries({ queryKey: ["/api/daily-scores", date] });
      queryClient.invalidateQueries({ queryKey: ["/api/user-metrics"] });
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
    if (!isToday || !ouraStatus?.configured) return;
    const hasAutoSyncedScores = scores.some(s => s.isAutoSynced);
    
    if (!hasAutoSyncedScores && !syncOuraMutation.isPending) {
      syncOuraMutation.mutate(today);
    }
  }, [ouraStatus, scores, syncOuraMutation.isPending, today, isToday]);

  const updateScoreMutation = useMutation({
    mutationFn: async (data: { date: string; metricName: string; value: number }) => {
      return apiRequest("POST", "/api/daily-scores", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/daily-scores", selectedDate] });
      queryClient.invalidateQueries({ queryKey: ["/api/dates-with-data"] });
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

  const addMetricMutation = useMutation({
    mutationFn: async (data: { name: string; color: string }) => {
      return apiRequest("POST", "/api/user-metrics", {
        ...data,
        maxValue: 100,
        isDefault: false,
        isActive: true,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user-metrics"] });
      toast({ title: "Metric added", description: "Your new metric has been created." });
      setNewMetricName("");
      setNewMetricColor(METRIC_COLORS[0]);
      setDialogMode('manage');
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to add metric.", variant: "destructive" });
    },
  });

  const updateMetricMutation = useMutation({
    mutationFn: async ({ id, name, color }: { id: number; name: string; color: string }) => {
      return apiRequest("PUT", `/api/user-metrics/${id}`, { name, color });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user-metrics"] });
      toast({ title: "Metric updated", description: "Your metric has been updated." });
      setDialogMode('manage');
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update metric.", variant: "destructive" });
    },
  });

  const deleteMetricMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest("DELETE", `/api/user-metrics/${id}`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user-metrics"] });
      toast({ title: "Metric removed", description: "The metric has been removed." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to remove metric.", variant: "destructive" });
    },
  });

  function getScoreForMetric(metricName: string): DailyScore | undefined {
    return scores.find(score => score.metricName === metricName);
  }

  const handleMetricClick = (metric: UserMetric) => {
    setSelectedMetric(metric);
    setDialogMode('edit');
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
    if (!selectedMetric) return;
    
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
      date: selectedDate,
      metricName: selectedMetric.name,
      value,
    });
  };

  const handleSyncOura = () => {
    syncOuraMutation.mutate(today);
  };

  const handleOpenManage = () => {
    setSelectedMetric(null);
    setDialogMode('manage');
  };

  const handleOpenAddMetric = () => {
    const usedColors = new Set(metrics.map(m => m.color));
    const nextColor = METRIC_COLORS.find(c => !usedColors.has(c)) || METRIC_COLORS[0];
    setNewMetricColor(nextColor);
    setNewMetricName("");
    setDialogMode('addMetric');
  };

  const handleOpenEditMetric = (metric: UserMetric) => {
    setSelectedMetric(metric);
    setEditMetricName(metric.name);
    setEditMetricColor(metric.color);
    setDialogMode('editMetric');
  };

  const handleSaveNewMetric = () => {
    if (!newMetricName.trim()) {
      toast({ title: "Name required", description: "Please enter a metric name.", variant: "destructive" });
      return;
    }
    addMetricMutation.mutate({ name: newMetricName.trim(), color: newMetricColor });
  };

  const handleSaveEditMetric = () => {
    if (!selectedMetric || !editMetricName.trim()) return;
    updateMetricMutation.mutate({ id: selectedMetric.id, name: editMetricName.trim(), color: editMetricColor });
  };

  const isManageOpen = dialogMode === 'manage' || dialogMode === 'addMetric' || dialogMode === 'editMetric';

  return (
    <>
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold text-gray-900">
          {isToday ? "Daily Scores" : `Scores for ${new Date(selectedDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}
        </h2>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleOpenManage}
          >
            <Settings className="w-4 h-4 mr-1" />
            Manage
          </Button>
          {isToday && ouraStatus?.configured && (
            <Button 
              variant="outline" 
              size="sm"
              onClick={handleSyncOura}
              disabled={syncOuraMutation.isPending}
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${syncOuraMutation.isPending ? 'animate-spin' : ''}`} />
              {syncOuraMutation.isPending ? "Syncing..." : "Sync Oura"}
            </Button>
          )}
        </div>
      </div>
      
      {metrics.filter(m => m.isActive).length === 0 && (
        <div className="text-center py-8 bg-white rounded-xl shadow-sm border border-gray-100">
          <p className="text-gray-500 mb-3">No metrics set up yet</p>
          <Button variant="outline" size="sm" onClick={handleOpenManage}>
            <Plus className="w-4 h-4 mr-1" />
            Add Your First Metric
          </Button>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
        {metrics.filter(m => m.isActive).map((metric) => {
          const score = getScoreForMetric(metric.name);
          const value = score?.value;
          const maxValue = metric.maxValue || 100;
          const percentage = value !== undefined ? Math.min(100, Math.max(0, (value / maxValue) * 100)) : 0;

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
                {score?.isAutoSynced ? "Auto-synced" : (value !== undefined ? "Tap to edit" : "Tap to add")}
              </p>
            </div>
          );
        })}
      </div>

      {/* Score Edit / Trend Dialog */}
      <Dialog open={!!selectedMetric && !isManageOpen} onOpenChange={(open) => !open && handleCloseDialog()}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {dialogMode === 'trend' ? `${selectedMetric?.name} Trends` : `Update ${selectedMetric?.name} Score`}
            </DialogTitle>
            <DialogDescription>
              {dialogMode === 'trend' 
                ? `14-day trend for ${selectedMetric?.name}. Tap Edit to update the score.`
                : `Enter a score from 0 to ${selectedMetric?.maxValue || 100} for ${selectedMetric?.name}.`
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
                <div className="flex justify-end">
                  <Button onClick={() => setDialogMode('edit')}>
                    <Edit className="w-4 h-4 mr-2" />
                    Edit Score
                  </Button>
                </div>
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
                  />
                </div>
                
                <div className="flex space-x-2">
                  <Button 
                    variant="outline" 
                    className="flex-1"
                    onClick={handleViewTrendsClick}
                    disabled={updateScoreMutation.isPending}
                  >
                    View Trends
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
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Manage Metrics Dialog */}
      <Dialog open={isManageOpen} onOpenChange={(open) => { if (!open) { setDialogMode('trend'); setSelectedMetric(null); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {dialogMode === 'addMetric' ? 'Add New Metric' : dialogMode === 'editMetric' ? 'Edit Metric' : 'Manage Metrics'}
            </DialogTitle>
            <DialogDescription>
              {dialogMode === 'addMetric' 
                ? 'Create a new metric to track.'
                : dialogMode === 'editMetric'
                ? 'Update the name or color of this metric.'
                : 'Add, edit, or remove metrics you want to track.'}
            </DialogDescription>
          </DialogHeader>

          {dialogMode === 'manage' && (
            <div className="space-y-2 py-2">
              {metrics.filter(m => m.isActive).map((metric) => (
                <div key={metric.id} className="flex items-center justify-between p-3 rounded-lg border border-gray-200 hover:border-gray-300 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="w-4 h-4 rounded-full" style={{ backgroundColor: metric.color }} />
                    <span className="text-sm font-medium">{metric.name}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => handleOpenEditMetric(metric)}
                    >
                      <Edit className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-red-500 hover:text-red-700 hover:bg-red-50"
                      onClick={() => {
                        if (confirm(`Remove "${metric.name}"? This won't delete any saved scores.`)) {
                          deleteMetricMutation.mutate(metric.id);
                        }
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
              <Button
                variant="outline"
                className="w-full mt-3"
                onClick={handleOpenAddMetric}
              >
                <Plus className="w-4 h-4 mr-2" />
                Add Metric
              </Button>
            </div>
          )}

          {dialogMode === 'addMetric' && (
            <div className="space-y-4 py-2">
              <div>
                <Label htmlFor="metric-name">Name</Label>
                <Input
                  id="metric-name"
                  value={newMetricName}
                  onChange={(e) => setNewMetricName(e.target.value)}
                  placeholder="e.g. Focus, Hydration, Exercise"
                  className="mt-1"
                />
              </div>
              <div>
                <Label>Color</Label>
                <div className="flex flex-wrap gap-2 mt-2">
                  {METRIC_COLORS.map((color) => (
                    <button
                      key={color}
                      className={`w-8 h-8 rounded-full border-2 transition-all ${
                        newMetricColor === color ? 'border-gray-900 scale-110' : 'border-transparent'
                      }`}
                      style={{ backgroundColor: color }}
                      onClick={() => setNewMetricColor(color)}
                    />
                  ))}
                </div>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setDialogMode('manage')}>
                  Back
                </Button>
                <Button 
                  className="flex-1" 
                  onClick={handleSaveNewMetric}
                  disabled={addMetricMutation.isPending}
                >
                  {addMetricMutation.isPending ? "Adding..." : "Add Metric"}
                </Button>
              </div>
            </div>
          )}

          {dialogMode === 'editMetric' && selectedMetric && (
            <div className="space-y-4 py-2">
              <div>
                <Label htmlFor="edit-metric-name">Name</Label>
                <Input
                  id="edit-metric-name"
                  value={editMetricName}
                  onChange={(e) => setEditMetricName(e.target.value)}
                  className="mt-1"
                />
              </div>
              <div>
                <Label>Color</Label>
                <div className="flex flex-wrap gap-2 mt-2">
                  {METRIC_COLORS.map((color) => (
                    <button
                      key={color}
                      className={`w-8 h-8 rounded-full border-2 transition-all ${
                        editMetricColor === color ? 'border-gray-900 scale-110' : 'border-transparent'
                      }`}
                      style={{ backgroundColor: color }}
                      onClick={() => setEditMetricColor(color)}
                    />
                  ))}
                </div>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setDialogMode('manage')}>
                  Back
                </Button>
                <Button 
                  className="flex-1" 
                  onClick={handleSaveEditMetric}
                  disabled={updateMetricMutation.isPending}
                >
                  {updateMetricMutation.isPending ? "Saving..." : "Save Changes"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
