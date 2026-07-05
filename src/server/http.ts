import type { Server } from "bun";
import indexHtml from "../web/index.html";
import { createPlansWatcher } from "./plans-watcher.ts";
import {
  createRunController,
  enrichConfigInfo,
  type RunController,
} from "./run-controller.ts";
import { createTerminalSession } from "./terminal-session.ts";
import {
  buildConfigInfo,
  createWsHub,
  type WsClientData,
  type WsHub,
} from "./ws-hub.ts";
import type { ConfigInfo, PlansSnapshot, ServerMessage } from "../shared/protocol.ts";

export type StartServerOptions = {
  port?: number;
  openBrowser?: boolean;
  demoMode?: boolean;
};

export type StartedServer = {
  url: string;
  port: number;
  stop: () => Promise<void>;
  runController: RunController;
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
  let configInfo: ConfigInfo = await enrichConfigInfo(repoPath, await buildConfigInfo(repoPath));

  const broadcast = (msg: ServerMessage) => {
    wsHubRef.current?.broadcast(msg);
  };

  const terminalSession = createTerminalSession({
    repoPath,
    broadcastBinary: (data) => {
      wsHubRef.current?.broadcastBinary(data);
    },
    sendBinary: (ws, data) => {
      wsHubRef.current?.sendBinary(ws, data);
    },
    broadcastState: (terminalState) => {
      broadcast({ type: "terminal-state", terminalState });
    },
  });

  const refreshConfigInfo = async (): Promise<ConfigInfo> => {
    configInfo = await enrichConfigInfo(repoPath, await buildConfigInfo(repoPath));
    return configInfo;
  };

  const plansWatcher = createPlansWatcher(repoPath, (updated) => {
    plans = updated;
    broadcast({ type: "plans-updated", plans: updated });
  });

  const wsHubRef: { current: WsHub | null } = { current: null };

  const runController = createRunController({
    repoPath,
    getAgent: () => configInfo.defaultAgent,
    getConfigInfo: () => configInfo,
    refreshConfigInfo,
    onBroadcast: broadcast,
    onPlanUpdate: () => {
      void plansWatcher.refresh().then((updated) => {
        plans = updated;
        broadcast({ type: "plans-updated", plans: updated });
      });
    },
  });

  const wsHub = createWsHub({
    getPlans: () => plans,
    getRunState: () => runController.getRunState(),
    getChatEntries: () => runController.getChatEntries(),
    getPendingQuestion: () => runController.getPendingQuestion(),
    getModelPickRequest: () => runController.getModelPickRequest(),
    getQueuedMessages: () => runController.getQueuedMessages(),
    getConfigInfo: () => configInfo,
    getTerminalState: () => terminalSession.getState(),
    handlers: {
      onClientMessage(msg, ws) {
        switch (msg.type) {
          case "terminal-open":
            terminalSession.handleOpen(ws);
            break;
          case "terminal-input":
            terminalSession.handleInput(msg.data);
            break;
          case "terminal-resize":
            terminalSession.handleResize(msg.cols, msg.rows);
            break;
          case "save-plan": {
            const run = runController.getRunState();
            if (run.status !== "idle") {
              broadcast({ type: "notice", text: "Cannot edit a plan while an agent is running." });
              break;
            }
            void plansWatcher.savePlan(msg.planFilename, msg.markdown).then((result) => {
              if (!result.ok) {
                broadcast({ type: "notice", text: result.error });
              }
            });
            break;
          }
          default:
            runController.handleClientMessage(msg);
            break;
        }
      },
    },
  });
  wsHubRef.current = wsHub;

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

  if (opts.demoMode) {
    runController.startDemo();
  }

  return {
    url,
    port,
    runController,
    stop: async () => {
      runController.shutdown();
      terminalSession.shutdown();
      await plansWatcher.stop();
      await server.stop(true);
    },
  };
}
