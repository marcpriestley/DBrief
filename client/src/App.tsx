import { Switch, Route } from "wouter";
import { queryClient, getQueryFn, apiRequest } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Dashboard from "@/pages/dashboard";
import Trends from "@/pages/trends";
import CalendarPage from "@/pages/calendar";
import SquadPage from "@/pages/squad";
import Welcome from "@/pages/welcome";
import OnboardingFlow from "@/components/OnboardingFlow";
import NotFound from "@/pages/not-found";
import PrivacyPolicy from "@/pages/privacy";
import BirthdayCelebration from "@/components/BirthdayCelebration";
import MoodCheckinModal from "@/components/MoodCheckinModal";
import GlobalPointsToast from "@/components/GlobalPointsToast";
import CallsignPromptModal from "@/components/CallsignPromptModal";
import { MoodProvider } from "@/contexts/MoodContext";
import { useLocation } from "wouter";
import { registerNativePush, isNativePlatform, clearBadge, setupNotificationTapListener, consumePendingMoodOpen, consumePendingSquadNav } from "@/hooks/useNativeNotifications";
import { useToast } from "@/hooks/use-toast";
import { Capacitor } from "@capacitor/core";

// ── Status-bar: overlay + light-icon style ──────────────────────────────────
// StatusBar is bundled into every Capacitor 8 iOS shell by default (Swift
// package), so we can access it via the bridge even without the npm package.
// setOverlaysWebView(true) → WKWebView extends behind the status bar so our
// dark header fills the area; LIGHT style → white clock/battery icons visible
// on our dark background. Silently no-ops on Android / web.
if (Capacitor.isNativePlatform()) {
  try {
    const StatusBar = (Capacitor as any).Plugins?.StatusBar;
    if (StatusBar) {
      StatusBar.setOverlaysWebView({ overlay: true });
      StatusBar.setStyle({ style: 'LIGHT' }); // LIGHT = white icons on dark bg
    }
  } catch (_) {}
}

function AuthenticatedRouter() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const { data: user, isLoading } = useQuery<any>({
    queryKey: ["/api/auth/me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  // Handle Google OAuth redirect callback — Google returns to the app with
  // #id_token=... in the URL fragment after the user signs in.
  useEffect(() => {
    const hash = window.location.hash;
    if (!hash.includes("id_token=")) return;
    const params = new URLSearchParams(hash.slice(1));
    const idToken = params.get("id_token");
    if (!idToken) return;
    window.history.replaceState({}, "", window.location.pathname);
    apiRequest("POST", "/api/auth/google", { credential: idToken })
      .then(r => r.json())
      .then(data => { queryClient.setQueryData(["/api/auth/me"], data); })
      .catch(console.error);
  }, []);

  // ── Mood modal — lives here so it survives all route changes ──────────────
  // Initialize directly from pending flag (lazy initializer) so the modal
  // opens on the very first render rather than waiting for a useEffect cycle.
  const [isMoodOpen, setIsMoodOpen] = useState(() => {
    // Also clean up the URL param right away if it's present
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get("mood") === "checkin") {
        window.history.replaceState({}, "", window.location.pathname);
        return true;
      }
    } catch {}
    return consumePendingMoodOpen();
  });

  useEffect(() => {
    // Check for ?mood=checkin in URL (web-push tap sets this)
    const checkMoodParam = () => {
      const params = new URLSearchParams(window.location.search);
      if (params.get("mood") === "checkin") {
        setIsMoodOpen(true);
        window.history.replaceState({}, "", window.location.pathname);
      }
    };
    checkMoodParam();

    // consumePendingMoodOpen was already called in the useState initializer;
    // check again here to handle any race where it arrived after first render.

    // Squad deep-link from notification tap (fires before React mounted)
    const pendingSquadTab = consumePendingSquadNav();
    if (pendingSquadTab) setLocation(`/squad?tab=${pendingSquadTab}`);

    const onOpenMood = () => {
      setIsMoodOpen(true);
      // dispatchOpenMood writes /?mood=checkin to history — clean it up now
      try {
        if (window.location.search.includes("mood=checkin")) {
          window.history.replaceState({}, "", window.location.pathname);
        }
      } catch {}
    };
    const onForegroundNotification = (e: any) => {
      const { title, body, type, url } = e.detail ?? {};
      // If it's a mood check-in, open the modal directly
      if (type === "MOOD_CHECKIN" || url?.includes("mood=checkin")) {
        setIsMoodOpen(true);
      } else {
        // Show an in-app toast for all other notifications
        toast({ title: title || "DBrief", description: body });
      }
    };

    const onOpenSquad = (e: Event) => {
      const tab = (e as CustomEvent<{ tab: string }>).detail?.tab ?? "challenges";
      setLocation(`/squad?tab=${tab}`);
    };

    // When the app comes back to the foreground after a notification tap,
    // iOS fires visibilitychange → "visible" before (or instead of) the
    // dbrief:open-mood custom event arriving from the Capacitor bridge.
    // Re-checking here closes the timing gap.
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      // Mood modal pending from a notification tap while app was backgrounded
      if (consumePendingMoodOpen()) { setIsMoodOpen(true); return; }
      checkMoodParam();
      // Squad / challenges deep-link pending from a notification tap
      const pendingSquad = consumePendingSquadNav();
      if (pendingSquad) setLocation(`/squad?tab=${pendingSquad}`);
    };

    window.addEventListener("dbrief:open-mood", onOpenMood);
    window.addEventListener("dbrief:open-squad", onOpenSquad);
    window.addEventListener("dbrief:notification", onForegroundNotification);
    window.addEventListener("popstate", checkMoodParam);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("dbrief:open-mood", onOpenMood);
      window.removeEventListener("dbrief:open-squad", onOpenSquad);
      window.removeEventListener("dbrief:notification", onForegroundNotification);
      window.removeEventListener("popstate", checkMoodParam);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  useEffect(() => {
    if (!user || !isNativePlatform()) return;
    if (user.notificationsEnabled !== false) {
      registerNativePush();
    }
    // Set up the notification tap listener so tapping a push opens the right screen.
    setupNotificationTapListener();
    // Clear the app icon badge immediately on app open, then again on every foreground.
    clearBadge();
    const onVisible = () => { if (document.visibilityState === "visible") clearBadge(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [user]);

  // Dismiss the HTML-level splash screen once auth is resolved
  useEffect(() => {
    if (isLoading) return;
    const splash = document.getElementById("dbrief-splash");
    if (!splash) return;
    splash.classList.add("fade-out");
    const t = setTimeout(() => splash.remove(), 400);
    return () => clearTimeout(t);
  }, [isLoading]);

  // Show callsign prompt for existing users who haven't set one yet.
  // Respects a 7-day snooze stored in localStorage.
  const [callsignDismissed, setCallsignDismissed] = useState(() => {
    try {
      const until = Number(localStorage.getItem("callsign_snoozed_until"));
      return !!(until && Date.now() < until);
    } catch { return false; }
  });
  const showCallsignPrompt = !!user && user.hasCompletedOnboarding && !user.driverHandle && !callsignDismissed;

  if (isLoading) return null;

  if (!user) {
    return <Welcome />;
  }

  if (!user.hasCompletedOnboarding) {
    return <OnboardingFlow username={user.username} />;
  }

  const dateOfBirth = user?.userProfile?.dateOfBirth ?? null;

  return (
    <MoodProvider value={{ openMood: () => setIsMoodOpen(true) }}>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/dashboard" component={Dashboard} />
        <Route path="/calendar" component={CalendarPage} />
        <Route path="/trends" component={Trends} />
        <Route path="/squad" component={SquadPage} />
        <Route component={NotFound} />
      </Switch>
      <BirthdayCelebration displayName={user?.displayName} dateOfBirth={dateOfBirth} />
      <MoodCheckinModal open={isMoodOpen} onClose={() => setIsMoodOpen(false)} />
      <GlobalPointsToast />
      <CallsignPromptModal open={showCallsignPrompt} onClose={() => setCallsignDismissed(true)} />
    </MoodProvider>
  );
}

function App() {
  // Apply dark mode class on startup from localStorage.
  // Default is DARK — only switch to light if the user explicitly saved "light".
  // This must match the inline <script> in index.html that runs before React.
  useEffect(() => {
    const saved = localStorage.getItem("dbrief_theme");
    if (saved === "light") {
      document.documentElement.classList.remove("dark");
    } else {
      document.documentElement.classList.add("dark");
    }
  }, []);

  // Version-check: detect when WKWebView has served a stale cached HTML page and
  // force a hard navigation reload to pick up the latest JS bundle.
  // In development the server returns "dev" — always matches, never reloads.
  useEffect(() => {
    fetch("/api/version", { cache: "no-store" })
      .then(r => r.json())
      .then(({ version }: { version: string }) => {
        const stored = localStorage.getItem("build-version");
        localStorage.setItem("build-version", version);
        // Only reload if we've seen a previous version AND it differs
        if (stored && stored !== "dev" && stored !== version) {
          // Navigate to the same URL — WKWebView treats this as a fresh load
          // and fetches from the network instead of the disk cache.
          window.location.href = window.location.href;
        }
      })
      .catch(() => { /* network unavailable — skip silently */ });
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Switch>
          <Route path="/privacy" component={PrivacyPolicy} />
          <Route component={AuthenticatedRouter} />
        </Switch>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
