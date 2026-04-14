import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { Users, Search, UserPlus, Check, X, Flame, Zap, Trophy, ChevronRight, UserMinus, Clock } from "lucide-react";
import AppLayout from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { ConnectionPublicStats, UserConnection } from "@shared/schema";

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
  const color = pct >= 80 ? "bg-primary" : pct >= 50 ? "bg-amber-400" : "bg-red-400";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all duration-500`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-medium text-muted-foreground tabular-nums w-8 text-right">{pct}%</span>
    </div>
  );
}

// ── Stat card for an accepted connection ─────────────────────────────────────

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
        {/* Header row */}
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="w-11 h-11 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
                <span className="text-sm font-bold text-primary">{initials}</span>
              </div>
              {loggedToday && (
                <span
                  className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-green-400 rounded-full border-2 border-card"
                  title="Logged today"
                />
              )}
            </div>
            <div>
              <p className="font-semibold text-sm text-foreground leading-tight">{name}</p>
              <p className="text-xs text-muted-foreground mt-0.5">@{stats.username}</p>
            </div>
          </div>
          <button
            onClick={() => setShowRemove(v => !v)}
            className="p-1.5 text-muted-foreground/40 hover:text-muted-foreground transition-colors"
          >
            <UserMinus className="h-4 w-4" />
          </button>
        </div>

        {/* Stats grid */}
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

        {/* 7-day consistency */}
        <div className="mb-2">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] text-muted-foreground">7-day consistency</span>
          </div>
          <ConsistencyBar pct={stats.sevenDayConsistency} />
        </div>

        {/* Last logged */}
        <div className="flex items-center gap-1.5 mt-2.5">
          <Clock className="h-3 w-3 text-muted-foreground/50" />
          <span className="text-[11px] text-muted-foreground/70">{formatLastSeen(stats.lastLoggedDate)}</span>
          {stats.thirtyDayAvgScore !== null && (
            <span className="text-[11px] text-muted-foreground/50 ml-auto">30d avg {stats.thirtyDayAvgScore}</span>
          )}
        </div>
      </div>

      {/* Remove confirmation */}
      <AnimatePresence>
        {showRemove && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="border-t border-border/50 bg-red-500/5 px-4 py-3 flex items-center justify-between"
          >
            <p className="text-xs text-muted-foreground">Remove {name} from your squad?</p>
            <div className="flex gap-2">
              <button onClick={() => setShowRemove(false)} className="text-xs text-muted-foreground px-2 py-1">Cancel</button>
              <button
                onClick={() => { setShowRemove(false); onRemove(); }}
                className="text-xs font-medium text-red-500 px-2 py-1"
              >
                Remove
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ── Pending request cards ─────────────────────────────────────────────────────

function PendingCard({
  stats, onAccept, onDecline,
}: { stats: ConnectionPublicStats; onAccept: () => void; onDecline: () => void }) {
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
            onClick={onDecline}
            className="w-8 h-8 rounded-full border border-border/50 flex items-center justify-center text-muted-foreground hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={onAccept}
            className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-white"
          >
            <Check className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </motion.div>
  );
}

// ── Main Squad page ───────────────────────────────────────────────────────────

export default function SquadPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const searchRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounce search
  useEffect(() => {
    if (searchRef.current) clearTimeout(searchRef.current);
    searchRef.current = setTimeout(() => setDebouncedQ(searchQuery.trim()), 350);
    return () => { if (searchRef.current) clearTimeout(searchRef.current); };
  }, [searchQuery]);

  const { data: stats = [], isLoading } = useQuery<ConnectionPublicStats[]>({
    queryKey: ["/api/connections/stats"],
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
      if (data.message) {
        toast({ title: data.message });
      } else {
        toast({ title: "Request sent", description: "They'll be notified." });
        queryClient.invalidateQueries({ queryKey: ["/api/connections/stats"] });
        setSearchQuery("");
        setDebouncedQ("");
      }
    },
    onError: () => toast({ title: "Failed to send request", variant: "destructive" }),
  });

  const acceptMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/connections/${id}/accept`, {}).then(r => r.json()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/connections/stats"] }),
  });

  const declineMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/connections/${id}/decline`, {}).then(r => r.json()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/connections/stats"] }),
  });

  const removeMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/connections/${id}`, {}).then(r => r.json()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/connections/stats"] }),
  });

  const accepted = stats.filter(s => s.status === "accepted");
  const incoming = stats.filter(s => s.status === "pending" && !s.isRequester);
  const outgoing = stats.filter(s => s.status === "pending" && s.isRequester);

  // Who's in the search results but already connected?
  const connectedIds = new Set(stats.map(s => s.userId));

  return (
    <AppLayout>
      <div className="max-w-2xl mx-auto px-4 pb-24 pt-4 space-y-6">

        {/* Header */}
        <div>
          <h1 className="text-xl font-bold text-foreground">Squad</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Accountability partners — see who's showing up every day
          </p>
        </div>

        {/* Incoming requests */}
        <AnimatePresence>
          {incoming.length > 0 && (
            <motion.section
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
            >
              <div className="flex items-center gap-2 mb-3">
                <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Incoming requests ({incoming.length})
                </h2>
              </div>
              <div className="space-y-2">
                {incoming.map(s => (
                  <PendingCard
                    key={s.connectionId}
                    stats={s}
                    onAccept={() => acceptMutation.mutate(s.connectionId)}
                    onDecline={() => declineMutation.mutate(s.connectionId)}
                  />
                ))}
              </div>
            </motion.section>
          )}
        </AnimatePresence>

        {/* My crew */}
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            {accepted.length > 0 ? `My Crew (${accepted.length})` : "My Crew"}
          </h2>

          {isLoading ? (
            <div className="space-y-3">
              {[1, 2].map(i => (
                <div key={i} className="h-36 bg-card rounded-2xl border border-border/50 animate-pulse" />
              ))}
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
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            Find people
          </h2>
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
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
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
                    <span className="text-xs text-primary font-medium shrink-0">
                      {pending ? "Sent" : "Connected"}
                    </span>
                  ) : (
                    <button
                      onClick={() => requestMutation.mutate(u.username)}
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
            <div className="mt-4">
              <p className="text-[11px] text-muted-foreground/60 uppercase tracking-wider mb-2">Sent requests</p>
              <div className="space-y-2">
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

        {/* Privacy note */}
        <p className="text-[11px] text-muted-foreground/40 text-center leading-relaxed px-4">
          Connections can see your streak, consistency %, and daily score average.
          Journal entries, goal content, and debrief notes stay completely private.
        </p>
      </div>
    </AppLayout>
  );
}
