import { useCallback, useEffect, useState } from "react";
import { LeftNav } from "./components/left-nav.tsx";
import { MainPane } from "./components/main-pane.tsx";
import { ModelPicker } from "./components/model-picker.tsx";
import { SettingsModal } from "./components/settings-modal.tsx";
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
  const [composingNewPlan, setComposingNewPlan] = useState(false);

  const toggleTerminal = useCallback(() => {
    setTerminalCollapsed((prev) => {
      const next = !prev;
      saveTerminalCollapsed(next);
      return next;
    });
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key === "`") {
        event.preventDefault();
        toggleTerminal();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggleTerminal]);

  useEffect(() => {
    if (!socket.notice) return;
    const timer = setTimeout(() => socket.clearNotice(), 5000);
    return () => clearTimeout(timer);
  }, [socket.notice, socket.clearNotice]);

  const agentLabel =
    socket.configInfo?.defaultAgent?.toUpperCase() ?? "NO AGENT";

  return (
    <div className={`app-shell ${terminalCollapsed ? "terminal-collapsed" : ""}`}>
      {socket.reconnecting && !socket.connected && (
        <div className="reconnect-banner">Reconnecting…</div>
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
          {!terminalCollapsed && (
            <div className="terminal-placeholder">
              <p>Passthrough terminal arrives in Phase 4.</p>
              <p className="dim">Toggle with Ctrl+` or the chevron above.</p>
            </div>
          )}
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
          onCancel={() => {
            // model pick clears when user picks; cancel is visual only until server adds cancel
          }}
        />
      )}
    </div>
  );
}
