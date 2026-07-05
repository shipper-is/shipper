import { z } from "zod";
import type { AgentQuestion, AgentQuestionItem } from "./types.ts";

const questionOptionSchema = z
  .object({
    label: z.string(),
    description: z.string().optional(),
  })
  .passthrough();

const questionItemSchema = z
  .object({
    prompt: z.string(),
    header: z.string().optional(),
    multiSelect: z.boolean().optional(),
    options: z.array(questionOptionSchema).min(2).max(4),
  })
  .passthrough();

const questionBlockSchema = z
  .object({
    questions: z.array(questionItemSchema).min(1).max(4),
  })
  .passthrough();

const SHIPPER_QUESTION_FENCE = /```shipper-question\s*\n([\s\S]*?)\n```/g;

export const QUESTION_PROTOCOL_PREAMBLE = `## Shipper question protocol

When you need clarifying input from the user, do NOT use any built-in question, AskQuestion, or AskUserQuestion tool. No UI exists to answer those tools in this environment — they will fail or be auto-skipped.

Instead, ask questions using this protocol:
1. Emit a fenced code block tagged \`shipper-question\` containing JSON with a \`questions\` array.
2. Each question needs a \`prompt\` string, optional \`header\`, optional \`multiSelect\` boolean, and 2–4 \`options\` objects with \`label\` and optional \`description\`.
3. End your turn immediately after the block and wait for the user's reply. Do not proceed until answers arrive.

Example:

\`\`\`shipper-question
{
  "questions": [
    {
      "prompt": "Which filename should I use?",
      "header": "Filename",
      "options": [
        { "label": "hello.ts", "description": "TypeScript entry point" },
        { "label": "hello.js", "description": "Plain JavaScript entry point" }
      ]
    }
  ]
}
\`\`\``;

export function extractQuestionBlocks(text: string): AgentQuestionItem[] | null {
  const matches = [...text.matchAll(SHIPPER_QUESTION_FENCE)];
  if (matches.length === 0) {
    return null;
  }

  const last = matches.at(-1);
  if (!last?.[1]) {
    return null;
  }

  try {
    const parsed = JSON.parse(last[1].trim());
    const result = questionBlockSchema.safeParse(parsed);
    if (!result.success) {
      return null;
    }
    return result.data.questions as AgentQuestionItem[];
  } catch {
    return null;
  }
}

export function formatAnswers(
  question: AgentQuestion,
  answers: Record<string, string | string[]>,
): string {
  const lines: string[] = ["Here are my answers:"];

  for (const item of question.questions) {
    const raw = answers[item.prompt];
    if (raw === undefined) {
      continue;
    }
    const value = Array.isArray(raw) ? raw.join(", ") : raw;
    lines.push(`${item.prompt} ${value}`);
  }

  return lines.join("\n");
}

export function claudeQuestionPreamble(): string {
  return `## Clarifying questions

When you need clarifying input, use your native AskUserQuestion tool. Do not guess — ask up to four multiple-choice questions with 2–4 options each.`;
}
