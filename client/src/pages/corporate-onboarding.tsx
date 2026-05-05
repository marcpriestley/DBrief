import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Building2, Users, CreditCard, ArrowRight, Check, Loader2, ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useLocation } from "wouter";

const SEAT_OPTIONS = [
  { count: 5, label: "5 seats", priceMonthly: "£19.95", desc: "Small team" },
  { count: 10, label: "10 seats", priceMonthly: "£39.90", desc: "Growing team" },
  { count: 25, label: "25 seats", priceMonthly: "£99.75", desc: "Mid-size team" },
  { count: 50, label: "50 seats", priceMonthly: "£199.50", desc: "Large team" },
];

type Step = "org" | "seats" | "checkout";

export default function CorporateOnboarding() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, setLocation] = useLocation();
  const [step, setStep] = useState<Step>("org");
  const [orgName, setOrgName] = useState("");
  const [seatCount, setSeatCount] = useState(10);
  const [checkoutLoading, setCheckoutLoading] = useState(false);

  const { data: user } = useQuery<any>({ queryKey: ["/api/auth/me"] });

  const createOrg = useMutation({
    mutationFn: () => apiRequest("POST", "/api/corporate/org", { name: orgName.trim(), seatCount }).then(r => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/auth/me"] });
      qc.invalidateQueries({ queryKey: ["/api/corporate/membership"] });
      setStep("seats");
    },
    onError: (err: any) => {
      const msg = err?.message?.includes(":") ? err.message.split(":").slice(1).join(":").trim() : err.message;
      try { const p = JSON.parse(msg); toast({ title: p.message ?? msg, variant: "destructive" }); }
      catch { toast({ title: msg, variant: "destructive" }); }
    },
  });

  async function handleCheckout() {
    setCheckoutLoading(true);
    try {
      // Update seat count then checkout
      await apiRequest("PUT", "/api/corporate/org/settings", { seatCount });
      const res = await apiRequest("POST", "/api/corporate/checkout", {});
      const { url } = await res.json();
      if (url) window.location.href = url;
    } catch (err: any) {
      toast({ title: "Checkout failed", variant: "destructive" });
    } finally {
      setCheckoutLoading(false);
    }
  }

  if (!user) return null;

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-lg">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/15 mb-4">
            <Building2 className="h-7 w-7 text-primary" />
          </div>
          <h1 className="text-2xl font-black text-foreground tracking-tight">DBrief Corporate</h1>
          <p className="text-sm text-muted-foreground mt-1">Performance engineering for your whole team</p>
        </div>

        {/* Steps indicator */}
        <div className="flex items-center justify-center gap-2 mb-8">
          {(["org", "seats", "checkout"] as Step[]).map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                step === s ? "bg-primary text-primary-foreground" :
                (["org", "seats", "checkout"].indexOf(step) > i) ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"
              }`}>
                {(["org", "seats", "checkout"].indexOf(step) > i) ? <Check className="h-3.5 w-3.5" /> : i + 1}
              </div>
              {i < 2 && <div className={`w-8 h-0.5 rounded ${(["org", "seats", "checkout"].indexOf(step) > i) ? "bg-primary/40" : "bg-border"}`} />}
            </div>
          ))}
        </div>

        <motion.div
          key={step}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-card rounded-2xl border border-border/50 shadow-sm p-6"
        >
          {/* Step 1: Organisation name */}
          {step === "org" && (
            <div className="space-y-5">
              <div>
                <h2 className="text-lg font-bold text-foreground">Name your organisation</h2>
                <p className="text-sm text-muted-foreground mt-0.5">This appears on the team dashboard and in invites</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="org-name">Company / team name</Label>
                <Input
                  id="org-name"
                  value={orgName}
                  onChange={e => setOrgName(e.target.value)}
                  placeholder="Acme Racing Team"
                  className="h-11"
                  onKeyDown={e => e.key === "Enter" && orgName.trim().length >= 2 && createOrg.mutate()}
                />
              </div>
              <Button
                className="w-full h-11 font-bold"
                disabled={orgName.trim().length < 2 || createOrg.isPending}
                onClick={() => createOrg.mutate()}
              >
                {createOrg.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Continue <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </div>
          )}

          {/* Step 2: Seat selection */}
          {step === "seats" && (
            <div className="space-y-5">
              <div>
                <h2 className="text-lg font-bold text-foreground">Choose your seat plan</h2>
                <p className="text-sm text-muted-foreground mt-0.5">£3.99 per seat / month — cancel anytime</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {SEAT_OPTIONS.map(opt => (
                  <button
                    key={opt.count}
                    onClick={() => setSeatCount(opt.count)}
                    className={`p-3.5 rounded-xl border text-left transition-all ${
                      seatCount === opt.count
                        ? "border-primary bg-primary/5 shadow-sm"
                        : "border-border/50 bg-muted/30 hover:border-primary/30"
                    }`}
                  >
                    <div className="flex items-center gap-1.5 mb-1">
                      <Users className="h-3.5 w-3.5 text-primary" />
                      <span className="text-sm font-bold text-foreground">{opt.label}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">{opt.desc}</p>
                    <p className="text-sm font-semibold text-primary mt-1.5">{opt.priceMonthly}/mo</p>
                  </button>
                ))}
              </div>
              <Button className="w-full h-11 font-bold" onClick={() => setStep("checkout")}>
                Continue to payment <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
              <button onClick={() => setStep("org")} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mx-auto">
                <ChevronLeft className="h-3.5 w-3.5" /> Back
              </button>
            </div>
          )}

          {/* Step 3: Checkout */}
          {step === "checkout" && (
            <div className="space-y-5">
              <div>
                <h2 className="text-lg font-bold text-foreground">Review & pay</h2>
                <p className="text-sm text-muted-foreground mt-0.5">You'll be taken to Stripe for secure payment</p>
              </div>
              <div className="bg-muted/40 rounded-xl p-4 space-y-2.5">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Organisation</span>
                  <span className="font-medium text-foreground">{orgName}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Seats</span>
                  <span className="font-medium text-foreground">{seatCount}</span>
                </div>
                <div className="border-t border-border/50 pt-2 flex justify-between">
                  <span className="font-semibold text-foreground">Monthly total</span>
                  <span className="font-bold text-primary">£{(seatCount * 3.99).toFixed(2)}/mo</span>
                </div>
              </div>
              <Button
                className="w-full h-11 font-bold"
                onClick={handleCheckout}
                disabled={checkoutLoading}
              >
                {checkoutLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CreditCard className="h-4 w-4 mr-2" />}
                Proceed to Stripe Checkout
              </Button>
              <button onClick={() => setStep("seats")} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mx-auto">
                <ChevronLeft className="h-3.5 w-3.5" /> Back
              </button>
              <p className="text-center text-xs text-muted-foreground/60">Secure payment via Stripe · Cancel anytime</p>
            </div>
          )}
        </motion.div>
      </div>
    </div>
  );
}
