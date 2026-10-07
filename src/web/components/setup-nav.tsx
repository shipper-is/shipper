import { CONFIG_LAYERS } from "../../shared/config-schema.ts";
import type { SetupSnapshot } from "../../shared/protocol.ts";

export const SETUP_SECTIONS = [
  { id: "overview", label: "Overview" },
  { id: "configuration", label: "Configuration" },
  { id: "artifacts", label: "Artifacts" },
  { id: "skills", label: "Skills" },
  { id: "search", label: "Search" },
  { id: "mcp", label: "MCP" },
  { id: "agents", label: "Agents" },
] as const;

export type SectionId = (typeof SETUP_SECTIONS)[number]["id"];

export function sectionHasWarning(section: SectionId, setup: SetupSnapshot): boolean {
  switch (section) {
    case "overview":
      return SETUP_SECTIONS.some(
        (item) => item.id !== "overview" && sectionHasWarning(item.id, setup),
      );
    case "configuration":
      return (
        setup.config.pathErrors.length > 0 ||
        CONFIG_LAYERS.some((layer) => {
          const state = setup.config.layers[layer];
          return state.error !== null || state.ignoredKeys.length > 0;
        })
      );
    case "artifacts":
      return setup.strayArtifacts.length > 0;
    case "skills":
      return setup.skills.some((group) => group.skills.some((skill) => skill.state !== "current"));
    case "search":
      return setup.search.index.stale;
    case "mcp":
      return setup.mcp.some((entry) => entry.state !== "registered");
    case "agents":
      return false;
    default: {
      const exhaustive: never = section;
      void exhaustive;
      return false;
    }
  }
}

export function SetupNav({
  current,
  setup,
  onSelect,
}: {
  current: SectionId;
  setup: SetupSnapshot | null;
  onSelect: (section: SectionId) => void;
}) {
  return (
    <nav className="setup-nav" aria-label="Setup sections" data-setup-nav>
      {SETUP_SECTIONS.map((item) => {
        const active = item.id === current;
        const warn = setup ? sectionHasWarning(item.id, setup) : false;
        return (
          <button
            key={item.id}
            type="button"
            className={`setup-nav__item${active ? " active" : ""}`}
            aria-current={active ? "page" : undefined}
            data-section={item.id}
            onClick={() => onSelect(item.id)}
          >
            <span>{item.label}</span>
            {warn && (
              <span className="setup-nav__warn" title="Needs attention">
                !
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
