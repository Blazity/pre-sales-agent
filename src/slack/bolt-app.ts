// @slack/bolt is CommonJS — use createRequire to load it in an ESM context
import { createRequire } from "module";
const _require = createRequire(import.meta.url);
const { App, ExpressReceiver, LogLevel } = _require("@slack/bolt") as typeof import("@slack/bolt");
import { WebClient } from "@slack/web-api";

import { env } from "../lib/env.js";
import { enqueueEstimation } from "../queue/producer.js";
import { logger } from "../lib/logger.js";
import { extractAllDriveLinks } from "../lib/google-drive.js";

/**
 * Validate the bot token by calling auth.test().  Returns the bot identity on
 * success, or null on failure with a clear deployment log message.
 */
export async function validateSlackToken(): Promise<{
  botId: string;
  botUserId: string;
  teamId: string;
} | null> {
  try {
    const client = new WebClient(env.SLACK_BOT_TOKEN);
    const result = await client.auth.test();
    logger.info("Slack auth.test succeeded", {
      botId: result.bot_id,
      botUserId: result.user_id,
      team: result.team,
      teamId: result.team_id,
    });
    return {
      botId: result.bot_id!,
      botUserId: result.user_id!,
      teamId: result.team_id!,
    };
  } catch (err) {
    logger.error("Slack auth.test FAILED — bot cannot process events", {
      error: String(err),
      hint: "Check that SLACK_BOT_TOKEN is a valid xoxb-... token from your Slack app's OAuth page",
    });
    return null;
  }
}

export function createSlackApp() {
  const receiver = new ExpressReceiver({
    signingSecret: env.SLACK_SIGNING_SECRET,
    endpoints: "/events",
  });

  const app = new App({
    token: env.SLACK_BOT_TOKEN,
    receiver,
    logLevel: env.NODE_ENV === "development" ? LogLevel.DEBUG : LogLevel.INFO,
  });

  // ─── Global middleware: log every incoming event for diagnostics ─────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.use(async (args: any) => {
    const body = args.body;
    const event = body?.event;
    logger.info("Bolt event received", {
      bodyType: body?.type,
      eventType: event?.type,
      eventSubtype: event?.subtype,
      eventText: typeof event?.text === "string" ? event.text.slice(0, 100) : undefined,
      eventUser: event?.user,
      eventBotId: event?.bot_id,
      channel: event?.channel,
    });
    await args.next();
  });

  // ─── Trigger: !estimate <rfp text> ──────────────────────────────────────────
  app.message(/^!estimate/i, async ({ message, say }) => {
    const skipSubtypes = new Set(["bot_message", "message_changed", "message_deleted", "channel_join", "channel_leave"]);
    if (message.subtype && skipSubtypes.has(message.subtype)) return;

    const msg = message as {
      text: string;
      ts: string;
      channel: string;
      user: string;
      files?: Array<{ id: string; name: string; mimetype: string; url_private_download: string; size: number }>;
    };

    const rawText = msg.text.replace(/^!estimate\s*/i, "").trim();

    if (!rawText && (!msg.files || msg.files.length === 0)) {
      await say({
        text: "Please provide RFP details after `!estimate` — paste text, attach a PDF, or share a Google Doc link.",
        thread_ts: msg.ts,
      });
      return;
    }

    await say({
      text: "RFP received! Starting the estimation workflow...",
      blocks: [
        { type: "header", text: { type: "plain_text", text: "📋 RFP Received" } },
        { type: "section", text: { type: "mrkdwn", text: "Starting the estimation workflow. I'll post updates in this thread:" } },
        { type: "section", text: { type: "mrkdwn", text: "1️⃣ RFP Analysis\n2️⃣ Clarifying Questions _(if needed)_\n3️⃣ Google Docs Offer\n4️⃣ Google Slides Presentation" } },
      ],
      thread_ts: msg.ts,
    });

    const slackFiles = (msg.files ?? []).map((f) => ({
      id: f.id,
      name: f.name,
      mimetype: f.mimetype,
      url_private_download: f.url_private_download,
      size: f.size,
    }));

    const hasFiles = slackFiles.length > 0;
    const driveLinks = extractAllDriveLinks(msg.text);
    const hasDriveLinks = driveLinks.length > 0;

    let jobPayload: Parameters<typeof enqueueEstimation>[0];

    if (hasFiles || hasDriveLinks) {
      const hasFolderLink = driveLinks.some((l) => l.type === "folder");
      if (hasFolderLink) {
        await say({
          text: "Found a Google Drive folder link. Scanning files...",
          blocks: [
            { type: "context", elements: [{ type: "mrkdwn", text: "📂 Found a Google Drive folder link. Scanning and copying files..." }] },
          ],
          thread_ts: msg.ts,
        });
      }

      const { ingestEstimationFiles } = await import("../lib/file-ingestion.js");
      const tempJobId = `est_${Date.now()}`;

      try {
        const result = await ingestEstimationFiles({
          messageText: msg.text,
          slackFiles,
          jobId: tempJobId,
        });

        jobPayload = {
          channelId: msg.channel,
          threadTs: msg.ts,
          inputFolderId: result.inputFolderId,
          outputFolderId: result.outputFolderId,
          estimationFolderId: result.estimationFolderId,
          messageText: result.messageText,
          rfpText: result.extractedRfpText || undefined,
          fileManifest: result.fileManifest,
        };

        const extractNote = result.extractedRfpText
          ? ` Extracted ${Math.round(result.extractedRfpText.length / 1000)}k chars of RFP text.`
          : "";
        await say({
          text: `Uploaded ${result.filesUploaded} file(s) to Google Drive.${extractNote} Analyzing...`,
          blocks: [
            { type: "context", elements: [{ type: "mrkdwn", text: `📎 Uploaded *${result.filesUploaded} file(s)* to Google Drive.${extractNote} Analyzing...` }] },
          ],
          thread_ts: msg.ts,
        });

        if (result.fileManifest && result.fileManifest.files.length > 0) {
          const typeCounts = new Map<string, number>();
          for (const f of result.fileManifest.files) {
            typeCounts.set(f.type, (typeCounts.get(f.type) ?? 0) + 1);
          }
          const summary = Array.from(typeCounts.entries())
            .map(([type, count]) => `${count} ${type}(s)`)
            .join(", ");
          await say({
            text: `Found ${result.fileManifest.files.length} files in Drive folder: ${summary}`,
            blocks: [
              { type: "context", elements: [{ type: "mrkdwn", text: `📂 Found *${result.fileManifest.files.length} files* in Drive folder: ${summary}` }] },
            ],
            thread_ts: msg.ts,
          });
        }

        if (result.failedFiles.length > 0) {
          const total = result.filesUploaded + result.failedFiles.length;
          await say({
            text: `\u26a0\ufe0f ${result.failedFiles.length} of ${total} files could not be processed. Proceeding with available content.`,
            thread_ts: msg.ts,
          });
        }
      } catch (err) {
        const errMsg = String(err);
        if (errMsg.includes("403") || errMsg.includes("forbidden") || errMsg.includes("not found")) {
          await say({
            text: "I can't access that Google Drive folder. Please share it with the bot's Google account and try again.",
            blocks: [
              { type: "section", text: { type: "mrkdwn", text: "⚠️ I can't access that Google Drive link. Please make sure:\n• The folder/file is shared with the bot's Google account\n• Or set the sharing to \"Anyone with the link\"" } },
            ],
            thread_ts: msg.ts,
          });
          return;
        }
        logger.error("File ingestion failed, falling back to text-only", { error: errMsg });
        jobPayload = {
          rfpText: rawText,
          channelId: msg.channel,
          threadTs: msg.ts,
        };
      }
    } else {
      if (rawText.length < 20) {
        await say({
          text: "Please provide more RFP details. Minimum 20 characters, or attach a PDF / Google Doc link.",
          thread_ts: msg.ts,
        });
        return;
      }
      jobPayload = {
        rfpText: rawText,
        channelId: msg.channel,
        threadTs: msg.ts,
      };
    }

    const jobId = await enqueueEstimation(jobPayload);

    logger.info("Estimation job enqueued", {
      jobId,
      user: msg.user,
      channel: msg.channel,
      hasFiles,
      hasDriveLinks,
      driveLinksCount: driveLinks.length,
      rfpLength: rawText.length,
    });
  });

  // ─── Slash command: /estimate ────────────────────────────────────────────────
  app.command("/estimate", async ({ command, ack, respond }) => {
    await ack();

    const rfpText = command.text.trim();

    if (!rfpText || rfpText.length < 20) {
      await respond({
        text: "⚠️ Please provide RFP details. Usage: `/estimate <project description>`",
        response_type: "ephemeral",
      });
      return;
    }

    await respond({
      text: "Estimation workflow started! Check this channel for updates in a thread.",
      response_type: "in_channel",
      blocks: [
        { type: "section", text: { type: "mrkdwn", text: "📋 *Estimation workflow started!* Check this channel for updates in a thread." } },
      ],
    });

    const posted = await app.client.chat.postMessage({
      channel: command.channel_id,
      text: `New Estimation Request from <@${command.user_id}>`,
      blocks: [
        { type: "header", text: { type: "plain_text", text: "📋 New Estimation Request" } },
        { type: "section", text: { type: "mrkdwn", text: `From <@${command.user_id}>` } },
        { type: "section", text: { type: "mrkdwn", text: `>${rfpText.slice(0, 300)}${rfpText.length > 300 ? "..." : ""}` } },
      ],
    });

    const jobId = await enqueueEstimation({
      rfpText,
      channelId: command.channel_id,
      threadTs: posted.ts!,
    });

    logger.info("Estimation job enqueued via slash command", {
      jobId,
      user: command.user_id,
      channel: command.channel_id,
      rfpLength: rfpText.length,
    });
  });

  // ─── Error handler ───────────────────────────────────────────────────────────
  app.error(async (error) => {
    logger.error("Slack app error", { error: String(error) });
  });

  return { app, receiver };
}
