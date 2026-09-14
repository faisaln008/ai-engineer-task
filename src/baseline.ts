/**
 * Reconstructs `evals/baseline.json` from the ORIGINAL system's recorded run,
 * so "before" and "after" are scored by identical code.
 *
 * Provenance: the per-case predictions below are transcribed from
 * `evals/baseline-original-harness.txt` — the output of `npm run case` against
 * the unmodified repo (old prompt.md, old classify.ts with the EXPLICIT_URGENCY
 * override). That run reported "34/45 fields correct (76%)".
 *
 * Run with: npx tsx src/baseline.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { loadCases } from "./cases";
import { score, type CaseOutcome } from "./metrics";
import type { Decision } from "./schema";

const ORIGINAL_PREDICTIONS: Record<string, Decision> = {
  c01: { category: "billing", priority: "normal", humanReview: false },
  c02: { category: "delivery", priority: "normal", humanReview: false },
  c03: { category: "technical", priority: "normal", humanReview: false },
  c04: { category: "technical", priority: "normal", humanReview: false },
  c05: { category: "technical", priority: "normal", humanReview: false },
  c06: { category: "delivery", priority: "normal", humanReview: false },
  c07: { category: "technical", priority: "urgent", humanReview: false },
  c08: { category: "billing", priority: "normal", humanReview: false },
  c09: { category: "billing", priority: "normal", humanReview: false },
  c10: { category: "technical", priority: "normal", humanReview: false },
  c11: { category: "technical", priority: "normal", humanReview: false },
  c12: { category: "billing", priority: "urgent", humanReview: false },
  c13: { category: "delivery", priority: "normal", humanReview: false },
  c14: { category: "technical", priority: "normal", humanReview: false },
  c15: { category: "technical", priority: "normal", humanReview: false },
};

const outcomes: CaseOutcome[] = loadCases().map((c) => {
  const predicted = ORIGINAL_PREDICTIONS[c.id];
  if (predicted === undefined) throw new Error(`no recorded baseline prediction for ${c.id}`);
  return {
    id: c.id,
    repeat: 0,
    expected: c.expected,
    predicted,
    rawPredicted: predicted,
    evidence: null,
    error: null,
    latencyMs: 0,
  };
});

const metrics = score(outcomes);
mkdirSync("evals", { recursive: true });
writeFileSync(
  "evals/baseline.json",
  JSON.stringify(
    {
      tag: "baseline",
      createdAt: new Date().toISOString(),
      note: "Original system (old prompt + EXPLICIT_URGENCY override), transcribed from evals/baseline-original-harness.txt",
      options: { repeats: 1, policy: false },
      metrics,
      outcomes,
    },
    null,
    2,
  ),
  "utf-8",
);

console.log("Baseline reconstructed from the original run:");
console.log(`  exact match   ${metrics.exactMatch}/15`);
console.log(`  missedUrgent  ${metrics.missedUrgent}`);
console.log(`  falseAlarm    ${metrics.falseAlarm}`);
console.log(`  missedReview  ${metrics.missedReview}`);
console.log(`  reviewRate    ${(metrics.reviewRate * 100).toFixed(0)}%`);
console.log(`  riskScore     ${metrics.riskScore}`);
console.log("Saved → evals/baseline.json");
