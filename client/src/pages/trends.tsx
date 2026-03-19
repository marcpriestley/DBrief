import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, BarChart, Bar, Area, AreaChart } from "recharts";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TrendingUp, Sparkles, Loader2 } from "lucide-react";
import AppLayout from "@/components/AppLayout";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { DailyScore, UserMetric, AIInsight, DailyGoal, MoodCheckin } from "@shared/schema";

interface TrendData {
  date: string;
  [key: string]: string | number;
}

export default function TrendsEnhanced() {
  const [timeRange, setTimeRange] = useState<string>("30");
  const [selectedMetrics, setSelectedMetrics] = useState<string[]>([]);
  const [chartType, setChartType] = useState<string>("area");
  const { toast } = useToast();

  const { data: metrics = [] } = useQuery<UserMetric[]>({
    queryKey: ["/api/user-metrics"],
  });

  const { data: allScoresRaw = [] } = useQuery<DailyScore[]>({
    queryKey: ["/api/daily-scores"],
  });

  const { data: aiInsights = [] } = useQuery<AIInsight[]>({
    queryKey: ["/api/ai-insights"],
  });

  const goalsStartDate = (() => {
    const days = timeRange === "all" ? 365 : parseInt(timeRange);
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d.toISOString().split('T')[0];
  })();
  const goalsEndDate = new Date().toISOString().split('T')[0];

  const { data: goalsRange = [] } = useQuery<DailyGoal[]>({
    queryKey: ["/api/daily-goals-range", goalsStartDate, goalsEndDate],
    queryFn: () => fetch(`/api/daily-goals-range?startDate=${goalsStartDate}&endDate=${goalsEndDate}`, { credentials: "include" }).then(r => r.json()),
  });

  const { data: moodCheckins = [] } = useQuery<MoodCheckin[]>({
    queryKey: ["/api/mood-checkins-range", goalsStartDate, goalsEndDate],
    queryFn: () => fetch(`/api/mood-checkins-range?startDate=${goalsStartDate}&endDate=${goalsEndDate}`, { credentials: "include" }).then(r => r.json()),
  });
  
  const allScores = allScoresRaw.filter(score => !score.isAutoSynced);

  const generateInsightsMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/ai-insights/generate");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai-insights"] });
      toast({ title: "Insights generated", description: "New AI insights are ready." });
    },
    onError: () => {
      toast({ title: "Could not generate insights", description: "Please try again later.", variant: "destructive" });
    },
  });

  const processedData = () => {
    const days = timeRange === "all" ? 9999 : parseInt(timeRange);
    const endDate = new Date();
    const startDate = new Date();
    
    if (timeRange === "all" && allScores.length > 0) {
      const dates = allScores.map(s => new Date(s.date).getTime());
      startDate.setTime(Math.min(...dates));
    } else {
      startDate.setDate(endDate.getDate() - days);
    }

    const dateRange: string[] = [];
    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      dateRange.push(d.toISOString().split('T')[0]);
    }

    const trendData: TrendData[] = dateRange.map(date => {
      const dayData: TrendData = { date };
      
      metrics.forEach(metric => {
        const score = allScores.find(s => s.date === date && s.metricName === metric.name);
        dayData[metric.name] = score?.value || 0;
      });

      const dayGoals = goalsRange.filter(g => g.date === date);
      if (dayGoals.length > 0) {
        const completed = dayGoals.filter(g => g.completed).length;
        dayData["Goals"] = Math.round((completed / dayGoals.length) * 100);
      } else {
        dayData["Goals"] = 0;
      }

      const dayMoods = moodCheckins.filter(c => c.date === date);
      if (dayMoods.length > 0) {
        dayData["Mood Check-in"] = Math.round(dayMoods.reduce((sum, c) => sum + c.value, 0) / dayMoods.length);
      } else {
        dayData["Mood Check-in"] = 0;
      }
      
      return dayData;
    });

    return trendData;
  };

  const goalsVirtualMetric: UserMetric = { id: -1, userId: 0, name: "Goals", color: "#F97316", maxValue: 100, isDefault: false, isActive: true };
  const moodVirtualMetric: UserMetric = { id: -2, userId: 0, name: "Mood Check-in", color: "#EC4899", maxValue: 100, isDefault: false, isActive: true };
  const allMetricsWithGoals = [...metrics, goalsVirtualMetric, moodVirtualMetric];

  const chartData = processedData();
  const displayMetrics = selectedMetrics.length > 0 
    ? allMetricsWithGoals.filter(m => selectedMetrics.includes(m.name))
    : metrics.slice(0, 3);

  const getMetricStats = (metricName: string) => {
    const days = timeRange === "all" ? 9999 : parseInt(timeRange);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffStr = cutoff.toISOString().split('T')[0];
    
    const scores = allScores.filter(s => 
      s.metricName === metricName && (timeRange === "all" || s.date >= cutoffStr)
    );
    if (scores.length === 0) return { avg: 0, trend: 0, best: 0, consistency: 0 };
    
    const values = scores.map(s => s.value);
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    const best = Math.max(...values);
    
    const recent = values.slice(-7);
    const previous = values.slice(-14, -7);
    const recentAvg = recent.length > 0 ? recent.reduce((a, b) => a + b, 0) / recent.length : 0;
    const previousAvg = previous.length > 0 ? previous.reduce((a, b) => a + b, 0) / previous.length : 0;
    const trend = recentAvg - previousAvg;
    
    const variance = values.reduce((sum, val) => sum + Math.pow(val - avg, 2), 0) / values.length;
    const consistency = Math.max(0, 100 - Math.sqrt(variance));
    
    return { avg, trend, best, consistency };
  };

  const formatTimeRange = (range: string) => {
    if (range === "7") return "7 Days";
    if (range === "30") return "30 Days";
    if (range === "180") return "6 Months";
    if (range === "all") return "Lifetime";
    return `${range} Days`;
  };

  const renderChart = () => {
    const axisStyle = { fontSize: 11, fill: 'hsl(220, 10%, 46%)' };
    
    const commonXAxis = (
      <XAxis 
        dataKey="date" 
        tick={axisStyle}
        tickFormatter={(value) => {
          const date = new Date(value);
          return `${date.getMonth() + 1}/${date.getDate()}`;
        }}
        axisLine={false}
        tickLine={false}
      />
    );

    if (chartType === "line") {
      return (
        <LineChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(220, 14%, 92%)" vertical={false} />
          {commonXAxis}
          <YAxis domain={[0, 100]} tick={axisStyle} axisLine={false} tickLine={false} width={30} />
          <Tooltip
            labelFormatter={(value) => new Date(value).toLocaleDateString()}
            contentStyle={{ borderRadius: '8px', border: '1px solid hsl(220, 14%, 90%)', fontSize: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}
          />
          <Legend wrapperStyle={{ fontSize: '12px' }} />
          {displayMetrics.map((metric) => (
            <Line
              key={metric.name}
              type="monotone"
              dataKey={metric.name}
              stroke={metric.color}
              strokeWidth={2}
              dot={{ fill: metric.color, strokeWidth: 0, r: 2.5 }}
              activeDot={{ r: 4, strokeWidth: 0 }}
              connectNulls={false}
            />
          ))}
        </LineChart>
      );
    }

    if (chartType === "area") {
      return (
        <AreaChart data={chartData}>
          <defs>
            {displayMetrics.map((metric) => (
              <linearGradient key={`grad-${metric.name}`} id={`grad-${metric.name}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={metric.color} stopOpacity={0.2} />
                <stop offset="95%" stopColor={metric.color} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(220, 14%, 92%)" vertical={false} />
          {commonXAxis}
          <YAxis domain={[0, 100]} tick={axisStyle} axisLine={false} tickLine={false} width={30} />
          <Tooltip
            labelFormatter={(value) => new Date(value).toLocaleDateString()}
            contentStyle={{ borderRadius: '8px', border: '1px solid hsl(220, 14%, 90%)', fontSize: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}
          />
          <Legend wrapperStyle={{ fontSize: '12px' }} />
          {displayMetrics.map((metric) => (
            <Area
              key={metric.name}
              type="monotone"
              dataKey={metric.name}
              stroke={metric.color}
              fill={`url(#grad-${metric.name})`}
              strokeWidth={2}
            />
          ))}
        </AreaChart>
      );
    }

    return (
      <BarChart data={chartData}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(220, 14%, 92%)" vertical={false} />
        {commonXAxis}
        <YAxis domain={[0, 100]} tick={axisStyle} axisLine={false} tickLine={false} width={30} />
        <Tooltip
          labelFormatter={(value) => new Date(value).toLocaleDateString()}
          contentStyle={{ borderRadius: '8px', border: '1px solid hsl(220, 14%, 90%)', fontSize: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}
        />
        <Legend wrapperStyle={{ fontSize: '12px' }} />
        {displayMetrics.map((metric) => (
          <Bar
            key={metric.name}
            dataKey={metric.name}
            fill={metric.color}
            radius={[4, 4, 0, 0]}
            maxBarSize={24}
          />
        ))}
      </BarChart>
    );
  };

  return (
    <AppLayout>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-foreground">Performance Trends</h2>
          <div className="flex items-center gap-1.5">
            <Select value={timeRange} onValueChange={setTimeRange}>
              <SelectTrigger className="h-8 w-24 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">7 Days</SelectItem>
                <SelectItem value="30">30 Days</SelectItem>
                <SelectItem value="180">6 Months</SelectItem>
                <SelectItem value="all">Lifetime</SelectItem>
              </SelectContent>
            </Select>
            <Select value={chartType} onValueChange={setChartType}>
              <SelectTrigger className="h-8 w-20 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="area">Area</SelectItem>
                <SelectItem value="line">Line</SelectItem>
                <SelectItem value="bar">Bar</SelectItem>
                <SelectItem value="heatmap">Heat</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        {metrics.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {metrics.slice(0, 4).map((metric) => {
              const stats = getMetricStats(metric.name);
              return (
                <Card key={metric.id} className="border-border/50 shadow-sm">
                  <CardContent className="p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: metric.color }} />
                      <span className="text-[11px] font-medium text-muted-foreground truncate">{metric.name}</span>
                    </div>
                    <div className="flex items-baseline gap-1">
                      <span className="text-xl font-bold text-foreground">{stats.avg.toFixed(0)}</span>
                      <span className="text-[10px] text-muted-foreground">/100</span>
                    </div>
                    <div className="flex items-center gap-1 mt-1">
                      <TrendingUp className={`h-3 w-3 ${stats.trend >= 0 ? 'text-emerald-500' : 'text-red-500'}`} />
                      <span className={`text-[10px] font-medium ${stats.trend >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                        {stats.trend >= 0 ? '+' : ''}{stats.trend.toFixed(1)}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        <Card className="border-border/50 shadow-sm">
          <CardContent className="p-3">
            <div className="flex flex-wrap gap-1.5">
              {allMetricsWithGoals.map((metric) => (
                <button
                  key={metric.id}
                  onClick={() => {
                    setSelectedMetrics(prev => 
                      prev.includes(metric.name)
                        ? prev.filter(m => m !== metric.name)
                        : [...prev, metric.name]
                    );
                  }}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all ${
                    selectedMetrics.includes(metric.name)
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'bg-muted text-muted-foreground hover:bg-muted/80'
                  }`}
                >
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: selectedMetrics.includes(metric.name) ? 'white' : metric.color }} />
                  {metric.name}
                </button>
              ))}
              {selectedMetrics.length > 0 && (
                <button
                  onClick={() => setSelectedMetrics([])}
                  className="text-xs text-muted-foreground hover:text-foreground px-2 py-1"
                >
                  Clear
                </button>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/50 shadow-sm">
          <CardContent className="p-4">
            <div className="text-xs font-medium text-muted-foreground mb-3">
              {formatTimeRange(timeRange)}
            </div>
            {chartType === "heatmap" ? (
              <div className="space-y-3">
                <div className="grid grid-cols-7 gap-1.5 max-w-xs mx-auto">
                  {chartData.slice(-49).map((day, index) => {
                    const avgScore = displayMetrics.length > 0 
                      ? displayMetrics.reduce((sum, metric) => sum + (day[metric.name] as number || 0), 0) / displayMetrics.length
                      : 0;
                    const intensity = avgScore / 100;
                    
                    return (
                      <div
                        key={index}
                        className="aspect-square rounded-sm cursor-pointer transition-transform hover:scale-125"
                        style={{
                          backgroundColor: intensity > 0 ? `rgba(79, 70, 229, ${0.15 + intensity * 0.7})` : 'hsl(220, 14%, 94%)',
                        }}
                        title={`${new Date(day.date).toLocaleDateString()}: ${avgScore.toFixed(0)}/100`}
                      />
                    );
                  })}
                </div>
                <div className="flex items-center justify-between text-[10px] text-muted-foreground max-w-xs mx-auto px-0.5">
                  <span>Less</span>
                  <div className="flex gap-0.5">
                    {[0.15, 0.35, 0.55, 0.75, 0.9].map((o, i) => (
                      <div key={i} className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: `rgba(79, 70, 229, ${o})` }} />
                    ))}
                  </div>
                  <span>More</span>
                </div>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                {renderChart()}
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card className="border-border/50 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                <span className="text-sm font-semibold text-foreground">AI Insights</span>
              </div>
              <Button 
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                onClick={() => generateInsightsMutation.mutate()}
                disabled={generateInsightsMutation.isPending}
              >
                {generateInsightsMutation.isPending ? (
                  <><Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> Analyzing</>
                ) : (
                  <><Sparkles className="mr-1.5 h-3 w-3" /> Generate</>
                )}
              </Button>
            </div>
            {aiInsights.length > 0 ? (
              <div className="space-y-3">
                {aiInsights.slice(0, 3).map((insight) => (
                  <div key={insight.id} className="p-3 bg-primary/5 rounded-lg border border-primary/10">
                    <p className="text-sm text-foreground leading-relaxed">{insight.insight}</p>
                    {insight.tags && insight.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {insight.tags.map((tag, i) => (
                          <span key={i} className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full font-medium">
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-6">
                <Sparkles className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
                <p className="text-xs text-muted-foreground">Add scores and complete debriefs to unlock AI insights.</p>
              </div>
            )}
          </CardContent>
        </Card>

        {displayMetrics.length > 0 && (
          <Card className="border-border/50 shadow-sm">
            <CardContent className="p-4">
              <div className="text-xs font-medium text-muted-foreground mb-3">Goal Progress</div>
              <div className="space-y-3">
                {displayMetrics.map((metric) => {
                  const stats = getMetricStats(metric.name);
                  const goal = 80;
                  const progress = (stats.avg / goal) * 100;
                  
                  return (
                    <div key={metric.name} className="space-y-1.5">
                      <div className="flex justify-between text-xs">
                        <div className="flex items-center gap-1.5">
                          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: metric.color }} />
                          <span className="font-medium text-foreground">{metric.name}</span>
                        </div>
                        <span className="text-muted-foreground">{stats.avg.toFixed(0)}/80</span>
                      </div>
                      <div className="w-full bg-muted rounded-full h-1.5">
                        <div
                          className="h-1.5 rounded-full transition-all duration-500"
                          style={{
                            width: `${Math.min(100, progress)}%`,
                            backgroundColor: metric.color
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  );
}
