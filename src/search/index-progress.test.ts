import { describe, expect, it } from "vitest";
import { createIndexProgressWriter, formatIndexProgress } from "./index-progress.ts";

describe("formatIndexProgress", () => {
  it("formats each phase", () => {
    expect(formatIndexProgress({ phase: "scan", current: 1, total: null })).toBe("Scanning… 1 file");
    expect(formatIndexProgress({ phase: "scan", current: 4, total: null })).toBe(
      "Scanning… 4 files",
    );
    expect(formatIndexProgress({ phase: "scan", current: 4, total: 4 })).toBe("Scanning 4 files");
    expect(formatIndexProgress({ phase: "read", current: 2, total: 9 })).toBe("Reading files 2/9");
    expect(formatIndexProgress({ phase: "embed", current: 16, total: 40 })).toBe(
      "Embedding chunks 16/40",
    );
    expect(formatIndexProgress({ phase: "write", current: 1, total: 1 })).toBe("Writing index…");
  });
});

describe("createIndexProgressWriter", () => {
  it("overwrites a single tty line and ends it", () => {
    const chunks: string[] = [];
    const writer = createIndexProgressWriter({
      tty: true,
      write: (chunk) => chunks.push(chunk),
    });
    writer.update({ phase: "read", current: 1, total: 3 });
    writer.update({ phase: "read", current: 2, total: 3 });
    writer.finish();
    expect(chunks).toEqual([
      "\r\x1b[2KReading files 1/3",
      "\r\x1b[2KReading files 2/3",
      "\n",
    ]);
  });

  it("throttles piped output and does not add a trailing blank line", () => {
    const lines: string[] = [];
    const writer = createIndexProgressWriter({
      tty: false,
      write: (chunk) => lines.push(chunk),
    });
    for (let current = 1; current <= 30; current++) {
      writer.update({ phase: "scan", current, total: null });
    }
    writer.update({ phase: "scan", current: 30, total: 30 });
    for (let current = 0; current <= 40; current++) {
      writer.update({ phase: "embed", current, total: 40 });
    }
    writer.finish();

    expect(lines.filter((line) => line.startsWith("Scanning"))).toEqual([
      "Scanning… 1 file\n",
      "Scanning… 25 files\n",
      "Scanning 30 files\n",
    ]);
    expect(lines.filter((line) => line.startsWith("Embedding"))).toEqual([
      "Embedding chunks 0/40\n",
      "Embedding chunks 2/40\n",
      "Embedding chunks 4/40\n",
      "Embedding chunks 6/40\n",
      "Embedding chunks 8/40\n",
      "Embedding chunks 10/40\n",
      "Embedding chunks 12/40\n",
      "Embedding chunks 14/40\n",
      "Embedding chunks 16/40\n",
      "Embedding chunks 18/40\n",
      "Embedding chunks 20/40\n",
      "Embedding chunks 22/40\n",
      "Embedding chunks 24/40\n",
      "Embedding chunks 26/40\n",
      "Embedding chunks 28/40\n",
      "Embedding chunks 30/40\n",
      "Embedding chunks 32/40\n",
      "Embedding chunks 34/40\n",
      "Embedding chunks 36/40\n",
      "Embedding chunks 38/40\n",
      "Embedding chunks 40/40\n",
    ]);
  });
});
