import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { DailyScore, UserMetric } from "@shared/schema";
import { Heart, Edit, Plus, Settings, Trash2 } from "lucide-react";
import MetricTrendChart from "./MetricTrendChart";

interface ScoreDashboardProps {
  selectedDate: string;
}

type DialogMode = 'trend' | 'edit' | 'manage' | 'addMetric' | 'editMetric';

const METRIC_COLORS = [
  "#4F46E5", "#10B981", "#F59E0B", "#EC4899", "#8B5CF6",
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

  const syncHealthMutation = useMutation({
    mutationFn: async (data: { date: string; sleepScore?: number; readinessScore?: number; activityScore?: number }) => {
      return apiRequest("POST", "/api/health/sync", data);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/daily-scores", variables.date] });
      queryClient.invalidateQueries({ queryKey: ["/api/user-metrics"] });
      toast({
        title: "Health data synced",
        description: "Your Apple Health data has been updated.",
      });
    },
    onError: () => {
      toast({
        title: "Sync failed",
        description: "Could not sync health data. Make sure the app has HealthKit permissions.",
        variant: "destructive",
      });
    },
  });

  const updateScoreMutation = useMutation({
    mutationFn: async (data: { date: string; metricName: string; value: number }) => {
      return apiRequest("POST", "/api/daily-scores", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/daily-scores", selectedDate] });
      queryClient.invalidateQueries({ queryKey: ["/api/dates-with-data"] });
      queryClient.invalidateQueries({ queryKey: ["/api/streak"] });
      
      const metricName = selectedMetric?.name;
      if (metricName) {
        queryClient.invalidateQueries({ queryKey: ["/api/metric-history", metricName] });
      }
      setSelectedMetric(null);
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
    const value = parseInt(scoreValue) || 0;
    updateScoreMutation.mutate({
      date: selectedDate,
      metricName: selectedMetric.name,
      value,
    });
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
  const activeMetrics = metrics.filter(m => m.isActive);

  return (
    <>
      <div className="bg-card rounded-xl border border-border/50 shadow-sm overflow-hidden">
        <div className="px-4 py-3 flex justify-between items-center border-b border-border/30">
          <h2 className="text-sm font-semibold text-foreground tracking-tight">
            {isToday ? "Daily Scores" : `Scores — ${new Date(selectedDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}
          </h2>
          <div className="flex items-center gap-1.5">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleOpenManage}
              className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
            >
              <Settings className="w-3.5 h-3.5 mr-1" />
              Manage
            </Button>
          </div>
        </div>
        
        {activeMetrics.length === 0 ? (
          <div className="text-center py-10 px-4">
            <div className="w-10 h-10 rounded-full bg-muted/60 flex items-center justify-center mx-auto mb-3">
              <Heart className="w-4 h-4 text-muted-foreground" />
            </div>
            <p className="text-sm text-muted-foreground mb-3">No metrics set up yet</p>
            <Button variant="outline" size="sm" onClick={handleOpenManage} className="h-8 text-xs">
              <Plus className="w-3.5 h-3.5 mr-1" />
              Add Your First Metric
            </Button>
          </div>
        ) : (
          <div className="p-3">
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
              {activeMetrics.map((metric) => {
                const score = getScoreForMetric(metric.name);
                const value = score?.value;
                const maxValue = metric.maxValue || 100;
                const percentage = value !== undefined ? Math.min(100, Math.max(0, (value / maxValue) * 100)) : 0;
                const ringSize = 52;
                const strokeWidth = 3.5;
                const radius = (ringSize - strokeWidth) / 2;
                const circumference = 2 * Math.PI * radius;
                const strokeDashoffset = circumference - (percentage / 100) * circumference;

                return (
                  <button
                    key={metric.id} 
                    onClick={() => handleMetricClick(metric)}
                    className="flex flex-col items-center py-3 px-1 rounded-lg hover:bg-muted/40 transition-colors cursor-pointer group"
                  >
                    <div className="relative" style={{ width: ringSize, height: ringSize }}>
                      <svg width={ringSize} height={ringSize} className="-rotate-90">
                        <circle
                          cx={ringSize / 2}
                          cy={ringSize / 2}
                          r={radius}
                          fill="none"
                          stroke="hsl(var(--border))"
                          strokeWidth={strokeWidth}
                        />
                        {value !== undefined && (
                          <circle
                            cx={ringSize / 2}
                            cy={ringSize / 2}
                            r={radius}
                            fill="none"
                            stroke={metric.color}
                            strokeWidth={strokeWidth}
                            strokeLinecap="round"
                            strokeDasharray={circumference}
                            strokeDashoffset={strokeDashoffset}
                            className="transition-all duration-500"
                          />
                        )}
                      </svg>
                      <div className="absolute inset-0 flex items-center justify-center">
                        {value !== undefined ? (
                          <span className="text-sm font-semibold text-foreground">{value}</span>
                        ) : (
                          <span className="text-xs text-muted-foreground">--</span>
                        )}
                      </div>
                    </div>
                    <span className="text-[11px] font-medium text-muted-foreground mt-1.5 leading-tight text-center line-clamp-2">{metric.name}</span>
                    {score?.isAutoSynced && (
                      <span className="text-[9px] text-primary/70 mt-0.5">synced</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <Dialog open={!!selectedMetric && !isManageOpen} onOpenChange={(open) => !open && handleCloseDialog()}>
        <DialogContent className="max-w-md sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-base">
              {dialogMode === 'trend' ? `${selectedMetric?.name} Trends` : `Update ${selectedMetric?.name}`}
            </DialogTitle>
            <DialogDescription className="text-xs">
              {dialogMode === 'trend' 
                ? `14-day trend for ${selectedMetric?.name}.`
                : `Enter a score from 0 to ${selectedMetric?.maxValue || 100}.`
              }
            </DialogDescription>
          </DialogHeader>
          
          <div className="py-2">
            {dialogMode === 'trend' && selectedMetric ? (
              <div className="space-y-4">
                <MetricTrendChart 
                  metric={selectedMetric} 
                  history={metricHistory} 
                  selectedDate={today}
                />
                <div className="flex justify-end">
                  <Button size="sm" onClick={() => setDialogMode('edit')}>
                    <Edit className="w-3.5 h-3.5 mr-1.5" />
                    Edit Score
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-6">
                <div className="text-center">
                  {selectedMetric && (() => {
                    const val = parseInt(scoreValue) || 0;
                    const maxVal = selectedMetric.maxValue || 100;
                    const pct = Math.min(100, Math.max(0, (val / maxVal) * 100));
                    const size = 88;
                    const sw = 6;
                    const r = (size - sw) / 2;
                    const c = 2 * Math.PI * r;
                    const offset = c - (pct / 100) * c;
                    return (
                      <div className="relative inline-block" style={{ width: size, height: size }}>
                        <svg width={size} height={size} className="-rotate-90">
                          <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="hsl(var(--border))" strokeWidth={sw} />
                          <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={selectedMetric.color} strokeWidth={sw} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={offset} className="transition-all duration-300" />
                        </svg>
                        <div className="absolute inset-0 flex items-center justify-center">
                          <span className="text-2xl font-bold text-foreground">{val}</span>
                        </div>
                      </div>
                    );
                  })()}
                </div>

                <div className="space-y-3 px-1">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>0</span>
                    <span className="font-medium text-foreground">{parseInt(scoreValue) || 0} / {selectedMetric?.maxValue || 100}</span>
                    <span>{selectedMetric?.maxValue || 100}</span>
                  </div>
                  <Slider
                    min={0}
                    max={selectedMetric?.maxValue || 100}
                    step={1}
                    value={[parseInt(scoreValue) || 0]}
                    onValueChange={([val]) => setScoreValue(String(val))}
                    className="w-full"
                  />
                </div>

                <Button
                  className="w-full"
                  onClick={handleSaveScore}
                  disabled={updateScoreMutation.isPending}
                  size="sm"
                >
                  {updateScoreMutation.isPending ? "Saving..." : "Save"}
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={isManageOpen} onOpenChange={(open) => { if (!open) { setDialogMode('trend'); setSelectedMetric(null); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base">
              {dialogMode === 'addMetric' ? 'Add Metric' : dialogMode === 'editMetric' ? 'Edit Metric' : 'Manage Metrics'}
            </DialogTitle>
            <DialogDescription className="text-xs">
              {dialogMode === 'addMetric' 
                ? 'Create a new metric to track.'
                : dialogMode === 'editMetric'
                ? 'Update the name or color.'
                : 'Add, edit, or remove your tracked metrics.'}
            </DialogDescription>
          </DialogHeader>

          {dialogMode === 'manage' && (
            <div className="space-y-1.5 py-1">
              {metrics.filter(m => m.isActive).map((metric) => (
                <div key={metric.id} className="flex items-center justify-between p-2.5 rounded-lg border border-border/60 hover:border-border transition-colors">
                  <div className="flex items-center gap-2.5">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: metric.color }} />
                    <span className="text-sm font-medium text-foreground">{metric.name}</span>
                  </div>
                  <div className="flex items-center gap-0.5">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleOpenEditMetric(metric)}>
                      <Edit className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive/60 hover:text-destructive hover:bg-destructive/10"
                      onClick={() => {
                        if (confirm(`Remove "${metric.name}"? This won't delete any saved scores.`)) {
                          deleteMetricMutation.mutate(metric.id);
                        }
                      }}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              ))}
              <Button variant="outline" className="w-full mt-2 h-9 text-xs" onClick={handleOpenAddMetric}>
                <Plus className="w-3.5 h-3.5 mr-1.5" />
                Add Metric
              </Button>
            </div>
          )}

          {dialogMode === 'addMetric' && (
            <div className="space-y-4 py-1">
              <div>
                <Label htmlFor="metric-name" className="text-xs">Name</Label>
                <Input
                  id="metric-name"
                  value={newMetricName}
                  onChange={(e) => setNewMetricName(e.target.value)}
                  placeholder="e.g. Focus, Hydration, Exercise"
                  className="mt-1"
                />
              </div>
              <div>
                <Label className="text-xs">Color</Label>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {METRIC_COLORS.map((color) => (
                    <button
                      key={color}
                      className={`w-7 h-7 rounded-full border-2 transition-all ${
                        newMetricColor === color ? 'border-foreground scale-110' : 'border-transparent hover:scale-105'
                      }`}
                      style={{ backgroundColor: color }}
                      onClick={() => setNewMetricColor(color)}
                    />
                  ))}
                </div>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" size="sm" onClick={() => setDialogMode('manage')}>
                  Back
                </Button>
                <Button className="flex-1" size="sm" onClick={handleSaveNewMetric} disabled={addMetricMutation.isPending}>
                  {addMetricMutation.isPending ? "Adding..." : "Add Metric"}
                </Button>
              </div>
            </div>
          )}

          {dialogMode === 'editMetric' && selectedMetric && (
            <div className="space-y-4 py-1">
              <div>
                <Label htmlFor="edit-metric-name" className="text-xs">Name</Label>
                <Input
                  id="edit-metric-name"
                  value={editMetricName}
                  onChange={(e) => setEditMetricName(e.target.value)}
                  className="mt-1"
                />
              </div>
              <div>
                <Label className="text-xs">Color</Label>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {METRIC_COLORS.map((color) => (
                    <button
                      key={color}
                      className={`w-7 h-7 rounded-full border-2 transition-all ${
                        editMetricColor === color ? 'border-foreground scale-110' : 'border-transparent hover:scale-105'
                      }`}
                      style={{ backgroundColor: color }}
                      onClick={() => setEditMetricColor(color)}
                    />
                  ))}
                </div>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" size="sm" onClick={() => setDialogMode('manage')}>
                  Back
                </Button>
                <Button className="flex-1" size="sm" onClick={handleSaveEditMetric} disabled={updateMetricMutation.isPending}>
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
