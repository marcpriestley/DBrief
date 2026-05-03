import type { Express, Request, Response } from "express";
import OpenAI from "openai";
import { aiLimiter } from "./rate-limit";
import { db } from "./db";
import { debriefs, debriefMessages, dailyScores, journalEntries, moodCheckins, dailyGoals, userMetrics, users, infiniteGoals, longTermGoals, goalTemplates, habits, habitLogs, challenges, challengeParticipants } from "@shared/schema";
import { eq, and, desc, gte, lt } from "drizzle-orm";
import { encrypt, decrypt } from "./encryption";
import { updateUserStreak } from "./streakHelper";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

function getUserId(req: Request): number {
  return (req.session as any)?.userId;
}

function requireAuth(req: Request, res: Response): number | null {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Not authenticated" });
    return null;
  }
  return userId;
}

export async function gatherDayContext(userId: number, date: string) {
  // 30-day window ending the day before the debrief date (for averages / history)
  const windowStart = new Date(date + "T12:00:00");
  windowStart.setDate(windowStart.getDate() - 30);
  const windowStartStr = windowStart.toISOString().split("T")[0];

  const [
    scores, metrics, goals, moods, entries,
    infiniteGoalRows, ltGoals, userHabits, todayHabitLogs,
    historicalScores, recentDebriefs, activeParticipations,
  ] = await Promise.all([
    db.select().from(dailyScores).where(and(eq(dailyScores.userId, userId), eq(dailyScores.date, date))),
    db.select().from(userMetrics).where(and(eq(userMetrics.userId, userId), eq(userMetrics.isActive, true))),
    db.select().from(dailyGoals).where(and(eq(dailyGoals.userId, userId), eq(dailyGoals.date, date))),
    db.select().from(moodCheckins).where(and(eq(moodCheckins.userId, userId), eq(moodCheckins.date, date))),
    db.select().from(journalEntries).where(and(eq(journalEntries.userId, userId), eq(journalEntries.date, date))),
    db.select().from(infiniteGoals).where(eq(infiniteGoals.userId, userId)).limit(1),
    db.select().from(longTermGoals).where(and(eq(longTermGoals.userId, userId), eq(longTermGoals.isActive, true))),
    db.select().from(habits).where(and(eq(habits.userId, userId), eq(habits.isArchived, false))),
    db.select().from(habitLogs).where(and(eq(habitLogs.userId, userId), eq(habitLogs.date, date))),
    // 30-day historical scores (excluding today) for per-metric averages
    db.select().from(dailyScores).where(and(
      eq(dailyScores.userId, userId),
      gte(dailyScores.date, windowStartStr),
      lt(dailyScores.date, date),
    )),
    // Last 4 completed debriefs before today (for continuity context)
    db.select().from(debriefs).where(and(
      eq(debriefs.userId, userId),
      eq(debriefs.isComplete, true),
      lt(debriefs.date, date),
    )).orderBy(desc(debriefs.date)).limit(4),
    // Active challenges the user is participating in
    db.select({ challenge: challenges, participation: challengeParticipants })
      .from(challengeParticipants)
      .innerJoin(challenges, eq(challenges.id, challengeParticipants.challengeId))
      .where(and(
        eq(challengeParticipants.userId, userId),
        eq(challengeParticipants.status, "joined"),
        gte(challenges.endDate, date),
      )),
  ]);

  // Exclude zero scores — a value of 0 almost always means the user didn't log that
  // metric, not that they deliberately scored it as a zero. Treat missing data as absent.
  const loggedScores = scores.filter(s => s.value > 0);

  // Metric unit lookup — metrics that are NOT on a 0-100 score scale
  const METRIC_UNITS: Record<string, string> = {
    "Sleep Duration":   "hrs",
    "Steps":            "steps",
    "Active Energy":    "kcal",
    "Exercise Minutes": "min",
    "Flights Climbed":  "flights",
    "Walking Distance": "km",
    "Heart Rate":       "bpm",
    "Resting Heart Rate": "bpm",
    "HRV":              "ms",
    "Body Weight":      "kg",
    "Body Fat %":       "%",
    "Mindful Minutes":  "min",
    "Respiratory Rate": "brpm",
    "VO2 Max":          "ml/kg/min",
    "Sleep Score":      "/100",
  };

  // Build a map of metricName → maxValue from the user's configured metrics
  const metricMaxValues = new Map(metrics.map(m => [m.name, m.maxValue ?? 100]));

  // Compute 30-day average per metric from historical data
  const metricTotals: Record<string, { sum: number; count: number }> = {};
  for (const s of historicalScores) {
    if (s.value > 0) {
      if (!metricTotals[s.metricName]) metricTotals[s.metricName] = { sum: 0, count: 0 };
      metricTotals[s.metricName].sum += s.value;
      metricTotals[s.metricName].count += 1;
    }
  }
  const metricAverages: Record<string, number> = {};
  for (const [name, { sum, count }] of Object.entries(metricTotals)) {
    metricAverages[name] = Math.round(sum / count);
  }

  const scoreMap = loggedScores.length > 0
    ? loggedScores.map(s => {
        const maxVal = metricMaxValues.get(s.metricName) ?? 100;
        const unit = METRIC_UNITS[s.metricName];
        const avg = metricAverages[s.metricName];
        const avgNote = avg !== undefined ? ` (30-day avg: ${avg}${unit && maxVal !== 100 ? ` ${unit}` : ""})` : "";
        if (unit && maxVal !== 100) {
          return `${s.metricName}: ${s.value} ${unit}${avgNote}`;
        }
        return `${s.metricName}: ${s.value}/100${avgNote}`;
      }).join("\n  ")
    : "";

  const goalSummary = goals.length > 0
    ? `Job list (today's goals): ${goals.filter(g => g.completed).length}/${goals.length} completed\n  ${goals.map(g => `• ${g.title}: ${g.completed ? "✓ done" : "open"}`).join("\n  ")}`
    : "No job list items set today";
  const moodAvg = moods.length > 0
    ? `Mood check-ins: ${moods.map(m => `${m.value}/100 (${m.label || "check-in"})`).join(", ")} — daily avg ${Math.round(moods.reduce((a, m) => a + m.value, 0) / moods.length)}/100`
    : "No mood check-ins yet";
  const journalContent = entries.length > 0 ? decrypt(entries[0].content) : "";
  const infiniteGoalContent = infiniteGoalRows.length > 0 ? decrypt(infiniteGoalRows[0].content) : null;
  const longTermGoalsList = ltGoals.map(g => decrypt(g.title));

  const debriefDate = new Date(date + "T12:00:00");
  const dayOfWeek = debriefDate.getDay();
  const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const dayName = DAY_NAMES[dayOfWeek];
  const isWeeklyAlignmentDay = dayOfWeek === 0;

  // Habit context
  const completedHabitIds = new Set(todayHabitLogs.map(l => l.habitId));
  const habitSummaryParts = userHabits.map(h => {
    const done = completedHabitIds.has(h.id);
    const streak = h.currentStreak || 0;
    return `${h.emoji} ${h.name} (${done ? "done today" : "not yet today"}, ${streak}-day streak)`;
  });
  const habitSummary = habitSummaryParts.length > 0
    ? `Habits in progress:\n  ${habitSummaryParts.join("\n  ")}`
    : "";

  // Recent debrief history — load summaries or fall back to first AI message
  const recentDebriefContext: string[] = [];
  for (const d of recentDebriefs) {
    const debriefLabel = new Date(d.date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
    if (d.summary) {
      recentDebriefContext.push(`${debriefLabel}: ${decrypt(d.summary)}`);
    } else {
      // Fall back to loading messages for context
      const msgs = await db.select().from(debriefMessages)
        .where(eq(debriefMessages.debriefId, d.id))
        .orderBy(debriefMessages.createdAt)
        .limit(6);
      const decrypted = msgs.map(m => ({ role: m.role, content: decrypt(m.content) }));
      const userMsgs = decrypted.filter(m => m.role === "user").map(m => m.content).join(" / ").slice(0, 300);
      if (userMsgs) recentDebriefContext.push(`${debriefLabel}: ${userMsgs}`);
    }
  }

  // Active challenges
  const challengeContextParts = activeParticipations.map(({ challenge: c, participation: p }) => {
    const typeNote = c.type === "habit"
      ? `habit challenge — "${c.habitEmoji || ""} ${c.habitName || ""}"${p.commitment ? `, your commitment: "${p.commitment}"` : ""}`
      : `score challenge — tracking "${c.metricName}"`;
    return `"${c.title}" (${typeNote}, ends ${c.endDate})`;
  });

  return {
    scoreMap, goalSummary, moodAvg, journalContent,
    hasScores: loggedScores.length > 0, hasGoals: goals.length > 0, hasMoods: moods.length > 0,
    infiniteGoalContent, longTermGoalsList, isWeeklyAlignmentDay, habitSummary,
    dayName, recentDebriefContext, challengeContextParts,
  };
}

/** Returns true if the provided date string (YYYY-MM-DD) matches today's month/day */
function isTodayBirthday(dateOfBirth: string | undefined, todayDateStr: string): boolean {
  if (!dateOfBirth) return false;
  try {
    const [, dobMonth, dobDay] = dateOfBirth.split("-");
    const [, todayMonth, todayDay] = todayDateStr.split("-");
    return dobMonth === todayMonth && dobDay === todayDay;
  } catch {
    return false;
  }
}

/** Returns age in years from a YYYY-MM-DD string */
function computeAge(dateOfBirth: string, todayDateStr: string): number {
  const [dobYear, dobMonth, dobDay] = dateOfBirth.split("-").map(Number);
  const [todayYear, todayMonth, todayDay] = todayDateStr.split("-").map(Number);
  let age = todayYear - dobYear;
  if (todayMonth < dobMonth || (todayMonth === dobMonth && todayDay < dobDay)) age--;
  return age;
}

function buildUserProfileSummary(profile: Record<string, string> | null | undefined, date?: string): { summary: string; isBirthday: boolean } {
  if (!profile || Object.keys(profile).length === 0) return { summary: "", isBirthday: false };

  const labels: Record<string, Record<string, string>> = {
    driver: {
      A: "driven by achievement and results",
      B: "driven by growth and learning",
      C: "driven by impact on others",
      D: "driven by consistency and discipline",
    },
    challenge: {
      A: "biggest challenge is maintaining motivation",
      B: "biggest challenge is managing time and energy",
      C: "biggest challenge is handling setbacks",
      D: "biggest challenge is staying consistent",
    },
    setbacks: {
      A: "bounces back fast — analyses and adjusts quickly",
      B: "needs time to recharge after a bad day",
      C: "pushes through regardless",
      D: "processes setbacks by talking them through",
    },
    energy: {
      A: "performs best in the early morning",
      B: "peaks in late morning / midday",
      C: "performs best in the afternoon",
      D: "peaks in the evening",
    },
    style: {
      A: "works best in focused sprints with breaks",
      B: "works best with steady sustained effort",
      C: "reactive — goes where needed",
      D: "mixed style depending on the task",
    },
    goals: {
      A: "sets ambitious goals and pushes hard toward them",
      B: "prefers realistic, achievable targets",
      C: "values progress over perfection",
      D: "focuses on systems rather than specific goals",
    },
    feedback: {
      A: "wants direct honest feedback — doesn't want softening",
      B: "responds best to balanced feedback acknowledging wins and areas to improve",
      C: "tends to be self-critical — benefits most from encouragement and perspective",
      D: "wants tactical, actionable feedback — tell me what to do differently",
    },
  };

  const parts: string[] = [];

  // Personal details
  const todayStr = date || new Date().toISOString().split("T")[0];
  const birthday = isTodayBirthday(profile.dateOfBirth, todayStr);
  if (profile.dateOfBirth) {
    const age = computeAge(profile.dateOfBirth, todayStr);
    if (age > 0) parts.push(`age ${age}`);
  }
  if (profile.occupation) parts.push(`works as: ${profile.occupation}`);
  if (profile.location) parts.push(`based in ${profile.location}`);
  if (profile.currentFocus) parts.push(`current focus: ${profile.currentFocus}`);

  // Behavioural questionnaire
  for (const [key, answer] of Object.entries(profile)) {
    if (labels[key]?.[answer]) parts.push(labels[key][answer]);
  }

  const summary = parts.length > 0
    ? `\nDRIVER PROFILE (adapt your style accordingly):\n${parts.map(p => `• ${p}`).join("\n")}`
    : "";

  return { summary, isBirthday: birthday };
}

export function buildSystemPrompt(context: Awaited<ReturnType<typeof gatherDayContext>>, date: string, userMessageCount: number, journalPreference: string = "evening", userProfile?: Record<string, string> | null, displayName?: string | null) {
  const now = new Date();
  const currentHour = now.getHours();

  // Compute actual today and yesterday date strings for comparison
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const yd = new Date(now);
  yd.setDate(yd.getDate() - 1);
  const yesterdayStr = `${yd.getFullYear()}-${String(yd.getMonth() + 1).padStart(2, '0')}-${String(yd.getDate()).padStart(2, '0')}`;

  const isToday = date === todayStr;
  const isYesterday = date === yesterdayStr;
  const debriefDate = new Date(date + "T12:00:00");


  const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const debriefDayName = context.dayName ?? DAY_NAMES[debriefDate.getDay()];
  const timeOfDay = currentHour < 12 ? "morning" : currentHour < 17 ? "afternoon" : "evening";
  const timeLabel = `${debriefDayName}, ${currentHour}:${String(now.getMinutes()).padStart(2, "0")} (${timeOfDay})`;

  // Determine timing context from the ACTUAL date being debriefed, not from journalPreference.
  // journalPreference only affects smart default tab — not whether the AI says "today" or "yesterday".
  let timingContext: string;
  if (isToday) {
    const dayStillOpen = currentHour < 20;
    const morningCaveat = currentHour < 11
      ? `\nMORNING DEBRIEF CAVEAT: It is early in the day (${currentHour}:xx). Activity metrics like Steps, Active Energy, Exercise Minutes, Flights Climbed, and Walking Distance reflect what has accumulated SO FAR — they will grow throughout the day. Do NOT question, flag, or comment on low values for these metrics. They are expected to be low at this hour. Sleep and recovery metrics (Sleep Score, HRV, Resting Heart Rate) are valid because they reflect the night just completed.`
      : "";
    timingContext = `This is TODAY's debrief — ${timeLabel}.${morningCaveat}
${dayStillOpen
  ? `IMPORTANT: The day is still in progress. For any daily goals not yet marked complete, treat them as still achievable — do NOT ask why they weren't done or imply failure. Note what's been done and encourage completing the remaining goals before end of day. Phrase open goals as in-progress, not missed.`
  : `It is late in the day — remaining open goals are unlikely to be completed today. You can analyse them as session outcomes.`}`;
  } else if (isYesterday) {
    timingContext = `This is a debrief for YESTERDAY (${debriefDayName}) — a completed session. Frame it as a post-race review. Treat all uncompleted goals as session outcomes to reflect on and learn from.`;
  } else {
    timingContext = `This is a retrospective debrief for ${debriefDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })} — a historical session. Frame it as reviewing archived telemetry from a past race.`;
  }

  const infiniteGoalSection = context.infiniteGoalContent
    ? `\nINFINITE GOAL: "${context.infiniteGoalContent}"
${context.isWeeklyAlignmentDay ? `TODAY IS THE WEEKLY ALIGNMENT CHECK. At some point during the conversation (ideally exchange 2 or 3), naturally ask how this week's actions have moved the needle toward their infinite goal. Don't force it — weave it in based on what they share.` : ""}`
    : `\nThe user hasn't set an infinite goal yet. ${context.isWeeklyAlignmentDay ? "If the conversation flows naturally toward purpose or direction, gently suggest they might benefit from setting one — but only if it fits organically." : ""}`;

  const ltGoalsSection = context.longTermGoalsList.length > 0
    ? `\nLong-term targets: ${context.longTermGoalsList.join(", ")}`
    : "";

  const habitsSection = context.habitSummary
    ? `\nHABIT LAB — habits the driver is actively building:\n${context.habitSummary}\nIf relevant in the conversation, acknowledge habit completion as a win or gently nudge them on incomplete habits — but only if it flows naturally, never force it.`
    : "";

  const challengesSection = context.challengeContextParts && context.challengeContextParts.length > 0
    ? `\nACTIVE CHALLENGES (team accountability):\n  ${context.challengeContextParts.join("\n  ")}\nReference these when relevant — challenge progress can reveal consistency patterns or social commitment dynamics.`
    : "";

  const recentHistorySection = context.recentDebriefContext && context.recentDebriefContext.length > 0
    ? `\nRECENT SESSION HISTORY (last ${context.recentDebriefContext.length} completed debriefs — use for pattern recognition, continuity, and follow-up on anything left unresolved):\n  ${context.recentDebriefContext.join("\n  ")}`
    : "";

  const { summary: profileSection, isBirthday } = buildUserProfileSummary(userProfile, date);
  const driverName = displayName ? ` The driver's name is ${displayName} — use their name naturally in conversation, not every message, but enough that it feels personal.` : "";
  const birthdayNote = isBirthday
    ? `\n\nSPECIAL — TODAY IS THE DRIVER'S BIRTHDAY. Acknowledge this naturally and warmly at the start of the debrief — something brief, genuine and in-character (e.g. "Happy birthday by the way — another lap around the sun."). Don't overdo it, just make it feel human.`
    : "";

  return `You are the user's performance engineer — an F1 performance engineer conducting a post-session debrief.${driverName} You have an engineering brain: rigorous, data-driven, and wired to find root causes rather than surface explanations. You are genuinely invested in helping them extract more performance, but you do not simply validate what they tell you.${profileSection}${birthdayNote}

ENGINEERING MINDSET — THIS IS THE CORE OF YOUR PERSONA:
- You think in first principles. When a driver tells you why something happened, your instinct is to ask whether that explanation is actually correct. Correlation is not causation. Feelings are data, but so is the telemetry — and they don't always agree.
- You ask "why" repeatedly, like peeling an onion. The first explanation is rarely the real one. A bad night's sleep might explain low energy — but why was sleep bad? What was the driver doing the night before? Is this a pattern or an outlier?
- You challenge assumptions respectfully but directly. If the driver says "I couldn't focus because I was stressed," you might ask what the stress was actually caused by, whether the same situation happened before without focus issues, or whether something else in the data contradicts that story.
- You notice when someone is rationalising versus genuinely analysing. Rationalising sounds like a tidy explanation. Genuine analysis acknowledges uncertainty and looks for evidence.
- You do not agree just to be agreeable. If the driver's interpretation of their day doesn't match the data, you say so. Diplomatically, but clearly.
- You look for leverage. What's the single variable that, if changed, would move performance the most? That's the question you're always working toward.
- You are not a therapist, a motivational coach, or a cheerleader. You are an engineer who cares about results.

TIMING:
${timingContext}

TELEMETRY — use this data as your starting point. Each score is shown with the driver's own 30-day average so you can identify outliers relative to THEIR baseline, not against arbitrary benchmarks or other metrics. Never compare metrics against each other. A score below average is only worth exploring if it's meaningful in context.
(Only reference a metric if it appears below — missing = not logged, NOT a zero.)
${context.hasScores ? `Performance scores:\n  ${context.scoreMap}` : "No scores logged — don't mention scores."}

${context.goalSummary}
${context.moodAvg}
${context.journalContent ? `Session notes: "${context.journalContent}"` : ""}${infiniteGoalSection}${ltGoalsSection}${habitsSection}${challengesSection}${recentHistorySection}

CONVERSATION STRUCTURE:
Every response you give is complete in itself — sharp, insightful, and worth ending on. The driver decides after each response whether to stop or go deeper. Design every response so that stopping there still leaves them with something genuinely useful.

- Deliver your sharpest available insight based on the telemetry, what they've said, and the patterns you can see.
- If this is the first exchange: read the telemetry, compare each score to the driver's 30-day average, and name what stands out relative to their personal baseline. If there's recent session history, reference any threads that carry over. Surface the most interesting signal.
- If the conversation has been going: go one level deeper on the most interesting thread. Surface what hasn't been articulated yet — expose a causal link, challenge an assumption, or name a pattern hiding in the data.
- You can surface a tension or a hypothesis — but ALWAYS frame it as a declarative statement, never as a question directed at the driver. "That sleep drop suggests recovery is getting compressed, not just shortened" not "Do you think recovery is being compressed?" or "What do you think is causing this?"
- CRITICAL: NEVER end your response with a question mark. Not once, not ever. Every single response ends with a full stop. The driver is not obligated to answer anything — they can stop after any exchange. If you want to raise something for reflection, state it as an observation or a hypothesis. The app provides "Go Deeper" if they want to continue.
- Do NOT invite the driver to continue or go deeper — the app handles that.
- 2-4 sentences. No lists. No headers. Every word earns its place.

APP TOOLS — USE THESE STRATEGICALLY, NOT REFLEXIVELY:
You have direct access to these actions. Use them only when the conversation naturally surfaces a clear need — never force them:
- add_habit: when the driver mentions wanting to build a recurring behaviour (e.g. "I want to start meditating every morning").
- add_daily_goal: when they want to commit to something specific for their job list. Keep titles short and actionable.
- add_long_term_goal: when a bigger objective emerges from the conversation (e.g. a milestone or outcome they're aiming for over weeks/months).
- edit_daily_goal / edit_habit: when the driver wants to rename or adjust an existing goal or habit.
- remove_daily_goal / remove_habit / remove_long_term_goal: when the driver explicitly wants to delete something.
Beyond direct actions, you can also suggest (in natural language — not a list) things the driver could do inside the app:
- "Tracking your sleep score daily would give us a proper baseline — you can add it in Settings."
- "Given what you've said about energy crashes, adding an Energy circle to your daily scores could surface patterns."
- "A habit streak for X would help make this stick."
Only suggest when it's genuinely useful and follows from what they've shared. Never suggest more than one thing at a time. Don't mention features unprompted.

TOOL USAGE PROTOCOL — CRITICAL:
NEVER call a tool silently on the first mention. Always resolve ambiguity through one conversational question first, then call the tool immediately once the answer is clear.

The user's daily goals section is now called "Today's Job List" in the UI — refer to it that way in conversation (e.g. "I'll add that to your job list").

Before calling add_daily_goal, you MUST confirm:
  (a) Is this recurring — repeating every day going forward — or a one-off for just today or tomorrow?
  (b) Confirm the exact wording if it wasn't explicit. Example: "Add 'Drink water' as a recurring daily goal that repeats every day, or just for today?" Then call the tool with the right recurring value.

Before calling add_habit, confirm the habit name and what counts as completing it if it's ambiguous.

Before calling remove_* or edit_*, state the exact item and ask once for confirmation ("Remove 'Drink water' from your job list?"). Then execute immediately on confirmation.
For remove_daily_goal: if the user says "remove from today" or "remove from [specific day]", pass specificDate (YYYY-MM-DD) so only that day's entry is deleted and future days remain. If they say "remove it entirely" or don't specify a date, omit specificDate to permanently deactivate.

Once you have enough info — call the tool without asking again. Do not re-confirm what the user just confirmed.
One clarifying question per message — never stack.

TONE AND STYLE — THIS IS CRITICAL:
- Direct, clear, and precise. No filler. No padding. Every sentence earns its place.
- Use contractions freely (it's, you've, that's, didn't, wasn't).
- React honestly: if something surprised you, say so. If their reasoning has a gap, point it out. If the data contradicts what they're saying, flag it.
- Never start a response with "Great", "That's great", "Good", "It sounds like", "I can see", or "I understand".
- No bullet points. No numbered lists. No emojis. Write in plain, natural sentences.
- 2-3 sentences max. Shorter is almost always better. Cut everything that isn't essential.
- Strong sessions deserve real recognition — don't manufacture problems where there aren't any. Tough sessions deserve honest analysis — don't paper over them with reassurance.
- Do NOT ask multiple questions in a single response. If you raise something, raise one thing.
- Do NOT say "would you like to continue?", "want to go deeper?", or offer to wrap up — the app handles all of that.`;
}

export function registerDebriefRoutes(app: Express): void {
  app.get("/api/debriefs/:date", async (req: Request, res: Response) => {
    const userId = requireAuth(req, res);
    if (!userId) return;

    try {
      const { date } = req.params;
      const allDebriefs = await db.select().from(debriefs)
        .where(and(eq(debriefs.userId, userId), eq(debriefs.date, date)))
        .orderBy(debriefs.createdAt);

      if (allDebriefs.length === 0) {
        return res.json([]);
      }

      const result = await Promise.all(allDebriefs.map(async (debrief) => {
        const msgs = await db.select().from(debriefMessages)
          .where(eq(debriefMessages.debriefId, debrief.id))
          .orderBy(debriefMessages.createdAt);
        const decryptedMsgs = msgs.map(m => ({ ...m, content: decrypt(m.content) }));
        return {
          ...debrief,
          summary: debrief.summary ? decrypt(debrief.summary) : debrief.summary,
          messages: decryptedMsgs,
        };
      }));

      // Filter out sessions that have messages but ALL of them are blank after decryption.
      // (0-message incomplete sessions are kept — they may be freshly-started user-led sessions;
      //  the POST /start route cleans them up before creating a new one.)
      const filtered = result.filter(d => {
        if (d.isComplete) return true;          // always keep completed sessions
        if (d.messages.length === 0) return true; // keep fresh user-led sessions
        // Incomplete with messages — only keep if at least one message has real content
        return d.messages.some(
          (m: any) => (m.content && m.content.trim().length > 0) || m.attachmentUrl
        );
      });

      res.json(filtered);
    } catch (error) {
      console.error("Error fetching debrief:", error);
      res.status(500).json({ error: "Failed to fetch debrief" });
    }
  });

  app.post("/api/debriefs/start", async (req: Request, res: Response) => {
    const userId = requireAuth(req, res);
    if (!userId) return;

    try {
      const { date, fresh, userLed } = req.body;

      // When fresh=false, resume the existing active (incomplete) debrief if one exists
      if (!fresh) {
        const existingAll = await db.select().from(debriefs)
          .where(and(eq(debriefs.userId, userId), eq(debriefs.date, date)))
          .orderBy(debriefs.createdAt);
        const active = existingAll.find(d => !d.isComplete);
        if (active) {
          const msgs = await db.select().from(debriefMessages)
            .where(eq(debriefMessages.debriefId, active.id))
            .orderBy(debriefMessages.createdAt);
          const decryptedMsgs = msgs.map(m => ({ ...m, content: decrypt(m.content) }));
          return res.json({ ...active, messages: decryptedMsgs });
        }
      }
      // fresh=true OR no active debrief found — create a new session.
      // First, purge any abandoned empty (0-message) sessions for this date
      // so they don't accumulate in the database over time.
      const incompleteSessions = await db.select({ id: debriefs.id }).from(debriefs)
        .where(and(eq(debriefs.userId, userId), eq(debriefs.date, date), eq(debriefs.isComplete, false)));
      for (const row of incompleteSessions) {
        const msgs = await db.select().from(debriefMessages)
          .where(eq(debriefMessages.debriefId, row.id));
        // Delete if: no messages at all, OR every message has blank content and no attachment.
        // Content is encrypted — decrypt before checking so empty strings are detected correctly.
        const hasVisibleContent = msgs.some(m => {
          const plain = decrypt(m.content);
          return (plain && plain.trim().length > 0) || m.attachmentUrl;
        });
        if (msgs.length === 0 || !hasVisibleContent) {
          await db.delete(debriefMessages).where(eq(debriefMessages.debriefId, row.id));
          await db.delete(debriefs).where(eq(debriefs.id, row.id));
        }
      }

      const [debrief] = await db.insert(debriefs).values({
        userId,
        date,
        isComplete: false,
      }).returning();

      // User-led mode: skip the AI opening prompt — user types first
      if (userLed) {
        return res.json({ ...debrief, messages: [] });
      }

      // AI-led: stream the opening message via SSE so it appears word-by-word
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      // Send debriefId first so the client can reference it
      res.write(`data: ${JSON.stringify({ debriefId: debrief.id })}\n\n`);

      const context = await gatherDayContext(userId, date);
      const [user] = await db.select().from(users).where(eq(users.id, userId));
      const systemPrompt = buildSystemPrompt(context, date, 0, user?.journalPreference || "evening", user?.userProfile, user?.displayName);

      const openingStream = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: "Start the debrief." },
        ],
        stream: true,
        max_tokens: 300,
      });

      let openingMessage = "";
      for await (const chunk of openingStream) {
        const content = chunk.choices[0]?.delta?.content;
        if (content) {
          openingMessage += content;
          res.write(`data: ${JSON.stringify({ content })}\n\n`);
        }
      }

      await db.insert(debriefMessages).values({
        debriefId: debrief.id,
        role: "assistant",
        content: encrypt(openingMessage || "Ready when you are. How did the session go?"),
      });

      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
    } catch (error) {
      console.error("Error starting debrief:", error);
      if (res.headersSent) {
        res.write(`data: ${JSON.stringify({ error: "Failed to start debrief" })}\n\n`);
        res.end();
      } else {
        res.status(500).json({ error: "Failed to start debrief" });
      }
    }
  });

  // Delete a user message (and the immediately following AI response if present)
  app.delete("/api/debrief/messages/:messageId", async (req: Request, res: Response) => {
    const userId = requireAuth(req, res);
    if (!userId) return;

    try {
      const messageId = parseInt(req.params.messageId);
      if (isNaN(messageId)) return res.status(400).json({ error: "Invalid message ID" });

      // Verify the message belongs to a debrief owned by this user
      const [msg] = await db.select().from(debriefMessages)
        .where(eq(debriefMessages.id, messageId));
      if (!msg) return res.status(404).json({ error: "Message not found" });

      const [debrief] = await db.select().from(debriefs)
        .where(and(eq(debriefs.id, msg.debriefId), eq(debriefs.userId, userId)));
      if (!debrief) return res.status(403).json({ error: "Forbidden" });

      // Only allow deletion of user messages
      if (msg.role !== "user") return res.status(400).json({ error: "Can only delete your own messages" });

      // Find all messages ordered by createdAt to locate the next AI response
      const allMsgs = await db.select().from(debriefMessages)
        .where(eq(debriefMessages.debriefId, msg.debriefId))
        .orderBy(debriefMessages.createdAt);

      const msgIndex = allMsgs.findIndex(m => m.id === messageId);
      const nextMsg = msgIndex >= 0 ? allMsgs[msgIndex + 1] : null;

      // Delete the user message
      await db.delete(debriefMessages).where(eq(debriefMessages.id, messageId));

      // Delete the immediately following AI response if present
      if (nextMsg && nextMsg.role === "assistant") {
        await db.delete(debriefMessages).where(eq(debriefMessages.id, nextMsg.id));
      }

      res.json({ ok: true, deletedPair: !!(nextMsg && nextMsg.role === "assistant") });
    } catch (error) {
      console.error("Error deleting debrief message:", error);
      res.status(500).json({ error: "Failed to delete message" });
    }
  });

  app.post("/api/debriefs/:debriefId/respond", aiLimiter, async (req: Request, res: Response) => {
    const userId = requireAuth(req, res);
    if (!userId) return;

    try {
      const debriefId = parseInt(req.params.debriefId);
      const { content, attachmentUrl, attachmentType } = req.body;

      const [debrief] = await db.select().from(debriefs)
        .where(and(eq(debriefs.id, debriefId), eq(debriefs.userId, userId)));

      if (!debrief) {
        return res.status(404).json({ error: "Debrief not found" });
      }

      // Alias used throughout the tool-execution block below
      const date = debrief.date;

      await db.insert(debriefMessages).values({
        debriefId,
        role: "user",
        content: encrypt(content || ""),
        ...(attachmentUrl ? { attachmentUrl, attachmentType: attachmentType || "image" } : {}),
      });

      updateUserStreak(userId, date).catch(() => {});

      const allMessages = await db.select().from(debriefMessages)
        .where(eq(debriefMessages.debriefId, debriefId))
        .orderBy(debriefMessages.createdAt);

      const userMessageCount = allMessages.filter(m => m.role === "user").length;
      const context = await gatherDayContext(userId, debrief.date);
      const [user] = await db.select().from(users).where(eq(users.id, userId));
      const systemPrompt = buildSystemPrompt(context, debrief.date, userMessageCount, user?.journalPreference || "evening", user?.userProfile, user?.displayName);

      const chatMessages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
        { role: "system", content: systemPrompt },
      ];

      for (const msg of allMessages) {
        chatMessages.push({
          role: msg.role as "user" | "assistant",
          content: decrypt(msg.content),
        });
      }

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      const debriefTools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
        {
          type: "function",
          function: {
            name: "add_daily_goal",
            description: "Add a daily goal for the user. Only call AFTER clarifying whether it is recurring (repeats every day going forward) or one-off. For one-off goals use recurring=false, set days to the number of consecutive days, and set startOffset to how many days from today to start (0=today, 1=tomorrow, 2=day after tomorrow). Example: 'tomorrow and the day after' → days=2, startOffset=1. For a permanent daily goal use recurring=true (days and startOffset are ignored).",
            parameters: {
              type: "object",
              properties: {
                title: { type: "string", description: "Short, actionable goal title (e.g. '10 min meditation', 'Cold shower', 'Drink water')" },
                recurring: { type: "boolean", description: "true = repeats every day going forward; false = one-off for a fixed number of days" },
                days: { type: "number", description: "Number of consecutive days to add this goal for when recurring=false (default 1)." },
                startOffset: { type: "number", description: "Days from today to start (0=today, 1=tomorrow, 2=day after tomorrow). Default 0. Use 1 when the user says 'tomorrow', 2 for 'day after tomorrow', etc." },
              },
              required: ["title", "recurring"],
            },
          },
        },
        {
          type: "function",
          function: {
            name: "edit_daily_goal",
            description: "Rename or update an existing daily goal. Only call after confirming with the user which goal to change and what the new title should be.",
            parameters: {
              type: "object",
              properties: {
                oldTitle: { type: "string", description: "Current title of the goal (exact or close match)" },
                newTitle: { type: "string", description: "New title for the goal" },
              },
              required: ["oldTitle", "newTitle"],
            },
          },
        },
        {
          type: "function",
          function: {
            name: "add_long_term_goal",
            description: "Add a new long-term target for the user (max 3 total). Use when the user mentions a bigger objective or milestone they're working toward over weeks or months.",
            parameters: {
              type: "object",
              properties: {
                title: { type: "string", description: "Concise goal title" },
                description: { type: "string", description: "Optional brief description" },
              },
              required: ["title"],
            },
          },
        },
        {
          type: "function",
          function: {
            name: "remove_long_term_goal",
            description: "Remove a long-term target. Only call after the user confirms they want it removed.",
            parameters: {
              type: "object",
              properties: {
                title: { type: "string", description: "Exact or approximate title of the long-term goal to remove" },
              },
              required: ["title"],
            },
          },
        },
        {
          type: "function",
          function: {
            name: "remove_daily_goal",
            description: "Remove a daily goal. If the user wants to remove it from all days (permanently), omit specificDate. If the user only wants to remove it from one specific date (e.g. 'remove from today'), set specificDate to that date in YYYY-MM-DD format. Never remove 'Make my bed'.",
            parameters: {
              type: "object",
              properties: {
                title: { type: "string", description: "Exact or approximate title of the goal to remove" },
                specificDate: { type: "string", description: "YYYY-MM-DD date to remove the goal from only that day. Omit to remove from all days permanently." },
              },
              required: ["title"],
            },
          },
        },
        {
          type: "function",
          function: {
            name: "add_habit",
            description: "Add a new habit to the user's Habit Lab. Only call after confirming the habit name. If the user specifies a schedule (alternate days, every other day, weekly, etc.), set frequency accordingly.",
            parameters: {
              type: "object",
              properties: {
                name: { type: "string", description: "Short habit name (e.g. 'Cold shower', 'Read 20 pages')" },
                emoji: { type: "string", description: "A single relevant emoji for the habit" },
                frequency: { type: "string", enum: ["daily", "alternate", "weekly"], description: "How often: 'daily' (default, every day), 'alternate' (every other day), 'weekly' (once a week)" },
              },
              required: ["name"],
            },
          },
        },
        {
          type: "function",
          function: {
            name: "edit_habit",
            description: "Rename or update an existing habit. Only call after confirming with the user which habit to change and the new name/emoji.",
            parameters: {
              type: "object",
              properties: {
                oldName: { type: "string", description: "Current habit name (exact or close match)" },
                newName: { type: "string", description: "New habit name" },
                emoji: { type: "string", description: "Optional updated emoji" },
              },
              required: ["oldName", "newName"],
            },
          },
        },
        {
          type: "function",
          function: {
            name: "remove_habit",
            description: "Remove (archive) a habit from the user's Habit Lab. Only call after the user confirms.",
            parameters: {
              type: "object",
              properties: {
                name: { type: "string", description: "Exact or approximate name of the habit to remove" },
              },
              required: ["name"],
            },
          },
        },
      ];

      const stream = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: chatMessages,
        stream: true,
        max_tokens: 350,
        tools: debriefTools,
        tool_choice: "auto",
      });

      let fullResponse = "";
      const toolCallAccumulator: Record<number, { id: string; name: string; arguments: string }> = {};

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;
        if (delta?.content) {
          fullResponse += delta.content;
          res.write(`data: ${JSON.stringify({ content: delta.content })}\n\n`);
        }
        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            if (!toolCallAccumulator[tc.index]) {
              toolCallAccumulator[tc.index] = { id: tc.id || "", name: tc.function?.name || "", arguments: "" };
            }
            if (tc.function?.name) toolCallAccumulator[tc.index].name = tc.function.name;
            if (tc.function?.arguments) toolCallAccumulator[tc.index].arguments += tc.function.arguments;
          }
        }
      }

      // Execute any tool calls
      const actions: Array<{ type: string; params: any; success: boolean; message: string }> = [];
      for (const tc of Object.values(toolCallAccumulator)) {
        try {
          const params = JSON.parse(tc.arguments);
          if (tc.name === "add_daily_goal") {
            const isRecurring = params.recurring !== false;
            const numDays = Math.max(1, Math.round(params.days ?? 1));
            // Get or create template — idempotent so duplicate AI calls don't fail
            const existingTemplates = await db.select().from(goalTemplates)
              .where(and(eq(goalTemplates.userId, userId), eq(goalTemplates.isActive, true)));
            let tmpl = existingTemplates.find(g => g.title.toLowerCase() === params.title.toLowerCase());
            if (!tmpl) {
              const [created] = await db.insert(goalTemplates).values({
                userId,
                title: params.title,
                recurring: isRecurring,
                isActive: true,
                sortOrder: existingTemplates.length,
              }).returning();
              tmpl = created;
            }
            // Always create dailyGoals rows so the goal is immediately visible.
            // startOffset: 0=today, 1=tomorrow, 2=day after tomorrow, etc.
            if (tmpl) {
              const startOffset = Math.max(0, Math.round(params.startOffset ?? 0));
              const daysToInsert = isRecurring ? 1 : numDays;
              for (let i = 0; i < daysToInsert; i++) {
                const [y, m, d2] = date.split("-").map(Number);
                const target = new Date(Date.UTC(y, m - 1, d2 + startOffset + i));
                const targetDate = `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, "0")}-${String(target.getUTCDate()).padStart(2, "0")}`;
                const [exists] = await db.select().from(dailyGoals)
                  .where(and(eq(dailyGoals.userId, userId), eq(dailyGoals.date, targetDate), eq(dailyGoals.goalTemplateId, tmpl.id)));
                if (!exists) {
                  await db.insert(dailyGoals).values({ userId, date: targetDate, goalTemplateId: tmpl.id, title: params.title, completed: false });
                }
              }
            }
            const startOffset = Math.max(0, Math.round(params.startOffset ?? 0));
            const startLabel = startOffset === 0 ? "today" : startOffset === 1 ? "tomorrow" : `in ${startOffset} days`;
            const label = isRecurring ? "every day going forward" : (numDays === 1 ? startLabel : `${startLabel} + next ${numDays - 1} day(s)`);
            actions.push({ type: "add_daily_goal", params, success: true, message: `Added daily goal: ${params.title} (${label})` });
          } else if (tc.name === "edit_daily_goal") {
            const allTemplates = await db.select().from(goalTemplates)
              .where(and(eq(goalTemplates.userId, userId), eq(goalTemplates.isActive, true)));
            const match = allTemplates.find(t =>
              t.title.toLowerCase().includes(params.oldTitle.toLowerCase()) ||
              params.oldTitle.toLowerCase().includes(t.title.toLowerCase())
            );
            if (match) {
              await db.update(goalTemplates).set({ title: params.newTitle }).where(eq(goalTemplates.id, match.id));
              actions.push({ type: "edit_daily_goal", params, success: true, message: `Updated daily goal: "${match.title}" → "${params.newTitle}"` });
            } else {
              actions.push({ type: "edit_daily_goal", params, success: false, message: `Goal not found: ${params.oldTitle}` });
            }
          } else if (tc.name === "add_long_term_goal") {
            const existing = await db.select().from(longTermGoals)
              .where(and(eq(longTermGoals.userId, userId), eq(longTermGoals.isActive, true)));
            if (existing.length >= 3) {
              actions.push({ type: "add_long_term_goal", params, success: false, message: "Already at 3 long-term targets (maximum reached)" });
            } else {
              await db.insert(longTermGoals).values({
                userId,
                title: params.title,
                description: params.description || null,
                isActive: true,
                sortOrder: existing.length,
              });
              actions.push({ type: "add_long_term_goal", params, success: true, message: `Added long-term target: ${params.title}` });
            }
          } else if (tc.name === "remove_long_term_goal") {
            const allLtg = await db.select().from(longTermGoals)
              .where(and(eq(longTermGoals.userId, userId), eq(longTermGoals.isActive, true)));
            const match = allLtg.find(g =>
              g.title.toLowerCase().includes(params.title.toLowerCase()) ||
              params.title.toLowerCase().includes(g.title.toLowerCase())
            );
            if (match) {
              await db.update(longTermGoals).set({ isActive: false }).where(eq(longTermGoals.id, match.id));
              actions.push({ type: "remove_long_term_goal", params, success: true, message: `Removed long-term target: ${match.title}` });
            } else {
              actions.push({ type: "remove_long_term_goal", params, success: false, message: `Long-term goal not found: ${params.title}` });
            }
          } else if (tc.name === "remove_daily_goal") {
            if (params.title.toLowerCase().includes("make my bed")) {
              actions.push({ type: "remove_daily_goal", params, success: false, message: "Make my bed cannot be removed — it's your foundational daily goal." });
            } else {
              // Search all templates (active OR inactive) so goals that were partially
              // removed (template deactivated but dailyGoals rows left behind) can still be cleaned up.
              const allTemplates = await db.select().from(goalTemplates)
                .where(eq(goalTemplates.userId, userId));
              const match = allTemplates.find(t =>
                t.title.toLowerCase().includes(params.title.toLowerCase()) ||
                params.title.toLowerCase().includes(t.title.toLowerCase())
              );
              if (match) {
                if (params.specificDate) {
                  // Remove only from this specific date's dailyGoals entry
                  await db.delete(dailyGoals).where(and(
                    eq(dailyGoals.userId, userId),
                    eq(dailyGoals.goalTemplateId, match.id),
                    eq(dailyGoals.date, params.specificDate),
                  ));
                  actions.push({ type: "remove_daily_goal", params, success: true, message: `Removed daily goal from ${params.specificDate}: ${match.title}` });
                } else {
                  // Remove permanently — deactivate template and delete all rows
                  await db.update(goalTemplates).set({ isActive: false }).where(eq(goalTemplates.id, match.id));
                  await db.delete(dailyGoals).where(and(eq(dailyGoals.userId, userId), eq(dailyGoals.goalTemplateId, match.id)));
                  actions.push({ type: "remove_daily_goal", params, success: true, message: `Removed daily goal: ${match.title}` });
                }
              } else {
                actions.push({ type: "remove_daily_goal", params, success: false, message: `Goal not found: ${params.title}` });
              }
            }
          } else if (tc.name === "add_habit") {
            const existingHabits = await db.select().from(habits)
              .where(and(eq(habits.userId, userId), eq(habits.isArchived, false)));
            const alreadyExists = existingHabits.some(h => h.name.toLowerCase() === params.name.toLowerCase());
            if (alreadyExists) {
              actions.push({ type: "add_habit", params, success: false, message: `Habit already exists: ${params.name}` });
            } else {
              await db.insert(habits).values({
                userId,
                name: params.name,
                emoji: params.emoji || "⭐",
                category: "general",
                frequency: (params.frequency as string) || "daily",
                isArchived: false,
              });
              actions.push({ type: "add_habit", params, success: true, message: `Added habit: ${params.name}` });
            }
          } else if (tc.name === "edit_habit") {
            const allHabits = await db.select().from(habits)
              .where(and(eq(habits.userId, userId), eq(habits.isArchived, false)));
            const match = allHabits.find(h =>
              h.name.toLowerCase().includes(params.oldName.toLowerCase()) ||
              params.oldName.toLowerCase().includes(h.name.toLowerCase())
            );
            if (match) {
              await db.update(habits).set({
                name: params.newName,
                ...(params.emoji ? { emoji: params.emoji } : {}),
              }).where(eq(habits.id, match.id));
              actions.push({ type: "edit_habit", params, success: true, message: `Updated habit: "${match.name}" → "${params.newName}"` });
            } else {
              actions.push({ type: "edit_habit", params, success: false, message: `Habit not found: ${params.oldName}` });
            }
          } else if (tc.name === "remove_habit") {
            const allHabits = await db.select().from(habits)
              .where(and(eq(habits.userId, userId), eq(habits.isArchived, false)));
            const match = allHabits.find(h =>
              h.name.toLowerCase().includes(params.name.toLowerCase()) ||
              params.name.toLowerCase().includes(h.name.toLowerCase())
            );
            if (match) {
              await db.update(habits).set({ isArchived: true }).where(eq(habits.id, match.id));
              actions.push({ type: "remove_habit", params, success: true, message: `Removed habit: ${match.name}` });
            } else {
              actions.push({ type: "remove_habit", params, success: false, message: `Habit not found: ${params.name}` });
            }
          }
        } catch (e) {
          console.error("Tool call failed:", tc.name, e);
        }
      }

      if (actions.length > 0) {
        res.write(`data: ${JSON.stringify({ actions })}\n\n`);
      }

      // When the AI called tools (possibly with no preceding text), we need a
      // follow-up streaming call so the assistant can confirm what it did.
      if (Object.keys(toolCallAccumulator).length > 0) {
        const tcValues = Object.values(toolCallAccumulator);
        const assistantToolMsg: OpenAI.Chat.Completions.ChatCompletionMessageParam = {
          role: "assistant",
          content: fullResponse || null,
          tool_calls: tcValues.map(tc => ({
            id: tc.id,
            type: "function" as const,
            function: { name: tc.name, arguments: tc.arguments },
          })),
        };
        // One tool result per call, matched by position
        const toolResultMsgs: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = tcValues.map((tc, i) => ({
          role: "tool" as const,
          tool_call_id: tc.id,
          content: actions[i]?.message ?? "Action completed.",
        }));

        try {
          const followUp = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [...chatMessages, assistantToolMsg, ...toolResultMsgs],
            stream: true,
            max_tokens: 250,
          });
          let followUpText = "";
          for await (const chunk of followUp) {
            const delta = chunk.choices[0]?.delta;
            if (delta?.content) {
              followUpText += delta.content;
              res.write(`data: ${JSON.stringify({ content: delta.content })}\n\n`);
            }
          }
          if (followUpText) {
            fullResponse = fullResponse ? `${fullResponse}\n\n${followUpText}` : followUpText;
          }
        } catch (followUpErr) {
          console.error("Follow-up AI call failed:", followUpErr);
          // Non-fatal — the tool action still succeeded; just no confirmation text
        }
      }

      await db.insert(debriefMessages).values({
        debriefId,
        role: "assistant",
        content: encrypt(fullResponse),
      });

      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
    } catch (error) {
      console.error("Error responding to debrief:", error);
      if (res.headersSent) {
        res.write(`data: ${JSON.stringify({ error: "Failed to generate response" })}\n\n`);
        res.end();
      } else {
        res.status(500).json({ error: "Failed to respond" });
      }
    }
  });

  // ── Go Deeper — trigger a follow-up AI response without requiring user input ─────────────────────
  app.post("/api/debriefs/:debriefId/go-deeper", aiLimiter, async (req: Request, res: Response) => {
    const userId = requireAuth(req, res);
    if (!userId) return;

    try {
      const debriefId = parseInt(req.params.debriefId);
      const [debrief] = await db.select().from(debriefs)
        .where(and(eq(debriefs.id, debriefId), eq(debriefs.userId, userId)));

      if (!debrief) return res.status(404).json({ error: "Debrief not found" });
      if (debrief.isComplete) return res.status(400).json({ error: "Debrief already complete" });

      const allMessages = await db.select().from(debriefMessages)
        .where(eq(debriefMessages.debriefId, debriefId))
        .orderBy(debriefMessages.createdAt);

      const userMessageCount = allMessages.filter(m => m.role === "user").length;
      const context = await gatherDayContext(userId, debrief.date);
      const [user] = await db.select().from(users).where(eq(users.id, userId));
      const systemPrompt = buildSystemPrompt(context, debrief.date, userMessageCount, user?.journalPreference || "evening", user?.userProfile, user?.displayName);

      const chatMessages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
        { role: "system", content: systemPrompt },
      ];
      for (const msg of allMessages) {
        chatMessages.push({ role: msg.role as "user" | "assistant", content: decrypt(msg.content) });
      }
      // Signal the AI to go one level deeper without user input
      chatMessages.push({
        role: "system",
        content: "The driver has chosen to go deeper. Do NOT repeat anything already said. Pick up the most interesting thread from your last response and go one level further — expose a new layer of insight, surface a causal link, challenge an assumption, or name a pattern that hasn't been articulated yet. Make this response complete and valuable on its own, as if it could be the final thing said this session.",
      });

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      const stream = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: chatMessages,
        stream: true,
        max_tokens: 350,
      });

      let fullResponse = "";
      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content;
        if (content) {
          fullResponse += content;
          res.write(`data: ${JSON.stringify({ content })}\n\n`);
        }
      }

      await db.insert(debriefMessages).values({
        debriefId,
        role: "assistant",
        content: encrypt(fullResponse),
      });

      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
    } catch (error) {
      console.error("Error in go-deeper:", error);
      if (res.headersSent) {
        res.write(`data: ${JSON.stringify({ error: "Failed to generate response" })}\n\n`);
        res.end();
      } else {
        res.status(500).json({ error: "Failed to go deeper" });
      }
    }
  });

  // ── Log a moment — saves a one-way entry (no AI response) as a debrief session ───────────────────
  app.post("/api/debriefs/log-moment", async (req: Request, res: Response) => {
    const userId = requireAuth(req, res);
    if (!userId) return;

    try {
      const { content, date, attachmentUrl, attachmentType } = req.body;
      if (!content?.trim() && !attachmentUrl) {
        return res.status(400).json({ error: "Content or attachment required" });
      }
      if (!date) return res.status(400).json({ error: "Date required" });

      const [newDebrief] = await db.insert(debriefs).values({ userId, date }).returning();

      await db.insert(debriefMessages).values({
        debriefId: newDebrief.id,
        role: "user",
        content: encrypt(content?.trim() || ""),
        ...(attachmentUrl ? { attachmentUrl, attachmentType: attachmentType || "image" } : {}),
      });

      const msgs = await db.select().from(debriefMessages)
        .where(eq(debriefMessages.debriefId, newDebrief.id))
        .orderBy(debriefMessages.createdAt);

      res.json({ ...newDebrief, messages: msgs.map(m => ({ ...m, content: decrypt(m.content) })) });
    } catch (error) {
      console.error("Error logging moment:", error);
      res.status(500).json({ error: "Failed to log moment" });
    }
  });

  app.post("/api/debriefs/:debriefId/complete", async (req: Request, res: Response) => {
    const userId = requireAuth(req, res);
    if (!userId) return;

    try {
      const debriefId = parseInt(req.params.debriefId);

      const [debrief] = await db.select().from(debriefs)
        .where(and(eq(debriefs.id, debriefId), eq(debriefs.userId, userId)));

      if (!debrief) {
        return res.status(404).json({ error: "Debrief not found" });
      }

      const allMessages = await db.select().from(debriefMessages)
        .where(eq(debriefMessages.debriefId, debriefId))
        .orderBy(debriefMessages.createdAt);

      const conversationText = allMessages.map(m =>
        `${m.role === "assistant" ? "DBrief" : "User"}: ${decrypt(m.content)}`
      ).join("\n");

      let summary = "";
      try {
        const summaryResponse = await openai.chat.completions.create({
          model: "gpt-4o",
          messages: [
            {
              role: "system",
              content: "Summarize this daily performance debrief in 2-3 concise sentences. Capture the key themes and any notable insights. Write in second person — address the user as 'you' (e.g. 'You focused on...'). Use high-performance F1 framing, not therapy speak.",
            },
            { role: "user", content: conversationText },
          ],
          max_tokens: 200,
        });
        summary = summaryResponse.choices[0].message.content || "";
      } catch (e) {
        console.error("Failed to generate summary:", e);
        summary = "Debrief completed.";
      }

      const [updated] = await db.update(debriefs)
        .set({ isComplete: true, summary: encrypt(summary) })
        .where(eq(debriefs.id, debriefId))
        .returning();

      const journalContent = allMessages
        .filter(m => m.role === "user")
        .map(m => decrypt(m.content))
        .join("\n\n");

      if (journalContent.trim()) {
        const [existingEntry] = await db.select().from(journalEntries)
          .where(and(eq(journalEntries.userId, userId), eq(journalEntries.date, debrief.date)));

        if (existingEntry) {
          const existingContent = decrypt(existingEntry.content);
          await db.update(journalEntries)
            .set({ content: encrypt(existingContent + "\n\n[Debrief]\n" + journalContent) })
            .where(eq(journalEntries.id, existingEntry.id));
        } else {
          await db.insert(journalEntries).values({
            userId,
            date: debrief.date,
            content: encrypt("[Debrief]\n" + journalContent),
            isVoiceEntry: false,
          });
        }
      }

      res.json({ ...updated, summary });
    } catch (error) {
      console.error("Error completing debrief:", error);
      res.status(500).json({ error: "Failed to complete debrief" });
    }
  });
}

export const REALTIME_TOOLS: Array<{ type: "function"; name: string; description: string; parameters: object }> = [
  {
    type: "function",
    name: "add_daily_goal",
    description: "Add a daily goal. Only call AFTER clarifying whether it's recurring (repeats every day) or one-off. Set recurring=true for ongoing; recurring=false for specific days. Use startOffset to control start day (0=today, 1=tomorrow, 2=day after tomorrow). Example: 'tomorrow and the day after' → recurring=false, days=2, startOffset=1.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short, actionable goal title" },
        recurring: { type: "boolean", description: "true = repeats every day; false = specific days only" },
        days: { type: "number", description: "Number of consecutive days (default 1, only used when recurring=false)" },
        startOffset: { type: "number", description: "Days from today to start (0=today, 1=tomorrow, 2=day after tomorrow). Default 0." },
      },
      required: ["title", "recurring"],
    },
  },
  {
    type: "function",
    name: "edit_daily_goal",
    description: "Rename an existing daily goal. Only call after confirming with the user.",
    parameters: {
      type: "object",
      properties: {
        oldTitle: { type: "string", description: "Current goal title" },
        newTitle: { type: "string", description: "New goal title" },
      },
      required: ["oldTitle", "newTitle"],
    },
  },
  {
    type: "function",
    name: "add_long_term_goal",
    description: "Add a new long-term target (max 3 total).",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Concise goal title" },
        description: { type: "string", description: "Optional brief description" },
      },
      required: ["title"],
    },
  },
  {
    type: "function",
    name: "remove_long_term_goal",
    description: "Remove a long-term target. Only call after the user confirms.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Approximate title of the goal to remove" },
      },
      required: ["title"],
    },
  },
  {
    type: "function",
    name: "remove_daily_goal",
    description: "Remove a daily goal. If the user says 'remove from today' or a specific date, set specificDate (YYYY-MM-DD) to delete only that day's entry. Omit specificDate to remove permanently from all days. Never remove 'Make my bed'.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Approximate title of the goal to remove" },
        specificDate: { type: "string", description: "YYYY-MM-DD date to remove from only that day. Omit to remove permanently." },
      },
      required: ["title"],
    },
  },
  {
    type: "function",
    name: "add_habit",
    description: "Add a new habit to the user's Habit Lab. Only call after confirming the name.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Short habit name" },
        emoji: { type: "string", description: "A single relevant emoji" },
      },
      required: ["name"],
    },
  },
  {
    type: "function",
    name: "edit_habit",
    description: "Rename or update an existing habit. Only call after confirming with the user.",
    parameters: {
      type: "object",
      properties: {
        oldName: { type: "string", description: "Current habit name" },
        newName: { type: "string", description: "New habit name" },
        emoji: { type: "string", description: "Optional updated emoji" },
      },
      required: ["oldName", "newName"],
    },
  },
  {
    type: "function",
    name: "remove_habit",
    description: "Archive a habit. Only call after the user confirms.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Approximate name of the habit to remove" },
      },
      required: ["name"],
    },
  },
];

export async function executeDebriefTool(toolName: string, args: Record<string, any>, userId: number, date: string): Promise<{ success: boolean; message: string }> {
  if (toolName === "add_daily_goal") {
    const isRecurring = args.recurring !== false;
    const numDays = Math.max(1, Math.round(args.days ?? 1));
    const existingTemplates = await db.select().from(goalTemplates)
      .where(and(eq(goalTemplates.userId, userId), eq(goalTemplates.isActive, true)));
    let tmpl = existingTemplates.find(g => g.title.toLowerCase() === args.title.toLowerCase());
    if (!tmpl) {
      const [created] = await db.insert(goalTemplates).values({
        userId, title: args.title, recurring: isRecurring, isActive: true, sortOrder: existingTemplates.length,
      }).returning();
      tmpl = created;
    }
    // Always create dailyGoals rows — startOffset controls start day, recurring gets 1 row, one-off gets numDays.
    if (tmpl) {
      const startOffset = Math.max(0, Math.round(args.startOffset ?? 0));
      const daysToInsert = isRecurring ? 1 : numDays;
      for (let i = 0; i < daysToInsert; i++) {
        const [y, m, d2] = date.split("-").map(Number);
        const target = new Date(Date.UTC(y, m - 1, d2 + startOffset + i));
        const targetDate = `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, "0")}-${String(target.getUTCDate()).padStart(2, "0")}`;
        const [exists] = await db.select().from(dailyGoals)
          .where(and(eq(dailyGoals.userId, userId), eq(dailyGoals.date, targetDate), eq(dailyGoals.goalTemplateId, tmpl.id)));
        if (!exists) {
          await db.insert(dailyGoals).values({ userId, date: targetDate, goalTemplateId: tmpl.id, title: args.title, completed: false });
        }
      }
    }
    const startOffset = Math.max(0, Math.round(args.startOffset ?? 0));
    const startLabel = startOffset === 0 ? "today" : startOffset === 1 ? "tomorrow" : `in ${startOffset} days`;
    const label = isRecurring ? "every day going forward" : (numDays === 1 ? startLabel : `${startLabel} + next ${numDays - 1} day(s)`);
    return { success: true, message: `Added daily goal: ${args.title} (${label})` };
  }

  if (toolName === "edit_daily_goal") {
    const allTemplates = await db.select().from(goalTemplates)
      .where(and(eq(goalTemplates.userId, userId), eq(goalTemplates.isActive, true)));
    const match = allTemplates.find(t =>
      t.title.toLowerCase().includes(args.oldTitle.toLowerCase()) ||
      args.oldTitle.toLowerCase().includes(t.title.toLowerCase())
    );
    if (match) {
      await db.update(goalTemplates).set({ title: args.newTitle }).where(eq(goalTemplates.id, match.id));
      return { success: true, message: `Updated daily goal: "${match.title}" → "${args.newTitle}"` };
    }
    return { success: false, message: `Goal not found: ${args.oldTitle}` };
  }

  if (toolName === "add_long_term_goal") {
    const existing = await db.select().from(longTermGoals)
      .where(and(eq(longTermGoals.userId, userId), eq(longTermGoals.isActive, true)));
    if (existing.length >= 3) return { success: false, message: "Already at 3 long-term targets (maximum reached)" };
    await db.insert(longTermGoals).values({ userId, title: encrypt(args.title), description: args.description ? encrypt(args.description) : null, isActive: true, sortOrder: existing.length });
    return { success: true, message: `Added long-term target: ${args.title}` };
  }

  if (toolName === "remove_long_term_goal") {
    const allLtg = await db.select().from(longTermGoals)
      .where(and(eq(longTermGoals.userId, userId), eq(longTermGoals.isActive, true)));
    const match = allLtg.find(g =>
      g.title.toLowerCase().includes(args.title.toLowerCase()) ||
      args.title.toLowerCase().includes(g.title.toLowerCase())
    );
    if (match) {
      await db.update(longTermGoals).set({ isActive: false }).where(eq(longTermGoals.id, match.id));
      return { success: true, message: `Removed long-term target: ${match.title}` };
    }
    return { success: false, message: `Long-term goal not found: ${args.title}` };
  }

  if (toolName === "remove_daily_goal") {
    if (args.title.toLowerCase().includes("make my bed")) return { success: false, message: "Make my bed cannot be removed." };
    // Search all templates (active or inactive) so partially-removed goals can still be cleaned up
    const allTemplates = await db.select().from(goalTemplates)
      .where(eq(goalTemplates.userId, userId));
    const match = allTemplates.find(t => t.title.toLowerCase().includes(args.title.toLowerCase()) || args.title.toLowerCase().includes(t.title.toLowerCase()));
    if (match) {
      if (args.specificDate) {
        // Remove only from this specific date's dailyGoals entry
        await db.delete(dailyGoals).where(and(
          eq(dailyGoals.userId, userId),
          eq(dailyGoals.goalTemplateId, match.id),
          eq(dailyGoals.date, args.specificDate),
        ));
        return { success: true, message: `Removed daily goal from ${args.specificDate}: ${match.title}` };
      } else {
        // Remove permanently — deactivate template and delete all rows
        await db.update(goalTemplates).set({ isActive: false }).where(eq(goalTemplates.id, match.id));
        await db.delete(dailyGoals).where(and(eq(dailyGoals.userId, userId), eq(dailyGoals.goalTemplateId, match.id)));
        return { success: true, message: `Removed daily goal: ${match.title}` };
      }
    }
    return { success: false, message: `Goal not found: ${args.title}` };
  }

  if (toolName === "add_habit") {
    const existingHabits = await db.select().from(habits).where(and(eq(habits.userId, userId), eq(habits.isArchived, false)));
    const alreadyExists = existingHabits.some(h => h.name.toLowerCase() === args.name.toLowerCase());
    if (alreadyExists) return { success: false, message: `Habit already exists: ${args.name}` };
    await db.insert(habits).values({ userId, name: args.name, emoji: args.emoji || "⭐", category: "general", isArchived: false });
    return { success: true, message: `Added habit: ${args.name}` };
  }

  if (toolName === "edit_habit") {
    const allHabits = await db.select().from(habits).where(and(eq(habits.userId, userId), eq(habits.isArchived, false)));
    const match = allHabits.find(h =>
      h.name.toLowerCase().includes(args.oldName.toLowerCase()) ||
      args.oldName.toLowerCase().includes(h.name.toLowerCase())
    );
    if (match) {
      await db.update(habits).set({
        name: args.newName,
        ...(args.emoji ? { emoji: args.emoji } : {}),
      }).where(eq(habits.id, match.id));
      return { success: true, message: `Updated habit: "${match.name}" → "${args.newName}"` };
    }
    return { success: false, message: `Habit not found: ${args.oldName}` };
  }

  if (toolName === "remove_habit") {
    const allHabits = await db.select().from(habits).where(and(eq(habits.userId, userId), eq(habits.isArchived, false)));
    const match = allHabits.find(h => h.name.toLowerCase().includes(args.name.toLowerCase()) || args.name.toLowerCase().includes(h.name.toLowerCase()));
    if (match) {
      await db.update(habits).set({ isArchived: true }).where(eq(habits.id, match.id));
      return { success: true, message: `Removed habit: ${match.name}` };
    }
    return { success: false, message: `Habit not found: ${args.name}` };
  }

  return { success: false, message: `Unknown tool: ${toolName}` };
}
