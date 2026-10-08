import { CONFIG_LAYERS, type ConfigLayer } from "../../shared/config-schema.ts";
import type { SetupSnapshot } from "../../shared/protocol.ts";
import { AGENT_LABELS, countLabel, formatTimestamp } from "../format.ts";
import type { SectionId } from "./setup-nav.tsx";

const LAYER_LABELS: Record<ConfigLayer, string> = {
  global: "Global",
  repo: "Repo",
  local: "Local",
};

function configSummary(setup: SetupSnapshot): string {
  const present = CONFIG_LAYERS.filter((layer) => setup.config.layers[layer].exists).map(
    (layer) => LAYER_LABELS[layer],
  );
  const files =
    present.length === 0
      ? "No config files yet"
      : `${present.join(", ")} ${present.length === 1 ? "file exists" : "files exist"}`;
  const layerErrors = CONFIG_LAYERS.filter((layer) => setup.config.layers[layer].error).length;
  const extras = [
    layerErrors > 0 ? `${layerErrors} layer ${layerErrors === 1 ? "error" : "errors"}` : "",
    setup.config.pathErrors.length > 0
      ? `${setup.config.pathErrors.length} path ${setup.config.pathErrors.length === 1 ? "warning" : "warnings"}`
      : "",
  ].filter(Boolean);
  return extras.length > 0 ? `${files}. ${extras.join(". ")}` : files;
}

function artifactsSummary(setup: SetupSnapshot): string {
  const tracked = setup.artifacts.filter(
    (artifact) => artifact.type === "plans" || artifact.type === "spikes" || artifact.type === "bugs",
  );
  const open = tracked.reduce((sum, artifact) => sum + (artifact.open ?? 0), 0);
  const done = tracked.reduce((sum, artifact) => sum + (artifact.done ?? 0), 0);
  const stray = setup.strayArtifacts.reduce((sum, item) => sum + item.count, 0);
  const totals = `${open} open, ${done} done across plans, spikes, and bugs`;
  return stray > 0 ? `${totals}. ${countLabel(stray, "stray file")}` : totals;
}

function skillsSummary(setup: SetupSnapshot): string {
  if (setup.skills.length === 0) return "No coding agents detected";
  const allCurrent = setup.skills.every((group) =>
    group.skills.every((skill) => skill.state === "current"),
  );
  if (allCurrent) {
    return `Current for ${setup.skills.map((group) => AGENT_LABELS[group.agent]).join(", ")}`;
  }
  return setup.skills
    .map((group) => {
      const bad = group.skills.filter((skill) => skill.state !== "current");
      if (bad.length === 0) return `${AGENT_LABELS[group.agent]} current`;
      const detail = bad.map((skill) => `${skill.name} ${skill.state}`).join(", ");
      return `${AGENT_LABELS[group.agent]}: ${detail}`;
    })
    .join(". ");
}

function mcpSummary(setup: SetupSnapshot): string {
  if (setup.mcp.length === 0) return "No coding agents detected";
  return setup.mcp.map((entry) => `${AGENT_LABELS[entry.agent]} ${entry.state}`).join(", ");
}

function searchSummary(setup: SetupSnapshot): string {
  const { index, embed } = setup.search;
  const enabled = setup.config.effective.search.enabled ? "Search on" : "Search off";
  const freshness = index.exists ? (index.stale ? "stale" : "up to date") : "missing";
  const updated = formatTimestamp(index.updatedAt);
  const server = embed.running ? "running" : "stopped";
  return `${enabled}. ${index.files} files, ${freshness}, updated ${updated}. Embed server ${server}.`;
}

function agentsSummary(setup: SetupSnapshot): string {
  return setup.agents
    .map((agent) =>
      agent.detected
        ? `${AGENT_LABELS[agent.kind]}${agent.version ? ` ${agent.version}` : ""}`
        : `${AGENT_LABELS[agent.kind]} not detected`,
    )
    .join(", ");
}

const CARDS: Array<{ id: SectionId; title: string; summary: (setup: SetupSnapshot) => string }> = [
  { id: "configuration", title: "Configuration", summary: configSummary },
  { id: "artifacts", title: "Artifacts", summary: artifactsSummary },
  { id: "skills", title: "Skills", summary: skillsSummary },
  { id: "mcp", title: "MCP", summary: mcpSummary },
  { id: "search", title: "Search", summary: searchSummary },
  { id: "agents", title: "Agents", summary: agentsSummary },
];

export function OverviewSection({
  setup,
  onOpen,
}: {
  setup: SetupSnapshot;
  onOpen: (section: SectionId) => void;
}) {
  return (
    <section className="setup-section" data-setup-section="overview">
      <h1>Overview</h1>
      <p className="setup-section__lede">How Shipper is set up for this repo and this user.</p>
      <div className="status-grid">
        {CARDS.map((card) => (
          <button
            key={card.id}
            type="button"
            className="status-card"
            onClick={() => onOpen(card.id)}
          >
            <span className="status-card__title">{card.title}</span>
            <span className="status-card__status">{card.summary(setup)}</span>
            <span className="status-card__open">Open</span>
          </button>
        ))}
      </div>
    </section>
  );
}
