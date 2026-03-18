import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import AppLayout from "@/components/AppLayout";
import ScoreDashboard from "@/components/ScoreDashboard";
import DebriefPanel from "@/components/DebriefPanel";
import AIInsights from "@/components/AIInsights";
import GoalsSection from "@/components/GoalsSection";
import InfiniteGoalBanner from "@/components/InfiniteGoalBanner";
import LongTermGoals from "@/components/LongTermGoals";

function getTodayStr() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function getYesterdayStr() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

type DayView = "today" | "yesterday";

export default function Dashboard() {
  const [dayView, setDayView] = useState<DayView>("today");
  const [location] = useLocation();

  const todayStr = getTodayStr();
  const yesterdayStr = getYesterdayStr();
  const selectedDate = dayView === "today" ? todayStr : yesterdayStr;

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const dateParam = params.get("date");
    if (dateParam === yesterdayStr) {
      setDayView("yesterday");
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const yesterdayLabel = new Date(yesterdayStr + "T12:00:00").toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

  return (
    <AppLayout>
      <div className="space-y-4">
        <InfiniteGoalBanner />

        <div className="flex items-center justify-between">
          <div className="inline-flex items-center bg-muted rounded-lg p-0.5">
            <button
              onClick={() => setDayView("yesterday")}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                dayView === "yesterday"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Yesterday
            </button>
            <button
              onClick={() => setDayView("today")}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                dayView === "today"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Today
            </button>
          </div>

          {dayView === "yesterday" && (
            <span className="text-xs text-muted-foreground">{yesterdayLabel}</span>
          )}
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={dayView}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="space-y-4"
          >
            <ScoreDashboard selectedDate={selectedDate} />

            <div className="bg-card rounded-xl border border-border/50 shadow-sm">
              <div className="p-4">
                <GoalsSection selectedDate={selectedDate} />
              </div>
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
