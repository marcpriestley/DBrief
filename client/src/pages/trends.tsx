import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, BarChart, Bar, Area, AreaChart } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CalendarDays, TrendingUp, Target, Activity } from "lucide-react";
import type { DailyScore, UserMetric } from "@shared/schema";

interface TrendData {
  date: string;
  [key: string]: string | number;
}

export default function Trends() {
  const [timeRange, setTimeRange] = useState<string>("30");
  const [selectedMetrics, setSelectedMetrics] = useState<string[]>([]);

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
        dayData[metric.name] = score?.value ?? 0;
      });
      
      return dayData;
    });

    return trendData;
  };

  const chartData = processedData();

  // Calculate statistics
  const getMetricStats = (metricName: string) => {
    const values = allScores
      .filter(score => score.metricName === metricName && score.value > 0)
      .map(score => score.value);
    
    if (values.length === 0) return { avg: 0, min: 0, max: 0, trend: 0 };

    const avg = values.reduce((sum, val) => sum + val, 0) / values.length;
    const min = Math.min(...values);
    const max = Math.max(...values);
    
    // Simple trend calculation (last 7 days vs previous 7 days)
    const recent = values.slice(-7);
    const previous = values.slice(-14, -7);
    const recentAvg = recent.length > 0 ? recent.reduce((sum, val) => sum + val, 0) / recent.length : 0;
    const previousAvg = previous.length > 0 ? previous.reduce((sum, val) => sum + val, 0) / previous.length : 0;
    const trend = recentAvg - previousAvg;

    return { avg: Math.round(avg), min, max, trend: Math.round(trend) };
  };

  const activeMetrics = selectedMetrics.length > 0 ? metrics.filter(m => selectedMetrics.includes(m.name)) : metrics.slice(0, 4);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                <span className="text-white text-sm font-semibold">D</span>
              </div>
              <h1 className="text-xl font-semibold text-gray-900">DBrief - Trends</h1>
            </div>
            
            <div className="flex items-center space-x-4">
              <Select value={timeRange} onValueChange={setTimeRange}>
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="7">7 days</SelectItem>
                  <SelectItem value="14">14 days</SelectItem>
                  <SelectItem value="30">30 days</SelectItem>
                  <SelectItem value="90">90 days</SelectItem>
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
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">{metric.name}</CardTitle>
                  <div 
                    className="w-4 h-4 rounded-full"
                    style={{ backgroundColor: metric.color }}
                  />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{stats.avg}</div>
                  <div className="flex items-center text-xs text-muted-foreground">
                    <TrendingUp className="mr-1 h-3 w-3" />
                    <span className={stats.trend >= 0 ? "text-green-600" : "text-red-600"}>
                      {stats.trend >= 0 ? "+" : ""}{stats.trend} vs last week
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    Range: {stats.min} - {stats.max}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Metric Selection */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="flex items-center">
              <Target className="mr-2 h-5 w-5" />
              Select Metrics to Display
            </CardTitle>
          </CardHeader>
          <CardContent>
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

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Line Chart */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center">
                <Activity className="mr-2 h-5 w-5" />
                Trend Over Time
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis 
                    dataKey="date" 
                    tick={{ fontSize: 12 }}
                    tickFormatter={(value) => new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  />
                  <YAxis domain={[0, 100]} />
                  <Tooltip 
                    labelFormatter={(value) => new Date(value).toLocaleDateString()}
                    formatter={(value: any, name: string) => [value || 'No data', name]}
                  />
                  <Legend />
                  {activeMetrics.map((metric) => (
                    <Line
                      key={metric.id}
                      type="monotone"
                      dataKey={metric.name}
                      stroke={metric.color}
                      strokeWidth={2}
                      dot={{ fill: metric.color, strokeWidth: 2, r: 4 }}
                      connectNulls={false}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Area Chart */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center">
                <CalendarDays className="mr-2 h-5 w-5" />
                Daily Patterns
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <AreaChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis 
                    dataKey="date" 
                    tick={{ fontSize: 12 }}
                    tickFormatter={(value) => new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  />
                  <YAxis domain={[0, 100]} />
                  <Tooltip 
                    labelFormatter={(value) => new Date(value).toLocaleDateString()}
                    formatter={(value: any, name: string) => [value || 'No data', name]}
                  />
                  <Legend />
                  {activeMetrics.slice(0, 2).map((metric, index) => (
                    <Area
                      key={metric.id}
                      type="monotone"
                      dataKey={metric.name}
                      stackId={index === 0 ? "1" : "2"}
                      stroke={metric.color}
                      fill={metric.color}
                      fillOpacity={0.3}
                    />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Bar Chart - Weekly Averages */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Weekly Averages</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart 
                  data={chartData.filter((_, index) => index % 7 === 0).map(item => {
                    const weekData = { ...item };
                    // Calculate weekly averages
                    metrics.forEach(metric => {
                      const weekValues = chartData
                        .slice(chartData.indexOf(item), chartData.indexOf(item) + 7)
                        .map(d => d[metric.name] as number)
                        .filter(v => v && v > 0);
                      
                      weekData[metric.name] = weekValues.length > 0 
                        ? Math.round(weekValues.reduce((sum, val) => sum + val, 0) / weekValues.length)
                        : 0;
                    });
                    return weekData;
                  })}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis 
                    dataKey="date" 
                    tick={{ fontSize: 12 }}
                    tickFormatter={(value) => `Week of ${new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}
                  />
                  <YAxis domain={[0, 100]} />
                  <Tooltip 
                    labelFormatter={(value) => `Week of ${new Date(value).toLocaleDateString()}`}
                  />
                  <Legend />
                  {activeMetrics.map((metric) => (
                    <Bar
                      key={metric.id}
                      dataKey={metric.name}
                      fill={metric.color}
                      radius={[4, 4, 0, 0]}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>

        {/* Insights */}
        <Card className="mt-8">
          <CardHeader>
            <CardTitle>Key Insights</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {metrics.slice(0, 3).map((metric) => {
                const stats = getMetricStats(metric.name);
                const recentScores = allScores
                  .filter(score => score.metricName === metric.name)
                  .slice(-7)
                  .map(s => s.value);
                
                const consistency = recentScores.length > 1 
                  ? 100 - (Math.max(...recentScores) - Math.min(...recentScores))
                  : 0;

                return (
                  <div key={metric.id} className="p-4 bg-gray-50 rounded-lg">
                    <div className="flex items-center space-x-2 mb-2">
                      <div 
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: metric.color }}
                      />
                      <h4 className="font-medium">{metric.name}</h4>
                    </div>
                    <p className="text-sm text-gray-600 mb-1">
                      Average: <span className="font-medium">{stats.avg}/100</span>
                    </p>
                    <p className="text-sm text-gray-600 mb-1">
                      Consistency: <span className="font-medium">{Math.round(consistency)}%</span>
                    </p>
                    <p className="text-sm text-gray-600">
                      Trend: <span className={`font-medium ${stats.trend >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {stats.trend >= 0 ? 'Improving' : 'Declining'}
                      </span>
                    </p>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}