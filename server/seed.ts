import { db } from "./db";
import { users, userMetrics, journalEntries, dailyScores, streaks } from "@shared/schema";

async function seed() {
  console.log("Seeding database...");

  // Create demo user
  const [demoUser] = await db
    .insert(users)
    .values({
      username: "demo",
      password: "demo",
    })
    .onConflictDoNothing()
    .returning();

  const userId = demoUser?.id || 1;

  // Create default metrics
  const defaultMetrics = [
    { userId, name: "Happiness", color: "#10B981", isDefault: true, isActive: true },
    { userId, name: "Productivity", color: "#4F46E5", isDefault: true, isActive: true },
    { userId, name: "Energy", color: "#F59E0B", isDefault: true, isActive: true },
    { userId, name: "Sleep", color: "#8B5CF6", isDefault: false, isActive: true },
    { userId, name: "Recovery", color: "#EF4444", isDefault: false, isActive: true },
    { userId, name: "Steps", color: "#22C55E", isDefault: false, isActive: true },
  ];

  await db
    .insert(userMetrics)
    .values(defaultMetrics)
    .onConflictDoNothing();

  // Create sample journal entries
  const today = new Date();
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  const dayBeforeYesterday = new Date(today.getTime() - 2 * 24 * 60 * 60 * 1000);

  const sampleEntries = [
    {
      userId,
      date: today.toISOString().split('T')[0],
      content: "Had a great day today! Started with morning exercise and felt energized throughout. Work was productive - finished the quarterly report and had a good team meeting. Evening walk in the park was refreshing.",
      isVoiceEntry: false,
    },
    {
      userId,
      date: yesterday.toISOString().split('T')[0],
      content: "Feeling a bit overwhelmed with work deadlines. Had trouble sleeping last night. Need to focus on time management and stress reduction. Did some meditation which helped a bit.",
      isVoiceEntry: false,
    },
    {
      userId,
      date: dayBeforeYesterday.toISOString().split('T')[0],
      content: "Beautiful weekend! Spent time with family and friends. Went hiking and enjoyed nature. Feeling grateful for the people in my life. This is the kind of balance I want to maintain.",
      isVoiceEntry: true,
    },
  ];

  await db
    .insert(journalEntries)
    .values(sampleEntries)
    .onConflictDoNothing();

  // Create sample daily scores - only for previous days, not today
  const sampleScores = [
    // Yesterday's scores
    { userId, date: yesterday.toISOString().split('T')[0], metricName: "Happiness", value: 65, isAutoSynced: false },
    { userId, date: yesterday.toISOString().split('T')[0], metricName: "Productivity", value: 55, isAutoSynced: false },
    { userId, date: yesterday.toISOString().split('T')[0], metricName: "Energy", value: 60, isAutoSynced: false },
    { userId, date: yesterday.toISOString().split('T')[0], metricName: "Sleep", value: 45, isAutoSynced: true },
    
    // Day before yesterday's scores
    { userId, date: dayBeforeYesterday.toISOString().split('T')[0], metricName: "Happiness", value: 90, isAutoSynced: false },
    { userId, date: dayBeforeYesterday.toISOString().split('T')[0], metricName: "Productivity", value: 70, isAutoSynced: false },
    { userId, date: dayBeforeYesterday.toISOString().split('T')[0], metricName: "Energy", value: 88, isAutoSynced: false },
    { userId, date: dayBeforeYesterday.toISOString().split('T')[0], metricName: "Sleep", value: 80, isAutoSynced: true },
  ];

  await db
    .insert(dailyScores)
    .values(sampleScores)
    .onConflictDoNothing();

  // Create default streak
  await db
    .insert(streaks)
    .values({
      userId,
      currentStreak: 7,
      longestStreak: 12,
      lastEntryDate: today.toISOString().split('T')[0],
    })
    .onConflictDoNothing();

  console.log("Database seeded successfully!");
}

// Run seed if this file is executed directly
seed()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Error seeding database:", error);
    process.exit(1);
  });

export { seed };