import { useLocation, Link } from "wouter";
import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Settings, LogOut, Smile, ChevronLeft, LayoutDashboard, CalendarDays, TrendingUp, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import StreakDisplay from "@/components/StreakDisplay";
import SettingsModal from "@/components/SettingsModal";
import AppTour from "@/components/AppTour";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { haptic } from "@/lib/haptics";
import { DateProvider, useDateContext } from "@/contexts/DateContext";
import logoSrc from "@assets/IMG_1282_1776582526490.jpeg";
import { isNativeHealth, getHealthAuthState, syncHealthData } from "@/lib/healthKit";
import { Capacitor } from "@capacitor/core";
import { useMoodOpen } from "@/contexts/MoodContext";

function applyStatusBar(includeOverlay: boolean) {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const StatusBar = (Capacitor as any).Plugins?.StatusBar;
    if (!StatusBar) return;
    const isLight = document.documentElement.classList.contains('light');
    if (includeOverlay) StatusBar.setOverlaysWebView({ overlay: true });
    StatusBar.setBackgroundColor({ color: isLight ? '#f7f7f7' : '#141414' });
    StatusBar.setStyle({ style: isLight ? 'DARK' : 'LIGHT' });
  } catch (_) {}
}

// Staggered retries — include overlay reset because iOS resets the overlay
// mode after keyboard close (not just the colour), which is what causes the
// white top band to re-appear after typing.  Stagger gives the keyboard
// dismiss animation time to finish before we call setOverlaysWebView so the
// relayout happens after the animation (less visible).
function scheduleStatusBarRetries() {
  [100, 350, 700, 1200].forEach(ms => setTimeout(() => applyStatusBar(true), ms));
}


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
    <div className="flex w-full bg-muted rounded-xl p-1 gap-0.5 my-2">
      {tabs.map(({ id, label, date }) => {
        const active = dayView === id;
        return (
          <button
            key={id}
            onClick={() => { haptic("select"); setDayView(id); }}
            className={`flex-1 flex flex-col items-center py-2.5 rounded-lg transition-all duration-200 ${
              active ? "bg-card shadow-sm" : "hover:bg-background/50"
            }`}
          >
            <span className={`text-[11px] uppercase tracking-widest leading-tight transition-colors font-bold ${
              active ? "text-primary" : "text-muted-foreground font-semibold"
            }`}>
              {label}
            </span>
            <span className={`text-sm mt-0.5 transition-colors ${
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
  const todayCh = new Date().toLocaleDateString("en-CA");
  const hasUnloggedChallenge = challenges.some(
    (c: any) =>
      c.myStatus === "joined" &&
      c.startDate <= todayCh &&
      c.endDate >= todayCh &&
      c.myStats &&
      !c.myStats.loggedToday
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
    const t = setTimeout(() => openMood(), 1000);
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

  // ── Visual-viewport + StatusBar keyboard tracking ──────────────────────────
  // --visual-height tracks the real visible area (keyboard shrinks it in WKWebView).
  // StatusBar strategy — three hook points:
  //   1. Mount — apply immediately so native bar is correct on first render.
  //   2. capacitorKeyboardDidShow / capacitorKeyboardDidHide — Capacitor fires
  //      these after the animation completes; we schedule staggered retries so
  //      any late iOS overlay reset is caught.
  //   3. visibilitychange — catches foreground-return after lock/home-button.
  useEffect(() => {
    // Full init on first mount — only set colour/style, NOT overlay.
    // overlaysWebView is already declared in capacitor.config.ts so the native
    // framework has it correct before any JS runs.  Calling setOverlaysWebView
    // here causes an async WKWebView frame-resize that fires after the splash
    // starts fading, creating a visible layout-shift jitter on launch.
    applyStatusBar(false);

    const vv = window.visualViewport;
    const setVh = () => {
      if (!vv) return;
      document.documentElement.style.setProperty("--visual-height", `${vv.height}px`);
    };
    if (vv) {
      setVh();
      vv.addEventListener("resize", setVh);
      vv.addEventListener("scroll", setVh);
    }

    // Capacitor core dispatches these on window after animations fully complete.
    const onKbDidShow = () => scheduleStatusBarRetries();
    const onKbDidHide = () => scheduleStatusBarRetries();
    window.addEventListener("capacitorKeyboardDidShow", onKbDidShow);
    window.addEventListener("capacitorKeyboardDidHide", onKbDidHide);

    // focus: schedule retries AFTER the keyboard animation (not during).
    const onFocus = (e: FocusEvent) => {
      const el = e.target as HTMLElement;
      if (el.tagName !== "INPUT" && el.tagName !== "TEXTAREA") return;
      scheduleStatusBarRetries();
      setTimeout(() => {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 400);
    };
    document.addEventListener("focus", onFocus, true);

    // blur: keyboard is dismissing — schedule retries after the dismiss animation.
    const onBlur = (e: FocusEvent) => {
      const el = e.target as HTMLElement;
      if (el.tagName !== "INPUT" && el.tagName !== "TEXTAREA") return;
      scheduleStatusBarRetries();
    };
    document.addEventListener("blur", onBlur, true);

    // visibilitychange: app returns from background / lock screen. iOS can reset
    // the status bar style on foreground-return just as it does after a keyboard.
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        scheduleStatusBarRetries();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      if (vv) {
        vv.removeEventListener("resize", setVh);
        vv.removeEventListener("scroll", setVh);
      }
      window.removeEventListener("capacitorKeyboardDidShow", onKbDidShow);
      window.removeEventListener("capacitorKeyboardDidHide", onKbDidHide);
      document.removeEventListener("focus", onFocus, true);
      document.removeEventListener("blur", onBlur, true);
      document.removeEventListener("visibilitychange", onVisibility);
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

  const PAGE_ORDER = ["/", "/calendar", "/trends", "/squad"];

  const allTabs = [
    { href: "/", label: "Home", Icon: LayoutDashboard },
    { href: "/calendar", label: "History", Icon: CalendarDays },
    { href: "/trends", label: "Trends", Icon: TrendingUp },
    { href: "/squad", label: "Team", Icon: Users },
  ];

  const isActive = (href: string) =>
    href === "/" ? (location === "/" || location === "/dashboard") : location === href;

  const touchStart = useRef<{ x: number; y: number; cancelled: boolean } | null>(null);
  const [, navigate] = useLocation();

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, cancelled: false };
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!touchStart.current || touchStart.current.cancelled) return;
    const dy = Math.abs(e.touches[0].clientY - touchStart.current.y);
    const dx = Math.abs(e.touches[0].clientX - touchStart.current.x);
    if (dy > 12 && dy > dx) touchStart.current.cancelled = true;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (!touchStart.current || touchStart.current.cancelled) return;
    const dx = e.changedTouches[0].clientX - touchStart.current.x;
    const dy = e.changedTouches[0].clientY - touchStart.current.y;
    touchStart.current = null;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy)) return;
    const currentPath = location === "/dashboard" ? "/" : location;
    const idx = PAGE_ORDER.indexOf(currentPath);
    if (idx === -1) return;
    if (dx < 0 && idx < PAGE_ORDER.length - 1) {
      haptic("select");
      navigate(PAGE_ORDER[idx + 1]);
    } else if (dx > 0 && idx > 0) {
      haptic("select");
      navigate(PAGE_ORDER[idx - 1]);
    }
  };

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

      {/* ── Status-bar cap (top) ────────────────────────────────────────────── */}
      {/* z-40: sits above page content but below modals/dialogs (z-50) so
           modal buttons near the top of the screen remain tappable.       */}
      <div
        aria-hidden="true"
        className="fixed top-0 left-0 right-0 pointer-events-none"
        style={{ height: 'var(--sai-top, env(safe-area-inset-top, 0px))', backgroundColor: 'var(--background)', zIndex: 40 }}
      />

      {/* ── Top header ─────────────────────────────────────────────────────── */}
      <header
        className="sticky top-0 z-50 border-b border-border/60"
        style={{ paddingTop: 'var(--sai-top, env(safe-area-inset-top, 0px))', backgroundColor: 'var(--background)' }}
      >
        <div className="max-w-2xl mx-auto px-4">
          <div className="flex justify-between items-center h-14">
            <Link href="/">
              <button
                onClick={() => haptic("select")}
                className="flex items-center gap-3"
              >
                <img
                  src={logoSrc}
                  alt="DBrief"
                  className="w-9 h-9 rounded-xl object-cover shadow-sm"
                />
                <span className="text-xl font-black text-foreground tracking-tight">DBrief</span>
              </button>
            </Link>
            <div className="flex items-center gap-1">
              <StreakDisplay streak={streak} />
              <div className="relative">
                {showMoodPulse && (
                  <>
                    <span className="absolute -top-0.5 -right-0.5 z-20 flex h-2.5 w-2.5 pointer-events-none">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-70" />
                      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-primary" />
                    </span>
                    <span className="absolute inset-0 rounded-lg ring-1 ring-primary/50 shadow-[0_0_10px_rgba(245,158,11,0.3)] pointer-events-none" />
                  </>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className={`h-9 w-9 transition-colors ${showMoodPulse ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
                  onClick={() => { haptic("light"); openMood(); }}
                  title={`${currentPeriod.charAt(0).toUpperCase() + currentPeriod.slice(1)} mood check-in`}
                >
                  <Smile className={`h-[18px] w-[18px] ${showMoodPulse ? "scale-110" : ""} transition-transform`} />
                </Button>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 text-muted-foreground hover:text-foreground"
                onClick={() => { haptic("light"); setIsSettingsOpen(true); }}
              >
                <Settings className="h-[18px] w-[18px]" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 text-muted-foreground hover:text-foreground"
                onClick={() => { haptic("light"); logoutMutation.mutate(); }}
                title="Sign out"
              >
                <LogOut className="h-[18px] w-[18px]" />
              </Button>
            </div>
          </div>
          <DateSelector />
        </div>
      </header>

      {/* ── Page content ───────────────────────────────────────────────────── */}
      <main
        className="max-w-2xl mx-auto px-4 pt-4"
        style={{ paddingBottom: 'calc(var(--sai-bottom, env(safe-area-inset-bottom, 0px)) + 72px)' }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {children}
      </main>

      {/* ── Home-indicator fill strip ────────────────────────────────────────
           Standalone element that paints the home-indicator zone with the app
           background, independent of the nav bar's padding calculation.  If
           the nav's paddingBottom somehow fails to render (CSS variable timing,
           WKWebView rendering quirk, etc.) this strip acts as a guaranteed
           backstop.  z-49 puts it behind the nav (z-50) so nav buttons remain
           fully tappable, while still being above page content (z-0..z-40). */}
      <div
        aria-hidden="true"
        className="fixed bottom-0 left-0 right-0 pointer-events-none bg-background"
        style={{ height: 'var(--sai-bottom, env(safe-area-inset-bottom, 0px))', zIndex: 49 }}
      />

      {/* ── Bottom nav bar — fills the home-indicator zone like a native app ── */}
      <nav
        className="fixed bottom-0 left-0 right-0 z-50 border-t border-border/60 bg-background"
        style={{ paddingBottom: 'var(--sai-bottom, env(safe-area-inset-bottom, 0px))' }}
      >
        <div className="flex max-w-2xl mx-auto">
          {allTabs.map(({ href, label, Icon }) => {
            const active = isActive(href);
            const showChallengePulse = href === "/squad" && hasUnloggedChallenge && !active;
            return (
              <Link key={href} href={href} className="flex-1">
                <button
                  onClick={() => haptic("select")}
                  className={`relative w-full flex flex-col items-center justify-center py-2.5 gap-0.5 transition-all ${
                    active ? "text-primary" : "text-muted-foreground"
                  }`}
                >
                  {showChallengePulse && (
                    <span className="absolute top-1.5 right-[20%] flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-70" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
                    </span>
                  )}
                  <Icon className={`h-[22px] w-[22px] transition-transform ${active ? "scale-110" : ""}`} />
                  {active && (
                    <span className="text-[10px] font-bold uppercase tracking-wider leading-none">
                      {label}
                    </span>
                  )}
                </button>
              </Link>
            );
          })}
        </div>
      </nav>

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
