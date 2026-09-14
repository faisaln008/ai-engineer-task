# Falkenstein Service-Inbox Triage — what I found and what I changed

**Timebox: 40 minutes.** Model unchanged throughout (`claude-haiku-4-5` via Requesty),
temperature 0, so every number below reflects prompt/code changes only.

---

## 1. How I decided whether the system was good or bad

I did not trust the existing score, because the existing score could not see the
failure that matters.

The old harness reported one number: `34/45 fields correct (76%)`. That averages three
decisions of wildly different business value into a single percentage. The brief is
explicit that they are not equal:

> "A wrong `category` causes extra manual work, but is usually not critical."
> "A truly urgent request classified as `normal` means a customer gets help too late."
> "`humanReview: true` is safe, but costs manual working time."
> "If almost everything goes to human review, the system has no real automation value."

So I replaced the metric with the four questions a service manager would actually ask,
and scored the *original* run against them (`src/baseline.ts` reconstructs this from the
recorded output, so before/after go through identical code):

| | Reported by old harness | What was actually true |
|---|---|---|
| Headline | **76% "reasonably well"** | **6/15 messages fully correct (40%)** |
| Missed escalations | not measured | **5** |
| False alarms | not measured | 1 |
| Human review rate | not measured | **0% — the feature never fired once** |
| Risk score | not measured | **63** |

That gap is the whole case. 76% sounds like a system you tune; 5 missed escalations out
of 5 is a system you stop using. Both describe the same run.

The new score is a single cost-weighted number (`src/metrics.ts`):

```
riskScore = 10·missedUrgent + 3·missedReview + 2·falseAlarm + 1·wrongCategory + 1·extraReview
```

The weights are transcribed from the brief's own sentences rather than invented. They are
arguable — which is exactly why they belong in code where a stakeholder can change them,
not buried in an average.

---

## 2. What I found

**Three defects, and they compound.**

**(a) The evaluation measured the wrong thing.** `run.ts` averaged 45 field comparisons.
You can score 80% on this set while missing every single urgent case. There was also no
per-case error handling (one API failure threw away the whole run), no exit code, and
`cases.json` was `JSON.parse`'d and cast straight to `Case[]` — a typo in a label would
have silently scored every case against an unreachable value.

**(b) A post-processing rule was destroying urgency.** `classify.ts` force-downgraded
`priority` to `"normal"` unless the raw text matched `/dringend|urgent|asap|eilig/i`:

```ts
if (!EXPLICIT_URGENCY.test(message)) {
  return { ...object, priority: "normal" };   // ← the bug
}
```

The comment above it explains the intent honestly — it was a patch for past false alarms.
But it traded the cheap error for the expensive one, and it was wrong in **both**
directions:

- **Missed (5/5):** c04 a stopped packaging line, c06 a factory idle waiting on a part,
  c10 a plant that will not restart after a power cut, c05 a conveyor running with the
  safety door open, c14 oil leaking next to a switch cabinet. None contains the word
  "dringend" — German engineers describe the fault, not their feelings about it.
- **False alarm:** c12 shouts "DRINGEND" and is a chase for a credit note. Nothing is
  broken.

Keyword urgency does not merely underperform here; it is close to anti-correlated with
real severity.

**(c) The prompt was answering a different question than the labels ask.** It defined
`humanReview` as *"only when you cannot clearly determine the category"* — but the gold
labels flag c05, c07 and c14, which are safety and ambiguity cases with perfectly obvious
categories. Measured result: `humanReview` fired **zero times in 15**. The feature was
dead, and the flat metric never showed it.

---

## 3. What I changed

**Deleted the keyword override.** The single highest-leverage change in the repo.

**Split perception from policy.** The model now reports what it can *observe*, and code
decides what the company *does* about it:

```ts
// schema.ts — generated before the decisions, so they follow from it
reasoning, impact: "none" | "degraded" | "stopped" | "safety",
customerSignalsUrgency, ambiguous
```

```ts
// policy.ts — escalate-only: may raise normal→urgent, never lower it
urgent  ⟸ impact ∈ {stopped, safety} ∨ (impact = degraded ∧ customerSignalsUrgency)
review  ⟸ impact = safety ∨ (urgent ∧ ambiguous)
```

Escalation thresholds are business policy that will change; they belong in reviewable,
testable code, not in prose a model re-interprets on every call. The escalate-only
direction is the deliberate inverse of the bug it replaces — safe precisely *because* the
cost asymmetry is one-directional.

Gating the review arm on urgency is what keeps automation value: c11's vague hydraulic
noise is ambiguous but harmless, so it is handled automatically rather than queued.

**Rewrote the prompt** around impact rather than vocabulary, with the two boundary
examples the old version got wrong (the loud invoice chase → `normal`; the calm stopped
line → `urgent`).

**Rebuilt the harness**: cost-weighted metrics, `--repeats` for stability, per-case
isolation with retries, bounded concurrency, tagged JSON runs in `evals/`, and a
**shipping gate** — a missed escalation exits non-zero.

---

## 4. Was it an improvement?

| Metric | Baseline | Final | |
|---|---|---|---|
| Messages fully correct | 6/15 (40%) | **15/15 (100%)** | +9 |
| **Missed escalations** | **5** | **0** | −5 |
| False alarms | 1 | 0 | −1 |
| Wrong category | 2 | 0 | −2 |
| Human review rate | 0% (never fired) | 20% (3/3 correct) | works, stays cheap |
| **Risk score** | **63** | **0** | **−63** |

Stable across 3 repeats (45/45, no case flipped). Latency p50 ~2.0s.

**I do not believe 15/15 means the system is solved, and I would not present it that
way.** I tuned two evidence definitions after seeing failures on this set, so the last
two points are fitted to it. With n=15, one case is ±7%. The honest claim is narrower:
*the specific, reproducible defect that was losing every escalation is fixed, and the
harness can now prove it.*

Two results I would flag rather than bury:

**The policy layer contributes nothing on a healthy model.** Running `--no-policy` also
scores 15/15 — the rewritten prompt does all the work. On this evidence the guardrail is
unearned complexity.

**But it is what contains a regression.** I reinserted the original bug as a negative
control:

| Original bug reinserted | Missed escalations | Gate |
|---|---|---|
| guardrail OFF | **5** (the same 5 cases) | exits 1 ✅ caught |
| guardrail ON | **0** — all 5 re-escalated by policy | exits 0 ✅ contained |

This is the result I would actually defend in a review. It shows the eval detects the bug
that shipped, and that the guardrail absorbs it when the model layer fails. Its value is
insurance against model drift and model swaps, not accuracy today — and I would keep it
on those grounds while being clear it is currently redundant.

---

## 5. What I would do next, before production

**Before I would trust it (blocking):**

1. **A real evaluation set.** ~200 messages sampled from actual inbox traffic, with a
   held-out split — this policy was tuned on all 15 cases, so it has no honest test set.
2. **Label review.** At least three of the current labels are arguable (c07 and c11 are
   both "degraded machine, vague description" but get different urgency; c09 vs c15 both
   read as commercial). Two people should label independently and measure agreement. If
   humans disagree at 15%, no model can be held to 95%.
3. **Threshold with the on-call team, not with me.** `urgent` wakes a person at night.
   The right false-alarm rate is theirs to set; the harness makes the trade visible.

**Operational readiness:**

4. Log `reasoning` + `impact` on every production call — they are already in the schema
   and make each escalation auditable after the fact.
5. Shadow-run against the human sorter for two weeks; compare, don't switch.
6. Alert on distribution drift (share of `stopped`/`safety`) — the earliest signal of a
   silently degrading model.
7. Track cost/latency per message; this is ~2s and fractions of a cent on Haiku, which
   comfortably absorbs a second opinion on high-impact messages if wanted.
8. Decide the fallback: on API failure the message must land in the human queue, never be
   dropped. The harness counts errors; production needs the same discipline.

**The honest summary:** the system was losing every genuine emergency while reporting
76%. It no longer does, and there is now a gate that fails the build if it starts again.
Whether it is good enough to *rely on* is a question 15 cases cannot answer — but the
instrument to answer it now exists.

---

## Reproducing

```bash
npm run typecheck
npm run baseline                    # reconstruct evals/baseline.json from the original run
npm run eval -- --tag final         # full system; exits non-zero on any missed escalation
npm run eval -- --repeats 3         # stability
npm run eval -- --no-policy         # ablate the guardrail
```
