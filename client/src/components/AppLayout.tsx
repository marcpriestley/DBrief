import { useLocation, Link } from "wouter";
import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { CalendarDays, TrendingUp, Settings, LogOut, Smile, ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import StreakDisplay from "@/components/StreakDisplay";
import SettingsModal from "@/components/SettingsModal";
import MoodCheckinModal from "@/components/MoodCheckinModal";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { haptic } from "@/lib/haptics";
import { DateProvider, useDateContext } from "@/contexts/DateContext";
import logoSrc from "@assets/Gemini_Generated_Image_urmwx2urmwx2urmw_1773926066552.png";

interface AppLayoutProps {
  children: React.ReactNode;
}

function formatDateShort(dateStr: string) {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function DateSelector() {
  const { dayView, setDayView, todayStr, yesterdayStr, tomorrowStr, historicalDate, goHome } = useDateContext();
  const [location] = useLocation();

  // Only show date selector on dashboard and analytics pages
  const showSelector = location === "/" || location === "/dashboard" || location === "/trends";
  if (!showSelector) return null;

  if (dayView === "historical" && historicalDate) {
    return (
      <div className="flex items-center gap-2 py-1.5">
        <button
          onClick={goHome}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Back
        </button>
        <span className="text-xs font-semibold text-primary">
          {formatDate(historicalDate)}
        </span>
      </div>
    );
  }

  const tabs: { id: "yesterday" | "today" | "tomorrow"; label: string; date: string }[] = [
    { id: "yesterday", label: "Yesterday", date: yesterdayStr },
    { id: "today", label: "Today", date: todayStr },
    { id: "tomorrow", label: "Tomorrow", date: tomorrowStr },
  ];

  return (
    <div className="flex w-full bg-muted rounded-xl p-1 gap-0.5 my-1.5">
      {tabs.map(({ id, label, date }) => (
        <button
          key={id}
          onClick={() => { haptic("select"); setDayView(id); }}
          className={`flex-1 flex flex-col items-center py-2 rounded-lg transition-all duration-200 ${
            dayView === id ? "bg-card shadow-sm" : "hover:bg-background/50"
          }`}
        >
          <span className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground leading-tight">
            {label}
          </span>
          <span className={`text-xs font-bold mt-0.5 transition-colors ${
            dayView === id ? "text-foreground" : "text-muted-foreground"
          }`}>
            {formatDateShort(date)}
          </span>
          <div className={`h-0.5 rounded-full mt-1 transition-all duration-200 ${
            dayView === id ? "w-5 bg-primary" : "w-0 bg-transparent"
          }`} />
        </button>
      ))}
    </div>
  );
}

function AppLayoutInner({ children }: AppLayoutProps) {
  const [location] = useLocation();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isMoodOpen, setIsMoodOpen] = useState(false);

  const { data: streak } = useQuery<any>({ queryKey: ["/api/streak"] });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("mood") === "checkin") {
      setIsMoodOpen(true);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const logoutMutation = useMutation({
    mutationFn: async () => { await apiRequest("POST", "/api/auth/logout"); },
    onSuccess: () => { queryClient.clear(); window.location.href = "/"; },
  });

  const tabs = [
    { href: "/calendar", label: "History", icon: CalendarDays },
    { href: "/trends", label: "Analytics", icon: TrendingUp },
  ];

  const isActive = (href: string) => location === href;

  return (
    <div className="min-h-screen bg-background">
      <div
        className="fixed inset-0 z-0 pointer-events-none"
        style={{
          backgroundImage: 'url(/race-track-bg.png)',
          backgroundSize: 'cover',
          backgroundPosition: 'center top',
          backgroundRepeat: 'no-repeat',
          opacity: 0.045,
        }}
      />
      <header className="sticky top-0 z-50 bg-background/95 backdrop-blur-xl border-b border-border/60" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        <div className="max-w-2xl mx-auto px-4">
          <div className="flex justify-between items-center h-14">
            <Link href="/">
              <button
                onClick={() => haptic("select")}
                className="flex items-center gap-2.5"
              >
                <img
                  src={logoSrc}
                  alt="DBrief"
                  className="w-9 h-9 rounded-xl object-cover shadow-sm"
                />
                <span className="text-lg font-black text-foreground tracking-tight">DBrief</span>
              </button>
            </Link>
            <div className="flex items-center gap-0.5">
              <StreakDisplay streak={streak} />
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                onClick={() => { haptic("light"); setIsMoodOpen(true); }}
                title="Mood check-in"
              >
                <Smile className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                onClick={() => { haptic("light"); setIsSettingsOpen(true); }}
              >
                <Settings className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                onClick={() => { haptic("light"); logoutMutation.mutate(); }}
                title="Sign out"
              >
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="flex gap-0 -mb-px">
            <Link href="/">
              <button
                onClick={() => haptic("select")}
                className={`flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-semibold border-b-2 transition-all ${
                  location === "/" || location === "/dashboard"
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
                }`}
              >
                Dashboard
              </button>
            </Link>
            {tabs.map(({ href, label, icon: Icon }) => (
              <Link key={href} href={href}>
                <button
                  onClick={() => haptic("select")}
                  className={`flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-semibold border-b-2 transition-all ${
                    isActive(href)
                      ? "border-primary text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
                  }`}
                >
                  <Icon className={`h-3.5 w-3.5 ${isActive(href) ? "text-primary" : ""}`} />
                  {label}
                </button>
              </Link>
            ))}
          </div>

          <DateSelector />
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-4 pb-8">
        {children}
      </main>

      <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
      <MoodCheckinModal open={isMoodOpen} onClose={() => setIsMoodOpen(false)} />
    </div>
  );
}

export default function AppLayout({ children }: AppLayoutProps) {
  const { data: user } = useQuery<any>({ queryKey: ["/api/auth/me"] });

  return (
    <DateProvider
      journalPreference={user?.journalPreference}
      goalPreference={user?.goalPreference}
      userReady={!!user}
    >
      <AppLayoutInner>{children}</AppLayoutInner>
    </DateProvider>
  );
}
