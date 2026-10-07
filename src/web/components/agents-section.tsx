import type { SetupSnapshot } from "../../shared/protocol.ts";
import { INSTALL_COMMANDS, INSTALL_URLS } from "../install-hints.ts";
import { AGENT_LABELS } from "../format.ts";

export function AgentsSection({ setup }: { setup: SetupSnapshot }) {
  return (
    <section className="setup-section" data-setup-section="agents">
      <h1>Agents</h1>
      <p className="setup-section__lede">Coding agents Shipper can install skills and MCP for.</p>
      {setup.agents.map((agent) => (
        <div key={agent.kind} className="stack-block">
          <h2>{AGENT_LABELS[agent.kind]}</h2>
          <dl className="setup-dl">
            <dt>Detected</dt>
            <dd>{agent.detected ? "Yes" : "No"}</dd>
            <dt>Version</dt>
            <dd>{agent.version ?? "None"}</dd>
            <dt>Binary</dt>
            <dd className="mono">{agent.binary ?? "None"}</dd>
          </dl>
          {!agent.detected && (
            <div className="install-block">
              <a href={INSTALL_URLS[agent.kind]} target="_blank" rel="noreferrer">
                {INSTALL_URLS[agent.kind]}
              </a>
              <code>{INSTALL_COMMANDS[agent.kind]}</code>
            </div>
          )}
        </div>
      ))}
    </section>
  );
}
