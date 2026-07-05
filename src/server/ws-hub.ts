import type { Server, ServerWebSocket } from "bun";
import { getDefaultAgent, getProjectConfig } from "../core/config.ts";
import { detectAgents } from "../agents/detect.ts";
import {
  idleRunState,
  parseClientMessage,
  type AgentQuestion,
  type ChatEntry,
  type ClientMessage,
  type ConfigInfo,
  type ModelPickRequest,
  type PlansSnapshot,
  type RunState,
  type ServerMessage,
  type ServerSnapshot,
  type TerminalState,
} from "../shared/protocol.ts";

export type WsClientData = {
  id: string;
};

export type WsMessageHandlers = {
  onClientMessage?: (msg: ClientMessage, ws: ServerWebSocket<WsClientData>) => void;
};

export type WsHubDeps = {
  getPlans: () => PlansSnapshot;
  getRunState: () => RunState;
  getChatEntries: () => ChatEntry[];
  getPendingQuestion: () => AgentQuestion | null;
  getModelPickRequest: () => ModelPickRequest | null;
  getQueuedMessages: () => string[];
  getConfigInfo: () => ConfigInfo;
  getTerminalState: () => TerminalState;
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
  sendSnapshot: (ws: ServerWebSocket<WsClientData>) => void;
  clientCount: () => number;
};

export function createWsHub(deps: WsHubDeps): WsHub {
  const sockets = new Set<ServerWebSocket<WsClientData>>();

  const buildSnapshot = (): ServerSnapshot => ({
    type: "snapshot",
    plans: deps.getPlans(),
    runState: deps.getRunState(),
    chatEntries: deps.getChatEntries(),
    pendingQuestion: deps.getPendingQuestion(),
    modelPickRequest: deps.getModelPickRequest(),
    queuedMessages: deps.getQueuedMessages(),
    configInfo: deps.getConfigInfo(),
    terminalState: deps.getTerminalState(),
  });

  const send = (ws: ServerWebSocket<WsClientData>, msg: ServerMessage) => {
    ws.send(JSON.stringify(msg));
  };

  const broadcast = (msg: ServerMessage) => {
    const payload = JSON.stringify(msg);
    for (const ws of sockets) {
      ws.send(payload);
    }
  };

  const sendSnapshot = (ws: ServerWebSocket<WsClientData>) => {
    send(ws, buildSnapshot());
  };

  const handleUpgrade = (req: Request, server: Server<WsClientData>): boolean => {
    const id = crypto.randomUUID();
    return server.upgrade(req, { data: { id } });
  };

  return {
    websocket: {
      open(ws) {
        sockets.add(ws);
        sendSnapshot(ws);
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
    sendSnapshot,
    clientCount: () => sockets.size,
  };
}

const AGENT_LABELS = {
  claude: "Claude",
  cursor: "Cursor",
  opencode: "OpenCode",
} as const;

export async function buildConfigInfo(repoPath: string): Promise<ConfigInfo> {
  const [detected, projectConfig, defaultAgent] = await Promise.all([
    detectAgents(),
    getProjectConfig(repoPath),
    getDefaultAgent(),
  ]);

  const detectedKinds = new Set(detected.map((agent) => agent.kind));

  return {
    repoPath,
    defaultAgent: projectConfig.agent ?? defaultAgent ?? null,
    detectedAgents: (["claude", "cursor", "opencode"] as const).map((kind) => ({
      kind,
      available: detectedKinds.has(kind),
      label: AGENT_LABELS[kind],
    })),
  };
}

export const defaultTerminalState = (): TerminalState => ({
  available: typeof Bun !== "undefined" && typeof Bun.Terminal !== "undefined",
  active: false,
  message: null,
});

export { idleRunState };
