import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Shield,
  BarChart3,
  MessageCircle,
  Flame,
  Sun,
  Moon,
  ArrowRight,
  Lock,
  Sparkles,
} from "lucide-react";

const STEPS = [
  "welcome",
  "features",
  "privacy",
  "preference",
] as const;

type Step = typeof STEPS[number];

interface OnboardingFlowProps {
  username: string;
}

export default function OnboardingFlow({ username }: OnboardingFlowProps) {
  const [currentStep, setCurrentStep] = useState<Step>("welcome");
  const [journalPreference, setJournalPreference] = useState<"morning" | "evening" | null>(null);

  const completeMutation = useMutation({
    mutationFn: async (pref: string) => {
      return apiRequest("POST", "/api/onboarding/complete", { journalPreference: pref });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    },
  });

  const stepIndex = STEPS.indexOf(currentStep);

  const next = () => {
    if (stepIndex < STEPS.length - 1) {
      setCurrentStep(STEPS[stepIndex + 1]);
    }
  };

  const handleComplete = () => {
    if (journalPreference) {
      completeMutation.mutate(journalPreference);
    }
  };

  const firstName = username.split("@")[0];

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex justify-center gap-1.5 mb-8">
          {STEPS.map((_, i) => (
            <div
              key={i}
              className={`h-1 rounded-full transition-all duration-300 ${
                i <= stepIndex ? "w-8 bg-primary" : "w-4 bg-border"
              }`}
            />
          ))}
        </div>

        <AnimatePresence mode="wait">
          {currentStep === "welcome" && (
            <motion.div
              key="welcome"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.3 }}
              className="text-center space-y-6"
            >
              <div className="w-16 h-16 bg-primary rounded-2xl flex items-center justify-center mx-auto shadow-lg shadow-primary/20">
                <span className="text-primary-foreground text-2xl font-bold">D</span>
              </div>

              <div className="space-y-3">
                <h1 className="text-2xl font-bold text-foreground">
                  Welcome{firstName ? `, ${firstName}` : ""}
                </h1>
                <p className="text-sm text-muted-foreground leading-relaxed max-w-xs mx-auto">
                  DBrief is your personal space to reflect, track what matters, and notice
                  patterns in your daily life.
                </p>
                <p className="text-sm text-muted-foreground leading-relaxed max-w-xs mx-auto">
                  Let's take a quick look at what's here for you.
                </p>
              </div>

              <Button onClick={next} className="w-full max-w-xs h-11">
                Let's go
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </motion.div>
          )}

          {currentStep === "features" && (
            <motion.div
              key="features"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.3 }}
              className="space-y-6"
            >
              <div className="text-center space-y-2">
                <h2 className="text-xl font-bold text-foreground">What you can do</h2>
                <p className="text-sm text-muted-foreground">A few things that make DBrief yours.</p>
              </div>

              <div className="space-y-3">
                <FeatureCard
                  icon={<MessageCircle className="h-4 w-4" />}
                  iconBg="bg-blue-500/10"
                  iconColor="text-blue-500"
                  title="Daily Debrief"
                  description="A short AI-guided conversation to reflect on your day. Type or speak — it listens, then asks the right follow-ups."
                />
                <FeatureCard
                  icon={<BarChart3 className="h-4 w-4" />}
                  iconBg="bg-emerald-500/10"
                  iconColor="text-emerald-500"
                  title="Track What Matters"
                  description="Score your wellness metrics daily with simple sliders. Choose from Apple Health categories or create your own."
                />
                <FeatureCard
                  icon={<Flame className="h-4 w-4" />}
                  iconBg="bg-orange-500/10"
                  iconColor="text-orange-500"
                  title="Streaks & Goals"
                  description="Build consistency with streaks and set recurring daily goals. Small wins compound."
                />
                <FeatureCard
                  icon={<Sparkles className="h-4 w-4" />}
                  iconBg="bg-violet-500/10"
                  iconColor="text-violet-500"
                  title="AI Insights"
                  description="After a few days, you'll start seeing patterns and personalised suggestions based on your entries."
                />
              </div>

              <Button onClick={next} className="w-full h-11">
                Continue
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </motion.div>
          )}

          {currentStep === "privacy" && (
            <motion.div
              key="privacy"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.3 }}
              className="text-center space-y-6"
            >
              <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 flex items-center justify-center mx-auto">
                <Shield className="h-7 w-7 text-emerald-500" />
              </div>

              <div className="space-y-3">
                <h2 className="text-xl font-bold text-foreground">Your data is safe</h2>
                <p className="text-sm text-muted-foreground leading-relaxed max-w-xs mx-auto">
                  Everything you write is encrypted with AES-256-GCM — the same standard used by banks and governments.
                </p>
              </div>

              <div className="space-y-2.5 max-w-xs mx-auto">
                <PrivacyItem
                  icon={<Lock className="h-3.5 w-3.5" />}
                  text="Journal entries encrypted at rest"
                />
                <PrivacyItem
                  icon={<Lock className="h-3.5 w-3.5" />}
                  text="Debrief conversations encrypted"
                />
                <PrivacyItem
                  icon={<Lock className="h-3.5 w-3.5" />}
                  text="AI summaries encrypted"
                />
                <PrivacyItem
                  icon={<Shield className="h-3.5 w-3.5" />}
                  text="Your data is never sold or shared"
                />
              </div>

              <p className="text-xs text-muted-foreground/60 max-w-xs mx-auto">
                This is your private space. Write freely.
              </p>

              <Button onClick={next} className="w-full max-w-xs h-11">
                Got it
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </motion.div>
          )}

          {currentStep === "preference" && (
            <motion.div
              key="preference"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.3 }}
              className="text-center space-y-6"
            >
              <div className="space-y-3">
                <h2 className="text-xl font-bold text-foreground">When do you reflect?</h2>
                <p className="text-sm text-muted-foreground leading-relaxed max-w-xs mx-auto">
                  This helps us tailor your debrief prompts. You can change this anytime in settings.
                </p>
              </div>

              <div className="space-y-3 max-w-xs mx-auto">
                <button
                  onClick={() => setJournalPreference("morning")}
                  className={`w-full flex items-start gap-3.5 p-4 rounded-xl border-2 text-left transition-all ${
                    journalPreference === "morning"
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-border/80 hover:bg-muted/30"
                  }`}
                >
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                    journalPreference === "morning" ? "bg-amber-500/10" : "bg-muted"
                  }`}>
                    <Sun className={`h-5 w-5 ${journalPreference === "morning" ? "text-amber-500" : "text-muted-foreground"}`} />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">Morning reflector</p>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                      I journal in the morning about the day before. A fresh perspective on yesterday.
                    </p>
                  </div>
                </button>

                <button
                  onClick={() => setJournalPreference("evening")}
                  className={`w-full flex items-start gap-3.5 p-4 rounded-xl border-2 text-left transition-all ${
                    journalPreference === "evening"
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-border/80 hover:bg-muted/30"
                  }`}
                >
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                    journalPreference === "evening" ? "bg-indigo-500/10" : "bg-muted"
                  }`}>
                    <Moon className={`h-5 w-5 ${journalPreference === "evening" ? "text-indigo-500" : "text-muted-foreground"}`} />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">Evening reflector</p>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                      I journal at the end of the day while it's still fresh. Wind down and process.
                    </p>
                  </div>
                </button>
              </div>

              <Button
                onClick={handleComplete}
                disabled={!journalPreference || completeMutation.isPending}
                className="w-full max-w-xs h-11"
              >
                {completeMutation.isPending ? "Setting up..." : "Start journaling"}
                {!completeMutation.isPending && <ArrowRight className="ml-2 h-4 w-4" />}
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function FeatureCard({
  icon,
  iconBg,
  iconColor,
  title,
  description,
}: {
  icon: React.ReactNode;
  iconBg: string;
  iconColor: string;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-3 p-3 rounded-xl bg-card border border-border/50">
      <div className={`w-8 h-8 rounded-lg ${iconBg} flex items-center justify-center shrink-0 ${iconColor}`}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{description}</p>
      </div>
    </div>
  );
}

function PrivacyItem({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex items-center gap-2.5 text-left">
      <div className="w-6 h-6 rounded-md bg-emerald-500/10 flex items-center justify-center shrink-0 text-emerald-500">
        {icon}
      </div>
      <span className="text-sm text-foreground">{text}</span>
    </div>
  );
}
