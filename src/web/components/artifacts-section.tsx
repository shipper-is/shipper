import { ARTIFACT_TYPES } from "../../shared/config-schema.ts";
import type { SetupSnapshot } from "../../shared/protocol.ts";
import { countLabel } from "../format.ts";
import { SourceBadge } from "./source-badge.tsx";

export function ArtifactsSection({ setup }: { setup: SetupSnapshot }) {
  return (
    <section className="setup-section" data-setup-section="artifacts">
      <h1>Artifacts</h1>
      <p className="setup-section__lede">
        Counts come from the configured directories. Paths are edited in Configuration, Repo tab.
      </p>
      <div className="table-wrap">
        <table className="setup-table">
          <thead>
            <tr>
              <th scope="col">Type</th>
              <th scope="col">Directory</th>
              <th scope="col">Source</th>
              <th scope="col">Exists</th>
              <th scope="col">Open</th>
              <th scope="col">Done</th>
              <th scope="col">Total</th>
            </tr>
          </thead>
          <tbody>
            {ARTIFACT_TYPES.map((type) => {
              const row = setup.artifacts.find((artifact) => artifact.type === type);
              const source = setup.config.sources[`paths.${type}`] ?? "default";
              return (
                <tr key={type}>
                  <td>{type}</td>
                  <td className="mono">{row?.dir ?? setup.config.effective.paths[type]}</td>
                  <td>
                    <SourceBadge source={source} />
                  </td>
                  <td>{row?.exists ? "Yes" : "No"}</td>
                  <td>{row?.open ?? "—"}</td>
                  <td>{row?.done ?? "—"}</td>
                  <td>{row?.total ?? 0}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {setup.strayArtifacts.length > 0 && (
        <div className="setup-warning">
          {setup.strayArtifacts.map((item) => (
            <p key={item.type}>
              {countLabel(item.count, "file")} in <code>{item.dir}</code>{" "}
              {item.count === 1 ? "is" : "are"} outside the configured {item.type} directory.
            </p>
          ))}
        </div>
      )}
      <h2>Installed modules</h2>
      {setup.modules.length === 0 ? (
        <p className="empty-note">No modules installed.</p>
      ) : (
        <ul className="plain-list">
          {setup.modules.map((mod) => (
            <li key={mod.id}>
              <span className="mono">{mod.id}</span>
              {mod.name !== mod.id ? ` — ${mod.name}` : ""}
              {mod.version ? ` (${mod.version})` : ""}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
