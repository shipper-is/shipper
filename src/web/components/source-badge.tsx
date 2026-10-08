import type { ConfigSource } from "../../shared/config-schema.ts";

export function SourceBadge({ source }: { source: ConfigSource }) {
  return <span className="source-badge">{source}</span>;
}
