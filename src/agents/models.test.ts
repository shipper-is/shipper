import { describe, expect, it } from "vitest";
import type { AgentKind } from "./types.ts";
import {
  formatModelCatalog,
  modelCatalogJson,
  parseCursorModelList,
  type ModelOption,
} from "./models.ts";

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

describe("model catalog formatting", () => {
  const catalog: Partial<Record<AgentKind, ModelOption[]>> = {
    opencode: [{ id: "anthropic/claude-sonnet", label: "Claude Sonnet" }],
    cursor: [{ id: "composer-2.5", label: "Composer 2.5" }],
    claude: [{ id: "claude-opus-5-5-high", label: "Opus" }],
  };

  it("prints agents in harness order with an id and a label", () => {
    expect(formatModelCatalog(catalog)).toBe(
      [
        "claude",
        "  claude-opus-5-5-high\tOpus",
        "cursor",
        "  composer-2.5\tComposer 2.5",
        "opencode",
        "  anthropic/claude-sonnet\tClaude Sonnet",
      ].join("\n"),
    );
    expect(formatModelCatalog({})).toBe("");
  });

  it("prints pretty JSON with id and label only, in harness order", () => {
    expect(modelCatalogJson(catalog)).toBe(
      JSON.stringify(
        {
          agents: {
            claude: [{ id: "claude-opus-5-5-high", label: "Opus" }],
            cursor: [{ id: "composer-2.5", label: "Composer 2.5" }],
            opencode: [{ id: "anthropic/claude-sonnet", label: "Claude Sonnet" }],
          },
        },
        null,
        2,
      ),
    );
    expect(JSON.parse(modelCatalogJson({}))).toEqual({ agents: {} });
  });
});
