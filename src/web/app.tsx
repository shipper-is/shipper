import { useCallback, useEffect, useState } from "react";
import { LeftNav } from "./components/left-nav.tsx";
import { MainPane } from "./components/main-pane.tsx";
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

  const agentLabel =
    socket.configInfo?.defaultAgent?.toUpperCase() ?? "NO AGENT";

  return (
    <div className={`app-shell ${terminalCollapsed ? "terminal-collapsed" : ""}`}>
      {socket.reconnecting && !socket.connected && (
        <div className="reconnect-banner">Reconnecting…</div>
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
          <button type="button" className="icon-button" aria-label="Settings" disabled>
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
          onSelectPlan={socket.selectPlan}
          onNewPlan={() => {
            // Phase 2
          }}
        />

        <MainPane
          plan={socket.selectedPlan}
          runState={socket.runState}
          activePhaseNumber={socket.runState.activePhaseNumber}
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
    </div>
  );
}
