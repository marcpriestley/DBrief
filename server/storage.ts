import { 
  users, journalEntries, dailyScores, userMetrics, streaks, aiInsights, pushSubscriptions,
  goalTemplates, dailyGoals, journalAttachments, moodCheckins, debriefs, habits, habitLogs, serverConfig,
  weeklyReports, performancePatterns,
  type User, type InsertUser, type JournalEntry, type InsertJournalEntry,
  type DailyScore, type InsertDailyScore, type UserMetric, type InsertUserMetric,
  type Streak, type InsertStreak, type AIInsight, type InsertAIInsight,
  type PushSubscription, type InsertPushSubscription,
  type GoalTemplate, type InsertGoalTemplate, type DailyGoal, type InsertDailyGoal,
  type JournalAttachment, type InsertJournalAttachment, type MoodCheckin, type InsertMoodCheckin,
  type Habit, type InsertHabit, type HabitLog,
  type WeeklyReport, type InsertWeeklyReport,
  type PerformancePattern, type InsertPerformancePattern,
} from "@shared/schema";
import { db } from "./db";
import { eq, and, desc, gte, lte, gt } from "drizzle-orm";
import { encrypt, decrypt } from "./encryption";

export interface IStorage {
  // User methods
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUserSettings(userId: number, settings: Partial<Pick<User, 'notificationsEnabled' | 'moodRemindersEnabled' | 'reminderTime' | 'reminderTime2' | 'timezone' | 'healthMetricsEnabled' | 'hasCompletedOnboarding' | 'journalPreference' | 'goalPreference' | 'userProfile' | 'displayName'>>): Promise<User | undefined>;

  // Journal entry methods
  getJournalEntry(id: number): Promise<JournalEntry | undefined>;
  getJournalEntriesByUser(userId: number): Promise<JournalEntry[]>;
  getJournalEntryByDate(userId: number, date: string): Promise<JournalEntry | undefined>;
  createJournalEntry(entry: InsertJournalEntry): Promise<JournalEntry>;
  updateJournalEntry(id: number, entry: Partial<InsertJournalEntry>): Promise<JournalEntry | undefined>;

  // Daily scores methods
  getDailyScoresByUserAndDate(userId: number, date: string): Promise<DailyScore[]>;
  getDailyScoresByUser(userId: number): Promise<DailyScore[]>;
  getMetricHistory(userId: number, metricName: string, days: number): Promise<DailyScore[]>;
  createDailyScore(score: InsertDailyScore): Promise<DailyScore>;
  updateDailyScore(userId: number, date: string, metricName: string, value: number, isAutoSynced?: boolean): Promise<DailyScore | undefined>;

  // User metrics methods
  getUserMetrics(userId: number): Promise<UserMetric[]>;
  createUserMetric(metric: InsertUserMetric): Promise<UserMetric>;
  updateUserMetric(id: number, metric: Partial<InsertUserMetric>): Promise<UserMetric | undefined>;
  deleteUserMetric(id: number, userId: number): Promise<void>;

  // Streak methods
  getUserStreak(userId: number): Promise<Streak | undefined>;
  createStreak(streak: InsertStreak): Promise<Streak>;
  updateStreak(userId: number, streak: Partial<InsertStreak>): Promise<Streak | undefined>;
  getRecentActiveDays(userId: number): Promise<number>;

  // AI insights methods
  getActiveAIInsights(userId: number): Promise<AIInsight[]>;
  createAIInsight(insight: InsertAIInsight): Promise<AIInsight>;
  deactivateAIInsight(id: number): Promise<void>;

  // Goal template methods
  getGoalTemplates(userId: number): Promise<GoalTemplate[]>;
  createGoalTemplate(template: InsertGoalTemplate): Promise<GoalTemplate>;
  updateGoalTemplate(id: number, userId: number, updates: Partial<InsertGoalTemplate>): Promise<GoalTemplate | undefined>;
  deleteGoalTemplate(id: number, userId: number): Promise<void>;

  // Daily goals methods
  getDailyGoals(userId: number, date: string): Promise<DailyGoal[]>;
  createDailyGoal(goal: InsertDailyGoal): Promise<DailyGoal>;
  getGoalsForDateRange(userId: number, startDate: string, endDate: string): Promise<DailyGoal[]>;
  ensureDailyGoals(userId: number, date: string): Promise<DailyGoal[]>;
  toggleDailyGoal(id: number, userId: number): Promise<DailyGoal | undefined>;

  // Journal attachment methods
  getAttachmentsByEntry(journalEntryId: number): Promise<JournalAttachment[]>;
  createAttachment(attachment: InsertJournalAttachment): Promise<JournalAttachment>;
  deleteAttachment(id: number, userId: number): Promise<void>;

  // Mood check-in methods
  createMoodCheckin(checkin: InsertMoodCheckin): Promise<MoodCheckin>;
  getMoodCheckinsByDate(userId: number, date: string): Promise<MoodCheckin[]>;
  getMoodCheckinsForDateRange(userId: number, startDate: string, endDate: string): Promise<MoodCheckin[]>;

  // Calendar data methods
  getDatesWithData(userId: number): Promise<string[]>;

  // Push subscription methods
  getPushSubscriptions(userId: number): Promise<PushSubscription[]>;
  createPushSubscription(subscription: InsertPushSubscription): Promise<PushSubscription>;
  saveApnsToken(userId: number, apnsToken: string): Promise<PushSubscription>;
  deletePushSubscription(endpoint: string): Promise<void>;
  deleteApnsToken(apnsToken: string): Promise<void>;
  getAllUsersForReminder(time: string): Promise<Array<User & { subscriptions: PushSubscription[] }>>;

  // Habit methods
  getHabits(userId: number): Promise<Habit[]>;
  createHabit(habit: InsertHabit): Promise<Habit>;
  updateHabit(id: number, userId: number, updates: Partial<InsertHabit>): Promise<Habit | undefined>;
  archiveHabit(id: number, userId: number): Promise<void>;
  getHabitWithTodayStatus(userId: number, date: string): Promise<Array<Habit & { todayCompleted: boolean; last7Days: boolean[] }>>;
  toggleHabitCompletion(habitId: number, userId: number, date: string): Promise<{ habit: Habit; completed: boolean }>;
  getHabitLogsForRange(habitId: number, userId: number, startDate: string, endDate: string): Promise<HabitLog[]>;
  getAllHabitsForReminder(): Promise<Array<Habit & { user: User; subscriptions: PushSubscription[] }>>;

  // Server config methods
  getServerConfig(key: string): Promise<string | undefined>;
  setServerConfig(key: string, value: string): Promise<void>;

  // Weekly report methods
  getLatestWeeklyReport(userId: number): Promise<WeeklyReport | undefined>;
  getWeeklyReportByWeek(userId: number, weekStart: string): Promise<WeeklyReport | undefined>;
  createWeeklyReport(report: InsertWeeklyReport): Promise<WeeklyReport>;
  markWeeklyReportNotificationSent(id: number): Promise<void>;
  getAllUsersForWeeklyReport(): Promise<Array<User & { subscriptions: PushSubscription[] }>>;

  // Performance pattern methods
  getActivePerformancePatterns(userId: number): Promise<PerformancePattern[]>;
  replacePerformancePatterns(userId: number, patterns: InsertPerformancePattern[]): Promise<PerformancePattern[]>;
}

export class MemStorage implements IStorage {
  private users: Map<number, User> = new Map();
  private journalEntries: Map<number, JournalEntry> = new Map();
  private dailyScores: Map<number, DailyScore> = new Map();
  private userMetrics: Map<number, UserMetric> = new Map();
  private streaks: Map<number, Streak> = new Map();
  private aiInsights: Map<number, AIInsight> = new Map();
  private pushSubscriptions: Map<number, PushSubscription> = new Map();

  private currentUserId = 1;
  private currentJournalEntryId = 1;
  private currentDailyScoreId = 1;
  private currentUserMetricId = 1;
  private currentStreakId = 1;
  private currentAIInsightId = 1;
  private currentPushSubscriptionId = 1;

  constructor() {
    this.initializeDefaultData();
  }

  private initializeDefaultData() {
    const today = new Date();
    
    // Create default user
    const defaultUser: User = {
      id: 1,
      username: "demo",
      password: "demo123",
      notificationsEnabled: true,
      reminderTime: "21:00",
      timezone: "UTC",
    };
    this.users.set(1, defaultUser);
    this.currentUserId = 2;

    // Create default metrics with health tracking
    const defaultMetrics: UserMetric[] = [
      { id: 1, userId: 1, name: "Happiness", color: "#10B981", maxValue: 100, isDefault: true, isActive: true },
      { id: 2, userId: 1, name: "Productivity", color: "#4F46E5", maxValue: 100, isDefault: true, isActive: true },
      { id: 3, userId: 1, name: "Energy", color: "#F59E0B", maxValue: 100, isDefault: true, isActive: true },
      { id: 4, userId: 1, name: "Nutrition", color: "#EC4899", maxValue: 100, isDefault: true, isActive: true },
      { id: 5, userId: 1, name: "Sleep Quality", color: "#8B5CF6", maxValue: 100, isDefault: false, isActive: true },
      { id: 6, userId: 1, name: "Readiness", color: "#EF4444", maxValue: 100, isDefault: false, isActive: true },
    ];

    defaultMetrics.forEach(metric => {
      this.userMetrics.set(metric.id, metric);
    });
    this.currentUserMetricId = 7;

    // No sample journal entries - users start with blank slate
    this.currentJournalEntryId = 1;

    // No sample scores for today - manual metrics remain blank until user inputs
    // Oura metrics will auto-sync when app opens
    // Keep one day of historical data for testing calendar long-press
    const yesterdayStr = new Date(today.getTime() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    
    const sampleScores: DailyScore[] = [
      // Yesterday's scores for testing calendar long-press
      { id: 1, userId: 1, date: yesterdayStr, metricName: "Happiness", value: 7, isAutoSynced: false },
      { id: 2, userId: 1, date: yesterdayStr, metricName: "Productivity", value: 8, isAutoSynced: false },
      { id: 3, userId: 1, date: yesterdayStr, metricName: "Energy", value: 6, isAutoSynced: false },
      { id: 4, userId: 1, date: yesterdayStr, metricName: "Nutrition", value: 8, isAutoSynced: false },
      { id: 5, userId: 1, date: yesterdayStr, metricName: "Sleep Quality", value: 82, isAutoSynced: true },
      { id: 6, userId: 1, date: yesterdayStr, metricName: "Readiness", value: 78, isAutoSynced: true },
    ];

    sampleScores.forEach(score => {
      this.dailyScores.set(score.id, score);
    });
    this.currentDailyScoreId = 7;

    // Create default streak starting at 0
    const defaultStreak: Streak = {
      id: 1,
      userId: 1,
      currentStreak: 0,
      longestStreak: 0,
      lastEntryDate: null,
    };
    this.streaks.set(1, defaultStreak);
    this.currentStreakId = 2;
  }

  async getUser(id: number): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(user => user.username === username);
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = this.currentUserId++;
    const user: User = { 
      ...insertUser, 
      id,
      notificationsEnabled: true,
      reminderTime: "21:00",
      timezone: "UTC",
    };
    this.users.set(id, user);
    return user;
  }

  async getJournalEntry(id: number): Promise<JournalEntry | undefined> {
    return this.journalEntries.get(id);
  }

  async getJournalEntriesByUser(userId: number): Promise<JournalEntry[]> {
    return Array.from(this.journalEntries.values()).filter(entry => entry.userId === userId);
  }

  async getJournalEntryByDate(userId: number, date: string): Promise<JournalEntry | undefined> {
    return Array.from(this.journalEntries.values()).find(entry => 
      entry.userId === userId && entry.date === date
    );
  }

  async createJournalEntry(insertEntry: InsertJournalEntry): Promise<JournalEntry> {
    const id = this.currentJournalEntryId++;
    const entry: JournalEntry = {
      ...insertEntry,
      id,
      isVoiceEntry: insertEntry.isVoiceEntry ?? false,
      createdAt: new Date(),
    };
    this.journalEntries.set(id, entry);
    return entry;
  }

  async updateJournalEntry(id: number, updates: Partial<InsertJournalEntry>): Promise<JournalEntry | undefined> {
    const entry = this.journalEntries.get(id);
    if (entry) {
      const updated = { ...entry, ...updates };
      this.journalEntries.set(id, updated);
      return updated;
    }
    return undefined;
  }

  async getDailyScoresByUserAndDate(userId: number, date: string): Promise<DailyScore[]> {
    return Array.from(this.dailyScores.values()).filter(score => 
      score.userId === userId && score.date === date
    );
  }

  async getDailyScoresByUser(userId: number): Promise<DailyScore[]> {
    return Array.from(this.dailyScores.values()).filter(score => score.userId === userId);
  }

  async getMetricHistory(userId: number, metricName: string, days: number): Promise<DailyScore[]> {
    // Validate and cap days to prevent unbounded scans
    const validDays = Math.max(1, Math.min(90, days));
    
    // Calculate date floor (inclusive range)
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - (validDays - 1));
    const dateFloor = startDate.toISOString().split('T')[0];
    
    // Filter and sort
    return Array.from(this.dailyScores.values())
      .filter(score => 
        score.userId === userId && 
        score.metricName === metricName && 
        score.date >= dateFloor
      )
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  async createDailyScore(insertScore: InsertDailyScore): Promise<DailyScore> {
    const id = this.currentDailyScoreId++;
    const score: DailyScore = { 
      ...insertScore, 
      id,
      isAutoSynced: insertScore.isAutoSynced ?? false,
    };
    this.dailyScores.set(id, score);
    return score;
  }

  async updateDailyScore(userId: number, date: string, metricName: string, value: number, isAutoSynced: boolean = false): Promise<DailyScore | undefined> {
    const existingScore = Array.from(this.dailyScores.values()).find(score =>
      score.userId === userId && score.date === date && score.metricName === metricName
    );

    if (existingScore) {
      existingScore.value = value;
      existingScore.isAutoSynced = isAutoSynced;
      this.dailyScores.set(existingScore.id, existingScore);
      return existingScore;
    } else {
      return await this.createDailyScore({ userId, date, metricName, value, isAutoSynced });
    }
  }

  async getUserMetrics(userId: number): Promise<UserMetric[]> {
    return Array.from(this.userMetrics.values()).filter(metric => metric.userId === userId);
  }

  async createUserMetric(insertMetric: InsertUserMetric): Promise<UserMetric> {
    const id = this.currentUserMetricId++;
    const metric: UserMetric = { 
      ...insertMetric, 
      id,
      maxValue: insertMetric.maxValue ?? 100,
      isDefault: insertMetric.isDefault ?? false,
      isActive: insertMetric.isActive ?? true,
    };
    this.userMetrics.set(id, metric);
    return metric;
  }

  async updateUserMetric(id: number, updates: Partial<InsertUserMetric>): Promise<UserMetric | undefined> {
    const metric = this.userMetrics.get(id);
    if (metric) {
      const updated = { ...metric, ...updates };
      this.userMetrics.set(id, updated);
      return updated;
    }
    return undefined;
  }

  async deleteUserMetric(id: number, _userId: number): Promise<void> {
    const metric = this.userMetrics.get(id);
    if (metric) {
      metric.isActive = false;
      this.userMetrics.set(id, metric);
    }
  }

  async getUserStreak(userId: number): Promise<Streak | undefined> {
    return Array.from(this.streaks.values()).find(streak => streak.userId === userId);
  }

  async createStreak(insertStreak: InsertStreak): Promise<Streak> {
    const id = this.currentStreakId++;
    const streak: Streak = { 
      ...insertStreak, 
      id,
      currentStreak: insertStreak.currentStreak ?? 0,
      longestStreak: insertStreak.longestStreak ?? 0,
      lastEntryDate: insertStreak.lastEntryDate ?? null,
    };
    this.streaks.set(id, streak);
    return streak;
  }

  async getRecentActiveDays(userId: number): Promise<number> {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    const sevenDaysAgoStr = sevenDaysAgo.toISOString().split('T')[0];
    const scores = Array.from(this.dailyScores.values()).filter(
      s => s.userId === userId && s.date >= sevenDaysAgoStr && (s.value ?? 0) > 0
    );
    return new Set(scores.map(s => s.date)).size;
  }

  async updateStreak(userId: number, updates: Partial<InsertStreak>): Promise<Streak | undefined> {
    const streak = Array.from(this.streaks.values()).find(s => s.userId === userId);
    if (streak) {
      const updated = { ...streak, ...updates };
      this.streaks.set(streak.id, updated);
      return updated;
    }
    return undefined;
  }

  async getActiveAIInsights(userId: number): Promise<AIInsight[]> {
    return Array.from(this.aiInsights.values()).filter(insight => 
      insight.userId === userId && insight.isActive
    );
  }

  async createAIInsight(insertInsight: InsertAIInsight): Promise<AIInsight> {
    const id = this.currentAIInsightId++;
    const insight: AIInsight = {
      ...insertInsight,
      id,
      isActive: insertInsight.isActive ?? true,
      tags: insertInsight.tags ?? null,
      createdAt: new Date(),
    };
    this.aiInsights.set(id, insight);
    return insight;
  }

  async deactivateAIInsight(id: number): Promise<void> {
    const insight = this.aiInsights.get(id);
    if (insight) {
      insight.isActive = false;
      this.aiInsights.set(id, insight);
    }
  }

  async updateUserSettings(userId: number, settings: Partial<Pick<User, 'notificationsEnabled' | 'moodRemindersEnabled' | 'reminderTime' | 'reminderTime2' | 'timezone' | 'healthMetricsEnabled' | 'hasCompletedOnboarding' | 'journalPreference' | 'goalPreference' | 'userProfile' | 'displayName'>>): Promise<User | undefined> {
    const user = this.users.get(userId);
    if (user) {
      Object.assign(user, settings);
      this.users.set(userId, user);
      return user;
    }
    return undefined;
  }

  async getPushSubscriptions(userId: number): Promise<PushSubscription[]> {
    return Array.from(this.pushSubscriptions.values()).filter(sub => sub.userId === userId);
  }

  async createPushSubscription(subscription: InsertPushSubscription): Promise<PushSubscription> {
    const existing = Array.from(this.pushSubscriptions.values()).find(
      sub => sub.endpoint === subscription.endpoint
    );
    
    if (existing) {
      return existing;
    }

    const newSubscription: PushSubscription = {
      ...subscription,
      id: this.currentPushSubscriptionId++,
      createdAt: new Date(),
    };
    this.pushSubscriptions.set(newSubscription.id, newSubscription);
    return newSubscription;
  }

  async saveApnsToken(userId: number, apnsToken: string): Promise<PushSubscription> {
    const existing = Array.from(this.pushSubscriptions.values()).find(
      sub => sub.apnsToken === apnsToken
    );
    if (existing) return existing;
    const newSubscription: PushSubscription = {
      userId,
      endpoint: `apns:${apnsToken}`,
      p256dh: "",
      auth: "",
      apnsToken,
      id: this.currentPushSubscriptionId++,
      createdAt: new Date(),
    };
    this.pushSubscriptions.set(newSubscription.id, newSubscription);
    return newSubscription;
  }

  async deletePushSubscription(endpoint: string): Promise<void> {
    const subscription = Array.from(this.pushSubscriptions.entries()).find(
      ([_, sub]) => sub.endpoint === endpoint
    );
    if (subscription) {
      this.pushSubscriptions.delete(subscription[0]);
    }
  }

  async deleteApnsToken(apnsToken: string): Promise<void> {
    const subscription = Array.from(this.pushSubscriptions.entries()).find(
      ([_, sub]) => sub.apnsToken === apnsToken
    );
    if (subscription) {
      this.pushSubscriptions.delete(subscription[0]);
    }
  }

  async getAllUsersForReminder(time: string): Promise<Array<User & { subscriptions: PushSubscription[] }>> {
    const usersWithReminders: Array<User & { subscriptions: PushSubscription[] }> = [];
    
    for (const user of Array.from(this.users.values())) {
      if (user.notificationsEnabled) {
        const subscriptions = await this.getPushSubscriptions(user.id);
        if (subscriptions.length > 0) {
          usersWithReminders.push({ ...user, subscriptions });
        }
      }
    }
    
    return usersWithReminders;
  }

  async getGoalTemplates(_userId: number): Promise<GoalTemplate[]> { return []; }
  async createGoalTemplate(t: InsertGoalTemplate): Promise<GoalTemplate> { return { ...t, id: 0, sortOrder: t.sortOrder ?? 0, isActive: t.isActive ?? true } as GoalTemplate; }
  async updateGoalTemplate(_id: number, _userId: number, _updates: Partial<InsertGoalTemplate>): Promise<GoalTemplate | undefined> { return undefined; }
  async deleteGoalTemplate(_id: number, _userId: number): Promise<void> {}
  async getDailyGoals(_userId: number, _date: string): Promise<DailyGoal[]> { return []; }
  async createDailyGoal(goal: InsertDailyGoal): Promise<DailyGoal> { return { ...goal, id: 0, completed: goal.completed ?? false } as DailyGoal; }
  async getGoalsForDateRange(_userId: number, _startDate: string, _endDate: string): Promise<DailyGoal[]> { return []; }
  async ensureDailyGoals(_userId: number, _date: string): Promise<DailyGoal[]> { return []; }
  async toggleDailyGoal(_id: number, _userId: number): Promise<DailyGoal | undefined> { return undefined; }

  async getAttachmentsByEntry(_journalEntryId: number): Promise<JournalAttachment[]> { return []; }
  async createAttachment(a: InsertJournalAttachment): Promise<JournalAttachment> { return { ...a, id: 0, createdAt: new Date() } as JournalAttachment; }
  async deleteAttachment(_id: number, _userId: number): Promise<void> {}

  async createMoodCheckin(c: InsertMoodCheckin): Promise<MoodCheckin> { return { ...c, id: 0, createdAt: new Date(), label: c.label ?? null } as MoodCheckin; }
  async getMoodCheckinsByDate(_userId: number, _date: string): Promise<MoodCheckin[]> { return []; }
  async getMoodCheckinsForDateRange(_userId: number, _startDate: string, _endDate: string): Promise<MoodCheckin[]> { return []; }
  async getDatesWithData(_userId: number): Promise<string[]> { return []; }

  // Habit stubs (MemStorage is not used in production — DatabaseStorage is)
  async getHabits(_userId: number): Promise<Habit[]> { return []; }
  async createHabit(h: InsertHabit): Promise<Habit> { return { ...h, id: 0, currentStreak: 0, longestStreak: 0, totalCompletions: 0, lastCompletedDate: null, isArchived: false, createdAt: new Date(), emoji: h.emoji ?? "⭐", category: h.category ?? "general", motivation: h.motivation ?? null, anchorHabit: h.anchorHabit ?? null, reminderTime: h.reminderTime ?? null, reminderEnabled: h.reminderEnabled ?? true } as Habit; }
  async updateHabit(_id: number, _userId: number, _updates: Partial<InsertHabit>): Promise<Habit | undefined> { return undefined; }
  async archiveHabit(_id: number, _userId: number): Promise<void> {}
  async getHabitWithTodayStatus(_userId: number, _date: string): Promise<Array<Habit & { todayCompleted: boolean; last7Days: boolean[] }>> { return []; }
  async toggleHabitCompletion(_habitId: number, _userId: number, _date: string): Promise<{ habit: Habit; completed: boolean }> { throw new Error("Not implemented in MemStorage"); }
  async getHabitLogsForRange(_habitId: number, _userId: number, _startDate: string, _endDate: string): Promise<HabitLog[]> { return []; }
  async getAllHabitsForReminder(): Promise<Array<Habit & { user: User; subscriptions: PushSubscription[] }>> { return []; }
  async getServerConfig(_key: string): Promise<string | undefined> { return undefined; }
  async setServerConfig(_key: string, _value: string): Promise<void> {}
  async getLatestWeeklyReport(_userId: number): Promise<WeeklyReport | undefined> { return undefined; }
  async getWeeklyReportByWeek(_userId: number, _weekStart: string): Promise<WeeklyReport | undefined> { return undefined; }
  async createWeeklyReport(report: InsertWeeklyReport): Promise<WeeklyReport> { return { id: 1, ...report, createdAt: new Date() } as any; }
  async markWeeklyReportNotificationSent(_id: number): Promise<void> {}
  async getAllUsersForWeeklyReport(): Promise<Array<User & { subscriptions: PushSubscription[] }>> { return []; }
  async getActivePerformancePatterns(_userId: number): Promise<PerformancePattern[]> { return []; }
  async replacePerformancePatterns(_userId: number, _patterns: InsertPerformancePattern[]): Promise<PerformancePattern[]> { return []; }
}

// Database implementation
export class DatabaseStorage implements IStorage {
  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user || undefined;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }

  async getJournalEntry(id: number): Promise<JournalEntry | undefined> {
    const [entry] = await db.select().from(journalEntries).where(eq(journalEntries.id, id));
    if (entry) entry.content = decrypt(entry.content);
    return entry || undefined;
  }

  async getJournalEntriesByUser(userId: number): Promise<JournalEntry[]> {
    const entries = await db.select().from(journalEntries)
      .where(eq(journalEntries.userId, userId))
      .orderBy(desc(journalEntries.date));
    return entries.map(e => ({ ...e, content: decrypt(e.content) }));
  }

  async getJournalEntryByDate(userId: number, date: string): Promise<JournalEntry | undefined> {
    const [entry] = await db.select().from(journalEntries)
      .where(and(eq(journalEntries.userId, userId), eq(journalEntries.date, date)));
    if (entry) entry.content = decrypt(entry.content);
    return entry || undefined;
  }

  async createJournalEntry(entry: InsertJournalEntry): Promise<JournalEntry> {
    const encrypted = { ...entry, content: encrypt(entry.content) };
    const [created] = await db.insert(journalEntries).values(encrypted).returning();
    created.content = decrypt(created.content);
    return created;
  }

  async updateJournalEntry(id: number, updates: Partial<InsertJournalEntry>): Promise<JournalEntry | undefined> {
    const encryptedUpdates = updates.content
      ? { ...updates, content: encrypt(updates.content) }
      : updates;
    const [updated] = await db.update(journalEntries)
      .set(encryptedUpdates)
      .where(eq(journalEntries.id, id))
      .returning();
    if (updated) updated.content = decrypt(updated.content);
    return updated || undefined;
  }

  async getDailyScoresByUserAndDate(userId: number, date: string): Promise<DailyScore[]> {
    return await db.select().from(dailyScores)
      .where(and(eq(dailyScores.userId, userId), eq(dailyScores.date, date)));
  }

  async getDailyScoresByUser(userId: number): Promise<DailyScore[]> {
    return await db.select().from(dailyScores).where(eq(dailyScores.userId, userId));
  }

  async getMetricHistory(userId: number, metricName: string, days: number): Promise<DailyScore[]> {
    const { gte } = await import("drizzle-orm");
    
    // Validate and cap days to prevent unbounded scans
    const validDays = Math.max(1, Math.min(90, days));
    
    // Calculate date floor (inclusive range)
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - (validDays - 1));
    const dateFloor = startDate.toISOString().split('T')[0];
    
    // Query with indexed filtering and ordering
    return await db.select().from(dailyScores)
      .where(and(
        eq(dailyScores.userId, userId),
        eq(dailyScores.metricName, metricName),
        gte(dailyScores.date, dateFloor)
      ))
      .orderBy(dailyScores.date)
      .limit(validDays);
  }

  async createDailyScore(score: InsertDailyScore): Promise<DailyScore> {
    const [created] = await db.insert(dailyScores).values(score).returning();
    return created;
  }

  async updateDailyScore(userId: number, date: string, metricName: string, value: number, isAutoSynced: boolean = false): Promise<DailyScore | undefined> {
    const [updated] = await db.update(dailyScores)
      .set({ value, isAutoSynced })
      .where(and(
        eq(dailyScores.userId, userId),
        eq(dailyScores.date, date),
        eq(dailyScores.metricName, metricName)
      ))
      .returning();
    
    if (updated) return updated;

    return await this.createDailyScore({ userId, date, metricName, value, isAutoSynced });
  }

  async getUserMetrics(userId: number): Promise<UserMetric[]> {
    return await db.select().from(userMetrics).where(eq(userMetrics.userId, userId));
  }

  async createUserMetric(metric: InsertUserMetric): Promise<UserMetric> {
    const [created] = await db.insert(userMetrics).values(metric).returning();
    return created;
  }

  async updateUserMetric(id: number, updates: Partial<InsertUserMetric>): Promise<UserMetric | undefined> {
    const [updated] = await db.update(userMetrics)
      .set(updates)
      .where(eq(userMetrics.id, id))
      .returning();
    return updated || undefined;
  }

  async deleteUserMetric(id: number, userId: number): Promise<void> {
    await db.update(userMetrics)
      .set({ isActive: false })
      .where(and(eq(userMetrics.id, id), eq(userMetrics.userId, userId)));
  }

  async getUserStreak(userId: number): Promise<Streak | undefined> {
    const [streak] = await db.select().from(streaks).where(eq(streaks.userId, userId));
    return streak || undefined;
  }

  async createStreak(streak: InsertStreak): Promise<Streak> {
    const [created] = await db.insert(streaks).values(streak).returning();
    return created;
  }

  async updateStreak(userId: number, updates: Partial<InsertStreak>): Promise<Streak | undefined> {
    const [updated] = await db.update(streaks)
      .set(updates)
      .where(eq(streaks.userId, userId))
      .returning();
    return updated || undefined;
  }

  async getRecentActiveDays(userId: number): Promise<number> {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    const sevenDaysAgoStr = sevenDaysAgo.toISOString().split('T')[0];
    const rows = await db
      .selectDistinct({ date: dailyScores.date })
      .from(dailyScores)
      .where(and(
        eq(dailyScores.userId, userId),
        gte(dailyScores.date, sevenDaysAgoStr),
        gt(dailyScores.value, 0),
      ));
    return rows.length;
  }

  async getActiveAIInsights(userId: number): Promise<AIInsight[]> {
    return await db.select().from(aiInsights)
      .where(and(eq(aiInsights.userId, userId), eq(aiInsights.isActive, true)));
  }

  async createAIInsight(insight: InsertAIInsight): Promise<AIInsight> {
    const [created] = await db.insert(aiInsights).values(insight).returning();
    return created;
  }

  async deactivateAIInsight(id: number): Promise<void> {
    await db.update(aiInsights)
      .set({ isActive: false })
      .where(eq(aiInsights.id, id));
  }

  async updateUserSettings(userId: number, settings: Partial<Pick<User, 'notificationsEnabled' | 'moodRemindersEnabled' | 'reminderTime' | 'reminderTime2' | 'timezone' | 'healthMetricsEnabled' | 'hasCompletedOnboarding' | 'journalPreference' | 'goalPreference' | 'userProfile' | 'displayName'>>): Promise<User | undefined> {
    const [updated] = await db.update(users)
      .set(settings)
      .where(eq(users.id, userId))
      .returning();
    return updated || undefined;
  }

  async getPushSubscriptions(userId: number): Promise<PushSubscription[]> {
    return await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
  }

  async createPushSubscription(subscription: InsertPushSubscription): Promise<PushSubscription> {
    const [existing] = await db.select().from(pushSubscriptions)
      .where(eq(pushSubscriptions.endpoint, subscription.endpoint));
    
    if (existing) {
      return existing;
    }

    const [created] = await db.insert(pushSubscriptions).values(subscription).returning();
    return created;
  }

  async saveApnsToken(userId: number, apnsToken: string): Promise<PushSubscription> {
    // Normalise to lowercase to avoid duplicate rows from mixed-case tokens
    const token = apnsToken.toLowerCase();
    const endpoint = `apns:${token}`;
    // Upsert — if endpoint already exists just update the userId/token in place
    const [row] = await db.insert(pushSubscriptions)
      .values({ userId, endpoint, p256dh: "", auth: "", apnsToken: token })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: { userId, apnsToken: token },
      })
      .returning();
    return row;
  }

  async deletePushSubscription(endpoint: string): Promise<void> {
    await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
  }

  async deleteApnsToken(apnsToken: string): Promise<void> {
    await db.delete(pushSubscriptions).where(eq(pushSubscriptions.apnsToken, apnsToken));
  }

  async getGoalTemplates(userId: number): Promise<GoalTemplate[]> {
    const all = await db.select().from(goalTemplates)
      .where(and(eq(goalTemplates.userId, userId), eq(goalTemplates.isActive, true)))
      .orderBy(goalTemplates.sortOrder);

    // Ensure "Make my bed" is always present and pinned first.
    const mmbTemplate = all.find(t => t.title.toLowerCase() === "make my bed");
    if (!mmbTemplate) {
      // Check if one exists but was previously deactivated — reactivate it.
      const [inactive] = await db.select().from(goalTemplates)
        .where(and(eq(goalTemplates.userId, userId), eq(goalTemplates.isActive, false)));
      if (inactive && inactive.title.toLowerCase() === "make my bed") {
        await db.update(goalTemplates).set({ isActive: true, sortOrder: -1 }).where(eq(goalTemplates.id, inactive.id));
        const revived = { ...inactive, isActive: true, sortOrder: -1 };
        return [revived, ...all];
      }
      // Create a fresh one pinned at sortOrder -1 so it always sorts first.
      const [seeded] = await db.insert(goalTemplates).values({
        userId,
        title: "Make my bed",
        recurring: true,
        isActive: true,
        sortOrder: -1,
      }).returning();
      return [seeded, ...all];
    }

    // If "Make my bed" exists but isn't sortOrder -1, update it so it sticks first.
    if ((mmbTemplate.sortOrder ?? 0) !== -1) {
      await db.update(goalTemplates).set({ sortOrder: -1 }).where(eq(goalTemplates.id, mmbTemplate.id));
      mmbTemplate.sortOrder = -1;
    }

    // Always move it to position 0 in the returned list regardless.
    const idx = all.indexOf(mmbTemplate);
    if (idx > 0) {
      all.splice(idx, 1);
      all.unshift(mmbTemplate);
    }

    return all;
  }

  async createGoalTemplate(template: InsertGoalTemplate): Promise<GoalTemplate> {
    const [created] = await db.insert(goalTemplates).values(template).returning();
    return created;
  }

  async updateGoalTemplate(id: number, userId: number, updates: Partial<InsertGoalTemplate>): Promise<GoalTemplate | undefined> {
    const [updated] = await db.update(goalTemplates)
      .set(updates)
      .where(and(eq(goalTemplates.id, id), eq(goalTemplates.userId, userId)))
      .returning();
    return updated || undefined;
  }

  async deleteGoalTemplate(id: number, userId: number): Promise<void> {
    await db.update(goalTemplates)
      .set({ isActive: false })
      .where(and(eq(goalTemplates.id, id), eq(goalTemplates.userId, userId)));
    await db.delete(dailyGoals)
      .where(and(
        eq(dailyGoals.userId, userId),
        eq(dailyGoals.goalTemplateId, id),
      ));
  }

  async getDailyGoals(userId: number, date: string): Promise<DailyGoal[]> {
    const { asc } = await import("drizzle-orm");
    // Join with goal_templates so we can order by template sortOrder, then id
    const rows = await db
      .select({
        id: dailyGoals.id,
        userId: dailyGoals.userId,
        date: dailyGoals.date,
        goalTemplateId: dailyGoals.goalTemplateId,
        title: dailyGoals.title,
        completed: dailyGoals.completed,
      })
      .from(dailyGoals)
      .leftJoin(goalTemplates, eq(dailyGoals.goalTemplateId, goalTemplates.id))
      .where(and(eq(dailyGoals.userId, userId), eq(dailyGoals.date, date)))
      .orderBy(asc(goalTemplates.sortOrder), asc(dailyGoals.id));

    const seen = new Set<number>();
    const deduped = rows.filter(g => {
      if (seen.has(g.goalTemplateId)) return false;
      seen.add(g.goalTemplateId);
      return true;
    });

    // Always pin "Make my bed" to the very first position
    const mmbIdx = deduped.findIndex(g => g.title.toLowerCase() === "make my bed");
    if (mmbIdx > 0) {
      const [mmb] = deduped.splice(mmbIdx, 1);
      deduped.unshift(mmb);
    }

    return deduped;
  }

  async createDailyGoal(goal: InsertDailyGoal): Promise<DailyGoal> {
    const [created] = await db.insert(dailyGoals).values(goal).returning();
    return created;
  }

  async getGoalsForDateRange(userId: number, startDate: string, endDate: string): Promise<DailyGoal[]> {
    const { gte, lte } = await import("drizzle-orm");
    return await db.select().from(dailyGoals)
      .where(and(
        eq(dailyGoals.userId, userId),
        gte(dailyGoals.date, startDate),
        lte(dailyGoals.date, endDate)
      ));
  }

  async ensureDailyGoals(userId: number, date: string): Promise<DailyGoal[]> {
    const existing = await this.getDailyGoals(userId, date);

    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    if (date < todayStr) return existing;

    const templates = await this.getGoalTemplates(userId);

    const recurringTemplates = templates.filter(t => t.recurring);
    if (recurringTemplates.length === 0) return existing;

    const existingTemplateIds = new Set(existing.map(g => g.goalTemplateId));
    const missingTemplates = recurringTemplates.filter(t => !existingTemplateIds.has(t.id));
    if (missingTemplates.length === 0) return existing;

    const newGoals: DailyGoal[] = [];
    for (const template of missingTemplates) {
      const [goal] = await db.insert(dailyGoals).values({
        userId,
        date,
        goalTemplateId: template.id,
        title: template.title,
        completed: false,
      }).returning();
      newGoals.push(goal);
    }
    return [...existing, ...newGoals];
  }

  async toggleDailyGoal(id: number, userId: number): Promise<DailyGoal | undefined> {
    const [existing] = await db.select().from(dailyGoals)
      .where(and(eq(dailyGoals.id, id), eq(dailyGoals.userId, userId)));
    if (!existing) return undefined;
    const [updated] = await db.update(dailyGoals)
      .set({ completed: !existing.completed })
      .where(and(eq(dailyGoals.id, id), eq(dailyGoals.userId, userId)))
      .returning();
    return updated;
  }

  async getAttachmentsByEntry(journalEntryId: number): Promise<JournalAttachment[]> {
    return await db.select().from(journalAttachments)
      .where(eq(journalAttachments.journalEntryId, journalEntryId));
  }

  async createAttachment(attachment: InsertJournalAttachment): Promise<JournalAttachment> {
    const [created] = await db.insert(journalAttachments).values(attachment).returning();
    return created;
  }

  async deleteAttachment(id: number, userId: number): Promise<void> {
    await db.delete(journalAttachments)
      .where(and(eq(journalAttachments.id, id), eq(journalAttachments.userId, userId)));
  }

  async createMoodCheckin(checkin: InsertMoodCheckin): Promise<MoodCheckin> {
    const [created] = await db.insert(moodCheckins).values(checkin).returning();
    return created;
  }

  async getMoodCheckinsByDate(userId: number, date: string): Promise<MoodCheckin[]> {
    return await db.select().from(moodCheckins)
      .where(and(eq(moodCheckins.userId, userId), eq(moodCheckins.date, date)));
  }

  async getMoodCheckinsForDateRange(userId: number, startDate: string, endDate: string): Promise<MoodCheckin[]> {
    const { gte, lte } = await import("drizzle-orm");
    return await db.select().from(moodCheckins)
      .where(and(
        eq(moodCheckins.userId, userId),
        gte(moodCheckins.date, startDate),
        lte(moodCheckins.date, endDate)
      ));
  }

  async getDatesWithData(userId: number): Promise<string[]> {
    const journalDates = await db.selectDistinct({ date: journalEntries.date })
      .from(journalEntries)
      .where(eq(journalEntries.userId, userId));
    const scoreDates = await db.selectDistinct({ date: dailyScores.date })
      .from(dailyScores)
      .where(eq(dailyScores.userId, userId));
    const moodDates = await db.selectDistinct({ date: moodCheckins.date })
      .from(moodCheckins)
      .where(eq(moodCheckins.userId, userId));
    const debriefDates = await db.selectDistinct({ date: debriefs.date })
      .from(debriefs)
      .where(eq(debriefs.userId, userId));

    const allDates = new Set<string>();
    for (const r of journalDates) allDates.add(r.date);
    for (const r of scoreDates) allDates.add(r.date);
    for (const r of moodDates) allDates.add(r.date);
    for (const r of debriefDates) allDates.add(r.date);
    return Array.from(allDates);
  }

  async getAllUsersForReminder(time: string): Promise<Array<User & { subscriptions: PushSubscription[] }>> {
    const usersWithNotifs = await db.select().from(users)
      .where(eq(users.notificationsEnabled, true));
    
    const usersWithSubscriptions: Array<User & { subscriptions: PushSubscription[] }> = [];
    
    for (const user of usersWithNotifs) {
      const subs = await this.getPushSubscriptions(user.id);
      if (subs.length > 0) {
        usersWithSubscriptions.push({ ...user, subscriptions: subs });
      }
    }
    
    return usersWithSubscriptions;
  }

  // ─── Habit methods ─────────────────────────────────────────────────────────

  async getHabits(userId: number): Promise<Habit[]> {
    // Seed "Make my bed" for users who have never had any habit (existing accounts pre-Habit Lab)
    const allEver = await db.select({ id: habits.id }).from(habits).where(eq(habits.userId, userId));
    if (allEver.length === 0) {
      await db.insert(habits).values({
        userId,
        name: "Make my bed",
        emoji: "🛏️",
        category: "morning",
        anchorHabit: "I wake up",
        reminderEnabled: false,
      });
    }
    return await db.select().from(habits)
      .where(and(eq(habits.userId, userId), eq(habits.isArchived, false)))
      .orderBy(habits.createdAt);
  }

  async createHabit(habit: InsertHabit): Promise<Habit> {
    const [created] = await db.insert(habits).values(habit).returning();
    return created;
  }

  async updateHabit(id: number, userId: number, updates: Partial<InsertHabit>): Promise<Habit | undefined> {
    const [updated] = await db.update(habits)
      .set(updates)
      .where(and(eq(habits.id, id), eq(habits.userId, userId)))
      .returning();
    return updated || undefined;
  }

  async archiveHabit(id: number, userId: number): Promise<void> {
    await db.update(habits)
      .set({ isArchived: true })
      .where(and(eq(habits.id, id), eq(habits.userId, userId)));
  }

  async getHabitWithTodayStatus(userId: number, date: string): Promise<Array<Habit & { todayCompleted: boolean; last7Days: boolean[] }>> {
    const userHabits = await this.getHabits(userId);
    // Compute last 7 real calendar days (oldest → newest, ending today).
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    const last7Dates: string[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      last7Dates.push(d.toISOString().split('T')[0]);
    }
    const weekStart = last7Dates[0];
    const weekEnd = last7Dates[6];
    const weekLogs = await db.select().from(habitLogs)
      .where(and(eq(habitLogs.userId, userId), gte(habitLogs.date, weekStart), lte(habitLogs.date, weekEnd)));
    const todayCompletedSet = new Set(weekLogs.filter(l => l.date === date).map(l => l.habitId));
    return userHabits.map(h => ({
      ...h,
      todayCompleted: todayCompletedSet.has(h.id),
      last7Days: last7Dates.map(d => weekLogs.some(l => l.habitId === h.id && l.date === d)),
    }));
  }

  async toggleHabitCompletion(habitId: number, userId: number, date: string): Promise<{ habit: Habit; completed: boolean }> {
    const [existingLog] = await db.select().from(habitLogs)
      .where(and(eq(habitLogs.habitId, habitId), eq(habitLogs.userId, userId), eq(habitLogs.date, date)));

    if (existingLog) {
      // Un-complete: remove log and recalculate streak
      await db.delete(habitLogs)
        .where(and(eq(habitLogs.habitId, habitId), eq(habitLogs.userId, userId), eq(habitLogs.date, date)));
      
      // Recalculate streak from all remaining logs
      const allLogs = await db.select().from(habitLogs)
        .where(and(eq(habitLogs.habitId, habitId), eq(habitLogs.userId, userId)))
        .orderBy(desc(habitLogs.date));
      
      const { currentStreak, longestStreak, lastDate } = computeHabitStreak(allLogs.map(l => l.date));
      const [updated] = await db.update(habits)
        .set({ 
          currentStreak, 
          longestStreak: Math.max(longestStreak, 0), 
          totalCompletions: Math.max(0, (await db.select().from(habitLogs).where(and(eq(habitLogs.habitId, habitId), eq(habitLogs.userId, userId)))).length),
          lastCompletedDate: lastDate || null,
        })
        .where(and(eq(habits.id, habitId), eq(habits.userId, userId)))
        .returning();
      return { habit: updated, completed: false };
    } else {
      // Complete: add log and update streak
      await db.insert(habitLogs).values({ habitId, userId, date });
      
      const allLogs = await db.select().from(habitLogs)
        .where(and(eq(habitLogs.habitId, habitId), eq(habitLogs.userId, userId)))
        .orderBy(desc(habitLogs.date));
      
      const { currentStreak, longestStreak, lastDate } = computeHabitStreak(allLogs.map(l => l.date));
      const [habit] = await db.select().from(habits).where(eq(habits.id, habitId));
      const newLongest = Math.max(habit?.longestStreak || 0, longestStreak);
      
      const [updated] = await db.update(habits)
        .set({ 
          currentStreak, 
          longestStreak: newLongest, 
          totalCompletions: allLogs.length,
          lastCompletedDate: lastDate || date,
        })
        .where(and(eq(habits.id, habitId), eq(habits.userId, userId)))
        .returning();
      return { habit: updated, completed: true };
    }
  }

  async getHabitLogsForRange(habitId: number, userId: number, startDate: string, endDate: string): Promise<HabitLog[]> {
    const { gte: gteOp, lte } = await import("drizzle-orm");
    return await db.select().from(habitLogs)
      .where(and(
        eq(habitLogs.habitId, habitId),
        eq(habitLogs.userId, userId),
        gteOp(habitLogs.date, startDate),
        lte(habitLogs.date, endDate),
      ))
      .orderBy(habitLogs.date);
  }

  async getAllHabitsForReminder(): Promise<Array<Habit & { user: User; subscriptions: PushSubscription[] }>> {
    const activeHabits = await db.select().from(habits)
      .where(and(eq(habits.isArchived, false), eq(habits.reminderEnabled, true)));
    
    const result: Array<Habit & { user: User; subscriptions: PushSubscription[] }> = [];
    for (const habit of activeHabits) {
      if (!habit.reminderTime) continue;
      const [user] = await db.select().from(users).where(eq(users.id, habit.userId));
      if (!user || !user.notificationsEnabled) continue;
      const subs = await this.getPushSubscriptions(habit.userId);
      if (subs.length > 0) {
        result.push({ ...habit, user, subscriptions: subs });
      }
    }
    return result;
  }

  async getServerConfig(key: string): Promise<string | undefined> {
    const [row] = await db.select().from(serverConfig).where(eq(serverConfig.key, key));
    return row?.value;
  }

  async setServerConfig(key: string, value: string): Promise<void> {
    await db.insert(serverConfig).values({ key, value })
      .onConflictDoUpdate({ target: serverConfig.key, set: { value } });
  }

  // ─── Weekly Reports ─────────────────────────────────────────────────────────
  async getLatestWeeklyReport(userId: number): Promise<WeeklyReport | undefined> {
    const [row] = await db.select().from(weeklyReports)
      .where(eq(weeklyReports.userId, userId))
      .orderBy(desc(weeklyReports.createdAt))
      .limit(1);
    return row;
  }

  async getWeeklyReportByWeek(userId: number, weekStart: string): Promise<WeeklyReport | undefined> {
    const [row] = await db.select().from(weeklyReports)
      .where(and(eq(weeklyReports.userId, userId), eq(weeklyReports.weekStart, weekStart)));
    return row;
  }

  async createWeeklyReport(report: InsertWeeklyReport): Promise<WeeklyReport> {
    const [created] = await db.insert(weeklyReports).values(report).returning();
    return created;
  }

  async markWeeklyReportNotificationSent(id: number): Promise<void> {
    await db.update(weeklyReports).set({ notificationSent: true }).where(eq(weeklyReports.id, id));
  }

  async getAllUsersForWeeklyReport(): Promise<Array<User & { subscriptions: PushSubscription[] }>> {
    const allUsers = await db.select().from(users)
      .where(eq(users.notificationsEnabled, true));
    return Promise.all(allUsers.map(async (u) => {
      const subs = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, u.id));
      return { ...u, subscriptions: subs };
    }));
  }

  // ─── Performance Patterns ───────────────────────────────────────────────────
  async getActivePerformancePatterns(userId: number): Promise<PerformancePattern[]> {
    return db.select().from(performancePatterns)
      .where(and(eq(performancePatterns.userId, userId), eq(performancePatterns.isActive, true)))
      .orderBy(desc(performancePatterns.generatedAt));
  }

  async replacePerformancePatterns(userId: number, patterns: InsertPerformancePattern[]): Promise<PerformancePattern[]> {
    await db.update(performancePatterns)
      .set({ isActive: false })
      .where(eq(performancePatterns.userId, userId));
    if (patterns.length === 0) return [];
    const created = await db.insert(performancePatterns).values(patterns).returning();
    return created;
  }
}

// ─── Streak computation helper ──────────────────────────────────────────────
function computeHabitStreak(sortedDatesDesc: string[]): { currentStreak: number; longestStreak: number; lastDate: string | null } {
  if (sortedDatesDesc.length === 0) return { currentStreak: 0, longestStreak: 0, lastDate: null };
  
  const sorted = [...sortedDatesDesc].sort((a, b) => b.localeCompare(a));
  const today = new Date().toISOString().split('T')[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  
  let currentStreak = 0;
  let longestStreak = 0;
  let tempStreak = 1;
  let checkingCurrent = true;
  
  // Current streak: must include today or yesterday
  if (sorted[0] === today || sorted[0] === yesterday) {
    currentStreak = 1;
    for (let i = 1; i < sorted.length; i++) {
      const prev = new Date(sorted[i - 1]);
      const curr = new Date(sorted[i]);
      const diffDays = Math.round((prev.getTime() - curr.getTime()) / 86400000);
      if (diffDays === 1) {
        currentStreak++;
      } else {
        break;
      }
    }
  }
  
  // Longest streak: scan all
  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i - 1]);
    const curr = new Date(sorted[i]);
    const diffDays = Math.round((prev.getTime() - curr.getTime()) / 86400000);
    if (diffDays === 1) {
      tempStreak++;
    } else {
      longestStreak = Math.max(longestStreak, tempStreak);
      tempStreak = 1;
    }
  }
  longestStreak = Math.max(longestStreak, tempStreak, currentStreak);
  
  return { currentStreak, longestStreak, lastDate: sorted[0] || null };
}

export const storage = new DatabaseStorage();