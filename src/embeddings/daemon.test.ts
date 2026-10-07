import { describe, expect, it } from "vitest";
import { shouldShutDown } from "./daemon.ts";

describe("shouldShutDown", () => {
  it("returns false while still within the idle window", () => {
    const lastUsed = 1_000_000;
    expect(shouldShutDown(lastUsed, lastUsed + 14 * 60_000, 15)).toBe(false);
    expect(shouldShutDown(lastUsed, lastUsed + 15 * 60_000, 15)).toBe(false);
  });

  it("returns true once idle minutes have elapsed", () => {
    const lastUsed = 1_000_000;
    expect(shouldShutDown(lastUsed, lastUsed + 15 * 60_000 + 1, 15)).toBe(true);
    expect(shouldShutDown(lastUsed, lastUsed + 60_000 + 1, 1)).toBe(true);
  });
});
