import OpenAI from "openai";
import { storage } from "./storage";
import { encrypt, decrypt } from "./encryption";
import type { WeeklyReport, PerformancePattern, InsertPerformancePattern } from "@shared/schema";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

// ─── Date helpers ────────────────────────────────────────────────────────────

export function getWeekBounds(date: Date = new Date()): { weekStart: string; weekEnd: string } {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun, 1=Mon, …, 6=Sat

  // Always report on the most recently COMPLETED Mon–Sun week.
  //   Sunday (day=0) → the week ending today is complete → use current week
  //   Any other day  → the week ending last Sunday is the most recent complete week
  const diffToLastSunday = day === 0 ? 0 : -day;
  const lastSunday = new Date(d);
  lastSunday.setDate(d.getDate() + diffToLastSunday);

  const monday = new Date(lastSunday);
  monday.setDate(lastSunday.getDate() - 6);

  const fmt = (dt: Date) => dt.toISOString().split("T")[0];
  return { weekStart: fmt(monday), weekEnd: fmt(lastSunday) };
}

function dateRange(startStr: string, endStr: string): string[] {
  const dates: string[] = [];
  const cur = new Date(startStr + "T12:00:00");
  const end = new Date(endStr + "T12:00:00");
  while (cur <= end) {
    dates.push(cur.toISOString().split("T")[0]);
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

function dayLabel(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

// ─── Weekly Race Report generator ───────────────────────────────────────────

export async function generateWeeklyReport(userId: number): Promise<WeeklyReport | null> {
  const { weekStart, weekEnd } = getWeekBounds();

  // Don't regenerate if one already exists for this week
  const existing = await storage.getWeeklyReportByWeek(userId, weekStart);
  if (existing) return existing;

  const dates = dateRange(weekStart, weekEnd);
  const todayStr = new Date().toISOString().split("T")[0];

  // Collect data for the week
  const [allScores, allGoals, allHabits] = await Promise.all([
    storage.getDailyScoresByUser(userId),
    storage.getGoalsForDateRange(userId, weekStart, weekEnd),
    storage.getHabitWithTodayStatus(userId, todayStr),
  ]);

  const weekScores = allScores.filter(s => s.date >= weekStart && s.date <= weekEnd && s.value > 0);

  // Check minimum data — at least 2 days of scores or goals to write a meaningful report
  const daysWithData = new Set([...weekScores.map(s => s.date), ...allGoals.map(g => g.date)]).size;
  if (daysWithData < 2) return null;

  // Build score table by day
  const scoresByDay: Record<string, Record<string, number>> = {};
  weekScores.forEach(s => {
    if (!scoresByDay[s.date]) scoresByDay[s.date] = {};
    scoresByDay[s.date][s.metricName] = s.value;
  });

  const scoreSummary = dates
    .filter(d => scoresByDay[d])
    .map(d => `${dayLabel(d)}: ${Object.entries(scoresByDay[d]).map(([k, v]) => `${k}=${v}`).join(", ")}`)
    .join("\n") || "No scores logged this week.";

  // Goals summary
  const goalsByDay: Record<string, { total: number; done: number }> = {};
  allGoals.forEach(g => {
    if (!goalsByDay[g.date]) goalsByDay[g.date] = { total: 0, done: 0 };
    goalsByDay[g.date].total++;
    if (g.completed) goalsByDay[g.date].done++;
  });
  const totalGoals = allGoals.length;
  const doneGoals = allGoals.filter(g => g.completed).length;
  const goalsSummary = totalGoals > 0
    ? `${doneGoals}/${totalGoals} goals completed across the week`
    : "No goals tracked this week.";

  // Habit summary
  const habitSummary = allHabits.length > 0
    ? allHabits.map(h => `${h.name}: ${h.last7Days?.filter(Boolean).length ?? 0}/7 days`).join(", ")
    : "No habits tracked.";

  const prompt = `You are a world-class race engineer reviewing a driver's telemetry from the past 7 days. Your job is to give them a sharp, honest debrief — not therapy, not cheerleading. You see the data; you tell them what it means and what to focus on next.

WEEK: ${weekStart} to ${weekEnd}

PERFORMANCE SCORES (0-100 scale):
${scoreSummary}

DAILY GOALS: ${goalsSummary}

HABITS: ${habitSummary}

Write the weekly race report in 150-200 words. Structure it like a real engineer's debrief:
- Open with one honest headline about the week (best or worst or defining characteristic)
- Call out the strongest session and what drove it
- Call out the weakest point and what the data suggests
- One specific, concrete focus for the coming week based on the patterns

Write in second person ("your", "you"). Be direct and specific — use the actual numbers. F1 engineering tone: precise, constructive, no filler words. Do not use bullet points. Write in flowing paragraphs.`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [{ role: "user", content: prompt }],
    max_tokens: 400,
    temperature: 0.7,
  });

  const content = completion.choices[0]?.message?.content?.trim();
  if (!content) return null;

  const report = await storage.createWeeklyReport({
    userId,
    weekStart,
    weekEnd,
    content: encrypt(content),
    notificationSent: false,
  });

  return report;
}

// ─── Performance Patterns generator ─────────────────────────────────────────

export async function generatePerformancePatterns(userId: number): Promise<PerformancePattern[]> {
  // Use up to 90 days of data — the more history, the more reliable the patterns.
  // The feature unlocks at just 5 distinct logging days (early read); it gets sharper over time.
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  const todayStr = new Date().toISOString().split("T")[0];

  const [allScores, allGoals, allHabits, moodCheckins] = await Promise.all([
    storage.getDailyScoresByUser(userId),
    storage.getGoalsForDateRange(userId, ninetyDaysAgo, todayStr),
    storage.getHabitWithTodayStatus(userId, todayStr),
    storage.getMoodCheckinsForDateRange(userId, ninetyDaysAgo, todayStr),
  ]);

  const recentScores = allScores.filter(s => s.date >= ninetyDaysAgo && s.value > 0);
  const distinctDays = new Set(recentScores.map(s => s.date)).size;

  // Minimum 5 distinct logging days for an early read
  if (distinctDays < 5) return [];

  // Confidence tier based on how many days of data we have
  const confidenceTier: "early" | "building" | "full" =
    distinctDays < 14 ? "early" :
    distinctDays < 30 ? "building" : "full";

  // Build per-day metric map
  const metricsByDay: Record<string, Record<string, number>> = {};
  recentScores.forEach(s => {
    if (!metricsByDay[s.date]) metricsByDay[s.date] = {};
    metricsByDay[s.date][s.metricName] = s.value;
  });

  // Goal completion rate by day
  const goalRateByDay: Record<string, number> = {};
  const goalsByDay: Record<string, { total: number; done: number }> = {};
  allGoals.forEach(g => {
    if (!goalsByDay[g.date]) goalsByDay[g.date] = { total: 0, done: 0 };
    goalsByDay[g.date].total++;
    if (g.completed) goalsByDay[g.date].done++;
  });
  Object.entries(goalsByDay).forEach(([date, { total, done }]) => {
    goalRateByDay[date] = Math.round((done / total) * 100);
  });

  // Mood averages by day
  const moodByDay: Record<string, number> = {};
  const moodGroups: Record<string, number[]> = {};
  moodCheckins.forEach(m => {
    if (!moodGroups[m.date]) moodGroups[m.date] = [];
    moodGroups[m.date].push(m.value);
  });
  Object.entries(moodGroups).forEach(([date, vals]) => {
    moodByDay[date] = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
  });

  // Habit completion by day
  const habitCompByDay: Record<string, number> = {};
  allHabits.forEach(h => {
    h.last7Days?.forEach((done, i) => {
      const d = new Date(Date.now() - (6 - i) * 86400000).toISOString().split("T")[0];
      if (!habitCompByDay[d]) habitCompByDay[d] = 0;
      if (done) habitCompByDay[d]++;
    });
  });

  const metricNames = [...new Set(recentScores.map(s => s.metricName))];
  const allDates = [...new Set(recentScores.map(s => s.date))].sort();

  // Compute metric means per metric
  const metricMeans: Record<string, number> = {};
  metricNames.forEach(m => {
    const vals = recentScores.filter(s => s.metricName === m).map(s => s.value);
    metricMeans[m] = vals.reduce((a, b) => a + b, 0) / vals.length;
  });

  // Build summary for the AI to analyze
  const scoreSummaryLines = allDates.map(d => {
    const scores = metricsByDay[d] ? Object.entries(metricsByDay[d]).map(([k, v]) => `${k}=${v}`).join(",") : "";
    const goals = goalRateByDay[d] !== undefined ? `goals=${goalRateByDay[d]}%` : "";
    const mood = moodByDay[d] !== undefined ? `mood=${moodByDay[d]}` : "";
    const habits = habitCompByDay[d] !== undefined ? `habits_done=${habitCompByDay[d]}` : "";
    return [d, scores, goals, mood, habits].filter(Boolean).join(" | ");
  }).join("\n");

  const meansLine = Object.entries(metricMeans)
    .map(([k, v]) => `${k}: avg=${Math.round(v)}`)
    .join(", ");

  const tierNote = confidenceTier === "early"
    ? `DATA NOTE: Only ${distinctDays} days of data so far. Surface the most notable patterns you can see even with limited data — clearly stating what you observed. Use "medium" confidence for all patterns at this stage.`
    : confidenceTier === "building"
    ? `DATA NOTE: ${distinctDays} days of data. Good enough for reliable patterns — prefer high confidence where data clearly supports it.`
    : `DATA NOTE: ${distinctDays} days of data. Full analysis — surface the strongest 3 patterns with real statistical grounding.`;

  const prompt = `You are a performance data analyst. You have ${distinctDays} days of logged score data (0–100 scale) for a driver. Your job: find genuine correlations directly in the daily score numbers. This is Data Pattern Analysis — focus on the raw scores.

${tierNote}

DAILY DATA (${allDates.length} days with logged scores):
${scoreSummaryLines}

METRIC AVERAGES: ${meansLine}

TASK: Identify up to ${confidenceTier === "early" ? "2" : "3"} genuine, specific score-to-score observations in this data. Lead with the numbers. Good examples:
- "On days when Sleep Duration ≥ 70, Energy averages 18 points higher than on low-sleep days"
- "HRV and Resting Heart Rate move inversely: on your 8 highest HRV days, resting HR averaged 58 vs 67 on low-HRV days"
- "Energy scores have trended from an average of 54 in your first week to 71 this week — a 17-point upward trend"
- "Goal completion is 43% higher on days where mood score is above 65"

Rules:
- Every observation must cite actual numbers from the data above — no vague claims
- Score-to-score relationships are the priority; goal completion and mood can appear if they show a clear score connection
- Only report patterns with at least 3 supporting data points (early stage) or 5 (building/full)
- Always return at least 1 observation — even if it's just a trend over time or a comparison of averages between two metrics
- If no correlations exist, fall back to reporting the metric with the highest or most consistent scores, citing actual averages
- Do NOT invent patterns — cite real numbers from the data

Respond with valid JSON array only (no markdown, no explanation outside the JSON):
[
  {
    "insight": "One specific sentence describing the observation with real numbers from the data",
    "metric1": "primary score metric name",
    "metric2": "secondary score metric name, or 'goals', or null",
    "correlation": "the key stat e.g. '+18 pts avg' or '43% higher' or 'up 17 pts'",
    "confidence": "high or medium"
  }
]`;

  let patterns: InsertPerformancePattern[] = [];
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 800,
      temperature: 0.3,
    });

    const raw = completion.choices[0]?.message?.content?.trim() || "[]";
    // Strip markdown code fences if the model wrapped the JSON
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();

    let arr: any[] = [];
    try {
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed)) {
        arr = parsed;
      } else if (typeof parsed === "object" && parsed !== null) {
        // Model may have wrapped it in an object — find the first array value
        const found = Object.values(parsed).find(v => Array.isArray(v));
        arr = (found as any[]) ?? [];
      }
    } catch {
      // JSON parse failed — try extracting a JSON array with a regex
      const match = cleaned.match(/\[[\s\S]*\]/);
      if (match) {
        try { arr = JSON.parse(match[0]); } catch {}
      }
    }

    console.log("[Patterns] Raw response length:", cleaned.length, "| Parsed array length:", arr.length);

    patterns = arr.slice(0, 3).map((p: any) => ({
      userId,
      insight: String(p.insight || "").slice(0, 500),
      metric1: p.metric1 && p.metric1 !== "null" ? String(p.metric1).slice(0, 100) : null,
      metric2: p.metric2 && p.metric2 !== "null" ? String(p.metric2).slice(0, 100) : null,
      correlation: p.correlation ? String(p.correlation).slice(0, 200) : null,
      confidence: p.confidence === "high" ? "high" : "medium",
      isActive: true,
    }));
  } catch (err) {
    console.error("[Patterns] AI error:", err);
    return [];
  }

  return storage.replacePerformancePatterns(userId, patterns);
}
