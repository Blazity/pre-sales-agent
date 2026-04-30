/**
 * Refresh Blazity case studies in Pinecone.
 * Deletes all existing case_study vectors, then re-scrapes and re-seeds.
 *
 * Usage:
 *   npx tsx scripts/refresh-case-studies.ts
 */

import { seedCaseStudies } from "./seed-case-studies.js";

seedCaseStudies(true).catch((err) => {
  console.error("Refresh failed:", err.message);
  process.exit(1);
});
