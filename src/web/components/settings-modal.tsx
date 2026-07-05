import { useState } from "react";
import type { ClientMessage, ConfigInfo } from "../../shared/protocol.ts";

const AGENT_LABELS = {
  claude: "Claude Code",
  cursor: "Cursor CLI",
  opencode: "OpenCode",
} as const;

const INSTALL_COMMANDS = {
  claude: "curl -fsSL https://claude.ai/install.sh | bash",
  cursor: "curl -fsSL https://cursor.com/install | bash",
  opencode: "curl -fsSL https://opencode.ai/install | bash",
} as const;

const INSTALL_URLS = {
  claude: "https://docs.anthropic.com/en/docs/claude-code",
  cursor: "https://cursor.com/docs/cli",
  opencode: "https://opencode.ai",
} as const;

type SettingsModalProps = {
  configInfo: ConfigInfo;
  onClose: () => void;
  send: (msg: ClientMessage) => void;
};

export function SettingsModal({ configInfo, onClose, send }: SettingsModalProps) {
  const [tab, setTab] = useState<"agent" | "install">("agent");
  const hasAnyAgent = configInfo.detectedAgents.some((agent) => agent.available);

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal settings-modal">
        <header className="modal-header">
          <h2>Settings</h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <div className="settings-tabs">
          <button
            type="button"
            className={tab === "agent" ? "active" : ""}
            onClick={() => setTab("agent")}
          >
            Agent
          </button>
          {!hasAnyAgent && (
            <button
              type="button"
              className={tab === "install" ? "active" : ""}
              onClick={() => setTab("install")}
            >
              Install
            </button>
          )}
        </div>

        {tab === "agent" ? (
          <div className="settings-agent-panel">
            <p className="modal-subtitle">Default coding agent for this repository</p>
            <ul className="agent-list">
              {configInfo.detectedAgents.map((agent) => (
                <li key={agent.kind}>
                  <button
                    type="button"
                    className={`agent-row ${configInfo.defaultAgent === agent.kind ? "selected" : ""} ${!agent.available ? "unavailable" : ""}`}
                    disabled={!agent.available}
                    onClick={() => send({ type: "set-agent", agent: agent.kind })}
                  >
                    <span>{AGENT_LABELS[agent.kind]}</span>
                    <span className="agent-status">
                      {agent.available ? "Available" : "Not detected"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {configInfo.defaultAgent && configInfo.models && (
              <div className="saved-models">
                {configInfo.models["shipper-plan"] && (
                  <p>
                    Plan model: <code>{configInfo.models["shipper-plan"]}</code>
                  </p>
                )}
                {configInfo.models["shipper-build"] && (
                  <p>
                    Build model: <code>{configInfo.models["shipper-build"]}</code>
                  </p>
                )}
              </div>
            )}
            <button
              type="button"
              className="secondary-button"
              onClick={() => send({ type: "rescan-agents" })}
            >
              Rescan agents
            </button>
          </div>
        ) : (
          <div className="settings-install-panel">
            <p className="warning-text">No coding agents detected on your PATH.</p>
            <p>Install at least one of the following, then rescan.</p>
            {(Object.keys(AGENT_LABELS) as Array<keyof typeof AGENT_LABELS>).map((kind) => (
              <div key={kind} className="install-block">
                <strong>{AGENT_LABELS[kind]}</strong>
                <a href={INSTALL_URLS[kind]} target="_blank" rel="noreferrer">
                  {INSTALL_URLS[kind]}
                </a>
                <code>{INSTALL_COMMANDS[kind]}</code>
              </div>
            ))}
            <button
              type="button"
              className="secondary-button"
              onClick={() => send({ type: "rescan-agents" })}
            >
              Rescan agents
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
