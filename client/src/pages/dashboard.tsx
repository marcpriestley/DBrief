import { motion, AnimatePresence } from "framer-motion";
import AppLayout from "@/components/AppLayout";
import ScoreDashboard from "@/components/ScoreDashboard";
import DebriefPanel from "@/components/DebriefPanel";
import AIInsights from "@/components/AIInsights";
import GoalsSection from "@/components/GoalsSection";
import InfiniteGoalBanner from "@/components/InfiniteGoalBanner";
import LongTermGoals from "@/components/LongTermGoals";
import { useDateContext } from "@/contexts/DateContext";

export default function Dashboard() {
  const { selectedDate, dayView } = useDateContext();

  return (
    <AppLayout>
      <div className="space-y-3 pt-1">
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
                <ScoreDashboard selectedDate={selectedDate} />

                <div className="bg-card rounded-xl border border-border/50 shadow-sm p-4">
                  <GoalsSection selectedDate={selectedDate} />
                </div>

                <LongTermGoals />

                <DebriefPanel selectedDate={selectedDate} />

                <AIInsights />
              </>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </AppLayout>
  );
}
