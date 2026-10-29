import type { Server } from "bun";
import indexHtml from "../web/index.html";
import { DEFAULT_PORT, bindAvailablePort } from "./listen-port.ts";
import { createSetupController, type SetupController } from "./setup-controller.ts";
import { createWsHub, type WsClientData, type WsHub } from "./ws-hub.ts";

export type StartServerOptions = {
  port?: number;
  openBrowser?: boolean;
};

export type StartedServer = {
  url: string;
  port: number;
  stop: () => Promise<void>;
};

function buildUrl(port: number): string {
  if (port === DEFAULT_PORT) {
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
  const holder: { controller?: SetupController } = {};
  const wsHub = createWsHub({
    getSnapshot: () => {
      if (!holder.controller) {
        throw new Error("Setup controller has not started");
      }
      return holder.controller.getSnapshotMessage();
    },
    handlers: {
      onClientMessage: (msg) => {
        if (!holder.controller) return;
        void holder.controller.handleClientMessage(msg);
      },
    },
  });
  const controller = createSetupController({
    repoRoot: repoPath,
    broadcast: (msg) => wsHub.broadcast(msg),
  });
  holder.controller = controller;

  try {
    await controller.start();
  } catch (err) {
    await controller.stop();
    throw err;
  }

  let server: Server<WsClientData>;
  let port: number;

  try {
    const bound = bindAvailablePort((candidate) => tryListen(candidate, wsHub), {
      port: opts.port,
    });
    server = bound.server;
    port = bound.port;
  } catch (err) {
    await controller.stop();
    throw err;
  }

  const url = buildUrl(port);

  if (opts.openBrowser !== false) {
    void openBrowser(url);
  }

  return {
    url,
    port,
    stop: async () => {
      await controller.stop();
      await server.stop(true);
    },
  };
}
