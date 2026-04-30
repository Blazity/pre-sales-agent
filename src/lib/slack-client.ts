import { WebClient } from "@slack/web-api";
import { env } from "./env.js";

export const slackWeb = new WebClient(env.SLACK_BOT_TOKEN);

export async function postToThread(
  channel: string,
  threadTs: string,
  text: string,
  blocks?: unknown[]
): Promise<void> {
  await slackWeb.chat.postMessage({
    channel,
    thread_ts: threadTs,
    text,
    ...(blocks ? { blocks } : {}),
  });
}

export async function waitForThreadReply(
  channel: string,
  threadTs: string,
  timeoutMs = 30 * 60 * 1000 // 30 minutes
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  const pollInterval = 5000;

  // Track the last message we saw so we only return NEW replies
  let lastTs = threadTs;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollInterval));

    const result = await slackWeb.conversations.replies({
      channel,
      ts: threadTs,
      oldest: lastTs,
      limit: 10,
    });

    const messages = result.messages ?? [];
    // Skip the first message if it's the original (same ts as threadTs)
    const replies = messages.filter(
      (m) => m.ts !== threadTs && (m.ts ?? "0") > lastTs && !m.bot_id
    );

    if (replies.length > 0) {
      // Combine all new human replies
      return replies.map((m) => m.text ?? "").join("\n");
    }

    if (messages.length > 0) {
      lastTs = messages[messages.length - 1].ts ?? lastTs;
    }
  }

  throw new Error("Timed out waiting for Slack reply");
}
