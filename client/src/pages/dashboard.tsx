import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import AppLayout from "@/components/AppLayout";
import ScoreDashboard from "@/components/ScoreDashboard";
import DebriefPanel from "@/components/DebriefPanel";
import AIInsights from "@/components/AIInsights";
import GoalsSection from "@/components/GoalsSection";
import InfiniteGoalBanner from "@/components/InfiniteGoalBanner";
import LongTermGoals from "@/components/LongTermGoals";
import { haptic } from "@/lib/haptics";

function getDateStr(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDate(dateStr: string, includeWeekday = true) {
  const d = new Date(dateStr + "T12:00:00");
  if (includeWeekday) {
    return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  }
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

type DayView = "today" | "yesterday";

function getSmartDefault(journalPreference?: string): DayView {
  const hour = new Date().getHours();
  if (journalPreference === "morning" && hour < 12) return "yesterday";
  return "today";
}

export default function Dashboard() {
  const [dayView, setDayView] = useState<DayView>("today");
  const [defaultApplied, setDefaultApplied] = useState(false);

  const { data: user } = useQuery<any>({ queryKey: ["/api/auth/me"] });

  const todayStr = getDateStr(0);
  const yesterdayStr = getDateStr(-1);
  const selectedDate = dayView === "today" ? todayStr : yesterdayStr;

  useEffect(() => {
    if (user && !defaultApplied) {
      setDefaultApplied(true);
      const params = new URLSearchParams(window.location.search);
      const dateParam = params.get("date");
      if (dateParam === yesterdayStr) {
        setDayView("yesterday");
        window.history.replaceState({}, "", window.location.pathname);
      } else {
        setDayView(getSmartDefault(user.journalPreference));
      }
    }
  }, [user, defaultApplied, yesterdayStr]);

  const switchView = (view: DayView) => {
    if (view !== dayView) {
      haptic("select");
      setDayView(view);
    }
  };

  const todayLabel = formatDate(todayStr);
  const yesterdayLabel = formatDate(yesterdayStr);

  return (
    <AppLayout>
      {/* Sticky day selector — pinned just below the main header */}
      <div className="sticky top-[82px] z-40 -mx-4 px-4 py-2 bg-background border-b border-border/40">
        <div className="flex w-full bg-muted rounded-xl p-1 gap-1">
          <button
            onClick={() => switchView("yesterday")}
            className={`flex-1 flex flex-col items-center py-2.5 rounded-lg transition-all duration-200 ${
              dayView === "yesterday" ? "bg-card shadow-sm" : "hover:bg-background/50"
            }`}
          >
            <span className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground">
              Yesterday
            </span>
            <span className={`text-sm font-bold mt-0.5 transition-colors ${
              dayView === "yesterday" ? "text-foreground" : "text-muted-foreground"
            }`}>
              {yesterdayLabel}
            </span>
            <div className={`h-0.5 rounded-full mt-1.5 transition-all duration-200 ${
              dayView === "yesterday" ? "w-6 bg-primary" : "w-0 bg-transparent"
            }`} />
          </button>

          <div className="w-px bg-border/60 my-2" />

          <button
            onClick={() => switchView("today")}
            className={`flex-1 flex flex-col items-center py-2.5 rounded-lg transition-all duration-200 ${
              dayView === "today" ? "bg-card shadow-sm" : "hover:bg-background/50"
            }`}
          >
            <span className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground">
              Today
            </span>
            <span className={`text-sm font-bold mt-0.5 transition-colors ${
              dayView === "today" ? "text-foreground" : "text-muted-foreground"
            }`}>
              {todayLabel}
            </span>
            <div className={`h-0.5 rounded-full mt-1.5 transition-all duration-200 ${
              dayView === "today" ? "w-6 bg-primary" : "w-0 bg-transparent"
            }`} />
          </button>
        </div>
      </div>

      <div className="space-y-3 pt-3">
        <InfiniteGoalBanner />

        <AnimatePresence mode="wait">
          <motion.div
            key={dayView}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="space-y-3"
          >
            <ScoreDashboard selectedDate={selectedDate} />

            <div className="bg-card rounded-xl border border-border/50 shadow-sm p-4">
              <GoalsSection selectedDate={selectedDate} />
            </div>

            <LongTermGoals />

            <DebriefPanel selectedDate={selectedDate} />

            {dayView === "today" && <AIInsights />}
          </motion.div>
        </AnimatePresence>
      </div>
    </AppLayout>
  );
}
