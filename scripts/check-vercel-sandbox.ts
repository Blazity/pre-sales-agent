import "dotenv/config";
import { runSandboxSmokeTest } from "../src/runtime/sandbox.js";

const result = await runSandboxSmokeTest();

if (result.exitCode !== 0) {
  throw new Error(`Sandbox smoke test failed in ${result.sandboxId}`);
}

console.log(`Sandbox smoke test passed: ${result.sandboxId}`);
