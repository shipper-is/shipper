import { describe, expect, it } from "vitest";
import { parseClientMessage } from "./protocol.ts";

describe("parseClientMessage", () => {
  it("accepts the setup console messages", () => {
    expect(parseClientMessage({ type: "refresh" })).toEqual({ type: "refresh" });
    expect(
      parseClientMessage({
        type: "save-config",
        layer: "repo",
        value: { git: { branchMode: "feature" }, extra: true },
      }),
    ).toEqual({
      type: "save-config",
      layer: "repo",
      value: { git: { branchMode: "feature" }, extra: true },
    });
    expect(
      parseClientMessage({
        type: "run-action",
        action: { kind: "sync-index", force: true },
      }),
    ).toEqual({
      type: "run-action",
      action: { kind: "sync-index", force: true },
    });
    expect(parseClientMessage({ type: "list-models", agent: "cursor" })).toEqual({
      type: "list-models",
      agent: "cursor",
    });
    expect(parseClientMessage({ type: "run-action", action: { kind: "install-mcp" } })).toEqual({
      type: "run-action",
      action: { kind: "install-mcp" },
    });
  });

  it("drops invalid messages", () => {
    expect(parseClientMessage(null)).toBeNull();
    expect(parseClientMessage({ type: "hello" })).toBeNull();
    expect(parseClientMessage({ type: "run-action", action: { kind: "sync-index" } })).toBeNull();
    expect(parseClientMessage({ type: "save-config", layer: "nope", value: {} })).toBeNull();
    expect(parseClientMessage({ type: "list-models", agent: "vim" })).toBeNull();
  });
});
