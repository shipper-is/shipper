/** Fixed-size byte ring buffer for terminal scrollback replay. */
export class ByteRingBuffer {
  private readonly capacity: number;
  private readonly buffer: Uint8Array;
  private head = 0;
  private tail = 0;
  private length = 0;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.buffer = new Uint8Array(capacity);
  }

  get size(): number {
    return this.length;
  }

  append(data: Uint8Array): void {
    for (let i = 0; i < data.length; i++) {
      const byte = data[i]!;
      this.buffer[this.tail] = byte;
      this.tail = (this.tail + 1) % this.capacity;
      if (this.length < this.capacity) {
        this.length += 1;
      } else {
        this.head = (this.head + 1) % this.capacity;
      }
    }
  }

  /** Returns a contiguous copy of buffered bytes in chronological order. */
  replay(): Uint8Array {
    const out = new Uint8Array(this.length);
    for (let i = 0; i < this.length; i++) {
      out[i] = this.buffer[(this.head + i) % this.capacity]!;
    }
    return out;
  }
}
