import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Mic, Users, BarChart2, Flag, Target, Zap, CheckCircle2, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { haptic } from "@/lib/haptics";
import { Capacitor } from "@capacitor/core";
import { queryClient } from "@/lib/queryClient";
import { EmbeddedCheckout, EmbeddedCheckoutProvider } from "@stripe/react-stripe-js";
import { loadStripe, type Stripe } from "@stripe/stripe-js";

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

// Module-level Stripe promise — initialised once when the publishable key arrives.
let stripePromise: Promise<Stripe | null> | null = null;

export default function PaywallModal({ isOpen, onClose, featureName }: PaywallModalProps) {
  const { toast } = useToast();
  const isNative = Capacitor.isNativePlatform();

  // Web checkout: personalised session URL fetched on modal open.
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const [linkLoading, setLinkLoading] = useState(false);
  const [fetchError, setFetchError] = useState(false);
  const [tapped, setTapped] = useState(false);

  // Native embedded checkout state.
  const [embeddedClientSecret, setEmbeddedClientSecret] = useState<string | null>(null);
  const [showEmbedded, setShowEmbedded] = useState(false);
  const [embeddedLoading, setEmbeddedLoading] = useState(false);

  // Fetch checkout data each time the modal opens.
  useEffect(() => {
    if (!isOpen) return;
    setFetchError(false);
    setTapped(false);
    setShowEmbedded(false);
    setEmbeddedClientSecret(null);

    if (isNative) {
      // Native: pre-fetch the Stripe publishable key so stripePromise is ready.
      if (!stripePromise) {
        fetch("/api/stripe/config")
          .then(r => r.json())
          .then(({ publishableKey }) => {
            if (publishableKey) stripePromise = loadStripe(publishableKey);
          })
          .catch(() => {});
      }
    } else {
      // Web: fetch a personalised hosted-checkout session URL.
      setLinkLoading(true);
      setCheckoutUrl(null);
      fetch("/api/subscription/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ native: false }),
      })
        .then(r => r.json())
        .then(({ url }) => {
          if (url) setCheckoutUrl(url);
          else setFetchError(true);
        })
        .catch(() => setFetchError(true))
        .finally(() => setLinkLoading(false));
    }
  }, [isOpen, isNative]);

  // ── Native: open embedded Stripe checkout inside the app ─────────────────
  async function handleNativeCheckout() {
    if (embeddedLoading || showEmbedded) return;
    haptic("medium");
    setEmbeddedLoading(true);
    try {
      // Ensure publishable key / stripePromise is ready.
      if (!stripePromise) {
        const { publishableKey } = await fetch("/api/stripe/config").then(r => r.json());
        stripePromise = loadStripe(publishableKey);
      }
      // Create an embedded checkout session — returns a clientSecret.
      const { clientSecret, message } = await fetch("/api/subscription/checkout-embedded", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }).then(r => r.json());

      if (!clientSecret) throw new Error(message ?? "No client secret returned");
      setEmbeddedClientSecret(clientSecret);
      setShowEmbedded(true);
    } catch (err: any) {
      toast({ title: "Couldn't start checkout", description: "Please try again.", variant: "destructive" });
    } finally {
      setEmbeddedLoading(false);
    }
  }

  // ── Web: navigate to hosted Stripe checkout page ─────────────────────────
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
              body: JSON.stringify({ native: false }),
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
          disabled={embeddedLoading}
        >
          {embeddedLoading ? "Loading checkout…" : "Unlock Premium — £5.99 / month"}
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
    <>
      {/* ── Native embedded checkout overlay ── */}
      <AnimatePresence>
        {isNative && showEmbedded && embeddedClientSecret && stripePromise && (
          <motion.div
            className="fixed inset-0 z-[300] flex flex-col bg-white"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 300 }}
          >
            {/* Header */}
            <div
              className="flex items-center px-4 py-3 border-b border-gray-200 bg-white flex-shrink-0"
              style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 0.75rem)' }}
            >
              <button
                onClick={() => { setShowEmbedded(false); setEmbeddedClientSecret(null); }}
                className="flex items-center gap-1.5 text-amber-600 font-semibold text-sm"
              >
                <ArrowLeft className="h-4 w-4" />
                Back
              </button>
              <span className="flex-1 text-center text-sm font-bold text-gray-900">DBrief Premium</span>
              <div className="w-16" />
            </div>

            {/* Stripe embedded checkout form */}
            <div className="flex-1 overflow-y-auto">
              <EmbeddedCheckoutProvider
                stripe={stripePromise}
                options={{ clientSecret: embeddedClientSecret }}
              >
                <EmbeddedCheckout />
              </EmbeddedCheckoutProvider>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Paywall slide-up sheet ── */}
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
                    {isNative ? "Card · and more" : "Apple Pay · Card · Klarna · and more"}
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
    </>
  );
}
