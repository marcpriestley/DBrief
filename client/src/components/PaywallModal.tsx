import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Mic, Users, BarChart2, Flag, Target, Zap, CheckCircle2, CircleDot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { haptic } from "@/lib/haptics";
import { Capacitor } from "@capacitor/core";
import { Browser } from "@capacitor/browser";
import { App as CapApp } from "@capacitor/app";
import { queryClient, resolveUrl } from "@/lib/queryClient";

function getAuthTokenPayload(): { userId?: number; checkoutToken?: string } {
  try {
    const me = queryClient.getQueryData<any>(["/api/auth/me"]);
    if (me?.id && me?.checkoutToken) {
      return { userId: me.id, checkoutToken: me.checkoutToken };
    }
  } catch (_) {}
  return {};
}

interface PaywallModalProps {
  isOpen: boolean;
  onClose: () => void;
  featureName?: string;
}

type Plan = "monthly" | "annual";

const PREMIUM_FEATURES = [
  { icon: CircleDot, label: "Unlimited Metric Tracking", desc: "Track as many performance metrics as you need — free accounts are capped at 3" },
  { icon: Mic,       label: "Voice Notes",               desc: "Record unlimited audio debriefs" },
  { icon: Users,     label: "Team — Squad & Challenges", desc: "Connect with friends for accountability, leaderboards & group challenges" },
  { icon: Flag,      label: "Weekly Race Report",        desc: "AI-generated 7-day narrative debrief" },
  { icon: BarChart2, label: "Data Pattern Analysis",     desc: "30-day correlation insights across all metrics" },
  { icon: Target,    label: "Mission Intelligence",      desc: "90-day goal trajectory alignment with your Infinite Goal" },
  { icon: Zap,       label: "Live Voice Debrief",        desc: "Real-time AI conversation — coming soon" },
];

function getPaymentMethods(): string {
  const ua = navigator.userAgent.toLowerCase();
  const isAndroid = ua.includes("android");
  const isIOS = /iphone|ipad|ipod/.test(ua);
  if (isAndroid) return "Card · Google Pay · and more";
  if (isIOS) return "Apple Pay · Card · Klarna · and more";
  return "Card · Apple Pay · Google Pay · and more";
}

export default function PaywallModal({ isOpen, onClose, featureName }: PaywallModalProps) {
  const { toast } = useToast();
  const isNative = Capacitor.isNativePlatform();

  const [plan, setPlan] = useState<Plan>("monthly");
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const [linkLoading, setLinkLoading] = useState(false);
  const [fetchError, setFetchError] = useState(false);
  const [tapped, setTapped] = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const browserListenerRef = useRef<{ remove: () => void } | null>(null);

  async function _doCheckoutFetch(selectedPlan: Plan): Promise<string | null> {
    const authPayload = getAuthTokenPayload();
    const r = await fetch(resolveUrl("/api/subscription/checkout"), {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ native: isNative, plan: selectedPlan, ...authPayload }),
    });
    if (!r.ok) return null;
    const { url } = await r.json();
    return url ?? null;
  }

  function fetchCheckoutUrl(selectedPlan: Plan) {
    setFetchError(false);
    setLinkLoading(true);
    setCheckoutUrl(null);

    // Android WebView's cookie store for cross-origin session cookies can take a moment
    // to become available after login. Retry silently up to 3 times before surfacing
    // an error to the user.
    const delays = [0, 1200, 2500];
    let attempt = 0;

    const tryFetch = async () => {
      const delay = delays[attempt] ?? 0;
      if (delay > 0) await new Promise(res => setTimeout(res, delay));
      try {
        const url = await _doCheckoutFetch(selectedPlan);
        if (url) {
          setCheckoutUrl(url);
          setLinkLoading(false);
          return;
        }
      } catch (_) {}
      attempt++;
      if (attempt < delays.length) {
        tryFetch();
      } else {
        setFetchError(true);
        setLinkLoading(false);
      }
    };

    tryFetch();
  }

  useEffect(() => {
    if (!isOpen) return;
    setCheckoutUrl(null);
    setFetchError(false);
    setTapped(false);
    fetchCheckoutUrl(plan);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    setTapped(false);
    fetchCheckoutUrl(plan);
  }, [plan]);

  function stopPolling() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }

  function handlePremiumDetected() {
    stopPolling();
    browserListenerRef.current?.remove();
    browserListenerRef.current = null;
    setTapped(false);
    queryClient.setQueryData(["/api/auth/me"], (old: any) =>
      old ? { ...old, isPremium: true, subscriptionStatus: "premium" } : old
    );
    onClose();
    Browser.close().catch(() => {});
    queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    queryClient.invalidateQueries({ queryKey: ["/api/subscription/status"] });
    toast({
      title: "Welcome to DBrief App Premium",
      description: "Your features are now unlocked. Full throttle.",
    });
  }

  function startPolling() {
    stopPolling();
    const deadline = Date.now() + 10 * 60 * 1000;
    pollRef.current = setInterval(async () => {
      if (Date.now() > deadline) { stopPolling(); setTapped(false); return; }
      try {
        const me = await fetch(resolveUrl("/api/auth/me"), { credentials: "include" }).then(r => r.json());
        if (me.subscriptionStatus === "premium" || me.subscriptionStatus === "beta") {
          handlePremiumDetected();
        }
      } catch (_) {}
    }, 3000);
  }

  useEffect(() => {
    if (!isOpen || !isNative) return;
    let listener: { remove: () => void } | null = null;
    try {
      CapApp.addListener("appUrlOpen", (event) => {
        if (event.url.includes("checkout-done") && event.url.includes("result=success")) {
          listener?.remove();
          stopPolling();
          browserListenerRef.current?.remove();
          browserListenerRef.current = null;
          setTapped(false);
          queryClient.setQueryData(["/api/auth/me"], (old: any) =>
            old ? { ...old, isPremium: true, subscriptionStatus: "premium" } : old
          );
          onClose();
          queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
          queryClient.invalidateQueries({ queryKey: ["/api/subscription/status"] });
        }
      }).then(h => { listener = h; }).catch(() => {});
    } catch (_) {}
    return () => { listener?.remove(); };
  }, [isOpen, isNative]);

  useEffect(() => {
    if (!isOpen) {
      browserListenerRef.current?.remove();
      browserListenerRef.current = null;
      stopPolling();
    }
  }, [isOpen]);

  useEffect(() => {
    return () => {
      browserListenerRef.current?.remove();
      stopPolling();
    };
  }, []);

  async function handleNativeCheckout() {
    if (!checkoutUrl || tapped) return;
    haptic("medium");
    setTapped(true);
    try { localStorage.setItem("dbrief_sub_pending", "1"); } catch (_) {}
    browserListenerRef.current?.remove();
    try {
      const listener = await Browser.addListener("browserFinished", async () => {
        listener.remove();
        browserListenerRef.current = null;
        stopPolling();
        setTapped(false);
        const checkPremium = async (): Promise<boolean> => {
          try {
            await fetch(resolveUrl("/api/subscription/sync"), { method: "POST", credentials: "include" }).catch(() => {});
            const me = await fetch(resolveUrl("/api/auth/me"), { credentials: "include" }).then(r => r.json());
            if (me.subscriptionStatus === "premium" || me.subscriptionStatus === "beta") {
              try { localStorage.removeItem("dbrief_sub_pending"); } catch (_) {}
              handlePremiumDetected();
              return true;
            }
          } catch (_) {}
          return false;
        };
        if (!(await checkPremium())) {
          const delays = [2000, 4000, 8000];
          for (const delay of delays) {
            await new Promise(r => setTimeout(r, delay));
            if (await checkPremium()) break;
          }
        }
      });
      browserListenerRef.current = listener;
      await Browser.open({ url: checkoutUrl, presentationStyle: "fullscreen" });
      startPolling();
    } catch (_) {
      setTapped(false);
      window.location.href = checkoutUrl;
    }
  }

  async function handleWebSubscribe() {
    haptic("medium");
    if (!checkoutUrl || tapped) return;
    setTapped(true);
    onClose();
    window.location.href = checkoutUrl;
  }

  function renderCTA() {
    if (fetchError) {
      return (
        <Button
          className="w-full h-12 text-base font-bold rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg"
          onClick={() => fetchCheckoutUrl(plan)}
        >
          Tap to retry
        </Button>
      );
    }
    const label = plan === "annual"
      ? (linkLoading ? "Loading…" : tapped ? "Opening checkout…" : "Unlock Premium — £49.99 / year")
      : (linkLoading ? "Loading…" : tapped ? "Opening checkout…" : "Unlock Premium — £5.99 / month");

    if (isNative) {
      return (
        <Button
          className="w-full h-12 text-base font-bold rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg"
          onClick={handleNativeCheckout}
          disabled={linkLoading || !checkoutUrl || tapped}
        >
          {label}
        </Button>
      );
    }
    return (
      <Button
        className="w-full h-12 text-base font-bold rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg"
        onClick={handleWebSubscribe}
        disabled={tapped || linkLoading || !checkoutUrl}
      >
        {label}
      </Button>
    );
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            className="fixed inset-0 z-[200] bg-black/70 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />

          <motion.div
            className="fixed inset-x-0 bottom-0 z-[201] flex flex-col"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 300 }}
            style={{ maxHeight: '92dvh' }}
          >
            <div
              className="relative mx-auto w-full max-w-lg rounded-t-3xl overflow-hidden flex flex-col"
              style={{ maxHeight: '92dvh', background: 'hsl(var(--background))' }}
            >
              {/* Amber header gradient */}
              <div
                className="relative px-6 pt-8 pb-6 text-center flex-shrink-0"
                style={{ background: 'linear-gradient(160deg, #78350f 0%, #b45309 40%, #d97706 100%)' }}
              >
                <button onClick={onClose} className="absolute top-4 right-4 text-amber-200/70 hover:text-white transition-colors">
                  <X className="h-5 w-5" />
                </button>

                <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-white/15 backdrop-blur mb-3 overflow-hidden">
                  <img src="/app-icon.png" alt="DBrief App" className="w-14 h-14 object-contain rounded-xl" />
                </div>

                <h2 className="text-2xl font-black text-white tracking-tight">DBrief App Premium</h2>

                {featureName && (
                  <p className="mt-1 text-sm text-amber-200/90">
                    Unlock <span className="font-semibold">{featureName}</span> and more
                  </p>
                )}

                <div className="mt-3 inline-flex items-center gap-1.5 bg-white/20 backdrop-blur rounded-full px-3 py-1">
                  <span className="text-xs font-bold text-amber-100 uppercase tracking-widest">
                    Introductory offer — limited time
                  </span>
                </div>

                {/* Plan toggle */}
                <div className="mt-4 flex items-center justify-center gap-2">
                  <button
                    onClick={() => setPlan("monthly")}
                    className={`px-4 py-1.5 rounded-full text-sm font-bold transition-all ${
                      plan === "monthly"
                        ? "bg-white text-amber-900"
                        : "bg-white/20 text-amber-100 hover:bg-white/30"
                    }`}
                  >
                    Monthly
                  </button>
                  <button
                    onClick={() => setPlan("annual")}
                    className={`relative px-4 py-1.5 rounded-full text-sm font-bold transition-all ${
                      plan === "annual"
                        ? "bg-white text-amber-900"
                        : "bg-white/20 text-amber-100 hover:bg-white/30"
                    }`}
                  >
                    Annual
                    <span className="absolute -top-2 -right-2 bg-green-400 text-green-900 text-[9px] font-black px-1.5 py-0.5 rounded-full uppercase tracking-wide">
                      -30%
                    </span>
                  </button>
                </div>

                {plan === "monthly" ? (
                  <div className="mt-3 flex items-end justify-center gap-1">
                    <span className="text-4xl font-black text-white leading-none">£5.99</span>
                    <span className="text-sm text-amber-200 mb-1">/ month</span>
                  </div>
                ) : (
                  <div className="mt-3 flex items-end justify-center gap-1">
                    <span className="text-4xl font-black text-white leading-none">£49.99</span>
                    <span className="text-sm text-amber-200 mb-1">/ year</span>
                  </div>
                )}

                <p className="mt-1.5 text-xs text-amber-200/70">
                  {plan === "annual"
                    ? "Equivalent to £4.17/month · Save ~30% · Cancel anytime"
                    : "Cancel anytime · No minimum term"}
                </p>
              </div>

              {/* Features list */}
              <div className="flex-1 overflow-y-auto px-6 py-4">
                <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-4">What's included</p>
                <div className="space-y-3">
                  {PREMIUM_FEATURES.map(({ icon: Icon, label, desc }) => (
                    <div key={label} className="flex items-start gap-3">
                      <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center mt-0.5">
                        <Icon className="h-4 w-4 text-primary" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-foreground leading-tight">{label}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
                      </div>
                      <CheckCircle2 className="h-4 w-4 text-primary flex-shrink-0 mt-1 ml-auto" />
                    </div>
                  ))}
                </div>
              </div>

              {/* CTA footer */}
              <div
                className="px-6 pb-8 pt-4 flex-shrink-0 border-t border-border/40"
                style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 2rem)' }}
              >
                {renderCTA()}
                <p className="text-center text-[11px] text-muted-foreground/60 mt-2">
                  {getPaymentMethods()}
                </p>
                <button
                  onClick={onClose}
                  className="w-full mt-2 text-sm text-muted-foreground hover:text-foreground transition-colors py-1"
                >
                  Maybe later
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
