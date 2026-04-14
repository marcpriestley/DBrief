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
import { MoodProvider } from "@/contexts/MoodContext";
import { useLocation } from "wouter";
import { registerNativePush, isNativePlatform, clearBadge, setupNotificationTapListener, consumePendingMoodOpen, consumePendingSquadNav } from "@/hooks/useNativeNotifications";
import { useToast } from "@/hooks/use-toast";

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
  const [isMoodOpen, setIsMoodOpen] = useState(false);

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

    // Native notification tap that fired before this component mounted
    if (consumePendingMoodOpen()) setIsMoodOpen(true);

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

    window.addEventListener("dbrief:open-mood", onOpenMood);
    window.addEventListener("dbrief:open-squad", onOpenSquad);
    window.addEventListener("dbrief:notification", onForegroundNotification);
    window.addEventListener("popstate", checkMoodParam);
    return () => {
      window.removeEventListener("dbrief:open-mood", onOpenMood);
      window.removeEventListener("dbrief:open-squad", onOpenSquad);
      window.removeEventListener("dbrief:notification", onForegroundNotification);
      window.removeEventListener("popstate", checkMoodParam);
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

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 bg-primary rounded-xl flex items-center justify-center mx-auto mb-3 animate-pulse">
            <span className="text-white text-lg font-bold">D</span>
          </div>
          <p className="text-gray-500 text-sm">Loading...</p>
        </div>
      </div>
    );
  }

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
