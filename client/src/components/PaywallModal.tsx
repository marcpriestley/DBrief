import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Mic, Users, BarChart2, Flag, Target, Zap, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { haptic } from "@/lib/haptics";
import { queryClient } from "@/lib/queryClient";
import { Capacitor } from "@capacitor/core";

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
  const [loading, setLoading] = useState(false);

  // On native (iOS + Android), pre-fetch the checkout URL the moment the modal
  // opens so it's ready before the user taps "Subscribe".
  // Both WKWebView (iOS) and Android WebView block window.open() when called after
  // an async operation — the "user gesture" trust expires at the first await.
  // Pre-fetching means we can call window.open() synchronously on the tap.
  const [prefetchedUrl, setPrefetchedUrl] = useState<string | null>(null);
  const [prefetchError, setPrefetchError] = useState(false);

  useEffect(() => {
    if (!isOpen || !Capacitor.isNativePlatform()) return;
    setPrefetchedUrl(null);
    setPrefetchError(false);
    apiRequest("POST", "/api/subscription/checkout", { native: true })
      .then(r => r.json())
      .then(({ url }) => {
        if (url) setPrefetchedUrl(url);
        else setPrefetchError(true);
      })
      .catch(() => setPrefetchError(true));
  }, [isOpen]);

  // Shared post-checkout handler: called when user returns from Safari/Stripe.
  function listenForReturn() {
    const onVisible = async () => {
      if (document.visibilityState !== 'visible') return;
      document.removeEventListener('visibilitychange', onVisible);
      // Small delay to let webhook processing finish on the server
      await new Promise(r => setTimeout(r, 1500));
      const syncRes = await fetch("/api/subscription/sync", { method: "POST" });
      const { isPremium: nowPremium } = await syncRes.json();
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      if (nowPremium) {
        toast({
          title: "Welcome to DBrief Premium",
          description: "Your features are now unlocked. Full throttle.",
        });
      }
    };
    document.addEventListener('visibilitychange', onVisible);
  }

  function handleSubscribe() {
    haptic("medium");

    if (Capacitor.isNativePlatform()) {
      if (prefetchError) {
        toast({ title: "Checkout unavailable", description: "Please try again shortly.", variant: "destructive" });
        return;
      }
      if (!prefetchedUrl) return; // still loading — button is disabled, safety net only

      // Navigate the main WKWebView to Stripe — stays in-app, no popup blocker.
      // After payment Stripe redirects to /checkout-return which redirects back
      // to capacitor://localhost/?subscription=success, reloading the native app.
      const url = prefetchedUrl;
      setPrefetchedUrl(null); // single-use
      onClose();
      window.location.href = url;
      return;
    }

    // Web flow: fetch URL then navigate the current window to Stripe.
    // Stripe redirects back to /?subscription=success which App.tsx handles.
    setLoading(true);
    apiRequest("POST", "/api/subscription/checkout", {})
      .then(r => r.json())
      .then(({ url, message }) => {
        if (!url) {
          toast({ title: message ?? "Checkout unavailable", description: "Please try again shortly.", variant: "destructive" });
          return;
        }
        onClose();
        window.location.href = url;
      })
      .catch((err: any) => {
        toast({ title: "Checkout failed", description: err.message ?? "Please try again.", variant: "destructive" });
      })
      .finally(() => setLoading(false));
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            className="fixed inset-0 z-[200] bg-black/70 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />

          {/* Modal */}
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
                style={{
                  background: 'linear-gradient(160deg, #78350f 0%, #b45309 40%, #d97706 100%)',
                }}
              >
                <button
                  onClick={onClose}
                  className="absolute top-4 right-4 text-amber-200/70 hover:text-white transition-colors"
                >
                  <X className="h-5 w-5" />
                </button>

                {/* DBrief logo */}
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-white/15 backdrop-blur mb-3 overflow-hidden">
                  <img
                    src="/app-icon.png"
                    alt="DBrief"
                    className="w-14 h-14 object-contain rounded-xl"
                  />
                </div>

                <h2 className="text-2xl font-black text-white tracking-tight">DBrief Premium</h2>

                {featureName && (
                  <p className="mt-1 text-sm text-amber-200/90">
                    Unlock <span className="font-semibold">{featureName}</span> and more
                  </p>
                )}

                {/* Introductory badge */}
                <div className="mt-3 inline-flex items-center gap-1.5 bg-white/20 backdrop-blur rounded-full px-3 py-1">
                  <span className="text-xs font-bold text-amber-100 uppercase tracking-widest">
                    Introductory offer — limited time
                  </span>
                </div>

                {/* Price */}
                <div className="mt-4 flex items-end justify-center gap-1">
                  <span className="text-4xl font-black text-white leading-none">£5.99</span>
                  <span className="text-sm text-amber-200 mb-1">/ month</span>
                </div>

                {/* Cancel anytime */}
                <p className="mt-1.5 text-xs text-amber-200/70">
                  Cancel anytime · No minimum term
                </p>
              </div>

              {/* Features list — scrollable */}
              <div className="flex-1 overflow-y-auto px-6 py-4">
                <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-4">
                  What's included
                </p>
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
                <Button
                  className="w-full h-12 text-base font-bold rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg"
                  onClick={handleSubscribe}
                  disabled={loading || (Capacitor.isNativePlatform() && !prefetchedUrl && !prefetchError)}
                >
                  {loading ? "Opening checkout…" : "Unlock Premium — £5.99 / month"}
                </Button>
                <p className="text-center text-[11px] text-muted-foreground/60 mt-2">
                  Have a promo code? Enter it on the next screen.
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
