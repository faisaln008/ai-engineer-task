import { readFileSync } from "node:fs";
import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { createOpenAI, openai } from "@ai-sdk/openai";
import { ClassificationSchema, type Classification } from "./schema";

const prompt = readFileSync("prompt.md", "utf-8");

function getModel() {
  const provider = process.env.AI_PROVIDER?.trim() || "anthropic";
  const model = process.env.MODEL?.trim() || undefined;
  if (provider === "requesty") {
    const requesty = createOpenAI({
      baseURL:
        process.env.REQUESTY_BASE_URL?.trim() ||
        "https://router.eu.requesty.ai/v1",
      apiKey: process.env.REQUESTY_API_KEY,
    });
    return requesty.chat(model ?? "anthropic/claude-haiku-4-5");
  }
  if (provider === "openai") return openai(model ?? "gpt-4o-mini");
  return anthropic(model ?? "claude-haiku-4-5");
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Rate limits and transient 5xx are normal at any real volume. Previously a
 * single failure anywhere in the run threw and destroyed the whole evaluation,
 * which makes a red run ambiguous: bad model, or bad network?
 */
async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < attempts - 1) await sleep(500 * 2 ** attempt);
    }
  }
  throw lastError;
}

/**
 * Returns the model's raw judgement, including its evidence fields.
 *
 * Note what is NOT here any more: the old `EXPLICIT_URGENCY` regex that forced
 * `priority: "normal"` whenever the message lacked the word "dringend". It cost
 * five escalations out of five in the sample set — a stopped line, a dead plant
 * and two safety incidents — because German engineers describe the fault, not
 * their feelings about it. Escalation policy now lives in `policy.ts`, where it
 * can only ever escalate.
 */
export async function classify(message: string): Promise<Classification> {
  return withRetry(async () => {
    const { object } = await generateObject({
      model: getModel(),
      schema: ClassificationSchema,
      system: prompt,
      prompt: message,
      temperature: 0,
    });
    return object;
  });
}
