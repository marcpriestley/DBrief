import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Building2, Check, Loader2, LogIn, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface InvitePreview {
  orgName: string;
  email: string;
  accentColour: string | null;
  logoUrl: string | null;
}

interface JoinResult {
  message: string;
  orgName: string;
}

export default function JoinOrg({ token }: { token: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [joined, setJoined] = useState(false);

  const { data: user, refetch: refetchUser } = useQuery<any>({
    queryKey: ["/api/auth/me"],
    queryFn: async () => {
      const r = await fetch("/api/auth/me", { credentials: "include" });
      if (r.status === 401) return null;
      return r.json();
    },
    retry: false,
  });

  const { data: invite, isLoading: inviteLoading } = useQuery<InvitePreview>({
    queryKey: ["/api/corporate/join", token],
    queryFn: () =>
      fetch(`/api/corporate/join/${token}`, { credentials: "include" }).then(r => {
        if (!r.ok) throw new Error("Invite not found");
        return r.json();
      }),
    retry: false,
  });

  // Auto-join once user is authenticated (called after login/register success)
  async function attemptJoin() {
    try {
      const res = await apiRequest("POST", `/api/corporate/join/${token}`, {});
      const data: JoinResult = await res.json();
      setJoined(true);
      qc.invalidateQueries({ queryKey: ["/api/auth/me"] });
      qc.invalidateQueries({ queryKey: ["/api/corporate/membership"] });
      toast({ title: `Welcome to ${data.orgName ?? "the team"}!`, description: "Your premium access is now active." });
    } catch (err: any) {
      let msg = "Failed to join";
      try {
        const p = JSON.parse(err.message.split(":").slice(1).join(":").trim());
        msg = p.message ?? msg;
      } catch {}
      toast({ title: msg, variant: "destructive" });
    }
  }

  const loginMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/auth/login", { username: username.trim(), password }).then(r => r.json()),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["/api/auth/me"] });
      await attemptJoin();
    },
    onError: () => toast({ title: "Login failed. Check your details.", variant: "destructive" }),
  });

  const registerMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/auth/register", {
        username: username.trim(),
        password,
        displayName: displayName.trim() || undefined,
      }).then(r => r.json()),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["/api/auth/me"] });
      await attemptJoin();
    },
    onError: (err: any) => {
      let msg = "Registration failed";
      try {
        const p = JSON.parse(err.message.split(":").slice(1).join(":").trim());
        msg = p.message ?? msg;
      } catch {}
      toast({ title: msg, variant: "destructive" });
    },
  });

  if (inviteLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!invite) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div className="text-center max-w-sm">
          <div className="w-14 h-14 rounded-2xl bg-red-500/10 flex items-center justify-center mx-auto mb-4">
            <Building2 className="h-7 w-7 text-red-400" />
          </div>
          <h1 className="text-xl font-bold text-foreground">Invite not found</h1>
          <p className="text-sm text-muted-foreground mt-2">
            This invite link has already been used or has expired.
          </p>
        </div>
      </div>
    );
  }

  if (joined) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="text-center max-w-sm"
        >
          <div className="w-16 h-16 rounded-2xl bg-green-500/10 flex items-center justify-center mx-auto mb-4">
            <Check className="h-8 w-8 text-green-500" />
          </div>
          <h1 className="text-xl font-bold text-foreground">You're in!</h1>
          <p className="text-sm text-muted-foreground mt-2 mb-6">
            You've joined {invite.orgName}. Your premium access is active.
          </p>
          <Button className="w-full" onClick={() => (window.location.href = "/")}>
            Open DBrief App
          </Button>
        </motion.div>
      </div>
    );
  }

  const isPending = loginMutation.isPending || registerMutation.isPending;

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        {/* Org header */}
        <div className="text-center mb-8">
          {invite.logoUrl ? (
            <img
              src={invite.logoUrl}
              alt={invite.orgName}
              className="w-14 h-14 rounded-2xl mx-auto mb-3 object-contain"
            />
          ) : (
            <div className="w-14 h-14 rounded-2xl bg-primary/15 flex items-center justify-center mx-auto mb-3">
              <Building2 className="h-7 w-7 text-primary" />
            </div>
          )}
          <h1 className="text-xl font-black text-foreground">{invite.orgName}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            You've been invited to join this team on DBrief
          </p>
          <p className="text-xs text-muted-foreground/60 mt-0.5">
            This invite is for <span className="font-semibold">{invite.email}</span>
          </p>
        </div>

        <div className="bg-card rounded-2xl border border-border/50 shadow-sm p-6 space-y-4">
          {/* If already logged in with the correct account */}
          {user ? (
            <div className="space-y-4">
              <div className="text-center">
                <p className="text-sm text-muted-foreground">
                  Logged in as{" "}
                  <span className="font-semibold text-foreground">
                    {user.displayName ?? user.username}
                  </span>
                </p>
                {user.username.toLowerCase() !== invite.email.toLowerCase() && (
                  <p className="text-xs text-amber-500 mt-1.5">
                    This invite was sent to {invite.email}. Please log out and sign in with that account.
                  </p>
                )}
              </div>
              {user.username.toLowerCase() === invite.email.toLowerCase() && (
                <Button
                  className="w-full h-11 font-bold"
                  onClick={attemptJoin}
                >
                  <Check className="h-4 w-4 mr-2" />
                  Join {invite.orgName}
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {/* Mode toggle */}
              <div className="flex gap-1 p-1 bg-muted rounded-xl">
                {(["login", "register"] as const).map(m => (
                  <button
                    key={m}
                    onClick={() => setMode(m)}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-sm font-medium transition-all ${
                      mode === m
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground"
                    }`}
                  >
                    {m === "login" ? (
                      <LogIn className="h-3.5 w-3.5" />
                    ) : (
                      <UserPlus className="h-3.5 w-3.5" />
                    )}
                    {m === "login" ? "Log in" : "Sign up"}
                  </button>
                ))}
              </div>

              {mode === "register" && (
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Name (optional)</Label>
                  <Input
                    value={displayName}
                    onChange={e => setDisplayName(e.target.value)}
                    placeholder="Your name"
                    className="h-10"
                  />
                </div>
              )}

              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Email</Label>
                <Input
                  type="email"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  placeholder={invite.email}
                  className="h-10"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Password</Label>
                <Input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="h-10"
                />
              </div>

              <p className="text-[11px] text-muted-foreground/60 -mt-1">
                Use the email address this invite was sent to.
              </p>

              {mode === "login" ? (
                <Button
                  className="w-full h-11 font-bold"
                  disabled={!username || !password || isPending}
                  onClick={() => loginMutation.mutate()}
                >
                  {isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <LogIn className="h-4 w-4 mr-2" />
                  )}
                  Log in & join team
                </Button>
              ) : (
                <Button
                  className="w-full h-11 font-bold"
                  disabled={!username || !password || isPending}
                  onClick={() => registerMutation.mutate()}
                >
                  {isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <UserPlus className="h-4 w-4 mr-2" />
                  )}
                  Create account & join team
                </Button>
              )}
            </div>
          )}
        </div>

        <p className="text-center text-xs text-muted-foreground/50 mt-4">
          DBrief App · Your performance data stays private
        </p>
      </div>
    </div>
  );
}
