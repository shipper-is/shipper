import { describe, expect, it } from "vitest";
import {
  QUESTION_PROTOCOL_PREAMBLE,
  extractQuestionBlocks,
  formatAnswers,
} from "./question-protocol.ts";
import type { AgentQuestion } from "./types.ts";

describe("extractQuestionBlocks", () => {
  it("parses a valid shipper-question fenced block", () => {
    const text = `I need your input before continuing.

\`\`\`shipper-question
{
  "questions": [
    {
      "prompt": "Which filename?",
      "header": "Name",
      "options": [
        { "label": "a.ts" },
        { "label": "b.ts" }
      ]
    }
  ]
}
\`\`\``;

    const items = extractQuestionBlocks(text);
    expect(items).toHaveLength(1);
    expect(items?.[0]?.prompt).toBe("Which filename?");
    expect(items?.[0]?.options).toHaveLength(2);
  });

  it("returns the last block when multiple are present", () => {
    const text = `\`\`\`shipper-question
{"questions":[{"prompt":"Old?","options":[{"label":"x"},{"label":"y"}]}]}
\`\`\`

\`\`\`shipper-question
{"questions":[{"prompt":"New?","options":[{"label":"1"},{"label":"2"}]}]}
\`\`\``;

    expect(extractQuestionBlocks(text)?.[0]?.prompt).toBe("New?");
  });

  it("returns null for invalid JSON or schema", () => {
    expect(extractQuestionBlocks("no block here")).toBeNull();
    expect(
      extractQuestionBlocks('```shipper-question\n{"questions":[]}\n```'),
    ).toBeNull();
  });
});

describe("formatAnswers", () => {
  it("renders one line per question", () => {
    const question: AgentQuestion = {
      id: "q1",
      questions: [
        {
          prompt: "Which filename?",
          options: [{ label: "a.ts" }, { label: "b.ts" }],
        },
        {
          prompt: "Add tests?",
          multiSelect: true,
          options: [{ label: "Yes" }, { label: "No" }],
        },
      ],
    };

    const text = formatAnswers(question, {
      "Which filename?": "a.ts",
      "Add tests?": ["Yes", "No"],
    });

    expect(text).toContain("Which filename? a.ts");
    expect(text).toContain("Add tests? Yes, No");
  });
});

describe("QUESTION_PROTOCOL_PREAMBLE", () => {
  it("tells agents not to use built-in question tools", () => {
    expect(QUESTION_PROTOCOL_PREAMBLE).toMatch(/do NOT use/i);
    expect(QUESTION_PROTOCOL_PREAMBLE).toContain("shipper-question");
  });
});
