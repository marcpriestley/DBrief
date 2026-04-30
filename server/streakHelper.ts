import { storage, todayInTz } from "./storage";

export async function updateUserStreak(userId: number, entryDate: string): Promise<void> {
  try {
    let streak = await storage.getUserStreak(userId);
    const user = await storage.getUser(userId);
    const today = todayInTz(user?.timezone);
    const yesterdayDate = new Date(new Date(today + "T12:00:00Z").getTime() - 86400000);
    const yesterdayStr = yesterdayDate.toISOString().split("T")[0];

    if (!streak) {
      await storage.createStreak({
        userId,
        currentStreak: 1,
        longestStreak: 1,
        lastEntryDate: entryDate,
      });
      return;
    }

    if (entryDate === today) {
      if (streak.lastEntryDate === yesterdayStr) {
        const newCurrentStreak = (streak.currentStreak ?? 0) + 1;
        await storage.updateStreak(userId, {
          currentStreak: newCurrentStreak,
          longestStreak: Math.max(streak.longestStreak ?? 0, newCurrentStreak),
          lastEntryDate: entryDate,
        });
      } else if (streak.lastEntryDate !== today) {
        await storage.updateStreak(userId, {
          currentStreak: 1,
          lastEntryDate: entryDate,
        });
      }
    }
  } catch (error) {
    console.error("Failed to update streak:", error);
  }
}
