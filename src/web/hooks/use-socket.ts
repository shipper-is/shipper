import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  AgentQuestion,
  ChatEntry,
  ClientMessage,
  ConfigInfo,
  ModelPickRequest,
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
  chatEntries: ChatEntry[];
  pendingQuestion: AgentQuestion | null;
  modelPickRequest: ModelPickRequest | null;
  configInfo: ConfigInfo | null;
  selectedPlanFilename: string | null;
  notice: string | null;
  createdPlanFilename: string | null;
  queuedMessages: string[];
};

export type UseSocketResult = SocketState & {
  send: (msg: ClientMessage) => void;
  selectPlan: (filename: string | null) => void;
  selectedPlan: PlanSummary | null;
  clearNotice: () => void;
  clearCreatedPlan: () => void;
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
  const [chatEntries, setChatEntries] = useState<ChatEntry[]>([]);
  const [pendingQuestion, setPendingQuestion] = useState<AgentQuestion | null>(null);
  const [modelPickRequest, setModelPickRequest] = useState<ModelPickRequest | null>(null);
  const [configInfo, setConfigInfo] = useState<ConfigInfo | null>(null);
  const [selectedPlanFilename, setSelectedPlanFilename] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [createdPlanFilename, setCreatedPlanFilename] = useState<string | null>(null);
  const [queuedMessages, setQueuedMessages] = useState<string[]>([]);
  const [socket, setSocket] = useState<WebSocket | null>(null);

  const handleMessage = useCallback((msg: ServerMessage) => {
    switch (msg.type) {
      case "snapshot":
        setPlans(msg.plans);
        setRunState(msg.runState);
        setChatEntries(msg.chatEntries);
        setPendingQuestion(msg.pendingQuestion);
        setModelPickRequest(msg.modelPickRequest);
        setQueuedMessages(msg.queuedMessages);
        setConfigInfo(msg.configInfo);
        setSelectedPlanFilename((current) => {
          if (current && findPlan(msg.plans, current)) {
            return current;
          }
          if (msg.runState.planFilename && findPlan(msg.plans, msg.runState.planFilename)) {
            return msg.runState.planFilename;
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
        if (msg.runState.status === "running") {
          setModelPickRequest(null);
        }
        break;
      case "chat-append":
        setChatEntries((prev) => [...prev, msg.entry]);
        break;
      case "chat-replace-last":
        setChatEntries((prev) =>
          prev.length === 0 ? [msg.entry] : [...prev.slice(0, -1), msg.entry],
        );
        break;
      case "question-pending":
        setPendingQuestion(msg.question);
        setRunState(msg.runState);
        break;
      case "question-cleared":
        setPendingQuestion(null);
        break;
      case "needs-model-pick":
        setModelPickRequest(msg.modelPickRequest);
        break;
      case "plan-created":
        setCreatedPlanFilename(msg.filename);
        setSelectedPlanFilename(msg.filename);
        break;
      case "config-info":
        setConfigInfo(msg.configInfo);
        break;
      case "notice":
        setNotice(msg.text);
        break;
      case "queued-messages":
        setQueuedMessages(msg.messages);
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
    chatEntries,
    pendingQuestion,
    modelPickRequest,
    configInfo,
    selectedPlanFilename,
    selectedPlan,
    notice,
    createdPlanFilename,
    queuedMessages,
    send,
    selectPlan: setSelectedPlanFilename,
    clearNotice: () => setNotice(null),
    clearCreatedPlan: () => setCreatedPlanFilename(null),
  };
}
