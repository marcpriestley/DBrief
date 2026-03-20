import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { apiRequest, queryClient } from "@/lib/queryClient";
import ProfileQuestions from "./ProfileQuestions";
import { PROFILE_QUESTIONS } from "@/lib/profileData";
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
  "profile",
  "preference",
] as const;

type Step = typeof STEPS[number];

interface OnboardingFlowProps {
  username: string;
}

export default function OnboardingFlow({ username }: OnboardingFlowProps) {
  const [currentStep, setCurrentStep] = useState<Step>("welcome");
  const [journalPreference, setJournalPreference] = useState<"morning" | "evening" | null>(null);
  const [goalPreference, setGoalPreference] = useState<"morning" | "evening">("morning");
  const [profileAnswers, setProfileAnswers] = useState<Record<string, string>>({});

  const completeMutation = useMutation({
    mutationFn: async (data: { journalPreference: string; goalPreference: string; userProfile: Record<string, string> }) => {
      return apiRequest("POST", "/api/onboarding/complete", data);
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
      completeMutation.mutate({
        journalPreference,
        goalPreference,
        userProfile: profileAnswers,
      });
    }
  };

  const profileComplete = PROFILE_QUESTIONS.every(q => profileAnswers[q.key]);
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
                  DBrief is your personal performance engineer. Like an F1 team debriefs every
                  session to find gains, you'll debrief your day to perform better tomorrow.
                </p>
                <p className="text-sm text-muted-foreground leading-relaxed max-w-xs mx-auto">
                  Let's get you set up for your first session.
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
                <h2 className="text-xl font-bold text-foreground">Your performance toolkit</h2>
                <p className="text-sm text-muted-foreground">Everything you need to find your edge, every day.</p>
              </div>

              <div className="space-y-3">
                <FeatureCard
                  icon={<MessageCircle className="h-4 w-4" />}
                  iconBg="bg-blue-500/10"
                  iconColor="text-blue-500"
                  title="Daily Debrief"
                  description="Like a post-session debrief with your race engineer. Review your day's performance, find what worked, and spot where you left time on the table."
                />
                <FeatureCard
                  icon={<BarChart3 className="h-4 w-4" />}
                  iconBg="bg-emerald-500/10"
                  iconColor="text-emerald-500"
                  title="Performance Telemetry"
                  description="Track your key metrics daily — energy, sleep, focus, and more. Like monitoring tyre data and fuel loads, except it's you."
                />
                <FeatureCard
                  icon={<Flame className="h-4 w-4" />}
                  iconBg="bg-orange-500/10"
                  iconColor="text-orange-500"
                  title="Streaks & Targets"
                  description="Set daily goals and long-term targets. Consistency compounds — the best teams never miss a session."
                />
                <FeatureCard
                  icon={<Sparkles className="h-4 w-4" />}
                  iconBg="bg-violet-500/10"
                  iconColor="text-violet-500"
                  title="Pattern Analysis"
                  description="After a few sessions, you'll start seeing the patterns in your data — what drives your best performances and what holds you back."
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
                <h2 className="text-xl font-bold text-foreground">Your data is locked down</h2>
                <p className="text-sm text-muted-foreground leading-relaxed max-w-xs mx-auto">
                  Everything you log is encrypted with AES-256-GCM — the same standard used by banks and governments. Your performance data stays yours.
                </p>
              </div>

              <div className="space-y-2.5 max-w-xs mx-auto">
                <PrivacyItem icon={<Lock className="h-3.5 w-3.5" />} text="Journal entries encrypted at rest" />
                <PrivacyItem icon={<Lock className="h-3.5 w-3.5" />} text="Debrief conversations encrypted" />
                <PrivacyItem icon={<Lock className="h-3.5 w-3.5" />} text="AI summaries encrypted" />
                <PrivacyItem icon={<Shield className="h-3.5 w-3.5" />} text="Your data is never sold or shared" />
              </div>

              <p className="text-xs text-muted-foreground/60 max-w-xs mx-auto">
                This is your pit wall. Speak freely.
              </p>

              <Button onClick={next} className="w-full max-w-xs h-11">
                Got it
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </motion.div>
          )}

          {currentStep === "profile" && (
            <motion.div
              key="profile"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.3 }}
              className="space-y-5"
            >
              <div className="text-center space-y-2">
                <h2 className="text-xl font-bold text-foreground">Driver profile</h2>
                <p className="text-sm text-muted-foreground leading-relaxed max-w-xs mx-auto">
                  7 quick questions so your AI engineer knows how to work with you. Updatable anytime in Settings.
                </p>
              </div>

              <div className="max-h-[55vh] overflow-y-auto pr-1">
                <ProfileQuestions
                  initialAnswers={profileAnswers}
                  onComplete={setProfileAnswers}
                  compact
                />
              </div>

              <Button
                onClick={next}
                disabled={!profileComplete}
                className="w-full h-11"
              >
                {profileComplete ? "Continue" : `${Object.keys(profileAnswers).length}/${PROFILE_QUESTIONS.length} answered`}
                {profileComplete && <ArrowRight className="ml-2 h-4 w-4" />}
              </Button>

              {!profileComplete && (
                <button
                  onClick={next}
                  className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors underline-offset-2 hover:underline"
                >
                  Skip for now
                </button>
              )}
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
                <h2 className="text-xl font-bold text-foreground">How do you operate?</h2>
                <p className="text-sm text-muted-foreground leading-relaxed max-w-xs mx-auto">
                  This shapes your default view and how your engineer frames the conversation. Change it anytime.
                </p>
              </div>

              <div className="space-y-3 max-w-xs mx-auto text-left">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-1">Debrief timing</p>
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
                    <p className="text-sm font-semibold text-foreground">Morning debrief</p>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                      Review yesterday with fresh eyes. Default view shows Yesterday.
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
                    <p className="text-sm font-semibold text-foreground">Evening debrief</p>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                      Debrief while the session is fresh. Default view shows Today.
                    </p>
                  </div>
                </button>

                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-1 pt-2">Goal prep timing</p>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { key: "morning" as const, label: "Morning", sub: "Set goals for today" },
                    { key: "evening" as const, label: "Evening", sub: "Prep tomorrow's goals" },
                  ].map((opt) => (
                    <button
                      key={opt.key}
                      onClick={() => setGoalPreference(opt.key)}
                      className={`p-3 rounded-xl border-2 text-left transition-all ${
                        goalPreference === opt.key
                          ? "border-primary bg-primary/5"
                          : "border-border hover:border-border/80"
                      }`}
                    >
                      <p className="text-xs font-semibold text-foreground">{opt.label}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">{opt.sub}</p>
                    </button>
                  ))}
                </div>
              </div>

              <Button
                onClick={handleComplete}
                disabled={!journalPreference || completeMutation.isPending}
                className="w-full max-w-xs h-11"
              >
                {completeMutation.isPending ? "Setting up..." : "Start my first session"}
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
  icon, iconBg, iconColor, title, description,
}: {
  icon: React.ReactNode; iconBg: string; iconColor: string; title: string; description: string;
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
