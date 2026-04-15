import { useLocation, Link } from "wouter";
import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { CalendarDays, TrendingUp, Settings, LogOut, Smile, ChevronLeft, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import StreakDisplay from "@/components/StreakDisplay";
import SettingsModal from "@/components/SettingsModal";
import AppTour from "@/components/AppTour";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { haptic } from "@/lib/haptics";
import { DateProvider, useDateContext } from "@/contexts/DateContext";
import logoSrc from "@assets/9071F600-13EE-4563-BC00-D0D7AB8E3782_1_105_c_1775250530025.jpeg";
import { isNativeHealth, getHealthAuthState, syncHealthData } from "@/lib/healthKit";
import { useMoodOpen } from "@/contexts/MoodContext";

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
  const { openMood } = useMoodOpen();

  const { data: streak } = useQuery<any>({ queryKey: ["/api/streak"] });

  const { data: challenges = [] } = useQuery<any[]>({
    queryKey: ["/api/challenges"],
    queryFn: () =>
      fetch(`/api/challenges?date=${new Date().toLocaleDateString("en-CA")}`, { credentials: "include" }).then(r => r.json()),
    refetchInterval: 120000,
  });
  const hasUnloggedChallenge = challenges.some(
    (c: any) => c.myStats && !c.myStats.loggedToday
  );

  const todayStr = new Date().toLocaleDateString("en-CA");
  const { data: todayMoods = [], isLoading: moodsLoading } = useQuery<any[]>({
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

  // Auto-open mood modal once per period per session if no mood has been logged yet.
  useEffect(() => {
    if (moodsLoading) return;
    if (hasMoodForPeriod) return;
    const hour = new Date().getHours();
    if (hour < 6 || hour >= 23) return;
    const key = `mood_auto_${todayStr}_${currentPeriod}`;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, "1");
    const t = setTimeout(() => openMood(), 5000);
    return () => clearTimeout(t);
  }, [moodsLoading, hasMoodForPeriod, currentPeriod]);

  // Silently keep the server's timezone record up-to-date on every app launch.
  // No sessionStorage guard — we always sync so a timezone change (e.g. travel) is
  // picked up immediately on the next load.
  useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    fetch("/api/user/timezone", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timezone: tz }),
    }).catch(() => {}); // fire-and-forget
  }, []);

  // ── Visual-viewport keyboard tracking ──────────────────────────────────────
  // Sets --visual-height CSS variable to the actual visible window height so that
  // components using calc(var(--visual-height)) shrink when the iOS keyboard appears,
  // even in WKWebView where 100dvh doesn't reflect the keyboard.
  // Also scrolls focused text inputs / textareas into view after the keyboard opens.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const setVh = () => {
      document.documentElement.style.setProperty("--visual-height", `${vv.height}px`);
    };
    setVh();
    vv.addEventListener("resize", setVh);
    vv.addEventListener("scroll", setVh);

    // Scroll focused input/textarea into the visible area after keyboard opens
    const onFocus = (e: FocusEvent) => {
      const el = e.target as HTMLElement;
      if (el.tagName !== "INPUT" && el.tagName !== "TEXTAREA") return;
      // Wait for keyboard animation to settle (~350 ms on iOS)
      setTimeout(() => {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 350);
    };
    document.addEventListener("focus", onFocus, true);

    return () => {
      vv.removeEventListener("resize", setVh);
      vv.removeEventListener("scroll", setVh);
      document.removeEventListener("focus", onFocus, true);
    };
  }, []);

  // Auto-sync Apple Health / Health Connect on launch + every time app comes back to foreground
  useEffect(() => {
    if (!isNativeHealth() || !getHealthAuthState()) return;

    const localDateStr = (d: Date) => d.toLocaleDateString("en-CA");

    async function runSync() {
      const today = localDateStr(new Date());
      const yesterday = localDateStr(new Date(Date.now() - 86400000));
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
    }

    // Run on mount with a short delay so user metrics have time to load
    const t = setTimeout(runSync, 2500);

    // Re-run every time the app comes back to the foreground (e.g. after lock screen)
    const onVisible = () => { if (document.visibilityState === "visible") runSync(); };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearTimeout(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);


  const logoutMutation = useMutation({
    mutationFn: async () => { await apiRequest("POST", "/api/auth/logout"); },
    onSuccess: () => { queryClient.clear(); window.location.href = "/"; },
  });

  const tabs = [
    { href: "/calendar", label: "History", icon: CalendarDays },
    { href: "/trends", label: "Analytics", icon: TrendingUp },
    { href: "/squad", label: "Team", icon: Users },
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
      <header
        className="sticky top-0 z-50 backdrop-blur-xl border-b border-border/60"
        style={{ paddingTop: 'env(safe-area-inset-top)', backgroundColor: 'var(--background)' }}
      >
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
                  onClick={() => { haptic("light"); openMood(); }}
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
                className={`flex items-center gap-1.5 px-3.5 py-2.5 text-[11px] font-black uppercase tracking-wider border-b-2 transition-all ${
                  location === "/" || location === "/dashboard"
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
                }`}
              >
                Dashboard
              </button>
            </Link>
            {tabs.map(({ href, label, icon: Icon }) => {
              const showChallengePulse = href === "/squad" && hasUnloggedChallenge && !isActive(href);
              return (
                <Link key={href} href={href}>
                  <button
                    onClick={() => haptic("select")}
                    className={`relative flex items-center gap-1.5 px-3.5 py-2.5 text-[11px] font-black uppercase tracking-wider border-b-2 transition-all ${
                      isActive(href)
                        ? "border-primary text-foreground"
                        : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
                    }`}
                  >
                    <span className="relative inline-flex">
                      <Icon className={`h-3.5 w-3.5 ${isActive(href) ? "text-primary" : ""}`} />
                      {showChallengePulse && (
                        <span className="absolute -top-1 -right-1 flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-70" />
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
                        </span>
                      )}
                    </span>
                    {label}
                  </button>
                </Link>
              );
            })}
          </div>

          <DateSelector />
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-4 pb-8">
        {children}
      </main>

      <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
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
