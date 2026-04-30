import { WebClient } from "@slack/web-api";
import { env } from "./env.js";
import { logger } from "./logger.js";

export async function alertOps(
  message: string,
  data?: Record<string, unknown>,
) {
  const channelId = env.SLACK_OPS_CHANNEL_ID;
  if (!channelId) {
    logger.warn("alertOps: SLACK_OPS_CHANNEL_ID not set, logging only", { message, ...data });
    return;
  }

  try {
    const client = new WebClient(env.SLACK_BOT_TOKEN);
    const text = data
      ? `${message}\n\`\`\`${JSON.stringify(data, null, 2)}\`\`\``
      : message;
    await client.chat.postMessage({ channel: channelId, text });
  } catch (err) {
    logger.error("alertOps: failed to post to ops channel", {
      error: err instanceof Error ? err.message : String(err),
      message,
      ...data,
    });
  }
}
