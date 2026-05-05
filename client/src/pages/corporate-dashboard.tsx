import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  Building2, Users, Flame, TrendingUp, Mail, Plus, Settings,
  X, Copy, Loader2, ExternalLink, Trash2, Shield,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { haptic } from "@/lib/haptics";
import type { OrgMember } from "@shared/schema";

interface OrgShape {
  id: number;
  name: string;
  logoUrl: string | null;
  accentColour: string | null;
  aiPersonaName: string | null;
  seatCount: number;
  subscriptionStatus: string;
  stripeCustomerId: string | null;
}

interface DashboardData {
  org: OrgShape;
  members: OrgMember[];
  stats: {
    avgStreak: number;
    avgConsistency: number;
    activeCount: number;
    pendingCount: number;
  };
  challengeCount: number;
}

interface SettingsFormState {
  name: string;
  accentColour: string;
  aiPersonaName: string;
  logoUrl: string;
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    active:   { label: "Active",   cls: "bg-green-500/10 text-green-500" },
    pending:  { label: "Pending",  cls: "bg-amber-500/10 text-amber-500" },
    removed:  { label: "Removed",  cls: "bg-red-500/10 text-red-400" },
    inactive: { label: "Inactive", cls: "bg-muted text-muted-foreground" },
  };
  const { label, cls } = map[status] ?? { label: status, cls: "bg-muted text-muted-foreground" };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ${cls}`}>
      {label}
    </span>
  );
}

export default function CorporateDashboard() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [inviteEmail, setInviteEmail] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [settingsForm, setSettingsForm] = useState<SettingsFormState>({
    name: "",
    accentColour: "#d97706",
    aiPersonaName: "Performance Engineer",
    logoUrl: "",
  });
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

  const { data, isLoading } = useQuery<DashboardData>({
    queryKey: ["/api/corporate/dashboard"],
    queryFn: (): Promise<DashboardData> =>
      fetch("/api/corporate/dashboard", { credentials: "include" }).then(r => {
        if (!r.ok) throw new Error("Failed to load dashboard");
        return r.json();
      }),
    staleTime: 30000,
    onSuccess: (d: DashboardData) => {
      setSettingsForm({
        name: d.org.name,
        accentColour: d.org.accentColour ?? "#d97706",
        aiPersonaName: d.org.aiPersonaName ?? "Performance Engineer",
        logoUrl: d.org.logoUrl ?? "",
      });
    },
  } as Parameters<typeof useQuery<DashboardData>>[0]);

  const inviteMutation = useMutation({
    mutationFn: (email: string) =>
      apiRequest("POST", "/api/corporate/invite", { email }).then(r => r.json()),
    onSuccess: (respData: { inviteUrl?: string; email?: string; emailDelivered?: boolean }) => {
      haptic("success");
      setInviteEmail("");
      qc.invalidateQueries({ queryKey: ["/api/corporate/dashboard"] });
      if (respData.inviteUrl) {
        setCopiedUrl(respData.inviteUrl);
        if (respData.emailDelivered) {
          toast({ title: "Invite sent!", description: `An email was sent to ${respData.email}.` });
        } else {
          toast({ title: "Invite link generated", description: "Copy the link below and send it to your team member." });
        }
      }
    },
    onError: (err: Error) => {
      let msg = "Failed to send invite";
      try {
        const p = JSON.parse(err.message.split(":").slice(1).join(":").trim());
        msg = p.message ?? msg;
      } catch {}
      toast({ title: msg, variant: "destructive" });
    },
  });

  const settingsMutation = useMutation({
    mutationFn: (updates: SettingsFormState) =>
      apiRequest("PUT", "/api/corporate/org/settings", updates).then(r => r.json()),
    onSuccess: () => {
      haptic("success");
      toast({ title: "Settings saved" });
      qc.invalidateQueries({ queryKey: ["/api/corporate/dashboard"] });
      qc.invalidateQueries({ queryKey: ["/api/corporate/membership"] });
      setShowSettings(false);
    },
    onError: () => toast({ title: "Failed to save settings", variant: "destructive" }),
  });

  const removeMutation = useMutation({
    mutationFn: (memberId: number) =>
      apiRequest("DELETE", `/api/corporate/members/${memberId}`, {}).then(r => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/corporate/dashboard"] });
      toast({ title: "Member removed" });
    },
  });

  const portalMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/corporate/portal", {}).then(r => r.json()),
    onSuccess: ({ url }: { url: string }) => { if (url) window.location.href = url; },
    onError: () => toast({ title: "Could not open billing portal", variant: "destructive" }),
  });

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text).then(() => {
      haptic("light");
      toast({ title: "Invite link copied!" });
    });
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <p className="text-muted-foreground mb-4">No corporate account found.</p>
          <Button onClick={() => (window.location.href = "/corporate/onboarding")}>
            Set up your organisation
          </Button>
        </div>
      </div>
    );
  }

  const { org, members, stats, challengeCount } = data;
  const activeMembers = members.filter(m => m.status === "active");
  const pendingMembers = members.filter(m => m.status === "pending");

  return (
    <div className="min-h-screen bg-background pb-16">
      <div className="max-w-2xl mx-auto px-4 pt-6 space-y-5">

        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Building2 className="h-4 w-4 text-primary" />
              <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-muted-foreground">Corporate Admin</p>
            </div>
            <h1 className="text-2xl font-black text-foreground tracking-tight">{org.name}</h1>
            <div className="flex items-center gap-2 mt-1">
              <StatusBadge status={org.subscriptionStatus} />
              <span className="text-xs text-muted-foreground">
                {activeMembers.length}/{org.seatCount} seats active
              </span>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setShowSettings(v => !v)}
              className="p-2 rounded-xl border border-border/50 text-muted-foreground hover:text-foreground transition-colors"
            >
              <Settings className="h-4 w-4" />
            </button>
            {org.stripeCustomerId && (
              <button
                onClick={() => { haptic("light"); portalMutation.mutate(); }}
                className="p-2 rounded-xl border border-border/50 text-muted-foreground hover:text-foreground transition-colors"
                title="Manage billing"
              >
                <ExternalLink className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        {/* Setup call-to-action if not active */}
        {org.subscriptionStatus !== "active" && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4 flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-amber-500">Plan not yet active</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Complete checkout to activate seats and invite your team
              </p>
            </div>
            <Button
              size="sm"
              className="shrink-0 ml-4"
              onClick={() => (window.location.href = "/corporate/onboarding")}
            >
              Activate
            </Button>
          </div>
        )}

        {/* Settings panel */}
        <AnimatePresence>
          {showSettings && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="bg-card rounded-2xl border border-border/50 p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-foreground">Team settings</h3>
                  <button onClick={() => setShowSettings(false)} className="text-muted-foreground hover:text-foreground">
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="space-y-3">
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1 block">Organisation name</Label>
                    <Input
                      value={settingsForm.name}
                      onChange={e => setSettingsForm(f => ({ ...f, name: e.target.value }))}
                      className="h-9"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1 block">Logo URL (optional)</Label>
                    <Input
                      value={settingsForm.logoUrl}
                      onChange={e => setSettingsForm(f => ({ ...f, logoUrl: e.target.value }))}
                      placeholder="https://..."
                      className="h-9"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs text-muted-foreground mb-1 block">Accent colour</Label>
                      <div className="flex gap-2">
                        <input
                          type="color"
                          value={settingsForm.accentColour}
                          onChange={e => setSettingsForm(f => ({ ...f, accentColour: e.target.value }))}
                          className="w-9 h-9 rounded-lg cursor-pointer border border-border"
                        />
                        <Input
                          value={settingsForm.accentColour}
                          onChange={e => setSettingsForm(f => ({ ...f, accentColour: e.target.value }))}
                          className="h-9 font-mono text-sm flex-1"
                        />
                      </div>
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground mb-1 block">AI persona name</Label>
                      <Input
                        value={settingsForm.aiPersonaName}
                        onChange={e => setSettingsForm(f => ({ ...f, aiPersonaName: e.target.value }))}
                        className="h-9"
                        placeholder="Engineer name"
                      />
                    </div>
                  </div>
                </div>
                <Button
                  className="w-full h-9 font-bold"
                  onClick={() => settingsMutation.mutate(settingsForm)}
                  disabled={settingsMutation.isPending}
                >
                  {settingsMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" /> : null}
                  Save settings
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-card rounded-2xl border border-border/50 p-3.5 text-center">
            <div className="flex items-center justify-center gap-1 mb-1">
              <Flame className="h-3.5 w-3.5 text-orange-400" />
              <span className="text-xl font-black text-foreground">{stats.avgStreak}</span>
            </div>
            <p className="text-[10px] text-muted-foreground">Avg streak</p>
          </div>
          <div className="bg-card rounded-2xl border border-border/50 p-3.5 text-center">
            <div className="flex items-center justify-center gap-1 mb-1">
              <TrendingUp className="h-3.5 w-3.5 text-blue-400" />
              <span className="text-xl font-black text-foreground">{stats.avgConsistency}%</span>
            </div>
            <p className="text-[10px] text-muted-foreground">Avg 7-day rate</p>
          </div>
          <div className="bg-card rounded-2xl border border-border/50 p-3.5 text-center">
            <div className="flex items-center justify-center gap-1 mb-1">
              <Shield className="h-3.5 w-3.5 text-primary" />
              <span className="text-xl font-black text-foreground">{challengeCount}</span>
            </div>
            <p className="text-[10px] text-muted-foreground">Team challenges</p>
          </div>
        </div>

        {/* Invite link display */}
        {copiedUrl && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-primary/5 border border-primary/20 rounded-2xl p-4"
          >
            <p className="text-xs font-semibold text-primary mb-2">
              Copy and send this link to your team member:
            </p>
            <div className="flex gap-2">
              <Input
                value={copiedUrl}
                readOnly
                className="h-8 text-xs font-mono flex-1 bg-background"
              />
              <button
                onClick={() => copyToClipboard(copiedUrl)}
                className="flex-shrink-0 px-3 h-8 rounded-lg bg-primary text-primary-foreground text-xs font-bold flex items-center gap-1"
              >
                <Copy className="h-3 w-3" /> Copy
              </button>
            </div>
            <button
              onClick={() => setCopiedUrl(null)}
              className="text-xs text-muted-foreground mt-2 hover:text-foreground"
            >
              Dismiss
            </button>
          </motion.div>
        )}

        {/* Invite form */}
        <div className="bg-card rounded-2xl border border-border/50 p-5 space-y-3">
          <div className="flex items-center gap-2 mb-1">
            <Mail className="h-4 w-4 text-primary" />
            <h3 className="font-bold text-foreground text-sm">Invite a team member</h3>
          </div>
          <div className="flex gap-2">
            <Input
              type="email"
              value={inviteEmail}
              onChange={e => setInviteEmail(e.target.value)}
              placeholder="teammate@company.com"
              className="h-10 flex-1"
              onKeyDown={e => {
                if (e.key === "Enter" && inviteEmail.includes("@")) {
                  inviteMutation.mutate(inviteEmail);
                }
              }}
            />
            <Button
              className="h-10 px-4 font-bold shrink-0"
              disabled={
                !inviteEmail.includes("@") ||
                inviteMutation.isPending ||
                org.subscriptionStatus !== "active"
              }
              onClick={() => inviteMutation.mutate(inviteEmail)}
            >
              {inviteMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
            </Button>
          </div>
          {org.subscriptionStatus !== "active" ? (
            <p className="text-xs text-amber-500">Activate your plan to invite team members</p>
          ) : (
            <p className="text-xs text-muted-foreground">
              An invite email will be sent. If email is not configured, a shareable link will appear above.
            </p>
          )}
        </div>

        {/* Members list */}
        <div className="space-y-2">
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground px-1">
            Team members ({activeMembers.length} active, {pendingMembers.length} pending)
          </p>

          {members.length === 0 && (
            <div className="bg-card rounded-2xl border border-border/50 p-6 text-center">
              <Users className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">No members yet. Invite your team above.</p>
            </div>
          )}

          {members.map((member: OrgMember) => (
            <motion.div
              key={member.id}
              layout
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-card rounded-xl border border-border/50 px-4 py-3 flex items-center justify-between"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <span className="text-xs font-bold text-primary">
                    {member.email.slice(0, 2).toUpperCase()}
                  </span>
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground truncate max-w-[180px]">
                    {member.email}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {member.joinedAt
                      ? `Joined ${new Date(member.joinedAt).toLocaleDateString()}`
                      : "Invite pending"}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <StatusBadge status={member.status} />
                {member.status !== "removed" && (
                  <button
                    onClick={() => { haptic("light"); removeMutation.mutate(member.id); }}
                    className="p-1 text-muted-foreground/40 hover:text-red-400 transition-colors"
                    title="Remove member"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </motion.div>
          ))}
        </div>

        <p className="text-center text-xs text-muted-foreground/50 pb-4">
          Individual debrief and journal content is never visible to admins — by design.
        </p>
      </div>
    </div>
  );
}
