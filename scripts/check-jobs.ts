import Redis from "ioredis";
import "dotenv/config";

async function main() {
  const redis = new Redis(process.env.REDIS_URL!);

  const keys = await redis.keys("job:*:progress");
  console.log("=== All tracked jobs (" + keys.length + ") ===");
  for (const key of keys.sort()) {
    const data = await redis.hgetall(key);
    console.log(`\n${key}:`);
    console.log(JSON.stringify(data, null, 2));
  }

  console.log("\n=== BullMQ Queue State ===");
  const waiting = await redis.lrange("bull:estimations:wait", 0, -1);
  console.log("Waiting:", waiting);
  const active = await redis.lrange("bull:estimations:active", 0, -1);
  console.log("Active:", active);
  const failed = await redis.zrange("bull:estimations:failed", 0, -1);
  console.log("Failed:", failed);
  const completed = await redis.zrange("bull:estimations:completed", 0, -1);
  console.log("Completed:", completed);

  const jobKeys = await redis.keys("bull:estimations:*");
  const jobDataKeys = jobKeys.filter(k => /^bull:estimations:\d+$/.test(k)).sort();
  if (jobDataKeys.length > 0) {
    console.log("\n=== Recent BullMQ Job Data (last 5) ===");
    for (const jk of jobDataKeys.slice(-5)) {
      const jdata = await redis.hgetall(jk);
      console.log(`\n${jk}:`);
      console.log("  name:", jdata.name);
      console.log("  processedOn:", jdata.processedOn ? new Date(Number(jdata.processedOn)).toISOString() : "n/a");
      console.log("  finishedOn:", jdata.finishedOn ? new Date(Number(jdata.finishedOn)).toISOString() : "n/a");
      console.log("  failedReason:", jdata.failedReason || "n/a");
      console.log("  attemptsMade:", jdata.attemptsMade || "n/a");
      if (jdata.data) {
        try {
          const parsed = JSON.parse(jdata.data);
          console.log("  jobId:", parsed.jobId);
          console.log("  rfpText:", (parsed.rfpText || "").substring(0, 150) + "...");
        } catch {}
      }
    }
  }

  await redis.quit();
}

main().catch(e => { console.error(e); process.exit(1); });
