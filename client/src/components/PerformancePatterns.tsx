import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { BarChart2, TrendingUp, RefreshCw, X, Lock } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { haptic } from "@/lib/haptics";
import { useSubscription } from "@/hooks/useSubscription";
import { usePaywall } from "@/contexts/PaywallContext";

interface PerformancePattern {
  id: number;
  insight: string;
  metric1: string | null;
  metric2: string | null;
  correlation: string | null;
  confidence: string | null;
  generatedAt: string;
}

type StreakResponse = {
  currentStreak: number;
  longestStreak: number;
  recentActiveDays: number;
  insightsUnlocked: boolean;
  dataDays: number;
};

// Confidence tier derived from how many days of data have been logged
function getConfidenceTier(dataDays: number): { label: string; color: string; next: number | null; nextLabel: string } {
  if (dataDays < 5)  return { label: "",                color: "",                  next: 5,  nextLabel: "Early Read" };
  if (dataDays < 14) return { label: "Early Read",       color: "text-amber-500",    next: 14, nextLabel: "Building Confidence" };
  if (dataDays < 30) return { label: "Building Confidence", color: "text-blue-500", next: 30, nextLabel: "Full Analysis" };
  return              { label: "Full Analysis",          color: "text-primary",      next: null, nextLabel: "" };
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
  const { isPremium } = useSubscription();
  const { openPaywall } = usePaywall();

  const { data: patterns = [], isLoading: patternsLoading } = useQuery<PerformancePattern[]>({
    queryKey: ["/api/performance-patterns"],
    staleTime: 30 * 60 * 1000,
  });

  const { data: streak } = useQuery<StreakResponse>({
    queryKey: ["/api/streak"],
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
  const dataDays = streak?.dataDays ?? 0;
  const tier = getConfidenceTier(dataDays);
  const hasPatterns = visiblePatterns.length > 0;

  if (patternsLoading) return null;

  // ── Premium gate ──────────────────────────────────────────────────────────
  if (!isPremium) {
    return (
      <div className="bg-card rounded-xl border border-border/50 shadow-sm overflow-hidden">
        <button
          className="w-full px-4 py-4 flex items-center justify-between text-left"
          onClick={() => { haptic("medium"); openPaywall("Data Pattern Analysis"); }}
        >
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
              <BarChart2 className="h-4 w-4 text-muted-foreground" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">Data Pattern Analysis</p>
              <p className="text-xs text-muted-foreground mt-0.5">Score correlations from your daily numbers</p>
            </div>
          </div>
          <Lock className="h-4 w-4 text-primary/60 flex-shrink-0" />
        </button>
        <div className="px-4 pb-4 border-t border-border/30">
          <button
            onClick={() => { haptic("medium"); openPaywall("Data Pattern Analysis"); }}
            className="mt-3 text-xs text-primary font-medium hover:underline"
          >
            Unlock with Premium — £5.99/month →
          </button>
        </div>
      </div>
    );
  }

  // ── Pre-unlock: not enough data yet ────────────────────────────────────────
  if (dataDays < 5) {
    const daysLeft = 5 - dataDays;
    const progress = Math.min(100, Math.round((dataDays / 5) * 100));
    return (
      <div className="bg-card rounded-xl border border-dashed border-border/60 p-4">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
            <BarChart2 className="h-4 w-4 text-muted-foreground" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">Data Pattern Analysis</p>
            <p className="text-xs text-muted-foreground mt-0.5">Score correlations from your daily numbers</p>
          </div>
        </div>
        <div className="mt-1 px-1 py-2.5 rounded-lg bg-muted/40 border border-border/40">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-muted-foreground">
              First scan unlocks in <span className="font-semibold text-foreground">{daysLeft} more day{daysLeft !== 1 ? "s" : ""} of logging</span>
            </p>
            <span className="text-xs font-medium text-muted-foreground">{dataDays}/5</span>
          </div>
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-primary/60 to-primary rounded-full transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-[11px] text-muted-foreground/60 mt-2 leading-relaxed">
            Statistical analysis of your daily score numbers — which metrics move together, which predict which. Gets sharper every day you log.
          </p>
        </div>
      </div>
    );
  }

  // ── Eligible but no patterns yet ────────────────────────────────────────────
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
              <p className="text-xs text-muted-foreground mt-0.5">
                Score correlations · <span className={tier.color}>{tier.label}</span>
              </p>
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
            <p className="text-xs text-muted-foreground">Crunching {dataDays} days of score data…</p>
          </div>
        ) : (
          <div className="mt-3 px-1 py-2 rounded-lg bg-muted/40 border border-border/40">
            {tier.next && (
              <div className="mb-2">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-[11px] text-muted-foreground/70">{dataDays} days logged — next tier: <span className="font-medium text-foreground">{tier.nextLabel}</span> at {tier.next} days</p>
                  <span className="text-[11px] text-muted-foreground">{dataDays}/{tier.next}</span>
                </div>
                <div className="h-1 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary/40 rounded-full transition-all duration-500"
                    style={{ width: `${Math.min(100, Math.round((dataDays / tier.next) * 100))}%` }}
                  />
                </div>
              </div>
            )}
            <p className="text-xs text-muted-foreground leading-relaxed">
              {dataDays < 14
                ? "Early scan ready — patterns will be limited but real. More data sharpens the analysis each day you log."
                : "Run your first scan to see what correlations have emerged in your score data."
              }
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
          {tier.label && (
            <span className={`text-[10px] font-medium uppercase tracking-wider ${tier.color} opacity-80`}>· {tier.label}</span>
          )}
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

      {/* Progress to next tier */}
      {tier.next && (
        <div className="px-1">
          <div className="flex items-center justify-between mb-0.5">
            <p className="text-[10px] text-muted-foreground/60">{tier.nextLabel} unlocks at {tier.next} days logged</p>
            <span className="text-[10px] text-muted-foreground/60">{dataDays}/{tier.next}</span>
          </div>
          <div className="h-0.5 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary/30 rounded-full transition-all duration-500"
              style={{ width: `${Math.min(100, Math.round((dataDays / tier.next) * 100))}%` }}
            />
          </div>
        </div>
      )}

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
                <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                  <TrendingUp className="h-3.5 w-3.5 text-primary" />
                </div>
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

  function handleDismiss(id: number) {
    haptic("light");
    setDismissed(prev => new Set([...prev, id]));
  }
}
