import { useState, type MutableRefObject } from "react";
import {
  AGENT_KINDS,
  ARTIFACT_TYPES,
  SKILL_NAMES,
  type AgentKind,
  type ConfigLayer,
} from "../../shared/config-schema.ts";
import type { ModelFamilyDto, SetupSnapshot } from "../../shared/protocol.ts";
import type { SaveResult } from "../hooks/use-socket.ts";
import { ConfigForm } from "./config-form.tsx";
import { SourceBadge } from "./source-badge.tsx";

type ConfigTab = "effective" | ConfigLayer;

const TAB_LABELS: Record<ConfigTab, string> = {
  effective: "Effective",
  repo: "Repo (committed)",
  local: "Local (this repo, not committed)",
  global: "Global (all repos)",
};

export function ConfigSection({
  setup,
  modelsByAgent,
  lastSave,
  saveEventId,
  notice,
  dirtyRef,
  connected,
  onSave,
  onListModels,
}: {
  setup: SetupSnapshot;
  modelsByAgent: Partial<Record<AgentKind, ModelFamilyDto[]>>;
  lastSave: SaveResult | null;
  saveEventId: number;
  notice: string | null;
  dirtyRef: MutableRefObject<boolean>;
  connected: boolean;
  onSave: (layer: ConfigLayer, value: Record<string, unknown>) => void;
  onListModels: (agent: AgentKind) => void;
}) {
  const [tab, setTab] = useState<ConfigTab>("effective");
  const detectedAgents = setup.agents.filter((agent) => agent.detected).map((agent) => agent.kind);

  function selectTab(next: ConfigTab) {
    if (next === tab) return;
    if (
      dirtyRef.current &&
      !window.confirm("This layer has unsaved changes. Discard them and switch tabs?")
    ) {
      return;
    }
    dirtyRef.current = false;
    setTab(next);
  }

  const layer = tab === "effective" ? null : setup.config.layers[tab];

  return (
    <section className="setup-section" data-setup-section="configuration">
      <h1>Configuration</h1>
      <div className="config-tabs" role="tablist">
        {(["effective", "repo", "local", "global"] as const).map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? "active" : undefined}
            data-config-tab={id}
            title={id === "effective" ? "Merged result" : setup.config.layers[id].path}
            onClick={() => selectTab(id)}
          >
            {TAB_LABELS[id]}
          </button>
        ))}
      </div>

      {setup.config.pathErrors.length > 0 && (
        <div className="setup-warning">
          {setup.config.pathErrors.map((error) => (
            <p key={error}>{error}</p>
          ))}
        </div>
      )}

      {tab === "effective" ? (
        <EffectivePane setup={setup} />
      ) : (
        layer && (
          <>
            <div className="layer-meta">
              <p>
                <code>{layer.path}</code>
              </p>
              <p>{layer.exists ? "File exists." : "File does not exist yet. Saving creates it."}</p>
              {layer.error && (
                <div className="setup-warning">
                  <p>{layer.error}</p>
                </div>
              )}
              {layer.ignoredKeys.length > 0 && (
                <div className="setup-warning">
                  <p>
                    Ignored in this layer: {layer.ignoredKeys.join(", ")}. Artifact paths are read
                    only from the repo config.
                  </p>
                </div>
              )}
            </div>
            {tab === "repo" && (
              <p className="layer-note">
                This file is committed. Commit <code>.shipper/config.json</code> so your team gets
                these settings.
              </p>
            )}
            {tab === "local" && (
              <p className="layer-note">
                Stored in <code>.shipper/config.local.json</code>, which Shipper keeps out of git
                via <code>.shipper/.gitignore</code>.
              </p>
            )}
            {tab === "global" && (
              <p className="layer-note">
                Applies to every repository for this user. The form does not edit machine state.
              </p>
            )}
            <ConfigForm
              key={tab}
              layer={tab}
              layerState={layer}
              detectedAgents={detectedAgents}
              modelsByAgent={modelsByAgent}
              lastSave={lastSave}
              saveEventId={saveEventId}
              notice={notice}
              dirtyRef={dirtyRef}
              connected={connected}
              onSave={(value) => onSave(tab, value)}
              onListModels={onListModels}
            />
          </>
        )
      )}
    </section>
  );
}

function EffectivePane({ setup }: { setup: SetupSnapshot }) {
  const { effective, sources } = setup.config;
  const rows: Array<{ key: string; value: string; source: (typeof sources)[string] }> = [];

  for (const type of ARTIFACT_TYPES) {
    rows.push({
      key: `paths.${type}`,
      value: effective.paths[type],
      source: sources[`paths.${type}`] ?? "default",
    });
  }
  rows.push({
    key: "git.branchMode",
    value: effective.git.branchMode ?? "Not set",
    source: sources["git.branchMode"] ?? "default",
  });
  rows.push({
    key: "git.commitEachPhase",
    value: effective.git.commitEachPhase ? "Yes" : "No",
    source: sources["git.commitEachPhase"] ?? "default",
  });
  rows.push({
    key: "git.branchPrefix",
    value: effective.git.branchPrefix,
    source: sources["git.branchPrefix"] ?? "default",
  });
  rows.push({
    key: "search.enabled",
    value: effective.search.enabled ? "On" : "Off",
    source: sources["search.enabled"] ?? "default",
  });
  rows.push({
    key: "search.extraDirs",
    value: effective.search.extraDirs.length === 0 ? "None" : effective.search.extraDirs.join(", "),
    source: sources["search.extraDirs"] ?? "default",
  });
  for (const agent of AGENT_KINDS) {
    for (const skill of SKILL_NAMES) {
      const model = effective.models[agent]?.[skill];
      if (!model) continue;
      const key = `models.${agent}.${skill}`;
      rows.push({ key, value: model, source: sources[key] ?? "default" });
    }
  }

  return (
    <div>
      <p className="layer-note">Merged from built-in defaults, then global, repo, and local.</p>
      <div className="table-wrap">
        <table className="setup-table">
          <thead>
            <tr>
              <th scope="col">Key</th>
              <th scope="col">Value</th>
              <th scope="col">Source</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <td className="mono">{row.key}</td>
                <td>{row.value}</td>
                <td>
                  <SourceBadge source={row.source} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h2>Instructions</h2>
      {effective.instructions.length === 0 ? (
        <p className="empty-note">No instructions.</p>
      ) : (
        <ol className="plain-list">
          {effective.instructions.map((entry, index) => (
            <li key={`${entry.layer}-${entry.scope}-${index}`}>
              <SourceBadge source={entry.layer} /> <span className="mono">{entry.scope}</span>
              <p>{entry.text}</p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
