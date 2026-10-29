import { GITHUB_REPO, INSTALL_COMMAND } from "../constants.ts";
import { getVersion } from "../version.ts";
import { getUpdateCheckState, setUpdateCheckState } from "./config.ts";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function parseVersion(version: string): number[] {
  return version
    .replace(/^v/, "")
    .split(".")
    .map((part) => parseInt(part, 10) || 0);
}

function isNewer(latest: string, current: string): boolean {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av > bv) {
      return true;
    }
    if (av < bv) {
      return false;
    }
  }
  return false;
}

async function fetchLatestReleaseTag(): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`,
      {
        headers: { Accept: "application/vnd.github+json" },
        signal: controller.signal,
      },
    );
    if (!response.ok) {
      return null;
    }
    const data = (await response.json()) as { tag_name?: string };
    const tag = data.tag_name?.replace(/^v/, "");
    return tag ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export type UpdateNotice = {
  current: string;
  latest: string;
  installCommand: string;
};

export type UpdateStatus = {
  current: string;
  latest: string | null;
  updateAvailable: boolean;
  installCommand: string;
};

export type GetUpdateStatusOptions = {
  /** When true, always contact GitHub instead of using the daily cache. */
  force?: boolean;
  fetchLatest?: () => Promise<string | null>;
};

/**
 * Compare the running version with the latest GitHub release tag.
 * By default reuses cached state for at most one day.
 */
export async function getUpdateStatus(
  options: GetUpdateStatusOptions = {},
): Promise<UpdateStatus> {
  const current = getVersion();
  const force = options.force === true;
  const fetchLatest = options.fetchLatest ?? fetchLatestReleaseTag;
  const state = await getUpdateCheckState();
  const now = Date.now();

  let latest: string | null = state.latestKnown ?? null;

  const cacheFresh =
    state.lastCheckAt !== undefined &&
    now - state.lastCheckAt < ONE_DAY_MS &&
    state.latestKnown !== undefined;

  if (force || !cacheFresh) {
    const fetched = await fetchLatest();
    await setUpdateCheckState({
      lastCheckAt: now,
      latestKnown: fetched ?? state.latestKnown,
    });
    latest = fetched ?? state.latestKnown ?? null;
  }

  const updateAvailable = latest !== null && isNewer(latest, current);
  return {
    current,
    latest,
    updateAvailable,
    installCommand: INSTALL_COMMAND,
  };
}

/**
 * Returns an upgrade notice when a newer release exists.
 * Checks at most once per day; fails silently when offline.
 */
export async function checkForUpdate(): Promise<UpdateNotice | null> {
  const status = await getUpdateStatus({ force: false });
  if (!status.updateAvailable || status.latest === null) {
    return null;
  }
  return {
    current: status.current,
    latest: status.latest,
    installCommand: status.installCommand,
  };
}
