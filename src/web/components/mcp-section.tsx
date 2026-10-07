import type { AgentKind } from "../../shared/config-schema.ts";
import type { ClientMessage, SetupSnapshot } from "../../shared/protocol.ts";
import { AGENT_LABELS } from "../format.ts";

export function McpSection({
  setup,
  busy,
  connected,
  send,
}: {
  setup: SetupSnapshot;
  busy: boolean;
  connected: boolean;
  send: (msg: ClientMessage) => void;
}) {
  const locked = busy || !connected;

  function run(kind: "install-mcp" | "uninstall-mcp", agent?: AgentKind) {
    send({
      type: "run-action",
      action: agent ? { kind, agent } : { kind },
    });
  }

  return (
    <section className="setup-section" data-setup-section="mcp">
      <h1>MCP</h1>
      <p className="setup-section__lede">
        Shipper search tools registered with each detected coding agent.
      </p>
      <div className="button-row">
        <button
          type="button"
          className="primary-button"
          data-action="install-mcp"
          disabled={locked || setup.mcp.length === 0}
          onClick={() => run("install-mcp")}
        >
          Install for all
        </button>
      </div>
      {setup.mcp.length === 0 ? (
        <p className="empty-note">No coding agents detected.</p>
      ) : (
        <div className="table-wrap">
          <table className="setup-table">
            <thead>
              <tr>
                <th scope="col">Agent</th>
                <th scope="col">State</th>
                <th scope="col">Detail</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {setup.mcp.map((entry) => (
                <tr key={entry.agent}>
                  <td>{AGENT_LABELS[entry.agent]}</td>
                  <td>{entry.state}</td>
                  <td className="detail-text">{entry.detail}</td>
                  <td>
                    <div className="button-row">
                      <button
                        type="button"
                        className="secondary-button"
                        data-action="install-mcp"
                        data-agent={entry.agent}
                        disabled={locked}
                        onClick={() => run("install-mcp", entry.agent)}
                      >
                        Install
                      </button>
                      <button
                        type="button"
                        className="secondary-button"
                        data-action="uninstall-mcp"
                        data-agent={entry.agent}
                        disabled={locked}
                        onClick={() => run("uninstall-mcp", entry.agent)}
                      >
                        Uninstall
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
