import { useRef, useState } from "react";
import type { ConfigLayer } from "../shared/config-schema.ts";
import { ActionBar } from "./components/action-bar.tsx";
import { AgentsSection } from "./components/agents-section.tsx";
import { ArtifactsSection } from "./components/artifacts-section.tsx";
import { ConfigSection } from "./components/config-section.tsx";
import { McpSection } from "./components/mcp-section.tsx";
import { OverviewSection } from "./components/overview-section.tsx";
import { SearchSection } from "./components/search-section.tsx";
import { SetupNav, type SectionId } from "./components/setup-nav.tsx";
import { SkillsSection } from "./components/skills-section.tsx";
import { useSocket } from "./hooks/use-socket.ts";

export function App() {
  const {
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
  } = useSocket();
  const [section, setSection] = useState<SectionId>("overview");
  const configDirtyRef = useRef(false);
  const busy = action?.state === "running";
  const repoPath = setup?.repoRoot ?? "…";

  function openSection(next: SectionId) {
    if (next === section) return;
    if (
      configDirtyRef.current &&
      !window.confirm("This configuration layer has unsaved changes. Discard them?")
    ) {
      return;
    }
    configDirtyRef.current = false;
    setSection(next);
  }

  return (
    <div className="app-shell">
      {reconnecting && !connected && <div className="reconnect-banner">Reconnecting…</div>}
      {notice && (
        <div className="toast-notice" role="status">
          <span>{notice}</span>
          <button type="button" onClick={dismissNotice}>
            Close
          </button>
        </div>
      )}

      <header className="top-bar">
        <div className="top-bar-left">
          <span className="brand">Shipper</span>
          <span className="repo-path" title={setup?.repoRoot ?? ""}>
            {repoPath}
          </span>
          {setup && <span className="version-label">v{setup.version}</span>}
          {setup?.update && (
            <span className="update-badge" title={setup.update.installCommand}>
              Update available
            </span>
          )}
        </div>
        <div className="top-bar-right">
          <button
            type="button"
            className="secondary-button"
            data-action="refresh"
            disabled={!connected}
            onClick={() => send({ type: "refresh" })}
          >
            Refresh
          </button>
          <span
            className={`connection-dot ${connected ? "connected" : "disconnected"}`}
            title={connected ? "Connected" : "Disconnected"}
          />
        </div>
      </header>

      <div className="setup-body">
        <SetupNav current={section} setup={setup} onSelect={openSection} />
        <main className="setup-main">
          <ActionBar action={action} />
          {!setup ? (
            <p className="empty-note">Loading setup…</p>
          ) : section === "overview" ? (
            <OverviewSection setup={setup} onOpen={openSection} />
          ) : section === "configuration" ? (
            <ConfigSection
              setup={setup}
              modelsByAgent={modelsByAgent}
              lastSave={lastSave}
              saveEventId={saveEventId}
              notice={notice}
              dirtyRef={configDirtyRef}
              connected={connected}
              onSave={(layer: ConfigLayer, value) => send({ type: "save-config", layer, value })}
              onListModels={(agent) => send({ type: "list-models", agent })}
            />
          ) : section === "artifacts" ? (
            <ArtifactsSection setup={setup} />
          ) : section === "skills" ? (
            <SkillsSection setup={setup} busy={busy} connected={connected} send={send} />
          ) : section === "search" ? (
            <SearchSection setup={setup} busy={busy} connected={connected} send={send} />
          ) : section === "mcp" ? (
            <McpSection setup={setup} busy={busy} connected={connected} send={send} />
          ) : (
            <AgentsSection setup={setup} />
          )}
        </main>
      </div>
    </div>
  );
}
