import { useSocket } from "./hooks/use-socket.ts";

export function App() {
  const { connected, reconnecting, setup } = useSocket();
  const repoPath = setup?.setup.repoRoot ?? "…";

  return (
    <div className="app-shell">
      {reconnecting && !connected && <div className="reconnect-banner">Reconnecting…</div>}

      <header className="top-bar">
        <div className="top-bar-left">
          <span className="brand">Shipper</span>
          <span className="repo-path" title={setup?.setup.repoRoot ?? ""}>
            {repoPath}
          </span>
        </div>
        <div className="top-bar-right">
          <span
            className={`connection-dot ${connected ? "connected" : "disconnected"}`}
            title={connected ? "Connected" : "Disconnected"}
          />
        </div>
      </header>

      <main className="setup-placeholder">
        <p>Setup view coming soon</p>
      </main>
    </div>
  );
}
