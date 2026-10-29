import { decisionState, type CardMode, type Decision } from "./cards.ts";
import { askD3, D3RequestError, type D3Answer, type D3Question } from "./d3-client.ts";
import type { CodeSymbol } from "./extract.ts";

const MIN_CAPABILITY_P = 0.12;
const MAX_CAPABILITIES = 3;
/** Code tokenizes at roughly 3–4 characters per token; stay on the short side. */
const CHARS_PER_TOKEN = 2.8;
const PROMPT_FRAME_TOKENS = 160;
const SHRINK_FACTOR = 0.6;
const MAX_ATTEMPTS = 4;

function topChoice(answer: D3Answer | undefined): { key: string; p: number } {
  if (answer?.type !== "choice") {
    throw new Error("expected a choice answer");
  }
  return { key: answer.choice, p: answer.probabilities[answer.choice] ?? 0 };
}

function normalizedScore(answer: D3Answer | undefined, levels: number): number {
  if (answer?.type !== "score") {
    throw new Error("expected a score answer");
  }
  return levels > 1 ? Math.min(1, Math.max(0, answer.score / (levels - 1))) : 0;
}

function keptCapabilities(answer: D3Answer | undefined): Array<{ key: string; p: number }> {
  if (answer?.type !== "choice") {
    throw new Error("expected a choice answer for capability");
  }
  const ranked = Object.entries(answer.probabilities)
    .filter(([key]) => key !== "other")
    .sort((a, b) => b[1] - a[1]);
  let kept = ranked.filter(([, p]) => p >= MIN_CAPABILITY_P).slice(0, MAX_CAPABILITIES);
  if (kept.length === 0 && answer.choice !== "other" && ranked[0]) {
    kept = [ranked[0]];
  }
  return kept.map(([key, p]) => ({ key, p }));
}

export function toDecision(answers: Record<string, D3Answer>, questions: Record<string, D3Question>): Decision {
  const levels = (key: string) => {
    const question = questions[key];
    return question?.type === "score" ? question.criteria.length : 0;
  };

  return {
    role: topChoice(answers["role"]),
    capabilities: keptCapabilities(answers["capability"]),
    effects: topChoice(answers["effects"]),
    reuse: normalizedScore(answers["reuse"], levels("reuse")),
    convention: normalizedScore(answers["convention"], levels("convention")),
  };
}

/** Role, capability, and effects for a search query. Reuse and convention do not apply. */
export function toQueryDecision(answers: Record<string, D3Answer>): Decision {
  return {
    role: topChoice(answers["role"]),
    capabilities: keptCapabilities(answers["capability"]),
    effects: topChoice(answers["effects"]),
    reuse: 0,
    convention: 0,
  };
}

export async function classifyQuery(opts: {
  baseUrl: string;
  model?: string;
  query: string;
  questions: Record<string, D3Question>;
  ask?: typeof askD3;
}): Promise<Decision> {
  const ask = opts.ask ?? askD3;
  const { answers } = await ask({
    baseUrl: opts.baseUrl,
    model: opts.model,
    state: opts.query,
    questions: opts.questions,
  });
  return toQueryDecision(answers);
}

function optionText(question: D3Question): string {
  if (question.type === "choice") {
    return Object.entries(question.criteria)
      .map(([key, description]) => `AA: ${key}${description ? `: ${description}` : ""}`)
      .join("\n");
  }
  if (question.type === "score") {
    return question.criteria.map((level) => `AA: ${level}`).join("\n");
  }
  return "AA: No / false\nAB: Yes / true";
}

/**
 * Characters of state that fit next to the largest question. Each question is a separate prompt of
 * state + question + options, and the whole prompt has to fit in one llama.cpp micro-batch.
 */
export function stateCharBudget(questions: Record<string, D3Question>, ubatchTokens: number): number {
  const largestQuestionChars = Math.max(
    ...Object.values(questions).map((q) => q.instructions.length + optionText(q).length),
  );
  const questionTokens = Math.ceil(largestQuestionChars / CHARS_PER_TOKEN) + PROMPT_FRAME_TOKENS;
  return Math.max(0, Math.floor((ubatchTokens - questionTokens) * CHARS_PER_TOKEN));
}

export type SymbolDecision = {
  decision: Decision;
  mode: CardMode;
  stateChars: number;
  inputTokens: number | null;
  attempts: number;
  ms: number;
};

function isRetryableSizeError(err: unknown): boolean {
  return err instanceof D3RequestError && err.status !== 404 && err.status !== 501 && err.status < 600;
}

/** Ask every question about one symbol, shrinking the state if the server rejects it as too long. */
export async function decideSymbol(opts: {
  baseUrl: string;
  model?: string;
  symbol: CodeSymbol;
  questions: Record<string, D3Question>;
  stateChars: number;
  ask?: typeof askD3;
}): Promise<SymbolDecision> {
  const ask = opts.ask ?? askD3;
  const started = Date.now();
  let budget = opts.stateChars;
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const state = decisionState(opts.symbol, budget);
    try {
      const { answers, inputTokens } = await ask({
        baseUrl: opts.baseUrl,
        model: opts.model,
        state: state.text,
        questions: opts.questions,
      });
      return {
        decision: toDecision(answers, opts.questions),
        mode: state.mode,
        stateChars: state.text.length,
        inputTokens,
        attempts: attempt,
        ms: Date.now() - started,
      };
    } catch (err) {
      lastError = err;
      if (!isRetryableSizeError(err) || state.mode === "header") {
        break;
      }
      budget = Math.floor(Math.min(budget, state.text.length) * SHRINK_FACTOR);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
