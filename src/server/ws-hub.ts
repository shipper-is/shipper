import type { Server, ServerWebSocket } from "bun";
import {
  parseClientMessage,
  type ClientMessage,
  type ServerMessage,
} from "../shared/protocol.ts";

export type WsClientData = {
  id: string;
};

export type WsMessageHandlers = {
  onClientMessage?: (msg: ClientMessage, ws: ServerWebSocket<WsClientData>) => void;
};

export type WsHubDeps = {
  getSnapshot: () => ServerMessage;
  handlers?: WsMessageHandlers;
};

export type WsHub = {
  websocket: {
    open: (ws: ServerWebSocket<WsClientData>) => void;
    message: (ws: ServerWebSocket<WsClientData>, message: string | Buffer) => void;
    close: (ws: ServerWebSocket<WsClientData>) => void;
  };
  handleUpgrade: (req: Request, server: Server<WsClientData>) => boolean;
  broadcast: (msg: ServerMessage) => void;
  clientCount: () => number;
};

export function createWsHub(deps: WsHubDeps): WsHub {
  const sockets = new Set<ServerWebSocket<WsClientData>>();

  const send = (ws: ServerWebSocket<WsClientData>, msg: ServerMessage) => {
    ws.send(JSON.stringify(msg));
  };

  const broadcast = (msg: ServerMessage) => {
    const payload = JSON.stringify(msg);
    for (const ws of sockets) {
      ws.send(payload);
    }
  };

  const handleUpgrade = (req: Request, server: Server<WsClientData>): boolean => {
    const id = crypto.randomUUID();
    return server.upgrade(req, { data: { id } });
  };

  return {
    websocket: {
      open(ws) {
        sockets.add(ws);
        send(ws, deps.getSnapshot());
      },
      message(ws, message) {
        if (typeof message !== "string") {
          return;
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(message);
        } catch {
          return;
        }
        const clientMsg = parseClientMessage(parsed);
        if (!clientMsg) {
          return;
        }
        deps.handlers?.onClientMessage?.(clientMsg, ws);
      },
      close(ws) {
        sockets.delete(ws);
      },
    },
    handleUpgrade,
    broadcast,
    clientCount: () => sockets.size,
  };
}
