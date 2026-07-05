import type { Server } from "bun";
import indexHtml from "../web/index.html";
import { createPlansWatcher } from "./plans-watcher.ts";
import {
  buildConfigInfo,
  createWsHub,
  defaultTerminalState,
  idleRunState,
  type WsClientData,
  type WsHub,
} from "./ws-hub.ts";
import type { PlansSnapshot, ServerMessage } from "../shared/protocol.ts";

export type StartServerOptions = {
  port?: number;
  openBrowser?: boolean;
  demoMode?: boolean;
};

export type StartedServer = {
  url: string;
  port: number;
  stop: () => Promise<void>;
};

const DEFAULT_PORT = 80;
const FALLBACK_PORT = 8712;

function buildUrl(port: number): string {
  if (port === 80) {
    return "http://shipper.localhost";
  }
  return `http://shipper.localhost:${port}`;
}

function isRunningUnderBun(): boolean {
  return process.execPath.includes("bun");
}

async function openBrowser(url: string): Promise<void> {
  const platform = process.platform;
  if (platform === "darwin") {
    Bun.spawn(["open", url], { stdout: "ignore", stderr: "ignore" });
    return;
  }
  if (platform === "linux") {
    Bun.spawn(["xdg-open", url], { stdout: "ignore", stderr: "ignore" });
  }
}

function tryListen(port: number, wsHub: WsHub): Server<WsClientData> {
  return Bun.serve<WsClientData>({
    hostname: "127.0.0.1",
    port,
    routes: {
      "/": indexHtml,
    },
    fetch(req, server) {
      const pathname = new URL(req.url).pathname;
      if (pathname === "/ws") {
        if (wsHub.handleUpgrade(req, server)) {
          return undefined as unknown as Response;
        }
        return new Response("WebSocket upgrade failed", { status: 500 });
      }
      return new Response("Not Found", { status: 404 });
    },
    websocket: wsHub.websocket,
    development: isRunningUnderBun() ? { hmr: true, console: true } : undefined,
    idleTimeout: 0,
  });
}

export async function startServer(
  repoPath: string,
  opts: StartServerOptions = {},
): Promise<StartedServer> {
  let plans: PlansSnapshot = { open: [], done: [] };
  const configInfo = await buildConfigInfo(repoPath);
  const terminalState = defaultTerminalState();

  const broadcast = (msg: ServerMessage) => {
    wsHub.broadcast(msg);
  };

  const plansWatcher = createPlansWatcher(repoPath, (updated) => {
    plans = updated;
    broadcast({ type: "plans-updated", plans: updated });
  });

  const wsHub = createWsHub({
    getPlans: () => plans,
    getRunState: () => idleRunState(),
    getChatEntries: () => [],
    getConfigInfo: () => configInfo,
    getTerminalState: () => terminalState,
    handlers: {
      onClientMessage(msg) {
        if (msg.type === "terminal-open") {
          broadcast({
            type: "terminal-state",
            terminalState: {
              ...terminalState,
              message: "Terminal support arrives in Phase 4.",
            },
          });
        }
      },
    },
  });

  await plansWatcher.start();
  plans = plansWatcher.getPlans();

  const preferredPort = opts.port ?? DEFAULT_PORT;
  let server: Server<WsClientData>;
  let port = preferredPort;

  try {
    server = tryListen(port, wsHub);
  } catch (err) {
    if (opts.port !== undefined) {
      throw err;
    }
    port = FALLBACK_PORT;
    server = tryListen(port, wsHub);
  }

  const url = buildUrl(port);

  if (opts.openBrowser !== false) {
    void openBrowser(url);
  }

  return {
    url,
    port,
    stop: async () => {
      await plansWatcher.stop();
      await server.stop(true);
    },
  };
}
