import { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import AppLayout from "@/components/AppLayout";
import ScoreDashboard from "@/components/ScoreDashboard";
import DebriefPanel from "@/components/DebriefPanel";
import AIInsights from "@/components/AIInsights";
import WeeklyRaceReport from "@/components/WeeklyRaceReport";
import PerformancePatterns from "@/components/PerformancePatterns";
import GoalsSection from "@/components/GoalsSection";
import InfiniteGoalBanner from "@/components/InfiniteGoalBanner";
import LongTermGoals from "@/components/LongTermGoals";
import HabitsSection from "@/components/HabitsSection";
import PointsBanner from "@/components/PointsBanner";
import { useDateContext } from "@/contexts/DateContext";

function AttentionRing({ active, children }: { active: boolean; children: React.ReactNode }) {
  if (!active) return <>{children}</>;
  return (
    <div className="relative">
      <span className="absolute -top-1.5 -right-1.5 z-20 flex h-3 w-3">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-70" />
        <span className="relative inline-flex rounded-full h-3 w-3 bg-primary" />
      </span>
      <div className="rounded-xl ring-1 ring-primary/50 ring-offset-2 ring-offset-background shadow-[0_0_14px_rgba(245,158,11,0.18)]">
        {children}
      </div>
    </div>
  );
}

function DashboardContent() {
  const { selectedDate, dayView } = useDateContext();
  const isToday = dayView === "today";

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [selectedDate]);

  const { data: debriefs = [] } = useQuery<any[]>({
    queryKey: ["/api/debriefs", selectedDate],
    queryFn: async () => {
      const res = await fetch(`/api/debriefs/${selectedDate}`, { credentials: "include" });
      if (!res.ok) return [];
      const d = await res.json();
      return Array.isArray(d) ? d : (d ? [d] : []);
    },
    staleTime: 5 * 60 * 1000,
  });

  const { data: goals = [] } = useQuery<any[]>({
    queryKey: ["/api/daily-goals", selectedDate],
    queryFn: () => fetch(`/api/daily-goals/${selectedDate}`, { credentials: "include", cache: "no-store" }).then(r => r.json()),
  });

  const { data: habits = [] } = useQuery<any[]>({
    queryKey: ["/api/habits", selectedDate],
    queryFn: () => fetch(`/api/habits?date=${selectedDate}`, { credentials: "include" }).then(r => r.json()),
  });

  const { data: scores = [] } = useQuery<any[]>({
    queryKey: ["/api/daily-scores", selectedDate],
    queryFn: () => fetch(`/api/daily-scores/${selectedDate}`, { credentials: "include" }).then(r => r.json()),
    staleTime: 0,
  });

  const needsDebrief  = isToday && debriefs.length === 0;
  const needsGoals    = isToday && goals.length > 0 && goals.some((g: any) => !g.completed);
  const needsHabits   = isToday && habits.length > 0 && habits.some((h: any) => !h.todayCompleted);
  const needsScores   = isToday && scores.length === 0;

  return (
    <div className="space-y-3 pt-1">
      <InfiniteGoalBanner />
      <PointsBanner />

      <AnimatePresence mode="wait">
        <motion.div
          key={selectedDate}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.15 }}
          className="space-y-3"
        >
          {dayView === "tomorrow" ? (
            <div className="space-y-3">
              <div className="bg-card rounded-xl border border-border/50 shadow-sm p-4">
                <GoalsSection selectedDate={selectedDate} tomorrowMode />
              </div>
              <div className="text-center py-8 text-muted-foreground text-sm">
                <p className="font-medium">Goals set. See you tomorrow.</p>
                <p className="text-xs mt-1 text-muted-foreground/70">Telemetry and debrief unlock on the day.</p>
              </div>
            </div>
          ) : (
            <>
              <AttentionRing active={needsDebrief}>
                <DebriefPanel selectedDate={selectedDate} />
              </AttentionRing>

              <AttentionRing active={needsGoals}>
                <div className="bg-card rounded-xl border border-border/50 shadow-sm p-4">
                  <GoalsSection selectedDate={selectedDate} />
                </div>
              </AttentionRing>

              <AttentionRing active={needsHabits}>
                <HabitsSection />
              </AttentionRing>

              <LongTermGoals />

              <AttentionRing active={needsScores}>
                <ScoreDashboard selectedDate={selectedDate} />
              </AttentionRing>

              <WeeklyRaceReport />
              <PerformancePatterns />
              <AIInsights />
            </>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

export default function Dashboard() {
  return (
    <AppLayout>
      <DashboardContent />
    </AppLayout>
  );
}
