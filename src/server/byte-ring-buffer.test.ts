import { describe, expect, it } from "vitest";
import { ByteRingBuffer } from "./byte-ring-buffer.ts";

function bytes(...values: number[]): Uint8Array {
  return Uint8Array.from(values);
}

describe("ByteRingBuffer", () => {
  it("replays appended bytes in order when under capacity", () => {
    const buffer = new ByteRingBuffer(8);
    buffer.append(bytes(1, 2, 3));
    buffer.append(bytes(4));

    expect(Array.from(buffer.replay())).toEqual([1, 2, 3, 4]);
    expect(buffer.size).toBe(4);
  });

  it("drops oldest bytes when overflowing capacity", () => {
    const buffer = new ByteRingBuffer(4);
    buffer.append(bytes(1, 2, 3, 4));
    buffer.append(bytes(5, 6));

    expect(Array.from(buffer.replay())).toEqual([3, 4, 5, 6]);
    expect(buffer.size).toBe(4);
  });

  it("handles wrap-around replay ordering", () => {
    const buffer = new ByteRingBuffer(3);
    buffer.append(bytes(10));
    buffer.append(bytes(20));
    buffer.append(bytes(30));
    buffer.append(bytes(40));
    buffer.append(bytes(50, 60));

    expect(Array.from(buffer.replay())).toEqual([40, 50, 60]);
  });

  it("returns an empty replay for a new buffer", () => {
    const buffer = new ByteRingBuffer(16);
    expect(buffer.replay()).toEqual(new Uint8Array(0));
  });
});
