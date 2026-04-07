import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { Flag, ChevronDown, ChevronUp, RefreshCw, Calendar } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { haptic } from "@/lib/haptics";

interface WeeklyReport {
  id: number;
  weekStart: string;
  weekEnd: string;
  content: string;
  createdAt: string;
}

function formatWeekLabel(weekStart: string, weekEnd: string): string {
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  const s = new Date(weekStart + "T12:00:00").toLocaleDateString("en-GB", opts);
  const e = new Date(weekEnd + "T12:00:00").toLocaleDateString("en-GB", opts);
  return `${s} – ${e}`;
}

function isThisWeek(weekStart: string): boolean {
  const now = new Date();
  const day = now.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diff);
  return monday.toISOString().split("T")[0] === weekStart;
}

export default function WeeklyRaceReport() {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);

  const { data: report, isLoading } = useQuery<WeeklyReport | null>({
    queryKey: ["/api/weekly-report/latest"],
    staleTime: 5 * 60 * 1000,
  });

  const generateMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/weekly-report/generate").then(r => r.json()),
    onSuccess: (data) => {
      if (data && !data.skipped) {
        queryClient.setQueryData(["/api/weekly-report/latest"], data);
        setExpanded(true);
      }
    },
  });

  const isCurrentWeek = report ? isThisWeek(report.weekStart) : false;

  // Show generate button if no report OR if it's Sunday and no report for this week
  const today = new Date();
  const isSunday = today.getDay() === 0;
  const showGenerate = !report || (!isCurrentWeek && isSunday);

  if (isLoading) return null;

  if (!report && !isSunday) return null; // Don't show anything mid-week if no report yet

  return (
    <div className="bg-card rounded-xl border border-border/50 shadow-sm overflow-hidden">
      {/* Header */}
      <button
        className="w-full px-5 py-4 flex items-center justify-between text-left"
        onClick={() => {
          haptic("select");
          if (report) setExpanded(e => !e);
        }}
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <Flag className="h-4 w-4 text-primary" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">Weekly Race Report</p>
            {report ? (
              <p className="text-xs text-muted-foreground mt-0.5">
                {formatWeekLabel(report.weekStart, report.weekEnd)}
                {isCurrentWeek && (
                  <span className="ml-2 text-[10px] font-medium uppercase tracking-wider text-primary bg-primary/10 px-1.5 py-0.5 rounded-full">This week</span>
                )}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground mt-0.5">Your engineer's weekly debrief</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {showGenerate && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                haptic("medium");
                generateMutation.mutate();
              }}
              disabled={generateMutation.isPending}
              className="flex items-center gap-1.5 text-xs font-medium text-primary bg-primary/10 hover:bg-primary/20 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`h-3 w-3 ${generateMutation.isPending ? "animate-spin" : ""}`} />
              {generateMutation.isPending ? "Generating…" : "Generate"}
            </button>
          )}
          {report && (
            <div className="text-muted-foreground">
              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </div>
          )}
        </div>
      </button>

      {/* Content */}
      <AnimatePresence>
        {expanded && report && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-5 pt-0 border-t border-border/30">
              {/* Decorative separator */}
              <div className="flex items-center gap-3 py-3 mb-1">
                <div className="flex-1 h-px bg-border/40" />
                <div className="flex gap-1">
                  {[0, 1, 2, 3, 4].map(i => (
                    <div
                      key={i}
                      className="w-1 h-3 rounded-full bg-primary/40"
                      style={{ opacity: 0.3 + i * 0.15 }}
                    />
                  ))}
                </div>
                <div className="flex-1 h-px bg-border/40" />
              </div>
              <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">
                {report.content}
              </p>
              <div className="flex items-center gap-1.5 mt-4">
                <Calendar className="h-3 w-3 text-muted-foreground/60" />
                <p className="text-[11px] text-muted-foreground/60">
                  {formatWeekLabel(report.weekStart, report.weekEnd)}
                </p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* No report yet state */}
      {!report && !generateMutation.isPending && (
        <div className="px-5 pb-4 text-xs text-muted-foreground">
          Your engineer compiles a race report every Sunday evening. Generate one now to review this week's performance.
        </div>
      )}
      {generateMutation.isPending && (
        <div className="px-5 pb-4">
          <div className="flex items-center gap-2">
            <div className="flex gap-0.5">
              {[0, 100, 200].map(d => (
                <span key={d} className="w-1 h-2.5 bg-primary/50 rounded-full animate-bounce" style={{ animationDelay: `${d}ms` }} />
              ))}
            </div>
            <p className="text-xs text-muted-foreground">Reviewing your telemetry…</p>
          </div>
        </div>
      )}
    </div>
  );
}
