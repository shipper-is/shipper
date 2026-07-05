import { describe, expect, it } from "vitest";
import { formatFeedTail } from "./feed-utils.ts";

describe("formatFeedTail", () => {
  it("replaces tool-start lines in place when tool-end arrives", () => {
    const lines = formatFeedTail([
      { type: "tool-start", callId: "1", name: "read", summary: "file.ts" },
      {
        type: "tool-end",
        callId: "1",
        name: "read",
        summary: "file.ts",
        ok: true,
        resultSummary: "Read 10 lines",
      },
    ]);

    expect(lines).toEqual(["[tool] ✓ read: file.ts (Read 10 lines)"]);
  });
});
