import { config } from "dotenv";
config();

function require(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

export const env = {
  ANTHROPIC_API_KEY: require("ANTHROPIC_API_KEY"),
  SLACK_BOT_TOKEN: require("SLACK_BOT_TOKEN"),
  SLACK_SIGNING_SECRET: require("SLACK_SIGNING_SECRET"),
  GOOGLE_CLIENT_ID: require("GOOGLE_CLIENT_ID"),
  GOOGLE_CLIENT_SECRET: require("GOOGLE_CLIENT_SECRET"),
  GOOGLE_REFRESH_TOKEN: require("GOOGLE_REFRESH_TOKEN"),
  GDRIVE_TEMPLATE_ID: require("GDRIVE_TEMPLATE_ID"),
  GDRIVE_ROOT_FOLDER_ID: require("GDRIVE_ROOT_FOLDER_ID"),
  GSHEETS_TEMPLATE_ID: require("GSHEETS_TEMPLATE_ID"),
  PINECONE_API_KEY: require("PINECONE_API_KEY"),
  PINECONE_INDEX: process.env.PINECONE_INDEX ?? "estimations",
  VOYAGE_API_KEY: require("VOYAGE_API_KEY"),
  SLACK_OPS_CHANNEL_ID: process.env.SLACK_OPS_CHANNEL_ID,
  PORT: parseInt(process.env.PORT ?? "3000"),
  NODE_ENV: process.env.NODE_ENV ?? "development",
};
