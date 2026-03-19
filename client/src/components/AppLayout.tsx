import { useLocation, Link } from "wouter";
import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { LayoutGrid, CalendarDays, TrendingUp, Settings, LogOut, Smile } from "lucide-react";
import { Button } from "@/components/ui/button";
import StreakDisplay from "@/components/StreakDisplay";
import SettingsModal from "@/components/SettingsModal";
import MoodCheckinModal from "@/components/MoodCheckinModal";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { haptic } from "@/lib/haptics";
import logoSrc from "@assets/Gemini_Generated_Image_urmwx2urmwx2urmw_1773926066552.png";

interface AppLayoutProps {
  children: React.ReactNode;
}

export default function AppLayout({ children }: AppLayoutProps) {
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
    { href: "/", label: "Today", icon: LayoutGrid },
    { href: "/calendar", label: "History", icon: CalendarDays },
    { href: "/trends", label: "Analytics", icon: TrendingUp },
  ];

  const isActive = (href: string) => {
    if (href === "/") return location === "/" || location === "/dashboard";
    return location === href;
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 bg-background/95 backdrop-blur-xl border-b border-border/60">
        <div className="max-w-2xl mx-auto px-4">
          <div className="flex justify-between items-center h-14">
            <div className="flex items-center gap-2.5">
              <img
                src={logoSrc}
                alt="DBrief"
                className="w-9 h-9 rounded-xl object-cover shadow-sm"
              />
              <span className="text-lg font-black text-foreground tracking-tight">DBrief</span>
            </div>
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
