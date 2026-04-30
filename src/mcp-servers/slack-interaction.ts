import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { WebClient } from "@slack/web-api";
import { z } from "zod";
import { config } from "dotenv";
config();

const slack = new WebClient(process.env.SLACK_BOT_TOKEN!);
const ALLOWED_CHANNEL = process.env.ALLOWED_CHANNEL;
const ALLOWED_THREAD = process.env.ALLOWED_THREAD;
const MAX_REPLY_CHARS = 5000;

const server = new McpServer({ name: "slack-interaction", version: "1.0.0" });

server.tool(
  "post_message",
  "Post a message to a Slack channel thread. Use 'blocks' for rich Block Kit formatting; 'text' is used as notification fallback.",
  {
    channel: z.string(),
    thread_ts: z.string(),
    text: z.string().describe("Plain text fallback shown in notifications and screen readers"),
    blocks: z.string().optional().describe("JSON array of Slack Block Kit blocks for rich formatting"),
  },
  async ({ channel, thread_ts, text, blocks }) => {
    if (ALLOWED_CHANNEL && channel !== ALLOWED_CHANNEL) {
      return { content: [{ type: "text" as const, text: "Error: posting to this channel is not allowed." }] };
    }
    if (ALLOWED_THREAD && thread_ts !== ALLOWED_THREAD) {
      return { content: [{ type: "text" as const, text: "Error: posting to this thread is not allowed." }] };
    }
    let parsedBlocks;
    if (blocks) {
      try {
        parsedBlocks = JSON.parse(blocks);
      } catch {
        return { content: [{ type: "text" as const, text: "Error: invalid blocks JSON. Fix the JSON array and retry." }] };
      }
    }
    await slack.chat.postMessage({
      channel,
      thread_ts,
      text,
      ...(parsedBlocks ? { blocks: parsedBlocks } : {}),
    });
    return { content: [{ type: "text" as const, text: "Message posted." }] };
  }
);

server.tool(
  "wait_for_reply",
  "Wait for a human to reply in a Slack thread. Polls every 5 seconds up to 15 minutes.",
  {
    channel: z.string(),
    thread_ts: z.string(),
    after_ts: z.string().describe("Only return replies newer than this timestamp"),
  },
  async ({ channel, thread_ts, after_ts }) => {
    if (ALLOWED_CHANNEL && channel !== ALLOWED_CHANNEL) {
      return { content: [{ type: "text" as const, text: "Error: reading from this channel is not allowed." }] };
    }
    if (ALLOWED_THREAD && thread_ts !== ALLOWED_THREAD) {
      return { content: [{ type: "text" as const, text: "Error: reading from this thread is not allowed." }] };
    }
    const deadline = Date.now() + 15 * 60 * 1000;
    let lastTs = after_ts;

    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 5000));
      const result = await slack.conversations.replies({
        channel,
        ts: thread_ts,
        oldest: lastTs,
        limit: 10,
      });
      const messages = result.messages ?? [];
      const humanReplies = messages.filter(
        (m) => m.ts !== thread_ts && !m.bot_id && (m.ts ?? "0") > lastTs
      );
      if (humanReplies.length > 0) {
        let replyText = humanReplies.map((m) => m.text ?? "").join("\n");
        if (replyText.length > MAX_REPLY_CHARS) {
          replyText = replyText.slice(0, MAX_REPLY_CHARS) + `\n\n[... truncated, reply was ${replyText.length} chars ...]`;
        }
        return {
          content: [{ type: "text" as const, text: replyText }],
        };
      }
      if (messages.length > 0) {
        lastTs = messages[messages.length - 1].ts ?? lastTs;
      }
    }

    return {
      content: [{ type: "text" as const, text: "TIMEOUT: No reply received within 15 minutes." }],
    };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
