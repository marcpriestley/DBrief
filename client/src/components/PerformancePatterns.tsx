import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { BarChart2, TrendingUp, RefreshCw, X } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { haptic } from "@/lib/haptics";

interface PerformancePattern {
  id: number;
  insight: string;
  metric1: string | null;
  metric2: string | null;
  correlation: string | null;
  confidence: string | null;
  generatedAt: string;
}

function ConfidencePip({ level }: { level: string | null }) {
  const high = level === "high";
  return (
    <div className="flex items-center gap-1">
      <div className={`w-1.5 h-1.5 rounded-full ${high ? "bg-primary" : "bg-primary/40"}`} />
      <div className={`w-1.5 h-1.5 rounded-full ${high ? "bg-primary" : "bg-muted-foreground/30"}`} />
      <span className="text-[10px] text-muted-foreground ml-0.5 uppercase tracking-wider font-medium">
        {high ? "High confidence" : "Pattern detected"}
      </span>
    </div>
  );
}

export default function PerformancePatterns() {
  const queryClient = useQueryClient();
  const [dismissed, setDismissed] = useState<Set<number>>(new Set());

  const { data: patterns = [], isLoading } = useQuery<PerformancePattern[]>({
    queryKey: ["/api/performance-patterns"],
    staleTime: 30 * 60 * 1000,
  });

  const generateMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/performance-patterns/generate").then(r => r.json()),
    onSuccess: (data) => {
      if (Array.isArray(data)) {
        queryClient.setQueryData(["/api/performance-patterns"], data);
      }
    },
  });

  const visiblePatterns = patterns.filter(p => !dismissed.has(p.id));

  const handleDismiss = (id: number) => {
    haptic("light");
    setDismissed(prev => new Set([...prev, id]));
  };

  if (isLoading) return null;

  const hasPatterns = visiblePatterns.length > 0;

  if (!hasPatterns && patterns.length === 0) {
    return (
      <div className="bg-card rounded-xl border border-dashed border-border/60 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
              <BarChart2 className="h-4 w-4 text-muted-foreground" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">Data Pattern Analysis</p>
              <p className="text-xs text-muted-foreground mt-0.5">Score correlations from your daily numbers · 30-day window</p>
            </div>
          </div>
          <button
            onClick={() => { haptic("medium"); generateMutation.mutate(); }}
            disabled={generateMutation.isPending}
            className="flex items-center gap-1.5 text-xs font-medium text-primary bg-primary/10 hover:bg-primary/20 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50 shrink-0"
          >
            <RefreshCw className={`h-3 w-3 ${generateMutation.isPending ? "animate-spin" : ""}`} />
            {generateMutation.isPending ? "Scanning…" : "Scan"}
          </button>
        </div>
        {generateMutation.isPending ? (
          <div className="flex items-center gap-2 mt-3 px-1">
            <div className="flex gap-0.5">
              {[0, 100, 200, 300].map(d => (
                <span key={d} className="w-0.5 h-3 bg-primary/50 rounded-full animate-pulse" style={{ animationDelay: `${d}ms` }} />
              ))}
            </div>
            <p className="text-xs text-muted-foreground">Crunching 30 days of score data…</p>
          </div>
        ) : (
          <div className="mt-3 px-1 py-2 rounded-lg bg-muted/40 border border-border/40">
            <p className="text-xs text-muted-foreground leading-relaxed">
              <span className="font-medium text-foreground">Needs 30 days of daily scores.</span> This runs statistical analysis directly on your logged numbers — finding which scores move together, which predict which, and where the real correlations are in your data. Keep logging daily scores and it will start surfacing patterns automatically.
            </p>
          </div>
        )}
      </div>
    );
  }

  if (!hasPatterns) return null;

  return (
    <div className="space-y-2">
      {/* Section header */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <BarChart2 className="h-3.5 w-3.5 text-primary" />
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Data Pattern Analysis</span>
          <span className="text-[10px] text-muted-foreground/50 uppercase tracking-wider">· 30-day scores</span>
        </div>
        <button
          onClick={() => { haptic("light"); generateMutation.mutate(); }}
          disabled={generateMutation.isPending}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          title="Refresh patterns"
        >
          <RefreshCw className={`h-3 w-3 ${generateMutation.isPending ? "animate-spin text-primary" : ""}`} />
        </button>
      </div>

      {/* Pattern cards */}
      <AnimatePresence mode="popLayout">
        {visiblePatterns.map((pattern, idx) => (
          <motion.div
            key={pattern.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, x: 20, height: 0, marginBottom: 0 }}
            transition={{ duration: 0.2, delay: idx * 0.06 }}
            className="bg-card rounded-xl border border-border/50 shadow-sm overflow-hidden"
          >
            <div className="px-4 py-3.5">
              <div className="flex items-start gap-3">
                {/* Icon */}
                <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                  <TrendingUp className="h-3.5 w-3.5 text-primary" />
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-foreground leading-snug font-medium">
                    {pattern.insight}
                  </p>
                  {pattern.correlation && (
                    <div className="mt-2 inline-flex items-center gap-1.5 bg-primary/8 border border-primary/15 rounded-lg px-2.5 py-1">
                      <span className="text-xs font-semibold text-primary tabular-nums">
                        {pattern.correlation}
                      </span>
                    </div>
                  )}
                  <div className="mt-2">
                    <ConfidencePip level={pattern.confidence} />
                  </div>
                </div>

                {/* Dismiss */}
                <button
                  onClick={() => handleDismiss(pattern.id)}
                  className="p-1 text-muted-foreground/40 hover:text-muted-foreground transition-colors shrink-0"
                  aria-label="Dismiss"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
