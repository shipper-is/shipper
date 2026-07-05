import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  ClientMessage,
  ConfigInfo,
  PlanSummary,
  PlansSnapshot,
  RunState,
  ServerMessage,
} from "../../shared/protocol.ts";
import { idleRunState } from "../../shared/protocol.ts";

export type SocketState = {
  connected: boolean;
  reconnecting: boolean;
  plans: PlansSnapshot;
  runState: RunState;
  configInfo: ConfigInfo | null;
  selectedPlanFilename: string | null;
};

export type UseSocketResult = SocketState & {
  send: (msg: ClientMessage) => void;
  selectPlan: (filename: string | null) => void;
  selectedPlan: PlanSummary | null;
};

const INITIAL_PLANS: PlansSnapshot = { open: [], done: [] };

function findPlan(plans: PlansSnapshot, filename: string | null): PlanSummary | null {
  if (!filename) return null;
  return (
    plans.open.find((plan) => plan.filename === filename) ??
    plans.done.find((plan) => plan.filename === filename) ??
    null
  );
}

function pickDefaultPlan(plans: PlansSnapshot): string | null {
  if (plans.open.length > 0) {
    return plans.open[0]!.filename;
  }
  if (plans.done.length > 0) {
    return plans.done[0]!.filename;
  }
  return null;
}

export function useSocket(): UseSocketResult {
  const [connected, setConnected] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [plans, setPlans] = useState<PlansSnapshot>(INITIAL_PLANS);
  const [runState, setRunState] = useState<RunState>(idleRunState());
  const [configInfo, setConfigInfo] = useState<ConfigInfo | null>(null);
  const [selectedPlanFilename, setSelectedPlanFilename] = useState<string | null>(null);
  const [socket, setSocket] = useState<WebSocket | null>(null);

  const handleMessage = useCallback((msg: ServerMessage) => {
    switch (msg.type) {
      case "snapshot":
        setPlans(msg.plans);
        setRunState(msg.runState);
        setConfigInfo(msg.configInfo);
        setSelectedPlanFilename((current) => {
          if (current && findPlan(msg.plans, current)) {
            return current;
          }
          return pickDefaultPlan(msg.plans);
        });
        break;
      case "plans-updated":
        setPlans(msg.plans);
        setSelectedPlanFilename((current) => {
          if (current && findPlan(msg.plans, current)) {
            return current;
          }
          return pickDefaultPlan(msg.plans);
        });
        break;
      case "run-state":
        setRunState(msg.runState);
        break;
      case "config-info":
        setConfigInfo(msg.configInfo);
        break;
      default:
        break;
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

  const selectedPlan = useMemo(
    () => findPlan(plans, selectedPlanFilename),
    [plans, selectedPlanFilename],
  );

  return {
    connected,
    reconnecting,
    plans,
    runState,
    configInfo,
    selectedPlanFilename,
    selectedPlan,
    send,
    selectPlan: setSelectedPlanFilename,
  };
}
