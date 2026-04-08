import { useLocation, Link } from "wouter";
import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { CalendarDays, TrendingUp, Settings, LogOut, Smile, ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import StreakDisplay from "@/components/StreakDisplay";
import SettingsModal from "@/components/SettingsModal";
import MoodCheckinModal from "@/components/MoodCheckinModal";
import AppTour from "@/components/AppTour";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { haptic } from "@/lib/haptics";
import { DateProvider, useDateContext } from "@/contexts/DateContext";
import logoSrc from "@assets/9071F600-13EE-4563-BC00-D0D7AB8E3782_1_105_c_1775250530025.jpeg";
import { isNativeIOS, getHealthAuthState, syncHealthData } from "@/lib/healthKit";
import { consumePendingMoodOpen } from "@/hooks/useNativeNotifications";

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
      {tabs.map(({ id, label, date }) => {
        const active = dayView === id;
        return (
          <button
            key={id}
            onClick={() => { haptic("select"); setDayView(id); }}
            className={`flex-1 flex flex-col items-center py-2 rounded-lg transition-all duration-200 ${
              active ? "bg-card shadow-sm" : "hover:bg-background/50"
            }`}
          >
            <span className={`text-[10px] uppercase tracking-widest leading-tight transition-colors font-bold ${
              active ? "text-primary" : "text-muted-foreground font-semibold"
            }`}>
              {label}
            </span>
            <span className={`text-xs mt-0.5 transition-colors ${
              active ? "text-foreground font-extrabold" : "text-muted-foreground font-medium"
            }`}>
              {formatDateShort(date)}
            </span>
            <div className={`h-0.5 rounded-full mt-1 transition-all duration-200 ${
              active ? "w-6 bg-primary" : "w-0 bg-transparent"
            }`} />
          </button>
        );
      })}
    </div>
  );
}

function getCurrentPeriod() {
  const h = new Date().getHours();
  if (h < 12) return "morning";
  if (h < 17) return "afternoon";
  return "evening";
}

function AppLayoutInner({ children }: AppLayoutProps) {
  const [location] = useLocation();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isMoodOpen, setIsMoodOpen] = useState(false);

  const { data: streak } = useQuery<any>({ queryKey: ["/api/streak"] });

  const todayStr = new Date().toISOString().split("T")[0];
  const { data: todayMoods = [] } = useQuery<any[]>({
    queryKey: ["/api/mood-checkins", todayStr],
    queryFn: async () => {
      const r = await fetch(`/api/mood-checkins/${todayStr}`, { credentials: "include" });
      if (!r.ok) return [];
      const data = await r.json();
      return Array.isArray(data) ? data : [];
    },
    refetchInterval: 60000,
  });
  const currentPeriod = getCurrentPeriod();
  const hasMoodForPeriod = todayMoods.some((m: any) => m.label === currentPeriod);
  const showMoodPulse = !hasMoodForPeriod;

  // Auto-sync Apple Health on launch (native iOS, already authorized)
  useEffect(() => {
    if (!isNativeIOS() || !getHealthAuthState()) return;
    // Use local date (en-CA gives YYYY-MM-DD format) so UTC+ users in the
    // evening don't end up with a "tomorrow" UTC date that misses last night's sleep.
    const localDateStr = (d: Date) => d.toLocaleDateString("en-CA");
    const today = localDateStr(new Date());
    const yesterday = localDateStr(new Date(Date.now() - 86400000));
    // Delay slightly so user metrics have time to load
    const t = setTimeout(async () => {
      try {
        const metricsRes = await fetch("/api/user-metrics", { credentials: "include" });
        const metrics: Array<{ name: string; isActive: boolean }> = await metricsRes.json();
        const names = metrics.filter(m => m.isActive).map(m => m.name);
        await Promise.all([
          syncHealthData(today, names),
          syncHealthData(yesterday, names),
        ]);
        queryClient.invalidateQueries({ queryKey: ["/api/daily-scores"] });
        queryClient.invalidateQueries({ queryKey: ["/api/user-metrics"] });
      } catch (e) {
        console.error("[HealthKit] Auto-sync error:", e);
      }
    }, 2500);
    return () => clearTimeout(t);
  }, []);

  // Open mood modal from: (1) URL param set by web-push click, (2) custom event
  // fired by in-app notification tap, or (3) native notification tap that arrived
  // before AppLayout mounted (pendingMoodOpen flag consumed here).
  useEffect(() => {
    // Check URL for ?mood=checkin — works on initial mount AND after in-app navigation.
    const checkMoodParam = () => {
      const params = new URLSearchParams(window.location.search);
      if (params.get("mood") === "checkin") {
        setIsMoodOpen(true);
        window.history.replaceState({}, "", window.location.pathname);
      }
    };

    checkMoodParam();

    // Native notification tap that fired before this component mounted
    if (consumePendingMoodOpen()) {
      setIsMoodOpen(true);
    }

    const onOpenMood = () => setIsMoodOpen(true);
    window.addEventListener("dbrief:open-mood", onOpenMood);

    // Re-check URL when the browser navigates (covers: service-worker navigate()
    // called while the app is already open on the same route — no remount occurs,
    // but a popstate / hashchange is fired).
    window.addEventListener("popstate", checkMoodParam);

    return () => {
      window.removeEventListener("dbrief:open-mood", onOpenMood);
      window.removeEventListener("popstate", checkMoodParam);
    };
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
    <div className="bg-background" style={{ minHeight: '100dvh' }}>
      <div
        className="fixed inset-0 z-0 pointer-events-none"
        style={{
          backgroundImage: 'url(/spa-track-bg.jpg)',
          backgroundSize: 'cover',
          backgroundPosition: 'center top',
          backgroundRepeat: 'no-repeat',
          opacity: 0.15,
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
              <div className="relative">
                {showMoodPulse && (
                  <>
                    {/* Pulsing amber dot — matches AttentionRing style */}
                    <span className="absolute -top-0.5 -right-0.5 z-20 flex h-2.5 w-2.5 pointer-events-none">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-70" />
                      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-primary" />
                    </span>
                    {/* Amber glow ring around button */}
                    <span className="absolute inset-0 rounded-lg ring-1 ring-primary/50 shadow-[0_0_10px_rgba(245,158,11,0.3)] pointer-events-none" />
                  </>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className={`h-8 w-8 transition-colors ${showMoodPulse ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
                  onClick={() => { haptic("light"); setIsMoodOpen(true); }}
                  title={`${currentPeriod.charAt(0).toUpperCase() + currentPeriod.slice(1)} mood check-in`}
                >
                  <Smile className={`h-4 w-4 ${showMoodPulse ? "scale-110" : ""} transition-transform`} />
                </Button>
              </div>
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
      <AppTour />
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
