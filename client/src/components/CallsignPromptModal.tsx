import { useState, useEffect } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, CheckCircle2, XCircle, Radio } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const SNOOZE_KEY = "callsign_snoozed_until";
const SNOOZE_DAYS = 7;

function sanitize(raw: string) {
  return raw.toLowerCase().replace(/^@/, "").replace(/[^a-z0-9_]/g, "");
}

function isSnoozed() {
  try {
    const until = Number(localStorage.getItem(SNOOZE_KEY));
    return until && Date.now() < until;
  } catch { return false; }
}

function snooze() {
  try {
    localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_DAYS * 86_400_000));
  } catch {}
}

export default function CallsignPromptModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const [handle, setHandle] = useState("");
  const [status, setStatus] = useState<"idle" | "checking" | "available" | "taken" | "invalid">("idle");

  // Debounced availability check
  useEffect(() => {
    const clean = sanitize(handle);
    if (!clean) { setStatus("idle"); return; }
    if (clean.length < 3) { setStatus("invalid"); return; }

    setStatus("checking");
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/users/check-handle?handle=${encodeURIComponent(clean)}`);
        const { available } = await r.json();
        setStatus(available ? "available" : "taken");
      } catch { setStatus("idle"); }
    }, 450);
    return () => clearTimeout(t);
  }, [handle]);

  const saveMutation = useMutation({
    mutationFn: async (driverHandle: string) => {
      const r = await apiRequest("PATCH", "/api/me/settings", { driverHandle });
      return r.json();
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/auth/me"], (prev: any) => ({ ...prev, driverHandle: data.driverHandle }));
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      toast({ title: "Callsign locked in", description: `You're now @${data.driverHandle}` });
      onClose();
    },
    onError: () => {
      toast({ title: "Couldn't save callsign", description: "Try a different handle.", variant: "destructive" });
    },
  });

  const canSave = status === "available" && sanitize(handle).length >= 3;

  function handleSave() {
    if (!canSave) return;
    saveMutation.mutate(sanitize(handle));
  }

  function handleLater() {
    snooze();
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleLater(); }}>
      <DialogContent
        className="max-w-sm mx-auto rounded-2xl border-border/50 bg-card p-0 overflow-hidden"
        hideClose
      >
        {/* Amber header stripe */}
        <div className="bg-primary/10 px-6 pt-6 pb-4 border-b border-primary/20">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center">
              <Radio className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h2 className="font-bold text-foreground text-base leading-tight">Choose your Driver Callsign</h2>
              <p className="text-xs text-muted-foreground">Your unique identity on DBrief</p>
            </div>
          </div>
        </div>

        <div className="px-6 py-5 space-y-5">
          <p className="text-sm text-muted-foreground leading-relaxed">
            Your callsign is how crew members find and connect with you on the{" "}
            <span className="text-foreground font-medium">Team</span> tab. Without one, you're invisible to search — no one can send you a connection request.
          </p>

          <div className="space-y-2">
            <Label htmlFor="callsign-input" className="text-xs font-medium text-muted-foreground">
              Driver Callsign
            </Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium text-muted-foreground pointer-events-none select-none">@</span>
              <Input
                id="callsign-input"
                className="pl-7 pr-8 font-mono text-sm"
                placeholder="your_handle"
                value={handle}
                onChange={e => setHandle(e.target.value)}
                maxLength={20}
                autoCapitalize="none"
                autoCorrect="off"
                autoComplete="off"
                spellCheck={false}
                onKeyDown={e => { if (e.key === "Enter" && canSave) handleSave(); }}
              />
              <div className="absolute right-2.5 top-1/2 -translate-y-1/2">
                {status === "checking" && <Loader2 className="h-3.5 w-3.5 text-muted-foreground animate-spin" />}
                {status === "available" && <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />}
                {(status === "taken" || status === "invalid") && <XCircle className="h-3.5 w-3.5 text-destructive" />}
              </div>
            </div>
            {status === "taken" && <p className="text-xs text-destructive">That callsign is already taken — try another.</p>}
            {status === "invalid" && handle.length > 0 && (
              <p className="text-xs text-destructive">Minimum 3 characters — lowercase letters, numbers and underscores only.</p>
            )}
            {status === "available" && <p className="text-xs text-green-600 dark:text-green-400">@{sanitize(handle)} is available</p>}
            {status === "idle" && !handle && (
              <p className="text-xs text-muted-foreground">Lowercase letters, numbers, underscores. 3–20 characters.</p>
            )}
          </div>

          <Button
            className="w-full font-semibold"
            disabled={!canSave || saveMutation.isPending}
            onClick={handleSave}
          >
            {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Lock in my callsign
          </Button>

          <button
            onClick={handleLater}
            className="w-full text-center text-xs text-muted-foreground hover:text-foreground transition-colors py-1"
          >
            Maybe later — remind me in {SNOOZE_DAYS} days
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
