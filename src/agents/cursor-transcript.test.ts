import { describe, expect, it } from "vitest";
import { cursorProjectSlug, cursorTranscriptPath } from "./cursor-transcript.ts";

describe("cursorTranscriptPath", () => {
  it("derives the Cursor project slug from an absolute repo path", () => {
    expect(cursorProjectSlug("/Users/matt/Documents/shipper")).toBe(
      "Users-matt-Documents-shipper",
    );
    expect(cursorProjectSlug("/private/tmp/shipper-fixture-capture")).toBe(
      "private-tmp-shipper-fixture-capture",
    );
  });

  it("builds the transcript file path from repo path and session id", () => {
    const path = cursorTranscriptPath(
      "/Users/matt/Documents/shipper",
      "733a65dc-a08c-4357-9e8f-d3e634b0e48e",
    );
    expect(path).toMatch(
      /\.cursor\/projects\/Users-matt-Documents-shipper\/agent-transcripts\/733a65dc-a08c-4357-9e8f-d3e634b0e48e\/733a65dc-a08c-4357-9e8f-d3e634b0e48e\.jsonl$/,
    );
  });
});
