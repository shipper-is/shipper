import { useCallback, useEffect, useRef, useState } from "react";
import { KeyboardHelp } from "./components/keyboard-help.tsx";
import { LeftNav } from "./components/left-nav.tsx";
import { MainPane } from "./components/main-pane.tsx";
import { ModelPicker } from "./components/model-picker.tsx";
import { SettingsModal } from "./components/settings-modal.tsx";
import { TerminalPane } from "./components/terminal-pane.tsx";
import { useSocket } from "./hooks/use-socket.ts";

const TERMINAL_COLLAPSED_KEY = "shipper.terminalCollapsed";

function loadTerminalCollapsed(): boolean {
  try {
    return localStorage.getItem(TERMINAL_COLLAPSED_KEY) === "true";
  } catch {
    return false;
  }
}

function saveTerminalCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(TERMINAL_COLLAPSED_KEY, String(collapsed));
  } catch {
    // ignore storage errors
  }
}

export function App() {
  const socket = useSocket();
  const [terminalCollapsed, setTerminalCollapsed] = useState(loadTerminalCollapsed);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [composingNewPlan, setComposingNewPlan] = useState(false);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);
  const navRef = useRef<HTMLElement>(null);

  const closeOverlays = useCallback(() => {
    setSettingsOpen(false);
    setHelpOpen(false);
    setComposingNewPlan(false);
  }, []);

  const startBuild = useCallback(() => {
    const plan = socket.selectedPlan;
    if (!plan || plan.folder !== "open" || socket.runState.status !== "idle") {
      return;
    }
    socket.send({ type: "start-build", planFilename: plan.filename });
  }, [socket]);

  const toggleTerminal = useCallback(() => {
    setTerminalCollapsed((prev) => {
      const next = !prev;
      saveTerminalCollapsed(next);
      return next;
    });
  }, []);

  useEffect(() => {
    const isTypingTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) {
        return false;
      }
      const tag = target.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable;
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key === "`") {
        event.preventDefault();
        toggleTerminal();
        return;
      }

      if (event.key === "Escape") {
        if (settingsOpen || helpOpen || composingNewPlan) {
          event.preventDefault();
          closeOverlays();
        }
        return;
      }

      if (isTypingTarget(event.target) && event.key !== "Escape") {
        return;
      }

      if (event.key === "?") {
        event.preventDefault();
        setHelpOpen((open) => !open);
        return;
      }

      if (event.key === "n") {
        event.preventDefault();
        setComposingNewPlan(true);
        return;
      }

      if (event.key === "b") {
        event.preventDefault();
        startBuild();
        return;
      }

      if (event.key === "/") {
        event.preventDefault();
        chatInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggleTerminal, closeOverlays, settingsOpen, helpOpen, composingNewPlan, startBuild]);

  useEffect(() => {
    if (!socket.notice) return;
    const timer = setTimeout(() => socket.clearNotice(), 5000);
    return () => clearTimeout(timer);
  }, [socket.notice, socket.clearNotice]);

  const agentLabel =
    socket.configInfo?.defaultAgent?.toUpperCase() ?? "NO AGENT";
  const hasAnyAgent =
    socket.configInfo?.detectedAgents.some((agent) => agent.available) ?? false;
  const noPlans =
    socket.plans.open.length === 0 && socket.plans.done.length === 0;

  return (
    <div className={`app-shell ${terminalCollapsed ? "terminal-collapsed" : ""}`}>
      {socket.reconnecting && !socket.connected && (
        <div className="reconnect-banner">Reconnecting…</div>
      )}

      {socket.configInfo && !hasAnyAgent && (
        <div className="agent-warning-banner" role="alert">
          No coding agent detected. Open settings to choose or install one.
          <button type="button" className="link-button" onClick={() => setSettingsOpen(true)}>
            Settings
          </button>
        </div>
      )}

      {socket.notice && (
        <div className="toast-notice" role="status">
          {socket.notice}
          <button type="button" onClick={socket.clearNotice} aria-label="Dismiss">
            ✕
          </button>
        </div>
      )}

      <header className="top-bar">
        <div className="top-bar-left">
          <span className="brand">Shipper</span>
          <span className="repo-path" title={socket.configInfo?.repoPath ?? ""}>
            {socket.configInfo?.repoPath ?? "…"}
          </span>
        </div>
        <div className="top-bar-right">
          <span className="agent-badge">{agentLabel}</span>
          <button
            type="button"
            className="icon-button"
            aria-label="Settings"
            onClick={() => setSettingsOpen(true)}
          >
            ⚙
          </button>
          <span
            className={`connection-dot ${socket.connected ? "connected" : "disconnected"}`}
            title={socket.connected ? "Connected" : "Disconnected"}
          />
        </div>
      </header>

      <div className="workspace">
        <LeftNav
          navRef={navRef}
          plans={socket.plans}
          selectedFilename={socket.selectedPlanFilename}
          onSelectPlan={(filename) => {
            setComposingNewPlan(false);
            socket.selectPlan(filename);
          }}
          onNewPlan={() => setComposingNewPlan(true)}
        />

        <MainPane
          plan={socket.selectedPlan}
          runState={socket.runState}
          chatEntries={socket.chatEntries}
          pendingQuestion={socket.pendingQuestion}
          composingNewPlan={composingNewPlan}
          queuedMessages={socket.queuedMessages}
          noPlans={noPlans}
          chatInputRef={chatInputRef}
          onStartCompose={() => setComposingNewPlan(true)}
          onCancelCompose={() => setComposingNewPlan(false)}
          onStartPlan={(description) => socket.send({ type: "start-plan", description })}
          send={socket.send}
          createdPlanFilename={socket.createdPlanFilename}
          onBuildCreatedPlan={() => {
            if (socket.createdPlanFilename) {
              socket.send({
                type: "start-build",
                planFilename: socket.createdPlanFilename,
              });
              socket.clearCreatedPlan();
            }
          }}
        />

        <aside className={`terminal-rail ${terminalCollapsed ? "collapsed" : ""}`}>
          <div className="terminal-header">
            <span>Terminal</span>
            <button
              type="button"
              className="terminal-toggle"
              onClick={toggleTerminal}
              aria-label={terminalCollapsed ? "Expand terminal" : "Collapse terminal"}
              title="Toggle terminal (Ctrl+`)"
            >
              {terminalCollapsed ? "◀" : "▶"}
            </button>
          </div>
          <TerminalPane
            connected={socket.connected}
            collapsed={terminalCollapsed}
            terminalState={socket.terminalState}
            send={socket.send}
            registerTerminalDataHandler={socket.registerTerminalDataHandler}
          />
        </aside>
      </div>

      {terminalCollapsed && (
        <button
          type="button"
          className="terminal-expand-tab"
          onClick={toggleTerminal}
          aria-label="Expand terminal"
          title="Expand terminal (Ctrl+`)"
        >
          Terminal ◀
        </button>
      )}

      {helpOpen && <KeyboardHelp onClose={() => setHelpOpen(false)} />}

      {settingsOpen && socket.configInfo && (
        <SettingsModal
          configInfo={socket.configInfo}
          onClose={() => setSettingsOpen(false)}
          send={socket.send}
        />
      )}

      {socket.modelPickRequest && (
        <ModelPicker
          request={socket.modelPickRequest}
          onSelect={(msg) => socket.send(msg)}
          onCancel={() => socket.send({ type: "cancel-model-pick" })}
        />
      )}
    </div>
  );
}
