import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Mic, Users, BarChart2, Flag, Target, Zap, CheckCircle2, CircleDot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { haptic } from "@/lib/haptics";
import { Capacitor } from "@capacitor/core";
import { Browser } from "@capacitor/browser";
import { App as CapApp } from "@capacitor/app";
import { queryClient, resolveUrl} from "@/lib/queryClient";

interface PaywallModalProps {
  isOpen: boolean;
  onClose: () => void;
  featureName?: string;
}

const PREMIUM_FEATURES = [
  { icon: CircleDot, label: "Unlimited Metric Tracking", desc: "Track as many performance metrics as you need — free accounts are capped at 3" },
  { icon: Mic,       label: "Voice Notes",               desc: "Record unlimited audio debriefs" },
  { icon: Users,     label: "Team — Squad & Challenges", desc: "Connect with friends for accountability, leaderboards & group challenges" },
  { icon: Flag,      label: "Weekly Race Report",        desc: "AI-generated 7-day narrative debrief" },
  { icon: BarChart2, label: "Data Pattern Analysis",     desc: "30-day correlation insights across all metrics" },
  { icon: Target,    label: "Mission Intelligence",      desc: "90-day goal trajectory alignment with your Infinite Goal" },
  { icon: Zap,       label: "Live Voice Debrief",        desc: "Real-time AI conversation — coming soon" },
];

export default function PaywallModal({ isOpen, onClose, featureName }: PaywallModalProps) {
  const { toast } = useToast();
  const isNative = Capacitor.isNativePlatform();

  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const [linkLoading, setLinkLoading] = useState(false);
  const [fetchError, setFetchError] = useState(false);
  const [tapped, setTapped] = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const browserListenerRef = useRef<{ remove: () => void } | null>(null);

  // Fetch a personalised checkout session URL each time the modal opens.
  useEffect(() => {
    if (!isOpen) return;
    setLinkLoading(true);
    setCheckoutUrl(null);
    setFetchError(false);
    setTapped(false);
    fetch(resolveUrl("/api/subscription/checkout"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ native: isNative }),
    })
      .then(r => r.json())
      .then(({ url }) => {
        if (url) setCheckoutUrl(url);
        else setFetchError(true);
      })
      .catch(() => setFetchError(true))
      .finally(() => setLinkLoading(false));
  }, [isOpen, isNative]);

  function stopPolling() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }

  function handlePremiumDetected() {
    stopPolling();
    browserListenerRef.current?.remove();
    browserListenerRef.current = null;
    setTapped(false);
    // Optimistically update the cache BEFORE closing the modal so that any
    // premium-gated component that renders immediately after onClose() sees
    // isPremium: true and does NOT re-open the paywall.
    queryClient.setQueryData(["/api/auth/me"], (old: any) =>
      old ? { ...old, isPremium: true, subscriptionStatus: "premium" } : old
    );
    // Close the modal and dismiss the SFSafariViewController.
    onClose();
    Browser.close().catch(() => {});
    // Then kick off a real refetch so the full user object is up-to-date.
    queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    queryClient.invalidateQueries({ queryKey: ["/api/subscription/status"] });
    toast({
      title: "Welcome to DBrief App Premium",
      description: "Your features are now unlocked. Full throttle.",
    });
  }

  function startPolling() {
    stopPolling();
    // Poll every 3 s for up to 10 minutes.
    // The checkout-return page calls /api/subscription/checkout-signal which
    // instantly marks the user premium in the DB — so the first poll after
    // payment confirmation will detect it, typically within 3 seconds.
    const deadline = Date.now() + 10 * 60 * 1000;
    pollRef.current = setInterval(async () => {
      if (Date.now() > deadline) { stopPolling(); setTapped(false); return; }
      try {
        const me = await fetch(resolveUrl("/api/auth/me")).then(r => r.json());
        if (me.subscriptionStatus === "premium" || me.subscriptionStatus === "beta") {
          handlePremiumDetected();
        }
      } catch (_) {}
    }, 3000);
  }

  // When the dbrief:// URL scheme fires (iOS intercepts the checkout-return
  // redirect), the system closes SFSafariViewController and fires appUrlOpen.
  // We listen here so the modal closes immediately on that event, before
  // App.tsx's handler even runs — no polling tick needed.
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
    } catch (_) {
      // App plugin not registered in this native build — deep-link handling unavailable
    }
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

  // ── Native checkout ───────────────────────────────────────────────────────
  // Opens the full Stripe Checkout in SFSafariViewController (Apple Pay,
  // Klarna, card). The checkout-return page calls /api/subscription/checkout-signal
  // which syncs the subscription instantly, so the background poll detects
  // premium within 3 s and calls Browser.close() to return the user to the app.
  // Once the dbrief:// URL scheme is registered in Xcode, the checkout-return
  // page redirects to dbrief://checkout-done and iOS closes the browser
  // automatically — no polling or Browser.close() needed at all.
  async function handleNativeCheckout() {
    if (!checkoutUrl || tapped) return;
    haptic("medium");
    setTapped(true);
    // Mark a pending subscription in localStorage so that if WKWebView is
    // killed/restarted while Safari is open, App.tsx will sync on next launch.
    try { localStorage.setItem("dbrief_sub_pending", "1"); } catch (_) {}
    browserListenerRef.current?.remove();
    try {
      const listener = await Browser.addListener("browserFinished", async () => {
        listener.remove();
        browserListenerRef.current = null;
        stopPolling();
        setTapped(false);
        // User closed the in-app browser (tapped native "Done" button, or the
        // deep-link wasn't registered so auto-return didn't fire).
        // checkout-return page calls checkout-signal BEFORE showing the "Done"
        // hint, so the DB should already be updated. Retry up to 4 times
        // (0 s, 2 s, 4 s, 8 s) to handle the race where Done is tapped before
        // checkout-signal has finished writing to the DB.
        const checkPremium = async (): Promise<boolean> => {
          try {
            await fetch(resolveUrl("/api/subscription/sync"), { method: "POST" }).catch(() => {});
            const me = await fetch(resolveUrl("/api/auth/me")).then(r => r.json());
            if (me.subscriptionStatus === "premium" || me.subscriptionStatus === "beta") {
              try { localStorage.removeItem("dbrief_sub_pending"); } catch (_) {}
              handlePremiumDetected();
              return true;
            }
          } catch (_) {}
          return false;
        };
        if (!(await checkPremium())) {
          // Retry with back-off — covers the race where Done fires before
          // the checkout-signal API call has finished updating the DB.
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

  // ── Web checkout ──────────────────────────────────────────────────────────
  async function handleWebSubscribe() {
    haptic("medium");
    if (!checkoutUrl || tapped) return;
    setTapped(true);
    onClose();
    window.location.href = checkoutUrl;
  }

  function fetchCheckoutUrl() {
    setFetchError(false);
    setLinkLoading(true);
    setCheckoutUrl(null);
    fetch(resolveUrl("/api/subscription/checkout"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ native: isNative }),
    })
      .then(r => r.json())
      .then(({ url }) => { if (url) setCheckoutUrl(url); else setFetchError(true); })
      .catch(() => setFetchError(true))
      .finally(() => setLinkLoading(false));
  }

  function renderCTA() {
    if (fetchError) {
      return (
        <Button
          className="w-full h-12 text-base font-bold rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg"
          onClick={fetchCheckoutUrl}
        >
          Tap to retry
        </Button>
      );
    }
    if (isNative) {
      return (
        <Button
          className="w-full h-12 text-base font-bold rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg"
          onClick={handleNativeCheckout}
          disabled={linkLoading || !checkoutUrl || tapped}
        >
          {linkLoading ? "Loading…" : tapped ? "Opening checkout…" : "Unlock Premium — £5.99 / month"}
        </Button>
      );
    }
    return (
      <Button
        className="w-full h-12 text-base font-bold rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg"
        onClick={handleWebSubscribe}
        disabled={tapped || linkLoading || !checkoutUrl}
      >
        {tapped || linkLoading ? "Opening checkout…" : "Unlock Premium — £5.99 / month"}
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

                <div className="mt-4 flex items-end justify-center gap-1">
                  <span className="text-4xl font-black text-white leading-none">£5.99</span>
                  <span className="text-sm text-amber-200 mb-1">/ month</span>
                </div>

                <p className="mt-1.5 text-xs text-amber-200/70">Cancel anytime · No minimum term</p>
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
                  Apple Pay · Card · Klarna · and more
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
