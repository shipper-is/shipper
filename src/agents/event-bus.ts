import type { AgentEvent } from "./types.ts";

export class QuestionGate {
  private pending = new Map<
    string,
    {
      resolve: (answers: Record<string, string | string[]>) => void;
      reject: (error: Error) => void;
    }
  >();

  wait(id: string): Promise<Record<string, string | string[]>> {
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
  }

  answer(id: string, answers: Record<string, string | string[]>): void {
    const entry = this.pending.get(id);
    if (!entry) {
      return;
    }
    this.pending.delete(id);
    entry.resolve(answers);
  }

  cancelAll(reason = "Run cancelled"): void {
    for (const [id, entry] of this.pending) {
      entry.reject(new Error(reason));
      this.pending.delete(id);
    }
  }
}

export class AgentEventBus {
  private buffer: AgentEvent[] = [];
  private waiter: ((value: IteratorResult<AgentEvent, void>) => void) | null = null;
  private closed = false;

  push(event: AgentEvent): void {
    if (this.closed) {
      return;
    }
    if (this.waiter) {
      const resolve = this.waiter;
      this.waiter = null;
      resolve({ value: event, done: false });
      return;
    }
    this.buffer.push(event);
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    if (this.waiter) {
      const resolve = this.waiter;
      this.waiter = null;
      resolve({ value: undefined, done: true });
    }
  }

  async *iterate(): AsyncGenerator<AgentEvent, void> {
    while (true) {
      if (this.buffer.length > 0) {
        yield this.buffer.shift()!;
        continue;
      }
      if (this.closed) {
        return;
      }
      const next = await new Promise<IteratorResult<AgentEvent, void>>((resolve) => {
        this.waiter = resolve;
      });
      if (next.done) {
        return;
      }
      yield next.value!;
    }
  }
}

export function createQuestionId(): string {
  return crypto.randomUUID();
}
