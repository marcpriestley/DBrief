import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plus, Flame, Zap, Trophy, Calendar, Users, ChevronRight,
  Check, X, LogOut, Trash2, Crown, Medal, Lock, Globe,
  Target, Activity, CheckCircle2, Clock,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { ChallengeWithProgress, ChallengeParticipantStats } from "@shared/schema";
import { haptic } from "@/lib/haptics";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";

// ── Helpers ──────────────────────────────────────────────────────────────────

function daysLeft(endDate: string): number {
  const end = new Date(endDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.max(0, Math.ceil((end.getTime() - today.getTime()) / 86400000));
}

function daysTotal(startDate: string, endDate: string): number {
  const start = new Date(startDate);
  const end = new Date(endDate);
  return Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 86400000) + 1);
}

function isActive(ch: ChallengeWithProgress): boolean {
  const today = new Date().toISOString().split("T")[0];
  return ch.startDate <= today && ch.endDate >= today;
}

function isPast(ch: ChallengeWithProgress): boolean {
  const today = new Date().toISOString().split("T")[0];
  return ch.endDate < today;
}

function progressPct(ch: ChallengeWithProgress): number {
  const today = new Date().toISOString().split("T")[0];
  if (today < ch.startDate) return 0;
  if (today >= ch.endDate) return 100;
  const elapsed = Math.ceil((new Date(today).getTime() - new Date(ch.startDate).getTime()) / 86400000) + 1;
  return Math.round((elapsed / daysTotal(ch.startDate, ch.endDate)) * 100);
}

// ── Rank badge ────────────────────────────────────────────────────────────────
function SmallRank({ rank, isMe }: { rank: number; isMe: boolean }) {
  if (rank === 1) return <Crown className="h-3.5 w-3.5 text-amber-400 shrink-0" />;
  if (rank === 2) return <Medal className="h-3.5 w-3.5 text-slate-400 shrink-0" />;
  if (rank === 3) return <Medal className="h-3.5 w-3.5 text-orange-700 shrink-0" />;
  return <span className={`text-xs font-bold tabular-nums ${isMe ? "text-primary" : "text-muted-foreground"}`}>#{rank}</span>;
}

// ── Leaderboard sheet ─────────────────────────────────────────────────────────
function ChallengeLeaderboard({ challengeId, onClose }: { challengeId: number; onClose: () => void }) {
  const { data: board = [], isLoading } = useQuery<ChallengeParticipantStats[]>({
    queryKey: ["/api/challenges", challengeId, "leaderboard"],
    queryFn: () => fetch(`/api/challenges/${challengeId}/leaderboard`, { credentials: "include" }).then(r => r.json()),
    staleTime: 15000,
  });

  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 30 }}
      className="fixed inset-0 z-50 flex items-end"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl mx-auto bg-background rounded-t-3xl border-t border-x border-border/60 shadow-2xl p-6 pb-10 space-y-4 max-h-[70vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-base">Standings</h3>
          <button onClick={onClose} className="p-1 text-muted-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map(i => <div key={i} className="h-12 bg-muted rounded-xl animate-pulse" />)}
          </div>
        ) : board.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">No entries yet</p>
        ) : (
          <div className="space-y-2">
            {board.map((entry, idx) => (
              <motion.div
                key={entry.userId}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: idx * 0.04 }}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${
                  entry.isMe
                    ? "bg-primary/5 border-primary/20"
                    : entry.rank === 1 ? "bg-amber-400/5 border-amber-400/20"
                    : "bg-card border-border/50"
                }`}
              >
                <div className="w-6 flex items-center justify-center shrink-0">
                  <SmallRank rank={entry.rank} isMe={entry.isMe} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className={`text-sm font-semibold truncate ${entry.isMe ? "text-primary" : "text-foreground"}`}>
                      {entry.displayName || entry.username}
                    </p>
                    {entry.isMe && <span className="text-[10px] text-primary/60">you</span>}
                    {entry.loggedToday && (
                      <span className="ml-auto w-2 h-2 rounded-full bg-green-400 shrink-0" title="Logged today" />
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground/60">{entry.daysLogged} day{entry.daysLogged !== 1 ? "s" : ""} logged</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-base font-bold tabular-nums text-foreground">{entry.score}</p>
                  <p className="text-[10px] text-muted-foreground/60">score</p>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ── Log entry sheet ───────────────────────────────────────────────────────────
function LogEntrySheet({
  challenge,
  onClose,
  onLogged,
}: {
  challenge: ChallengeWithProgress;
  onClose: () => void;
  onLogged: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [scoreValue, setScoreValue] = useState(70);

  const logMutation = useMutation({
    mutationFn: (value: number) =>
      apiRequest("POST", `/api/challenges/${challenge.id}/log`, {
        date: new Date().toISOString().split("T")[0],
        value,
      }).then(r => r.json()),
    onSuccess: () => {
      haptic("success");
      queryClient.invalidateQueries({ queryKey: ["/api/challenges"] });
      queryClient.invalidateQueries({ queryKey: ["/api/challenges", challenge.id, "leaderboard"] });
      toast({ title: "Logged!", description: challenge.type === "habit" ? "Nice work — keep the streak going." : `Score ${scoreValue} saved.` });
      onLogged();
      onClose();
    },
    onError: () => toast({ title: "Failed to log", variant: "destructive" }),
  });

  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 30 }}
      className="fixed inset-0 z-50 flex items-end"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl mx-auto bg-background rounded-t-3xl border-t border-x border-border/60 shadow-2xl p-6 pb-10 space-y-5"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-base">Log today's entry</h3>
          <button onClick={onClose} className="p-1 text-muted-foreground"><X className="h-4 w-4" /></button>
        </div>

        {challenge.type === "habit" ? (
          <div className="text-center py-4">
            <div className="text-4xl mb-3">{challenge.habitEmoji ?? "✅"}</div>
            <p className="text-sm text-foreground font-medium mb-1">{challenge.habitName}</p>
            <p className="text-xs text-muted-foreground mb-5">Did you do it today?</p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={() => { haptic("light"); onClose(); }}
                className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl border border-border/50 text-sm text-muted-foreground"
              >
                <X className="h-4 w-4" /> Not yet
              </button>
              <button
                onClick={() => { haptic("medium"); logMutation.mutate(1); }}
                disabled={logMutation.isPending}
                className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-primary text-white text-sm font-medium disabled:opacity-60"
              >
                <CheckCircle2 className="h-4 w-4" /> Done it
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Log your <strong className="text-foreground">{challenge.metricName}</strong> score for today.
            </p>
            <div className="flex items-center gap-4">
              <Slider
                value={[scoreValue]}
                onValueChange={([v]) => setScoreValue(v)}
                min={0} max={100} step={1}
                className="flex-1"
              />
              <span className="w-10 text-center font-bold text-lg tabular-nums text-foreground">{scoreValue}</span>
            </div>
            <button
              onClick={() => { haptic("medium"); logMutation.mutate(scoreValue); }}
              disabled={logMutation.isPending}
              className="w-full py-3 rounded-xl bg-primary text-white font-medium text-sm disabled:opacity-60"
            >
              Save score
            </button>
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ── Challenge card ────────────────────────────────────────────────────────────
function ChallengeCard({ challenge, isMe }: { challenge: ChallengeWithProgress; isMe: boolean }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [showLogSheet, setShowLogSheet] = useState(false);
  const [showActions, setShowActions] = useState(false);

  const active = isActive(challenge);
  const past = isPast(challenge);
  const pct = progressPct(challenge);
  const left = daysLeft(challenge.endDate);
  const loggedToday = challenge.myStats?.loggedToday ?? false;
  const myDays = challenge.myStats?.daysLogged ?? 0;

  const joinMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/challenges/${challenge.id}/join`, {}).then(r => r.json()),
    onSuccess: () => { haptic("success"); queryClient.invalidateQueries({ queryKey: ["/api/challenges"] }); },
  });

  const declineMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/challenges/${challenge.id}/decline`, {}).then(r => r.json()),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/challenges"] }); },
  });

  const leaveMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/challenges/${challenge.id}/leave`, {}).then(r => r.json()),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/challenges"] }); },
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/challenges/${challenge.id}`, {}).then(r => r.json()),
    onSuccess: () => {
      haptic("medium");
      toast({ title: "Challenge deleted" });
      queryClient.invalidateQueries({ queryKey: ["/api/challenges"] });
    },
  });

  const invited = challenge.myStatus === "invited";

  return (
    <>
      <motion.div
        layout
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, x: 20 }}
        className={`bg-card rounded-2xl border shadow-sm overflow-hidden ${
          invited ? "border-primary/30 bg-primary/5" : "border-border/50"
        }`}
      >
        {/* Header */}
        <div className="px-4 pt-4 pb-3">
          <div className="flex items-start gap-3 mb-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0 ${
              challenge.type === "habit" ? "bg-primary/10" : "bg-blue-500/10"
            }`}>
              {challenge.type === "habit"
                ? (challenge.habitEmoji ?? "🎯")
                : <Activity className="h-5 w-5 text-blue-400" />
              }
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <p className="text-sm font-semibold text-foreground leading-tight">{challenge.title}</p>
                {challenge.visibility === "open"
                  ? <Globe className="h-3 w-3 text-muted-foreground/50 shrink-0" />
                  : <Lock className="h-3 w-3 text-muted-foreground/50 shrink-0" />
                }
                {past && <span className="text-[10px] text-muted-foreground/60 bg-muted px-1.5 py-0.5 rounded-full">Ended</span>}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5 leading-snug">
                {challenge.type === "habit" ? challenge.habitName : `Score: ${challenge.metricName}`}
                {" · "}
                by @{challenge.creatorDisplayName ?? challenge.creatorUsername}
              </p>
            </div>
            {isMe && !past && (
              <button onClick={() => setShowActions(v => !v)} className="p-1.5 text-muted-foreground/40 hover:text-muted-foreground shrink-0">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Stats row */}
          <div className="flex items-center gap-4 mb-3">
            <div className="flex items-center gap-1">
              <Users className="h-3 w-3 text-muted-foreground/50" />
              <span className="text-[11px] text-muted-foreground">{challenge.participantCount}</span>
            </div>
            <div className="flex items-center gap-1">
              <Calendar className="h-3 w-3 text-muted-foreground/50" />
              <span className="text-[11px] text-muted-foreground">
                {past ? "Ended" : active ? `${left}d left` : `Starts ${challenge.startDate}`}
              </span>
            </div>
            {challenge.myStats && (
              <div className="flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3 text-primary/60" />
                <span className="text-[11px] text-foreground font-medium">{myDays}d logged</span>
              </div>
            )}
            {loggedToday && (
              <span className="ml-auto text-[10px] font-medium text-green-500 flex items-center gap-0.5">
                <Check className="h-3 w-3" /> Done today
              </span>
            )}
          </div>

          {/* Timeline bar */}
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${past ? "bg-muted-foreground/40" : "bg-primary"}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>

        {/* Invited state */}
        {invited && (
          <div className="border-t border-primary/20 px-4 py-3 flex items-center gap-3 bg-primary/5">
            <p className="text-xs text-foreground/80 flex-1">You've been invited to join</p>
            <button
              onClick={() => { haptic("light"); declineMutation.mutate(); }}
              className="text-xs text-muted-foreground px-2 py-1"
            >Decline</button>
            <button
              onClick={() => { haptic("medium"); joinMutation.mutate(); }}
              className="text-xs font-medium text-white bg-primary px-3 py-1.5 rounded-lg"
            >Join</button>
          </div>
        )}

        {/* Joined + active state */}
        {!invited && !past && active && (
          <div className="border-t border-border/40 px-4 py-2.5 flex gap-2">
            {!loggedToday && (
              <button
                onClick={() => { haptic("light"); setShowLogSheet(true); }}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium ${
                  challenge.type === "habit"
                    ? "bg-primary/10 text-primary"
                    : "bg-blue-500/10 text-blue-400"
                }`}
              >
                {challenge.type === "habit" ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Zap className="h-3.5 w-3.5" />}
                Log today
              </button>
            )}
            <button
              onClick={() => { haptic("select"); setShowLeaderboard(true); }}
              className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-muted text-muted-foreground hover:text-foreground"
            >
              <Trophy className="h-3.5 w-3.5" />
              Standings
            </button>
          </div>
        )}

        {/* Past challenge */}
        {past && (
          <div className="border-t border-border/40 px-4 py-2.5">
            <button
              onClick={() => { haptic("select"); setShowLeaderboard(true); }}
              className="flex items-center gap-1.5 text-xs text-muted-foreground"
            >
              <Trophy className="h-3.5 w-3.5" /> Final standings <ChevronRight className="h-3 w-3" />
            </button>
          </div>
        )}

        {/* Delete confirm */}
        <AnimatePresence>
          {showActions && isMe && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="border-t border-border/50 bg-red-500/5 px-4 py-3 flex items-center justify-between"
            >
              <p className="text-xs text-muted-foreground">Delete this challenge for everyone?</p>
              <div className="flex gap-2">
                <button onClick={() => setShowActions(false)} className="text-xs text-muted-foreground px-2 py-1">Cancel</button>
                <button
                  onClick={() => { setShowActions(false); deleteMutation.mutate(); }}
                  className="text-xs font-medium text-red-500 px-2 py-1"
                >Delete</button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      <AnimatePresence>
        {showLeaderboard && (
          <ChallengeLeaderboard challengeId={challenge.id} onClose={() => setShowLeaderboard(false)} />
        )}
        {showLogSheet && (
          <LogEntrySheet challenge={challenge} onClose={() => setShowLogSheet(false)} onLogged={() => {}} />
        )}
      </AnimatePresence>
    </>
  );
}

// ── Create challenge sheet ─────────────────────────────────────────────────────
function CreateChallengeSheet({
  onClose,
  connections,
}: {
  onClose: () => void;
  connections: { userId: number; username: string; displayName: string | null }[];
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [step, setStep] = useState<"type" | "details" | "settings">("type");
  const [type, setType] = useState<"habit" | "score">("habit");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [habitName, setHabitName] = useState("");
  const [habitEmoji, setHabitEmoji] = useState("🎯");
  const [metricName, setMetricName] = useState("");
  const [durationDays, setDurationDays] = useState(7);
  const [visibility, setVisibility] = useState<"invite_only" | "open">("invite_only");
  const [selectedInvitees, setSelectedInvitees] = useState<number[]>([]);

  const createMutation = useMutation({
    mutationFn: (body: object) => apiRequest("POST", "/api/challenges", body).then(r => r.json()),
    onSuccess: (ch) => {
      // Send individual invites if invite_only
      if (visibility === "invite_only" && selectedInvitees.length > 0) {
        const targets = connections.filter(c => selectedInvitees.includes(c.userId));
        Promise.all(
          targets.map(t =>
            apiRequest("POST", `/api/challenges/${ch.id}/invite`, { username: t.username }).then(r => r.json())
          )
        );
      }
      haptic("success");
      toast({ title: "Challenge created!", description: "Invitations sent to your crew." });
      queryClient.invalidateQueries({ queryKey: ["/api/challenges"] });
      onClose();
    },
    onError: () => toast({ title: "Failed to create challenge", variant: "destructive" }),
  });

  function handleCreate() {
    const today = new Date().toISOString().split("T")[0];
    const end = new Date(Date.now() + durationDays * 86400000).toISOString().split("T")[0];
    createMutation.mutate({
      title: title || (type === "habit" ? habitName : `${metricName} challenge`),
      description: description || null,
      type,
      habitName: type === "habit" ? habitName : null,
      habitEmoji: type === "habit" ? habitEmoji : null,
      metricName: type === "score" ? metricName : null,
      visibility,
      startDate: today,
      endDate: end,
    });
  }

  const canProceedDetails = type === "habit" ? habitName.trim().length > 0 : metricName.trim().length > 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 30 }}
      className="fixed inset-0 z-50 flex items-end"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl mx-auto bg-background rounded-t-3xl border-t border-x border-border/60 shadow-2xl p-6 pb-10 space-y-5 max-h-[85vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {step !== "type" && (
              <button onClick={() => setStep(step === "settings" ? "details" : "type")} className="p-1 text-muted-foreground">
                <ChevronRight className="h-4 w-4 rotate-180" />
              </button>
            )}
            <h3 className="font-bold text-base">New challenge</h3>
          </div>
          <button onClick={onClose} className="p-1 text-muted-foreground"><X className="h-4 w-4" /></button>
        </div>

        {/* Step indicator */}
        <div className="flex gap-1.5">
          {["type", "details", "settings"].map((s, i) => (
            <div key={s} className={`h-1 flex-1 rounded-full transition-all ${
              step === s ? "bg-primary" : i < ["type", "details", "settings"].indexOf(step) ? "bg-primary/40" : "bg-muted"
            }`} />
          ))}
        </div>

        <AnimatePresence mode="wait">
          {/* Step 1: Type */}
          {step === "type" && (
            <motion.div key="type" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-3">
              <p className="text-sm text-muted-foreground">What kind of challenge?</p>
              <button
                onClick={() => { haptic("select"); setType("habit"); setStep("details"); }}
                className={`w-full flex items-center gap-4 p-4 rounded-2xl border text-left transition-all ${
                  type === "habit" ? "border-primary bg-primary/5" : "border-border/50 bg-card"
                }`}
              >
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-xl shrink-0">🎯</div>
                <div>
                  <p className="text-sm font-semibold text-foreground">Habit challenge</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Everyone commits to completing the same habit daily</p>
                </div>
              </button>
              <button
                onClick={() => { haptic("select"); setType("score"); setStep("details"); }}
                className={`w-full flex items-center gap-4 p-4 rounded-2xl border text-left transition-all ${
                  type === "score" ? "border-blue-400 bg-blue-400/5" : "border-border/50 bg-card"
                }`}
              >
                <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center shrink-0">
                  <Activity className="h-5 w-5 text-blue-400" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">Score challenge</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Everyone tracks the same metric — highest average wins</p>
                </div>
              </button>
            </motion.div>
          )}

          {/* Step 2: Details */}
          {step === "details" && (
            <motion.div key="details" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
              {type === "habit" ? (
                <>
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1.5">Habit emoji</label>
                    <div className="flex gap-2 flex-wrap">
                      {["🎯", "💪", "🧘", "📚", "🏃", "💧", "😴", "🥗", "🧠", "🌅"].map(e => (
                        <button
                          key={e}
                          onClick={() => setHabitEmoji(e)}
                          className={`w-10 h-10 rounded-xl text-xl flex items-center justify-center border transition-all ${
                            habitEmoji === e ? "border-primary bg-primary/10 scale-110" : "border-border/50 bg-muted"
                          }`}
                        >{e}</button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1.5">Habit to track together</label>
                    <Input
                      value={habitName}
                      onChange={e => setHabitName(e.target.value)}
                      placeholder="e.g. Morning workout, No phone in bed…"
                      className="bg-card border-border/50"
                    />
                  </div>
                </>
              ) : (
                <div>
                  <label className="text-xs text-muted-foreground block mb-1.5">Metric name</label>
                  <Input
                    value={metricName}
                    onChange={e => setMetricName(e.target.value)}
                    placeholder="e.g. Sleep, Energy, Focus…"
                    className="bg-card border-border/50"
                  />
                  <p className="text-[11px] text-muted-foreground/60 mt-1.5">
                    Everyone logs this metric using the 0–100 scale each day. Highest average wins.
                  </p>
                </div>
              )}

              <div>
                <label className="text-xs text-muted-foreground block mb-1.5">Challenge name (optional)</label>
                <Input
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  placeholder={type === "habit" ? habitName || "Give it a name…" : metricName ? `${metricName} challenge` : "Give it a name…"}
                  className="bg-card border-border/50"
                />
              </div>

              <button
                onClick={() => { if (canProceedDetails) { haptic("light"); setStep("settings"); } }}
                disabled={!canProceedDetails}
                className="w-full py-3 rounded-xl bg-primary text-white font-medium text-sm disabled:opacity-40"
              >
                Next
              </button>
            </motion.div>
          )}

          {/* Step 3: Settings */}
          {step === "settings" && (
            <motion.div key="settings" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-5">
              {/* Duration */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs text-muted-foreground">Duration</label>
                  <span className="text-sm font-bold text-foreground tabular-nums">{durationDays} days</span>
                </div>
                <Slider
                  value={[durationDays]}
                  onValueChange={([v]) => setDurationDays(v)}
                  min={3} max={30} step={1}
                />
                <div className="flex justify-between mt-1">
                  {[3, 7, 14, 21, 30].map(d => (
                    <button
                      key={d}
                      onClick={() => setDurationDays(d)}
                      className={`text-xs px-1.5 py-0.5 rounded-md transition-all ${
                        durationDays === d ? "text-primary font-semibold" : "text-muted-foreground"
                      }`}
                    >{d}d</button>
                  ))}
                </div>
              </div>

              {/* Visibility */}
              <div>
                <label className="text-xs text-muted-foreground block mb-2">Who can join?</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setVisibility("invite_only")}
                    className={`flex items-center gap-2 p-3 rounded-xl border text-left transition-all ${
                      visibility === "invite_only" ? "border-primary bg-primary/5" : "border-border/50 bg-card"
                    }`}
                  >
                    <Lock className={`h-4 w-4 shrink-0 ${visibility === "invite_only" ? "text-primary" : "text-muted-foreground"}`} />
                    <div>
                      <p className="text-xs font-medium text-foreground">Invite only</p>
                      <p className="text-[10px] text-muted-foreground">You choose who joins</p>
                    </div>
                  </button>
                  <button
                    onClick={() => setVisibility("open")}
                    className={`flex items-center gap-2 p-3 rounded-xl border text-left transition-all ${
                      visibility === "open" ? "border-blue-400 bg-blue-400/5" : "border-border/50 bg-card"
                    }`}
                  >
                    <Globe className={`h-4 w-4 shrink-0 ${visibility === "open" ? "text-blue-400" : "text-muted-foreground"}`} />
                    <div>
                      <p className="text-xs font-medium text-foreground">Open to crew</p>
                      <p className="text-[10px] text-muted-foreground">All connections invited</p>
                    </div>
                  </button>
                </div>
              </div>

              {/* Invite specific people */}
              {visibility === "invite_only" && connections.length > 0 && (
                <div>
                  <label className="text-xs text-muted-foreground block mb-2">Invite crew</label>
                  <div className="space-y-1.5">
                    {connections.map(c => {
                      const selected = selectedInvitees.includes(c.userId);
                      const name = c.displayName || c.username;
                      return (
                        <button
                          key={c.userId}
                          onClick={() => {
                            haptic("select");
                            setSelectedInvitees(prev =>
                              prev.includes(c.userId) ? prev.filter(id => id !== c.userId) : [...prev, c.userId]
                            );
                          }}
                          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-all text-left ${
                            selected ? "border-primary bg-primary/5" : "border-border/50 bg-card"
                          }`}
                        >
                          <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                            <span className="text-[10px] font-bold text-primary">{name.slice(0, 2).toUpperCase()}</span>
                          </div>
                          <span className="text-sm text-foreground flex-1">{name}</span>
                          {selected && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {visibility === "invite_only" && connections.length === 0 && (
                <p className="text-xs text-muted-foreground/60 text-center py-2">
                  No crew yet — add connections first, or set visibility to Open.
                </p>
              )}

              <button
                onClick={() => { haptic("medium"); handleCreate(); }}
                disabled={createMutation.isPending}
                className="w-full py-3 rounded-xl bg-primary text-white font-medium text-sm disabled:opacity-50"
              >
                {createMutation.isPending ? "Creating…" : "Launch challenge"}
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────
export default function ChallengesTab({
  acceptedConnections,
}: {
  acceptedConnections: { userId: number; username: string; displayName: string | null }[];
}) {
  const [showCreate, setShowCreate] = useState(false);
  const { data: challenges = [], isLoading } = useQuery<ChallengeWithProgress[]>({
    queryKey: ["/api/challenges"],
    staleTime: 30000,
  });

  const currentUserId = (() => {
    try {
      const me = challenges.find(c => c.myStatus === "joined");
      return me?.creatorId ?? -1;
    } catch { return -1; }
  })();

  const invited = challenges.filter(c => c.myStatus === "invited");
  const active = challenges.filter(c => c.myStatus === "joined" && isActive(c));
  const past = challenges.filter(c => c.myStatus === "joined" && isPast(c));

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Challenges
        </h2>
        <button
          onClick={() => { haptic("light"); setShowCreate(true); }}
          className="flex items-center gap-1 text-xs font-medium text-primary bg-primary/10 hover:bg-primary/20 px-3 py-1.5 rounded-lg transition-colors"
        >
          <Plus className="h-3.5 w-3.5" /> New
        </button>
      </div>

      {/* Invited */}
      {invited.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-2">
            <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
            <p className="text-[11px] text-muted-foreground/70 uppercase tracking-wider font-medium">Invited ({invited.length})</p>
          </div>
          <div className="space-y-3">
            <AnimatePresence mode="popLayout">
              {invited.map(ch => <ChallengeCard key={ch.id} challenge={ch} isMe={false} />)}
            </AnimatePresence>
          </div>
        </section>
      )}

      {/* Active */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2].map(i => <div key={i} className="h-32 bg-card rounded-2xl border border-border/50 animate-pulse" />)}
        </div>
      ) : active.length === 0 && invited.length === 0 ? (
        <div className="bg-card rounded-2xl border border-dashed border-border/60 p-8 text-center">
          <Target className="h-8 w-8 text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-sm font-medium text-foreground mb-1">No active challenges</p>
          <p className="text-xs text-muted-foreground leading-relaxed max-w-xs mx-auto">
            Start a challenge with your crew — habit or score — and compete together.
          </p>
          <button
            onClick={() => { haptic("light"); setShowCreate(true); }}
            className="mt-4 flex items-center gap-1.5 text-sm font-medium text-primary mx-auto"
          >
            <Plus className="h-4 w-4" /> Create first challenge
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <AnimatePresence mode="popLayout">
            {active.map(ch => (
              <ChallengeCard key={ch.id} challenge={ch} isMe={ch.creatorId === challenges.find(c => c.id === ch.id)?.creatorId} />
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* Past */}
      {past.length > 0 && (
        <section>
          <p className="text-[11px] text-muted-foreground/60 uppercase tracking-wider mb-2 font-medium">Completed</p>
          <div className="space-y-3">
            <AnimatePresence mode="popLayout">
              {past.map(ch => <ChallengeCard key={ch.id} challenge={ch} isMe={false} />)}
            </AnimatePresence>
          </div>
        </section>
      )}

      <AnimatePresence>
        {showCreate && (
          <CreateChallengeSheet
            onClose={() => setShowCreate(false)}
            connections={acceptedConnections}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
