import { Switch, Route } from "wouter";
import { queryClient, getQueryFn } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Dashboard from "@/pages/dashboard";
import Trends from "@/pages/trends";
import CalendarPage from "@/pages/calendar";
import Welcome from "@/pages/welcome";
import OnboardingFlow from "@/components/OnboardingFlow";
import NotFound from "@/pages/not-found";
import PrivacyPolicy from "@/pages/privacy";
import BirthdayCelebration from "@/components/BirthdayCelebration";
import { registerNativePush, isNativePlatform, clearBadge, setupNotificationTapListener } from "@/hooks/useNativeNotifications";

function AuthenticatedRouter() {
  const { data: user, isLoading } = useQuery<any>({
    queryKey: ["/api/auth/me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

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
    <>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/dashboard" component={Dashboard} />
        <Route path="/calendar" component={CalendarPage} />
        <Route path="/trends" component={Trends} />
        <Route component={NotFound} />
      </Switch>
      <BirthdayCelebration displayName={user?.displayName} dateOfBirth={dateOfBirth} />
    </>
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
