import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Check } from "lucide-react";
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user/profile"] });
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

export function ProfileQuestionsSettings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: profileData } = useQuery<{ userProfile: Record<string, string>; goalPreference: string }>({
    queryKey: ["/api/user/profile"],
  });

  const saveMutation = useMutation({
    mutationFn: async (data: { userProfile: Record<string, string>; goalPreference: string }) => {
      const res = await apiRequest("PUT", "/api/user/profile", data);
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/user/profile"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      // Immediately apply the saved data to local state so fields don't go blank on re-open
      const savedProfile = data?.userProfile || {};
      setAnswers(savedProfile);
      setDateOfBirth(savedProfile.dateOfBirth || "");
      setOccupation(savedProfile.occupation || "");
      setLocation(savedProfile.location || "");
      setGoalPref(data?.goalPreference || goalPref);
      toast({ title: "Profile saved", description: "Your AI debrief will now personalise to you." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save.", variant: "destructive" });
    },
  });

  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [goalPref, setGoalPref] = useState<string>("morning");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [occupation, setOccupation] = useState("");
  const [location, setLocation] = useState("");
  const [initialised, setInitialised] = useState(false);

  useEffect(() => {
    if (profileData && !initialised) {
      const profile = profileData.userProfile || {};
      setAnswers(profile);
      setGoalPref(profileData.goalPreference || "morning");
      setDateOfBirth(profile.dateOfBirth || "");
      setOccupation(profile.occupation || "");
      setLocation(profile.location || "");
      setInitialised(true);
    }
  }, [profileData, initialised]);

  // When fresh data arrives after a save (stale cache was used on first render),
  // update the personal detail fields if they're still empty but the server has data.
  useEffect(() => {
    if (!initialised || !profileData) return;
    const profile = profileData.userProfile || {};
    if (!dateOfBirth && profile.dateOfBirth) setDateOfBirth(profile.dateOfBirth);
    if (!occupation && profile.occupation) setOccupation(profile.occupation);
    if (!location && profile.location) setLocation(profile.location);
  }, [profileData]);

  if (!initialised) {
    return <div className="py-4 text-center text-xs text-muted-foreground">Loading profile...</div>;
  }

  const buildFullProfile = () => ({
    ...answers,
    ...(dateOfBirth ? { dateOfBirth } : {}),
    ...(occupation.trim() ? { occupation: occupation.trim() } : {}),
    ...(location.trim() ? { location: location.trim() } : {}),
  });

  const allAnswered = PROFILE_QUESTIONS.every(q => answers[q.key]);

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
              DBrief will celebrate your birthday each year 🎂
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

      {/* ── Driver Profile questions ── */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Driver Profile</p>
        <ProfileQuestions
          initialAnswers={answers}
          onComplete={setAnswers}
          compact
        />
      </div>

      <Button
        className="w-full"
        size="sm"
        onClick={() => saveMutation.mutate({ userProfile: buildFullProfile(), goalPreference: goalPref })}
        disabled={!allAnswered || saveMutation.isPending}
      >
        {saveMutation.isPending ? "Saving..." : "Save Profile"}
      </Button>
    </div>
  );
}
