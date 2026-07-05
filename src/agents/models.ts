import { query } from "@anthropic-ai/claude-agent-sdk";
import { createOpencodeClient, createOpencodeServer } from "@opencode-ai/sdk";
import { execa } from "execa";
import { detectAgents } from "./detect.ts";
import type { AgentKind } from "./types.ts";
import { getFreePort } from "./utils.ts";

export type ModelOption = { id: string; label: string };

const cache = new Map<AgentKind, ModelOption[]>();

export function clearModelListCache(): void {
  cache.clear();
}

export function parseCursorModelList(stdout: string): ModelOption[] {
  const options: ModelOption[] = [];

  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    if (/^available models$/i.test(trimmed)) {
      continue;
    }

    const separator = trimmed.indexOf(" - ");
    if (separator === -1) {
      continue;
    }

    const slug = trimmed.slice(0, separator).trim();
    const displayName = trimmed.slice(separator + 3).trim();
    if (!slug) {
      continue;
    }

    options.push({ id: slug, label: displayName || slug });
  }

  return options;
}

async function listCursorModels(): Promise<ModelOption[]> {
  const detected = await detectAgents();
  const cursor = detected.find((agent) => agent.kind === "cursor");
  const binary = cursor?.binary ?? "cursor-agent";

  const result = await execa(binary, ["--list-models"], {
    timeout: 15_000,
    reject: false,
    stdout: "pipe",
    stderr: "pipe",
  });

  if (result.exitCode !== 0) {
    const detail = `${result.stderr}\n${result.stdout}`.trim();
    throw new Error(
      detail
        ? `Failed to list Cursor models: ${detail}`
        : `Failed to list Cursor models (exit ${result.exitCode})`,
    );
  }

  const models = parseCursorModelList(result.stdout);
  if (models.length === 0) {
    throw new Error("Cursor returned an empty model list");
  }

  return models;
}

async function listClaudeModels(): Promise<ModelOption[]> {
  const q = query({ prompt: (async function* () {})(), options: {} });
  try {
    const models = await q.supportedModels();
    return models.map((model) => ({
      id: model.value,
      label: model.displayName,
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to list Claude models: ${message}`, { cause: error });
  } finally {
    q.close();
  }
}

async function listOpencodeModels(): Promise<ModelOption[]> {
  const port = await getFreePort();
  const server = await createOpencodeServer({
    hostname: "127.0.0.1",
    port,
    timeout: 30_000,
  });

  try {
    const client = createOpencodeClient({ baseUrl: server.url });
    const response = await client.config.providers();

    if (response.error || !response.data) {
      const message =
        response.error && typeof response.error === "object" && "message" in response.error
          ? String(response.error.message)
          : "opencode config.providers() failed";
      throw new Error(`Failed to list opencode models: ${message}`);
    }

    const options: ModelOption[] = [];
    for (const provider of response.data.providers) {
      for (const model of Object.values(provider.models)) {
        options.push({
          id: `${provider.id}/${model.id}`,
          label: `${provider.name} — ${model.name}`,
        });
      }
    }

    if (options.length === 0) {
      throw new Error("opencode returned an empty model list");
    }

    return options;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Failed to list opencode")) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to list opencode models: ${message}`, { cause: error });
  } finally {
    server.close();
  }
}

export async function listModels(kind: AgentKind): Promise<ModelOption[]> {
  const cached = cache.get(kind);
  if (cached) {
    return cached;
  }

  let models: ModelOption[];
  switch (kind) {
    case "cursor":
      models = await listCursorModels();
      break;
    case "claude":
      models = await listClaudeModels();
      break;
    case "opencode":
      models = await listOpencodeModels();
      break;
  }

  cache.set(kind, models);
  return models;
}
