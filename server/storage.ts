import { 
  users, journalEntries, dailyScores, userMetrics, streaks, aiInsights, pushSubscriptions,
  goalTemplates, dailyGoals, journalAttachments, moodCheckins, debriefs, debriefMessages, habits, habitLogs, serverConfig,
  weeklyReports, performancePatterns, infiniteGoals, longTermGoals, userConnections,
  type User, type InsertUser, type JournalEntry, type InsertJournalEntry,
  type DailyScore, type InsertDailyScore, type UserMetric, type InsertUserMetric,
  type Streak, type InsertStreak, type AIInsight, type InsertAIInsight,
  type PushSubscription, type InsertPushSubscription,
  type GoalTemplate, type InsertGoalTemplate, type DailyGoal, type InsertDailyGoal,
  type JournalAttachment, type InsertJournalAttachment, type MoodCheckin, type InsertMoodCheckin,
  type Habit, type InsertHabit, type HabitLog,
  type WeeklyReport, type InsertWeeklyReport,
  type PerformancePattern, type InsertPerformancePattern,
  type UserConnection, type ConnectionPublicStats,
} from "@shared/schema";
import { organisations, orgMembers, orgChallenges } from "@shared/corporate-schema";
import type { Organisation, InsertOrganisation, OrgMember, InsertOrgMember, OrgMemberUpdate } from "@shared/corporate-schema";
import { db } from "./db";
import { eq, and, asc, desc, gte, lte, gt, or, ne, sql } from "drizzle-orm";
import { encrypt, decrypt } from "./encryption";

export interface IStorage {
  // User methods
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUserSettings(userId: number, settings: Partial<Pick<User, 'notificationsEnabled' | 'moodRemindersEnabled' | 'reminderTime' | 'reminderTime2' | 'timezone' | 'healthMetricsEnabled' | 'hasCompletedOnboarding' | 'journalPreference' | 'goalPreference' | 'userProfile' | 'displayName' | 'driverHandle'>>): Promise<User | undefined>;
  getUserByHandle(handle: string): Promise<User | undefined>;
  isHandleAvailable(handle: string, excludeUserId?: number): Promise<boolean>;
  searchUsers(query: string, excludeUserId: number): Promise<Pick<User, "id" | "driverHandle" | "displayName">[]>;

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
  clearAutoSyncedScore(userId: number, date: string, metricName: string): Promise<void>;

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
  saveFcmToken(userId: number, fcmToken: string): Promise<PushSubscription>;
  deleteFcmToken(fcmToken: string): Promise<void>;
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
  isHabitCompletedToday(habitId: number, date: string): Promise<boolean>;
  hasUserLoggedMoodInPeriod(userId: number, date: string, periodStartHour: number, periodEndHour: number, timezone: string): Promise<boolean>;

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

  // User connection methods (accountability pairs / squad)
  searchUsers(query: string, excludeUserId: number): Promise<Pick<User, "id" | "username" | "displayName">[]>;
  sendConnectionRequest(requesterId: number, receiverId: number): Promise<UserConnection>;
  getConnectionsByUser(userId: number): Promise<UserConnection[]>;
  getConnectionById(connectionId: number): Promise<UserConnection | undefined>;
  acceptConnection(connectionId: number, receiverId: number): Promise<UserConnection | undefined>;
  declineConnection(connectionId: number, receiverId: number): Promise<void>;
  removeConnection(connectionId: number, userId: number): Promise<void>;
  getConnectionPublicStats(userId: number, viewerId: number): Promise<ConnectionPublicStats | null>;
  getAllConnectionStats(viewerId: number): Promise<ConnectionPublicStats[]>;
  getLeaderboard(viewerId: number, sortBy: "streak" | "consistency" | "score"): Promise<import("@shared/schema").LeaderboardEntry[]>;

  // Account deletion
  deleteUser(userId: number): Promise<void>;

  // Corporate Tier methods
  getOrganisationById(id: number): Promise<Organisation | undefined>;
  getOrganisationByAdmin(adminUserId: number): Promise<Organisation | undefined>;
  createOrganisation(data: InsertOrganisation): Promise<Organisation>;
  updateOrganisation(id: number, updates: Partial<InsertOrganisation>): Promise<Organisation | undefined>;
  getOrgMembershipByUser(userId: number): Promise<(OrgMember & { organisation: Organisation }) | undefined>;
  getOrgMembersByOrg(orgId: number): Promise<OrgMember[]>;
  createOrgMember(data: InsertOrgMember): Promise<OrgMember>;
  updateOrgMember(id: number, updates: OrgMemberUpdate): Promise<OrgMember | undefined>;
  getOrgMemberByToken(token: string): Promise<OrgMember | undefined>;
  getOrgMemberByEmail(orgId: number, email: string): Promise<OrgMember | undefined>;
  getOrgTeamStats(orgId: number): Promise<{ avgStreak: number; avgConsistency: number; activeCount: number; pendingCount: number }>;
  addOrgChallenge(orgId: number, challengeId: number): Promise<void>;
  getOrgChallengeIds(orgId: number): Promise<number[]>;

  // Challenge methods
  createChallenge(creatorId: number, data: import("@shared/schema").InsertChallenge, creatorCommitment?: string, creatorReminderTime?: string): Promise<import("@shared/schema").Challenge>;
  getChallengesForUser(userId: number, today?: string): Promise<import("@shared/schema").ChallengeWithProgress[]>;
  getChallengeById(challengeId: number): Promise<import("@shared/schema").Challenge | undefined>;
  joinChallenge(challengeId: number, userId: number, commitment?: string, reminderTime?: string): Promise<void>;
  getChallengesNeedingReminders(dateStr: string): Promise<Array<{ userId: number; challengeId: number; challengeTitle: string; reminderTime: string; subscriptions: any[]; timezone: string | null; notificationsEnabled: boolean }>>;
  declineChallenge(challengeId: number, userId: number): Promise<void>;
  leaveChallenge(challengeId: number, userId: number): Promise<void>;
  deleteChallenge(challengeId: number, userId: number): Promise<void>;
  updateChallenge(challengeId: number, userId: number, data: { title?: string; endDate?: string }): Promise<import("@shared/schema").Challenge | undefined>;
  updateChallengeParticipantReminder(challengeId: number, userId: number, reminderTime: string | null): Promise<void>;
  logChallengeEntry(challengeId: number, userId: number, date: string, value: number): Promise<void>;
  getChallengeLeaderboard(challengeId: number, viewerId: number): Promise<import("@shared/schema").ChallengeLeaderboard>;
  inviteToChallenge(challengeId: number, inviteeUserId: number, inviterId: number): Promise<void>;
  getUserPoints(userId: number): Promise<number>;
  getWeeklyActivityPoints(userId: number): Promise<number>;
  getGlobalWeeklyRank(userId: number): Promise<{ rank: number; total: number }>;
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
      { id: 5, userId: 1, name: "Sleep Score", color: "#8B5CF6", maxValue: 100, isDefault: false, isActive: true },
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
      { id: 5, userId: 1, date: yesterdayStr, metricName: "Sleep Score", value: 82, isAutoSynced: true },
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

  async clearAutoSyncedScore(userId: number, date: string, metricName: string): Promise<void> {
    const existing = Array.from(this.dailyScores.values()).find(s =>
      s.userId === userId && s.date === date && s.metricName === metricName && s.isAutoSynced === true
    );
    if (existing) this.dailyScores.delete(existing.id);
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

  async updateUserSettings(userId: number, settings: Partial<Pick<User, 'notificationsEnabled' | 'moodRemindersEnabled' | 'reminderTime' | 'reminderTime2' | 'timezone' | 'healthMetricsEnabled' | 'hasCompletedOnboarding' | 'journalPreference' | 'goalPreference' | 'userProfile' | 'displayName' | 'driverHandle'>>): Promise<User | undefined> {
    const user = this.users.get(userId);
    if (user) {
      Object.assign(user, settings);
      this.users.set(userId, user);
      return user;
    }
    return undefined;
  }

  async getUserByHandle(handle: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(u => u.driverHandle?.toLowerCase() === handle.toLowerCase());
  }

  async isHandleAvailable(handle: string, excludeUserId?: number): Promise<boolean> {
    return !Array.from(this.users.values()).some(u =>
      u.driverHandle?.toLowerCase() === handle.toLowerCase() && u.id !== excludeUserId
    );
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

  async saveFcmToken(_userId: number, _fcmToken: string): Promise<PushSubscription> {
    return {} as PushSubscription;
  }

  async deleteFcmToken(_fcmToken: string): Promise<void> {}

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
  async isHabitCompletedToday(_habitId: number, _date: string): Promise<boolean> { return false; }
  async hasUserLoggedMoodInPeriod(_userId: number, _date: string, _periodStartHour: number, _periodEndHour: number, _timezone: string): Promise<boolean> { return false; }
  async getServerConfig(_key: string): Promise<string | undefined> { return undefined; }
  async setServerConfig(_key: string, _value: string): Promise<void> {}
  async getLatestWeeklyReport(_userId: number): Promise<WeeklyReport | undefined> { return undefined; }
  async getWeeklyReportByWeek(_userId: number, _weekStart: string): Promise<WeeklyReport | undefined> { return undefined; }
  async createWeeklyReport(report: InsertWeeklyReport): Promise<WeeklyReport> { return { id: 1, ...report, createdAt: new Date() } as any; }
  async markWeeklyReportNotificationSent(_id: number): Promise<void> {}
  async getAllUsersForWeeklyReport(): Promise<Array<User & { subscriptions: PushSubscription[] }>> { return []; }
  async getActivePerformancePatterns(_userId: number): Promise<PerformancePattern[]> { return []; }
  async replacePerformancePatterns(_userId: number, _patterns: InsertPerformancePattern[]): Promise<PerformancePattern[]> { return []; }
  async deleteUser(_userId: number): Promise<void> {}
  // Connection stubs
  async searchUsers(_q: string, _ex: number): Promise<Pick<User, "id" | "driverHandle" | "displayName">[]> { return []; }
  async getUserByHandle(_handle: string): Promise<User | undefined> { return undefined; }
  async isHandleAvailable(_handle: string, _excludeUserId?: number): Promise<boolean> { return true; }
  async sendConnectionRequest(_rId: number, _rcId: number): Promise<UserConnection> { throw new Error("Not implemented"); }
  async getConnectionsByUser(_userId: number): Promise<UserConnection[]> { return []; }
  async getConnectionById(_id: number): Promise<UserConnection | undefined> { return undefined; }
  async acceptConnection(_id: number, _rcId: number): Promise<UserConnection | undefined> { return undefined; }
  async declineConnection(_id: number, _rcId: number): Promise<void> {}
  async removeConnection(_id: number, _userId: number): Promise<void> {}
  async getConnectionPublicStats(_userId: number, _viewerId: number): Promise<ConnectionPublicStats | null> { return null; }
  async getAllConnectionStats(_viewerId: number): Promise<ConnectionPublicStats[]> { return []; }
  async getLeaderboard(_viewerId: number, _sortBy: "streak" | "consistency" | "score"): Promise<import("@shared/schema").LeaderboardEntry[]> { return []; }
  async getUserPoints(_userId: number): Promise<number> { return 0; }
  async getWeeklyActivityPoints(_userId: number): Promise<number> { return 0; }
  async getGlobalWeeklyRank(_userId: number): Promise<{ rank: number; total: number }> { return { rank: 1, total: 1 }; }
  // Challenge stubs (MemStorage not used in production)
  async createChallenge(): Promise<any> { throw new Error("Not implemented"); }
  async getChallengesForUser(): Promise<any[]> { return []; }
  async getChallengeById(): Promise<any> { return undefined; }
  async joinChallenge(): Promise<void> {}
  async declineChallenge(): Promise<void> {}
  async leaveChallenge(): Promise<void> {}
  async deleteChallenge(): Promise<void> {}
  async updateChallenge(): Promise<any> { return undefined; }
  async updateChallengeParticipantReminder(): Promise<void> {}
  async logChallengeEntry(): Promise<void> {}
  async getChallengeLeaderboard(): Promise<any> { return { entries: [], scoresHidden: false, submittedToday: 0, totalParticipants: 0 }; }
  async inviteToChallenge(): Promise<void> {}
  async getChallengesNeedingReminders(): Promise<any[]> { return []; }
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

  async clearAutoSyncedScore(userId: number, date: string, metricName: string): Promise<void> {
    await db.delete(dailyScores).where(and(
      eq(dailyScores.userId, userId),
      eq(dailyScores.date, date),
      eq(dailyScores.metricName, metricName),
      eq(dailyScores.isAutoSynced, true)
    ));
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
      .where(and(eq(aiInsights.userId, userId), eq(aiInsights.isActive, true)))
      .orderBy(desc(aiInsights.createdAt));
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

  async updateUserSettings(userId: number, settings: Partial<Pick<User, 'notificationsEnabled' | 'moodRemindersEnabled' | 'reminderTime' | 'reminderTime2' | 'timezone' | 'healthMetricsEnabled' | 'hasCompletedOnboarding' | 'journalPreference' | 'goalPreference' | 'userProfile' | 'displayName' | 'driverHandle'>>): Promise<User | undefined> {
    const [updated] = await db.update(users)
      .set(settings)
      .where(eq(users.id, userId))
      .returning();
    return updated || undefined;
  }

  async getUserByHandle(handle: string): Promise<User | undefined> {
    const [user] = await db.select().from(users)
      .where(sql`LOWER(${users.driverHandle}) = ${handle.toLowerCase()}`);
    return user || undefined;
  }

  async isHandleAvailable(handle: string, excludeUserId?: number): Promise<boolean> {
    const conditions = [sql`LOWER(${users.driverHandle}) = ${handle.toLowerCase()}`];
    if (excludeUserId !== undefined) conditions.push(ne(users.id, excludeUserId));
    const [existing] = await db.select({ id: users.id }).from(users)
      .where(excludeUserId !== undefined
        ? and(sql`LOWER(${users.driverHandle}) = ${handle.toLowerCase()}`, ne(users.id, excludeUserId))
        : sql`LOWER(${users.driverHandle}) = ${handle.toLowerCase()}`
      );
    return !existing;
  }

  async getPushSubscriptions(userId: number): Promise<PushSubscription[]> {
    return await db.select().from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, userId))
      .orderBy(asc(pushSubscriptions.id));
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

  async saveFcmToken(userId: number, fcmToken: string): Promise<PushSubscription> {
    const endpoint = `fcm:${fcmToken}`;
    const [row] = await db.insert(pushSubscriptions)
      .values({ userId, endpoint, p256dh: "", auth: "", apnsToken: null })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: { userId },
      })
      .returning();
    return row;
  }

  async deleteFcmToken(fcmToken: string): Promise<void> {
    await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, `fcm:${fcmToken}`));
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
    // If the title changed, also update any daily goal rows for today/future
    // so they reflect the new name immediately on refetch.
    if (updated && updates.title) {
      const { gte } = await import("drizzle-orm");
      const now = new Date();
      const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      await db.update(dailyGoals)
        .set({ title: updates.title })
        .where(and(
          eq(dailyGoals.goalTemplateId, id),
          eq(dailyGoals.userId, userId),
          gte(dailyGoals.date, todayStr),
        ));
    }
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
    const SMILE_HABIT = "make someone smile";

    // Seed defaults for users who have never had any habit (existing accounts pre-Habit Lab)
    const allEver = await db.select().from(habits).where(eq(habits.userId, userId));
    if (allEver.length === 0) {
      await db.insert(habits).values([
        { userId, name: "Make someone smile", emoji: "😊", category: "daily", anchorHabit: null, reminderEnabled: false },
        { userId, name: "Make my bed", emoji: "🛏️", category: "morning", anchorHabit: "I wake up", reminderEnabled: false },
      ]);
    } else {
      // Back-seed/rename the smile habit for all existing users
      const smileOld = allEver.find(h => h.name.toLowerCase() === "do something to make someone smile");
      const smileNew = allEver.find(h => h.name.toLowerCase() === SMILE_HABIT);

      if (smileOld && !smileNew) {
        // Rename the old habit to the new shorter name
        await db.update(habits).set({ name: "Make someone smile" }).where(eq(habits.id, smileOld.id));
      } else if (!smileOld && !smileNew) {
        // No smile habit at all — create it
        await db.insert(habits).values({
          userId,
          name: "Make someone smile",
          emoji: "😊",
          category: "daily",
          anchorHabit: null,
          reminderEnabled: false,
        });
      }
    }

    const active = await db.select().from(habits)
      .where(and(eq(habits.userId, userId), eq(habits.isArchived, false)))
      .orderBy(habits.createdAt);

    // Always pin "Make someone smile" first
    const smileIdx = active.findIndex(h => h.name.toLowerCase() === SMILE_HABIT);
    if (smileIdx > 0) {
      const [smile] = active.splice(smileIdx, 1);
      active.unshift(smile);
    }

    return active;
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
    const allHabits = await this.getHabits(userId);
    const { isHabitDueToday } = await import("@shared/habitUtils");
    // Compute Mon–Sun of the current calendar week
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    const dow = today.getDay(); // 0=Sun … 6=Sat
    const monday = new Date(today);
    monday.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1));
    const weekDates: string[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      weekDates.push(d.toISOString().split('T')[0]);
    }
    const weekStart = weekDates[0]; // Monday
    const weekEnd   = weekDates[6]; // Sunday
    const weekLogs = await db.select().from(habitLogs)
      .where(and(eq(habitLogs.userId, userId), gte(habitLogs.date, weekStart), lte(habitLogs.date, weekEnd)));
    const todayCompletedSet = new Set(weekLogs.filter(l => l.date === date).map(l => l.habitId));
    // Return ALL non-archived habits — dueToday=false means it's a rest/future day, not hidden
    return allHabits.map(h => {
      const effStart: string | null =
        (h as any).startDate ||
        (h.createdAt ? new Date(h.createdAt).toISOString().split('T')[0] : null);
      return {
        ...h,
        dueToday: isHabitDueToday(h, date),
        todayCompleted: todayCompletedSet.has(h.id),
        last7Days: weekDates.map(d => weekLogs.some(l => l.habitId === h.id && l.date === d)),
        last7Scheduled: weekDates.map(d => isHabitDueToday(h, d)),
        last7BeforeStart: weekDates.map(d => !!(effStart && d < effStart)),
      };
    });
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

  async isHabitCompletedToday(habitId: number, date: string): Promise<boolean> {
    const [log] = await db.select({ id: habitLogs.id }).from(habitLogs)
      .where(and(eq(habitLogs.habitId, habitId), eq(habitLogs.date, date)))
      .limit(1);
    return !!log;
  }

  async hasUserLoggedMoodInPeriod(userId: number, date: string, periodStartHour: number, periodEndHour: number, timezone: string): Promise<boolean> {
    // Use createdAt AT TIME ZONE for BOTH the date and the hour checks.
    // The stored `date` column uses UTC date which can differ from the user's local
    // date for western timezones (e.g. 9 PM Pacific = next UTC day), causing false misses.
    const [entry] = await db.select({ id: moodCheckins.id }).from(moodCheckins)
      .where(and(
        eq(moodCheckins.userId, userId),
        sql`DATE(${moodCheckins.createdAt} AT TIME ZONE ${timezone}) = ${date}::date`,
        sql`EXTRACT(HOUR FROM ${moodCheckins.createdAt} AT TIME ZONE ${timezone}) >= ${periodStartHour}`,
        sql`EXTRACT(HOUR FROM ${moodCheckins.createdAt} AT TIME ZONE ${timezone}) < ${periodEndHour}`,
      ))
      .limit(1);
    return !!entry;
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
    const todayStr = new Date().toISOString().split("T")[0];
    const [row] = await db.select().from(weeklyReports)
      .where(and(eq(weeklyReports.userId, userId), lte(weeklyReports.weekEnd, todayStr)))
      .orderBy(desc(weeklyReports.weekStart))
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

  // ─── User Connections ────────────────────────────────────────────────────────

  async searchUsers(query: string, excludeUserId: number): Promise<Pick<User, "id" | "driverHandle" | "displayName">[]> {
    const stripped = query.replace(/^@/, "");
    const q = `%${stripped.toLowerCase()}%`;
    const rows = await db.select({ id: users.id, driverHandle: users.driverHandle, displayName: users.displayName })
      .from(users)
      .where(and(
        ne(users.id, excludeUserId),
        sql`${users.driverHandle} IS NOT NULL`,
        sql`LOWER(COALESCE(${users.driverHandle}, '')) LIKE ${q}`
      ))
      .limit(10);
    return rows;
  }

  async sendConnectionRequest(requesterId: number, receiverId: number): Promise<UserConnection> {
    const [row] = await db.insert(userConnections)
      .values({ requesterId, receiverId, status: "pending" })
      .returning();
    return row;
  }

  async getConnectionsByUser(userId: number): Promise<UserConnection[]> {
    return db.select().from(userConnections)
      .where(or(
        eq(userConnections.requesterId, userId),
        eq(userConnections.receiverId, userId)
      ));
  }

  async getConnectionById(connectionId: number): Promise<UserConnection | undefined> {
    const [row] = await db.select().from(userConnections).where(eq(userConnections.id, connectionId));
    return row;
  }

  async acceptConnection(connectionId: number, receiverId: number): Promise<UserConnection | undefined> {
    const [row] = await db.update(userConnections)
      .set({ status: "accepted" })
      .where(and(eq(userConnections.id, connectionId), eq(userConnections.receiverId, receiverId)))
      .returning();
    return row;
  }

  async declineConnection(connectionId: number, receiverId: number): Promise<void> {
    await db.update(userConnections)
      .set({ status: "declined" })
      .where(and(eq(userConnections.id, connectionId), eq(userConnections.receiverId, receiverId)));
  }

  async removeConnection(connectionId: number, userId: number): Promise<void> {
    await db.delete(userConnections)
      .where(and(
        eq(userConnections.id, connectionId),
        or(eq(userConnections.requesterId, userId), eq(userConnections.receiverId, userId))
      ));
  }

  async getConnectionPublicStats(targetUserId: number, viewerId: number): Promise<ConnectionPublicStats | null> {
    // Verify they are actually connected
    const [conn] = await db.select().from(userConnections)
      .where(and(
        eq(userConnections.status, "accepted"),
        or(
          and(eq(userConnections.requesterId, viewerId), eq(userConnections.receiverId, targetUserId)),
          and(eq(userConnections.requesterId, targetUserId), eq(userConnections.receiverId, viewerId))
        )
      ));
    if (!conn) return null;

    return this._buildPublicStats(targetUserId, conn, viewerId);
  }

  async getAllConnectionStats(viewerId: number): Promise<ConnectionPublicStats[]> {
    const conns = await db.select().from(userConnections)
      .where(or(
        eq(userConnections.requesterId, viewerId),
        eq(userConnections.receiverId, viewerId)
      ));

    const results: ConnectionPublicStats[] = [];
    for (const conn of conns) {
      const targetId = conn.requesterId === viewerId ? conn.receiverId : conn.requesterId;
      const stats = await this._buildPublicStats(targetId, conn, viewerId);
      if (stats) results.push(stats);
    }
    return results;
  }

  async getLeaderboard(viewerId: number, sortBy: "streak" | "consistency" | "score"): Promise<import("@shared/schema").LeaderboardEntry[]> {
    // Collect self + all accepted connections
    const conns = await db.select().from(userConnections)
      .where(and(
        eq(userConnections.status, "accepted"),
        or(eq(userConnections.requesterId, viewerId), eq(userConnections.receiverId, viewerId))
      ));

    // Fake connection record representing the viewer themselves
    const selfConn: UserConnection = {
      id: -1,
      requesterId: viewerId,
      receiverId: viewerId,
      status: "accepted",
      createdAt: new Date(),
    };

    const entries: import("@shared/schema").LeaderboardEntry[] = [];

    // Self
    const selfStats = await this._buildPublicStats(viewerId, selfConn, viewerId);
    if (selfStats) entries.push({ ...selfStats, isMe: true, rank: 0 });

    // Accepted connections
    for (const conn of conns) {
      const targetId = conn.requesterId === viewerId ? conn.receiverId : conn.requesterId;
      const stats = await this._buildPublicStats(targetId, conn, viewerId);
      if (stats) entries.push({ ...stats, isMe: false, rank: 0 });
    }

    // Sort
    entries.sort((a, b) => {
      if (sortBy === "streak") return (b.currentStreak - a.currentStreak) || (b.sevenDayConsistency - a.sevenDayConsistency);
      if (sortBy === "consistency") return (b.sevenDayConsistency - a.sevenDayConsistency) || (b.currentStreak - a.currentStreak);
      // score: rank by weeklyPoints first, tiebreak by lifetime points
      return (b.weeklyPoints - a.weeklyPoints) || (b.points - a.points);
    });

    // Assign ranks (ties share the same rank)
    let rank = 1;
    for (let i = 0; i < entries.length; i++) {
      if (i > 0) {
        const prev = entries[i - 1];
        const cur = entries[i];
        const tied = sortBy === "streak"
          ? prev.currentStreak === cur.currentStreak && prev.sevenDayConsistency === cur.sevenDayConsistency
          : sortBy === "consistency"
          ? prev.sevenDayConsistency === cur.sevenDayConsistency && prev.currentStreak === cur.currentStreak
          : prev.weeklyPoints === cur.weeklyPoints && prev.points === cur.points;
        if (!tied) rank = i + 1;
      }
      entries[i].rank = rank;
    }

    return entries;
  }

  private async _getUserPoints(userId: number): Promise<number> {
    const MILESTONES = [3, 7, 14, 30, 50, 100, 365];
    const thirtyAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    let pts = 0;

    // 1. Streak points: 10 per active streak day
    const streak = await this.getUserStreak(userId);
    const currentStreak = streak?.currentStreak ?? 0;
    const longestStreak = streak?.longestStreak ?? 0;
    pts += currentStreak * 10;

    // 2. Milestone bonuses: +50 for each milestone ever reached
    for (const m of MILESTONES) {
      if (longestStreak >= m) pts += 50;
    }

    // 3. Consistency: +10 per day in last 30 with any manual score
    const allScores = await this.getDailyScoresByUser(userId);
    const scoreDays = new Set(
      allScores.filter(s => s.date >= thirtyAgo && s.value > 0 && !s.isAutoSynced).map(s => s.date)
    );
    pts += scoreDays.size * 10;

    // 4. Habit completions in last 30 days: +5 per completion, +20 all-done bonus
    // (Every habitLog row IS a completion — there is no completed field)
    const activeHabits = await db.select({ id: habits.id }).from(habits)
      .where(and(eq(habits.userId, userId), eq(habits.isArchived, false)));
    const totalActiveHabits = activeHabits.length;
    const habitLogsRecent = await db.select({ date: habitLogs.date, habitId: habitLogs.habitId })
      .from(habitLogs)
      .where(and(eq(habitLogs.userId, userId), gte(habitLogs.date, thirtyAgo)));
    const habitByDate = new Map<string, Set<number>>();
    for (const log of habitLogsRecent) {
      if (!habitByDate.has(log.date)) habitByDate.set(log.date, new Set());
      habitByDate.get(log.date)!.add(log.habitId);
    }
    for (const [, habitsDone] of habitByDate) {
      pts += habitsDone.size * 5;
      if (totalActiveHabits > 0 && habitsDone.size >= totalActiveHabits) pts += 20;
    }

    // 5. Goal completions in last 30 days: +5 per completion, +20 all-done bonus
    const allGoals = await db.select().from(dailyGoals)
      .where(and(eq(dailyGoals.userId, userId), gte(dailyGoals.date, thirtyAgo)));
    const goalsByDate = new Map<string, { total: number; completed: number }>();
    for (const goal of allGoals) {
      const entry = goalsByDate.get(goal.date) ?? { total: 0, completed: 0 };
      goalsByDate.set(goal.date, {
        total: entry.total + 1,
        completed: entry.completed + (goal.completed ? 1 : 0),
      });
    }
    for (const [, { total, completed }] of goalsByDate) {
      pts += completed * 5;
      if (total > 0 && completed >= total) pts += 20;
    }

    return pts;
  }

  private async _buildPublicStats(targetUserId: number, conn: UserConnection, viewerId: number): Promise<ConnectionPublicStats | null> {
    const user = await this.getUser(targetUserId);
    if (!user) return null;

    const streak = await this.getUserStreak(targetUserId);
    const allScores = await this.getDailyScoresByUser(targetUserId);

    const todayStr = new Date().toISOString().split("T")[0];
    const sevenAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    const thirtyAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

    const recentScores = allScores.filter(s => s.date >= sevenAgo && s.value > 0 && !s.isAutoSynced);
    const thirtyDayScores = allScores.filter(s => s.date >= thirtyAgo && s.value > 0 && !s.isAutoSynced);
    const todayScores = allScores.filter(s => s.date === todayStr && s.value > 0 && !s.isAutoSynced);

    const sevenDayDays = Math.min(7, new Set(recentScores.map(s => s.date)).size);
    const sevenDayConsistency = Math.round((sevenDayDays / 7) * 100);

    const thirtyDayAvgScore = thirtyDayScores.length > 0
      ? Math.round(thirtyDayScores.reduce((a, b) => a + b.value, 0) / thirtyDayScores.length)
      : null;

    const todayAvgScore = todayScores.length > 0
      ? Math.round(todayScores.reduce((a, b) => a + b.value, 0) / todayScores.length)
      : null;

    const lastLoggedDate = allScores
      .filter(s => s.value > 0 && !s.isAutoSynced)
      .sort((a, b) => b.date.localeCompare(a.date))[0]?.date ?? null;

    const [points, weeklyPoints] = await Promise.all([
      this._getUserPoints(targetUserId),
      this.getWeeklyActivityPoints(targetUserId),
    ]);

    return {
      userId: targetUserId,
      username: user.username,
      displayName: user.displayName,
      driverHandle: user.driverHandle ?? null,
      currentStreak: streak?.currentStreak ?? 0,
      longestStreak: streak?.longestStreak ?? 0,
      sevenDayConsistency,
      thirtyDayAvgScore,
      todayAvgScore,
      points,
      weeklyPoints,
      lastLoggedDate,
      connectionId: conn.id,
      status: conn.status,
      isRequester: conn.requesterId === viewerId,
    };
  }

  async deleteUser(userId: number): Promise<void> {
    // Delete in dependency order — children before parents
    const userHabits = await db.select({ id: habits.id }).from(habits).where(eq(habits.userId, userId));
    if (userHabits.length > 0) {
      const habitIds = userHabits.map(h => h.id);
      for (const hid of habitIds) {
        await db.delete(habitLogs).where(eq(habitLogs.habitId, hid));
      }
    }

    const userDebriefs = await db.select({ id: debriefs.id }).from(debriefs).where(eq(debriefs.userId, userId));
    if (userDebriefs.length > 0) {
      for (const d of userDebriefs) {
        await db.delete(debriefMessages).where(eq(debriefMessages.debriefId, d.id));
      }
    }

    const userJournals = await db.select({ id: journalEntries.id }).from(journalEntries).where(eq(journalEntries.userId, userId));
    if (userJournals.length > 0) {
      for (const j of userJournals) {
        await db.delete(journalAttachments).where(eq(journalAttachments.journalEntryId, j.id));
      }
    }

    const userGoals = await db.select({ id: goalTemplates.id }).from(goalTemplates).where(eq(goalTemplates.userId, userId));
    if (userGoals.length > 0) {
      for (const g of userGoals) {
        await db.delete(dailyGoals).where(eq(dailyGoals.goalTemplateId, g.id));
      }
    }

    await db.delete(debriefs).where(eq(debriefs.userId, userId));
    await db.delete(journalEntries).where(eq(journalEntries.userId, userId));
    await db.delete(dailyScores).where(eq(dailyScores.userId, userId));
    await db.delete(userMetrics).where(eq(userMetrics.userId, userId));
    await db.delete(streaks).where(eq(streaks.userId, userId));
    await db.delete(aiInsights).where(eq(aiInsights.userId, userId));
    await db.delete(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
    await db.delete(goalTemplates).where(eq(goalTemplates.userId, userId));
    await db.delete(moodCheckins).where(eq(moodCheckins.userId, userId));
    await db.delete(habits).where(eq(habits.userId, userId));
    await db.delete(weeklyReports).where(eq(weeklyReports.userId, userId));
    await db.delete(performancePatterns).where(eq(performancePatterns.userId, userId));
    await db.delete(infiniteGoals).where(eq(infiniteGoals.userId, userId));
    await db.delete(longTermGoals).where(eq(longTermGoals.userId, userId));
    await db.delete(users).where(eq(users.id, userId));
  }

  // ── Challenge methods ────────────────────────────────────────────────────────

  async createChallenge(creatorId: number, data: import("@shared/schema").InsertChallenge, creatorCommitment?: string, creatorReminderTime?: string): Promise<import("@shared/schema").Challenge> {
    const { challenges, challengeParticipants } = await import("@shared/schema");
    const [ch] = await db.insert(challenges).values({ ...data, creatorId }).returning();
    await db.insert(challengeParticipants).values({
      challengeId: ch.id,
      userId: creatorId,
      status: "joined",
      commitment: creatorCommitment ?? null,
      reminderTime: creatorReminderTime ?? null,
    });
    return ch;
  }

  async getChallengesForUser(userId: number, clientToday?: string): Promise<import("@shared/schema").ChallengeWithProgress[]> {
    const { challenges, challengeParticipants, challengeLogs } = await import("@shared/schema");
    const participations = await db.select().from(challengeParticipants)
      .where(eq(challengeParticipants.userId, userId));
    if (participations.length === 0) return [];

    // Prefer the client-supplied local date (most accurate); fall back to user's stored timezone.
    const userRecord = await this.getUser(userId);
    const today = clientToday ?? todayInTz(userRecord?.timezone);

    const challengeIds = participations.map(p => p.challengeId);
    const allChallenges = await db.select().from(challenges)
      .where(sql`${challenges.id} = ANY(ARRAY[${sql.join(challengeIds.map(id => sql`${id}`), sql`, `)}]::int[])`);

    const results: import("@shared/schema").ChallengeWithProgress[] = [];
    for (const ch of allChallenges) {
      const allParticipants = await db.select().from(challengeParticipants)
        .where(and(eq(challengeParticipants.challengeId, ch.id), eq(challengeParticipants.status, "joined")));
      const myPart = participations.find(p => p.challengeId === ch.id);
      const creator = await this.getUser(ch.creatorId);

      const myLogs = await db.select().from(challengeLogs)
        .where(and(
          eq(challengeLogs.challengeId, ch.id),
          eq(challengeLogs.userId, userId),
        ));
      const loggedToday = myLogs.some(l => l.date === today);
      const daysLogged = new Set(myLogs.map(l => l.date)).size;
      const avgScore = ch.type === "score" && myLogs.length > 0
        ? Math.round(myLogs.reduce((s, l) => s + l.value, 0) / myLogs.length)
        : daysLogged;

      results.push({
        ...ch,
        participantCount: allParticipants.length,
        myStatus: myPart?.status ?? "invited",
        myStats: myPart ? { score: avgScore, daysLogged, loggedToday } : null,
        creatorUsername: creator?.username ?? "",
        creatorDisplayName: creator?.displayName ?? null,
        myCommitment: myPart?.commitment ?? null,
        myReminderTime: myPart?.reminderTime ?? null,
      });
    }
    return results;
  }

  async getChallengeById(challengeId: number): Promise<import("@shared/schema").Challenge | undefined> {
    const { challenges } = await import("@shared/schema");
    const [ch] = await db.select().from(challenges).where(eq(challenges.id, challengeId));
    return ch;
  }

  async joinChallenge(challengeId: number, userId: number, commitment?: string, reminderTime?: string): Promise<void> {
    const { challengeParticipants } = await import("@shared/schema");
    const existing = await db.select().from(challengeParticipants)
      .where(and(eq(challengeParticipants.challengeId, challengeId), eq(challengeParticipants.userId, userId)));
    if (existing.length > 0) {
      await db.update(challengeParticipants).set({
        status: "joined",
        ...(commitment !== undefined ? { commitment } : {}),
        ...(reminderTime !== undefined ? { reminderTime } : {}),
      }).where(and(eq(challengeParticipants.challengeId, challengeId), eq(challengeParticipants.userId, userId)));
    } else {
      await db.insert(challengeParticipants).values({
        challengeId, userId, status: "joined",
        commitment: commitment ?? null,
        reminderTime: reminderTime ?? null,
      });
    }
  }

  async declineChallenge(challengeId: number, userId: number): Promise<void> {
    const { challengeParticipants } = await import("@shared/schema");
    await db.update(challengeParticipants).set({ status: "declined" })
      .where(and(eq(challengeParticipants.challengeId, challengeId), eq(challengeParticipants.userId, userId)));
  }

  async leaveChallenge(challengeId: number, userId: number): Promise<void> {
    const { challengeParticipants } = await import("@shared/schema");
    await db.delete(challengeParticipants)
      .where(and(eq(challengeParticipants.challengeId, challengeId), eq(challengeParticipants.userId, userId)));
  }

  async deleteChallenge(challengeId: number, userId: number): Promise<void> {
    const { challenges } = await import("@shared/schema");
    await db.delete(challenges)
      .where(and(eq(challenges.id, challengeId), eq(challenges.creatorId, userId)));
  }

  async updateChallenge(
    challengeId: number,
    userId: number,
    data: { title?: string; endDate?: string }
  ): Promise<import("@shared/schema").Challenge | undefined> {
    const { challenges } = await import("@shared/schema");
    const ch = await this.getChallengeById(challengeId);
    if (!ch || ch.creatorId !== userId) return undefined;
    const updates: Partial<typeof challenges.$inferInsert> = {};
    if (data.title !== undefined) updates.title = data.title;
    if (data.endDate !== undefined) updates.endDate = data.endDate as unknown as Date;
    const [updated] = await db.update(challenges).set(updates)
      .where(eq(challenges.id, challengeId))
      .returning();
    return updated;
  }

  async updateChallengeParticipantReminder(challengeId: number, userId: number, reminderTime: string | null): Promise<void> {
    const { challengeParticipants } = await import("@shared/schema");
    await db.update(challengeParticipants)
      .set({ reminderTime })
      .where(and(eq(challengeParticipants.challengeId, challengeId), eq(challengeParticipants.userId, userId)));
  }

  async logChallengeEntry(challengeId: number, userId: number, date: string, value: number): Promise<void> {
    const { challengeLogs } = await import("@shared/schema");
    const existing = await db.select().from(challengeLogs)
      .where(and(
        eq(challengeLogs.challengeId, challengeId),
        eq(challengeLogs.userId, userId),
        sql`${challengeLogs.date}::text = ${date}`,
      ));
    if (existing.length > 0) {
      await db.update(challengeLogs).set({ value })
        .where(and(
          eq(challengeLogs.challengeId, challengeId),
          eq(challengeLogs.userId, userId),
          sql`${challengeLogs.date}::text = ${date}`,
        ));
    } else {
      await db.insert(challengeLogs).values({ challengeId, userId, date: date as unknown as Date, value });
    }
  }

  async getChallengeLeaderboard(challengeId: number, viewerId: number): Promise<import("@shared/schema").ChallengeLeaderboard> {
    const { challengeParticipants, challengeLogs } = await import("@shared/schema");
    const ch = await this.getChallengeById(challengeId);
    if (!ch) return { entries: [], scoresHidden: false, submittedToday: 0, totalParticipants: 0 };

    const participants = await db.select().from(challengeParticipants)
      .where(and(eq(challengeParticipants.challengeId, challengeId), eq(challengeParticipants.status, "joined")));
    const viewerRecord = await this.getUser(viewerId);
    const today = todayInTz(viewerRecord?.timezone);

    const raw: Array<{
      userId: number; username: string; displayName: string | null;
      isMe: boolean; score: number; daysLogged: number; loggedToday: boolean; commitment: string | null;
    }> = [];

    for (const p of participants) {
      const user = await this.getUser(p.userId);
      if (!user) continue;
      const logs = await db.select().from(challengeLogs)
        .where(and(eq(challengeLogs.challengeId, challengeId), eq(challengeLogs.userId, p.userId)));
      const daysLogged = new Set(logs.map(l => l.date)).size;
      const loggedToday = logs.some(l => l.date === today);
      const score = ch.type === "score" && logs.length > 0
        ? Math.round(logs.reduce((s, l) => s + l.value, 0) / logs.length)
        : daysLogged;
      raw.push({
        userId: p.userId,
        username: user.username,
        displayName: user.displayName ?? null,
        isMe: p.userId === viewerId,
        score,
        daysLogged,
        loggedToday,
        commitment: p.commitment ?? null,
      });
    }

    const submittedToday = raw.filter(e => e.loggedToday).length;
    const totalParticipants = raw.length;

    // For score challenges: hide scores until everyone has submitted today
    const scoresHidden = ch.type === "score" && submittedToday < totalParticipants;

    // Sort by visible score (desc), then daysLogged (desc)
    raw.sort((a, b) => b.score - a.score || b.daysLogged - a.daysLogged);

    let rank = 1;
    const entries: import("@shared/schema").ChallengeParticipantStats[] = raw.map((e, i) => {
      if (i > 0 && (raw[i].score !== raw[i - 1].score || raw[i].daysLogged !== raw[i - 1].daysLogged)) {
        rank = i + 1;
      }
      return {
        ...e,
        score: scoresHidden ? null : e.score,
        rank: scoresHidden ? 0 : rank,
      };
    });

    return { entries, scoresHidden, submittedToday, totalParticipants };
  }

  async inviteToChallenge(challengeId: number, inviteeUserId: number, inviterId: number): Promise<void> {
    const { challengeParticipants } = await import("@shared/schema");
    // Verify inviter is an active participant (joined) in this challenge
    const inviterPart = await db.select().from(challengeParticipants)
      .where(and(
        eq(challengeParticipants.challengeId, challengeId),
        eq(challengeParticipants.userId, inviterId),
        eq(challengeParticipants.status, "joined"),
      ));
    if (inviterPart.length === 0) throw new Error("Inviter is not a joined participant");

    const [existing] = await db.select().from(challengeParticipants)
      .where(and(eq(challengeParticipants.challengeId, challengeId), eq(challengeParticipants.userId, inviteeUserId)));

    if (!existing) {
      // First time — insert a fresh invite row
      await db.insert(challengeParticipants).values({ challengeId, userId: inviteeUserId, status: "invited" });
    } else if (existing.status === "declined") {
      // Previously declined — move back to invited so they can reconsider
      await db.update(challengeParticipants)
        .set({ status: "invited" })
        .where(and(eq(challengeParticipants.challengeId, challengeId), eq(challengeParticipants.userId, inviteeUserId)));
    }
    // If already "invited" or "joined", do nothing
  }

  async getUserPoints(userId: number): Promise<number> {
    return this._getUserPoints(userId);
  }

  async getGlobalWeeklyRank(userId: number): Promise<{ rank: number; total: number }> {
    // Single-pass CTE: compute weekly activity points (habits + goals + consistency)
    // for every user, then count how many are strictly above the requesting user.
    // Uses current_date so the 7-day window is stable within a day.
    const result = await db.execute(sql`
      WITH
        score_pts AS (
          SELECT user_id,
            LEAST(COUNT(DISTINCT date)::int, 7) * 10 AS pts
          FROM daily_scores
          WHERE date::text >= to_char(current_date - 6, 'YYYY-MM-DD')
            AND value > 0
            AND is_auto_synced = false
          GROUP BY user_id
        ),
        habit_day AS (
          SELECT hl.user_id, hl.date,
            COUNT(hl.habit_id) AS done,
            COALESCE((
              SELECT COUNT(*) FROM habits h
              WHERE h.user_id = hl.user_id AND NOT h.is_archived
            ), 0) AS total
          FROM habit_logs hl
          WHERE hl.date::text >= to_char(current_date - 6, 'YYYY-MM-DD')
          GROUP BY hl.user_id, hl.date
        ),
        habit_pts AS (
          SELECT user_id,
            SUM(done * 5 + CASE WHEN total > 0 AND done >= total THEN 20 ELSE 0 END)::int AS pts
          FROM habit_day
          GROUP BY user_id
        ),
        goal_day AS (
          SELECT user_id, date,
            COUNT(*) AS total,
            COUNT(*) FILTER (WHERE completed = true) AS done_count
          FROM daily_goals
          WHERE date::text >= to_char(current_date - 6, 'YYYY-MM-DD')
          GROUP BY user_id, date
        ),
        goal_pts AS (
          SELECT user_id,
            SUM(done_count * 5 + CASE WHEN total > 0 AND done_count >= total THEN 20 ELSE 0 END)::int AS pts
          FROM goal_day
          GROUP BY user_id
        ),
        user_weekly AS (
          SELECT u.id AS uid,
            COALESCE(sp.pts, 0) + COALESCE(hp.pts, 0) + COALESCE(gp.pts, 0) AS weekly_pts
          FROM users u
          LEFT JOIN score_pts sp ON u.id = sp.user_id
          LEFT JOIN habit_pts hp ON u.id = hp.user_id
          LEFT JOIN goal_pts gp ON u.id = gp.user_id
        )
      SELECT
        (SELECT COUNT(*) FROM user_weekly
         WHERE weekly_pts > (SELECT weekly_pts FROM user_weekly WHERE uid = ${userId})) + 1 AS rank,
        (SELECT COUNT(*) FROM user_weekly) AS total
    `);

    const row = (result as any).rows?.[0] ?? result[0];
    return {
      rank: Number(row?.rank ?? 1),
      total: Number(row?.total ?? 1),
    };
  }

  async getWeeklyActivityPoints(userId: number): Promise<number> {
    const sevenAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    let pts = 0;

    const allScores = await this.getDailyScoresByUser(userId);
    const scoreDays = new Set(
      allScores.filter(s => s.date >= sevenAgo && s.value > 0 && !s.isAutoSynced).map(s => s.date)
    );
    pts += Math.min(7, scoreDays.size) * 10;

    const activeHabits = await db.select({ id: habits.id }).from(habits)
      .where(and(eq(habits.userId, userId), eq(habits.isArchived, false)));
    const totalActiveHabits = activeHabits.length;
    const habitLogsRecent = await db.select({ date: habitLogs.date, habitId: habitLogs.habitId })
      .from(habitLogs)
      .where(and(eq(habitLogs.userId, userId), gte(habitLogs.date, sevenAgo)));
    const habitByDate = new Map<string, Set<number>>();
    for (const log of habitLogsRecent) {
      if (!habitByDate.has(log.date)) habitByDate.set(log.date, new Set());
      habitByDate.get(log.date)!.add(log.habitId);
    }
    for (const [, habitsDone] of habitByDate) {
      pts += habitsDone.size * 5;
      if (totalActiveHabits > 0 && habitsDone.size >= totalActiveHabits) pts += 20;
    }

    const allGoals = await db.select().from(dailyGoals)
      .where(and(eq(dailyGoals.userId, userId), gte(dailyGoals.date, sevenAgo)));
    const goalsByDate = new Map<string, { total: number; completed: number }>();
    for (const goal of allGoals) {
      const entry = goalsByDate.get(goal.date) ?? { total: 0, completed: 0 };
      goalsByDate.set(goal.date, {
        total: entry.total + 1,
        completed: entry.completed + (goal.completed ? 1 : 0),
      });
    }
    for (const [, { total, completed }] of goalsByDate) {
      pts += completed * 5;
      if (total > 0 && completed >= total) pts += 20;
    }

    return pts;
  }

  /**
   * Returns participants who: have a reminderTime set, are joined, challenge is active,
   * and have NOT logged for the given date. Used by the notification scheduler.
   */
  async getChallengesNeedingReminders(dateStr: string): Promise<Array<{
    userId: number;
    challengeId: number;
    challengeTitle: string;
    reminderTime: string;
    subscriptions: PushSubscription[];
    timezone: string | null;
    notificationsEnabled: boolean;
  }>> {
    const { challengeParticipants, challenges, challengeLogs } = await import("@shared/schema");

    const participants = await db
      .select({
        userId: challengeParticipants.userId,
        challengeId: challengeParticipants.challengeId,
        reminderTime: challengeParticipants.reminderTime,
        challengeTitle: challenges.title,
      })
      .from(challengeParticipants)
      .innerJoin(challenges, eq(challengeParticipants.challengeId, challenges.id))
      .where(
        and(
          eq(challengeParticipants.status, "joined"),
          sql`${challengeParticipants.reminderTime} IS NOT NULL`,
          sql`${challenges.startDate}::text <= ${dateStr}`,
          sql`${challenges.endDate}::text >= ${dateStr}`
        )
      );

    const results: Array<{
      userId: number;
      challengeId: number;
      challengeTitle: string;
      reminderTime: string;
      subscriptions: PushSubscription[];
      timezone: string | null;
      notificationsEnabled: boolean;
    }> = [];

    for (const p of participants) {
      if (!p.reminderTime) continue;

      const logs = await db.select().from(challengeLogs)
        .where(and(
          eq(challengeLogs.challengeId, p.challengeId),
          eq(challengeLogs.userId, p.userId),
          sql`${challengeLogs.date}::text = ${dateStr}`
        ));
      if (logs.length > 0) continue;

      const [user] = await db.select().from(users).where(eq(users.id, p.userId));
      if (!user || !user.notificationsEnabled) continue;

      const subs = await this.getPushSubscriptions(p.userId);
      if (subs.length === 0) continue;

      results.push({
        userId: p.userId,
        challengeId: p.challengeId,
        challengeTitle: p.challengeTitle,
        reminderTime: p.reminderTime,
        subscriptions: subs,
        timezone: user.timezone,
        notificationsEnabled: user.notificationsEnabled ?? true,
      });
    }

    return results;
  }
}

// ─── Timezone-aware "today" helper ──────────────────────────────────────────
// Returns YYYY-MM-DD in the given IANA timezone (e.g. "America/New_York").
// Falls back to UTC when the timezone is null/invalid.
export function todayInTz(tz: string | null | undefined): string {
  try {
    if (tz) {
      return new Intl.DateTimeFormat("en-CA", {
        timeZone: tz,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date());
    }
  } catch {}
  return new Date().toISOString().split("T")[0];
}

// ─── Corporate Tier storage methods (class body extension) ───────────────────
// Appended to DatabaseStorage prototype via declaration merging below.
declare module "./storage" {
  interface DatabaseStorage {
    getOrganisationById(id: number): Promise<Organisation | undefined>;
    getOrganisationByAdmin(adminUserId: number): Promise<Organisation | undefined>;
    createOrganisation(data: InsertOrganisation): Promise<Organisation>;
    updateOrganisation(id: number, updates: Partial<InsertOrganisation>): Promise<Organisation | undefined>;
    getOrgMembershipByUser(userId: number): Promise<(OrgMember & { organisation: Organisation }) | undefined>;
    getOrgMembersByOrg(orgId: number): Promise<OrgMember[]>;
    createOrgMember(data: InsertOrgMember): Promise<OrgMember>;
    updateOrgMember(id: number, updates: OrgMemberUpdate): Promise<OrgMember | undefined>;
    getOrgMemberByToken(token: string): Promise<OrgMember | undefined>;
    getOrgMemberByEmail(orgId: number, email: string): Promise<OrgMember | undefined>;
    getOrgTeamStats(orgId: number): Promise<{ avgStreak: number; avgConsistency: number; activeCount: number; pendingCount: number }>;
    addOrgChallenge(orgId: number, challengeId: number): Promise<void>;
    getOrgChallengeIds(orgId: number): Promise<number[]>;
  }
}

DatabaseStorage.prototype.getOrganisationById = async function (id: number): Promise<Organisation | undefined> {
  const [org] = await db.select().from(organisations).where(eq(organisations.id, id));
  return org;
};

DatabaseStorage.prototype.getOrganisationByAdmin = async function (adminUserId: number): Promise<Organisation | undefined> {
  const [org] = await db.select().from(organisations).where(eq(organisations.adminUserId, adminUserId));
  return org;
};

DatabaseStorage.prototype.createOrganisation = async function (data: InsertOrganisation): Promise<Organisation> {
  const [org] = await db.insert(organisations).values(data).returning();
  return org;
};

DatabaseStorage.prototype.updateOrganisation = async function (id: number, updates: Partial<InsertOrganisation>): Promise<Organisation | undefined> {
  const [org] = await db.update(organisations).set(updates).where(eq(organisations.id, id)).returning();
  return org;
};

DatabaseStorage.prototype.getOrgMembershipByUser = async function (userId: number): Promise<(OrgMember & { organisation: Organisation }) | undefined> {
  const rows = await db
    .select({ member: orgMembers, org: organisations })
    .from(orgMembers)
    .innerJoin(organisations, eq(orgMembers.orgId, organisations.id))
    .where(and(eq(orgMembers.userId, userId), eq(orgMembers.status, "active")));
  if (!rows.length) return undefined;
  return { ...rows[0].member, organisation: rows[0].org };
};

DatabaseStorage.prototype.getOrgMembersByOrg = async function (orgId: number): Promise<OrgMember[]> {
  return db.select().from(orgMembers).where(eq(orgMembers.orgId, orgId)).orderBy(desc(orgMembers.createdAt));
};

DatabaseStorage.prototype.createOrgMember = async function (data: InsertOrgMember): Promise<OrgMember> {
  const [member] = await db.insert(orgMembers).values(data).returning();
  return member;
};

DatabaseStorage.prototype.updateOrgMember = async function (id: number, updates: OrgMemberUpdate): Promise<OrgMember | undefined> {
  const updatePayload: Record<string, unknown> = {};
  if ("userId" in updates) updatePayload["user_id"] = updates.userId;
  if ("status" in updates) updatePayload["status"] = updates.status;
  if ("inviteToken" in updates) updatePayload["invite_token"] = updates.inviteToken;
  if ("role" in updates) updatePayload["role"] = updates.role;
  if ("joinedAt" in updates) updatePayload["joined_at"] = updates.joinedAt;
  const [member] = await db.update(orgMembers).set(updatePayload as typeof orgMembers.$inferInsert).where(eq(orgMembers.id, id)).returning();
  return member;
};

DatabaseStorage.prototype.getOrgMemberByToken = async function (token: string): Promise<OrgMember | undefined> {
  const [member] = await db.select().from(orgMembers).where(eq(orgMembers.inviteToken, token));
  return member;
};

DatabaseStorage.prototype.getOrgMemberByEmail = async function (orgId: number, email: string): Promise<OrgMember | undefined> {
  const [member] = await db.select().from(orgMembers)
    .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.email, email.toLowerCase())));
  return member;
};

DatabaseStorage.prototype.getOrgTeamStats = async function (this: DatabaseStorage, orgId: number): Promise<{ avgStreak: number; avgConsistency: number; activeCount: number; pendingCount: number }> {
  const members = await db.select().from(orgMembers).where(eq(orgMembers.orgId, orgId));
  const activeMembers = members.filter(m => m.status === "active" && m.userId !== null);
  const pendingCount = members.filter(m => m.status === "pending").length;
  if (activeMembers.length === 0) return { avgStreak: 0, avgConsistency: 0, activeCount: 0, pendingCount };

  let totalStreak = 0;
  let totalConsistency = 0;
  for (const member of activeMembers) {
    if (!member.userId) continue;
    const [streak] = await db.select().from(streaks).where(eq(streaks.userId, member.userId));
    totalStreak += streak?.currentStreak ?? 0;
    const activeDays = await this.getRecentActiveDays(member.userId);
    totalConsistency += Math.round((activeDays / 7) * 100);
  }
  return {
    avgStreak: Math.round(totalStreak / activeMembers.length),
    avgConsistency: Math.round(totalConsistency / activeMembers.length),
    activeCount: activeMembers.length,
    pendingCount,
  };
};

DatabaseStorage.prototype.addOrgChallenge = async function (orgId: number, challengeId: number): Promise<void> {
  await db.insert(orgChallenges).values({ orgId, challengeId }).onConflictDoNothing();
};

DatabaseStorage.prototype.getOrgChallengeIds = async function (orgId: number): Promise<number[]> {
  const rows = await db.select().from(orgChallenges).where(eq(orgChallenges.orgId, orgId));
  return rows.map(r => r.challengeId);
};

// ─── Streak computation helper ──────────────────────────────────────────────
function computeHabitStreak(sortedDatesDesc: string[]): { currentStreak: number; longestStreak: number; lastDate: string | null } {
  if (sortedDatesDesc.length === 0) return { currentStreak: 0, longestStreak: 0, lastDate: null };
  
  const sorted = [...sortedDatesDesc].sort((a, b) => b.localeCompare(a));
  // Use the most recent log date as the reference: if the latest log IS today or yesterday
  // (in UTC) we treat the streak as active.  We deliberately keep UTC here because
  // habit logs are always written with the date the client sends; using UTC avoids
  // a double-correction if the calling route already applied a tz offset.
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