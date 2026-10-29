import { LANES, type Lane } from "../../skills/shipper-review/scripts/review-config.ts";
import {
  ARTIFACT_TYPES,
  DEFAULT_ARTIFACT_PATHS,
  validateArtifactDir,
  type AgentKind,
  type ArtifactType,
  type ConfigLayer,
  type SkillName,
} from "../shared/config-schema.ts";

/**
 * Draft helpers for the setup config form.
 * `writeLayer` replaces known settings keys, so a save must send the whole
 * draft (unknown keys included). It does not deep-merge `models`, `git`,
 * `search`, `instructions`, or repo `paths`.
 */

const PREFIX_RE = /^[A-Za-z0-9._/-]*$/;

export type DraftIssue = { path: string; message: string };

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function cloneDraft(value: Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (!value) return {};
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

export function draftsEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function withoutKey(record: Record<string, unknown>, key: string): Record<string, unknown> {
  const next = { ...record };
  delete next[key];
  return next;
}

function withChild(
  draft: Record<string, unknown>,
  key: string,
  child: Record<string, unknown>,
): Record<string, unknown> {
  if (Object.keys(child).length === 0) return withoutKey(draft, key);
  return { ...draft, [key]: child };
}

export function readGit(draft: Record<string, unknown>): {
  branchMode: "" | "current" | "feature";
  commitEachPhase: "" | "yes" | "no";
  branchPrefix: string;
} {
  const git = isRecord(draft.git) ? draft.git : {};
  const branchMode = git.branchMode === "current" || git.branchMode === "feature" ? git.branchMode : "";
  const commitEachPhase =
    git.commitEachPhase === true ? "yes" : git.commitEachPhase === false ? "no" : "";
  const branchPrefix = typeof git.branchPrefix === "string" ? git.branchPrefix : "";
  return { branchMode, commitEachPhase, branchPrefix };
}

export function setGitField(
  draft: Record<string, unknown>,
  field: "branchMode" | "commitEachPhase" | "branchPrefix",
  value: unknown,
): Record<string, unknown> {
  const git = isRecord(draft.git) ? { ...draft.git } : {};
  if (value === undefined) delete git[field];
  else git[field] = value;
  return withChild(draft, "git", git);
}

export function pathValue(draft: Record<string, unknown>, type: ArtifactType): string {
  if (!isRecord(draft.paths)) return "";
  const raw = draft.paths[type];
  return typeof raw === "string" ? raw : "";
}

export function setPath(
  draft: Record<string, unknown>,
  type: ArtifactType,
  value: string,
): Record<string, unknown> {
  const paths = isRecord(draft.paths) ? { ...draft.paths } : {};
  if (value === "") delete paths[type];
  else paths[type] = value;
  return withChild(draft, "paths", paths);
}

export function instructionValue(draft: Record<string, unknown>, scope: "all" | SkillName): string {
  if (!isRecord(draft.instructions)) return "";
  const raw = draft.instructions[scope];
  return typeof raw === "string" ? raw : "";
}

export function setInstruction(
  draft: Record<string, unknown>,
  scope: "all" | SkillName,
  text: string,
): Record<string, unknown> {
  const instructions = isRecord(draft.instructions) ? { ...draft.instructions } : {};
  if (text === "") delete instructions[scope];
  else instructions[scope] = text;
  return withChild(draft, "instructions", instructions);
}

export function modelValue(
  draft: Record<string, unknown>,
  agent: AgentKind,
  skill: SkillName,
): string | undefined {
  if (!isRecord(draft.models)) return undefined;
  const perAgent = draft.models[agent];
  if (!isRecord(perAgent)) return undefined;
  const model = perAgent[skill];
  return typeof model === "string" && model.length > 0 ? model : undefined;
}

export function setModel(
  draft: Record<string, unknown>,
  agent: AgentKind,
  skill: SkillName,
  model: string | undefined,
): Record<string, unknown> {
  const models = isRecord(draft.models) ? { ...draft.models } : {};
  const perAgent = isRecord(models[agent]) ? { ...models[agent] } : {};
  if (model === undefined || model === "") delete perAgent[skill];
  else perAgent[skill] = model;
  if (Object.keys(perAgent).length === 0) delete models[agent];
  else models[agent] = perAgent;
  return withChild(draft, "models", models);
}

export function readSearchEnabled(draft: Record<string, unknown>): boolean | undefined {
  if (!isRecord(draft.search)) return undefined;
  return typeof draft.search.enabled === "boolean" ? draft.search.enabled : undefined;
}

export function setSearchEnabled(
  draft: Record<string, unknown>,
  enabled: boolean | undefined,
): Record<string, unknown> {
  const search = isRecord(draft.search) ? { ...draft.search } : {};
  if (enabled === undefined) delete search.enabled;
  else search.enabled = enabled;
  return withChild(draft, "search", search);
}

/** `null` means this layer does not set the key, so a lower layer still applies. */
export function readExtraDirs(draft: Record<string, unknown>): string[] | null {
  if (!isRecord(draft.search) || !Object.prototype.hasOwnProperty.call(draft.search, "extraDirs")) {
    return null;
  }
  if (!Array.isArray(draft.search.extraDirs)) return null;
  return draft.search.extraDirs.map((entry) => (typeof entry === "string" ? entry : ""));
}

export function setExtraDirs(
  draft: Record<string, unknown>,
  dirs: string[] | undefined,
): Record<string, unknown> {
  const search = isRecord(draft.search) ? { ...draft.search } : {};
  if (dirs === undefined) delete search.extraDirs;
  else search.extraDirs = dirs;
  return withChild(draft, "search", search);
}

export function draftIssues(layer: ConfigLayer, draft: Record<string, unknown>): DraftIssue[] {
  const issues: DraftIssue[] = [];

  if (layer === "repo" && isRecord(draft.paths)) {
    const effective: Record<ArtifactType, string> = { ...DEFAULT_ARTIFACT_PATHS };
    const owner = new Map<string, ArtifactType>();
    for (const type of ARTIFACT_TYPES) owner.set(effective[type], type);

    for (const type of ARTIFACT_TYPES) {
      if (!Object.prototype.hasOwnProperty.call(draft.paths, type)) continue;
      const raw = draft.paths[type];
      if (typeof raw !== "string") {
        issues.push({ path: `paths.${type}`, message: "Expected a string." });
        continue;
      }
      const result = validateArtifactDir(raw);
      if (!result.ok) {
        issues.push({ path: `paths.${type}`, message: result.error });
        continue;
      }
      const takenBy = owner.get(result.dir);
      if (takenBy !== undefined && takenBy !== type) {
        issues.push({
          path: `paths.${type}`,
          message: `Resolves to "${result.dir}", the same directory as ${takenBy}.`,
        });
        continue;
      }
      const previous = effective[type];
      if (previous !== result.dir && owner.get(previous) === type) owner.delete(previous);
      effective[type] = result.dir;
      owner.set(result.dir, type);
    }
  }

  if (
    isRecord(draft.git) &&
    typeof draft.git.branchPrefix === "string" &&
    !PREFIX_RE.test(draft.git.branchPrefix)
  ) {
    issues.push({
      path: "git.branchPrefix",
      message: "Use only letters, digits, and . _ / -",
    });
  }

  if (isRecord(draft.search) && Array.isArray(draft.search.extraDirs)) {
    draft.search.extraDirs.forEach((entry, index) => {
      if (typeof entry !== "string" || entry.trim() === "") {
        issues.push({
          path: `search.extraDirs.${index}`,
          message: "Enter a directory or remove this row.",
        });
        return;
      }
      const result = validateArtifactDir(entry);
      if (!result.ok) {
        issues.push({ path: `search.extraDirs.${index}`, message: result.error });
      }
    });
  }

  if (layer === "repo") issues.push(...reviewIssues(draft));

  return issues;
}

function readReview(draft: Record<string, unknown>): Record<string, unknown> {
  return isRecord(draft.review) ? draft.review : {};
}

function writeReview(
  draft: Record<string, unknown>,
  review: Record<string, unknown>,
): Record<string, unknown> {
  return withChild(draft, "review", review);
}

export function reviewSampleRateText(draft: Record<string, unknown>): string {
  const value = readReview(draft).sampleRate;
  if (typeof value === "number" || typeof value === "string") return String(value);
  return "";
}

export function setReviewSampleRate(
  draft: Record<string, unknown>,
  text: string,
): Record<string, unknown> {
  const review = { ...readReview(draft) };
  if (text === "") delete review.sampleRate;
  else review.sampleRate = text;
  return writeReview(draft, review);
}

export function reviewBudgetText(
  draft: Record<string, unknown>,
  key: "maxFiles" | "maxChangedLines",
): string {
  const budget = readReview(draft).budget;
  if (!isRecord(budget)) return "";
  const value = budget[key];
  if (typeof value === "number" || typeof value === "string") return String(value);
  return "";
}

export function setReviewBudgetText(
  draft: Record<string, unknown>,
  key: "maxFiles" | "maxChangedLines",
  text: string,
): Record<string, unknown> {
  const review = { ...readReview(draft) };
  const budget = isRecord(review.budget) ? { ...review.budget } : {};
  if (text === "") delete budget[key];
  else budget[key] = text;
  if (Object.keys(budget).length === 0) delete review.budget;
  else review.budget = budget;
  return writeReview(draft, review);
}

export function reviewReplacesDefaults(draft: Record<string, unknown>): boolean {
  return readReview(draft).replaceDefaultRiskFloor === true;
}

export function setReviewReplacesDefaults(
  draft: Record<string, unknown>,
  on: boolean,
): Record<string, unknown> {
  const review = { ...readReview(draft) };
  if (on) review.replaceDefaultRiskFloor = true;
  else delete review.replaceDefaultRiskFloor;
  return writeReview(draft, review);
}

export function readFloorIgnore(draft: Record<string, unknown>): string[] | null {
  const value = readReview(draft).floorIgnore;
  if (!Array.isArray(value)) return null;
  return value.map((entry) => (typeof entry === "string" ? entry : ""));
}

export function setFloorIgnore(
  draft: Record<string, unknown>,
  rows: string[] | undefined,
): Record<string, unknown> {
  const review = { ...readReview(draft) };
  if (rows === undefined) delete review.floorIgnore;
  else review.floorIgnore = rows;
  return writeReview(draft, review);
}

export function readRiskRules(draft: Record<string, unknown>): Array<Record<string, unknown>> | null {
  const value = readReview(draft).riskFloor;
  if (!Array.isArray(value)) return null;
  return value.map((rule) => (isRecord(rule) ? rule : {}));
}

export function setRiskRules(
  draft: Record<string, unknown>,
  rules: Array<Record<string, unknown>> | undefined,
): Record<string, unknown> {
  const review = { ...readReview(draft) };
  if (rules === undefined || rules.length === 0) delete review.riskFloor;
  else review.riskFloor = rules;
  return writeReview(draft, review);
}

export function evidenceText(draft: Record<string, unknown>, lane: Lane): string {
  const kinds = readReview(draft).evidenceKinds;
  if (!isRecord(kinds)) return "";
  const value = kinds[lane];
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.filter((entry) => typeof entry === "string").join(", ");
  return "";
}

export function setEvidenceText(
  draft: Record<string, unknown>,
  lane: Lane,
  text: string,
): Record<string, unknown> {
  const review = { ...readReview(draft) };
  const kinds = isRecord(review.evidenceKinds) ? { ...review.evidenceKinds } : {};
  if (text.trim() === "") delete kinds[lane];
  else kinds[lane] = text;
  if (Object.keys(kinds).length === 0) delete review.evidenceKinds;
  else review.evidenceKinds = kinds;
  return writeReview(draft, review);
}

function parseUnitInterval(value: unknown): number | undefined {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(n) || n < 0 || n > 1) return undefined;
  return n;
}

function parsePositiveInt(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  if (typeof value === "string" && /^[0-9]+$/.test(value.trim())) {
    const n = Number(value);
    if (n > 0) return n;
  }
  return undefined;
}

function reviewIssues(draft: Record<string, unknown>): DraftIssue[] {
  if (draft.review === undefined) return [];
  if (!isRecord(draft.review)) {
    return [{ path: "review", message: "Review settings must be an object." }];
  }
  const review = draft.review;
  const issues: DraftIssue[] = [];

  if (
    review.sampleRate !== undefined &&
    parseUnitInterval(review.sampleRate) === undefined
  ) {
    issues.push({ path: "review.sampleRate", message: "Use a number from 0 to 1." });
  }

  if (review.budget !== undefined && !isRecord(review.budget)) {
    issues.push({ path: "review.budget", message: "Budget must be an object." });
  } else if (isRecord(review.budget)) {
    for (const key of ["maxFiles", "maxChangedLines"] as const) {
      if (review.budget[key] === undefined) continue;
      if (parsePositiveInt(review.budget[key]) === undefined) {
        issues.push({
          path: `review.budget.${key}`,
          message: "Use a positive whole number.",
        });
      }
    }
  }

  if (review.floorIgnore !== undefined && !Array.isArray(review.floorIgnore)) {
    issues.push({ path: "review.floorIgnore", message: "Use a list of globs." });
  } else if (Array.isArray(review.floorIgnore)) {
    review.floorIgnore.forEach((entry, index) => {
      if (typeof entry !== "string" || entry.trim() === "") {
        issues.push({
          path: `review.floorIgnore.${index}`,
          message: "Enter a glob or remove this row.",
        });
      }
    });
  }

  if (review.riskFloor !== undefined && !Array.isArray(review.riskFloor)) {
    issues.push({
      path: "review.riskFloor",
      message: "Extra rules must be a list.",
    });
  } else if (Array.isArray(review.riskFloor)) {
    review.riskFloor.forEach((rule, index) => {
      const record = isRecord(rule) ? rule : {};
      if (typeof record.name !== "string" || record.name.trim() === "") {
        issues.push({ path: `review.riskFloor.${index}.name`, message: "Name this rule." });
      }
      const paths = Array.isArray(record.paths) ? record.paths : [];
      const filled = paths.filter((entry) => typeof entry === "string" && entry.trim() !== "");
      if (filled.length === 0) {
        issues.push({
          path: `review.riskFloor.${index}.paths`,
          message: "Add at least one glob.",
        });
      }
      paths.forEach((entry, pathIndex) => {
        if (typeof entry !== "string" || entry.trim() === "") {
          issues.push({
            path: `review.riskFloor.${index}.paths.${pathIndex}`,
            message: "Enter a glob or remove this row.",
          });
        }
      });
      const lanes = Array.isArray(record.lanes) ? record.lanes : [];
      const known = lanes.every(
        (lane) => typeof lane === "string" && (LANES as readonly string[]).includes(lane),
      );
      if (lanes.length === 0) {
        issues.push({
          path: `review.riskFloor.${index}.lanes`,
          message: "Pick at least one lane.",
        });
      } else if (!known) {
        issues.push({
          path: `review.riskFloor.${index}.lanes`,
          message: "Use only quality, uptime, intent, performance, and security.",
        });
      }
    });
  }

  if (review.evidenceKinds !== undefined && !isRecord(review.evidenceKinds)) {
    issues.push({ path: "review.evidenceKinds", message: "Evidence kinds must be an object." });
  } else if (isRecord(review.evidenceKinds)) {
    for (const lane of LANES) {
      const value = review.evidenceKinds[lane];
      if (value === undefined) continue;
      const items =
        typeof value === "string"
          ? value
              .split(",")
              .map((entry) => entry.trim())
              .filter((entry) => entry.length > 0)
          : Array.isArray(value)
            ? value
            : null;
      if (
        items === null ||
        items.length === 0 ||
        items.some((entry) => typeof entry !== "string" || entry.trim() === "")
      ) {
        issues.push({
          path: `review.evidenceKinds.${lane}`,
          message: "Enter at least one evidence kind, or clear the field to keep the default.",
        });
      }
    }
  }

  if (
    review.replaceDefaultRiskFloor !== undefined &&
    typeof review.replaceDefaultRiskFloor !== "boolean"
  ) {
    issues.push({
      path: "review.replaceDefaultRiskFloor",
      message: "Replace built-in rules must be yes or no.",
    });
  }

  return issues;
}

function normalizeList(value: unknown): unknown {
  if (typeof value === "string") {
    return value
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }
  if (!Array.isArray(value)) return value;
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : entry))
    .filter((entry) => entry !== "");
}

/** Turns in-progress text fields into the JSON the review scripts accept. */
export function normalizeReview(review: Record<string, unknown>): Record<string, unknown> {
  const next = { ...review };
  if (next.sampleRate !== undefined) {
    const rate = parseUnitInterval(next.sampleRate);
    if (rate !== undefined) next.sampleRate = rate;
  }
  if (isRecord(next.budget)) {
    const budget = { ...next.budget };
    for (const key of ["maxFiles", "maxChangedLines"] as const) {
      if (budget[key] === undefined) continue;
      const parsed = parsePositiveInt(budget[key]);
      if (parsed !== undefined) budget[key] = parsed;
    }
    next.budget = budget;
  }
  if (Array.isArray(next.floorIgnore)) {
    next.floorIgnore = next.floorIgnore
      .map((entry) => (typeof entry === "string" ? entry.trim() : entry))
      .filter((entry) => entry !== "");
  }
  if (Array.isArray(next.riskFloor)) {
    next.riskFloor = next.riskFloor.map((rule) => {
      if (!isRecord(rule) || !Array.isArray(rule.paths)) return rule;
      return {
        ...rule,
        paths: rule.paths
          .map((entry) => (typeof entry === "string" ? entry.trim() : entry))
          .filter((entry) => entry !== ""),
      };
    });
  }
  if (isRecord(next.evidenceKinds)) {
    const kinds: Record<string, unknown> = {};
    for (const [lane, value] of Object.entries(next.evidenceKinds)) {
      kinds[lane] = normalizeList(value);
    }
    next.evidenceKinds = kinds;
  }
  return next;
}

/**
 * Full settings draft for `writeLayer`.
 * Global saves omit `embeddings` and `state` so the server keeps the copies on disk.
 * Local and global saves omit `paths` so the server does not reject the write;
 * an existing `paths` key stays on disk because it is not a known settings key there.
 */
export function payloadForSave(
  layer: ConfigLayer,
  draft: Record<string, unknown>,
): Record<string, unknown> {
  const payload = cloneDraft(draft);
  if (layer !== "repo") delete payload.paths;
  if (layer === "global") {
    delete payload.embeddings;
    delete payload.state;
  }
  if (layer === "repo" && isRecord(payload.paths)) {
    const paths = { ...payload.paths };
    for (const type of ARTIFACT_TYPES) {
      const raw = paths[type];
      if (typeof raw !== "string") continue;
      const result = validateArtifactDir(raw);
      if (result.ok) paths[type] = result.dir;
    }
    payload.paths = paths;
  }
  if (isRecord(payload.search) && Array.isArray(payload.search.extraDirs)) {
    payload.search = {
      ...payload.search,
      extraDirs: payload.search.extraDirs.map((entry) => {
        if (typeof entry !== "string") return entry;
        const result = validateArtifactDir(entry);
        return result.ok ? result.dir : entry;
      }),
    };
  }
  if (layer === "repo" && isRecord(payload.review)) {
    payload.review = normalizeReview(payload.review);
  }
  return payload;
}
