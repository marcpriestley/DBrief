import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import ScoreDashboard from "@/components/ScoreDashboard";
import CalendarView from "@/components/CalendarView";
import DebriefPanel from "@/components/DebriefPanel";
import AIInsights from "@/components/AIInsights";
import SettingsModal from "@/components/SettingsModal";
import StreakDisplay from "@/components/StreakDisplay";
import GoalsSection from "@/components/GoalsSection";
import MoodCheckinModal from "@/components/MoodCheckinModal";
import { Button } from "@/components/ui/button";
import { Settings, TrendingUp, LogOut, Smile, CalendarCheck } from "lucide-react";
import { Link } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

function getTodayStr() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export default function Dashboard() {
  const [selectedDate, setSelectedDate] = useState<string>(getTodayStr);
  const todayStr = getTodayStr();
  const isViewingToday = selectedDate === todayStr;
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isMoodCheckinOpen, setIsMoodCheckinOpen] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("mood") === "checkin") {
      setIsMoodCheckinOpen(true);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const { data: streak } = useQuery<any>({
    queryKey: ["/api/streak"],
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/auth/logout");
    },
    onSuccess: () => {
      queryClient.clear();
      window.location.href = "/";
    },
  });

  const dateLabel = isViewingToday
    ? "Today"
    : new Date(selectedDate + "T12:00:00").toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-lg border-b border-border/40">
        <div className="max-w-2xl mx-auto px-4">
          <div className="flex justify-between items-center h-14">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 bg-primary rounded-lg flex items-center justify-center">
                <span className="text-primary-foreground text-xs font-bold">D</span>
              </div>
              <h1 className="text-lg font-semibold text-foreground tracking-tight">DBrief</h1>
            </div>

            <div className="flex items-center gap-1">
              <StreakDisplay streak={streak} />

              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9"
                onClick={() => setIsMoodCheckinOpen(true)}
                title="Mood Check-in"
              >
                <Smile className="h-4 w-4" />
              </Button>

              <Link href="/trends">
                <Button variant="ghost" size="icon" className="h-9 w-9">
                  <TrendingUp className="h-4 w-4" />
                </Button>
              </Link>

              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9"
                onClick={() => setIsSettingsModalOpen(true)}
              >
                <Settings className="h-4 w-4" />
              </Button>

              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9"
                onClick={() => logoutMutation.mutate()}
                title="Sign out"
              >
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-5 space-y-5">
        {!isViewingToday && (
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-muted-foreground">{dateLabel}</h2>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSelectedDate(todayStr)}
              className="h-8 text-xs"
            >
              <CalendarCheck className="h-3.5 w-3.5 mr-1.5" />
              Back to Today
            </Button>
          </div>
        )}

        <section>
          <ScoreDashboard selectedDate={selectedDate} />
        </section>

        <section className="bg-card rounded-xl p-4 shadow-sm border border-border/50">
          <GoalsSection selectedDate={selectedDate} />
        </section>

        <section>
          <DebriefPanel selectedDate={selectedDate} />
        </section>

        <section>
          <CalendarView
            selectedDate={selectedDate}
            onDateSelect={setSelectedDate}
          />
        </section>

        <AIInsights />
      </main>

      <SettingsModal
        isOpen={isSettingsModalOpen}
        onClose={() => setIsSettingsModalOpen(false)}
      />

      <MoodCheckinModal
        open={isMoodCheckinOpen}
        onClose={() => setIsMoodCheckinOpen(false)}
      />
    </div>
  );
}
