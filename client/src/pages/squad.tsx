import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  Users, Search, UserPlus, Check, X, Flame, Zap, Trophy,
  UserMinus, Clock, Medal, Crown, TrendingUp, BarChart2, Swords,
} from "lucide-react";
import AppLayout from "@/components/AppLayout";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { ConnectionPublicStats, LeaderboardEntry } from "@shared/schema";
import { haptic } from "@/lib/haptics";
import ChallengesTab from "@/components/ChallengesTab";

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

  const primaryStat = sortBy === "streak"
    ? { value: entry.currentStreak, label: "streak", icon: <Flame className="h-3.5 w-3.5 text-orange-400" /> }
    : sortBy === "consistency"
    ? { value: `${entry.sevenDayConsistency}%`, label: "7-day", icon: <TrendingUp className="h-3.5 w-3.5 text-blue-400" /> }
    : { value: entry.todayAvgScore ?? entry.thirtyDayAvgScore ?? "—", label: entry.todayAvgScore !== null ? "today" : "30d avg", icon: <Zap className="h-3.5 w-3.5 text-primary" /> };

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

      {/* Primary stat */}
      <div className="text-right shrink-0">
        <div className="flex items-center gap-1 justify-end">
          {primaryStat.icon}
          <span className="text-base font-bold text-foreground tabular-nums">{primaryStat.value}</span>
        </div>
        <p className="text-[10px] text-muted-foreground/60">{primaryStat.label}</p>
      </div>
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
              <p className="text-xs text-muted-foreground mt-0.5">@{stats.username}</p>
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
              <Zap className="h-3 w-3 text-primary" />
              <span className="text-base font-bold text-foreground tabular-nums">
                {stats.todayAvgScore !== null ? stats.todayAvgScore : "—"}
              </span>
            </div>
            <p className="text-[10px] text-muted-foreground">today</p>
          </div>
          <div className="bg-muted/40 rounded-xl p-2.5 text-center">
            <div className="flex items-center justify-center gap-1 mb-0.5">
              <Trophy className="h-3 w-3 text-amber-400" />
              <span className="text-base font-bold text-foreground tabular-nums">{stats.longestStreak}</span>
            </div>
            <p className="text-[10px] text-muted-foreground">best</p>
          </div>
        </div>

        <div className="mb-2">
          <p className="text-[11px] text-muted-foreground mb-1">7-day consistency</p>
          <ConsistencyBar pct={stats.sevenDayConsistency} />
        </div>

        <div className="flex items-center gap-1.5 mt-2.5">
          <Clock className="h-3 w-3 text-muted-foreground/50" />
          <span className="text-[11px] text-muted-foreground/70">{formatLastSeen(stats.lastLoggedDate)}</span>
          {stats.thirtyDayAvgScore !== null && (
            <span className="text-[11px] text-muted-foreground/50 ml-auto">30d avg {stats.thirtyDayAvgScore}</span>
          )}
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
  { key: "consistency", label: "Consistency",  icon: <TrendingUp className="h-3 w-3" /> },
  { key: "score",       label: "Score",        icon: <BarChart2 className="h-3 w-3" /> },
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

  useEffect(() => {
    if (searchRef.current) clearTimeout(searchRef.current);
    searchRef.current = setTimeout(() => setDebouncedQ(searchQuery.trim()), 350);
    return () => { if (searchRef.current) clearTimeout(searchRef.current); };
  }, [searchQuery]);

  const { data: me } = useQuery<{ id: number; username: string }>({
    queryKey: ["/api/auth/me"],
    staleTime: Infinity,
  });

  const { data: stats = [], isLoading: statsLoading } = useQuery<ConnectionPublicStats[]>({
    queryKey: ["/api/connections/stats"],
    staleTime: 30000,
  });

  const { data: leaderboard = [], isLoading: boardLoading } = useQuery<LeaderboardEntry[]>({
    queryKey: ["/api/squad/leaderboard", sortBy],
    queryFn: () => fetch(`/api/squad/leaderboard?sortBy=${sortBy}`, { credentials: "include" }).then(r => r.json()),
    enabled: activeTab === "board",
    staleTime: 30000,
  });

  const { data: searchResults = [] } = useQuery<{ id: number; username: string; displayName: string | null }[]>({
    queryKey: ["/api/users/search", debouncedQ],
    queryFn: () => debouncedQ.length >= 2
      ? fetch(`/api/users/search?q=${encodeURIComponent(debouncedQ)}`, { credentials: "include" }).then(r => r.json())
      : Promise.resolve([]),
    enabled: debouncedQ.length >= 2,
    staleTime: 15000,
  });

  const requestMutation = useMutation({
    mutationFn: (username: string) => apiRequest("POST", "/api/connections/request", { username }).then(r => r.json()),
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

  const accepted = stats.filter(s => s.status === "accepted");
  const incoming = stats.filter(s => s.status === "pending" && !s.isRequester);
  const outgoing = stats.filter(s => s.status === "pending" && s.isRequester);
  const connectedIds = new Set(stats.map(s => s.userId));

  return (
    <AppLayout>
      <div className="max-w-2xl mx-auto px-4 pb-24 pt-4 space-y-5">

        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold text-foreground">My Team</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Accountability partners</p>
          </div>
        </div>

        {/* Tab bar */}
        <div className="flex gap-1 p-1 bg-muted rounded-xl">
          {[
            { key: "crew" as const, label: "Crew", icon: <Users className="h-3.5 w-3.5" /> },
            { key: "challenges" as const, label: "Challenges", icon: <Swords className="h-3.5 w-3.5" /> },
            { key: "board" as const, label: "Board", icon: <Trophy className="h-3.5 w-3.5" /> },
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => { haptic("select"); setActiveTab(tab.key); }}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === tab.key
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.icon}
              {tab.label}
              {tab.key === "crew" && incoming.length > 0 && (
                <span className="ml-0.5 w-4 h-4 bg-primary rounded-full text-[10px] font-bold text-white flex items-center justify-center">
                  {incoming.length}
                </span>
              )}
            </button>
          ))}
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
                  <Input
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder="Search by username or name…"
                    className="pl-9 bg-card border-border/50"
                  />
                </div>

                <AnimatePresence mode="popLayout">
                  {debouncedQ.length >= 2 && searchResults.length === 0 && (
                    <motion.p key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                      className="text-sm text-muted-foreground text-center py-4"
                    >
                      No users found for "{debouncedQ}"
                    </motion.p>
                  )}
                  {searchResults.map(u => {
                    const alreadyConnected = connectedIds.has(u.id);
                    const pending = outgoing.some(s => s.userId === u.id);
                    const name = u.displayName || u.username;
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
                          <p className="text-xs text-muted-foreground">@{u.username}</p>
                        </div>
                        {alreadyConnected ? (
                          <span className="text-xs text-primary font-medium shrink-0">{pending ? "Sent" : "Connected"}</span>
                        ) : (
                          <button
                            onClick={() => { haptic("medium"); requestMutation.mutate(u.username); }}
                            disabled={requestMutation.isPending}
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

                {/* Outgoing pending */}
                {outgoing.length > 0 && debouncedQ.length < 2 && (
                  <div className="mt-3">
                    <p className="text-[11px] text-muted-foreground/60 uppercase tracking-wider mb-2">Sent requests</p>
                    <div className="space-y-1.5">
                      {outgoing.map(s => (
                        <div key={s.connectionId} className="flex items-center gap-3 px-4 py-2.5 bg-muted/30 rounded-xl">
                          <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center shrink-0">
                            <span className="text-[10px] font-bold text-muted-foreground">
                              {(s.displayName || s.username).slice(0, 2).toUpperCase()}
                            </span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium text-foreground">{s.displayName || s.username}</p>
                            <p className="text-[10px] text-muted-foreground/60">@{s.username}</p>
                          </div>
                          <span className="text-[11px] text-muted-foreground/50">Pending</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </section>

              <p className="text-[11px] text-muted-foreground/40 text-center leading-relaxed px-4 pb-2">
                Connections can see your streak, consistency %, and score average.
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
                  {sortBy === "streak" ? "Ranked by current streak · consistency as tiebreaker" :
                   sortBy === "consistency" ? "Ranked by 7-day logging consistency · streak as tiebreaker" :
                   "Ranked by today's score avg · falls back to 30-day avg if today is empty"}
                </p>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </AppLayout>
  );
}
