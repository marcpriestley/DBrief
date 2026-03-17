import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { Bell, BellOff, AlertCircle, CheckCircle2, Heart } from "lucide-react";

function NotificationPermissionHelper() {
  const [permissionState, setPermissionState] = useState<NotificationPermission | "unsupported">("default");

  useEffect(() => {
    if (!("Notification" in window)) {
      setPermissionState("unsupported");
    } else {
      setPermissionState(Notification.permission);
    }
  }, []);

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

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const ALL_HEALTH_METRICS = [
  { key: "sleep", label: "Sleep Quality" },
  { key: "readiness", label: "Readiness" },
  { key: "activity", label: "Activity" },
];

interface UserSettings {
  notificationsEnabled: boolean;
  reminderTime: string;
  reminderTime2: string;
  timezone: string;
  healthMetricsEnabled: string[];
}

export default function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: settings, isLoading } = useQuery<UserSettings>({
    queryKey: ["/api/user/settings"],
    enabled: isOpen,
  });

  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [reminderTime, setReminderTime] = useState("09:00");
  const [reminderTime2, setReminderTime2] = useState("21:00");
  const [healthMetricsEnabled, setHealthMetricsEnabled] = useState<string[]>(["sleep", "readiness", "activity"]);

  useEffect(() => {
    if (settings) {
      setNotificationsEnabled(settings.notificationsEnabled);
      setReminderTime(settings.reminderTime);
      setReminderTime2(settings.reminderTime2);
      setHealthMetricsEnabled(settings.healthMetricsEnabled ?? ["sleep", "readiness", "activity"]);
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

  const toggleHealthMetric = (key: string) => {
    setHealthMetricsEnabled(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    );
  };

  const handleSave = () => {
    const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    updateSettingsMutation.mutate({ notificationsEnabled, reminderTime, reminderTime2, timezone: userTimezone, healthMetricsEnabled });
  };

  const handleToggleNotifications = async (enabled: boolean) => {
    setNotificationsEnabled(enabled);
    
    if (enabled) {
      if ('Notification' in window) {
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

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-base">Settings</DialogTitle>
          <DialogDescription className="text-xs">Manage notifications and preferences.</DialogDescription>
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
                <p className="text-xs font-medium text-foreground">Apple Health</p>
              </div>
              <div className="rounded-md bg-amber-500/10 border border-amber-500/20 p-2.5">
                <p className="text-[11px] text-amber-700 leading-relaxed">
                  Apple Health sync requires the native iOS app (built with Capacitor). On your phone, go to <strong>Health → Apps → DBrief</strong> and make sure the permissions are enabled for the metrics below.
                </p>
              </div>
              <div className="space-y-2">
                <p className="text-[11px] text-muted-foreground font-medium">Choose which metrics to sync:</p>
                {ALL_HEALTH_METRICS.map(({ key, label }) => (
                  <div key={key} className="flex items-center justify-between">
                    <span className="text-xs text-foreground">{label}</span>
                    <Switch
                      checked={healthMetricsEnabled.includes(key)}
                      onCheckedChange={() => toggleHealthMetric(key)}
                    />
                  </div>
                ))}
              </div>
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
