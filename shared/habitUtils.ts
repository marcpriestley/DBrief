// Shared habit text normalization utilities (used by client and server)

function gerundToBase(word: string): string {
  const w = word.toLowerCase();
  // double-consonant pattern: running → run, sitting → sit, swimming → swim
  if (/([^aeiou])\1ing$/.test(w)) return w.replace(/([^aeiou])\1ing$/, "$1");
  // simple -ing removal: eating → eat, drinking → drink, walking → walk
  // (we avoid -e reinsertion — "making" → "mak" would be wrong, but it's an edge case
  //  that rarely matters in practice for habit names)
  if (/[^e]ing$/i.test(w)) return w.replace(/ing$/i, "");
  return w;
}

/**
 * Normalise an anchor string so it reads well after "After".
 *   "Morning coffee"   → "morning coffee"
 *   "brushing my teeth"→ "brushing my teeth"
 * We just lowercase the first letter — users already tend to phrase anchors correctly.
 */
export function normalizeAnchor(text: string): string {
  const t = text.trim();
  if (!t) return t;
  return t.charAt(0).toLowerCase() + t.slice(1);
}

/**
 * Normalise a habit name so it reads well after "I will".
 *   "Drink more water"        → "drink more water"
 *   "Drinking more water"     → "drink more water"
 *   "I'll exercise"           → "exercise"
 *   "I am going to meditate"  → "meditate"
 *   "go for a walk"           → "go for a walk"
 */
export function normalizeHabitName(text: string): string {
  let t = text.trim();
  // strip leading pronoun phrases
  t = t.replace(/^I(?:'ll|'m going to| am going to| will| gonna|\s+gonna|'m)?\s+/i, "");
  // lowercase first letter
  if (t.length > 0) t = t.charAt(0).toLowerCase() + t.slice(1);
  // convert leading gerund to base verb
  const m = t.match(/^([a-z]+ing)\b/i);
  if (m) {
    const base = gerundToBase(m[1]);
    t = base + t.slice(m[1].length);
  }
  return t;
}

/**
 * Build the full stacking sentence: "After <anchor>, I will <habit>"
 */
export function stackingSentence(anchor: string, habitName: string): string {
  return `After ${normalizeAnchor(anchor)}, I will ${normalizeHabitName(habitName)}`;
}

/**
 * Build the notification body for an anchor-stacked habit.
 * e.g. "After brushing my teeth, time to drink more water."
 */
export function habitNotificationBody(anchor: string | null | undefined, habitName: string, streak: number): string {
  const normalised = normalizeHabitName(habitName);
  const intro = anchor
    ? `After ${normalizeAnchor(anchor)}, time to ${normalised}.`
    : `Time to ${normalised}.`;
  const streakSuffix = streak > 0 ? ` Keep your ${streak}-day streak alive!` : "";
  return intro + streakSuffix;
}

// ─── Frequency / scheduling helpers ──────────────────────────────────────────

/**
 * Returns true if a habit should appear on the given date based on its frequency.
 * date: YYYY-MM-DD string
 *
 * startDate (if set) gates visibility — days before startDate are never due.
 * startDate also serves as the anchor for `alternate` and `weekly` patterns so
 * that "start tomorrow" shifts the entire cycle correctly.
 */
export function isHabitDueToday(
  habit: {
    frequency?: string | null;
    specificDays?: string | null;
    startDate?: string | null;
    createdAt?: Date | string | null;
  },
  date: string
): boolean {
  // ── Start-date gate ──────────────────────────────────────────────────────
  // Prefer explicit startDate; fall back to the createdAt calendar date.
  const effectiveStartDate =
    habit.startDate ||
    (habit.createdAt
      ? new Date(habit.createdAt).toISOString().split("T")[0]
      : null);
  if (effectiveStartDate && date < effectiveStartDate) return false;

  const freq = habit.frequency || "daily";

  // Always visible once past start date
  if (freq === "daily" || freq === "multiple_daily") return true;

  const d = new Date(date + "T12:00:00");
  const dow = d.getDay(); // 0=Sun … 6=Sat

  if (freq === "weekdays") return dow >= 1 && dow <= 5;
  if (freq === "weekends") return dow === 0 || dow === 6;

  if (freq === "specific_days") {
    const days = (habit.specificDays || "")
      .split(",")
      .map(s => parseInt(s.trim(), 10))
      .filter(n => !isNaN(n));
    return days.includes(dow);
  }

  // For `alternate` and `weekly`, use startDate as the cycle anchor so that
  // "start tomorrow" shifts the pattern correctly. Fall back to createdAt.
  const anchorStr =
    habit.startDate ||
    (habit.createdAt
      ? new Date(habit.createdAt).toISOString().split("T")[0]
      : new Date().toISOString().split("T")[0]);
  const anchorDate = new Date(anchorStr + "T12:00:00");

  if (freq === "alternate") {
    const diff = Math.round(
      (d.getTime() - anchorDate.getTime()) / (1000 * 60 * 60 * 24)
    );
    return diff >= 0 && diff % 2 === 0;
  }

  if (freq === "weekly") {
    return dow === anchorDate.getDay();
  }

  return true;
}

// ─── Interval reminder helpers ───────────────────────────────────────────────

/**
 * Given a habit's reminderTime, reminderInterval (minutes), and reminderEndTime,
 * return all scheduled HH:MM time slots for that habit.
 */
export function getIntervalSlots(
  startTime: string,
  intervalMinutes: number,
  endTime: string
): string[] {
  const slots: string[] = [];
  const [startH, startM] = startTime.split(":").map(Number);
  const [endH, endM] = endTime.split(":").map(Number);
  let currentMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;
  while (currentMinutes <= endMinutes) {
    const h = Math.floor(currentMinutes / 60);
    const m = currentMinutes % 60;
    slots.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
    currentMinutes += intervalMinutes;
  }
  return slots;
}
