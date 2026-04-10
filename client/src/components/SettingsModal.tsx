import { useState, useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { registerNativePush, isNativePlatform, openAppSettings } from "@/hooks/useNativeNotifications";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  Bell, BellOff, AlertCircle, CheckCircle2, Heart, Plus, Check, Info,
  User, Map, RefreshCw, KeyRound, ChevronDown, Sun, Moon,
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { haptic } from "@/lib/haptics";
import type { UserMetric } from "@shared/schema";
import { ProfileQuestionsSettings, type ProfileQuestionsSettingsHandle } from "./ProfileQuestions";
import { resetTour } from "@/lib/tour";
import {
  isNativeIOS,
  requestHealthPermissions,
  syncHealthData,
  getHealthAuthState,
  getHealthSyncableMetrics,
  checkHealthAvailable,
  getLastHealthError,
} from "@/lib/healthKit";

const APPLE_HEALTH_METRICS: {
  name: string;
  category: string;
  color: string;
  maxValue: number;
  unit: string;
}[] = [
  { name: "Steps",               category: "Activity",     color: "#10B981", maxValue: 20000, unit: "steps" },
  { name: "Active Energy",       category: "Activity",     color: "#F59E0B", maxValue: 800,   unit: "kcal" },
  { name: "Exercise Minutes",    category: "Activity",     color: "#3B82F6", maxValue: 60,    unit: "min" },
  { name: "Flights Climbed",     category: "Activity",     color: "#84CC16", maxValue: 20,    unit: "" },
  { name: "Walking Distance",    category: "Activity",     color: "#0EA5E9", maxValue: 10,    unit: "km" },
  { name: "Sleep Duration",      category: "Sleep",        color: "#4F46E5", maxValue: 10,    unit: "hrs" },
  { name: "Sleep Quality",       category: "Sleep",        color: "#7C3AED", maxValue: 100,   unit: "%" },
  { name: "Heart Rate",          category: "Heart",        color: "#EF4444", maxValue: 200,   unit: "bpm" },
  { name: "Resting Heart Rate",  category: "Heart",        color: "#E11D48", maxValue: 100,   unit: "bpm" },
  { name: "HRV",                 category: "Heart",        color: "#8B5CF6", maxValue: 120,   unit: "ms" },
  { name: "Blood Oxygen",        category: "Heart",        color: "#38BDF8", maxValue: 100,   unit: "%" },
  { name: "Body Weight",         category: "Body",         color: "#EC4899", maxValue: 200,   unit: "kg" },
  { name: "Body Fat %",          category: "Body",         color: "#F97316", maxValue: 50,    unit: "%" },
  { name: "Mindful Minutes",     category: "Mindfulness",  color: "#14B8A6", maxValue: 60,    unit: "min" },
  { name: "Respiratory Rate",    category: "Respiratory",  color: "#64748B", maxValue: 30,    unit: "brpm" },
];

const CATEGORY_ORDER = ["Activity", "Sleep", "Heart", "Body", "Mindfulness", "Respiratory"];

// ─── Collapsible section wrapper ─────────────────────────────────────────────
function SettingsSection({
  title,
  icon,
  children,
  defaultOpen = false,
  badge,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
  badge?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-border/60 rounded-xl overflow-hidden">
      <button
        onClick={() => { haptic("select"); setOpen(o => !o); }}
        className="w-full flex items-center justify-between px-4 py-3.5 bg-card hover:bg-muted/40 transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <span className="text-muted-foreground">{icon}</span>
          <span className="text-sm font-medium text-foreground">{title}</span>
          {badge && (
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-primary/15 text-primary">{badge}</span>
          )}
        </div>
        <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="px-4 pb-4 pt-3 space-y-3.5 border-t border-border/40 bg-card">
          {children}
        </div>
      )}
    </div>
  );
}

// ─── Notification permission helpers ─────────────────────────────────────────
function NotificationPermissionHelper() {
  const [permissionState, setPermissionState] = useState<NotificationPermission | "unsupported" | "native-unknown" | "native-denied" | "native-granted">("default");

  useEffect(() => {
    if (!isNativePlatform()) {
      if (!("Notification" in window)) {
        setPermissionState("unsupported");
      } else {
        setPermissionState(Notification.permission);
      }
      return;
    }
    import("@capacitor/push-notifications").then(({ PushNotifications }) => {
      PushNotifications.requestPermissions().then((result) => {
        if (result.receive === "granted") setPermissionState("native-granted");
        else if (result.receive === "denied") setPermissionState("native-denied");
        else setPermissionState("native-unknown");
      }).catch(() => setPermissionState("native-unknown"));
    }).catch(() => setPermissionState("native-unknown"));
  }, []);

  if (permissionState === "native-granted") {
    return (
      <div className="flex items-start gap-2.5 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
        <CheckCircle2 className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />
        <p className="text-xs text-emerald-700 dark:text-emerald-400">Notifications are active. DBrief will appear in your iPhone notification settings.</p>
      </div>
    );
  }
  if (permissionState === "native-denied") {
    return (
      <div className="flex items-start gap-2.5 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
        <AlertCircle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
        <div className="text-xs text-amber-700 dark:text-amber-400 space-y-2 flex-1">
          <p>iOS notifications are blocked. You need to allow them in iPhone Settings.</p>
          <Button size="sm" variant="outline" className="h-7 text-xs border-amber-500/40 text-amber-700" onClick={openAppSettings}>
            Open DBrief Settings →
          </Button>
        </div>
      </div>
    );
  }
  if (permissionState === "native-unknown") {
    return (
      <div className="flex items-start gap-2.5 p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
        <AlertCircle className="h-4 w-4 text-blue-500 mt-0.5 shrink-0" />
        <p className="text-xs text-blue-700 dark:text-blue-400">Toggle <strong>Daily Reminders</strong> on to request notification permission from iOS.</p>
      </div>
    );
  }
  if (permissionState === "granted") {
    return (
      <div className="flex items-start gap-2.5 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
        <CheckCircle2 className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />
        <p className="text-xs text-emerald-700 dark:text-emerald-400">Notifications are enabled. You're all set!</p>
      </div>
    );
  }
  if (permissionState === "denied") {
    return (
      <div className="flex items-start gap-2.5 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
        <AlertCircle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
        <div className="text-xs text-amber-700 dark:text-amber-400">
          <p className="font-medium mb-1">Notifications are blocked</p>
          <ol className="list-decimal ml-3 space-y-0.5 text-[11px]">
            <li>Click the lock icon in your address bar</li>
            <li>Find "Notifications" in site settings</li>
            <li>Change from "Block" to "Allow"</li>
            <li>Refresh this page</li>
          </ol>
        </div>
      </div>
    );
  }
  if (permissionState === "unsupported") {
    return (
      <div className="flex items-start gap-2.5 p-3 rounded-lg bg-muted border border-border">
        <AlertCircle className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
        <p className="text-xs text-muted-foreground">Push notifications aren't supported in this browser.</p>
      </div>
    );
  }
  return null;
}

function PushRegistrationStatus() {
  const { data, refetch, isLoading } = useQuery<{ registered: boolean; hasApns: boolean }>({
    queryKey: ["/api/push/status"],
    staleTime: 10000,
  });

  if (isLoading) return null;
  if (!data?.registered) {
    return (
      <div className="flex items-start gap-2.5 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
        <AlertCircle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
        <div className="flex-1 text-xs text-amber-700 dark:text-amber-400 space-y-1.5">
          <p className="font-medium">Device not registered</p>
          <p>Toggle Daily Reminders off then back on to register this device for push notifications.</p>
          <Button size="sm" variant="outline" className="h-7 text-xs border-amber-500/40 text-amber-700" onClick={() => refetch()}>
            Re-check
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
      <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
      <p className="text-xs text-emerald-700 dark:text-emerald-400 font-medium">Push notifications active</p>
    </div>
  );
}

function ApnsCredentialsDialog() {
  const [open, setOpen] = useState(false);
  const [keyId, setKeyId] = useState("");
  const [teamId, setTeamId] = useState("");
  const [authKey, setAuthKey] = useState("");
  const { toast } = useToast();

  const { data: existing } = useQuery<{ keyId: string; teamId: string; hasAuthKey: boolean; authKeyLength: number }>({
    queryKey: ["/api/admin/apns-credentials"],
    enabled: open,
  });

  useEffect(() => {
    if (existing) {
      setKeyId(existing.keyId || "");
      setTeamId(existing.teamId || "");
    }
  }, [existing]);

  const saveMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/admin/apns-credentials", { keyId: keyId.trim(), teamId: teamId.trim(), authKey: authKey.trim() }),
    onSuccess: () => {
      toast({ title: "APNs credentials saved", description: "Try 'Send test' now." });
      setAuthKey("");
      setOpen(false);
    },
    onError: (err: any) => {
      toast({ title: "Save failed", description: err?.message || "Check the values and try again.", variant: "destructive" });
    },
  });

  const canSave = keyId.trim().length > 0 && teamId.trim().length > 0 && authKey.trim().length > 0;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <KeyRound className="h-3.5 w-3.5" />
        Update APNs credentials
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>APNs Credentials</DialogTitle>
            <DialogDescription>
              Paste your Apple Push key details. Find these at developer.apple.com → Certificates, Identifiers &amp; Keys → Keys.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-1">
            <div className="space-y-1.5">
              <Label className="text-xs">Key ID <span className="text-muted-foreground">(10 characters, e.g. AB12CD34EF)</span></Label>
              <Input value={keyId} onChange={e => setKeyId(e.target.value)} placeholder="AB12CD34EF" className="font-mono text-sm" maxLength={10} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Team ID <span className="text-muted-foreground">(top-right of Apple Developer)</span></Label>
              <Input value={teamId} onChange={e => setTeamId(e.target.value)} placeholder="5T4F8AH2ZV" className="font-mono text-sm" maxLength={10} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">
                .p8 Private Key content
                {existing?.hasAuthKey && (
                  <span className="ml-2 text-emerald-600">✓ key saved ({existing.authKeyLength} chars) — paste to replace</span>
                )}
              </Label>
              <Textarea
                value={authKey}
                onChange={e => setAuthKey(e.target.value)}
                placeholder={"-----BEGIN PRIVATE KEY-----\nMIGH...\n-----END PRIVATE KEY-----"}
                className="font-mono text-xs h-28 resize-none"
              />
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setOpen(false)}>Cancel</Button>
              <Button className="flex-1" onClick={() => saveMutation.mutate()} disabled={!canSave || saveMutation.isPending}>
                {saveMutation.isPending ? "Saving…" : "Save credentials"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface UserSettings {
  notificationsEnabled: boolean;
  moodRemindersEnabled: boolean;
  reminderTime: string;
  reminderTime2: string;
  timezone: string;
  displayName: string;
}

export default function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const profileRef = useRef<ProfileQuestionsSettingsHandle>(null);

  const { data: settings, isLoading } = useQuery<UserSettings>({
    queryKey: ["/api/user/settings"],
    enabled: isOpen,
  });

  const { data: userMetrics = [] } = useQuery<UserMetric[]>({
    queryKey: ["/api/user-metrics"],
    enabled: isOpen,
  });

  // Form state
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [moodRemindersEnabled, setMoodRemindersEnabled] = useState(true);
  const [reminderTime, setReminderTime] = useState("09:00");
  const [reminderTime2, setReminderTime2] = useState("21:00");
  const [displayName, setDisplayName] = useState("");

  // Dark mode
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem("dbrief_theme") === "dark");

  // Health state
  const [healthAuthorized, setHealthAuthorized] = useState(getHealthAuthState);
  const [healthSyncing, setHealthSyncing] = useState(false);
  const [healthSyncResult, setHealthSyncResult] = useState<string | null>(null);
  const [healthSetupNeeded, setHealthSetupNeeded] = useState(false);
  const [healthRawError, setHealthRawError] = useState<string | null>(null);

  useEffect(() => {
    if (settings) {
      setNotificationsEnabled(settings.notificationsEnabled);
      setMoodRemindersEnabled(settings.moodRemindersEnabled ?? true);
      setReminderTime(settings.reminderTime);
      setReminderTime2(settings.reminderTime2);
      setDisplayName(settings.displayName ?? "");
    }
  }, [settings]);

  useEffect(() => {
    if (!isNativeIOS() || healthAuthorized) return;
    checkHealthAvailable().then(availability => {
      if (availability === "not_installed" || availability === "unavailable") {
        setHealthSetupNeeded(true);
        setHealthRawError(getLastHealthError());
      }
    });
  }, []);

  const handleToggleDarkMode = (enabled: boolean) => {
    setDarkMode(enabled);
    if (enabled) {
      document.documentElement.classList.add("dark");
      localStorage.setItem("dbrief_theme", "dark");
    } else {
      document.documentElement.classList.remove("dark");
      localStorage.setItem("dbrief_theme", "light");
    }
    haptic("select");
  };

  const updateSettingsMutation = useMutation({
    mutationFn: async (data: Partial<UserSettings>) => apiRequest("PATCH", "/api/user/settings", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user/settings"] });
      toast({ title: "Settings saved", description: "Your preferences have been updated." });
      onClose();
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save settings.", variant: "destructive" });
    },
  });

  const addMetricMutation = useMutation({
    mutationFn: async (data: { name: string; color: string; maxValue: number }) => apiRequest("POST", "/api/user-metrics", data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/user-metrics"] }),
    onError: () => toast({ title: "Error", description: "Failed to add metric.", variant: "destructive" }),
  });

  const deleteMetricMutation = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/user-metrics/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/user-metrics"] }),
  });

  const handleSave = () => {
    const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    updateSettingsMutation.mutate({ notificationsEnabled, moodRemindersEnabled, reminderTime, reminderTime2, timezone: userTimezone, displayName });
    // Also save profile section so users don't need to click a separate button
    profileRef.current?.save();
  };

  const handleToggleNotifications = async (enabled: boolean) => {
    setNotificationsEnabled(enabled);
    if (enabled) {
      if (isNativePlatform()) {
        const result = await registerNativePush();
        if (result === "granted") {
          toast({ title: "Notifications enabled", description: "You'll receive daily reminders." });
        } else if (result === "denied") {
          toast({ title: "Notifications blocked by iOS", description: "Go to iPhone Settings → DBrief → Notifications and enable them.", variant: "destructive" });
          openAppSettings();
        } else {
          const detail = typeof result === "string" && result.startsWith("error:") ? result.slice(6) : "unknown error";
          const isPluginMissing = detail.toLowerCase().includes("not implemented") || detail.toLowerCase().includes("not available");
          if (isPluginMissing) {
            toast({ title: "Grant permission in iOS Settings", description: "Go to iPhone Settings → DBrief → Notifications and turn them on." });
          } else {
            toast({ title: "Notification setup failed", description: `Error: ${detail}`, variant: "destructive" });
            setNotificationsEnabled(false);
          }
        }
      } else if ('Notification' in window) {
        const permission = await Notification.requestPermission();
        if (permission === 'granted') {
          await registerPushSubscription();
        } else {
          toast({ title: "Permission denied", description: "Please enable notifications in browser settings.", variant: "destructive" });
          setNotificationsEnabled(false);
        }
      }
    }
  };

  const registerPushSubscription = async () => {
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) throw new Error('Push notifications not supported');
      const registration = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      const vapidRes = await fetch('/api/push/vapid-public-key', { credentials: "include" });
      if (!vapidRes.ok) throw new Error('Push notifications not available');
      const { publicKey } = await vapidRes.json();
      const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
      await fetch('/api/push/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(subscription) });
      toast({ title: "Notifications enabled", description: "You'll receive daily reminders." });
    } catch (error) {
      console.error('Push subscription error:', error);
      toast({ title: "Error", description: "Failed to enable push notifications.", variant: "destructive" });
      setNotificationsEnabled(false);
    }
  };

  const urlBase64ToUint8Array = (base64String: string) => {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
    return outputArray;
  };

  const handleConnectHealth = async () => {
    setHealthSyncing(true);
    setHealthSyncResult(null);
    setHealthSetupNeeded(false);
    try {
      const result = await requestHealthPermissions();
      if (result === "granted") {
        setHealthAuthorized(true);
        const today = new Date().toISOString().split("T")[0];
        const enabledNames = userMetrics.filter(m => m.isActive).map(m => m.name);
        const syncResult = await syncHealthData(today, enabledNames);
        queryClient.invalidateQueries({ queryKey: ["/api/daily-scores"] });
        queryClient.invalidateQueries({ queryKey: ["/api/user-metrics"] });
        setHealthSyncResult(`Synced ${syncResult.synced} metric${syncResult.synced !== 1 ? "s" : ""}`);
        toast({ title: "Apple Health connected", description: `${syncResult.synced} metric${syncResult.synced !== 1 ? "s" : ""} synced for today.` });
      } else if (result === "not_installed") {
        setHealthSetupNeeded(true);
        setHealthRawError(getLastHealthError());
      } else if (result === "denied") {
        toast({ title: "Health access denied", description: "Open iOS Settings → Privacy & Security → Health → DBrief and enable all categories.", variant: "destructive" });
      } else {
        toast({ title: "Could not connect", description: "An unexpected error occurred. Try reinstalling the app.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Could not connect to Apple Health.", variant: "destructive" });
    } finally {
      setHealthSyncing(false);
    }
  };

  const handleSyncNow = async () => {
    setHealthSyncing(true);
    setHealthSyncResult(null);
    try {
      const today = new Date().toISOString().split("T")[0];
      const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];
      const enabledNames = userMetrics.filter(m => m.isActive).map(m => m.name);
      const [r1, r2] = await Promise.all([syncHealthData(today, enabledNames), syncHealthData(yesterday, enabledNames)]);
      const total = r1.synced + r2.synced;
      queryClient.invalidateQueries({ queryKey: ["/api/daily-scores"] });
      queryClient.invalidateQueries({ queryKey: ["/api/user-metrics"] });
      setHealthSyncResult(`Synced ${total} reading${total !== 1 ? "s" : ""}`);
      toast({ title: "Sync complete", description: `Updated ${total} health reading${total !== 1 ? "s" : ""}.` });
    } catch {
      toast({ title: "Sync failed", description: "Could not read Apple Health data.", variant: "destructive" });
    } finally {
      setHealthSyncing(false);
    }
  };

  const existingMetricNames = new Set(userMetrics.filter(m => m.isActive !== false).map(m => m.name.toLowerCase()));

  const handleToggleHealthMetric = async (metric: typeof APPLE_HEALTH_METRICS[0]) => {
    const existing = userMetrics.find(m => m.name.toLowerCase() === metric.name.toLowerCase());
    if (existing && existing.isActive !== false) {
      deleteMetricMutation.mutate(existing.id);
    } else {
      // Request permissions first so iOS prompts for any not yet granted (e.g. Sleep Analysis)
      const canAutoSync = isNativeIOS() && getHealthSyncableMetrics().includes(metric.name);
      if (canAutoSync) {
        await requestHealthPermissions();
      }
      // Add the metric, then immediately sync so the value appears without needing a relaunch
      await addMetricMutation.mutateAsync({ name: metric.name, color: metric.color, maxValue: metric.maxValue });
      if (canAutoSync && getHealthAuthState()) {
        setHealthSyncing(true);
        try {
          const today = new Date().toISOString().split("T")[0];
          const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];
          const [r1, r2] = await Promise.all([
            syncHealthData(today, [metric.name]),
            syncHealthData(yesterday, [metric.name]),
          ]);
          const total = r1.synced + r2.synced;
          queryClient.invalidateQueries({ queryKey: ["/api/daily-scores"] });
          if (total > 0) {
            setHealthSyncResult(`Synced ${metric.name}`);
          }
        } catch {
          // Non-fatal — metric is added, just no value yet
        } finally {
          setHealthSyncing(false);
        }
      }
    }
  };

  const groupedMetrics = CATEGORY_ORDER.map(category => ({
    category,
    metrics: APPLE_HEALTH_METRICS.filter(m => m.category === category),
  }));

  const activeMetricCount = userMetrics.filter(m => m.isActive !== false).length;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm flex flex-col p-0 gap-0" style={{ maxHeight: 'calc(90dvh - env(safe-area-inset-top) - env(safe-area-inset-bottom))' }}>
        {/* Header */}
        <DialogHeader className="px-5 pt-5 pb-4 shrink-0 border-b border-border/50">
          <DialogTitle className="text-base">Settings</DialogTitle>
          <DialogDescription className="text-xs">Manage your preferences and data sources.</DialogDescription>
        </DialogHeader>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2.5">
          {/* Invisible focus trap */}
          <input aria-hidden="true" readOnly tabIndex={-1} style={{ position: "absolute", opacity: 0, height: 0, width: 0, pointerEvents: "none" }} />

          {isLoading ? (
            <div className="py-8 text-center text-xs text-muted-foreground">Loading...</div>
          ) : (
            <>
              {/* ── Profile ─────────────────────────────────── */}
              <SettingsSection title="Profile" icon={<User className="h-4 w-4" />}>
                <div className="space-y-1.5">
                  <Label htmlFor="displayName" className="text-xs font-medium text-muted-foreground">Driver Name</Label>
                  <Input
                    id="displayName"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="First name (used by your AI engineer)"
                    className="h-9"
                    maxLength={40}
                  />
                  <p className="text-[11px] text-muted-foreground">Your name as the AI refers to you in debriefs.</p>
                </div>
                <div className="pt-1">
                  <p className="text-xs font-medium text-muted-foreground mb-2">Driver Profile</p>
                  <p className="text-[11px] text-muted-foreground mb-3">Your answers personalise how the AI engineer debriefs you.</p>
                  <ProfileQuestionsSettings ref={profileRef} />
                </div>
              </SettingsSection>

              {/* ── Notifications ────────────────────────────── */}
              <SettingsSection title="Notifications & Reminders" icon={<Bell className="h-4 w-4" />}>
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label className="text-sm flex items-center gap-2">
                      {notificationsEnabled ? <Bell className="h-3.5 w-3.5" /> : <BellOff className="h-3.5 w-3.5" />}
                      Daily Reminders
                    </Label>
                    <p className="text-[11px] text-muted-foreground">Get notified to log scores and keep your streak</p>
                  </div>
                  <Switch checked={notificationsEnabled} onCheckedChange={(v) => { haptic("select"); handleToggleNotifications(v); }} />
                </div>

                {notificationsEnabled && (
                  <div className="space-y-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="reminderTime" className="text-xs">Morning Reminder</Label>
                      <Input id="reminderTime" type="time" value={reminderTime} onChange={(e) => setReminderTime(e.target.value)} className="h-9" />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="reminderTime2" className="text-xs">Evening Reminder</Label>
                      <Input id="reminderTime2" type="time" value={reminderTime2} onChange={(e) => setReminderTime2(e.target.value)} className="h-9" />
                    </div>
                  </div>
                )}

                {notificationsEnabled && <NotificationPermissionHelper />}
                {notificationsEnabled && isNativePlatform() && <PushRegistrationStatus />}

                <div className="flex items-center justify-between pt-1">
                  <div className="space-y-0.5">
                    <Label className="text-sm flex items-center gap-2">
                      <Heart className="h-3.5 w-3.5 text-pink-500" />
                      Mood Check-ins
                    </Label>
                    <p className="text-[11px] text-muted-foreground">
                      {moodRemindersEnabled ? "Reminders at 8 AM, 1 PM, and 9 PM to log your mood." : "Mood check-in reminders are off."}
                    </p>
                  </div>
                  <Switch checked={moodRemindersEnabled} onCheckedChange={(v) => { haptic("select"); setMoodRemindersEnabled(v); }} />
                </div>
              </SettingsSection>

              {/* ── Health ───────────────────────────────────── */}
              <SettingsSection
                title="Health Metrics"
                icon={<Heart className="h-4 w-4 text-red-500" />}
                badge={activeMetricCount > 0 ? `${activeMetricCount} active` : undefined}
              >
                {isNativeIOS() ? (
                  healthAuthorized ? (
                    <div className="space-y-2">
                      <div className="rounded-md bg-emerald-500/10 border border-emerald-500/20 p-2.5 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                          <p className="text-[11px] text-emerald-700 dark:text-emerald-400 font-medium">Apple Health connected</p>
                        </div>
                        <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={handleSyncNow} disabled={healthSyncing}>
                          <RefreshCw className={`h-3 w-3 mr-1 ${healthSyncing ? "animate-spin" : ""}`} />
                          {healthSyncing ? "Syncing…" : "Sync now"}
                        </Button>
                      </div>
                      {healthSyncResult && (
                        <p className="text-[10px] text-muted-foreground px-0.5">{healthSyncResult} · select metrics below to choose what syncs</p>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {healthSetupNeeded && (
                        <div className="rounded-md bg-amber-500/10 border border-amber-500/20 p-2.5 space-y-1.5">
                          <div className="flex items-center gap-1.5">
                            <AlertCircle className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                            <p className="text-[11px] font-semibold text-amber-700 dark:text-amber-400">HealthKit plugin not active in this build</p>
                          </div>
                          <p className="text-[11px] text-amber-700 dark:text-amber-400 leading-relaxed">Run these steps from your Mac, then rebuild:</p>
                          <ol className="text-[11px] text-amber-700 dark:text-amber-400 space-y-0.5 list-decimal ml-3">
                            <li>Terminal: <span className="font-mono bg-amber-200/50 px-0.5 rounded">npx cap sync ios</span></li>
                            <li>Xcode → Target → Signing &amp; Capabilities → confirm <strong>HealthKit</strong></li>
                            <li>Info.plist → confirm both Health usage descriptions</li>
                            <li>Archive → Distribute via TestFlight</li>
                          </ol>
                          {healthRawError && (
                            <div className="mt-1 bg-amber-200/30 rounded px-2 py-1">
                              <p className="text-[10px] text-amber-800 font-mono break-all">Error: {healthRawError}</p>
                            </div>
                          )}
                        </div>
                      )}
                      <Button className="w-full h-9 text-sm gap-2" onClick={handleConnectHealth} disabled={healthSyncing} variant={healthSetupNeeded ? "outline" : "default"}>
                        <Heart className="h-4 w-4" />
                        {healthSyncing ? "Connecting…" : healthSetupNeeded ? "Try connecting anyway" : "Connect Apple Health"}
                      </Button>
                      {!healthSetupNeeded && (
                        <div className="space-y-1.5">
                          <p className="text-[11px] text-muted-foreground leading-relaxed">
                            Grant access so DBrief can read your health data and auto-fill your metrics.
                          </p>
                          <p className="text-[11px] text-amber-600 dark:text-amber-400 leading-relaxed">
                            <strong>Sleep not showing?</strong> iOS Settings → Privacy & Security → Health → DBrief → turn on Sleep Analysis.
                          </p>
                        </div>
                      )}
                    </div>
                  )
                ) : (
                  <div className="rounded-md bg-blue-500/10 border border-blue-500/20 p-2.5 flex gap-2">
                    <Info className="h-3.5 w-3.5 text-blue-600 shrink-0 mt-0.5" />
                    <div className="text-[11px] text-blue-700 dark:text-blue-400 leading-relaxed space-y-1">
                      <p><strong>Auto-sync requires the native app.</strong> Currently running in a browser — health data access requires the iOS app.</p>
                      <p>Select metrics below to <strong>manually track them now</strong>.</p>
                    </div>
                  </div>
                )}

                <div>
                  <p className="text-[11px] text-muted-foreground font-medium mb-2">Tap to add metrics to your dashboard:</p>
                  {isNativeIOS() && (
                    <p className="text-[10px] text-muted-foreground mb-2 leading-relaxed">⚡ = auto-syncs from Apple Health · others are entered manually</p>
                  )}
                  <div className="space-y-3">
                    {groupedMetrics.map(({ category, metrics }) => (
                      <div key={category}>
                        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">{category}</p>
                        <div className="space-y-1">
                          {metrics.map((metric) => {
                            const isAdded = existingMetricNames.has(metric.name.toLowerCase());
                            const isPending = addMetricMutation.isPending || deleteMetricMutation.isPending;
                            const canAutoSync = getHealthSyncableMetrics().includes(metric.name);
                            return (
                              <button
                                key={metric.name}
                                onClick={() => !isPending && handleToggleHealthMetric(metric)}
                                className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-left transition-colors ${
                                  isAdded ? "bg-primary/10 border border-primary/20" : "hover:bg-muted border border-transparent"
                                }`}
                              >
                                <div className="flex items-center gap-2">
                                  <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: metric.color }} />
                                  <span className="text-xs text-foreground">{metric.name}</span>
                                  {metric.unit && <span className="text-[10px] text-muted-foreground">({metric.unit})</span>}
                                  {isNativeIOS() && canAutoSync && <span className="text-[9px] text-primary font-semibold">⚡</span>}
                                </div>
                                {isAdded ? <Check className="h-3.5 w-3.5 text-primary shrink-0" /> : <Plus className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </SettingsSection>

              {/* ── Appearance ──────────────────────────────── */}
              <SettingsSection title="Appearance" icon={darkMode ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}>
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label className="text-sm flex items-center gap-2">
                      {darkMode ? <Moon className="h-3.5 w-3.5" /> : <Sun className="h-3.5 w-3.5" />}
                      Dark Mode
                    </Label>
                    <p className="text-[11px] text-muted-foreground">Switch to a dark colour theme</p>
                  </div>
                  <Switch checked={darkMode} onCheckedChange={handleToggleDarkMode} />
                </div>
              </SettingsSection>

              {/* ── App ─────────────────────────────────────── */}
              <SettingsSection title="App" icon={<Map className="h-4 w-4" />}>
                <button
                  onClick={() => { resetTour(); onClose(); }}
                  className="flex items-center gap-2 text-sm text-foreground hover:text-primary transition-colors py-1"
                >
                  <Map className="h-3.5 w-3.5 text-muted-foreground" />
                  Replay app tour
                </button>
              </SettingsSection>
            </>
          )}
        </div>

        {/* Sticky footer — always visible */}
        {!isLoading && (
          <div className="shrink-0 px-4 py-3.5 border-t border-border/50 bg-background flex items-center justify-between gap-3">
            <p className="text-[11px] text-muted-foreground">Changes to reminders and name need saving.</p>
            <Button size="sm" onClick={handleSave} disabled={updateSettingsMutation.isPending} className="shrink-0">
              {updateSettingsMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
