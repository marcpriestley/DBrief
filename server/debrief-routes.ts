import type { Express, Request, Response } from "express";
import OpenAI from "openai";
import { db } from "./db";
import { debriefs, debriefMessages, dailyScores, journalEntries, moodCheckins, dailyGoals, userMetrics, users, infiniteGoals, longTermGoals, goalTemplates, habits, habitLogs } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { encrypt, decrypt } from "./encryption";

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

async function gatherDayContext(userId: number, date: string) {
  const [scores, metrics, goals, moods, entries, infiniteGoalRows, ltGoals, userHabits, todayHabitLogs] = await Promise.all([
    db.select().from(dailyScores).where(and(eq(dailyScores.userId, userId), eq(dailyScores.date, date))),
    db.select().from(userMetrics).where(and(eq(userMetrics.userId, userId), eq(userMetrics.isActive, true))),
    db.select().from(dailyGoals).where(and(eq(dailyGoals.userId, userId), eq(dailyGoals.date, date))),
    db.select().from(moodCheckins).where(and(eq(moodCheckins.userId, userId), eq(moodCheckins.date, date))),
    db.select().from(journalEntries).where(and(eq(journalEntries.userId, userId), eq(journalEntries.date, date))),
    db.select().from(infiniteGoals).where(eq(infiniteGoals.userId, userId)).limit(1),
    db.select().from(longTermGoals).where(and(eq(longTermGoals.userId, userId), eq(longTermGoals.isActive, true))),
    db.select().from(habits).where(and(eq(habits.userId, userId), eq(habits.isArchived, false))),
    db.select().from(habitLogs).where(and(eq(habitLogs.userId, userId), eq(habitLogs.date, date))),
  ]);

  // Exclude zero scores — a value of 0 almost always means the user didn't log that
  // metric, not that they deliberately scored it as a zero. Treat missing data as absent.
  const loggedScores = scores.filter(s => s.value > 0);
  const scoreMap = loggedScores.length > 0
    ? loggedScores.map(s => `${s.metricName}: ${s.value}/100`).join(", ")
    : "";
  const goalSummary = goals.length > 0
    ? `Daily goals: ${goals.filter(g => g.completed).length}/${goals.length} completed (${goals.map(g => `${g.title}: ${g.completed ? "done" : "not done"}`).join(", ")})`
    : "No daily goals set today";
  const moodAvg = moods.length > 0
    ? `Mood: ${Math.round(moods.reduce((a, m) => a + m.value, 0) / moods.length)}/100 (${moods.length} check-in${moods.length > 1 ? "s" : ""})`
    : "No mood check-ins yet";
  const journalContent = entries.length > 0 ? decrypt(entries[0].content) : "";
  const infiniteGoalContent = infiniteGoalRows.length > 0 ? decrypt(infiniteGoalRows[0].content) : null;
  const longTermGoalsList = ltGoals.map(g => decrypt(g.title));

  const debriefDate = new Date(date + "T12:00:00");
  const dayOfWeek = debriefDate.getDay();
  const isWeeklyAlignmentDay = dayOfWeek === 0;

  // Habit context
  const completedHabitIds = new Set(todayHabitLogs.map(l => l.habitId));
  const habitSummaryParts = userHabits.map(h => {
    const done = completedHabitIds.has(h.id);
    const streak = h.currentStreak || 0;
    return `${h.emoji} ${h.name} (${done ? "done today" : "not yet today"}, ${streak}-day streak)`;
  });
  const habitSummary = habitSummaryParts.length > 0
    ? `Habits in progress: ${habitSummaryParts.join("; ")}`
    : "";

  return {
    scoreMap, goalSummary, moodAvg, journalContent,
    hasScores: loggedScores.length > 0, hasGoals: goals.length > 0, hasMoods: moods.length > 0,
    infiniteGoalContent, longTermGoalsList, isWeeklyAlignmentDay, habitSummary,
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

  // Behavioural questionnaire
  for (const [key, answer] of Object.entries(profile)) {
    if (labels[key]?.[answer]) parts.push(labels[key][answer]);
  }

  const summary = parts.length > 0
    ? `\nDRIVER PROFILE (adapt your style accordingly):\n${parts.map(p => `• ${p}`).join("\n")}`
    : "";

  return { summary, isBirthday: birthday };
}

function buildSystemPrompt(context: Awaited<ReturnType<typeof gatherDayContext>>, date: string, userMessageCount: number, journalPreference: string = "evening", userProfile?: Record<string, string> | null, displayName?: string | null) {
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

  const phase = userMessageCount < 3 ? "core" : "extended";

  // Determine timing context from the ACTUAL date being debriefed, not from journalPreference.
  // journalPreference only affects smart default tab — not whether the AI says "today" or "yesterday".
  let timingContext: string;
  if (isToday) {
    const timeOfDay = currentHour < 12 ? "morning" : currentHour < 17 ? "afternoon" : "evening";
    const dayStillOpen = currentHour < 20;
    timingContext = `This is TODAY's debrief — current time is ${timeOfDay} (hour ${currentHour}).
${dayStillOpen
  ? `IMPORTANT: The day is still in progress. For any daily goals not yet marked complete, treat them as still achievable — do NOT ask why they weren't done or imply failure. Note what's been done and encourage completing the remaining goals before end of day. Phrase open goals as in-progress, not missed.`
  : `It is late in the day — remaining open goals are unlikely to be completed today. You can analyse them as session outcomes.`}`;
  } else if (isYesterday) {
    timingContext = `This is a debrief for YESTERDAY — a completed session. Frame it as a post-race review. Treat all uncompleted goals as session outcomes to reflect on and learn from.`;
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

  const { summary: profileSection, isBirthday } = buildUserProfileSummary(userProfile, date);
  const driverName = displayName ? ` The driver's name is ${displayName} — use their name naturally in conversation, not every message, but enough that it feels personal.` : "";
  const birthdayNote = isBirthday
    ? `\n\nSPECIAL — TODAY IS THE DRIVER'S BIRTHDAY. Acknowledge this naturally and warmly at the start of the debrief — something brief, genuine and in-character (e.g. "Happy birthday by the way — another lap around the sun."). Don't overdo it, just make it feel human.`
    : "";

  return `You are the user's performance engineer — like an F1 race engineer debriefing their driver after a session.${driverName} Sharp, perceptive, and genuinely invested in helping them perform better. No therapy speak, no corporate nonsense, no cheerleading. Just honest analysis of the day's telemetry and whatever they bring to the conversation.${profileSection}${birthdayNote}

TIMING:
${timingContext}

TELEMETRY (only shown if the user explicitly logged it — missing metric = no data, NOT a zero. Never reference or penalise a metric that isn't listed):
${context.hasScores ? `Performance scores: ${context.scoreMap}` : "No scores logged — don't mention scores."}
${context.goalSummary}
${context.moodAvg}
${context.journalContent ? `Session notes: "${context.journalContent}"` : ""}${infiniteGoalSection}${ltGoalsSection}${habitsSection}

CONVERSATION STRUCTURE:
Exchange ${userMessageCount + 1} of the session. User has replied ${userMessageCount} time(s).
${phase === "core" ? `
- CORE phase (exchanges 1-3). One question per response — no exceptions.
- Exchange 1: Read the telemetry and read the room. Strong day? Say so clearly. Rough one? Acknowledge it first, analyse second. Then ask how the session felt overall.
- Exchange 2: Follow the thread they opened. Dig into whatever matters most from what they said — don't jump to new topics yet.
- Exchange 3: Last core question. Connect the dots, find the pattern, surface something they might have missed. After their answer, the app offers the option to go deeper.
` : `
- EXTENDED phase — they chose to keep going. Continue naturally, one question at a time.
- Find new angles or dig deeper into earlier threads. Every response should add something.
- Every 3 extended exchanges, weave in a check on their long-term targets if any are set.
`}

TONE AND STYLE — THIS IS CRITICAL:
- Write like you're texting a highly motivated friend who trusts your judgment — direct, warm, a little punchy. NOT like a report or a consultation.
- Use contractions freely (it's, you've, that's, didn't, wasn't).
- React like a human: if something they said surprised you, say so. If it impressed you, let that come through. If it concerns you, be honest.
- Never start a response with "Great", "That's great", "Good", "It sounds like", "I can see", or "I understand".
- No bullet points. No numbered lists. No emojis. Write in plain, natural sentences.
- 2-3 sentences max. Shorter is almost always better. Cut everything that isn't essential.
- Strong sessions deserve real recognition — don't manufacture problems. Tough sessions deserve honesty — don't paper over them.
- Ask ONE question and stop. Never stack questions.
- Do NOT say "would you like to continue?" or offer to wrap up — the app handles that.`;
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

      res.json(result);
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
      // fresh=true OR no active debrief found — always create a new one, never delete old ones

      const [debrief] = await db.insert(debriefs).values({
        userId,
        date,
        isComplete: false,
      }).returning();

      // User-led mode: skip the AI opening prompt — user types first
      if (userLed) {
        return res.json({ ...debrief, messages: [] });
      }

      const context = await gatherDayContext(userId, date);
      const [user] = await db.select().from(users).where(eq(users.id, userId));
      const systemPrompt = buildSystemPrompt(context, date, 0, user?.journalPreference || "evening", user?.userProfile, user?.displayName);

      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: "Start the debrief." },
        ],
        max_tokens: 300,
      });

      const openingMessage = response.choices[0].message.content || "How was your day?";

      const [msg] = await db.insert(debriefMessages).values({
        debriefId: debrief.id,
        role: "assistant",
        content: encrypt(openingMessage),
      }).returning();

      res.json({ ...debrief, messages: [{ ...msg, content: openingMessage }] });
    } catch (error) {
      console.error("Error starting debrief:", error);
      res.status(500).json({ error: "Failed to start debrief" });
    }
  });

  app.post("/api/debriefs/:debriefId/respond", async (req: Request, res: Response) => {
    const userId = requireAuth(req, res);
    if (!userId) return;

    try {
      const debriefId = parseInt(req.params.debriefId);
      const { content } = req.body;

      const [debrief] = await db.select().from(debriefs)
        .where(and(eq(debriefs.id, debriefId), eq(debriefs.userId, userId)));

      if (!debrief) {
        return res.status(404).json({ error: "Debrief not found" });
      }

      await db.insert(debriefMessages).values({
        debriefId,
        role: "user",
        content: encrypt(content),
      });

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
            description: "Add a new recurring daily goal/habit for the user. Use when the user mentions wanting to build a habit, do something every day, or add a routine. Only call this if the user clearly wants this goal added.",
            parameters: {
              type: "object",
              properties: {
                title: { type: "string", description: "Short, actionable goal title (e.g. '10 min meditation', 'Cold shower', 'Read 20 pages')" },
              },
              required: ["title"],
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
            const existing = await db.select().from(goalTemplates)
              .where(and(eq(goalTemplates.userId, userId), eq(goalTemplates.isActive, true)));
            const alreadyExists = existing.some(g => g.title.toLowerCase() === params.title.toLowerCase());
            if (!alreadyExists) {
              await db.insert(goalTemplates).values({
                userId,
                title: params.title,
                recurring: true,
                isActive: true,
                sortOrder: existing.length,
              });
              actions.push({ type: "add_daily_goal", params, success: true, message: `Added daily goal: ${params.title}` });
            } else {
              actions.push({ type: "add_daily_goal", params, success: false, message: `Goal already exists: ${params.title}` });
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
          }
        } catch (e) {
          console.error("Tool call failed:", tc.name, e);
        }
      }

      if (actions.length > 0) {
        res.write(`data: ${JSON.stringify({ actions })}\n\n`);
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
