import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plus, Flame, Zap, Trophy, Calendar, Users, ChevronRight,
  Check, X, Trash2, Crown, Medal, Lock, Globe,
  Target, Activity, CheckCircle2, Clock, EyeOff, Eye, Pencil, Bell,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { ChallengeWithProgress, ChallengeLeaderboard, ChallengeParticipantStats } from "@shared/schema";
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

// Always use the local calendar date so timezone shifts don't cause off-by-one day errors
function localToday(): string { return new Date().toLocaleDateString("en-CA"); }

function isActive(ch: ChallengeWithProgress): boolean {
  const today = localToday();
  return ch.startDate <= today && ch.endDate >= today;
}

function isPast(ch: ChallengeWithProgress): boolean {
  return ch.endDate < localToday();
}

function progressPct(ch: ChallengeWithProgress): number {
  const today = localToday();
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
function ChallengeLeaderboardSheet({
  challengeId,
  challengeType,
  onClose,
}: {
  challengeId: number;
  challengeType: string;
  onClose: () => void;
}) {
  const { data, isLoading } = useQuery<ChallengeLeaderboard>({
    queryKey: ["/api/challenges", challengeId, "leaderboard"],
    queryFn: () =>
      fetch(`/api/challenges/${challengeId}/leaderboard`, { credentials: "include" }).then(r => r.json()),
    staleTime: 15000,
    refetchInterval: 15000,
  });

  const board = data?.entries ?? [];
  const scoresHidden = data?.scoresHidden ?? false;
  const submittedToday = data?.submittedToday ?? 0;
  const totalParticipants = data?.totalParticipants ?? 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 30 }}
      className="fixed inset-0 z-50 flex items-end"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl mx-auto bg-background rounded-t-3xl border-t border-x border-border/60 shadow-2xl p-6 pb-10 space-y-4 max-h-[75vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-base">Standings</h3>
          <button onClick={onClose} className="p-1 text-muted-foreground"><X className="h-4 w-4" /></button>
        </div>

        {/* Blind state banner for score challenges */}
        {scoresHidden && (
          <div className="flex items-start gap-3 bg-muted/50 rounded-xl px-4 py-3">
            <EyeOff className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-medium text-foreground">Scores hidden until everyone submits</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {submittedToday} of {totalParticipants} submitted today — scores reveal when the last person logs.
              </p>
            </div>
          </div>
        )}

        {/* Submission progress for score challenges */}
        {challengeType === "score" && !scoresHidden && submittedToday === totalParticipants && totalParticipants > 0 && (
          <div className="flex items-center gap-2 text-[11px] text-green-500">
            <Eye className="h-3.5 w-3.5" />
            All {totalParticipants} members submitted — final scores revealed.
          </div>
        )}

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
                    : entry.rank === 1 && !scoresHidden ? "bg-amber-400/5 border-amber-400/20"
                    : "bg-card border-border/50"
                }`}
              >
                <div className="w-6 flex items-center justify-center shrink-0">
                  {scoresHidden
                    ? <EyeOff className="h-3 w-3 text-muted-foreground/40" />
                    : <SmallRank rank={entry.rank} isMe={entry.isMe} />
                  }
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <p className={`text-sm font-semibold truncate ${entry.isMe ? "text-primary" : "text-foreground"}`}>
                      {entry.displayName || entry.username}
                    </p>
                    {entry.isMe && <span className="text-[10px] text-primary/60">you</span>}
                    {entry.loggedToday && (
                      <span className="ml-auto w-2 h-2 rounded-full bg-green-400 shrink-0" title="Submitted today" />
                    )}
                  </div>
                  {entry.commitment && (
                    <p className="text-[11px] text-muted-foreground/70 italic truncate">"{entry.commitment}"</p>
                  )}
                  <p className="text-[11px] text-muted-foreground/50">{entry.daysLogged} day{entry.daysLogged !== 1 ? "s" : ""} logged</p>
                </div>
                <div className="text-right shrink-0">
                  {scoresHidden ? (
                    <span className="text-xs text-muted-foreground/40">
                      {entry.loggedToday ? "✓ done" : "waiting…"}
                    </span>
                  ) : (
                    <>
                      <p className="text-base font-bold tabular-nums text-foreground">{entry.score ?? "—"}</p>
                      <p className="text-[10px] text-muted-foreground/60">score</p>
                    </>
                  )}
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ── Join with commitment sheet ─────────────────────────────────────────────────
function JoinWithCommitmentSheet({
  challenge,
  onClose,
  onJoined,
}: {
  challenge: ChallengeWithProgress;
  onClose: () => void;
  onJoined: () => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [commitment, setCommitment] = useState("");
  const [reminderEnabled, setReminderEnabled] = useState(false);
  const [reminderTime, setReminderTime] = useState("21:00");

  const joinMutation = useMutation({
    mutationFn: (body: object) =>
      apiRequest("POST", `/api/challenges/${challenge.id}/join`, body).then(r => r.json()),
    onSuccess: (data: any) => {
      haptic("success");
      queryClient.invalidateQueries({ queryKey: ["/api/challenges"] });
      queryClient.invalidateQueries({ queryKey: ["/api/user-metrics"] });
      toast({ title: "You're in!", description: challenge.type === "habit" ? "Your commitment is set." : "Welcome to the challenge." });
      if (data?.metricInstalled && data?.metricName) {
        setTimeout(() => {
          toast({
            title: `"${data.metricName}" added to your daily scores`,
            description: "Head to the dashboard to log your score for this challenge.",
          });
        }, 800);
      }
      onJoined();
      onClose();
    },
    onError: (err: any) => toast({ title: "Failed to join", description: err?.message || undefined, variant: "destructive" }),
  });

  const isHabit = challenge.type === "habit";

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
          <h3 className="font-bold text-base">Join challenge</h3>
          <button onClick={onClose} className="p-1 text-muted-foreground"><X className="h-4 w-4" /></button>
        </div>

        <div className="flex items-center gap-3 bg-muted/40 rounded-xl px-4 py-3">
          <div className="text-2xl">{challenge.type === "habit" ? (challenge.habitEmoji ?? "🎯") : "📊"}</div>
          <div>
            <p className="text-sm font-semibold text-foreground">{challenge.title}</p>
            <p className="text-xs text-muted-foreground">
              {isHabit ? challenge.habitName : `Score: ${challenge.metricName}`}
            </p>
          </div>
        </div>

        {isHabit && (
          <div>
            <label className="text-xs font-medium text-foreground block mb-1">
              What's your personal commitment? <span className="text-muted-foreground font-normal">(optional)</span>
            </label>
            <Input
              value={commitment}
              onChange={e => setCommitment(e.target.value)}
              placeholder={`e.g. ${challenge.habitName ? `20 ${challenge.habitName.toLowerCase()}` : "10 reps, 20 mins…"}`}
              className="bg-card border-border/50"
              maxLength={80}
            />
            <p className="text-[11px] text-muted-foreground/60 mt-1.5">
              Set your own target. You tick done when you hit it — the group sees what you committed to.
            </p>
          </div>
        )}

        {!isHabit && (
          <p className="text-xs text-muted-foreground leading-relaxed">
            Log your <strong className="text-foreground">{challenge.metricName}</strong> score each day. 
            Scores are hidden until everyone has submitted for that day — no one can chase a known target.
          </p>
        )}

        {/* Reminder toggle */}
        <div className="flex items-center justify-between px-1">
          <div>
            <p className="text-xs font-medium text-foreground">Daily reminder</p>
            <p className="text-[11px] text-muted-foreground">Get nudged when you haven't logged yet</p>
          </div>
          <button
            onClick={() => { haptic("select"); setReminderEnabled(e => !e); }}
            className={`w-10 h-5.5 rounded-full transition-colors relative ${reminderEnabled ? "bg-primary" : "bg-muted"}`}
            style={{ width: 40, height: 22 }}
          >
            <span
              className="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform"
              style={{ transform: reminderEnabled ? "translateX(18px)" : "translateX(0)" }}
            />
          </button>
        </div>
        {reminderEnabled && (
          <div className="flex items-center gap-3 px-1">
            <p className="text-xs text-muted-foreground flex-1">Remind me at</p>
            <input
              type="time"
              value={reminderTime}
              onChange={e => setReminderTime(e.target.value)}
              className="text-sm font-semibold bg-card border border-border/50 rounded-lg px-2 py-1 text-foreground"
            />
          </div>
        )}

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-3 rounded-xl border border-border/50 text-sm text-muted-foreground"
          >Decline</button>
          <button
            onClick={() => {
              haptic("medium");
              joinMutation.mutate({
                commitment: commitment.trim() || undefined,
                reminderTime: reminderEnabled ? reminderTime : undefined,
              });
            }}
            disabled={joinMutation.isPending}
            className="flex-1 py-3 rounded-xl bg-primary text-white font-medium text-sm disabled:opacity-60"
          >
            {joinMutation.isPending ? "Joining…" : "Join challenge"}
          </button>
        </div>
      </div>
    </motion.div>
  );
}

// ── Log entry sheet ───────────────────────────────────────────────────────────
function LogEntrySheet({
  challenge,
  onClose,
}: {
  challenge: ChallengeWithProgress;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [scoreValue, setScoreValue] = useState(70);

  const logMutation = useMutation({
    mutationFn: (value: number) =>
      apiRequest("POST", `/api/challenges/${challenge.id}/log`, {
        date: localToday(),
        value,
      }).then(r => r.json()),
    onSuccess: () => {
      haptic("success");
      queryClient.invalidateQueries({ queryKey: ["/api/challenges"] });
      queryClient.invalidateQueries({ queryKey: ["/api/challenges", challenge.id, "leaderboard"] });
      toast({
        title: "Logged!",
        description: challenge.type === "habit"
          ? "Commitment met — keep it up."
          : `Score ${scoreValue} saved.`,
      });
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
          <h3 className="font-bold text-base">Log today</h3>
          <button onClick={onClose} className="p-1 text-muted-foreground"><X className="h-4 w-4" /></button>
        </div>

        {challenge.type === "habit" ? (
          <div className="text-center py-2">
            <div className="text-4xl mb-3">{challenge.habitEmoji ?? "✅"}</div>
            <p className="text-sm font-semibold text-foreground mb-1">{challenge.habitName}</p>
            {challenge.myCommitment && (
              <p className="text-xs text-primary/80 bg-primary/5 rounded-lg px-3 py-1.5 mx-auto inline-block mb-3">
                Your commitment: <strong>{challenge.myCommitment}</strong>
              </p>
            )}
            <p className="text-xs text-muted-foreground mb-5">
              {challenge.myCommitment
                ? "Tick this when you've hit your commitment."
                : "Did you do it today?"}
            </p>
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
            <div className="bg-muted/40 rounded-xl px-4 py-3">
              <p className="text-xs text-muted-foreground mb-0.5">Metric</p>
              <p className="text-sm font-semibold text-foreground">{challenge.metricName}</p>
            </div>
            <div className="bg-amber-400/5 border border-amber-400/20 rounded-xl px-4 py-3">
              <div className="flex items-start gap-2">
                <EyeOff className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  Scores are hidden until everyone in the challenge has submitted for today. You can't see anyone else's score before you log.
                </p>
              </div>
            </div>
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
              {logMutation.isPending ? "Saving…" : "Submit score"}
            </button>
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ── Challenge card ────────────────────────────────────────────────────────────
function ChallengeCard({
  challenge,
  viewerIsCreator,
  connections = [],
}: {
  challenge: ChallengeWithProgress;
  viewerIsCreator: boolean;
  connections?: { userId: number; username: string; displayName: string | null }[];
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [showLogSheet, setShowLogSheet] = useState(false);
  const [showJoinSheet, setShowJoinSheet] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showEditSheet, setShowEditSheet] = useState(false);

  const active = isActive(challenge);
  const past = isPast(challenge);
  const pct = progressPct(challenge);
  const left = daysLeft(challenge.endDate);
  const loggedToday = challenge.myStats?.loggedToday ?? false;
  const myDays = challenge.myStats?.daysLogged ?? 0;

  const declineMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/challenges/${challenge.id}/decline`, {}).then(r => r.json()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/challenges"] }),
  });

  // Pending invitees — only fetched when viewer is the creator and challenge is still active
  const { data: pendingInvites = [] } = useQuery<{ userId: number; username: string; displayName: string | null }[]>({
    queryKey: ["/api/challenges", challenge.id, "invited"],
    queryFn: async () => {
      const res = await fetch(`/api/challenges/${challenge.id}/invited`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: viewerIsCreator && !past,
    staleTime: 30000,
  });

  const [nudgingId, setNudgingId] = useState<number | null>(null);
  async function nudge(username: string, userId: number) {
    setNudgingId(userId);
    haptic("medium");
    try {
      await apiRequest("POST", `/api/challenges/${challenge.id}/invite`, { username });
      toast({ title: "Nudge sent", description: `${username} has been reminded.` });
    } catch {
      toast({ title: "Failed to send nudge", variant: "destructive" });
    } finally {
      setNudgingId(null);
    }
  }

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
        {/* Card body */}
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
                  ? <Globe className="h-3 w-3 text-muted-foreground/40 shrink-0" />
                  : <Lock className="h-3 w-3 text-muted-foreground/40 shrink-0" />
                }
                {past && <span className="text-[10px] text-muted-foreground/60 bg-muted px-1.5 py-0.5 rounded-full">Ended</span>}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5 leading-snug">
                {challenge.type === "habit" ? challenge.habitName : `Score: ${challenge.metricName}`}
                {" · "}by @{challenge.creatorDisplayName ?? challenge.creatorUsername}
              </p>
              {/* My commitment pill */}
              {challenge.myCommitment && challenge.type === "habit" && !invited && (
                <p className="text-[11px] text-primary/80 mt-0.5 italic">Your target: {challenge.myCommitment}</p>
              )}
            </div>
            {viewerIsCreator && !past && (
              <div className="flex items-center gap-0.5 shrink-0">
                <button
                  onClick={() => { haptic("light"); setShowEditSheet(true); }}
                  className="p-1.5 text-muted-foreground/40 hover:text-primary transition-colors"
                  title="Edit challenge"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => { haptic("light"); setShowDeleteConfirm(v => !v); }}
                  className="p-1.5 text-muted-foreground/40 hover:text-red-400 transition-colors"
                  title="Delete challenge"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </div>

          {/* Stats */}
          <div className="flex items-center gap-4 mb-3 flex-wrap">
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
            {challenge.frequency && challenge.frequency !== "daily" && (
              <span className="text-[10px] px-1.5 py-0.5 bg-muted rounded-full text-muted-foreground">
                {challenge.frequency === "every_other_day" ? "Alternate days" : "Weekly"}
              </span>
            )}
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

        {/* Invited — show join sheet (with commitment prompt) */}
        {invited && (
          <div className="border-t border-primary/20 px-4 py-3 flex items-center gap-3 bg-primary/5">
            <p className="text-xs text-foreground/80 flex-1">
              {challenge.type === "habit"
                ? `You've been invited — set your personal target`
                : `You've been invited to the ${challenge.metricName} challenge`
              }
            </p>
            <button
              onClick={() => { haptic("light"); declineMutation.mutate(); }}
              className="text-xs text-muted-foreground px-2 py-1"
            >Decline</button>
            <button
              onClick={() => { haptic("medium"); setShowJoinSheet(true); }}
              className="text-xs font-medium text-white bg-primary px-3 py-1.5 rounded-lg"
            >Join</button>
          </div>
        )}

        {/* Joined + active */}
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
                {challenge.type === "habit"
                  ? <><CheckCircle2 className="h-3.5 w-3.5" /> Log today</>
                  : <><Zap className="h-3.5 w-3.5" /> Submit score</>
                }
              </button>
            )}
            <button
              onClick={() => { haptic("select"); setShowLeaderboard(true); }}
              className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-muted text-muted-foreground hover:text-foreground"
            >
              <Trophy className="h-3.5 w-3.5" />
              {challenge.type === "score" ? "Standings" : "Standings"}
            </button>
          </div>
        )}

        {/* Past */}
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

        {/* Pending invites — creator only, active challenges */}
        {viewerIsCreator && !past && pendingInvites.length > 0 && (
          <div className="border-t border-border/30 px-4 py-2.5 space-y-1.5">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium flex items-center gap-1">
              <Bell className="h-3 w-3" /> Awaiting response ({pendingInvites.length})
            </p>
            {pendingInvites.map(p => (
              <div key={p.userId} className="flex items-center justify-between gap-2">
                <span className="text-xs text-foreground/70 truncate">
                  {p.displayName ? `${p.displayName}` : `@${p.username}`}
                </span>
                <button
                  disabled={nudgingId === p.userId}
                  onClick={() => nudge(p.username, p.userId)}
                  className="text-[11px] font-medium text-primary/70 hover:text-primary px-2 py-0.5 rounded-md hover:bg-primary/5 transition-colors shrink-0 disabled:opacity-50"
                >
                  {nudgingId === p.userId ? "Sending…" : "Re-send"}
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Delete confirm */}
        <AnimatePresence>
          {showDeleteConfirm && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="border-t border-border/50 bg-red-500/5 px-4 py-3 flex items-center justify-between"
            >
              <p className="text-xs text-muted-foreground">Delete this challenge for everyone?</p>
              <div className="flex gap-2">
                <button onClick={() => setShowDeleteConfirm(false)} className="text-xs text-muted-foreground px-2 py-1">Cancel</button>
                <button
                  onClick={() => { setShowDeleteConfirm(false); deleteMutation.mutate(); }}
                  className="text-xs font-medium text-red-500 px-2 py-1"
                >Delete</button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      <AnimatePresence>
        {showLeaderboard && (
          <ChallengeLeaderboardSheet
            challengeId={challenge.id}
            challengeType={challenge.type}
            onClose={() => setShowLeaderboard(false)}
          />
        )}
        {showLogSheet && (
          <LogEntrySheet challenge={challenge} onClose={() => setShowLogSheet(false)} />
        )}
        {showJoinSheet && (
          <JoinWithCommitmentSheet
            challenge={challenge}
            onClose={() => setShowJoinSheet(false)}
            onJoined={() => {}}
          />
        )}
        {showEditSheet && (
          <EditChallengeSheet
            challenge={challenge}
            connections={connections}
            onClose={() => setShowEditSheet(false)}
          />
        )}
      </AnimatePresence>
    </>
  );
}

// ── Edit challenge sheet ───────────────────────────────────────────────────────
function EditChallengeSheet({
  challenge,
  connections,
  onClose,
}: {
  challenge: ChallengeWithProgress;
  connections: { userId: number; username: string; displayName: string | null }[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [title, setTitle] = useState(challenge.title);
  const [extraDays, setExtraDays] = useState(0);
  const [inviting, setInviting] = useState<number[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [reminderEnabled, setReminderEnabled] = useState(!!challenge.myReminderTime);
  const [reminderTime, setReminderTime] = useState(challenge.myReminderTime ?? "21:00");

  const editMutation = useMutation({
    mutationFn: (body: { title?: string; endDate?: string }) =>
      apiRequest("PATCH", `/api/challenges/${challenge.id}`, body).then(r => r.json()),
    onSuccess: () => {
      haptic("success");
      queryClient.invalidateQueries({ queryKey: ["/api/challenges"] });
    },
    onError: () => toast({ title: "Failed to save changes", variant: "destructive" }),
  });

  async function handleSave() {
    setIsSending(true);
    try {
      const newEndDate = extraDays > 0
        ? new Date(new Date(challenge.endDate).getTime() + extraDays * 86400000)
            .toISOString().split("T")[0]
        : undefined;
      const titleChanged = title.trim() !== challenge.title;
      if (titleChanged || newEndDate) {
        await editMutation.mutateAsync({
          ...(titleChanged ? { title: title.trim() } : {}),
          ...(newEndDate ? { endDate: newEndDate } : {}),
        });
      }
      // Save reminder settings (always update so clearing also works)
      const newReminderTime = reminderEnabled ? reminderTime : null;
      if (newReminderTime !== challenge.myReminderTime) {
        await apiRequest("PATCH", `/api/challenges/${challenge.id}/reminder`, { reminderTime: newReminderTime });
        queryClient.invalidateQueries({ queryKey: ["/api/challenges"] });
      }
      // Send invites for newly selected connections
      if (inviting.length > 0) {
        const targets = connections.filter(c => inviting.includes(c.userId));
        const results = await Promise.allSettled(
          targets.map(t =>
            apiRequest("POST", `/api/challenges/${challenge.id}/invite`, { username: t.username })
          )
        );
        queryClient.invalidateQueries({ queryKey: ["/api/challenges"] });
        const failed = results.filter(r => r.status === "rejected").length;
        if (failed > 0) {
          toast({ title: `${failed} invite(s) failed`, variant: "destructive" });
        }
      }
      toast({ title: "Challenge updated", description: inviting.length > 0 ? "Invites sent." : undefined });
      onClose();
    } catch {
      toast({ title: "Failed to save", variant: "destructive" });
    } finally {
      setIsSending(false);
    }
  }

  // Show all connections — server deduplicates if they're already in the challenge
  const uninvited = connections;

  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 30 }}
      className="fixed inset-0 z-50 flex items-end"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl mx-auto bg-background rounded-t-3xl border-t border-x border-border/60 shadow-2xl p-6 pb-10 space-y-5 max-h-[80vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-foreground">Edit Challenge</h3>
          <button onClick={onClose} className="p-1.5 text-muted-foreground"><X className="h-4 w-4" /></button>
        </div>

        {/* Title */}
        <div>
          <label className="text-xs text-muted-foreground block mb-1.5">Challenge name</label>
          <Input
            value={title}
            onChange={e => setTitle(e.target.value)}
            className="bg-card border-border/50"
            maxLength={80}
          />
        </div>

        {/* Extend duration */}
        <div>
          <label className="text-xs text-muted-foreground block mb-2">Extend end date</label>
          <div className="flex gap-2 flex-wrap">
            {[0, 3, 7, 14, 21, 30].map(d => (
              <button
                key={d}
                onClick={() => { haptic("select"); setExtraDays(d); }}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-all ${
                  extraDays === d
                    ? "border-primary bg-primary text-white"
                    : "border-border/50 bg-card text-foreground"
                }`}
              >
                {d === 0 ? "No change" : `+${d}d`}
              </button>
            ))}
          </div>
          {extraDays > 0 && (
            <p className="text-[11px] text-muted-foreground/60 mt-1.5">
              New end date: {new Date(new Date(challenge.endDate).getTime() + extraDays * 86400000).toLocaleDateString("en-CA")}
            </p>
          )}
        </div>

        {/* Reminder toggle */}
        <div className="flex items-center justify-between px-1">
          <div>
            <p className="text-xs font-medium text-foreground">Daily reminder</p>
            <p className="text-[11px] text-muted-foreground">Get nudged when you haven't logged yet</p>
          </div>
          <button
            onClick={() => { haptic("select"); setReminderEnabled(e => !e); }}
            className="relative rounded-full transition-colors"
            style={{ width: 40, height: 22, background: reminderEnabled ? "hsl(var(--primary))" : "hsl(var(--muted))" }}
          >
            <span
              className="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform"
              style={{ transform: reminderEnabled ? "translateX(18px)" : "translateX(0)" }}
            />
          </button>
        </div>
        {reminderEnabled && (
          <div className="flex items-center gap-3 px-1">
            <p className="text-xs text-muted-foreground flex-1">Remind me at</p>
            <input
              type="time"
              value={reminderTime}
              onChange={e => setReminderTime(e.target.value)}
              className="text-sm font-semibold bg-card border border-border/50 rounded-lg px-2 py-1 text-foreground"
            />
          </div>
        )}

        {/* Invite more crew */}
        {uninvited.length > 0 && (
          <div>
            <label className="text-xs text-muted-foreground block mb-2">Invite more crew</label>
            <div className="space-y-1.5">
              {uninvited.map(c => {
                const selected = inviting.includes(c.userId);
                const name = c.displayName || c.username;
                return (
                  <button
                    key={c.userId}
                    onClick={() => {
                      haptic("select");
                      setInviting(prev =>
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

        <button
          onClick={handleSave}
          disabled={isSending}
          className="w-full py-3 rounded-xl bg-primary text-white font-medium text-sm disabled:opacity-50"
        >
          {isSending ? "Saving…" : "Save changes"}
        </button>
      </div>
    </motion.div>
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
  const [habitName, setHabitName] = useState("");
  const [habitEmoji, setHabitEmoji] = useState("🎯");
  const [metricName, setMetricName] = useState("");
  const [creatorCommitment, setCreatorCommitment] = useState("");
  const [durationDays, setDurationDays] = useState(7);
  const [frequency, setFrequency] = useState<"daily" | "every_other_day" | "weekly">("daily");
  const [visibility, setVisibility] = useState<"invite_only" | "open">("invite_only");
  const [selectedInvitees, setSelectedInvitees] = useState<number[]>([]);
  const [reminderEnabled, setReminderEnabled] = useState(false);
  const [reminderTime, setReminderTime] = useState("21:00");

  const createMutation = useMutation({
    mutationFn: (body: object) => apiRequest("POST", "/api/challenges", body).then(r => r.json()),
    onSuccess: () => {
      haptic("success");
      toast({ title: "Challenge created!", description: selectedInvitees.length > 0 || visibility === "open" ? "Invitations sent." : "Ready when your crew joins." });
      queryClient.invalidateQueries({ queryKey: ["/api/challenges"] });
      onClose();
    },
    onError: () => toast({ title: "Failed to create challenge", variant: "destructive" }),
  });

  function handleCreate() {
    const today = localToday();
    const end = new Date(new Date(today + "T12:00:00").getTime() + durationDays * 86400000).toLocaleDateString("en-CA");
    const inviteeUsernames = visibility === "invite_only"
      ? connections.filter(c => selectedInvitees.includes(c.userId)).map(c => c.username)
      : [];
    createMutation.mutate({
      title: title.trim() || (type === "habit" ? habitName : `${metricName} challenge`),
      type,
      habitName: type === "habit" ? habitName : null,
      habitEmoji: type === "habit" ? habitEmoji : null,
      metricName: type === "score" ? metricName : null,
      creatorCommitment: type === "habit" && creatorCommitment.trim() ? creatorCommitment.trim() : undefined,
      creatorReminderTime: reminderEnabled ? reminderTime : undefined,
      visibility,
      frequency,
      startDate: today,
      endDate: end,
      inviteeUsernames,
    });
  }

  const canProceed = type === "habit" ? habitName.trim().length > 0 : metricName.trim().length > 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 30 }}
      className="fixed inset-0 z-50 flex items-end"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl mx-auto bg-background rounded-t-3xl border-t border-x border-border/60 shadow-2xl p-6 pb-10 space-y-5 max-h-[88vh] overflow-y-auto"
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

        {/* Step progress */}
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
              {[
                {
                  key: "habit" as const,
                  icon: "🎯",
                  title: "Habit challenge",
                  desc: "Everyone commits to the same habit — each person sets their own personal target.",
                },
                {
                  key: "score" as const,
                  icon: null,
                  iconEl: <Activity className="h-5 w-5 text-blue-400" />,
                  title: "Score challenge",
                  desc: "Log the same metric daily. Scores stay hidden until everyone submits — no score-chasing.",
                },
              ].map(opt => (
                <button
                  key={opt.key}
                  onClick={() => { haptic("select"); setType(opt.key); setStep("details"); }}
                  className={`w-full flex items-center gap-4 p-4 rounded-2xl border text-left transition-all ${
                    type === opt.key
                      ? opt.key === "habit" ? "border-primary bg-primary/5" : "border-blue-400 bg-blue-400/5"
                      : "border-border/50 bg-card"
                  }`}
                >
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0 ${
                    opt.key === "habit" ? "bg-primary/10" : "bg-blue-500/10"
                  }`}>
                    {opt.icon ?? opt.iconEl}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">{opt.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{opt.desc}</p>
                  </div>
                </button>
              ))}
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
                    <label className="text-xs text-muted-foreground block mb-1.5">Shared habit name</label>
                    <Input
                      value={habitName}
                      onChange={e => setHabitName(e.target.value)}
                      placeholder="e.g. Morning workout, Cold shower, No phone before 9am…"
                      className="bg-card border-border/50"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1.5">
                      Your personal target <span className="text-muted-foreground/60">(optional)</span>
                    </label>
                    <Input
                      value={creatorCommitment}
                      onChange={e => setCreatorCommitment(e.target.value)}
                      placeholder={habitName ? `e.g. 30 mins of ${habitName.toLowerCase()}` : "e.g. 100 pushups, 20 mins…"}
                      className="bg-card border-border/50"
                      maxLength={80}
                    />
                    <p className="text-[11px] text-muted-foreground/60 mt-1">
                      Each person sets their own — others join at a level that works for them.
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1.5">Shared metric to track</label>
                    <Input
                      value={metricName}
                      onChange={e => setMetricName(e.target.value)}
                      placeholder="e.g. Sleep, Energy, Focus, Steps…"
                      className="bg-card border-border/50"
                    />
                  </div>
                  <div className="bg-blue-500/5 border border-blue-500/20 rounded-xl px-4 py-3">
                    <div className="flex items-start gap-2">
                      <EyeOff className="h-3.5 w-3.5 text-blue-400 shrink-0 mt-0.5" />
                      <p className="text-[11px] text-muted-foreground leading-relaxed">
                        Scores are hidden until everyone has submitted for that day — no one can see the leaderboard and then submit a higher number.
                      </p>
                    </div>
                  </div>
                </>
              )}

              <div>
                <label className="text-xs text-muted-foreground block mb-1.5">Challenge name <span className="text-muted-foreground/60">(optional)</span></label>
                <Input
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  placeholder={type === "habit" ? (habitName || "Give it a name…") : (metricName ? `${metricName} challenge` : "Give it a name…")}
                  className="bg-card border-border/50"
                />
              </div>

              <button
                onClick={() => { if (canProceed) { haptic("light"); setStep("settings"); } }}
                disabled={!canProceed}
                className="w-full py-3 rounded-xl bg-primary text-white font-medium text-sm disabled:opacity-40"
              >
                Next
              </button>
            </motion.div>
          )}

          {/* Step 3: Settings */}
          {step === "settings" && (
            <motion.div key="settings" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-5">
              {/* Frequency */}
              <div>
                <label className="text-xs text-muted-foreground block mb-2">Log frequency</label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { key: "daily" as const, label: "Daily", sub: "Every day" },
                    { key: "every_other_day" as const, label: "Alternate", sub: "Every other day" },
                    { key: "weekly" as const, label: "Weekly", sub: "Once a week" },
                  ].map(opt => (
                    <button
                      key={opt.key}
                      onClick={() => { haptic("select"); setFrequency(opt.key); }}
                      className={`flex flex-col items-center gap-0.5 p-2.5 rounded-xl border text-center transition-all ${
                        frequency === opt.key ? "border-primary bg-primary/5" : "border-border/50 bg-card"
                      }`}
                    >
                      <p className={`text-xs font-semibold ${frequency === opt.key ? "text-primary" : "text-foreground"}`}>{opt.label}</p>
                      <p className="text-[10px] text-muted-foreground leading-tight">{opt.sub}</p>
                    </button>
                  ))}
                </div>
              </div>

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
                  {[
                    { key: "invite_only" as const, icon: Lock, label: "Invite only", sub: "You choose who joins", active: "border-primary bg-primary/5", iconClass: "text-primary" },
                    { key: "open" as const, icon: Globe, label: "Open to crew", sub: "All connections invited", active: "border-blue-400 bg-blue-400/5", iconClass: "text-blue-400" },
                  ].map(opt => {
                    const Icon = opt.icon;
                    const isSelected = visibility === opt.key;
                    return (
                      <button
                        key={opt.key}
                        onClick={() => setVisibility(opt.key)}
                        className={`flex items-center gap-2 p-3 rounded-xl border text-left transition-all ${isSelected ? opt.active : "border-border/50 bg-card"}`}
                      >
                        <Icon className={`h-4 w-4 shrink-0 ${isSelected ? opt.iconClass : "text-muted-foreground"}`} />
                        <div>
                          <p className="text-xs font-medium text-foreground">{opt.label}</p>
                          <p className="text-[10px] text-muted-foreground">{opt.sub}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Invite specific people */}
              {visibility === "invite_only" && connections.length > 0 && (
                <div>
                  <label className="text-xs text-muted-foreground block mb-2">Invite crew members</label>
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
                  No crew yet — add connections first, or switch to Open.
                </p>
              )}

              {/* Reminder */}
              <div className="space-y-2.5 pt-1">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-foreground">Daily reminder for me</p>
                    <p className="text-[11px] text-muted-foreground">Get nudged when you haven't logged yet</p>
                  </div>
                  <button
                    onClick={() => { haptic("select"); setReminderEnabled(e => !e); }}
                    className="rounded-full transition-colors relative"
                    style={{ width: 40, height: 22, background: reminderEnabled ? "hsl(var(--primary))" : "hsl(var(--muted))" }}
                  >
                    <span
                      className="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform"
                      style={{ transform: reminderEnabled ? "translateX(18px)" : "translateX(0)" }}
                    />
                  </button>
                </div>
                {reminderEnabled && (
                  <div className="flex items-center gap-3">
                    <p className="text-xs text-muted-foreground flex-1">Remind me at</p>
                    <input
                      type="time"
                      value={reminderTime}
                      onChange={e => setReminderTime(e.target.value)}
                      className="text-sm font-semibold bg-card border border-border/50 rounded-lg px-2 py-1 text-foreground"
                    />
                  </div>
                )}
              </div>

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
  viewerUserId,
}: {
  acceptedConnections: { userId: number; username: string; displayName: string | null }[];
  viewerUserId: number;
}) {
  const [showCreate, setShowCreate] = useState(false);
  const { data: challenges = [], isLoading } = useQuery<ChallengeWithProgress[]>({
    queryKey: ["/api/challenges"],
    queryFn: () =>
      fetch(`/api/challenges?date=${localToday()}`, { credentials: "include" }).then(r => r.json()),
    staleTime: 30000,
    refetchInterval: 60000, // Poll every 60 s so new invites appear without manual refresh
  });

  const invited = challenges.filter(c => c.myStatus === "invited");
  const active = challenges.filter(c => c.myStatus === "joined" && isActive(c));
  const past = challenges.filter(c => c.myStatus === "joined" && isPast(c));

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Challenges</h2>
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
              {invited.map(ch => <ChallengeCard key={ch.id} challenge={ch} viewerIsCreator={false} />)}
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
            Compete with your crew — habit streaks or score battles.
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
              <ChallengeCard key={ch.id} challenge={ch} viewerIsCreator={ch.creatorId === viewerUserId} connections={acceptedConnections} />
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
              {past.map(ch => <ChallengeCard key={ch.id} challenge={ch} viewerIsCreator={false} />)}
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
