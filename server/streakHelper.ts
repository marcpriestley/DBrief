import { storage, todayInTz } from "./storage";

const FREEZE_CAP = 5;

export interface StreakUpdateResult {
  streakProtected: boolean;
  freezesAwarded: number;
  freezeReason: string | null;
  newStreak: number;
}

/**
 * Calculate how many freezes should be awarded for reaching a given streak.
 * Rules:
 *  - Every multiple of 7: +1
 *  - 30: +1 bonus (30 is not a multiple of 7, so no overlap)
 *  - 90: +2 bonus (90 is not a multiple of 7)
 *  - 365: +3 bonus (365 is not a multiple of 7)
 */
function calcFreezeAward(newStreak: number): { amount: number; reason: string } | null {
  if (newStreak <= 0) return null;
  let amount = 0;
  const parts: string[] = [];

  if (newStreak % 7 === 0) {
    amount += 1;
    parts.push(`${newStreak}-day interval`);
  }
  if (newStreak === 30) { amount += 1; parts.push("30-day bonus"); }
  if (newStreak === 90) { amount += 2; parts.push("90-day bonus"); }
  if (newStreak === 365) { amount += 3; parts.push("365-day bonus"); }

  if (amount === 0) return null;
  return { amount, reason: parts.join(" + ") };
}

export async function updateUserStreak(
  userId: number,
  entryDate: string,
): Promise<StreakUpdateResult> {
  const result: StreakUpdateResult = {
    streakProtected: false,
    freezesAwarded: 0,
    freezeReason: null,
    newStreak: 0,
  };

  try {
    let streak = await storage.getUserStreak(userId);
    const user = await storage.getUser(userId);
    const today = todayInTz(user?.timezone);
    const yesterdayMs = new Date(today + "T12:00:00Z").getTime() - 86_400_000;
    const yesterdayStr = new Date(yesterdayMs).toISOString().split("T")[0];
    const twoDaysAgoStr = new Date(yesterdayMs - 86_400_000).toISOString().split("T")[0];

    if (!streak) {
      await storage.createStreak({
        userId,
        currentStreak: 1,
        longestStreak: 1,
        lastEntryDate: entryDate,
        streakFreezes: 0,
      });
      result.newStreak = 1;
      return result;
    }

    result.newStreak = streak.currentStreak ?? 0;

    if (entryDate !== today) return result; // Only act on today's entry

    const freezeBalance = streak.streakFreezes ?? 0;

    if (streak.lastEntryDate === yesterdayStr) {
      // ── Normal increment ───────────────────────────────────────────────────
      const newCurrentStreak = (streak.currentStreak ?? 0) + 1;
      const award = calcFreezeAward(newCurrentStreak);
      let newFreezeBalance = freezeBalance;

      if (award) {
        const canAward = Math.min(award.amount, FREEZE_CAP - freezeBalance);
        if (canAward > 0) {
          newFreezeBalance = freezeBalance + canAward;
          result.freezesAwarded = canAward;
          result.freezeReason = award.reason;
          await storage.createStreakFreezeEvent({
            userId,
            eventType: "earned",
            reason: award.reason,
            amount: canAward,
          });
        }
      }

      await storage.updateStreak(userId, {
        currentStreak: newCurrentStreak,
        longestStreak: Math.max(streak.longestStreak ?? 0, newCurrentStreak),
        lastEntryDate: entryDate,
        streakFreezes: newFreezeBalance,
      });
      result.newStreak = newCurrentStreak;

    } else if (streak.lastEntryDate === twoDaysAgoStr && freezeBalance > 0) {
      // ── One missed day — consume a freeze ─────────────────────────────────
      const newFreezeBalance = freezeBalance - 1;
      await storage.updateStreak(userId, {
        lastEntryDate: entryDate,
        streakFreezes: newFreezeBalance,
        freezeUsedDate: yesterdayStr,
      });
      await storage.createStreakFreezeEvent({
        userId,
        eventType: "used",
        reason: "missed-day-protection",
        amount: 1,
      });
      result.streakProtected = true;
      result.newStreak = streak.currentStreak ?? 0;

    } else if (streak.lastEntryDate !== today) {
      // ── Reset ─────────────────────────────────────────────────────────────
      await storage.updateStreak(userId, {
        currentStreak: 1,
        lastEntryDate: entryDate,
      });
      result.newStreak = 1;
    }
  } catch (error) {
    console.error("Failed to update streak:", error);
  }
  return result;
}

/**
 * Check whether the user's total activity points have crossed a new 500-point
 * threshold that hasn't been awarded yet, and if so award +1 freeze per new
 * threshold (still capped at 5). Call after any activity that might earn points.
 */
export async function checkActivityPointFreeze(
  userId: number,
): Promise<{ awarded: number }> {
  try {
    const [streak, currentPoints, awardedThresholds] = await Promise.all([
      storage.getUserStreak(userId),
      storage.getUserPoints(userId),
      // Purpose-built query fetches ALL awarded thresholds (no pagination limit)
      storage.getAwardedActivityPointThresholds(userId),
    ]);

    const freezeBalance = streak?.streakFreezes ?? 0;
    if (freezeBalance >= FREEZE_CAP) return { awarded: 0 };

    const maxThreshold = Math.floor(currentPoints / 500) * 500;
    let newlyAwarded = 0;

    for (let t = 500; t <= maxThreshold && freezeBalance + newlyAwarded < FREEZE_CAP; t += 500) {
      if (!awardedThresholds.has(t)) {
        await storage.createStreakFreezeEvent({
          userId,
          eventType: "earned",
          reason: `activity-points-${t}`,
          amount: 1,
        });
        newlyAwarded++;
        // Track locally so we don't re-award within the same call for multiple thresholds
        awardedThresholds.add(t);
      }
    }

    if (newlyAwarded > 0) {
      await storage.updateStreak(userId, {
        streakFreezes: Math.min(FREEZE_CAP, freezeBalance + newlyAwarded),
      });
    }

    return { awarded: newlyAwarded };
  } catch (e) {
    console.error("checkActivityPointFreeze error:", e);
    return { awarded: 0 };
  }
}
