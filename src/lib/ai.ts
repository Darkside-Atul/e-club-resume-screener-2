import "server-only";

import { createHash } from "node:crypto";
import { ApiError, GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { evaluateOutput, InvalidEvaluation, modelOutput, redactEvidence, relevantCriteria, systemPrompt } from "./evaluation";
import type { Profile, Rubric } from "./types";

export class ScreeningError extends Error {
  constructor(public readonly code: string, public readonly retry = false) {
    super(code);
  }
}

type ModelResult = { text: string; version: string };
type Provider = (prompt: string) => Promise<ModelResult>;

const outputSchema = z.toJSONSchema(modelOutput);
delete outputSchema.$schema;

function statusError(status: number) {
  if (status === 429) return new ScreeningError("quota_wait");
  return new ScreeningError("model_unavailable", status === 408 || status >= 500);
}

function gemini(mode: "synthetic" | "private"): Provider {
  const key = mode === "private"
    ? process.env.GEMINI_API_KEY || process.env.GEMINI_PRIVATE_API_KEY
    : process.env.GEMINI_SYNTHETIC_API_KEY;
  if (mode === "private" && key && key === process.env.GEMINI_SYNTHETIC_API_KEY) {
    throw new ScreeningError("privacy_guard");
  }
  if (!key) throw new ScreeningError("model_unconfigured");
  const model = process.env.AI_MODEL || "gemini-3.5-flash";
  const client = new GoogleGenAI({
    apiKey: key, vertexai: false,
    httpOptions: { timeout: 23000, retryOptions: { attempts: 1 } },
  });
  return async (prompt) => {
    try {
      const response = await client.models.generateContent({
        model,
        contents: prompt,
        config: {
          abortSignal: AbortSignal.timeout(24000),
          systemInstruction: systemPrompt,
          responseMimeType: "application/json",
          responseJsonSchema: outputSchema,
          temperature: 0,
          maxOutputTokens: 4096,
        },
      });
      if (response.candidates?.[0]?.finishReason !== "STOP" || !response.text) throw new InvalidEvaluation();
      return { text: response.text, version: `gemini:${response.modelVersion || model}` };
    } catch (error) {
      if (error instanceof ApiError) throw statusError(error.status);
      throw error;
    }
  };
}

function ollama(): Provider {
  const url = new URL(process.env.OLLAMA_URL || "http://127.0.0.1:11434");
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) {
    throw new ScreeningError("model_unconfigured");
  }
  const model = process.env.AI_MODEL;
  if (!model || /(?:^|[:-])cloud(?:$|[-:])/i.test(model)) throw new ScreeningError("model_unconfigured");
  return async (prompt) => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (process.env.OLLAMA_BEARER_TOKEN) headers.Authorization = `Bearer ${process.env.OLLAMA_BEARER_TOKEN}`;
    const response = await fetch(new URL("/api/chat", url), {
      method: "POST", headers, redirect: "error", signal: AbortSignal.timeout(24000),
      body: JSON.stringify({
        model, stream: false, format: outputSchema,
        messages: [{ role: "system", content: systemPrompt }, { role: "user", content: prompt }],
        options: { temperature: 0, num_ctx: 24576, num_predict: 3500 },
      }),
    });
    if (!response.ok) throw statusError(response.status);
    const parsed = z.object({
      model: z.string().min(1),
      done: z.literal(true),
      done_reason: z.literal("stop"),
      message: z.object({ content: z.string().min(1) }),
    }).safeParse(await response.json());
    if (!parsed.success) throw new InvalidEvaluation();
    return { text: parsed.data.message.content, version: `ollama:${parsed.data.model}` };
  };
}

export function screeningProvider() {
  const mode = process.env.AI_SCREENING_MODE || "off";
  if (mode === "off") throw new ScreeningError("ai_disabled");
  const provider = process.env.AI_PROVIDER || "gemini";
  if (mode === "private" && process.env.AI_PRIVATE_DATA_APPROVED === "true") {
    if (provider === "gemini") return { mode, generate: gemini(mode) } as const;
    if (provider === "ollama") return { mode, generate: ollama() } as const;
  }
  if (mode === "synthetic" && provider === "gemini") return { mode, generate: gemini(mode) } as const;
  throw new ScreeningError("privacy_guard");
}

export function verifySynthetic(projectId: string, bytes?: Uint8Array, hasQuestions = false) {
  if (projectId !== process.env.AI_SYNTHETIC_PROJECT_ID || hasQuestions) throw new ScreeningError("privacy_guard");
  if (!bytes) return;
  const approved = (process.env.AI_SYNTHETIC_PDF_SHA256 || "").toLowerCase().split(/[,\s]+/);
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (!approved.includes(actual)) throw new ScreeningError("privacy_guard");
}

export async function screenEvidence(
  provider: Provider, resume: string, questions: string[], answers: string[], rubric: Rubric,
  applicant: Pick<Profile, "name" | "student_id">,
  reserve: () => Promise<void>,
) {
  if (!relevantCriteria(rubric.criteria)) throw new ScreeningError("unsupported_rubric");
  const safeResume = redactEvidence(resume, applicant);
  const safeAnswers = answers.map((answer) => redactEvidence(answer, applicant));
  if ((safeResume.text.match(/\p{L}/gu)?.length ?? 0) < 30) throw new ScreeningError("no_readable_text");
  const content = JSON.stringify({
    rubric: rubric.criteria.map(({ id, category, label, description }) => ({ id, category, label, description })),
    evidence: {
      resume: safeResume.text,
      application_answers: safeAnswers.map(({ text }, index) => ({ question: questions[index], answer: text })),
    },
  });
  await reserve();
  try {
    const { text, version } = await provider(content);
    const result = evaluateOutput(JSON.parse(text), rubric, [safeResume.text, ...safeAnswers.map(({ text }) => text)],
      safeResume.suspicious || safeAnswers.some(({ suspicious }) => suspicious));
    return { ...result, model_version: version };
  } catch (error) {
    if (error instanceof InvalidEvaluation || error instanceof SyntaxError) throw new ScreeningError("invalid_model_output", true);
    if (error instanceof ScreeningError) throw error;
    throw new ScreeningError("model_unavailable", true);
  }
}

export function quotaConfig() {
  const integer = (value: string | undefined, fallback: number, maximum: number) => {
    const numeric = Number(value);
    return Number.isSafeInteger(numeric) && numeric > 0 ? Math.min(numeric, maximum) : fallback;
  };
  return {
    p_rpm: integer(process.env.AI_REQUESTS_PER_MINUTE, 2, 60),
    p_rpd: integer(process.env.AI_REQUESTS_PER_DAY, 20, 10000),
  };
}
