import {
  CATEGORIES,
  DECISION_FIELDS,
  type Category,
  type Decision,
  type DecisionField,
  type Evidence,
} from "./schema";

export type CaseOutcome = {
  id: string;
  repeat: number;
  expected: Decision;
  /** null when the API call failed after retries. */
  predicted: Decision | null;
  /** What the model reported before policy was applied. Null on failure. */
  evidence: Evidence | null;
  /** The model's raw decision before `policy.ts` escalated anything. */
  rawPredicted: Decision | null;
  error: string | null;
  latencyMs: number;
};

/**
 * Weights are quoted from the brief, not invented:
 *
 *   "A truly urgent request classified as normal means a customer gets help
 *    too late."                                          -> missedUrgent, 10
 *   "A wrong category causes extra manual work, but is
 *    usually not critical."                              -> wrongCategory, 1
 *   "humanReview: true is safe, but costs manual working
 *    time."                                              -> extraReview, 1
 *
 * The two the brief implies rather than states: a false alarm wakes the on-call
 * team (2), and failing to flag a safety case for review is bad but less bad
 * than never escalating it at all (3).
 *
 * A single number lets us compare runs. The weights are arguable — that is the
 * point. They are explicit, in code, and a stakeholder can change them.
 */
export const COST = {
  missedUrgent: 10,
  missedReview: 3,
  falseAlarm: 2,
  wrongCategory: 1,
  extraReview: 1,
} as const;

export type CategoryConfusion = Record<Category, Record<Category, number>>;

export type Metrics = {
  cases: number;
  scored: number;
  errors: number;

  /** All three fields correct. The headline: far harsher than a field average. */
  exactMatch: number;
  exactMatchRate: number;

  fieldAccuracy: Record<DecisionField, number>;

  /** Expected urgent, predicted normal. The error that costs a customer. */
  missedUrgent: number;
  /** Expected normal, predicted urgent. Wakes on-call for nothing. */
  falseAlarm: number;
  urgentRecall: number | null;
  urgentPrecision: number | null;

  missedReview: number;
  extraReview: number;
  /** Share of all mail put in front of a human. High = no automation value. */
  reviewRate: number;
  reviewRecall: number | null;
  reviewPrecision: number | null;

  wrongCategory: number;
  categoryConfusion: CategoryConfusion;

  /** Cost-weighted total. Lower is better. The number to optimise. */
  riskScore: number;

  /** Cases whose prediction changed between repeats — unreliable, not averaged away. */
  unstable: string[];

  latencyMsP50: number;
  latencyMsMax: number;
};

function emptyConfusion(): CategoryConfusion {
  const rows = {} as CategoryConfusion;
  for (const expected of CATEGORIES) {
    const row = {} as Record<Category, number>;
    for (const predicted of CATEGORIES) row[predicted] = 0;
    rows[expected] = row;
  }
  return rows;
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p));
  return sorted[index] ?? 0;
}

export function score(outcomes: readonly CaseOutcome[]): Metrics {
  const scored = outcomes.filter(
    (o): o is CaseOutcome & { predicted: Decision } => o.predicted !== null,
  );

  const fieldCorrect: Record<DecisionField, number> = {
    category: 0,
    priority: 0,
    humanReview: 0,
  };
  const confusion = emptyConfusion();

  let exactMatch = 0;
  let missedUrgent = 0;
  let falseAlarm = 0;
  let expectedUrgent = 0;
  let predictedUrgent = 0;
  let correctUrgent = 0;
  let missedReview = 0;
  let extraReview = 0;
  let expectedReview = 0;
  let predictedReview = 0;
  let correctReview = 0;
  let wrongCategory = 0;

  for (const o of scored) {
    const { expected, predicted } = o;

    for (const field of DECISION_FIELDS) {
      if (expected[field] === predicted[field]) fieldCorrect[field] += 1;
    }
    if (DECISION_FIELDS.every((f) => expected[f] === predicted[f])) exactMatch += 1;

    confusion[expected.category][predicted.category] += 1;
    if (expected.category !== predicted.category) wrongCategory += 1;

    if (expected.priority === "urgent") expectedUrgent += 1;
    if (predicted.priority === "urgent") predictedUrgent += 1;
    if (expected.priority === "urgent" && predicted.priority === "urgent") correctUrgent += 1;
    if (expected.priority === "urgent" && predicted.priority === "normal") missedUrgent += 1;
    if (expected.priority === "normal" && predicted.priority === "urgent") falseAlarm += 1;

    if (expected.humanReview) expectedReview += 1;
    if (predicted.humanReview) predictedReview += 1;
    if (expected.humanReview && predicted.humanReview) correctReview += 1;
    if (expected.humanReview && !predicted.humanReview) missedReview += 1;
    if (!expected.humanReview && predicted.humanReview) extraReview += 1;
  }

  // A case is unstable if repeats of the same message disagreed.
  const byId = new Map<string, Set<string>>();
  for (const o of scored) {
    const key = `${o.predicted.category}|${o.predicted.priority}|${o.predicted.humanReview}`;
    const seen = byId.get(o.id) ?? new Set<string>();
    seen.add(key);
    byId.set(o.id, seen);
  }
  const unstable = [...byId.entries()].filter(([, v]) => v.size > 1).map(([id]) => id);

  const n = scored.length || 1;
  const latencies = outcomes.map((o) => o.latencyMs).sort((a, b) => a - b);

  return {
    cases: outcomes.length,
    scored: scored.length,
    errors: outcomes.length - scored.length,

    exactMatch,
    exactMatchRate: exactMatch / n,

    fieldAccuracy: {
      category: fieldCorrect.category / n,
      priority: fieldCorrect.priority / n,
      humanReview: fieldCorrect.humanReview / n,
    },

    missedUrgent,
    falseAlarm,
    urgentRecall: ratio(correctUrgent, expectedUrgent),
    urgentPrecision: ratio(correctUrgent, predictedUrgent),

    missedReview,
    extraReview,
    reviewRate: predictedReview / n,
    reviewRecall: ratio(correctReview, expectedReview),
    reviewPrecision: ratio(correctReview, predictedReview),

    wrongCategory,
    categoryConfusion: confusion,

    riskScore:
      COST.missedUrgent * missedUrgent +
      COST.missedReview * missedReview +
      COST.falseAlarm * falseAlarm +
      COST.wrongCategory * wrongCategory +
      COST.extraReview * extraReview,

    unstable,

    latencyMsP50: percentile(latencies, 0.5),
    latencyMsMax: latencies.length > 0 ? (latencies[latencies.length - 1] ?? 0) : 0,
  };
}

const pct = (v: number): string => `${(v * 100).toFixed(0)}%`;
const optPct = (v: number | null): string => (v === null ? "n/a" : pct(v));

export function formatReport(m: Metrics): string {
  const lines: string[] = [];

  lines.push("");
  lines.push("── Decision quality ──────────────────────────────────");
  lines.push(
    `  exact match (all 3 fields)   ${m.exactMatch}/${m.scored}  ${pct(m.exactMatchRate)}`,
  );
  lines.push(
    `  per field                    category ${pct(m.fieldAccuracy.category)}   ` +
      `priority ${pct(m.fieldAccuracy.priority)}   humanReview ${pct(m.fieldAccuracy.humanReview)}`,
  );

  lines.push("");
  lines.push("── Escalation (the expensive axis) ───────────────────");
  lines.push(
    `  MISSED URGENT                ${m.missedUrgent}   (customer waits; cost ${COST.missedUrgent} each)`,
  );
  lines.push(`  false alarms                 ${m.falseAlarm}   (on-call woken for nothing)`);
  lines.push(
    `  urgent recall / precision    ${optPct(m.urgentRecall)} / ${optPct(m.urgentPrecision)}`,
  );

  lines.push("");
  lines.push("── Human review (the automation-value axis) ──────────");
  lines.push(
    `  review rate                  ${pct(m.reviewRate)}   (share of all mail sent to a human)`,
  );
  lines.push(`  missed / unnecessary         ${m.missedReview} / ${m.extraReview}`);
  lines.push(
    `  review recall / precision    ${optPct(m.reviewRecall)} / ${optPct(m.reviewPrecision)}`,
  );

  const misroutes = CATEGORIES.flatMap((expected) =>
    CATEGORIES.filter((p) => p !== expected && m.categoryConfusion[expected][p] > 0).map(
      (p) => `${expected}→${p} ×${m.categoryConfusion[expected][p]}`,
    ),
  );
  lines.push("");
  lines.push("── Routing ───────────────────────────────────────────");
  lines.push(
    `  wrong category               ${m.wrongCategory}` +
      (misroutes.length > 0 ? `   (${misroutes.join(", ")})` : ""),
  );

  lines.push("");
  lines.push("── Health ────────────────────────────────────────────");
  lines.push(`  api errors                   ${m.errors}`);
  lines.push(`  unstable across repeats      ${m.unstable.length > 0 ? m.unstable.join(", ") : "none"}`);
  lines.push(`  latency p50 / max            ${m.latencyMsP50}ms / ${m.latencyMsMax}ms`);

  lines.push("");
  lines.push(`  RISK SCORE (lower better)    ${m.riskScore}`);
  lines.push("");

  return lines.join("\n");
}

const delta = (now: number, before: number, lowerIsBetter: boolean): string => {
  const d = now - before;
  if (d === 0) return `unchanged (${now})`;
  const better = lowerIsBetter ? d < 0 : d > 0;
  const arrow = d > 0 ? `+${d}` : `${d}`;
  return `${before} → ${now}  ${arrow} ${better ? "✅" : "🔴"}`;
};

export function formatComparison(now: Metrics, before: Metrics, baselineTag: string): string {
  return [
    "",
    `── vs baseline "${baselineTag}" ───────────────────────────`,
    `  exact match                  ${delta(now.exactMatch, before.exactMatch, false)}`,
    `  MISSED URGENT                ${delta(now.missedUrgent, before.missedUrgent, true)}`,
    `  false alarms                 ${delta(now.falseAlarm, before.falseAlarm, true)}`,
    `  wrong category               ${delta(now.wrongCategory, before.wrongCategory, true)}`,
    `  review rate                  ${pct(before.reviewRate)} → ${pct(now.reviewRate)}`,
    `  RISK SCORE                   ${delta(now.riskScore, before.riskScore, true)}`,
    "",
  ].join("\n");
}
