import { useQuery } from "@tanstack/react-query";
import type { DailyScore, UserMetric } from "@shared/schema";

interface ScoreDashboardProps {
  selectedDate: string;
}

export default function ScoreDashboard({ selectedDate }: ScoreDashboardProps) {
  const { data: metrics = [] } = useQuery<UserMetric[]>({
    queryKey: ["/api/user-metrics"],
  });

  const { data: scores = [] } = useQuery<DailyScore[]>({
    queryKey: ["/api/daily-scores", selectedDate],
  });

  const { data: previousScores = [] } = useQuery<DailyScore[]>({
    queryKey: ["/api/daily-scores", getPreviousDate(selectedDate)],
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

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
      {metrics.map((metric) => {
        const score = getScoreForMetric(metric.name);
        const previousScore = getPreviousScoreForMetric(metric.name);
        const value = score?.value || 0;
        const percentage = Math.min(100, Math.max(0, value));

        return (
          <div 
            key={metric.id} 
            className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 text-center"
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
  );
}
