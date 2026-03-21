import { useState, useEffect } from "react";
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
import { Bell, BellOff, AlertCircle, CheckCircle2, Heart, Plus, Check, Info, User } from "lucide-react";
import type { UserMetric } from "@shared/schema";
import { ProfileQuestionsSettings } from "./ProfileQuestions";

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
  { name: "Stand Hours",         category: "Activity",     color: "#06B6D4", maxValue: 12,    unit: "hrs" },
  { name: "Flights Climbed",     category: "Activity",     color: "#84CC16", maxValue: 20,    unit: "" },
  { name: "Walking Distance",    category: "Activity",     color: "#0EA5E9", maxValue: 10,    unit: "km" },
  { name: "Sleep Duration",      category: "Sleep",        color: "#4F46E5", maxValue: 10,    unit: "hrs" },
  { name: "Sleep Quality",       category: "Sleep",        color: "#7C3AED", maxValue: 100,   unit: "/100" },
  { name: "Heart Rate",          category: "Heart",        color: "#EF4444", maxValue: 200,   unit: "bpm" },
  { name: "Resting Heart Rate",  category: "Heart",        color: "#E11D48", maxValue: 100,   unit: "bpm" },
  { name: "HRV",                 category: "Heart",        color: "#8B5CF6", maxValue: 120,   unit: "ms" },
  { name: "Blood Oxygen",        category: "Heart",        color: "#38BDF8", maxValue: 100,   unit: "%" },
  { name: "Body Weight",         category: "Body",         color: "#EC4899", maxValue: 200,   unit: "kg" },
  { name: "Body Fat %",          category: "Body",         color: "#F97316", maxValue: 50,    unit: "%" },
  { name: "BMI",                 category: "Body",         color: "#6366F1", maxValue: 40,    unit: "" },
  { name: "Mindful Minutes",     category: "Mindfulness",  color: "#14B8A6", maxValue: 60,    unit: "min" },
  { name: "Respiratory Rate",    category: "Respiratory",  color: "#64748B", maxValue: 30,    unit: "brpm" },
  { name: "Water",               category: "Nutrition",    color: "#0EA5E9", maxValue: 4,     unit: "L" },
];

const CATEGORY_ORDER = ["Activity", "Sleep", "Heart", "Body", "Mindfulness", "Respiratory", "Nutrition"];

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
      PushNotifications.checkPermissions().then((result) => {
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
        <p className="text-xs text-emerald-700">Notifications are active. DBrief will appear in your iPhone notification settings.</p>
      </div>
    );
  }

  if (permissionState === "native-denied") {
    return (
      <div className="flex items-start gap-2.5 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
        <AlertCircle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
        <div className="text-xs text-amber-700 space-y-2 flex-1">
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
        <p className="text-xs text-blue-700">Toggle <strong>Daily Reminders</strong> on to request notification permission from iOS.</p>
      </div>
    );
  }

  if (permissionState === "granted") {
    return (
      <div className="flex items-start gap-2.5 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
        <CheckCircle2 className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />
        <p className="text-xs text-emerald-700">Notifications are enabled. You're all set!</p>
      </div>
    );
  }

  if (permissionState === "denied") {
    return (
      <div className="flex items-start gap-2.5 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
        <AlertCircle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
        <div className="text-xs text-amber-700">
          <p className="font-medium mb-1">Notifications are blocked</p>
          <ol className="list-decimal ml-3 space-y-0.5 text[11px]">
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

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface UserSettings {
  notificationsEnabled: boolean;
  reminderTime: string;
  reminderTime2: string;
  timezone: string;
}

export default function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: settings, isLoading } = useQuery<UserSettings>({
    queryKey: ["/api/user/settings"],
    enabled: isOpen,
  });

  const { data: userMetrics = [] } = useQuery<UserMetric[]>({
    queryKey: ["/api/user-metrics"],
    enabled: isOpen,
  });

  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [reminderTime, setReminderTime] = useState("09:00");
  const [reminderTime2, setReminderTime2] = useState("21:00");

  useEffect(() => {
    if (settings) {
      setNotificationsEnabled(settings.notificationsEnabled);
      setReminderTime(settings.reminderTime);
      setReminderTime2(settings.reminderTime2);
    }
  }, [settings]);

  const updateSettingsMutation = useMutation({
    mutationFn: async (data: Partial<UserSettings>) => {
      return apiRequest("PATCH", "/api/user/settings", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user/settings"] });
      toast({ title: "Settings saved", description: "Your preferences have been updated." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save settings.", variant: "destructive" });
    },
  });

  const addMetricMutation = useMutation({
    mutationFn: async (data: { name: string; color: string; maxValue: number }) => {
      return apiRequest("POST", "/api/user-metrics", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user-metrics"] });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to add metric.", variant: "destructive" });
    },
  });

  const deleteMetricMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest("DELETE", `/api/user-metrics/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user-metrics"] });
    },
  });

  const handleSave = () => {
    const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    updateSettingsMutation.mutate({ notificationsEnabled, reminderTime, reminderTime2, timezone: userTimezone });
  };

  const handleToggleNotifications = async (enabled: boolean) => {
    setNotificationsEnabled(enabled);
    
    if (enabled) {
      if (isNativePlatform()) {
        const result = await registerNativePush();
        if (result === "granted") {
          toast({ title: "Notifications enabled", description: "You'll receive daily reminders." });
        } else if (result === "denied") {
          toast({
            title: "Notifications blocked by iOS",
            description: "Go to iPhone Settings → DBrief → Notifications and enable them.",
            variant: "destructive",
          });
          openAppSettings();
        } else {
          const detail = typeof result === "string" && result.startsWith("error:") ? result.slice(6) : "unknown error";
          toast({ title: "Notification setup failed", description: `Debug: ${detail}`, variant: "destructive" });
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
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        throw new Error('Push notifications not supported');
      }

      const registration = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;

      const vapidRes = await fetch('/api/push/vapid-public-key', { credentials: "include" });
      if (!vapidRes.ok) throw new Error('Push notifications not available');
      const { publicKey } = await vapidRes.json();

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey)
      });

      await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(subscription)
      });

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
    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  };

  const existingMetricNames = new Set(
    userMetrics.filter(m => m.isActive !== false).map(m => m.name.toLowerCase())
  );

  const handleToggleHealthMetric = (metric: typeof APPLE_HEALTH_METRICS[0]) => {
    const existing = userMetrics.find(m => m.name.toLowerCase() === metric.name.toLowerCase());
    if (existing && existing.isActive !== false) {
      deleteMetricMutation.mutate(existing.id);
    } else {
      addMetricMutation.mutate({ name: metric.name, color: metric.color, maxValue: metric.maxValue });
    }
  };

  const groupedMetrics = CATEGORY_ORDER.map(category => ({
    category,
    metrics: APPLE_HEALTH_METRICS.filter(m => m.category === category),
  }));

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base">Settings</DialogTitle>
          <DialogDescription className="text-xs">Manage notifications and health metric preferences.</DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="py-8 text-center text-xs text-muted-foreground">Loading...</div>
        ) : (
          <div className="space-y-5 py-2">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-sm flex items-center gap-2">
                  {notificationsEnabled ? <Bell className="h-3.5 w-3.5" /> : <BellOff className="h-3.5 w-3.5" />}
                  Daily Reminders
                </Label>
                <p className="text-[11px] text-muted-foreground">
                  Get notified to log scores and keep your streak
                </p>
              </div>
              <Switch
                checked={notificationsEnabled}
                onCheckedChange={handleToggleNotifications}
              />
            </div>

            {notificationsEnabled && (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="reminderTime" className="text-xs">Morning Reminder</Label>
                  <Input
                    id="reminderTime"
                    type="time"
                    value={reminderTime}
                    onChange={(e) => setReminderTime(e.target.value)}
                    className="h-9"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="reminderTime2" className="text-xs">Evening Reminder</Label>
                  <Input
                    id="reminderTime2"
                    type="time"
                    value={reminderTime2}
                    onChange={(e) => setReminderTime2(e.target.value)}
                    className="h-9"
                  />
                </div>
              </div>
            )}

            {notificationsEnabled && <NotificationPermissionHelper />}

            <div className="rounded-lg bg-muted/50 border border-border/50 p-3 space-y-1.5">
              <div className="flex items-center gap-1.5">
                <Heart className="h-3 w-3 text-pink-500" />
                <p className="text-xs font-medium text-foreground">Mood Reminders</p>
              </div>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Three daily check-ins at 8 AM, 1 PM, and 9 PM (your local time).
              </p>
            </div>

            <div className="rounded-lg bg-muted/50 border border-border/50 p-3 space-y-3">
              <div className="flex items-center gap-1.5">
                <Heart className="h-3 w-3 text-red-500" />
                <p className="text-xs font-medium text-foreground">Health Metrics</p>
              </div>

              {isNativePlatform() ? (
                <div className="rounded-md bg-muted/80 border border-border/50 p-2.5 flex gap-2">
                  <Info className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    Metrics are currently tracked manually. Apple Health auto-sync will be added in a future update — select any metrics below to add them to your dashboard now.
                  </p>
                </div>
              ) : (
                <div className="rounded-md bg-blue-500/10 border border-blue-500/20 p-2.5 flex gap-2">
                  <Info className="h-3.5 w-3.5 text-blue-600 shrink-0 mt-0.5" />
                  <div className="text-[11px] text-blue-700 leading-relaxed space-y-1">
                    <p><strong>Auto-sync requires the native app.</strong> DBrief is currently running in a browser — health data access requires the iOS app.</p>
                    <p>Select metrics below to <strong>manually track them now</strong>. Once the native app is installed, they'll auto-sync from Apple Health.</p>
                  </div>
                </div>
              )}

              <p className="text-[11px] text-muted-foreground font-medium">Tap to add metrics to your dashboard:</p>

              <div className="space-y-3">
                {groupedMetrics.map(({ category, metrics }) => (
                  <div key={category}>
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">{category}</p>
                    <div className="space-y-1">
                      {metrics.map((metric) => {
                        const isAdded = existingMetricNames.has(metric.name.toLowerCase());
                        const isPending = addMetricMutation.isPending || deleteMetricMutation.isPending;
                        return (
                          <button
                            key={metric.name}
                            onClick={() => !isPending && handleToggleHealthMetric(metric)}
                            className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-left transition-colors ${
                              isAdded
                                ? "bg-primary/10 border border-primary/20"
                                : "hover:bg-muted border border-transparent"
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: metric.color }} />
                              <span className="text-xs text-foreground">{metric.name}</span>
                              {metric.unit && (
                                <span className="text-[10px] text-muted-foreground">({metric.unit})</span>
                              )}
                            </div>
                            {isAdded ? (
                              <Check className="h-3.5 w-3.5 text-primary shrink-0" />
                            ) : (
                              <Plus className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="border-t border-border pt-4">
              <div className="flex items-center gap-2 mb-3">
                <User className="h-3.5 w-3.5 text-muted-foreground" />
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Driver Profile</p>
              </div>
              <p className="text-xs text-muted-foreground mb-3">Your answers personalise how the AI engineer debriefs you.</p>
              <ProfileQuestionsSettings />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
              <Button size="sm" onClick={handleSave} disabled={updateSettingsMutation.isPending}>
                {updateSettingsMutation.isPending ? "Saving..." : "Save"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
