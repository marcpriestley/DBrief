import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { haptic } from "@/lib/haptics";
import { AnimatePresence, motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, resolveUrl } from "@/lib/queryClient";
import type { DailyScore, UserMetric } from "@shared/schema";
import { Heart, Edit, Plus, Settings, Trash2, X, Lock } from "lucide-react";
import MetricTrendChart from "./MetricTrendChart";
import { useSubscription } from "@/hooks/useSubscription";
import { usePaywall } from "@/contexts/PaywallContext";
import NativeSlider from "@/components/ui/native-slider";

const FREE_METRIC_LIMIT = 3;

function NativeOverlay({ open, onClose, title, description, children, scrollable = false }: {
  open: boolean; onClose: () => void; title: string; description?: string; children: React.ReactNode; scrollable?: boolean;
}) {
  useEffect(() => {
    if (open) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => { document.body.style.overflow = prev; };
    }
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <div
          className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center"
          style={scrollable ? undefined : { touchAction: 'none' }}
        >
          <motion.div
            className="fixed inset-0 bg-black/50"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            className={`relative bg-background rounded-t-2xl sm:rounded-2xl shadow-xl w-full max-w-md mx-0 sm:mx-4 z-10 ${scrollable ? "overflow-y-auto" : "overflow-hidden"}`}
            style={{
              maxHeight: 'calc(88dvh - env(safe-area-inset-top))',
              paddingTop: '1.25rem',
              paddingLeft: '1.25rem',
              paddingRight: '1.25rem',
              paddingBottom: 'calc(var(--sai-bottom, env(safe-area-inset-bottom, 0px)) + 1.25rem)',
            }}
            initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 40 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <button className="absolute top-3 right-3 text-muted-foreground hover:text-foreground p-1" onClick={onClose}>
              <X className="h-4 w-4" />
            </button>
            <div className="mb-4 pr-6">
              <h2 className="text-base font-semibold">{title}</h2>
              {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
            </div>
            {children}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

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
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { isPremium } = useSubscription();
  const { openPaywall } = usePaywall();
  
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
    queryFn: () => fetch(resolveUrl(`/api/daily-scores/${selectedDate}`), { credentials: "include" }).then(res => res.json()),
    staleTime: 0,
  });

  const { data: metricHistory = [] } = useQuery<DailyScore[]>({
    queryKey: ["/api/metric-history", selectedMetric?.name],
    queryFn: () => {
      if (!selectedMetric) return Promise.resolve([]);
      return fetch(resolveUrl(`/api/metric-history/${selectedMetric.name}?days=14`), { credentials: "include" }).then(res => res.json());
    },
    enabled: !!selectedMetric,
  });

  const updateScoreMutation = useMutation({
    mutationFn: async (data: { date: string; metricName: string; value: number }) => {
      return apiRequest("POST", "/api/daily-scores", data);
    },
    onSuccess: () => {
      haptic("success");
      queryClient.invalidateQueries({ queryKey: ["/api/daily-scores", selectedDate] });
      queryClient.invalidateQueries({ queryKey: ["/api/dates-with-data"] });
      queryClient.invalidateQueries({ queryKey: ["/api/streak"] });
      queryClient.invalidateQueries({ queryKey: ["/api/me/points"] });
      
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
    haptic("light");
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
    if (!isPremium && activeMetrics.length >= FREE_METRIC_LIMIT) {
      openPaywall("Unlimited Metric Tracking");
      return;
    }
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
      <div className="bg-card/70 backdrop-blur-sm rounded-2xl border border-border/50 shadow-sm overflow-hidden">
        <div className="px-5 py-4 flex justify-between items-center border-b border-border/30">
          <h2 className="text-base font-semibold text-foreground tracking-tight">
            {isToday ? "Daily Scores" : `Scores — ${new Date(selectedDate + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`}
          </h2>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={handleOpenAddMetric}
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              title="Add metric"
            >
              {!isPremium && activeMetrics.length >= FREE_METRIC_LIMIT
                ? <Lock className="w-3.5 h-3.5" />
                : <Plus className="w-3.5 h-3.5" />}
            </Button>
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
          <div className="p-4">
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
              {activeMetrics.map((metric) => {
                const score = getScoreForMetric(metric.name);
                const value = score?.value;
                const maxValue = metric.maxValue || 100;
                const percentage = value !== undefined ? Math.min(100, Math.max(0, (value / maxValue) * 100)) : 0;
                const ringSize = 64;
                const strokeWidth = 4;
                const radius = (ringSize - strokeWidth) / 2;
                const circumference = 2 * Math.PI * radius;
                const strokeDashoffset = circumference - (percentage / 100) * circumference;

                return (
                  <button
                    key={metric.id} 
                    onClick={() => handleMetricClick(metric)}
                    className="flex flex-col items-center py-3.5 px-1 rounded-xl hover:bg-muted/40 transition-colors cursor-pointer group"
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
                          <span className="text-base font-bold text-foreground">{value}</span>
                        ) : (
                          <span className="text-sm text-muted-foreground">--</span>
                        )}
                      </div>
                    </div>
                    <span className="text-xs font-medium text-muted-foreground mt-2 leading-tight text-center line-clamp-2">{metric.name}</span>
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

      <NativeOverlay
        open={!!selectedMetric && !isManageOpen}
        onClose={handleCloseDialog}
        title={dialogMode === 'trend' ? `${selectedMetric?.name} Trends` : `Update ${selectedMetric?.name}`}
        description={dialogMode === 'trend' ? `14-day trend for ${selectedMetric?.name}.` : `Enter a score from 0 to ${selectedMetric?.maxValue || 100}.`}
      >
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
                <NativeSlider
                  min={0}
                  max={selectedMetric?.maxValue || 100}
                  value={parseInt(scoreValue) || 0}
                  onChange={(val) => setScoreValue(String(val))}
                  color={selectedMetric?.color || "hsl(40, 95%, 48%)"}
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
      </NativeOverlay>

      <NativeOverlay
        open={isManageOpen}
        onClose={() => { setDialogMode('trend'); setSelectedMetric(null); }}
        title={dialogMode === 'addMetric' ? 'Add Metric' : dialogMode === 'editMetric' ? 'Edit Metric' : 'Manage Metrics'}
        description={dialogMode === 'addMetric' ? 'Create a new metric to track.' : dialogMode === 'editMetric' ? 'Update the name or color.' : 'Add, edit, or remove your tracked metrics.'}
        scrollable
      >
        {dialogMode === 'manage' && (
          <div className="space-y-1.5 py-1">
            {metrics.filter(m => m.isActive).map((metric) => (
              <div key={metric.id} className="rounded-lg border border-border/60 overflow-hidden">
                {confirmDeleteId === metric.id ? (
                  <div className="flex items-center justify-between p-2.5 bg-destructive/5">
                    <span className="text-xs text-foreground">Remove "{metric.name}"?</span>
                    <div className="flex gap-1.5">
                      <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => setConfirmDeleteId(null)}>Cancel</Button>
                      <Button size="sm" variant="destructive" className="h-6 px-2 text-xs" onClick={() => { deleteMetricMutation.mutate(metric.id); setConfirmDeleteId(null); }}>Remove</Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between p-2.5">
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
                        onClick={() => setConfirmDeleteId(metric.id)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ))}
            {!isPremium && (
              <div className="flex items-center justify-between px-1 py-1.5 text-[11px] text-muted-foreground">
                <span>{activeMetrics.length} of {FREE_METRIC_LIMIT} free metrics used</span>
                {activeMetrics.length >= FREE_METRIC_LIMIT && (
                  <span className="text-primary font-medium">Upgrade for unlimited</span>
                )}
              </div>
            )}
            <Button variant="outline" className="w-full mt-1 h-9 text-xs" onClick={handleOpenAddMetric}>
              {!isPremium && activeMetrics.length >= FREE_METRIC_LIMIT
                ? <><Lock className="w-3.5 h-3.5 mr-1.5" />Unlock More Metrics</>
                : <><Plus className="w-3.5 h-3.5 mr-1.5" />Add Metric</>
              }
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
      </NativeOverlay>
    </>
  );
}
