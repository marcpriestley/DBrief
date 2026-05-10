import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  Users, Search, UserPlus, Check, X, Flame, Trophy,
  UserMinus, Clock, Medal, Crown, TrendingUp, Star, Swords, BellRing,
} from "lucide-react";
import AppLayout from "@/components/AppLayout";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, resolveUrl} from "@/lib/queryClient";
import type { ConnectionPublicStats, LeaderboardEntry } from "@shared/schema";
import { haptic } from "@/lib/haptics";
import ChallengesTab from "@/components/ChallengesTab";
import { consumePendingSquadNav } from "@/hooks/useNativeNotifications";

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatLastSeen(dateStr: string | null): string {
  if (!dateStr) return "Not yet logged";
  const today = new Date().toISOString().split("T")[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];
  if (dateStr === today) return "Logged today";
  if (dateStr === yesterday) return "Logged yesterday";
  const days = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
  return `${days}d ago`;
}

function ConsistencyBar({ pct }: { pct: number }) {
  const color = pct >= 80 ? "bg-primary" : pct >= 50 ? "bg-amber-400" : "bg-red-400/70";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all duration-500`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-medium text-muted-foreground tabular-nums w-8 text-right">{pct}%</span>
    </div>
  );
}

// ── Rank badge ────────────────────────────────────────────────────────────────

function RankBadge({ rank, isMe }: { rank: number; isMe: boolean }) {
  if (rank === 1) return (
    <div className="w-8 h-8 rounded-full bg-amber-400/20 flex items-center justify-center shrink-0">
      <Crown className="h-4 w-4 text-amber-400" />
    </div>
  );
  if (rank === 2) return (
    <div className="w-8 h-8 rounded-full bg-slate-400/20 flex items-center justify-center shrink-0">
      <Medal className="h-4 w-4 text-slate-400" />
    </div>
  );
  if (rank === 3) return (
    <div className="w-8 h-8 rounded-full bg-orange-700/20 flex items-center justify-center shrink-0">
      <Medal className="h-4 w-4 text-orange-700" />
    </div>
  );
  return (
    <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${isMe ? "bg-primary/10" : "bg-muted"}`}>
      <span className={`text-xs font-bold tabular-nums ${isMe ? "text-primary" : "text-muted-foreground"}`}>{rank}</span>
    </div>
  );
}

// ── Leaderboard row ───────────────────────────────────────────────────────────

function LeaderboardRow({ entry, sortBy, idx }: { entry: LeaderboardEntry; sortBy: string; idx: number }) {
  const name = entry.displayName || entry.username;
  const initials = name.slice(0, 2).toUpperCase();
  const loggedToday = entry.lastLoggedDate === new Date().toISOString().split("T")[0];
  const daysLogged = Math.min(7, Math.round((entry.sevenDayConsistency / 100) * 7));

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: idx * 0.04 }}
      className={`flex items-center gap-3 px-4 py-3.5 rounded-2xl border ${
        entry.isMe
          ? "bg-primary/5 border-primary/20 shadow-sm"
          : entry.rank === 1
          ? "bg-amber-400/5 border-amber-400/20"
          : "bg-card border-border/50"
      }`}
    >
      {/* Rank */}
      <RankBadge rank={entry.rank} isMe={entry.isMe} />

      {/* Avatar */}
      <div className="relative shrink-0">
        <div className={`w-9 h-9 rounded-full flex items-center justify-center ${entry.isMe ? "bg-primary/15" : "bg-muted"}`}>
          <span className={`text-xs font-bold ${entry.isMe ? "text-primary" : "text-muted-foreground"}`}>{initials}</span>
        </div>
        {loggedToday && (
          <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-400 rounded-full border-2 border-card" />
        )}
      </div>

      {/* Name */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <p className={`text-sm font-semibold truncate ${entry.isMe ? "text-primary" : "text-foreground"}`}>{name}</p>
          {entry.isMe && <span className="text-[10px] text-primary/60 font-medium shrink-0">you</span>}
        </div>
        <p className="text-[11px] text-muted-foreground/60">{formatLastSeen(entry.lastLoggedDate)}</p>
      </div>

      {/* Stats — points sort shows lifetime + weekly; others show primary stat */}
      {sortBy === "streak" && (
        <div className="text-right shrink-0">
          <div className="flex items-center gap-1 justify-end">
            <Flame className="h-3.5 w-3.5 text-orange-400" />
            <span className="text-base font-bold text-foreground tabular-nums">{entry.currentStreak}</span>
          </div>
          <p className="text-[10px] text-muted-foreground/60">streak</p>
        </div>
      )}
      {sortBy === "consistency" && (
        <div className="text-right shrink-0">
          <div className="flex items-center gap-1 justify-end">
            <TrendingUp className="h-3.5 w-3.5 text-blue-400" />
            <span className="text-base font-bold text-foreground tabular-nums">{daysLogged}/7</span>
          </div>
          <p className="text-[10px] text-muted-foreground/60">days logged</p>
        </div>
      )}
      {sortBy === "score" && (
        <div className="text-right shrink-0 space-y-0.5">
          <div className="flex items-center gap-1 justify-end">
            <Star className="h-3.5 w-3.5 text-primary" />
            <span className="text-base font-bold text-primary tabular-nums">{(entry.weeklyPoints ?? 0).toLocaleString()}</span>
          </div>
          <p className="text-[10px] text-muted-foreground/60">this week</p>
          <p className="text-[10px] text-muted-foreground/50 tabular-nums">{entry.points.toLocaleString()} lifetime</p>
        </div>
      )}
    </motion.div>
  );
}

// ── Crew stat card ────────────────────────────────────────────────────────────

function ConnectionCard({ stats, onRemove }: { stats: ConnectionPublicStats; onRemove: () => void }) {
  const [showRemove, setShowRemove] = useState(false);
  const name = stats.displayName || stats.username;
  const initials = name.slice(0, 2).toUpperCase();
  const loggedToday = stats.lastLoggedDate === new Date().toISOString().split("T")[0];

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: 20 }}
      className="bg-card rounded-2xl border border-border/50 shadow-sm overflow-hidden"
    >
      <div className="px-4 py-4">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="w-11 h-11 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
                <span className="text-sm font-bold text-primary">{initials}</span>
              </div>
              {loggedToday && (
                <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-green-400 rounded-full border-2 border-card" title="Logged today" />
              )}
            </div>
            <div>
              <p className="font-semibold text-sm text-foreground leading-tight">{name}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{stats.driverHandle ? `@${stats.driverHandle}` : stats.username.split("@")[0]}</p>
            </div>
          </div>
          <button
            onClick={() => { haptic("light"); setShowRemove(v => !v); }}
            className="p-1.5 text-muted-foreground/40 hover:text-muted-foreground transition-colors"
          >
            <UserMinus className="h-4 w-4" />
          </button>
        </div>

        <div className="grid grid-cols-3 gap-3 mb-3">
          <div className="bg-muted/40 rounded-xl p-2.5 text-center">
            <div className="flex items-center justify-center gap-1 mb-0.5">
              <Flame className="h-3 w-3 text-orange-400" />
              <span className="text-base font-bold text-foreground tabular-nums">{stats.currentStreak}</span>
            </div>
            <p className="text-[10px] text-muted-foreground">streak</p>
          </div>
          <div className="bg-muted/40 rounded-xl p-2.5 text-center">
            <div className="flex items-center justify-center gap-1 mb-0.5">
              <Star className="h-3 w-3 text-primary" />
              <span className="text-base font-bold text-foreground tabular-nums">
                {stats.points.toLocaleString()}
              </span>
            </div>
            <p className="text-[10px] text-muted-foreground">lifetime pts</p>
          </div>
          <div className="bg-muted/40 rounded-xl p-2.5 text-center">
            <div className="flex items-center justify-center gap-1 mb-0.5">
              <Trophy className="h-3 w-3 text-amber-400" />
              <span className="text-base font-bold text-foreground tabular-nums">{stats.longestStreak}</span>
            </div>
            <p className="text-[10px] text-muted-foreground">best streak</p>
          </div>
        </div>

        {(stats.weeklyPoints ?? 0) > 0 && (
          <div className="bg-primary/5 rounded-xl px-3 py-2 mb-3 flex items-center justify-between">
            <p className="text-[11px] text-muted-foreground">Performance pts this week</p>
            <span className="text-xs font-bold text-primary tabular-nums">{(stats.weeklyPoints ?? 0).toLocaleString()} pts</span>
          </div>
        )}

        <div className="mb-2">
          <div className="flex items-center justify-between mb-1">
            <p className="text-[11px] text-muted-foreground">Logged last 7 days</p>
            <p className="text-[11px] font-semibold text-foreground">{Math.round((stats.sevenDayConsistency / 100) * 7)}/7 days</p>
          </div>
          <ConsistencyBar pct={stats.sevenDayConsistency} />
        </div>

        <div className="flex items-center gap-1.5 mt-2.5">
          <Clock className="h-3 w-3 text-muted-foreground/50" />
          <span className="text-[11px] text-muted-foreground/70">{formatLastSeen(stats.lastLoggedDate)}</span>
        </div>
      </div>

      <AnimatePresence>
        {showRemove && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="border-t border-border/50 bg-red-500/5 px-4 py-3 flex items-center justify-between"
          >
            <p className="text-xs text-muted-foreground">Remove {name} from your team?</p>
            <div className="flex gap-2">
              <button onClick={() => setShowRemove(false)} className="text-xs text-muted-foreground px-2 py-1">Cancel</button>
              <button
                onClick={() => { haptic("medium"); setShowRemove(false); onRemove(); }}
                className="text-xs font-medium text-red-500 px-2 py-1"
              >Remove</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ── Pending request row ───────────────────────────────────────────────────────

function PendingCard({ stats, onAccept, onDecline }: { stats: ConnectionPublicStats; onAccept: () => void; onDecline: () => void }) {
  const name = stats.displayName || stats.username;
  const initials = name.slice(0, 2).toUpperCase();
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: 20 }}
      className="flex items-center gap-3 bg-card rounded-xl border border-border/50 px-4 py-3"
    >
      <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
        <span className="text-xs font-bold text-primary">{initials}</span>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate">{name}</p>
        <p className="text-xs text-muted-foreground">@{stats.username} · wants to connect</p>
      </div>
      {stats.isRequester ? (
        <span className="text-xs text-muted-foreground/60 shrink-0">Pending</span>
      ) : (
        <div className="flex gap-1.5 shrink-0">
          <button
            onClick={() => { haptic("light"); onDecline(); }}
            className="w-8 h-8 rounded-full border border-border/50 flex items-center justify-center text-muted-foreground hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => { haptic("medium"); onAccept(); }}
            className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-white"
          >
            <Check className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </motion.div>
  );
}

// ── Sort toggle ───────────────────────────────────────────────────────────────

type SortBy = "streak" | "consistency" | "score";
const SORT_OPTIONS: { key: SortBy; label: string; icon: React.ReactNode }[] = [
  { key: "streak",      label: "Streak",      icon: <Flame className="h-3 w-3" /> },
  { key: "consistency", label: "Log Rate",     icon: <TrendingUp className="h-3 w-3" /> },
  { key: "score",       label: "Perf. Points", icon: <Star className="h-3 w-3" /> },
];

// ── Main Squad page ───────────────────────────────────────────────────────────

export default function SquadPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<"crew" | "challenges" | "board">("crew");
  const [sortBy, setSortBy] = useState<SortBy>("streak");
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const searchRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Always open at the top so sticky tabs are visible immediately.
  // body has overflow:hidden — only #root actually scrolls.
  useEffect(() => {
    const root = document.getElementById("root");
    if (root) root.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  }, []);

  // Deep-link: honour ?tab= URL param (from notification taps) and
  // in-memory / sessionStorage pending nav set by handleNotificationUrl.
  useEffect(() => {
    const validTabs = ["crew", "challenges", "board"] as const;
    type Tab = typeof validTabs[number];
    const isValid = (t: string | null): t is Tab => validTabs.includes(t as Tab);

    // Check URL search param first (present when wouter navigated here via popstate)
    const params = new URLSearchParams(window.location.search);
    const urlTab = params.get("tab");
    // Then fall back to the in-memory / sessionStorage signal
    const pendingTab = consumePendingSquadNav();
    const target = isValid(urlTab) ? urlTab : isValid(pendingTab) ? pendingTab : null;
    if (target) setActiveTab(target);

    // Also listen for the event in case the page is already mounted when the
    // notification arrives (app was open in foreground)
    function onSquadNav(e: Event) {
      const tab = (e as CustomEvent<{ tab: string }>).detail?.tab;
      if (isValid(tab)) setActiveTab(tab);
    }
    window.addEventListener("dbrief:open-squad", onSquadNav);
    return () => window.removeEventListener("dbrief:open-squad", onSquadNav);
  }, []);

  useEffect(() => {
    if (searchRef.current) clearTimeout(searchRef.current);
    searchRef.current = setTimeout(() => setDebouncedQ(searchQuery.trim()), 350);
    return () => { if (searchRef.current) clearTimeout(searchRef.current); };
  }, [searchQuery]);

  const { data: me } = useQuery<{ id: number; username: string }>({
    queryKey: ["/api/auth/me"],
    staleTime: Infinity,
  });

  // Use the cached challenge list (already fetched by AppLayout) to drive the pulse dot.
  const { data: challengeList = [] } = useQuery<any[]>({
    queryKey: ["/api/challenges"],
    staleTime: 30000,
  });
  const hasUnloggedChallenge = challengeList.some(
    (c: any) => c.myStats && !c.myStats.loggedToday && c.myStatus === "joined"
  );

  const { data: stats = [], isLoading: statsLoading } = useQuery<ConnectionPublicStats[]>({
    queryKey: ["/api/connections/stats"],
    staleTime: 0,
    refetchInterval: 20000,
    refetchOnMount: true,
  });

  const { data: leaderboard = [], isLoading: boardLoading } = useQuery<LeaderboardEntry[]>({
    queryKey: ["/api/squad/leaderboard", sortBy],
    queryFn: () => fetch(resolveUrl(`/api/squad/leaderboard?sortBy=${sortBy}`), { credentials: "include" }).then(r => r.json()),
    enabled: activeTab === "board",
    staleTime: 30000,
  });

  const { data: searchResults = [] } = useQuery<{ id: number; driverHandle: string | null; displayName: string | null }[]>({
    queryKey: ["/api/users/search", debouncedQ],
    queryFn: () => debouncedQ.length >= 2
      ? fetch(resolveUrl(`/api/users/search?q=${encodeURIComponent(debouncedQ)}`), { credentials: "include" }).then(r => r.json())
      : Promise.resolve([]),
    enabled: debouncedQ.length >= 2,
    staleTime: 15000,
  });

  const requestMutation = useMutation({
    mutationFn: (handle: string) => apiRequest("POST", "/api/connections/request", { handle }).then(r => r.json()),
    onSuccess: (data) => {
      if (data.message && data.status) {
        toast({ title: data.message });
      } else {
        haptic("success");
        toast({ title: "Request sent", description: "They'll be notified." });
        queryClient.invalidateQueries({ queryKey: ["/api/connections/stats"] });
        setSearchQuery(""); setDebouncedQ("");
      }
    },
    onError: () => toast({ title: "Failed to send request", variant: "destructive" }),
  });

  const acceptMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/connections/${id}/accept`, {}).then(r => r.json()),
    onSuccess: () => {
      haptic("success");
      queryClient.invalidateQueries({ queryKey: ["/api/connections/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/squad/leaderboard"] });
    },
  });

  const declineMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/connections/${id}/decline`, {}).then(r => r.json()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/connections/stats"] }),
  });

  const removeMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/connections/${id}`, {}).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/connections/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/squad/leaderboard"] });
    },
  });

  const nudgeMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/connections/${id}/nudge`, {}).then(r => r.json()),
    onSuccess: () => {
      haptic("medium");
      toast({ title: "Nudge sent", description: "They'll get a reminder notification." });
    },
    onError: (err: any) => {
      // Error message is "STATUS: {json}" — extract the json.message if present
      let msg = "Failed to send nudge";
      try {
        const raw = err?.message || "";
        const jsonStr = raw.includes(":") ? raw.slice(raw.indexOf(":") + 1).trim() : raw;
        const parsed = JSON.parse(jsonStr);
        if (parsed?.message) msg = parsed.message;
      } catch {}
      toast({ title: msg, variant: "destructive" });
    },
  });

  const accepted = stats.filter(s => s.status === "accepted");
  const incoming = stats.filter(s => s.status === "pending" && !s.isRequester);
  const outgoing = stats.filter(s => s.status === "pending" && s.isRequester);
  const connectedIds = new Set(stats.map(s => s.userId));

  return (
    <AppLayout>
      <div className="max-w-2xl mx-auto px-4 pb-24 pt-4 space-y-5">

        {/* Sticky tab bar — always visible at the top */}
        <div className="sticky top-0 z-20 -mx-4 px-4 pb-2 pt-1 bg-background/95 backdrop-blur-sm">
          <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-muted-foreground mb-2">Team</p>
          <div className="flex gap-1 p-1 bg-muted rounded-xl">
          {[
            { key: "crew" as const, label: "Crew", icon: <Users className="h-3.5 w-3.5" /> },
            { key: "challenges" as const, label: "Challenges", icon: <Swords className="h-3.5 w-3.5" /> },
            { key: "board" as const, label: "Board", icon: <Trophy className="h-3.5 w-3.5" /> },
          ].map(tab => {
            const showCrewBadge = tab.key === "crew" && incoming.length > 0;
            const showChallengePulse = tab.key === "challenges" && hasUnloggedChallenge && activeTab !== "challenges";
            return (
              <button
                key={tab.key}
                onClick={() => { haptic("select"); setActiveTab(tab.key); }}
                className={`relative flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-medium transition-all ${
                  activeTab === tab.key
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {showChallengePulse && (
                  <span className="absolute top-1 right-2 flex h-2 w-2 pointer-events-none">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-70" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
                  </span>
                )}
                {tab.icon}
                {tab.label}
                {showCrewBadge && (
                  <span className="ml-0.5 w-4 h-4 bg-primary rounded-full text-[10px] font-bold text-white flex items-center justify-center">
                    {incoming.length}
                  </span>
                )}
              </button>
            );
          })}
          </div>
        </div>

        {/* ── CREW TAB ──────────────────────────────────────────────────────── */}
        <AnimatePresence mode="wait">
          {activeTab === "crew" && (
            <motion.div key="crew" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-5">

              {/* Incoming requests */}
              {incoming.length > 0 && (
                <section>
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                    <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Incoming requests ({incoming.length})
                    </h2>
                  </div>
                  <div className="space-y-2">
                    <AnimatePresence>
                      {incoming.map(s => (
                        <PendingCard
                          key={s.connectionId}
                          stats={s}
                          onAccept={() => acceptMutation.mutate(s.connectionId)}
                          onDecline={() => declineMutation.mutate(s.connectionId)}
                        />
                      ))}
                    </AnimatePresence>
                  </div>
                </section>
              )}

              {/* Outgoing pending */}
              {outgoing.length > 0 && (
                <section>
                  <div className="flex items-center gap-2 mb-3">
                    <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Awaiting response ({outgoing.length})
                    </h2>
                  </div>
                  <div className="space-y-2">
                    <AnimatePresence>
                      {outgoing.map(s => {
                        const name = s.displayName || s.username;
                        const initials = name.slice(0, 2).toUpperCase();
                        const isNudging = nudgeMutation.isPending && nudgeMutation.variables === s.connectionId;
                        return (
                          <motion.div
                            key={s.connectionId}
                            layout
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, x: 20 }}
                            className="flex items-center gap-3 bg-card rounded-xl border border-border/50 px-4 py-3"
                          >
                            <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center shrink-0">
                              <span className="text-xs font-bold text-muted-foreground">{initials}</span>
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-foreground truncate">{name}</p>
                              <p className="text-xs text-muted-foreground">{s.driverHandle ? `@${s.driverHandle}` : s.username} · request sent</p>
                            </div>
                            <button
                              onClick={() => { haptic("light"); nudgeMutation.mutate(s.connectionId); }}
                              disabled={isNudging}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-muted text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors disabled:opacity-40 shrink-0"
                            >
                              <BellRing className="h-3 w-3" />
                              Nudge
                            </button>
                          </motion.div>
                        );
                      })}
                    </AnimatePresence>
                  </div>
                </section>
              )}

              {/* My crew */}
              <section>
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                  {accepted.length > 0 ? `My Crew (${accepted.length})` : "My Crew"}
                </h2>
                {statsLoading ? (
                  <div className="space-y-3">
                    {[1, 2].map(i => <div key={i} className="h-36 bg-card rounded-2xl border border-border/50 animate-pulse" />)}
                  </div>
                ) : accepted.length === 0 ? (
                  <div className="bg-card rounded-2xl border border-dashed border-border/60 p-8 text-center">
                    <Users className="h-8 w-8 text-muted-foreground/40 mx-auto mb-3" />
                    <p className="text-sm font-medium text-foreground mb-1">No crew yet</p>
                    <p className="text-xs text-muted-foreground leading-relaxed max-w-xs mx-auto">
                      Connect with someone you trust. When they can see your streak, you'll show up differently.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <AnimatePresence mode="popLayout">
                      {accepted.map(s => (
                        <ConnectionCard
                          key={s.connectionId}
                          stats={s}
                          onRemove={() => removeMutation.mutate(s.connectionId)}
                        />
                      ))}
                    </AnimatePresence>
                  </div>
                )}
              </section>

              {/* Find people */}
              <section>
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Find people</h2>
                <div className="relative mb-3">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/50" />
                  <span className="absolute left-9 top-1/2 -translate-y-1/2 text-muted-foreground/60 text-sm pointer-events-none">@</span>
                  <Input
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value.replace(/^@/, ""))}
                    placeholder="callsign"
                    className="pl-[3.25rem] bg-card border-border/50"
                  />
                </div>

                <AnimatePresence mode="popLayout">
                  {debouncedQ.length >= 2 && searchResults.length === 0 && (
                    <motion.p key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                      className="text-sm text-muted-foreground text-center py-4"
                    >
                      No drivers found for "@{debouncedQ}"
                    </motion.p>
                  )}
                  {searchResults.map(u => {
                    const alreadyConnected = connectedIds.has(u.id);
                    const pending = outgoing.some(s => s.userId === u.id);
                    const name = u.displayName || u.driverHandle || "Driver";
                    const initials = name.slice(0, 2).toUpperCase();
                    return (
                      <motion.div
                        key={u.id}
                        layout
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        className="flex items-center gap-3 bg-card rounded-xl border border-border/50 px-4 py-3 mb-2"
                      >
                        <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                          <span className="text-xs font-bold text-primary">{initials}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">{name}</p>
                          {u.driverHandle && <p className="text-xs text-muted-foreground">@{u.driverHandle}</p>}
                        </div>
                        {alreadyConnected ? (
                          <span className="text-xs text-primary font-medium shrink-0">{pending ? "Sent" : "Connected"}</span>
                        ) : (
                          <button
                            onClick={() => { if (u.driverHandle) { haptic("medium"); requestMutation.mutate(u.driverHandle); } }}
                            disabled={!u.driverHandle || requestMutation.isPending}
                            className="flex items-center gap-1 text-xs font-medium text-primary bg-primary/10 hover:bg-primary/20 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50 shrink-0"
                          >
                            <UserPlus className="h-3 w-3" />
                            Connect
                          </button>
                        )}
                      </motion.div>
                    );
                  })}
                </AnimatePresence>

              </section>

              <p className="text-[11px] text-muted-foreground/40 text-center leading-relaxed px-4 pb-2">
                Connections can see your streak, consistency %, and points.
                Journal, goal content, and debriefs stay completely private.
              </p>
            </motion.div>
          )}

          {/* ── CHALLENGES TAB ────────────────────────────────────────────────── */}
          {activeTab === "challenges" && (
            <motion.div key="challenges" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <ChallengesTab
                acceptedConnections={accepted.map(s => ({
                  userId: s.userId,
                  username: s.username,
                  displayName: s.displayName,
                }))}
                viewerUserId={me?.id ?? -1}
                orgRole={me?.orgRole ?? null}
              />
            </motion.div>
          )}

          {/* ── LEADERBOARD TAB ───────────────────────────────────────────────── */}
          {activeTab === "board" && (
            <motion.div key="board" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-4">

              {/* Sort controls */}
              <div className="flex gap-2">
                {SORT_OPTIONS.map(opt => (
                  <button
                    key={opt.key}
                    onClick={() => { haptic("select"); setSortBy(opt.key); }}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                      sortBy === opt.key
                        ? "bg-primary text-white shadow-sm"
                        : "bg-muted text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {opt.icon}
                    {opt.label}
                  </button>
                ))}
              </div>

              {/* Board */}
              {boardLoading ? (
                <div className="space-y-2">
                  {[1, 2, 3].map(i => (
                    <div key={i} className="h-16 bg-card rounded-2xl border border-border/50 animate-pulse" />
                  ))}
                </div>
              ) : leaderboard.length <= 1 ? (
                <div className="bg-card rounded-2xl border border-dashed border-border/60 p-8 text-center">
                  <Trophy className="h-8 w-8 text-muted-foreground/40 mx-auto mb-3" />
                  <p className="text-sm font-medium text-foreground mb-1">No competition yet</p>
                  <p className="text-xs text-muted-foreground leading-relaxed max-w-xs mx-auto">
                    Add crew members to see the leaderboard. First to the top wins the week.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <AnimatePresence mode="popLayout">
                    {leaderboard.map((entry, idx) => (
                      <LeaderboardRow key={entry.userId} entry={entry} sortBy={sortBy} idx={idx} />
                    ))}
                  </AnimatePresence>
                </div>
              )}

              {leaderboard.length > 1 && (
                <p className="text-[11px] text-muted-foreground/40 text-center">
                  {sortBy === "streak" ? "Ranked by current streak · log rate as tiebreaker" :
                   sortBy === "consistency" ? "Ranked by days logged in the last 7 · streak as tiebreaker" :
                   "Ranked by this week's Performance Points · lifetime shown below"}
                </p>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </AppLayout>
  );
}
