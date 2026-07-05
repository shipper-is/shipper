#!/usr/bin/env bun
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createAdapter } from "../src/agents/index.ts";
import type { AgentKind, AgentQuestion } from "../src/agents/types.ts";
import { QUESTION_PROTOCOL_PREAMBLE } from "../src/agents/question-protocol.ts";

const USAGE = `Usage: bun scripts/try-adapter.ts <claude|cursor|opencode> "<prompt>" [model]`;

async function promptForAnswers(question: AgentQuestion): Promise<Record<string, string | string[]>> {
  const rl = createInterface({ input, output });
  const answers: Record<string, string | string[]> = {};

  try {
    for (const item of question.questions) {
      output.write(`\n${item.prompt}\n`);
      item.options.forEach((option, index) => {
        const desc = option.description ? ` — ${option.description}` : "";
        output.write(`  ${index + 1}. ${option.label}${desc}\n`);
      });
      output.write(`  0. Other (free text)\n`);

      const raw = await rl.question("> ");
      if (raw.trim() === "0") {
        const other = await rl.question("Other: ");
        answers[item.prompt] = other.trim();
        continue;
      }

      if (item.multiSelect) {
        const picks = raw
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean)
          .map((v) => {
            const index = Number(v) - 1;
            return Number.isInteger(index) && item.options[index]
              ? item.options[index]!.label
              : v;
          });
        answers[item.prompt] = picks;
      } else {
        const index = Number(raw.trim()) - 1;
        answers[item.prompt] =
          Number.isInteger(index) && item.options[index]
            ? item.options[index]!.label
            : raw.trim();
      }
    }
  } finally {
    rl.close();
  }

  return answers;
}

async function main(): Promise<void> {
  const agentArg = process.argv[2];
  const promptArg = process.argv[3]?.trim();
  const modelArg = process.argv[4]?.trim();

  if (!agentArg || !promptArg) {
    console.error(USAGE);
    process.exit(1);
  }

  const agent = agentArg as AgentKind;
  if (!["claude", "cursor", "opencode"].includes(agent)) {
    console.error(USAGE);
    process.exit(1);
  }

  const scratchDir = await mkdtemp(join(tmpdir(), "shipper-adapter-"));
  const adapter = createAdapter(agent);

  const wrappedPrompt =
    agent === "claude"
      ? promptArg
      : `${QUESTION_PROTOCOL_PREAMBLE}\n\n${promptArg}`;

  console.error(`Scratch directory: ${scratchDir}`);
  console.error(`Agent: ${agent}`);
  if (modelArg) {
    console.error(`Model: ${modelArg}`);
  }
  console.error("---");

  const stream = adapter.start({
    cwd: scratchDir,
    prompt: wrappedPrompt,
    ...(modelArg ? { model: modelArg } : {}),
  });

  for await (const event of stream) {
    console.log(JSON.stringify(event));

    if (event.type === "question") {
      const answers = await promptForAnswers(event.question);
      adapter.answer(event.question.id, answers);
    }
  }

  await adapter.stop();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
