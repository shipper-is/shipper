import { useCallback, useEffect, useState } from "react";
import type { ClientMessage, ServerMessage } from "../../shared/protocol.ts";

export type UseSocketResult = {
  connected: boolean;
  reconnecting: boolean;
  hello: ServerMessage | null;
  send: (msg: ClientMessage) => void;
};

export function useSocket(): UseSocketResult {
  const [connected, setConnected] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [hello, setHello] = useState<ServerMessage | null>(null);
  const [socket, setSocket] = useState<WebSocket | null>(null);

  const handleMessage = useCallback((msg: ServerMessage) => {
    if (msg.type === "hello") {
      setHello(msg);
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
        if (typeof event.data !== "string") {
          return;
        }
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

  return {
    connected,
    reconnecting,
    hello,
    send,
  };
}
