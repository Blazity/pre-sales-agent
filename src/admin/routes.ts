import { Router, type Express } from "express";
import rateLimit from "express-rate-limit";
import { getRedis } from "../lib/redis.js";
import { cancelJob } from "../lib/job-registry.js";
import { ipAllowlist, basicAuth } from "./auth.js";
import { logger } from "../lib/logger.js";
import { runEstimationWorkflow } from "../agents/orchestrator.js";

interface JobProgress {
  step: string;
  stepName: string;
  status: string;
  startedAt: string;
  lastActivityAt: string;
  finishedAt?: string;
  turnsCompleted: string;
  channelId: string;
  threadTs: string;
  estimationName: string;
  costClaudeUsd?: string;
  costBraveUsd?: string;
  costTotalUsd?: string;
  inputTokens?: string;
  outputTokens?: string;
}

function duration(p: JobProgress): string {
  const end = p.status === "running" ? Date.now() : new Date(p.finishedAt || p.lastActivityAt).getTime();
  const ms = end - new Date(p.startedAt).getTime();
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ${secs % 60}s`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function statusBadge(status: string): string {
  const colors: Record<string, string> = {
    running: "#4CAF50",
    completed: "#2196F3",
    failed: "#f44336",
    cancelled: "#FF9800",
  };
  const color = colors[status] ?? "#999";
  return `<span style="background:${color};color:#fff;padding:2px 8px;border-radius:4px;font-size:12px">${status}</span>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const SHORT_MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function formatDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return `${SHORT_MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

function progressBar(step: number, total: number, status: string): string {
  const pct = status === "completed" ? 100 : Math.round((step / total) * 100);
  const color = status === "failed" ? "#f44336" : status === "cancelled" ? "#FF9800" : "#4CAF50";
  return `<div style="display:flex;align-items:center;gap:8px;min-width:180px">
    <div style="flex:1;height:6px;background:#333;border-radius:3px;overflow:hidden">
      <div style="width:${pct}%;height:100%;background:${color};border-radius:3px;transition:width .3s"></div>
    </div>
    <span style="color:#999;font-size:11px;white-space:nowrap">${pct}%</span>
  </div>`;
}

function formatCost(p: JobProgress): string {
  if (!p.costTotalUsd) return "—";
  const total = parseFloat(p.costTotalUsd);
  const claude = parseFloat(p.costClaudeUsd ?? "0");
  const brave = parseFloat(p.costBraveUsd ?? "0");
  return `<span title="Claude: $${claude.toFixed(2)} · Brave: $${brave.toFixed(2)}">$${total.toFixed(2)}</span>`;
}

function formatTokens(t?: string): string {
  if (!t) return "0";
  const n = parseInt(t);
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

const CSS = `
  body { background:#1a1a2e; color:#e0e0e0; font-family:"SF Mono",Monaco,monospace; margin:0; padding:20px; }
  h1 { color:#fff; font-size:20px; }
  h2 { color:#ccc; font-size:16px; margin-top:30px; }
  a { color:#64b5f6; }
  table { border-collapse:collapse; width:100%; margin-top:10px; }
  th, td { text-align:left; padding:8px 12px; border-bottom:1px solid #333; }
  th { color:#999; font-size:12px; text-transform:uppercase; }
  .kill-btn { background:#f44336; color:#fff; border:none; padding:4px 12px; border-radius:4px; cursor:pointer; font-size:12px; }
  .kill-btn:hover { background:#d32f2f; }
  pre { background:#111; padding:16px; border-radius:8px; overflow-x:auto; font-size:13px; line-height:1.5; }
  .log-system { color:#b0bec5; }
  .log-agent_text { color:#e0e0e0; }
  .log-tool_call { color:#4dd0e1; }
  .log-tool_result { color:#81c784; }
  .log-error { color:#ef5350; }
  .log-warn { color:#ffb74d; }
  .log-debug { color:#999; }
  .back { display:inline-block; margin-bottom:16px; }
`;


async function scanJobKeys(redis: ReturnType<typeof getRedis>): Promise<string[]> {
  const keys: string[] = [];
  let cursor = "0";
  do {
    const [next, batch] = await redis.scan(cursor, "MATCH", "job:*:progress", "COUNT", 100);
    cursor = next;
    keys.push(...batch);
  } while (cursor !== "0");
  return keys;
}

function dashboardHtml(active: { id: string; p: JobProgress }[], recent: { id: string; p: JobProgress }[]): string {
  let html = `<!DOCTYPE html><html><head>
    <meta charset="utf-8"><title>Admin — Estimation Agent</title>
    <meta name="robots" content="noindex, nofollow">
    <style>${CSS}</style></head><body>
    <h1>Estimation Agent — Admin</h1>`;

  if (process.env.TEST_RFP_DOC_ID) {
    html += `<form method="POST" action="/admin/test-run" style="margin-bottom:20px">
      <button style="background:#2196F3;color:#fff;border:none;padding:8px 16px;border-radius:4px;cursor:pointer">Test Run</button>
    </form>`;
  }

  html += `<h2>Active Jobs (${active.length})</h2>`;
  if (active.length === 0) {
    html += `<p style="color:#999">No active jobs</p>`;
  } else {
    html += `<table><tr><th>Name</th><th>Started</th><th>Step</th><th>Progress</th><th>Turns</th><th>Cost</th><th>Elapsed</th><th>Actions</th></tr>`;
    for (const { id, p } of active) {
      const step = parseInt(p.step) || 0;
      html += `<tr>
        <td>${escapeHtml(p.estimationName)}</td>
        <td>${formatDate(p.startedAt)}</td>
        <td>${p.step}/5 ${escapeHtml(p.stepName)}</td>
        <td>${progressBar(step, 5, p.status)}</td>
        <td>${p.turnsCompleted}</td>
        <td>${formatCost(p)}</td>
        <td>${duration(p)}</td>
        <td>
          <a href="/admin/jobs/${id}/logs">Logs</a>
          <form method="POST" action="/admin/jobs/${id}/kill" style="display:inline;margin-left:8px">
            <button class="kill-btn" onclick="return confirm('Kill job ${id}?')">Kill</button>
          </form>
        </td></tr>`;
    }
    html += `</table>`;
  }

  html += `<h2>Recent Jobs</h2>`;
  if (recent.length === 0) {
    html += `<p style="color:#999">No recent jobs</p>`;
  } else {
    html += `<table><tr><th>Name</th><th>Started</th><th>Status</th><th>Progress</th><th>Turns</th><th>Cost</th><th>Duration</th><th>Actions</th></tr>`;
    for (const { id, p } of recent) {
      const step = parseInt(p.step) || 0;
      html += `<tr>
        <td>${escapeHtml(p.estimationName)}</td>
        <td>${formatDate(p.startedAt)}</td>
        <td>${statusBadge(p.status)}</td>
        <td>${progressBar(step, 5, p.status)}</td>
        <td>${p.turnsCompleted}</td>
        <td>${formatCost(p)}</td>
        <td>${duration(p)}</td>
        <td><a href="/admin/jobs/${id}/logs">Logs</a></td></tr>`;
    }
    html += `</table>`;
  }

  html += `</body></html>`;
  return html;
}

function logViewerHtml(jobId: string, progress: JobProgress | null, logs: string[]): string {
  const title = progress ? escapeHtml(progress.estimationName) : jobId;
  const status = progress ? statusBadge(progress.status) : "";

  let logLines = "";
  for (const raw of logs) {
    try {
      const entry = JSON.parse(raw) as { ts: string; level: string; type: string; message: string };
      const cls = entry.level === "error" ? "log-error" : entry.level === "warn" ? "log-warn" : `log-${entry.type}`;
      const time = entry.ts.slice(11, 19);
      logLines += `<span class="${cls}">[${time}] [${entry.type}] ${escapeHtml(entry.message)}</span>\n`;
    } catch {
      logLines += `${escapeHtml(raw)}\n`;
    }
  }

  return `<!DOCTYPE html><html><head>
    <meta charset="utf-8"><title>Logs — ${title}</title>
    <meta name="robots" content="noindex, nofollow">
    <style>${CSS}</style></head><body>
    <a class="back" href="/admin">&larr; Dashboard</a>
    <h1>${title} ${status}</h1>
    ${progress ? `<p style="color:#999">Step ${progress.step}/5 ${escapeHtml(progress.stepName)} — ${progress.turnsCompleted} turns — ${duration(progress)}${progress.costTotalUsd ? ` · Cost: $${parseFloat(progress.costTotalUsd).toFixed(2)} (Claude: $${parseFloat(progress.costClaudeUsd ?? "0").toFixed(2)}, Brave: $${parseFloat(progress.costBraveUsd ?? "0").toFixed(2)}) · ${formatTokens(progress.inputTokens)} in / ${formatTokens(progress.outputTokens)} out` : ""}</p>` : ""}
    <pre>${logLines || "<span style='color:#999'>No logs yet</span>"}</pre>
    <script>window.scrollTo(0, document.body.scrollHeight);</script>
    </body></html>`;
}

export function mountAdmin(app: Express) {
  const router = Router();
  router.use(ipAllowlist, basicAuth);

  router.get("/", async (_req, res) => {
    try {
      const redis = getRedis();
      const keys = await scanJobKeys(redis);

      const active: { id: string; p: JobProgress }[] = [];
      const recent: { id: string; p: JobProgress }[] = [];

      for (const key of keys) {
        const data = await redis.hgetall(key);
        if (!data.status) continue;
        const jobId = key.replace("job:", "").replace(":progress", "");
        const p = data as unknown as JobProgress;
        if (p.status === "running") {
          active.push({ id: jobId, p });
        } else {
          recent.push({ id: jobId, p });
        }
      }

      active.sort((a, b) => b.p.startedAt.localeCompare(a.p.startedAt));
      recent.sort((a, b) => b.p.startedAt.localeCompare(a.p.startedAt));

      res.set("X-Robots-Tag", "noindex");
      res.send(dashboardHtml(active, recent.slice(0, 20)));
    } catch (err) {
      logger.error("Admin dashboard error", { error: String(err) });
      res.status(500).send("Internal error");
    }
  });

  router.get("/jobs/:id/logs", async (req, res) => {
    try {
      const redis = getRedis();
      const jobId = req.params.id;
      const data = await redis.hgetall(progressKey(jobId));
      const progress = data.status ? (data as unknown as JobProgress) : null;
      const logs = await redis.lrange(`job:${jobId}:logs`, 0, -1);

      res.set("X-Robots-Tag", "noindex");
      res.send(logViewerHtml(jobId, progress, logs));
    } catch (err) {
      logger.error("Admin log viewer error", { error: String(err) });
      res.status(500).send("Internal error");
    }
  });

  router.post("/jobs/:id/kill", async (req, res) => {
    try {
      const redis = getRedis();
      const jobId = req.params.id;

      await redis.set(`job:${jobId}:cancelled`, "true", "EX", 3600);
      const aborted = cancelJob(jobId);

      if (!aborted) {
        await redis.hset(`job:${jobId}:progress`, { status: "cancelled", finishedAt: new Date().toISOString() });
      }

      logger.info("Admin kill request", { jobId, abortedInMemory: aborted });
      res.redirect("/admin");
    } catch (err) {
      logger.error("Admin kill error", { error: String(err) });
      res.status(500).send("Internal error");
    }
  });

  const testRunLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 5,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: "Too many test runs. Try again in 15 minutes.",
  });

  router.post("/test-run", testRunLimiter, async (_req, res) => {
    const docId = process.env.TEST_RFP_DOC_ID;
    if (!docId) {
      res.status(400).send("Set TEST_RFP_DOC_ID env var");
      return;
    }

    try {
      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: process.env.GOOGLE_CLIENT_ID!,
          client_secret: process.env.GOOGLE_CLIENT_SECRET!,
          refresh_token: process.env.GOOGLE_REFRESH_TOKEN!,
          grant_type: "refresh_token",
        }),
      });
      if (!tokenRes.ok) throw new Error(`Token error: ${await tokenRes.text()}`);
      const { access_token } = (await tokenRes.json()) as { access_token: string };

      const docRes = await fetch(`https://docs.googleapis.com/v1/documents/${docId}`, {
        headers: { Authorization: `Bearer ${access_token}` },
      });
      if (!docRes.ok) throw new Error(`Docs API error: ${docRes.status}`);
      const doc = (await docRes.json()) as { body: { content: Array<{ paragraph?: { elements?: Array<{ textRun?: { content?: string } }> } }> } };
      const rfpText = doc.body.content
        .filter((b) => b.paragraph?.elements)
        .map((b) => b.paragraph!.elements!.map((e) => e.textRun?.content ?? "").join("").trim())
        .filter(Boolean)
        .join("\n");

      runEstimationWorkflow({
        jobId: `test_${Date.now()}`,
        channelId: "test",
        threadTs: "test",
        rfpText,
        clarificationAnswers: "No clarification needed. Make reasonable assumptions based on the RFP, industry standards, and your analysis. Do not ask questions.",
        outputFolderId: process.env.GDRIVE_OUTPUT_FOLDER_ID,
        skipSteps: ["slack"],
      }).catch((err) => logger.error("Test run failed", { error: String(err) }));

      res.redirect("/admin");
    } catch (err) {
      logger.error("Test run start error", { error: String(err) });
      res.status(500).send("Failed to start test run");
    }
  });

  router.get("/metrics", async (_req, res) => {
    let redis: "connected" | "disconnected" = "disconnected";
    let queueDepth = 0;
    try {
      const { getQueue } = await import("../queue/producer.js");
      const q = getQueue();
      queueDepth = await q.getWaitingCount();
      redis = "connected";
    } catch {
      // Redis not available
    }
    res.json({ redis, queueDepth, uptimeSeconds: Math.round(process.uptime()) });
  });

  app.use("/admin", router);
}

function progressKey(jobId: string) {
  return `job:${jobId}:progress`;
}
