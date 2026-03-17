import type { Express, Request, Response } from "express";
import OpenAI from "openai";
import { db } from "./db";
import { debriefs, debriefMessages, dailyScores, journalEntries, moodCheckins, dailyGoals, userMetrics, users } from "@shared/schema";
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
  const [scores, metrics, goals, moods, entries] = await Promise.all([
    db.select().from(dailyScores).where(and(eq(dailyScores.userId, userId), eq(dailyScores.date, date))),
    db.select().from(userMetrics).where(and(eq(userMetrics.userId, userId), eq(userMetrics.isActive, true))),
    db.select().from(dailyGoals).where(and(eq(dailyGoals.userId, userId), eq(dailyGoals.date, date))),
    db.select().from(moodCheckins).where(and(eq(moodCheckins.userId, userId), eq(moodCheckins.date, date))),
    db.select().from(journalEntries).where(and(eq(journalEntries.userId, userId), eq(journalEntries.date, date))),
  ]);

  const scoreMap = scores.map(s => `${s.metricName}: ${s.value}/100`).join(", ");
  const goalSummary = goals.length > 0
    ? `Goals: ${goals.filter(g => g.completed).length}/${goals.length} completed (${goals.map(g => `${g.title}: ${g.completed ? "done" : "not done"}`).join(", ")})`
    : "No goals set today";
  const moodAvg = moods.length > 0
    ? `Mood: ${Math.round(moods.reduce((a, m) => a + m.value, 0) / moods.length)}/100 (${moods.length} check-in${moods.length > 1 ? "s" : ""})`
    : "No mood check-ins yet";
  const journalContent = entries.length > 0 ? decrypt(entries[0].content) : "";

  return { scoreMap, goalSummary, moodAvg, journalContent, hasScores: scores.length > 0, hasGoals: goals.length > 0, hasMoods: moods.length > 0 };
}

function buildSystemPrompt(context: Awaited<ReturnType<typeof gatherDayContext>>, date: string, userMessageCount: number, journalPreference: string = "evening") {
  const today = new Date();
  const debriefDate = new Date(date + "T12:00:00");
  const isToday = date === `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const isMorning = journalPreference === "morning";

  const phase = userMessageCount < 3 ? "core" : "extended";

  const timingContext = isMorning
    ? "The user journals in the morning, reflecting on yesterday. Frame questions about 'yesterday' rather than 'today'."
    : "The user journals in the evening, reflecting on today while it's fresh.";

  return `You are the user's personal debrief engineer — think of yourself as a thoughtful race engineer reviewing the day's data with them. Your tone is warm, direct, and perceptive. No corporate speak. No cheesy metaphors. Just genuine, sharp observation.

ROLE: Guide a daily reflection conversation. Ask one focused question at a time. Listen carefully to their response and follow up meaningfully before moving on.

TIMING: ${timingContext}
${isToday ? "This is today's debrief." : `This is a retrospective debrief for ${debriefDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}.`}

AVAILABLE DATA:
${context.hasScores ? `Scores: ${context.scoreMap}` : "No scores logged yet."}
${context.goalSummary}
${context.moodAvg}
${context.journalContent ? `Earlier journal notes: "${context.journalContent}"` : ""}

CONVERSATION STRUCTURE:
This is exchange ${userMessageCount + 1}. The user has replied ${userMessageCount} time(s) so far.
${phase === "core" ? `
- You are in the CORE phase (exchanges 1-3). Ask one meaningful, focused question per response.
- Exchange 1: Start with something that acknowledges their data or asks how things went overall.
- Exchange 2: Go deeper on whatever thread they opened — follow up on what they said.
- Exchange 3: This is the LAST core question. Make it count — tie threads together, or explore something they haven't touched yet. After their answer, the app will ask if they want to continue.
` : `
- You are in the EXTENDED phase. The user chose to keep going, so continue the conversation naturally.
- Keep asking one question at a time. Go deeper, explore new angles, or follow up on earlier threads.
- Each response should feel worthwhile — don't pad or repeat.
`}

GUIDELINES:
- Ask ONE question at a time. Keep it conversational, not clinical.
- Reference specific data points when relevant (scores, goals, mood) but weave them in naturally.
- If they give short answers, gently probe deeper. If they're expressive, reflect back what you hear.
- Avoid: bullet points, numbered lists, emojis, motivational platitudes, F1 jargon.
- Keep responses concise — 1-3 sentences max per response.
- Do NOT say "would you like to continue?" or offer to wrap up — the app handles that UI.`;
}

export function registerDebriefRoutes(app: Express): void {
  app.get("/api/debriefs/:date", async (req: Request, res: Response) => {
    const userId = requireAuth(req, res);
    if (!userId) return;

    try {
      const { date } = req.params;
      const [debrief] = await db.select().from(debriefs)
        .where(and(eq(debriefs.userId, userId), eq(debriefs.date, date)));

      if (!debrief) {
        return res.json(null);
      }

      const msgs = await db.select().from(debriefMessages)
        .where(eq(debriefMessages.debriefId, debrief.id))
        .orderBy(debriefMessages.createdAt);

      const decryptedMsgs = msgs.map(m => ({ ...m, content: decrypt(m.content) }));
      const decryptedDebrief = { ...debrief, summary: debrief.summary ? decrypt(debrief.summary) : debrief.summary };
      res.json({ ...decryptedDebrief, messages: decryptedMsgs });
    } catch (error) {
      console.error("Error fetching debrief:", error);
      res.status(500).json({ error: "Failed to fetch debrief" });
    }
  });

  app.post("/api/debriefs/start", async (req: Request, res: Response) => {
    const userId = requireAuth(req, res);
    if (!userId) return;

    try {
      const { date, fresh } = req.body;

      const [existing] = await db.select().from(debriefs)
        .where(and(eq(debriefs.userId, userId), eq(debriefs.date, date)));

      if (existing && !fresh) {
        const msgs = await db.select().from(debriefMessages)
          .where(eq(debriefMessages.debriefId, existing.id))
          .orderBy(debriefMessages.createdAt);
        return res.json({ ...existing, messages: msgs });
      }

      if (existing && fresh) {
        await db.delete(debriefMessages).where(eq(debriefMessages.debriefId, existing.id));
        await db.delete(debriefs).where(eq(debriefs.id, existing.id));
      }

      const context = await gatherDayContext(userId, date);
      const [user] = await db.select().from(users).where(eq(users.id, userId));
      const systemPrompt = buildSystemPrompt(context, date, 0, user?.journalPreference || "evening");

      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: "Start the debrief." },
        ],
        max_tokens: 300,
      });

      const openingMessage = response.choices[0].message.content || "How was your day?";

      const [debrief] = await db.insert(debriefs).values({
        userId,
        date,
        isComplete: false,
      }).returning();

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
      const systemPrompt = buildSystemPrompt(context, debrief.date, userMessageCount, user?.journalPreference || "evening");

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

      const stream = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: chatMessages,
        stream: true,
        max_tokens: 300,
      });

      let fullResponse = "";

      for await (const chunk of stream) {
        const text = chunk.choices[0]?.delta?.content || "";
        if (text) {
          fullResponse += text;
          res.write(`data: ${JSON.stringify({ content: text })}\n\n`);
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
              content: "Summarize this daily debrief conversation in 2-3 concise sentences. Capture the key themes, feelings, and any notable insights. Write in third person about 'they/their day'.",
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
