import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { D3Question } from "./d3-client.ts";

export const ROLE_OPTIONS: Record<string, string> = {
  utility: "General helper used across features: formatting, parsing, math, string or collection helpers",
  ui_component: "UI component that renders markup",
  hook: "Reusable stateful hook or composable",
  service: "Service, client, or adapter that talks to an API, database, filesystem, process, or other system",
  data_model: "Type, schema, interface, or data model definition",
  handler: "Route, command, tool, or event handler wired into a framework or entry point",
  config: "Configuration, constants, or setup and wiring code",
  test_support: "Test helper, fixture, or mock",
  feature_logic: "Business logic tied to one specific feature or flow",
};

export const EFFECT_OPTIONS: Record<string, string> = {
  pure: "No side effects: computes a value from its inputs",
  filesystem: "Reads or writes files or directories",
  network: "Makes network or HTTP requests, or serves them",
  database: "Reads or writes a database",
  process: "Spawns processes, reads environment, or controls the running process",
  ui_state: "Changes UI or client state",
  mixed: "Several kinds of side effects",
};

export const DEFAULT_CAPABILITIES: Record<string, string> = {
  formatting: "Formatting values for display: numbers, currency, dates, sizes, durations, or text",
  parsing: "Parsing or serializing text, JSON, YAML, markdown, frontmatter, or other formats",
  validation: "Validating input or data against rules or schemas",
  "date-time": "Dates, times, durations, scheduling, intervals, or timeouts",
  "string-text": "String manipulation: slugs, casing, templating, truncation, or whitespace",
  collections: "Array, map, and set helpers: sorting, grouping, deduplication, or merging",
  "math-vectors": "Math, statistics, scoring, ranking, vectors, or similarity",
  "hashing-ids": "Hashing, checksums, encryption, random values, or generating IDs",
  filesystem: "Reading, writing, walking, watching, or locking files and directories",
  "paths-config": "Resolving paths and locations, or loading and saving configuration and settings",
  "process-exec": "Spawning processes, shells, or CLIs, or supervising child processes and daemons",
  "http-client": "Making HTTP requests or calling remote APIs",
  "http-server": "Serving HTTP routes, endpoints, or websockets",
  auth: "Authentication, sessions, tokens, or permissions",
  database: "Database queries, migrations, or models",
  caching: "Caching, memoization, or reusing previously computed results",
  "search-index": "Search, indexing, embeddings, chunking, or retrieval",
  "ai-agents": "Calling or orchestrating AI models, agents, prompts, or skills",
  "git-vcs": "Git, branches, worktrees, commits, diffs, or version control",
  cli: "Command-line commands, flags, prompts, or terminal output",
  "logging-progress": "Logging, progress reporting, or diagnostics",
  "errors-retries": "Error handling, retries, fallbacks, or recovery",
  concurrency: "Locks, queues, concurrency limits, debouncing, or background work",
  "downloads-install": "Downloading, verifying, or installing assets, binaries, or packages",
  "mcp-tools": "Model Context Protocol servers, tools, or tool registration",
  "ui-layout": "Page layout, navigation, routing, or app shell UI",
  "ui-forms": "Forms, inputs, and form state in the UI",
  "ui-display": "Displaying data in the UI: lists, tables, cards, charts, or status",
  "state-management": "Client state, stores, context, or data fetching state",
  "markdown-docs": "Markdown documents, plans, or documentation content",
  testing: "Testing utilities, fixtures, or mocks",
  "types-schemas": "Shared type, interface, or schema definitions",
  other: "None of the above",
};

const taxonomyFileSchema = z.object({
  capabilities: z.record(z.string(), z.string()).optional(),
});

export type Taxonomy = {
  capabilities: Record<string, string>;
  /** Changes whenever any question or option changes, so cached decisions are recomputed. */
  hash: string;
};

export function buildTaxonomy(capabilities: Record<string, string> = DEFAULT_CAPABILITIES): Taxonomy {
  const count = Object.keys(capabilities).length;
  if (count < 2 || count > 255) {
    throw new Error(`A taxonomy needs 2 to 255 capabilities, got ${count}`);
  }
  const hash = createHash("sha256")
    .update(JSON.stringify(buildQuestions({ capabilities, hash: "" })))
    .digest("hex")
    .slice(0, 16);
  return { capabilities, hash };
}

/** Load `{ "capabilities": { key: description } }`; missing file or field falls back to the defaults. */
export async function loadTaxonomy(path: string | undefined): Promise<Taxonomy> {
  if (!path) {
    return buildTaxonomy();
  }
  const parsed = taxonomyFileSchema.parse(JSON.parse(await readFile(path, "utf8")));
  return buildTaxonomy(parsed.capabilities ?? DEFAULT_CAPABILITIES);
}

export const REUSE_LEVELS = [
  "Only meaningful inside its own file or feature",
  "Rarely reusable elsewhere",
  "Sometimes reusable by other features",
  "Often reusable by other features",
  "A general building block other features should call instead of rewriting",
];

export const CONVENTION_LEVELS = [
  "Not a good example to copy",
  "An acceptable example",
  "A clean, typical example of how this codebase does this kind of thing",
];

/** Same option keys as symbol labeling, asked about the code a search query is looking for. */
export function buildQueryQuestions(taxonomy: Taxonomy): Record<string, D3Question> {
  return {
    role: {
      type: "choice",
      instructions: "What role would code that answers the question in the state play?",
      criteria: ROLE_OPTIONS,
    },
    capability: {
      type: "choice",
      instructions: "Which capability best describes the code the question in the state is looking for?",
      criteria: taxonomy.capabilities,
    },
    effects: {
      type: "choice",
      instructions: "What side effects would code that answers the question in the state have?",
      criteria: EFFECT_OPTIONS,
    },
  };
}

export function buildQuestions(taxonomy: Taxonomy): Record<string, D3Question> {
  return {
    role: {
      type: "choice",
      instructions: "What role does this code symbol play in the codebase?",
      criteria: ROLE_OPTIONS,
    },
    capability: {
      type: "choice",
      instructions: "Which capability best describes what this code symbol does?",
      criteria: taxonomy.capabilities,
    },
    effects: {
      type: "choice",
      instructions: "What side effects does this code symbol have?",
      criteria: EFFECT_OPTIONS,
    },
    reuse: {
      type: "score",
      instructions:
        "How likely is it that another feature should call this code symbol directly instead of writing its own version?",
      criteria: REUSE_LEVELS,
    },
    convention: {
      type: "score",
      instructions: "Is this code symbol a clean, typical example of a pattern a new contributor should copy?",
      criteria: CONVENTION_LEVELS,
    },
  };
}
