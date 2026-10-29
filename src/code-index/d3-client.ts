import { z } from "zod";

type FetchFn = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type D3Question =
  | { type: "choice"; instructions: string; criteria: Record<string, string | null> }
  | { type: "noul"; instructions: string; criteria?: { true?: string; false?: string } }
  | { type: "score"; instructions: string; criteria: string[] };

const probabilities = z.record(z.string(), z.number());

const answerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("choice"), choice: z.string(), probabilities }),
  z.object({ type: z.literal("noul"), noul: z.number() }),
  z.object({ type: z.literal("score"), score: z.number(), probabilities }),
]);

const responseSchema = z.object({
  answers: z.record(z.string(), answerSchema),
  usage: z.object({ input_tokens: z.number().optional() }).optional(),
});

export type D3Answer = z.infer<typeof answerSchema>;

export class D3RequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
    this.name = "D3RequestError";
  }
}

/** Accepts a server root (`http://127.0.0.1:8080`) or the full endpoint URL. */
export function systemOneUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  return trimmed.endsWith("/v1/systemone") ? trimmed : `${trimmed}/v1/systemone`;
}

export async function askD3(opts: {
  baseUrl: string;
  state: string;
  questions: Record<string, D3Question>;
  /** Required by servers that host several models (Ollama, vLLM Semantic Router). */
  model?: string;
  fetchFn?: FetchFn;
  timeoutMs?: number;
}): Promise<{ answers: Record<string, D3Answer>; inputTokens: number | null }> {
  const fetchFn = opts.fetchFn ?? fetch;
  const body: Record<string, unknown> = { state: opts.state, questions: opts.questions };
  if (opts.model) {
    body["model"] = opts.model;
  }
  const response = await fetchFn(systemOneUrl(opts.baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 120_000),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new D3RequestError(
      `d3 request failed: ${response.status} ${response.statusText}${text ? ` — ${text.slice(0, 500)}` : ""}`,
      response.status,
      text,
    );
  }
  const parsed = responseSchema.parse(await response.json());
  for (const key of Object.keys(opts.questions)) {
    if (!parsed.answers[key]) {
      throw new Error(`d3 response is missing an answer for "${key}"`);
    }
  }
  return { answers: parsed.answers, inputTokens: parsed.usage?.input_tokens ?? null };
}
