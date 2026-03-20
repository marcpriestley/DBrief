import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { useSearch } from "wouter";
import { ChevronLeft } from "lucide-react";
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

function formatDate(dateStr: string) {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function formatDateShort(dateStr: string) {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

type DayView = "today" | "yesterday" | "historical";

function getSmartDefault(journalPreference?: string): DayView {
  const hour = new Date().getHours();
  if (journalPreference === "morning" && hour < 12) return "yesterday";
  return "today";
}

export default function Dashboard() {
  const [dayView, setDayView] = useState<DayView>("today");
  const [historicalDate, setHistoricalDate] = useState<string | null>(null);
  const [defaultApplied, setDefaultApplied] = useState(false);
  const search = useSearch();

  const { data: user } = useQuery<any>({ queryKey: ["/api/auth/me"] });

  const todayStr = getDateStr(0);
  const yesterdayStr = getDateStr(-1);

  const selectedDate =
    dayView === "today" ? todayStr :
    dayView === "yesterday" ? yesterdayStr :
    (historicalDate ?? todayStr);

  // Single initialisation effect — reads `search` BEFORE clearing the URL
  // so there's no race between URL-param handling and the smart default.
  useEffect(() => {
    if (!user || defaultApplied) return;
    setDefaultApplied(true);

    const params = new URLSearchParams(search);
    const dateParam = params.get("date");

    if (dateParam) {
      // Always clear the param from the URL first
      window.history.replaceState({}, "", "/");
      window.scrollTo({ top: 0, behavior: "instant" });

      if (dateParam === todayStr) {
        setDayView("today");
        setHistoricalDate(null);
      } else if (dateParam === yesterdayStr) {
        setDayView("yesterday");
        setHistoricalDate(null);
      } else {
        setHistoricalDate(dateParam);
        setDayView("historical");
      }
    } else {
      setDayView(getSmartDefault(user.journalPreference));
    }
  }, [user, defaultApplied, search, todayStr, yesterdayStr]);

  const switchView = (view: DayView) => {
    if (view !== dayView) {
      haptic("select");
      window.scrollTo({ top: 0, behavior: "instant" });
      setDayView(view);
      if (view !== "historical") setHistoricalDate(null);
    }
  };

  return (
    <AppLayout>
      {/* Sticky day selector */}
      <div className="sticky top-[90px] z-40 -mx-4 px-4 py-2 bg-background border-b border-border/40">

        {/* Historical date banner — shown when viewing any date older than yesterday */}
        {dayView === "historical" && historicalDate && (
          <div className="flex items-center gap-2 mb-2 px-1">
            <button
              onClick={() => switchView(getSmartDefault(user?.journalPreference))}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Back
            </button>
            <span className="text-xs font-semibold text-primary">
              Viewing {formatDate(historicalDate)}
            </span>
          </div>
        )}

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
              {formatDateShort(yesterdayStr)}
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
              {formatDateShort(todayStr)}
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
            key={selectedDate}
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

            <AIInsights />
          </motion.div>
        </AnimatePresence>
      </div>
    </AppLayout>
  );
}
