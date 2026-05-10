import { useEffect, useState, useCallback } from "react";
import { loadStripe } from "@stripe/stripe-js";
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from "@stripe/react-stripe-js";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { apiRequest, queryClient, resolveUrl} from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

// Stripe instance — initialised lazily with the publishable key from the server.
let stripePromise: ReturnType<typeof loadStripe> | null = null;

async function getStripe() {
  if (!stripePromise) {
    const res = await fetch(resolveUrl("/api/subscription/publishable-key");
    const { publishableKey } = await res.json();
    stripePromise = loadStripe(publishableKey);
  }
  return stripePromise;
}

export default function StripeCheckoutModal({ isOpen, onClose }: Props) {
  const { toast } = useToast();
  const [stripe, setStripe] = useState<ReturnType<typeof loadStripe> | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Pre-load Stripe.js as soon as the modal mounts.
  useEffect(() => {
    getStripe().then(setStripe).catch(() => setError("Could not load payment form."));
  }, []);

  // fetchClientSecret is called by EmbeddedCheckoutProvider each time a new
  // session is needed (including re-opens).
  const fetchClientSecret = useCallback(async () => {
    const res = await apiRequest("POST", "/api/subscription/checkout-embedded", {});
    const data = await res.json();
    if (!data.clientSecret) throw new Error(data.message ?? "No client secret");
    return data.clientSecret;
  }, []);

  // Called by Stripe when the payment is confirmed and the user sees the
  // success screen inside the embedded checkout iframe.
  const handleComplete = useCallback(async () => {
    // Small delay — give the webhook a moment to fire and update the DB.
    await new Promise(r => setTimeout(r, 2000));
    await fetch(resolveUrl("/api/subscription/sync"), { method: "POST" });
    queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    toast({
      title: "Welcome to DBrief App Premium",
      description: "Your features are now unlocked. Full throttle.",
    });
    onClose();
  }, [onClose, toast]);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[300] bg-black/70"
            onClick={onClose}
          />

          {/* Sheet */}
          <motion.div
            key="sheet"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 300 }}
            className="fixed inset-x-0 bottom-0 z-[301] flex flex-col bg-white rounded-t-2xl overflow-hidden"
            style={{
              height: '92dvh',
              paddingBottom: 'env(safe-area-inset-bottom, 0px)',
            }}
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 flex-shrink-0">
              <div>
                <p className="text-sm font-semibold text-gray-900">DBrief App Premium</p>
                <p className="text-xs text-gray-500">£5.99 / month</p>
              </div>
              <button
                onClick={onClose}
                className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-gray-600 hover:bg-gray-200"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Embedded checkout */}
            <div className="flex-1 overflow-y-auto">
              {error ? (
                <div className="flex items-center justify-center h-full text-sm text-red-500 px-6 text-center">
                  {error}
                </div>
              ) : stripe ? (
                <EmbeddedCheckoutProvider
                  stripe={stripe}
                  options={{ fetchClientSecret, onComplete: handleComplete }}
                >
                  <EmbeddedCheckout />
                </EmbeddedCheckoutProvider>
              ) : (
                <div className="flex items-center justify-center h-full gap-2 text-sm text-gray-500">
                  <div className="w-4 h-4 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
                  Loading secure checkout…
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
