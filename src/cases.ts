import { readFileSync } from "node:fs";
import { z } from "zod";
import { DecisionSchema } from "./schema";

export const TriageCaseSchema = z.object({
  id: z.string().min(1),
  message: z.string().min(1),
  expected: DecisionSchema,
});

export type TriageCase = z.infer<typeof TriageCaseSchema>;

const TriageCaseFileSchema = z.array(TriageCaseSchema).min(1);

/**
 * The original code did `JSON.parse(...) as Case[]`, which is a compile-time
 * fiction: a typo in a label ("urgant") would have silently scored every case
 * against a value the model can never produce. Parse, don't cast.
 */
export function loadCases(path = "cases.json"): readonly TriageCase[] {
  const raw: unknown = JSON.parse(readFileSync(path, "utf-8"));
  const result = TriageCaseFileSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`${path} is not a valid case file:\n${issues}`);
  }
  return result.data;
}
