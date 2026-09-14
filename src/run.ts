import "dotenv/config";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { classify } from "./classify";
import { loadCases, type TriageCase } from "./cases";
import { applyPolicy } from "./policy";
import { toDecision, type Decision, DECISION_FIELDS } from "./schema";
import { formatComparison, formatReport, score, type CaseOutcome, type Metrics } from "./metrics";

/** A mistake by whoever invoked the CLI — report it plainly, without a stack trace. */
class UsageError extends Error {}

type Options = {
  tag: string | null;
  repeats: number;
  concurrency: number;
  policy: boolean;
  baseline: string;
  gate: boolean;
};

function parseArgs(argv: readonly string[]): Options {
  const opts: Options = {
    tag: null,
    repeats: 1,
    concurrency: 5,
    policy: true,
    baseline: "evals/baseline.json",
    gate: true,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = (): string => {
      const v = argv[i + 1];
      if (v === undefined) throw new UsageError(`${arg} requires a value`);
      i++;
      return v;
    };
    switch (arg) {
      case "--tag":
        opts.tag = next();
        break;
      case "--repeats":
        opts.repeats = Number.parseInt(next(), 10);
        break;
      case "--concurrency":
        opts.concurrency = Number.parseInt(next(), 10);
        break;
      case "--baseline":
        opts.baseline = next();
        break;
      case "--no-policy":
        opts.policy = false;
        break;
      case "--no-gate":
        opts.gate = false;
        break;
      default:
        throw new UsageError(
          `unknown argument: ${arg}\n` +
            "usage: npm run eval -- [--tag <name>] [--repeats <n>] [--concurrency <n>] " +
            "[--baseline <path>] [--no-policy] [--no-gate]",
        );
    }
  }

  if (!Number.isFinite(opts.repeats) || opts.repeats < 1) {
    throw new UsageError("--repeats must be an integer >= 1");
  }
  if (!Number.isFinite(opts.concurrency) || opts.concurrency < 1) {
    throw new UsageError("--concurrency must be an integer >= 1");
  }
  return opts;
}

/** Bounded-concurrency map. ~12 lines; not worth a dependency. */
async function mapWithLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      const item = items[index];
      if (item === undefined) break;
      results[index] = await fn(item, index);
    }
  });
  await Promise.all(workers);
  return results;
}

async function runOne(
  testCase: TriageCase,
  repeat: number,
  usePolicy: boolean,
): Promise<CaseOutcome> {
  const startedAt = Date.now();
  try {
    const classification = await classify(testCase.message);
    const rawPredicted = toDecision(classification);
    return {
      id: testCase.id,
      repeat,
      expected: testCase.expected,
      predicted: usePolicy ? applyPolicy(classification) : rawPredicted,
      rawPredicted,
      evidence: {
        reasoning: classification.reasoning,
        impact: classification.impact,
        customerSignalsUrgency: classification.customerSignalsUrgency,
        ambiguous: classification.ambiguous,
      },
      error: null,
      latencyMs: Date.now() - startedAt,
    };
  } catch (err) {
    return {
      id: testCase.id,
      repeat,
      expected: testCase.expected,
      predicted: null,
      rawPredicted: null,
      evidence: null,
      error: err instanceof Error ? err.message : String(err),
      latencyMs: Date.now() - startedAt,
    };
  }
}

function formatCaseLine(o: CaseOutcome): string {
  if (o.predicted === null) {
    return `  ${o.id}  ⚠️  API error: ${o.error ?? "unknown"}`;
  }
  const predicted: Decision = o.predicted;
  const marks = DECISION_FIELDS.map((f) =>
    o.expected[f] === predicted[f]
      ? `${f} ✓`
      : `${f} ✗ (got ${String(predicted[f])}, want ${String(o.expected[f])})`,
  );
  const ok = DECISION_FIELDS.every((f) => o.expected[f] === predicted[f]);
  const escalated =
    o.rawPredicted !== null &&
    (o.rawPredicted.priority !== predicted.priority ||
      o.rawPredicted.humanReview !== predicted.humanReview)
      ? "  [policy escalated]"
      : "";
  const impact = o.evidence !== null ? `  impact=${o.evidence.impact}` : "";
  return `  ${o.id}  ${ok ? "✓" : "✗"}  ${marks.join("   ")}${impact}${escalated}`;
}

function readBaseline(path: string): Metrics | null {
  if (!existsSync(path)) return null;
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf-8"));
    if (typeof parsed === "object" && parsed !== null && "metrics" in parsed) {
      return (parsed as { metrics: Metrics }).metrics;
    }
    return null;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  let cases: readonly TriageCase[];
  try {
    cases = loadCases();
  } catch (err) {
    throw new UsageError(err instanceof Error ? err.message : String(err));
  }

  const jobs = cases.flatMap((c) =>
    Array.from({ length: opts.repeats }, (_, repeat) => ({ testCase: c, repeat })),
  );

  console.log(
    `Running ${cases.length} cases × ${opts.repeats} repeat(s), ` +
      `policy layer ${opts.policy ? "ON" : "OFF"}, concurrency ${opts.concurrency}\n`,
  );

  const outcomes = await mapWithLimit(jobs, opts.concurrency, (job) =>
    runOne(job.testCase, job.repeat, opts.policy),
  );

  for (const o of outcomes) {
    if (o.repeat === 0) console.log(formatCaseLine(o));
  }

  const metrics = score(outcomes);
  console.log(formatReport(metrics));

  // Show exactly which messages would have left a customer waiting.
  const missed = outcomes.filter(
    (o) => o.predicted !== null && o.expected.priority === "urgent" && o.predicted.priority === "normal",
  );
  if (missed.length > 0) {
    console.log("  Missed escalations:");
    for (const o of missed) {
      console.log(`    ${o.id}  impact=${o.evidence?.impact ?? "?"}  "${o.evidence?.reasoning ?? ""}"`);
    }
    console.log("");
  }

  const baseline = readBaseline(opts.baseline);
  if (baseline !== null && opts.tag !== "baseline") {
    console.log(formatComparison(metrics, baseline, opts.baseline));
  }

  if (opts.tag !== null) {
    mkdirSync("evals", { recursive: true });
    const path = `evals/${opts.tag}.json`;
    writeFileSync(
      path,
      JSON.stringify(
        {
          tag: opts.tag,
          createdAt: new Date().toISOString(),
          model: process.env.MODEL || "default",
          provider: process.env.AI_PROVIDER || "anthropic",
          options: { repeats: opts.repeats, policy: opts.policy },
          metrics,
          outcomes,
        },
        null,
        2,
      ),
      "utf-8",
    );
    console.log(`  Saved → ${path}\n`);
  }

  // A shipping gate, not a report. Missing an escalation is the one failure the
  // business said it cannot absorb, so it fails the build.
  if (opts.gate && (metrics.missedUrgent > 0 || metrics.errors > 0)) {
    console.error(
      `  GATE FAILED: ${metrics.missedUrgent} missed escalation(s), ${metrics.errors} API error(s).\n`,
    );
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  if (err instanceof UsageError) {
    console.error(`\n  ${err.message}\n`);
  } else {
    console.error(err);
  }
  process.exit(1);
});
