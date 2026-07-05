import { describe, expect, it } from "vitest";
import { parseCursorModelList } from "./models.ts";

const FIXTURE = `Available models

auto - Auto
gpt-5.3-codex - Codex 5.3
composer-2.5 - Composer 2.5 (current)
claude-opus-4-8-thinking-high - Opus 4.8 1M Thinking
`;

describe("parseCursorModelList", () => {
  it("parses slug lines and skips headers and blanks", () => {
    expect(parseCursorModelList(FIXTURE)).toEqual([
      { id: "auto", label: "Auto" },
      { id: "gpt-5.3-codex", label: "Codex 5.3" },
      { id: "composer-2.5", label: "Composer 2.5 (current)" },
      { id: "claude-opus-4-8-thinking-high", label: "Opus 4.8 1M Thinking" },
    ]);
  });

  it("returns an empty array for header-only output", () => {
    expect(parseCursorModelList("Available models\n\n")).toEqual([]);
  });
});
