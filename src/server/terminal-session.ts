import type { Subprocess } from "bun";
import type { ServerWebSocket } from "bun";
import type { TerminalState } from "../shared/protocol.ts";
import { ByteRingBuffer } from "./byte-ring-buffer.ts";
import type { WsClientData } from "./ws-hub.ts";

export const TERMINAL_SCROLLBACK_BYTES = 200 * 1024;

export function isTerminalAvailable(): boolean {
  return typeof Bun !== "undefined" && typeof Bun.Terminal !== "undefined";
}

export type TerminalSessionDeps = {
  repoPath: string;
  broadcastBinary: (data: Uint8Array) => void;
  sendBinary: (ws: ServerWebSocket<WsClientData>, data: Uint8Array) => void;
  broadcastState: (state: TerminalState) => void;
};

export type TerminalSession = {
  getState: () => TerminalState;
  handleOpen: (ws: ServerWebSocket<WsClientData>) => void;
  handleInput: (data: string) => void;
  handleResize: (cols: number, rows: number) => void;
  shutdown: () => void;
};

export function createTerminalSession(deps: TerminalSessionDeps): TerminalSession {
  const scrollback = new ByteRingBuffer(TERMINAL_SCROLLBACK_BYTES);
  let cols = 80;
  let rows = 24;
  let proc: Subprocess | null = null;
  let shellExited = false;
  let exitMessage: string | null = null;
  let shuttingDown = false;

  const getState = (): TerminalState => {
    if (!isTerminalAvailable()) {
      return {
        available: false,
        active: false,
        message: "Terminal requires Bun 1.3.5+.",
      };
    }
    return {
      available: true,
      active: proc !== null && !shellExited,
      message: exitMessage,
    };
  };

  const broadcastCurrentState = () => {
    deps.broadcastState(getState());
  };

  const appendOutput = (bytes: Uint8Array) => {
    scrollback.append(bytes);
    deps.broadcastBinary(bytes);
  };

  const cleanupProcess = () => {
    proc = null;
    shellExited = true;
  };

  const spawnShell = () => {
    if (!isTerminalAvailable() || shuttingDown) {
      broadcastCurrentState();
      return;
    }

    shellExited = false;
    exitMessage = null;

    const shell = process.env.SHELL ?? "/bin/sh";
    const child = Bun.spawn([shell, "-il"], {
      cwd: deps.repoPath,
      terminal: {
        cols,
        rows,
        name: "xterm-256color",
        data: (_terminal, bytes) => {
          appendOutput(bytes);
        },
      },
    });

    proc = child;

    void child.exited.then((exitCode) => {
      if (proc !== child) {
        return;
      }
      cleanupProcess();
      exitMessage =
        exitCode === 0 ? "Shell exited." : `Shell exited with code ${exitCode}.`;
      broadcastCurrentState();
    });

    broadcastCurrentState();
  };

  const ensureShell = () => {
    if (!proc || shellExited) {
      spawnShell();
    }
  };

  return {
    getState,

    handleOpen(ws) {
      if (!isTerminalAvailable()) {
        broadcastCurrentState();
        return;
      }

      const wasInactive = !proc || shellExited;
      ensureShell();

      const replay = scrollback.replay();
      if (replay.length > 0) {
        deps.sendBinary(ws, replay);
      }

      if (wasInactive && proc) {
        // Fresh shell — prompt may not render until client sends a resize.
      }
    },

    handleInput(data) {
      if (!proc || shellExited || shuttingDown) {
        return;
      }
      proc.terminal?.write(data);
    },

    handleResize(nextCols, nextRows) {
      cols = nextCols;
      rows = nextRows;
      proc?.terminal?.resize(cols, rows);
    },

    shutdown() {
      shuttingDown = true;
      if (proc) {
        proc.kill();
        proc.terminal?.close();
        proc = null;
      }
      shellExited = true;
    },
  };
}
