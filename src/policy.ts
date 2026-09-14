import type { Classification, Decision } from "./schema";

/**
 * Business escalation policy, as code.
 *
 * The model reports what it can observe (`impact`, `ambiguous`); this decides
 * what the company does about it. Keeping the threshold here rather than in the
 * prompt means it is reviewable, testable, diffable, and changeable by someone
 * who does not want to rewrite a prompt to move a threshold.
 *
 * CRITICAL — this layer is escalate-only. It may raise normal→urgent and
 * false→true; it can never lower either. That directionality is the exact
 * inverse of the bug it replaces (the old `EXPLICIT_URGENCY` regex in
 * classify.ts *downgraded* priority unless a keyword appeared, which traded the
 * cheap error for the expensive one). One-directional guardrails are safe here
 * precisely because the cost asymmetry is one-directional.
 */
export function applyPolicy(c: Classification): Decision {
  // Production halted or a safety risk is urgent on its own terms, whether or
  // not the customer thought to say "dringend".
  const impactIsUrgent = c.impact === "stopped" || c.impact === "safety";

  // A machine that misbehaves without stopping is urgent only when the customer
  // signals they need speed. Commercial/admin mail (impact "none") is never
  // urgent no matter how it is worded — that is what makes the DRINGEND invoice
  // chase in c12 stay `normal`.
  const degradedAndPressing = c.impact === "degraded" && c.customerSignalsUrgency;

  const priority: Decision["priority"] =
    c.priority === "urgent" || impactIsUrgent || degradedAndPressing ? "urgent" : "normal";

  // Send to a human when someone could get hurt, or when we are escalating on
  // evidence we are not confident about. Gating the ambiguity arm on urgency is
  // what keeps the review rate low: a vague but harmless message (c11's
  // hydraulic noise) is handled automatically.
  const humanReview =
    c.humanReview || c.impact === "safety" || (priority === "urgent" && c.ambiguous);

  return { category: c.category, priority, humanReview };
}
