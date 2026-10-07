export type IndexProgressPhase = "scan" | "read" | "embed" | "write";

export type IndexProgress = {
  phase: IndexProgressPhase;
  current: number;
  total: number | null;
};

type ProgressMark = {
  phase: IndexProgressPhase;
  current: number;
  total: number | null;
  pct: number;
};

function fileWord(count: number): string {
  return count === 1 ? "file" : "files";
}

function percent(progress: IndexProgress): number {
  if (progress.total === null || progress.total <= 0) {
    return -1;
  }
  return Math.min(100, Math.round((progress.current / progress.total) * 100));
}

export function formatIndexProgress(progress: IndexProgress): string {
  switch (progress.phase) {
    case "scan":
      if (progress.total === null) {
        return `Scanning… ${progress.current} ${fileWord(progress.current)}`;
      }
      return `Scanning ${progress.current} ${fileWord(progress.current)}`;
    case "read":
      return `Reading files ${progress.current}/${progress.total ?? progress.current}`;
    case "embed":
      return `Embedding chunks ${progress.current}/${progress.total ?? progress.current}`;
    case "write":
      return "Writing index…";
  }
}

/** Non-TTY consumers (piped logs, MCP stderr) should not print every file. */
export function shouldReportIndexProgress(
  prev: ProgressMark | null,
  next: IndexProgress,
): boolean {
  if (!prev || prev.phase !== next.phase) {
    return true;
  }
  if (next.total !== null && next.current >= next.total) {
    return prev.current !== next.current || prev.total !== next.total;
  }
  if (next.total === null) {
    return next.current === 1 || (next.current > 0 && next.current % 25 === 0);
  }
  const pct = percent(next);
  return pct === 100 || pct - prev.pct >= 5;
}

function mark(progress: IndexProgress): ProgressMark {
  return {
    phase: progress.phase,
    current: progress.current,
    total: progress.total,
    pct: percent(progress),
  };
}

export type IndexProgressWriter = {
  update(progress: IndexProgress): void;
  finish(): void;
};

export function createIndexProgressWriter(opts: {
  tty: boolean;
  write: (chunk: string) => void;
}): IndexProgressWriter {
  let printed = false;
  let last: ProgressMark | null = null;
  return {
    update(progress) {
      const line = formatIndexProgress(progress);
      if (opts.tty) {
        opts.write(`\r\x1b[2K${line}`);
        printed = true;
        return;
      }
      if (!shouldReportIndexProgress(last, progress)) {
        return;
      }
      last = mark(progress);
      opts.write(`${line}\n`);
      printed = true;
    },
    finish() {
      if (printed && opts.tty) {
        opts.write("\n");
      }
    },
  };
}
