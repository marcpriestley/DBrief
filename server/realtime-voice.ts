import WebSocket, { WebSocketServer } from "ws";
import type { Server as HttpServer } from "http";
import { sessionMiddleware } from "./session";
import { storage } from "./storage";
import { db } from "./db";
import { debriefs, debriefMessages } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { encrypt } from "./encryption";
import { gatherDayContext, buildSystemPrompt, REALTIME_TOOLS, executeDebriefTool } from "./debrief-routes";
import { log } from "./vite";

const OPENAI_REALTIME_WS = "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17";

export function registerRealtimeVoiceWS(httpServer: HttpServer) {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (request, socket, head) => {
    if (!request.url?.startsWith("/api/realtime/voice")) return;

    // Apply express-session so we can read req.session.userId
    const fakeRes: any = {
      getHeader: () => {},
      setHeader: () => {},
      end: () => {},
    };
    sessionMiddleware(request as any, fakeRes, () => {
      wss.handleUpgrade(request, socket as any, head, (ws) => {
        wss.emit("connection", ws, request);
      });
    });
  });

  wss.on("connection", async (clientWs, req: any) => {
    const userId: number | undefined = (req as any).session?.userId;
    if (!userId) {
      clientWs.send(JSON.stringify({ type: "error", message: "Unauthorized" }));
      clientWs.close(1008, "Unauthorized");
      return;
    }

    const url = new URL(req.url!, "http://localhost");
    const date = url.searchParams.get("date") || new Date().toLocaleDateString("en-CA");
    const debriefIdParam = url.searchParams.get("debriefId");
    const debriefId = debriefIdParam ? parseInt(debriefIdParam, 10) : null;

    // Load user
    const user = await storage.getUser(userId);
    if (!user) {
      clientWs.close(1008, "User not found");
      return;
    }

    // Build system prompt with full day context
    let systemPrompt: string;
    try {
      const context = await gatherDayContext(userId, date);
      systemPrompt = buildSystemPrompt(
        context,
        date,
        0,
        user.journalPreference || "evening",
        user.userProfile as Record<string, string> | null,
        user.displayName,
      );
      // Voice mode addendum — keep responses short since they're spoken
      systemPrompt += `\n\nVOICE MODE: This is a live voice conversation. Keep all responses to 1-3 sentences maximum — spoken words, not written. Never use lists, bullet points, or formatting. Speak naturally and conversationally.`;
    } catch (err) {
      clientWs.send(JSON.stringify({ type: "error", message: "Failed to build context" }));
      clientWs.close();
      return;
    }

    const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
    if (!apiKey) {
      clientWs.send(JSON.stringify({ type: "error", message: "AI not configured" }));
      clientWs.close();
      return;
    }

    // Open WebSocket to OpenAI Realtime API
    const openAiWs = new WebSocket(OPENAI_REALTIME_WS, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "OpenAI-Beta": "realtime=v1",
      },
    });

    const pendingCalls = new Map<string, { name: string; args: string }>();
    let sessionReady = false;

    openAiWs.on("open", () => {
      // Configure the session
      openAiWs.send(JSON.stringify({
        type: "session.update",
        session: {
          modalities: ["text", "audio"],
          instructions: systemPrompt,
          voice: "alloy",
          input_audio_format: "pcm16",
          output_audio_format: "pcm16",
          input_audio_transcription: { model: "whisper-1" },
          turn_detection: {
            type: "server_vad",
            threshold: 0.5,
            prefix_padding_ms: 300,
            silence_duration_ms: 600,
          },
          tools: REALTIME_TOOLS,
          tool_choice: "auto",
        },
      }));

      // Trigger the AI to open with a greeting
      openAiWs.send(JSON.stringify({
        type: "response.create",
        response: {
          modalities: ["text", "audio"],
          instructions: "Open the debrief now — 1-2 sentences only. Read the telemetry, set the tone, ask ONE sharp question.",
        },
      }));

      sessionReady = true;
      clientWs.send(JSON.stringify({ type: "session.ready" }));
      log("[Realtime] Session connected for user " + userId);
    });

    openAiWs.on("message", async (raw) => {
      try {
        const event = JSON.parse(raw.toString());

        switch (event.type) {
          case "response.audio.delta":
            clientWs.send(JSON.stringify({ type: "audio.delta", audio: event.delta }));
            break;

          case "response.audio.done":
            clientWs.send(JSON.stringify({ type: "audio.done" }));
            break;

          case "response.audio_transcript.done":
            if (debriefId && event.transcript?.trim()) {
              try {
                await db.insert(debriefMessages).values({
                  debriefId,
                  role: "assistant",
                  content: encrypt(event.transcript.trim()),
                });
              } catch {}
            }
            clientWs.send(JSON.stringify({ type: "transcript.ai", text: event.transcript }));
            break;

          case "conversation.item.input_audio_transcription.completed":
            if (debriefId && event.transcript?.trim()) {
              try {
                await db.insert(debriefMessages).values({
                  debriefId,
                  role: "user",
                  content: encrypt(event.transcript.trim()),
                });
              } catch {}
            }
            clientWs.send(JSON.stringify({ type: "transcript.user", text: event.transcript }));
            break;

          case "response.output_item.added":
            if (event.item?.type === "function_call") {
              pendingCalls.set(event.item.call_id, { name: event.item.name, args: "" });
            }
            break;

          case "response.function_call_arguments.delta":
            if (pendingCalls.has(event.call_id)) {
              pendingCalls.get(event.call_id)!.args += event.delta;
            }
            break;

          case "response.function_call_arguments.done": {
            const fc = pendingCalls.get(event.call_id);
            if (!fc) break;
            pendingCalls.delete(event.call_id);
            let result: object = { success: false, error: "Execution failed" };
            try {
              const args = JSON.parse(event.arguments || "{}");
              result = await executeDebriefTool(fc.name, args, userId, date);
            } catch (e) {
              result = { success: false, error: String(e) };
            }
            // Return result to OpenAI and trigger next response
            openAiWs.send(JSON.stringify({
              type: "conversation.item.create",
              item: { type: "function_call_output", call_id: event.call_id, output: JSON.stringify(result) },
            }));
            openAiWs.send(JSON.stringify({ type: "response.create" }));
            // Tell client to refresh data
            clientWs.send(JSON.stringify({ type: "tool.executed", tool: fc.name }));
            break;
          }

          case "input_audio_buffer.speech_started":
            clientWs.send(JSON.stringify({ type: "user.speaking" }));
            break;

          case "input_audio_buffer.speech_stopped":
            clientWs.send(JSON.stringify({ type: "user.silent" }));
            break;

          case "response.created":
          case "response.output_item.added":
            clientWs.send(JSON.stringify({ type: "ai.responding" }));
            break;

          case "response.done":
            clientWs.send(JSON.stringify({ type: "ai.done" }));
            break;

          case "error":
            log("[Realtime] OpenAI error: " + JSON.stringify(event.error));
            clientWs.send(JSON.stringify({ type: "error", message: event.error?.message || "AI error" }));
            break;

          default:
            break;
        }
      } catch {}
    });

    // Forward audio from client → OpenAI
    clientWs.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (!sessionReady || openAiWs.readyState !== WebSocket.OPEN) return;
        if (msg.type === "audio.append") {
          openAiWs.send(JSON.stringify({ type: "input_audio_buffer.append", audio: msg.audio }));
        } else if (msg.type === "interrupt") {
          // Client requesting AI to stop — send cancel
          openAiWs.send(JSON.stringify({ type: "response.cancel" }));
        }
      } catch {}
    });

    // Cleanup
    const cleanup = () => {
      if (openAiWs.readyState === WebSocket.OPEN || openAiWs.readyState === WebSocket.CONNECTING) {
        openAiWs.close();
      }
      log("[Realtime] Session closed for user " + userId);
    };
    clientWs.on("close", cleanup);
    openAiWs.on("close", () => {
      if (clientWs.readyState === WebSocket.OPEN) clientWs.close();
    });
    openAiWs.on("error", (err) => {
      log("[Realtime] WS error: " + err.message);
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify({ type: "error", message: "Connection error" }));
        clientWs.close();
      }
    });
  });
}
