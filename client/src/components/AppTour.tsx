import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { haptic } from "@/lib/haptics";
import { X, ChevronRight, Target, CircleDot, MessageSquare, CheckSquare, TrendingUp, Compass } from "lucide-react";
import { TOUR_KEY } from "@/lib/tour";

interface TourStep {
  icon: React.ElementType;
  iconColor: string;
  title: string;
  subtitle: string;
  description: string;
  tip?: string;
}

const STEPS: TourStep[] = [
  {
    icon: Compass,
    iconColor: "text-primary",
    title: "Welcome to the garage.",
    subtitle: "Your mission briefing",
    description: "DBrief is your personal race engineer — built to extract maximum performance from your days. Every day is a session. Every session gets debriefed.",
    tip: "This tour covers the key tools at your disposal.",
  },
  {
    icon: Target,
    iconColor: "text-primary",
    title: "Your Infinite Goal",
    subtitle: "The mission that never ends",
    description: "At the top of the dashboard sits your Infinite Goal — an overarching ambition you never fully reach, but always drive toward. Like F1's pursuit of perfection.",
    tip: "Tap the banner to set or refine yours. The AI will help you articulate it.",
  },
  {
    icon: CircleDot,
    iconColor: "text-amber-500",
    title: "Telemetry Circles",
    subtitle: "Daily performance metrics",
    description: "Each circle tracks a performance metric on a 0–100 scale. Tap any circle to log today's reading. Tap and hold to see your trend over time.",
    tip: "Add or remove metrics in Settings — including Apple Health categories.",
  },
  {
    icon: MessageSquare,
    iconColor: "text-blue-500",
    title: "The Debrief",
    subtitle: "Your AI race engineer",
    description: "After your session, sit down with your engineer. The AI reviews your telemetry and goals, asks the right questions, and helps you extract the real lessons from the day.",
    tip: "You can speak or type. Voice readback is on by default — toggle the speaker in the header.",
  },
  {
    icon: CheckSquare,
    iconColor: "text-emerald-500",
    title: "Goals & Targets",
    subtitle: "What you're actually racing toward",
    description: "Build your daily job list — the specific actions you commit to today — plus up to 3 Long-Term Targets between today's actions and your Infinite Goal. One tap to mark them done.",
    tip: "Completed goals feed directly into your debrief context.",
  },
  {
    icon: TrendingUp,
    iconColor: "text-violet-500",
    title: "Analytics & History",
    subtitle: "The data doesn't lie",
    description: "The Analytics tab shows your metric trends across 7 days, 30 days, 6 months, or all time. The History tab lets you review or edit any past session.",
    tip: "AI-generated insights appear on the dashboard when patterns emerge across your data.",
  },
];

export default function AppTour() {
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    const done = localStorage.getItem(TOUR_KEY);
    if (!done) {
      const t = setTimeout(() => setVisible(true), 1200);
      return () => clearTimeout(t);
    }
  }, []);

  useEffect(() => {
    function handleReplay() {
      setStep(0);
      setVisible(true);
    }
    window.addEventListener("dbrief:replay-tour", handleReplay);
    return () => window.removeEventListener("dbrief:replay-tour", handleReplay);
  }, []);

  function handleClose() {
    haptic("select");
    localStorage.setItem(TOUR_KEY, "1");
    setVisible(false);
  }

  function handleNext() {
    haptic("light");
    if (step < STEPS.length - 1) {
      setStep(s => s + 1);
    } else {
      handleClose();
    }
  }

  function handlePrev() {
    haptic("light");
    setStep(s => Math.max(0, s - 1));
  }

  const current = STEPS[step];
  const Icon = current.icon;
  const isLast = step === STEPS.length - 1;

  return (
    <AnimatePresence>
      {visible && (
        <>
          <motion.div
            key="overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
            onClick={handleClose}
          />
          <motion.div
            key="card"
            initial={{ opacity: 0, y: 40, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.96 }}
            transition={{ type: "spring", stiffness: 320, damping: 28 }}
            className="fixed inset-x-4 bottom-8 z-50 max-w-md mx-auto"
          >
            <div className="bg-card border border-border/60 rounded-2xl shadow-2xl overflow-hidden">
              <div className="px-5 pt-5 pb-4">
                <div className="flex items-start justify-between mb-4">
                  <div className={`w-11 h-11 rounded-xl bg-background flex items-center justify-center border border-border/50`}>
                    <Icon className={`h-5 w-5 ${current.iconColor}`} />
                  </div>
                  <button
                    onClick={handleClose}
                    className="text-muted-foreground hover:text-foreground p-1 -mr-1 -mt-1 transition-colors"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">
                  {current.subtitle}
                </p>
                <h2 className="text-xl font-black text-foreground tracking-tight mb-2">
                  {current.title}
                </h2>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {current.description}
                </p>

                {current.tip && (
                  <div className="mt-3 px-3 py-2 rounded-lg bg-primary/10 border border-primary/20">
                    <p className="text-xs text-primary leading-relaxed">
                      {current.tip}
                    </p>
                  </div>
                )}
              </div>

              <div className="px-5 pb-5 flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  {STEPS.map((_, i) => (
                    <button
                      key={i}
                      onClick={() => { haptic("select"); setStep(i); }}
                      className={`rounded-full transition-all duration-200 ${
                        i === step
                          ? "w-4 h-1.5 bg-primary"
                          : "w-1.5 h-1.5 bg-border hover:bg-muted-foreground"
                      }`}
                    />
                  ))}
                </div>

                <div className="flex items-center gap-2">
                  {step > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handlePrev}
                      className="text-muted-foreground hover:text-foreground text-xs h-8"
                    >
                      Back
                    </Button>
                  )}
                  <Button
                    size="sm"
                    onClick={handleNext}
                    className="text-xs h-8 px-4 bg-primary text-primary-foreground hover:bg-primary/90"
                  >
                    {isLast ? "Let's go" : (
                      <span className="flex items-center gap-1">
                        Next <ChevronRight className="h-3.5 w-3.5" />
                      </span>
                    )}
                  </Button>
                </div>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

