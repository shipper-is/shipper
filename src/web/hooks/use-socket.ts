import { useCallback, useEffect, useState } from "react";
import type { AgentKind, ConfigLayer } from "../../shared/config-schema.ts";
import type {
  ActionStatus,
  ClientMessage,
  ModelFamilyDto,
  ServerMessage,
  SetupSnapshot,
} from "../../shared/protocol.ts";

export type SaveResult = {
  layer: ConfigLayer;
  ok: boolean;
  error: string | null;
};

export type UseSocketResult = {
  connected: boolean;
  reconnecting: boolean;
  setup: SetupSnapshot | null;
  action: ActionStatus | null;
  modelsByAgent: Partial<Record<AgentKind, ModelFamilyDto[]>>;
  lastSave: SaveResult | null;
  saveEventId: number;
  notice: string | null;
  dismissNotice: () => void;
  send: (msg: ClientMessage) => void;
};

export function useSocket(): UseSocketResult {
  const [connected, setConnected] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [setup, setSetup] = useState<SetupSnapshot | null>(null);
  const [action, setAction] = useState<ActionStatus | null>(null);
  const [modelsByAgent, setModelsByAgent] = useState<
    Partial<Record<AgentKind, ModelFamilyDto[]>>
  >({});
  const [lastSave, setLastSave] = useState<SaveResult | null>(null);
  const [saveEventId, setSaveEventId] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [socket, setSocket] = useState<WebSocket | null>(null);

  const handleMessage = useCallback((msg: ServerMessage) => {
    switch (msg.type) {
      case "setup":
        setSetup(msg.setup);
        setAction(msg.action);
        return;
      case "action-status":
        setAction(msg.action);
        return;
      case "models-list":
        setModelsByAgent((current) => ({ ...current, [msg.agent]: msg.families }));
        return;
      case "save-result":
        setLastSave({ layer: msg.layer, ok: msg.ok, error: msg.error });
        setSaveEventId((id) => id + 1);
        return;
      case "notice":
        setNotice(msg.text);
        return;
      default: {
        const exhaustive: never = msg;
        void exhaustive;
      }
    }
  }, []);

  useEffect(() => {
    let active = true;
    let ws: WebSocket | null = null;
    let retryAttempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (!active) return;

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
      setSocket(ws);

      ws.onopen = () => {
        if (!active) return;
        retryAttempt = 0;
        setConnected(true);
        setReconnecting(false);
      };

      ws.onclose = () => {
        if (!active) return;
        setConnected(false);
        setReconnecting(true);
        setSocket(null);
        const delay = Math.min(1000 * 2 ** retryAttempt, 10_000);
        retryAttempt += 1;
        retryTimer = setTimeout(connect, delay);
      };

      ws.onerror = () => {
        ws?.close();
      };

      ws.onmessage = (event) => {
        if (typeof event.data !== "string") return;
        try {
          const parsed = JSON.parse(event.data) as ServerMessage;
          handleMessage(parsed);
        } catch {
          // ignore malformed messages
        }
      };
    };

    connect();

    return () => {
      active = false;
      if (retryTimer) clearTimeout(retryTimer);
      ws?.close();
    };
  }, [handleMessage]);

  const send = useCallback(
    (msg: ClientMessage) => {
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(msg));
      }
    },
    [socket],
  );

  const dismissNotice = useCallback(() => {
    setNotice(null);
  }, []);

  return {
    connected,
    reconnecting,
    setup,
    action,
    modelsByAgent,
    lastSave,
    saveEventId,
    notice,
    dismissNotice,
    send,
  };
}
