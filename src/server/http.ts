import type { Server } from "bun";
import indexHtml from "../web/index.html";
import { getVersion } from "../version.ts";
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
  const wsHub = createWsHub({
    getSnapshot: () => ({
      type: "hello",
      repoPath,
      version: getVersion(),
    }),
  });

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
      await server.stop(true);
    },
  };
}
