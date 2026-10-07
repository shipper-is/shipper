import type { ClientMessage, SetupSnapshot } from "../../shared/protocol.ts";
import { formatTimestamp } from "../format.ts";
import { SourceBadge } from "./source-badge.tsx";

export function SearchSection({
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
  const { index, embed } = setup.search;
  const enabled = setup.config.effective.search.enabled;
  const locked = busy || !connected;
  const extraDirs = setup.config.effective.search.extraDirs;

  return (
    <section className="setup-section" data-setup-section="search">
      <h1>Search</h1>
      <h2>Settings</h2>
      <dl className="setup-dl">
        <dt>
          Enabled <SourceBadge source={setup.config.sources["search.enabled"] ?? "default"} />
        </dt>
        <dd>{enabled ? "On" : "Off"}</dd>
        <dt>
          Extra directories{" "}
          <SourceBadge source={setup.config.sources["search.extraDirs"] ?? "default"} />
        </dt>
        <dd>{extraDirs.length === 0 ? "None" : extraDirs.join(", ")}</dd>
      </dl>
      <p className="setup-section__note">Edit these in Configuration.</p>

      <h2>Index</h2>
      <dl className="setup-dl">
        <dt>Path</dt>
        <dd className="mono">{index.path}</dd>
        <dt>Files</dt>
        <dd>{index.files}</dd>
        <dt>Chunks</dt>
        <dd>{index.chunks}</dd>
        <dt>Updated</dt>
        <dd>{formatTimestamp(index.updatedAt)}</dd>
        <dt>Model</dt>
        <dd className="mono">{index.modelId ?? "None"}</dd>
        <dt>Status</dt>
        <dd>{index.exists ? (index.stale ? "Stale" : "Up to date") : "No index yet"}</dd>
      </dl>
      <div className="button-row">
        <button
          type="button"
          className="primary-button"
          data-action="sync-index"
          disabled={locked || !enabled}
          onClick={() => send({ type: "run-action", action: { kind: "sync-index", force: false } })}
        >
          Sync index
        </button>
        <button
          type="button"
          className="secondary-button"
          data-action="sync-index-force"
          disabled={locked || !enabled}
          onClick={() => send({ type: "run-action", action: { kind: "sync-index", force: true } })}
        >
          Rebuild index
        </button>
      </div>
      {!enabled && (
        <p className="setup-section__note">
          Search is disabled for this repository (search.enabled is false). Index actions stay off
          until it is enabled.
        </p>
      )}

      <h2>Embedding server</h2>
      <dl className="setup-dl">
        <dt>Running</dt>
        <dd>{embed.running ? "Yes" : "No"}</dd>
        <dt>Port</dt>
        <dd>{embed.port ?? "None"}</dd>
        <dt>Idle minutes</dt>
        <dd>{embed.idleMinutes}</dd>
        <dt>Last used</dt>
        <dd>{formatTimestamp(embed.lastUsedAt)}</dd>
        <dt>Assets</dt>
        <dd>
          Server binary {embed.assets.serverBinary ? "present" : "missing"}. Model{" "}
          {embed.assets.model ? "present" : "missing"}.
        </dd>
      </dl>
      <div className="button-row">
        <button
          type="button"
          className="primary-button"
          data-action="start-embed"
          disabled={locked || embed.running}
          onClick={() => send({ type: "run-action", action: { kind: "start-embed" } })}
        >
          Start server
        </button>
        <button
          type="button"
          className="secondary-button"
          data-action="stop-embed"
          disabled={locked || !embed.running}
          onClick={() => send({ type: "run-action", action: { kind: "stop-embed" } })}
        >
          Stop server
        </button>
      </div>
    </section>
  );
}
