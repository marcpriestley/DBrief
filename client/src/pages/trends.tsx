import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, BarChart, Bar, Area, AreaChart } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CalendarDays, TrendingUp, Target, Activity, ArrowLeft, BarChart3, LineChart as LineChartIcon, PieChart } from "lucide-react";
import { Link } from "wouter";
import type { DailyScore, UserMetric } from "@shared/schema";

interface TrendData {
  date: string;
  [key: string]: string | number;
}

export default function TrendsEnhanced() {
  const [timeRange, setTimeRange] = useState<string>("30");
  const [selectedMetrics, setSelectedMetrics] = useState<string[]>([]);
  const [chartType, setChartType] = useState<string>("line");

  const { data: metrics = [] } = useQuery<UserMetric[]>({
    queryKey: ["/api/user-metrics"],
  });

  const { data: allScores = [] } = useQuery<DailyScore[]>({
    queryKey: ["/api/daily-scores"],
  });

  // Process data for charts
  const processedData = () => {
    const days = parseInt(timeRange);
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - days);

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
      
      return dayData;
    });

    return trendData;
  };

  const chartData = processedData();
  const displayMetrics = selectedMetrics.length > 0 
    ? metrics.filter(m => selectedMetrics.includes(m.name))
    : metrics.slice(0, 3); // Show first 3 by default

  // Calculate statistics
  const getMetricStats = (metricName: string) => {
    const scores = allScores.filter(s => s.metricName === metricName);
    if (scores.length === 0) return { avg: 0, trend: 0, best: 0, consistency: 0 };
    
    const values = scores.map(s => s.value);
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    const best = Math.max(...values);
    
    // Simple trend calculation (last week vs previous week)
    const recent = values.slice(-7);
    const previous = values.slice(-14, -7);
    const recentAvg = recent.length > 0 ? recent.reduce((a, b) => a + b, 0) / recent.length : 0;
    const previousAvg = previous.length > 0 ? previous.reduce((a, b) => a + b, 0) / previous.length : 0;
    const trend = recentAvg - previousAvg;
    
    // Consistency (inverse of standard deviation)
    const variance = values.reduce((sum, val) => sum + Math.pow(val - avg, 2), 0) / values.length;
    const consistency = Math.max(0, 100 - Math.sqrt(variance));
    
    return { avg, trend, best, consistency };
  };

  const formatTimeRange = (range: string) => {
    const days = parseInt(range);
    if (days === 7) return "1 Week";
    if (days === 14) return "2 Weeks"; 
    if (days === 30) return "1 Month";
    if (days === 90) return "3 Months";
    if (days === 180) return "6 Months";
    if (days === 365) return "1 Year";
    return `${days} Days`;
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
        <YAxis />
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
              dot={{ fill: metric.color, strokeWidth: 2, r: 5 }}
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
              fillOpacity={0.6}
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
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-3">
              <Link href="/">
                <Button variant="ghost" size="icon">
                  <ArrowLeft className="h-4 w-4" />
                </Button>
              </Link>
              <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                <span className="text-white text-sm font-semibold">D</span>
              </div>
              <h1 className="text-xl font-semibold text-gray-900">DBrief - Analytics Dashboard</h1>
            </div>
            
            <div className="flex items-center space-x-4">
              <Select value={timeRange} onValueChange={setTimeRange}>
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="7">1 Week</SelectItem>
                  <SelectItem value="14">2 Weeks</SelectItem>
                  <SelectItem value="30">1 Month</SelectItem>
                  <SelectItem value="90">3 Months</SelectItem>
                  <SelectItem value="180">6 Months</SelectItem>
                  <SelectItem value="365">1 Year</SelectItem>
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
        {/* Stats Overview */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          {metrics.slice(0, 4).map((metric) => {
            const stats = getMetricStats(metric.name);
            
            return (
              <Card key={metric.id}>
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-600">{metric.name}</p>
                      <p className="text-2xl font-bold text-gray-900">{stats.avg.toFixed(1)}</p>
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
                      <span className="text-gray-500">Best Score</span>
                      <span className="font-medium">{stats.best}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">Trend</span>
                      <span className={`font-medium ${stats.trend >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {stats.trend >= 0 ? '+' : ''}{stats.trend.toFixed(1)}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">Consistency</span>
                      <span className="font-medium">{stats.consistency.toFixed(1)}%</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Metric Selection */}
        <Card className="mb-8">
          <CardContent className="p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Select Metrics to Display</h3>
            <div className="flex flex-wrap gap-2">
              {metrics.map((metric) => (
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

        {/* Main Chart */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="flex items-center">
              {chartType === "line" ? <LineChartIcon className="mr-2 h-5 w-5" /> :
               chartType === "area" ? <Activity className="mr-2 h-5 w-5" /> :
               chartType === "bar" ? <BarChart3 className="mr-2 h-5 w-5" /> : 
               <PieChart className="mr-2 h-5 w-5" />}
              {chartType === "line" ? `Trends Over ${formatTimeRange(timeRange)}` :
               chartType === "area" ? `Progress Areas - ${formatTimeRange(timeRange)}` :
               chartType === "bar" ? `Score Comparison - ${formatTimeRange(timeRange)}` : 
               `Activity Heat Map - ${formatTimeRange(timeRange)}`}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {chartType === "heatmap" ? (
              <div className="space-y-4">
                <p className="text-sm text-gray-600 text-center">
                  Heat map showing activity intensity over the selected time period
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
                        title={`${new Date(day.date).toLocaleDateString()}: Avg ${avgScore.toFixed(1)}`}
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

        {/* Weekly Summary */}
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
                  <YAxis />
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
                Goal Progress
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {displayMetrics.map((metric) => {
                const stats = getMetricStats(metric.name);
                const goal = 80; // Example goal
                const progress = (stats.avg / goal) * 100;
                
                return (
                  <div key={metric.name} className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="font-medium">{metric.name}</span>
                      <span className="text-gray-500">{stats.avg.toFixed(1)}/{goal}</span>
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
                      {progress >= 100 ? "Goal achieved!" : `${(100 - progress).toFixed(1)}% to goal`}
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