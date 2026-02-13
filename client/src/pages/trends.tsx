import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, BarChart, Bar, Area, AreaChart } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CalendarDays, TrendingUp, Target, Activity, ArrowLeft, BarChart3, LineChart as LineChartIcon, PieChart, Sparkles, Loader2 } from "lucide-react";
import { Link } from "wouter";
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
  const [chartType, setChartType] = useState<string>("line");
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
    queryFn: () => fetch(`/api/daily-goals-range?startDate=${goalsStartDate}&endDate=${goalsEndDate}`).then(r => r.json()),
  });

  const { data: moodCheckins = [] } = useQuery<MoodCheckin[]>({
    queryKey: ["/api/mood-checkins-range", goalsStartDate, goalsEndDate],
    queryFn: () => fetch(`/api/mood-checkins-range?startDate=${goalsStartDate}&endDate=${goalsEndDate}`).then(r => r.json()),
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
        dayData["Mood"] = Math.round(dayMoods.reduce((sum, c) => sum + c.value, 0) / dayMoods.length);
      } else {
        dayData["Mood"] = 0;
      }
      
      return dayData;
    });

    return trendData;
  };

  const goalsVirtualMetric: UserMetric = { id: -1, userId: 0, name: "Goals", color: "#F97316", maxValue: 100, isDefault: false, isActive: true };
  const moodVirtualMetric: UserMetric = { id: -2, userId: 0, name: "Mood", color: "#EC4899", maxValue: 100, isDefault: false, isActive: true };
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
    const commonXAxis = (
      <XAxis 
        dataKey="date" 
        tick={{ fontSize: 12 }}
        tickFormatter={(value) => {
          const date = new Date(value);
          return `${date.getMonth() + 1}/${date.getDate()}`;
        }}
      />
    );

    const commonProps = (
      <>
        <CartesianGrid strokeDasharray="3 3" />
        {commonXAxis}
        <YAxis domain={[0, 100]} />
        <Tooltip labelFormatter={(value) => new Date(value).toLocaleDateString()} />
        <Legend />
      </>
    );

    if (chartType === "line") {
      return (
        <LineChart data={chartData}>
          {commonProps}
          {displayMetrics.map((metric) => (
            <Line
              key={metric.name}
              type="monotone"
              dataKey={metric.name}
              stroke={metric.color}
              strokeWidth={3}
              dot={{ fill: metric.color, strokeWidth: 2, r: 4 }}
              connectNulls={false}
            />
          ))}
        </LineChart>
      );
    }

    if (chartType === "area") {
      return (
        <AreaChart data={chartData}>
          {commonProps}
          {displayMetrics.map((metric) => (
            <Area
              key={metric.name}
              type="monotone"
              dataKey={metric.name}
              stroke={metric.color}
              fill={metric.color}
              fillOpacity={0.4}
              strokeWidth={2}
            />
          ))}
        </AreaChart>
      );
    }

    return (
      <BarChart data={chartData}>
        {commonProps}
        {displayMetrics.map((metric) => (
          <Bar
            key={metric.name}
            dataKey={metric.name}
            fill={metric.color}
            radius={[4, 4, 0, 0]}
          />
        ))}
      </BarChart>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-wrap justify-between items-center h-auto md:h-16 py-3 md:py-0 gap-3">
            <div className="flex items-center space-x-3">
              <Link href="/">
                <Button variant="ghost" size="icon">
                  <ArrowLeft className="h-4 w-4" />
                </Button>
              </Link>
              <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                <span className="text-white text-sm font-semibold">D</span>
              </div>
              <h1 className="text-xl font-semibold text-gray-900">Trends & Insights</h1>
            </div>
            
            <div className="flex flex-wrap items-center gap-2 sm:gap-4">
              <Select value={timeRange} onValueChange={setTimeRange}>
                <SelectTrigger className="w-32">
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
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="line">Line Chart</SelectItem>
                  <SelectItem value="area">Area Chart</SelectItem>
                  <SelectItem value="bar">Bar Chart</SelectItem>
                  <SelectItem value="heatmap">Heat Map</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          {metrics.slice(0, 4).map((metric) => {
            const stats = getMetricStats(metric.name);
            
            return (
              <Card key={metric.id}>
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-600">{metric.name}</p>
                      <p className="text-2xl font-bold text-gray-900">{stats.avg.toFixed(0)}<span className="text-sm text-gray-400">/100</span></p>
                    </div>
                    <div 
                      className="w-12 h-12 rounded-full flex items-center justify-center"
                      style={{ backgroundColor: `${metric.color}20`, color: metric.color }}
                    >
                      <TrendingUp className="h-6 w-6" />
                    </div>
                  </div>
                  <div className="mt-4 space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">Best</span>
                      <span className="font-medium">{stats.best}/100</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">Trend</span>
                      <span className={`font-medium ${stats.trend >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {stats.trend >= 0 ? '+' : ''}{stats.trend.toFixed(1)}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">Consistency</span>
                      <span className="font-medium">{stats.consistency.toFixed(0)}%</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <Card className="mb-8">
          <CardContent className="p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Select Metrics to Display</h3>
            <div className="flex flex-wrap gap-2">
              {allMetricsWithGoals.map((metric) => (
                <Button
                  key={metric.id}
                  variant={selectedMetrics.includes(metric.name) ? "default" : "outline"}
                  size="sm"
                  onClick={() => {
                    setSelectedMetrics(prev => 
                      prev.includes(metric.name)
                        ? prev.filter(m => m !== metric.name)
                        : [...prev, metric.name]
                    );
                  }}
                  className="flex items-center space-x-2"
                >
                  <div 
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: metric.color }}
                  />
                  <span>{metric.name}</span>
                </Button>
              ))}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelectedMetrics([])}
                disabled={selectedMetrics.length === 0}
              >
                Clear All
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="flex items-center">
              {chartType === "line" ? <LineChartIcon className="mr-2 h-5 w-5" /> :
               chartType === "area" ? <Activity className="mr-2 h-5 w-5" /> :
               chartType === "bar" ? <BarChart3 className="mr-2 h-5 w-5" /> : 
               <PieChart className="mr-2 h-5 w-5" />}
              {`Trends - ${formatTimeRange(timeRange)}`}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {chartType === "heatmap" ? (
              <div className="space-y-4">
                <p className="text-sm text-gray-600 text-center">
                  Activity intensity over the selected time period (all scores on 0-100 scale)
                </p>
                <div className="grid grid-cols-7 gap-2 max-w-lg mx-auto">
                  {chartData.slice(-49).map((day, index) => {
                    const avgScore = displayMetrics.length > 0 
                      ? displayMetrics.reduce((sum, metric) => sum + (day[metric.name] as number || 0), 0) / displayMetrics.length
                      : 0;
                    const intensity = avgScore / 100;
                    
                    return (
                      <div
                        key={index}
                        className="w-8 h-8 rounded border cursor-pointer transition-all hover:scale-110"
                        style={{
                          backgroundColor: `rgba(34, 197, 94, ${intensity})`,
                          borderColor: intensity > 0.3 ? '#22c55e' : '#e5e7eb'
                        }}
                        title={`${new Date(day.date).toLocaleDateString()}: Avg ${avgScore.toFixed(0)}/100`}
                      />
                    );
                  })}
                </div>
                <div className="flex items-center justify-between text-xs text-gray-500 max-w-lg mx-auto">
                  <span>Less active</span>
                  <span>More active</span>
                </div>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={400}>
                {renderChart()}
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <div className="flex items-center">
                <Sparkles className="mr-2 h-5 w-5 text-purple-500" />
                AI Insights
              </div>
              <Button 
                size="sm" 
                onClick={() => generateInsightsMutation.mutate()}
                disabled={generateInsightsMutation.isPending}
              >
                {generateInsightsMutation.isPending ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Analyzing...</>
                ) : (
                  <><Sparkles className="mr-2 h-4 w-4" /> Generate Insights</>
                )}
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {aiInsights.length > 0 ? (
              <div className="space-y-4">
                {aiInsights.slice(0, 5).map((insight) => (
                  <div key={insight.id} className="p-4 bg-purple-50 rounded-lg border border-purple-100">
                    <p className="text-sm text-gray-800">{insight.insight}</p>
                    {insight.tags && insight.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {insight.tags.map((tag, i) => (
                          <span key={i} className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                    {insight.createdAt && (
                      <p className="text-xs text-gray-400 mt-2">
                        {new Date(insight.createdAt).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8">
                <Sparkles className="h-12 w-12 text-gray-300 mx-auto mb-3" />
                <p className="text-gray-500">No insights yet. Add some scores and journal entries, then generate insights to see AI-powered analysis of your patterns.</p>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center">
                <CalendarDays className="mr-2 h-5 w-5" />
                Weekly Averages
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart 
                  data={(() => {
                    const weeklyData = [];
                    for (let i = 0; i < Math.min(4, Math.floor(chartData.length / 7)); i++) {
                      const week = chartData.slice(i * 7, (i + 1) * 7);
                      const weekData: any = { week: `Week ${i + 1}` };
                      
                      displayMetrics.forEach(metric => {
                        const values = week.map(day => day[metric.name] as number).filter(v => v > 0);
                        weekData[metric.name] = values.length > 0 
                          ? values.reduce((a, b) => a + b, 0) / values.length 
                          : 0;
                      });
                      
                      weeklyData.push(weekData);
                    }
                    return weeklyData;
                  })()}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="week" />
                  <YAxis domain={[0, 100]} />
                  <Tooltip />
                  <Legend />
                  {displayMetrics.map((metric) => (
                    <Bar
                      key={metric.name}
                      dataKey={metric.name}
                      fill={metric.color}
                      radius={[4, 4, 0, 0]}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center">
                <Target className="mr-2 h-5 w-5" />
                Goal Progress (Target: 80/100)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {displayMetrics.map((metric) => {
                const stats = getMetricStats(metric.name);
                const goal = 80;
                const progress = (stats.avg / goal) * 100;
                
                return (
                  <div key={metric.name} className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="font-medium">{metric.name}</span>
                      <span className="text-gray-500">{stats.avg.toFixed(0)}/{goal}</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div
                        className="h-2 rounded-full transition-all duration-300"
                        style={{
                          width: `${Math.min(100, progress)}%`,
                          backgroundColor: metric.color
                        }}
                      />
                    </div>
                    <div className="text-xs text-gray-500">
                      {progress >= 100 ? "Goal achieved!" : `${(100 - progress).toFixed(0)}% to goal`}
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
