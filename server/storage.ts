import { 
  users, journalEntries, dailyScores, userMetrics, streaks, aiInsights,
  type User, type InsertUser, type JournalEntry, type InsertJournalEntry,
  type DailyScore, type InsertDailyScore, type UserMetric, type InsertUserMetric,
  type Streak, type InsertStreak, type AIInsight, type InsertAIInsight
} from "@shared/schema";

export interface IStorage {
  // User methods
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;

  // Journal entry methods
  getJournalEntry(id: number): Promise<JournalEntry | undefined>;
  getJournalEntriesByUser(userId: number): Promise<JournalEntry[]>;
  getJournalEntryByDate(userId: number, date: string): Promise<JournalEntry | undefined>;
  createJournalEntry(entry: InsertJournalEntry): Promise<JournalEntry>;
  updateJournalEntry(id: number, entry: Partial<InsertJournalEntry>): Promise<JournalEntry | undefined>;

  // Daily scores methods
  getDailyScoresByUserAndDate(userId: number, date: string): Promise<DailyScore[]>;
  getDailyScoresByUser(userId: number): Promise<DailyScore[]>;
  createDailyScore(score: InsertDailyScore): Promise<DailyScore>;
  updateDailyScore(userId: number, date: string, metricName: string, value: number): Promise<DailyScore | undefined>;

  // User metrics methods
  getUserMetrics(userId: number): Promise<UserMetric[]>;
  createUserMetric(metric: InsertUserMetric): Promise<UserMetric>;
  updateUserMetric(id: number, metric: Partial<InsertUserMetric>): Promise<UserMetric | undefined>;

  // Streak methods
  getUserStreak(userId: number): Promise<Streak | undefined>;
  createStreak(streak: InsertStreak): Promise<Streak>;
  updateStreak(userId: number, streak: Partial<InsertStreak>): Promise<Streak | undefined>;

  // AI insights methods
  getActiveAIInsights(userId: number): Promise<AIInsight[]>;
  createAIInsight(insight: InsertAIInsight): Promise<AIInsight>;
  deactivateAIInsight(id: number): Promise<void>;
}

export class MemStorage implements IStorage {
  private users: Map<number, User> = new Map();
  private journalEntries: Map<number, JournalEntry> = new Map();
  private dailyScores: Map<number, DailyScore> = new Map();
  private userMetrics: Map<number, UserMetric> = new Map();
  private streaks: Map<number, Streak> = new Map();
  private aiInsights: Map<number, AIInsight> = new Map();
  
  private currentUserId = 1;
  private currentJournalEntryId = 1;
  private currentDailyScoreId = 1;
  private currentUserMetricId = 1;
  private currentStreakId = 1;
  private currentAIInsightId = 1;

  constructor() {
    this.initializeDefaultData();
  }

  private initializeDefaultData() {
    // Create default user
    const defaultUser: User = {
      id: 1,
      username: "demo",
      password: "demo",
    };
    this.users.set(1, defaultUser);

    // Create default metrics
    const defaultMetrics: UserMetric[] = [
      { id: 1, userId: 1, name: "Happiness", color: "#10B981", isDefault: true, isActive: true },
      { id: 2, userId: 1, name: "Productivity", color: "#4F46E5", isDefault: true, isActive: true },
      { id: 3, userId: 1, name: "Energy", color: "#F59E0B", isDefault: true, isActive: true },
      { id: 4, userId: 1, name: "Sleep", color: "#8B5CF6", isDefault: false, isActive: true },
      { id: 5, userId: 1, name: "Recovery", color: "#EF4444", isDefault: false, isActive: true },
      { id: 6, userId: 1, name: "Steps", color: "#22C55E", isDefault: false, isActive: true },
    ];

    defaultMetrics.forEach(metric => {
      this.userMetrics.set(metric.id, metric);
    });

    this.currentUserMetricId = 7;

    // Create sample journal entries
    const today = new Date();
    const sampleEntries: JournalEntry[] = [
      {
        id: 1,
        userId: 1,
        date: today.toISOString().split('T')[0],
        content: "Had a great day today! Started with morning exercise and felt energized throughout. Work was productive - finished the quarterly report and had a good team meeting. Evening walk in the park was refreshing.",
        isVoiceEntry: false,
        createdAt: today,
      },
      {
        id: 2,
        userId: 1,
        date: new Date(today.getTime() - 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        content: "Feeling a bit overwhelmed with work deadlines. Had trouble sleeping last night. Need to focus on time management and stress reduction. Did some meditation which helped a bit.",
        isVoiceEntry: false,
        createdAt: new Date(today.getTime() - 24 * 60 * 60 * 1000),
      },
      {
        id: 3,
        userId: 1,
        date: new Date(today.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        content: "Beautiful weekend! Spent time with family and friends. Went hiking and enjoyed nature. Feeling grateful for the people in my life. This is the kind of balance I want to maintain.",
        isVoiceEntry: true,
        createdAt: new Date(today.getTime() - 2 * 24 * 60 * 60 * 1000),
      },
    ];

    sampleEntries.forEach(entry => {
      this.journalEntries.set(entry.id, entry);
    });
    this.currentJournalEntryId = 4;

    // Create sample daily scores
    const sampleScores: DailyScore[] = [
      // Today's scores
      { id: 1, userId: 1, date: today.toISOString().split('T')[0], metricName: "Happiness", value: 85, isAutoSynced: false },
      { id: 2, userId: 1, date: today.toISOString().split('T')[0], metricName: "Productivity", value: 78, isAutoSynced: false },
      { id: 3, userId: 1, date: today.toISOString().split('T')[0], metricName: "Energy", value: 82, isAutoSynced: false },
      { id: 4, userId: 1, date: today.toISOString().split('T')[0], metricName: "Sleep", value: 75, isAutoSynced: true },
      
      // Yesterday's scores
      { id: 5, userId: 1, date: new Date(today.getTime() - 24 * 60 * 60 * 1000).toISOString().split('T')[0], metricName: "Happiness", value: 65, isAutoSynced: false },
      { id: 6, userId: 1, date: new Date(today.getTime() - 24 * 60 * 60 * 1000).toISOString().split('T')[0], metricName: "Productivity", value: 55, isAutoSynced: false },
      { id: 7, userId: 1, date: new Date(today.getTime() - 24 * 60 * 60 * 1000).toISOString().split('T')[0], metricName: "Energy", value: 60, isAutoSynced: false },
      { id: 8, userId: 1, date: new Date(today.getTime() - 24 * 60 * 60 * 1000).toISOString().split('T')[0], metricName: "Sleep", value: 45, isAutoSynced: true },
      
      // Day before yesterday's scores
      { id: 9, userId: 1, date: new Date(today.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], metricName: "Happiness", value: 90, isAutoSynced: false },
      { id: 10, userId: 1, date: new Date(today.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], metricName: "Productivity", value: 70, isAutoSynced: false },
      { id: 11, userId: 1, date: new Date(today.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], metricName: "Energy", value: 88, isAutoSynced: false },
      { id: 12, userId: 1, date: new Date(today.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], metricName: "Sleep", value: 80, isAutoSynced: true },
    ];

    sampleScores.forEach(score => {
      this.dailyScores.set(score.id, score);
    });
    this.currentDailyScoreId = 13;

    // Create default streak
    const defaultStreak: Streak = {
      id: 1,
      userId: 1,
      currentStreak: 7,
      longestStreak: 12,
      lastEntryDate: new Date().toISOString().split('T')[0],
    };
    this.streaks.set(1, defaultStreak);
  }

  async getUser(id: number): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(user => user.username === username);
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = this.currentUserId++;
    const user: User = { ...insertUser, id };
    this.users.set(id, user);
    return user;
  }

  async getJournalEntry(id: number): Promise<JournalEntry | undefined> {
    return this.journalEntries.get(id);
  }

  async getJournalEntriesByUser(userId: number): Promise<JournalEntry[]> {
    return Array.from(this.journalEntries.values())
      .filter(entry => entry.userId === userId)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }

  async getJournalEntryByDate(userId: number, date: string): Promise<JournalEntry | undefined> {
    return Array.from(this.journalEntries.values())
      .find(entry => entry.userId === userId && entry.date === date);
  }

  async createJournalEntry(insertEntry: InsertJournalEntry): Promise<JournalEntry> {
    const id = this.currentJournalEntryId++;
    const entry: JournalEntry = {
      ...insertEntry,
      id,
      createdAt: new Date(),
    };
    this.journalEntries.set(id, entry);
    return entry;
  }

  async updateJournalEntry(id: number, updates: Partial<InsertJournalEntry>): Promise<JournalEntry | undefined> {
    const entry = this.journalEntries.get(id);
    if (!entry) return undefined;

    const updatedEntry = { ...entry, ...updates };
    this.journalEntries.set(id, updatedEntry);
    return updatedEntry;
  }

  async getDailyScoresByUserAndDate(userId: number, date: string): Promise<DailyScore[]> {
    return Array.from(this.dailyScores.values())
      .filter(score => score.userId === userId && score.date === date);
  }

  async getDailyScoresByUser(userId: number): Promise<DailyScore[]> {
    return Array.from(this.dailyScores.values())
      .filter(score => score.userId === userId);
  }

  async createDailyScore(insertScore: InsertDailyScore): Promise<DailyScore> {
    const id = this.currentDailyScoreId++;
    const score: DailyScore = { ...insertScore, id };
    this.dailyScores.set(id, score);
    return score;
  }

  async updateDailyScore(userId: number, date: string, metricName: string, value: number): Promise<DailyScore | undefined> {
    const existingScore = Array.from(this.dailyScores.values())
      .find(score => score.userId === userId && score.date === date && score.metricName === metricName);

    if (existingScore) {
      existingScore.value = value;
      this.dailyScores.set(existingScore.id, existingScore);
      return existingScore;
    }

    return this.createDailyScore({ userId, date, metricName, value, isAutoSynced: false });
  }

  async getUserMetrics(userId: number): Promise<UserMetric[]> {
    return Array.from(this.userMetrics.values())
      .filter(metric => metric.userId === userId && metric.isActive);
  }

  async createUserMetric(insertMetric: InsertUserMetric): Promise<UserMetric> {
    const id = this.currentUserMetricId++;
    const metric: UserMetric = { ...insertMetric, id };
    this.userMetrics.set(id, metric);
    return metric;
  }

  async updateUserMetric(id: number, updates: Partial<InsertUserMetric>): Promise<UserMetric | undefined> {
    const metric = this.userMetrics.get(id);
    if (!metric) return undefined;

    const updatedMetric = { ...metric, ...updates };
    this.userMetrics.set(id, updatedMetric);
    return updatedMetric;
  }

  async getUserStreak(userId: number): Promise<Streak | undefined> {
    return Array.from(this.streaks.values()).find(streak => streak.userId === userId);
  }

  async createStreak(insertStreak: InsertStreak): Promise<Streak> {
    const id = this.currentStreakId++;
    const streak: Streak = { ...insertStreak, id };
    this.streaks.set(id, streak);
    return streak;
  }

  async updateStreak(userId: number, updates: Partial<InsertStreak>): Promise<Streak | undefined> {
    const streak = Array.from(this.streaks.values()).find(s => s.userId === userId);
    if (!streak) return undefined;

    const updatedStreak = { ...streak, ...updates };
    this.streaks.set(streak.id, updatedStreak);
    return updatedStreak;
  }

  async getActiveAIInsights(userId: number): Promise<AIInsight[]> {
    return Array.from(this.aiInsights.values())
      .filter(insight => insight.userId === userId && insight.isActive)
      .sort((a, b) => new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime());
  }

  async createAIInsight(insertInsight: InsertAIInsight): Promise<AIInsight> {
    const id = this.currentAIInsightId++;
    const insight: AIInsight = {
      ...insertInsight,
      id,
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
}

export const storage = new MemStorage();
