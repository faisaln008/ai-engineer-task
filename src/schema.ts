import { z } from "zod";

/**
 * The three decisions the business consumes. This is the contract with the
 * downstream routing system and the only thing the eval scores.
 */
export const DecisionSchema = z.object({
  category: z.enum(["technical", "billing", "delivery", "other"]),
  priority: z.enum(["normal", "urgent"]),
  humanReview: z.boolean(),
});

export type Decision = z.infer<typeof DecisionSchema>;

export const DECISION_FIELDS = ["category", "priority", "humanReview"] as const;
export type DecisionField = (typeof DECISION_FIELDS)[number];

export type Category = Decision["category"];
export type Priority = Decision["priority"];

export const CATEGORIES = ["technical", "billing", "delivery", "other"] as const;

/**
 * What the model returns.
 *
 * Field order is deliberate and load-bearing: the model emits these keys in
 * order, so `reasoning` and the observable evidence are generated *before* the
 * decisions that depend on them. It also gives us an audit trail — when a
 * production message is escalated at 3am, `reasoning` + `impact` explain why.
 *
 * The evidence fields exist so the model reports *what it can see* while
 * `policy.ts` applies *what the business has decided*. Escalation thresholds
 * are company policy, not something a classifier should be asked to memorise.
 */
export const ClassificationSchema = z.object({
  reasoning: z
    .string()
    .max(400)
    .describe(
      "One or two sentences in English: what the customer wants and what is happening on their production floor.",
    ),
  impact: z
    .enum(["none", "degraded", "stopped", "safety"])
    .describe(
      "Observable operational impact. none = no machine affected (commercial/admin request). " +
        "degraded = a machine runs but misbehaves. stopped = production is halted, for ANY reason " +
        "including a missing spare part. safety = risk to people, regardless of whether production runs.",
    ),
  customerSignalsUrgency: z
    .boolean()
    .describe(
      "True if the customer explicitly asks for speed (dringend, ASAP, a deadline, 'call me today'). " +
        "This is a hint only, never sufficient on its own.",
    ),
  ambiguous: z
    .boolean()
    .describe(
      "True if the message is too vague to act on confidently: unclear symptoms, unclear scope, " +
        "or the customer is asking whether it is safe to continue.",
    ),
  ...DecisionSchema.shape,
});

/** Full model output. Name kept for backwards compatibility with the original code. */
export type Classification = z.infer<typeof ClassificationSchema>;

/** The evidence half of the model output, used for auditing and for `policy.ts`. */
export type Evidence = Pick<
  Classification,
  "reasoning" | "impact" | "customerSignalsUrgency" | "ambiguous"
>;

export function toDecision(c: Classification): Decision {
  return { category: c.category, priority: c.priority, humanReview: c.humanReview };
}
