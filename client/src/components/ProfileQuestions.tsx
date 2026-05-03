import { useState, useEffect, useRef, forwardRef, useImperativeHandle } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Check, ChevronDown } from "lucide-react";
import { PROFILE_QUESTIONS } from "@/lib/profileData";

interface ProfileQuestionsProps {
  initialAnswers?: Record<string, string>;
  onComplete?: (answers: Record<string, string>) => void;
  showSaveButton?: boolean;
  compact?: boolean;
}

export default function ProfileQuestions({
  initialAnswers = {},
  onComplete,
  showSaveButton = false,
  compact = false,
}: ProfileQuestionsProps) {
  const [answers, setAnswers] = useState<Record<string, string>>(initialAnswers);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const saveMutation = useMutation({
    mutationFn: async (data: Record<string, string>) => {
      const res = await apiRequest("PUT", "/api/user/profile", { userProfile: data });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/user/profile"], data);
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      toast({ title: "Profile updated", description: "Your AI debrief will now personalise to you." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save profile.", variant: "destructive" });
    },
  });

  const handleSelect = (key: string, option: string) => {
    const updated = { ...answers, [key]: option };
    setAnswers(updated);
    onComplete?.(updated);
  };

  const allAnswered = PROFILE_QUESTIONS.every(q => answers[q.key]);

  return (
    <div className={compact ? "space-y-3" : "space-y-4"}>
      {PROFILE_QUESTIONS.map((q) => {
        const Icon = q.icon;
        return (
          <div key={q.key} className="space-y-2">
            <div className="flex items-center gap-2">
              <div className={`w-6 h-6 rounded-md ${q.iconBg} flex items-center justify-center shrink-0 ${q.iconColor}`}>
                <Icon className="h-3.5 w-3.5" />
              </div>
              <p className={`font-semibold text-foreground ${compact ? "text-xs" : "text-sm"}`}>{q.question}</p>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {q.options.map((opt) => {
                const selected = answers[q.key] === opt.key;
                return (
                  <button
                    key={opt.key}
                    onClick={() => handleSelect(q.key, opt.key)}
                    className={`flex items-center gap-2 p-2.5 rounded-lg border text-left transition-all ${
                      selected
                        ? "border-primary bg-primary/8 text-foreground"
                        : "border-border/60 hover:border-border text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <div className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${
                      selected ? "border-primary bg-primary" : "border-muted-foreground/40"
                    }`}>
                      {selected && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                    </div>
                    <span className={compact ? "text-[11px] leading-tight" : "text-xs leading-tight"}>{opt.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}

      {showSaveButton && (
        <Button
          className="w-full"
          onClick={() => saveMutation.mutate(answers)}
          disabled={!allAnswered || saveMutation.isPending}
        >
          {saveMutation.isPending ? "Saving..." : "Save Profile"}
        </Button>
      )}
    </div>
  );
}

export type ProfileQuestionsSettingsHandle = {
  save: () => void;
};

export const ProfileQuestionsSettings = forwardRef<ProfileQuestionsSettingsHandle>(function ProfileQuestionsSettings(_props, ref) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: profileData } = useQuery<{ userProfile: Record<string, string>; goalPreference: string }>({
    queryKey: ["/api/user/profile"],
    staleTime: 0,
    refetchOnMount: "always",
  });

  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [goalPref, setGoalPref] = useState<string>("morning");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [occupation, setOccupation] = useState("");
  const [location, setLocation] = useState("");
  const [currentFocus, setCurrentFocus] = useState("");
  const [showDriverQuestions, setShowDriverQuestions] = useState(false);
  const hasHydrated = useRef(false);

  useEffect(() => {
    if (!profileData || hasHydrated.current) return;
    hasHydrated.current = true;
    const profile = profileData.userProfile || {};
    setAnswers(profile);
    setGoalPref(profileData.goalPreference || "morning");
    setDateOfBirth(profile.dateOfBirth || "");
    setOccupation(profile.occupation || "");
    setLocation(profile.location || "");
    setCurrentFocus(profile.currentFocus || "");
    if (Object.keys(profile).some(k => PROFILE_QUESTIONS.map(q => q.key).includes(k))) {
      setShowDriverQuestions(true);
    }
  }, [profileData]);

  const saveMutation = useMutation({
    mutationFn: async (data: { userProfile: Record<string, string>; goalPreference: string }) => {
      const res = await apiRequest("PUT", "/api/user/profile", data);
      return res.json();
    },
    onSuccess: (data) => {
      const savedProfile = data?.userProfile || {};
      const savedGoalPref = data?.goalPreference || "morning";
      // Write the GET-shaped value into the cache (no `success` field) so the
      // next modal open reads exactly what the server persisted.
      queryClient.setQueryData(["/api/user/profile"], {
        userProfile: savedProfile,
        goalPreference: savedGoalPref,
      });
      // Invalidate to force a fresh server fetch when the settings next open,
      // and also keep /api/auth/me in sync (userProfile lives on the user row).
      queryClient.invalidateQueries({ queryKey: ["/api/user/profile"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      // Update local form state immediately so the UI reflects the saved values
      // while the background refetch is in flight.
      setAnswers(savedProfile);
      setDateOfBirth(savedProfile.dateOfBirth || "");
      setOccupation(savedProfile.occupation || "");
      setLocation(savedProfile.location || "");
      setCurrentFocus(savedProfile.currentFocus || "");
      setGoalPref(savedGoalPref);
      toast({ title: "Profile saved", description: "Your AI debrief will now personalise to you." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save.", variant: "destructive" });
    },
  });

  const buildFullProfile = () => ({
    ...answers,
    ...(dateOfBirth ? { dateOfBirth } : {}),
    ...(occupation.trim() ? { occupation: occupation.trim() } : {}),
    ...(location.trim() ? { location: location.trim() } : {}),
    ...(currentFocus.trim() ? { currentFocus: currentFocus.trim() } : {}),
  });

  // Expose save() so the parent settings modal can call it from the main Save button
  useImperativeHandle(ref, () => ({
    save: () => {
      if (profileData) {
        saveMutation.mutate({ userProfile: buildFullProfile(), goalPreference: goalPref });
      }
    },
  }));

  if (!profileData) {
    return <div className="py-4 text-center text-xs text-muted-foreground">Loading profile...</div>;
  }

  return (
    <div className="space-y-5">

      {/* ── Personal Details ── */}
      <div className="space-y-3">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Personal Details</p>
        <p className="text-[11px] text-muted-foreground -mt-1 leading-relaxed">
          Optional — helps the AI personalise your debrief and celebrate the moments that matter.
        </p>

        <div className="space-y-2">
          <Label htmlFor="dateOfBirth" className="text-xs">Date of Birth</Label>
          <Input
            id="dateOfBirth"
            type="date"
            value={dateOfBirth}
            onChange={(e) => setDateOfBirth(e.target.value)}
            className="h-9"
            max={new Date().toISOString().split("T")[0]}
          />
          {dateOfBirth && (
            <p className="text-[11px] text-muted-foreground">
              DBrief App will celebrate your birthday each year 🎂
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="occupation" className="text-xs">Occupation / Role</Label>
          <Input
            id="occupation"
            value={occupation}
            onChange={(e) => setOccupation(e.target.value)}
            placeholder="e.g. Software engineer, student, athlete…"
            className="h-9"
            maxLength={60}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="location" className="text-xs">City / Country</Label>
          <Input
            id="location"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="e.g. London, UK"
            className="h-9"
            maxLength={60}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="currentFocus" className="text-xs">What are you focused on right now?</Label>
          <Textarea
            id="currentFocus"
            value={currentFocus}
            onChange={(e) => setCurrentFocus(e.target.value)}
            placeholder="e.g. Training for a half marathon, launching a side project, improving my sleep…"
            className="text-sm resize-none"
            rows={2}
            maxLength={120}
          />
          <p className="text-[11px] text-muted-foreground">Your AI engineer uses this to focus the debrief on what matters most right now.</p>
        </div>
      </div>

      {/* ── Goal Prep Timing ── */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Goal Prep Timing</p>
        <div className="grid grid-cols-2 gap-2">
          {[
            { key: "morning", label: "Morning", sub: "Set goals for today" },
            { key: "evening", label: "Evening", sub: "Prep tomorrow's goals" },
          ].map((opt) => (
            <button
              key={opt.key}
              onClick={() => setGoalPref(opt.key)}
              className={`p-3 rounded-lg border-2 text-left transition-all ${
                goalPref === opt.key
                  ? "border-primary bg-primary/5"
                  : "border-border/60 hover:border-border"
              }`}
            >
              <p className="text-xs font-semibold text-foreground">{opt.label}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{opt.sub}</p>
            </button>
          ))}
        </div>
      </div>

      {/* ── Driver Profile questions (collapsible) ── */}
      <div>
        <button
          onClick={() => setShowDriverQuestions(v => !v)}
          className="w-full flex items-center justify-between py-2 group"
        >
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide group-hover:text-foreground transition-colors">Driver Profile</p>
          <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${showDriverQuestions ? "rotate-180" : ""}`} />
        </button>
        {!showDriverQuestions && (
          <p className="text-[11px] text-muted-foreground">
            {PROFILE_QUESTIONS.every(q => answers[q.key])
              ? "All 7 questions answered — your AI engineer is calibrated."
              : "7 questions that calibrate how your AI engineer debriefs you."}
          </p>
        )}
        {showDriverQuestions && (
          <div className="mt-2">
            <ProfileQuestions
              initialAnswers={answers}
              onComplete={(updated) => setAnswers(updated)}
              compact
            />
          </div>
        )}
      </div>

      <Button
        className="w-full"
        size="sm"
        onClick={() => saveMutation.mutate({ userProfile: buildFullProfile(), goalPreference: goalPref })}
        disabled={saveMutation.isPending}
      >
        {saveMutation.isPending ? "Saving..." : "Save Profile"}
      </Button>
    </div>
  );
});
