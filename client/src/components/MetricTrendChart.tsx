import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import type { UserMetric, DailyScore } from "@shared/schema";

interface MetricTrendChartProps {
  metric: UserMetric;
  history: DailyScore[];
  selectedDate: string;
}

export default function MetricTrendChart({ metric, history, selectedDate }: MetricTrendChartProps) {
  // Prepare chart data with all dates in range
  const chartData = history.map(score => ({
    date: score.date,
    value: score.value,
  }));

  // Calculate statistics
  const values = history.map(s => s.value);
  const currentValue = history.find(s => s.date === selectedDate)?.value;
  const last7Days = history.slice(-7);
  const last7Values = last7Days.map(s => s.value);
  const avg7Days = last7Values.length > 0 
    ? Math.round(last7Values.reduce((a, b) => a + b, 0) / last7Values.length)
    : 0;

  const trend = currentValue !== undefined && avg7Days > 0
    ? currentValue - avg7Days
    : 0;

  return (
    <div className="space-y-4">
      {/* Summary stats */}
      <div className="flex items-center justify-center gap-6 text-sm">
        <div className="text-center">
          <div className="text-2xl font-bold" style={{ color: metric.color }}>
            {currentValue !== undefined ? currentValue : "—"}
          </div>
          <div className="text-xs text-muted-foreground">Current</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold text-foreground">
            {avg7Days}
          </div>
          <div className="text-xs text-muted-foreground">7-day avg</div>
        </div>
        {currentValue !== undefined && (
          <div className="text-center">
            <div className={`text-2xl font-bold ${trend > 0 ? 'text-emerald-500' : trend < 0 ? 'text-red-500' : 'text-muted-foreground'}`}>
              {trend > 0 ? '+' : ''}{trend}
            </div>
            <div className="text-xs text-muted-foreground">vs avg</div>
          </div>
        )}
      </div>

      {/* Chart */}
      {chartData.length > 0 ? (
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
            <XAxis 
              dataKey="date" 
              tick={{ fontSize: 11 }}
              tickFormatter={(value) => {
                const date = new Date(value);
                return `${date.getDate()}/${date.getMonth() + 1}`;
              }}
            />
            <YAxis 
              domain={[0, metric.maxValue || 100]}
              tick={{ fontSize: 11 }}
            />
            <Tooltip 
              labelFormatter={(value) => new Date(value).toLocaleDateString("en-GB")}
              formatter={(value: number) => [value, metric.name]}
            />
            <Line
              type="monotone"
              dataKey="value"
              stroke={metric.color}
              strokeWidth={2}
              dot={{ fill: metric.color, r: 4 }}
              activeDot={{ r: 6 }}
            />
          </LineChart>
        </ResponsiveContainer>
      ) : (
        <div className="flex items-center justify-center h-[220px] text-muted-foreground text-sm">
          <p>No data logged yet for this metric</p>
        </div>
      )}
    </div>
  );
}
