import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Mic, Users, BarChart2, Flag, Target, Zap, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { haptic } from "@/lib/haptics";
import { Capacitor } from "@capacitor/core";
import { Browser } from "@capacitor/browser";
import { queryClient } from "@/lib/queryClient";

interface PaywallModalProps {
  isOpen: boolean;
  onClose: () => void;
  featureName?: string;
}

const PREMIUM_FEATURES = [
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

  // Personalised Stripe Checkout Session URL — fetched fresh each time the modal
  // opens so it's tied to THIS user's Stripe customer ID. Both paths (native +
  // web) use this endpoint, keeping the webhook / sync logic consistent.
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const [linkLoading, setLinkLoading] = useState(false);
  const [fetchError, setFetchError] = useState(false);
  const [tapped, setTapped] = useState(false);

  const browserListenerRef = useRef<{ remove: () => void } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // visibilitychange listener ref — fires when SFSafariViewController is dismissed
  // (swipe-down or any other dismissal). This is the primary return mechanism.
  const visibilityListenerRef = useRef<(() => void) | null>(null);

  // Fetch a personalised checkout session URL each time the modal opens.
  useEffect(() => {
    if (!isOpen) return;
    setLinkLoading(true);
    setCheckoutUrl(null);
    setFetchError(false);
    setTapped(false);
    fetch("/api/subscription/checkout", {
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
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  function removeVisibilityListener() {
    if (visibilityListenerRef.current) {
      document.removeEventListener("visibilitychange", visibilityListenerRef.current);
      visibilityListenerRef.current = null;
    }
  }

  async function handlePremiumDetected() {
    stopPolling();
    removeVisibilityListener();
    browserListenerRef.current?.remove();
    browserListenerRef.current = null;
    try { await Browser.close(); } catch (_) {}
    try { await fetch("/api/subscription/sync", { method: "POST" }); } catch (_) {}
    queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    queryClient.invalidateQueries({ queryKey: ["/api/subscription/status"] });
    toast({
      title: "Welcome to DBrief Premium",
      description: "Your features are now unlocked. Full throttle.",
    });
    setTapped(false);
    onClose();
  }

  function startPolling() {
    stopPolling();
    const deadline = Date.now() + 5 * 60 * 1000;
    pollRef.current = setInterval(async () => {
      if (Date.now() > deadline) { stopPolling(); return; }
      try {
        const me = await fetch("/api/auth/me").then(r => r.json());
        if (me.subscriptionStatus === "premium" || me.subscriptionStatus === "beta") {
          handlePremiumDetected();
        }
      } catch (_) {}
    }, 4000);
  }

  useEffect(() => {
    if (!isOpen) {
      browserListenerRef.current?.remove();
      browserListenerRef.current = null;
      stopPolling();
      removeVisibilityListener();
    }
  }, [isOpen]);

  useEffect(() => {
    return () => {
      browserListenerRef.current?.remove();
      stopPolling();
      removeVisibilityListener();
    };
  }, []);

  // Native checkout: opens the Stripe Checkout page in an in-app SFSafariViewController
  // (iOS) / Chrome Custom Tab (Android). The WKWebView stays alive underneath —
  // no backgrounding, no iOS snapshot, no white safe-area bands on return.
  // Apple Pay works because SFSafariViewController shares Safari's full capabilities.
  async function handleNativeCheckout() {
    if (!checkoutUrl || tapped) return;
    haptic("medium");
    setTapped(true);

    browserListenerRef.current?.remove();
    removeVisibilityListener();

    // PRIMARY: visibilitychange fires whenever SFSafariViewController is dismissed
    // by any means — swipe down, programmatic close, URL scheme, or Done button.
    // The WKWebView regains visibility and we check subscription status immediately.
    const onVisible = async () => {
      if (document.visibilityState !== "visible") return;
      removeVisibilityListener();
      stopPolling();
      // Brief delay to allow the SFSafariViewController dismiss animation to finish
      // and let any in-flight Stripe webhook reach our server first.
      await new Promise(r => setTimeout(r, 800));
      try {
        await fetch("/api/subscription/sync", { method: "POST" });
        const me = await fetch("/api/auth/me").then(r => r.json());
        if (me.subscriptionStatus === "premium" || me.subscriptionStatus === "beta") {
          handlePremiumDetected();
          return;
        }
      } catch (_) {}
      setTapped(false);
    };
    visibilityListenerRef.current = onVisible;
    document.addEventListener("visibilitychange", onVisible);

    try {
      // SECONDARY: browserFinished fires if the Browser plugin also fires it on dismiss.
      const listener = await Browser.addListener("browserFinished", async () => {
        listener.remove();
        browserListenerRef.current = null;
        // visibilitychange will also fire — let it handle the sync to avoid double-toast.
      });
      browserListenerRef.current = listener;
      await Browser.open({ url: checkoutUrl, presentationStyle: 'fullscreen' });
      // TERTIARY: poll so we can auto-close via Browser.close() if webhook fires fast.
      startPolling();
    } catch (_) {
      // Browser plugin failed — fall back to opening in the system browser.
      removeVisibilityListener();
      setTapped(false);
      window.location.href = checkoutUrl;
    }
  }

  // Web checkout: navigate the browser tab to Stripe's hosted checkout page.
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
          onClick={() => {
            setFetchError(false);
            setLinkLoading(true);
            setCheckoutUrl(null);
            fetch("/api/subscription/checkout", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ native: isNative }),
            })
              .then(r => r.json())
              .then(({ url }) => { if (url) setCheckoutUrl(url); else setFetchError(true); })
              .catch(() => setFetchError(true))
              .finally(() => setLinkLoading(false));
          }}
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
          {linkLoading ? "Loading checkout…" : tapped ? "Opening checkout…" : "Unlock Premium — £5.99 / month"}
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
              style={{ maxHeight: '92dvh', background: 'var(--background)' }}
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
                  <img src="/app-icon.png" alt="DBrief" className="w-14 h-14 object-contain rounded-xl" />
                </div>

                <h2 className="text-2xl font-black text-white tracking-tight">DBrief Premium</h2>

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
