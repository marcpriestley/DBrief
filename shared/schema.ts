import { pgTable, text, serial, integer, date, timestamp, jsonb, boolean } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  displayName: text("display_name"),
  notificationsEnabled: boolean("notifications_enabled").default(true),
  moodRemindersEnabled: boolean("mood_reminders_enabled").default(true),
  reminderTime: text("reminder_time").default("09:00"),
  reminderTime2: text("reminder_time_2").default("21:00"),
  timezone: text("timezone").default("UTC"),
  healthMetricsEnabled: text("health_metrics_enabled").array().default(["sleep", "readiness", "activity"]),
  hasCompletedOnboarding: boolean("has_completed_onboarding").default(false),
  journalPreference: text("journal_preference").default("evening"),
  goalPreference: text("goal_preference").default("morning"),
  userProfile: jsonb("user_profile").$type<Record<string, string>>(),
});

export const journalEntries = pgTable("journal_entries", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  date: date("date").notNull(),
  content: text("content").notNull(),
  isVoiceEntry: boolean("is_voice_entry").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const dailyScores = pgTable("daily_scores", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  date: date("date").notNull(),
  metricName: text("metric_name").notNull(),
  value: integer("value").notNull(),
  isAutoSynced: boolean("is_auto_synced").default(false),
});

export const userMetrics = pgTable("user_metrics", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  name: text("name").notNull(),
  color: text("color").notNull(),
  maxValue: integer("max_value").default(100),
  isDefault: boolean("is_default").default(false),
  isActive: boolean("is_active").default(true),
});

export const streaks = pgTable("streaks", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  currentStreak: integer("current_streak").default(0),
  longestStreak: integer("longest_streak").default(0),
  lastEntryDate: date("last_entry_date"),
});

export const aiInsights = pgTable("ai_insights", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  insight: text("insight").notNull(),
  tags: text("tags").array(),
  createdAt: timestamp("created_at").defaultNow(),
  isActive: boolean("is_active").default(true),
});

export const goalTemplates = pgTable("goal_templates", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  title: text("title").notNull(),
  sortOrder: integer("sort_order").default(0),
  isActive: boolean("is_active").default(true),
  recurring: boolean("recurring").default(false),
});

export const dailyGoals = pgTable("daily_goals", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  date: date("date").notNull(),
  goalTemplateId: integer("goal_template_id").notNull(),
  title: text("title").notNull(),
  completed: boolean("completed").default(false),
});

export const journalAttachments = pgTable("journal_attachments", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  journalEntryId: integer("journal_entry_id").notNull(),
  objectPath: text("object_path").notNull(),
  filename: text("filename").notNull(),
  contentType: text("content_type").notNull(),
  size: integer("size").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const moodCheckins = pgTable("mood_checkins", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  date: date("date").notNull(),
  value: integer("value").notNull(),
  label: text("label"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const pushSubscriptions = pgTable("push_subscriptions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").default("").notNull(),
  auth: text("auth").default("").notNull(),
  apnsToken: text("apns_token"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertJournalEntrySchema = createInsertSchema(journalEntries).omit({
  id: true,
  createdAt: true,
});

export const insertDailyScoreSchema = createInsertSchema(dailyScores).omit({
  id: true,
});

export const insertUserMetricSchema = createInsertSchema(userMetrics).omit({
  id: true,
});

export const insertStreakSchema = createInsertSchema(streaks).omit({
  id: true,
});

export const insertAIInsightSchema = createInsertSchema(aiInsights).omit({
  id: true,
  createdAt: true,
});

export const insertGoalTemplateSchema = createInsertSchema(goalTemplates).omit({
  id: true,
});

export const insertDailyGoalSchema = createInsertSchema(dailyGoals).omit({
  id: true,
});

export const insertJournalAttachmentSchema = createInsertSchema(journalAttachments).omit({
  id: true,
  createdAt: true,
});

export const insertMoodCheckinSchema = createInsertSchema(moodCheckins).omit({
  id: true,
  createdAt: true,
});

export const insertPushSubscriptionSchema = createInsertSchema(pushSubscriptions).omit({
  id: true,
  createdAt: true,
});

export const infiniteGoals = pgTable("infinite_goals", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const longTermGoals = pgTable("long_term_goals", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  sortOrder: integer("sort_order").default(0),
  isActive: boolean("is_active").default(true),
  progress: integer("progress").default(0),
  isCompleted: boolean("is_completed").default(false),
  completedAt: timestamp("completed_at"),
  updatedAt: timestamp("updated_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const habits = pgTable("habits", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  name: text("name").notNull(),
  emoji: text("emoji").default("⭐"),
  category: text("category").default("general"),
  motivation: text("motivation"),
  anchorHabit: text("anchor_habit"),
  reminderTime: text("reminder_time"),
  reminderEnabled: boolean("reminder_enabled").default(true),
  currentStreak: integer("current_streak").default(0),
  longestStreak: integer("longest_streak").default(0),
  totalCompletions: integer("total_completions").default(0),
  lastCompletedDate: text("last_completed_date"),
  frequency: text("frequency").default("daily"),
  isArchived: boolean("is_archived").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const habitLogs = pgTable("habit_logs", {
  id: serial("id").primaryKey(),
  habitId: integer("habit_id").notNull(),
  userId: integer("user_id").notNull(),
  date: text("date").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertHabitSchema = createInsertSchema(habits).omit({
  id: true,
  currentStreak: true,
  longestStreak: true,
  totalCompletions: true,
  lastCompletedDate: true,
  isArchived: true,
  createdAt: true,
});

export const insertHabitLogSchema = createInsertSchema(habitLogs).omit({
  id: true,
  createdAt: true,
});

export const insertInfiniteGoalSchema = createInsertSchema(infiniteGoals).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertLongTermGoalSchema = createInsertSchema(longTermGoals).omit({
  id: true,
  createdAt: true,
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

// Define relations
export const usersRelations = relations(users, ({ many }) => ({
  journalEntries: many(journalEntries),
  dailyScores: many(dailyScores),
  userMetrics: many(userMetrics),
  streaks: many(streaks),
  aiInsights: many(aiInsights),
  pushSubscriptions: many(pushSubscriptions),
  goalTemplates: many(goalTemplates),
  dailyGoals: many(dailyGoals),
  infiniteGoals: many(infiniteGoals),
  longTermGoals: many(longTermGoals),
  habits: many(habits),
}));

export const infiniteGoalsRelations = relations(infiniteGoals, ({ one }) => ({
  user: one(users, {
    fields: [infiniteGoals.userId],
    references: [users.id],
  }),
}));

export const longTermGoalsRelations = relations(longTermGoals, ({ one }) => ({
  user: one(users, {
    fields: [longTermGoals.userId],
    references: [users.id],
  }),
}));

export const goalTemplatesRelations = relations(goalTemplates, ({ one }) => ({
  user: one(users, {
    fields: [goalTemplates.userId],
    references: [users.id],
  }),
}));

export const dailyGoalsRelations = relations(dailyGoals, ({ one }) => ({
  user: one(users, {
    fields: [dailyGoals.userId],
    references: [users.id],
  }),
  template: one(goalTemplates, {
    fields: [dailyGoals.goalTemplateId],
    references: [goalTemplates.id],
  }),
}));

export const journalEntriesRelations = relations(journalEntries, ({ one }) => ({
  user: one(users, {
    fields: [journalEntries.userId],
    references: [users.id],
  }),
}));

export const dailyScoresRelations = relations(dailyScores, ({ one }) => ({
  user: one(users, {
    fields: [dailyScores.userId],
    references: [users.id],
  }),
}));

export const userMetricsRelations = relations(userMetrics, ({ one }) => ({
  user: one(users, {
    fields: [userMetrics.userId],
    references: [users.id],
  }),
}));

export const streaksRelations = relations(streaks, ({ one }) => ({
  user: one(users, {
    fields: [streaks.userId],
    references: [users.id],
  }),
}));

export const aiInsightsRelations = relations(aiInsights, ({ one }) => ({
  user: one(users, {
    fields: [aiInsights.userId],
    references: [users.id],
  }),
}));

export const journalAttachmentsRelations = relations(journalAttachments, ({ one }) => ({
  user: one(users, {
    fields: [journalAttachments.userId],
    references: [users.id],
  }),
  journalEntry: one(journalEntries, {
    fields: [journalAttachments.journalEntryId],
    references: [journalEntries.id],
  }),
}));

export const moodCheckinsRelations = relations(moodCheckins, ({ one }) => ({
  user: one(users, {
    fields: [moodCheckins.userId],
    references: [users.id],
  }),
}));

export const pushSubscriptionsRelations = relations(pushSubscriptions, ({ one }) => ({
  user: one(users, {
    fields: [pushSubscriptions.userId],
    references: [users.id],
  }),
}));

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type JournalEntry = typeof journalEntries.$inferSelect;
export type InsertJournalEntry = z.infer<typeof insertJournalEntrySchema>;
export type DailyScore = typeof dailyScores.$inferSelect;
export type InsertDailyScore = z.infer<typeof insertDailyScoreSchema>;
export type UserMetric = typeof userMetrics.$inferSelect;
export type InsertUserMetric = z.infer<typeof insertUserMetricSchema>;
export type Streak = typeof streaks.$inferSelect;
export type InsertStreak = z.infer<typeof insertStreakSchema>;
export type AIInsight = typeof aiInsights.$inferSelect;
export type InsertAIInsight = z.infer<typeof insertAIInsightSchema>;
export type PushSubscription = typeof pushSubscriptions.$inferSelect;
export type InsertPushSubscription = z.infer<typeof insertPushSubscriptionSchema>;
export type GoalTemplate = typeof goalTemplates.$inferSelect;
export type InsertGoalTemplate = z.infer<typeof insertGoalTemplateSchema>;
export type DailyGoal = typeof dailyGoals.$inferSelect;
export type InsertDailyGoal = z.infer<typeof insertDailyGoalSchema>;
export type JournalAttachment = typeof journalAttachments.$inferSelect;
export type InsertJournalAttachment = z.infer<typeof insertJournalAttachmentSchema>;
export type MoodCheckin = typeof moodCheckins.$inferSelect;
export type InsertMoodCheckin = z.infer<typeof insertMoodCheckinSchema>;
export type InfiniteGoal = typeof infiniteGoals.$inferSelect;
export type InsertInfiniteGoal = z.infer<typeof insertInfiniteGoalSchema>;
export type LongTermGoal = typeof longTermGoals.$inferSelect;
export type InsertLongTermGoal = z.infer<typeof insertLongTermGoalSchema>;
export type Habit = typeof habits.$inferSelect;
export type InsertHabit = z.infer<typeof insertHabitSchema>;
export type HabitLog = typeof habitLogs.$inferSelect;
export type InsertHabitLog = z.infer<typeof insertHabitLogSchema>;

export const habitsRelations = relations(habits, ({ one, many }) => ({
  user: one(users, { fields: [habits.userId], references: [users.id] }),
  logs: many(habitLogs),
}));

export const habitLogsRelations = relations(habitLogs, ({ one }) => ({
  habit: one(habits, { fields: [habitLogs.habitId], references: [habits.id] }),
  user: one(users, { fields: [habitLogs.userId], references: [users.id] }),
}));

// Server-side configuration key-value store (for APNs credentials, etc.)
export const serverConfig = pgTable("server_config", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export * from "./models/chat";
