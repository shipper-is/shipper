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

/**
 * Returns an upgrade notice when a newer release exists.
 * Checks at most once per day; fails silently when offline.
 */
export async function checkForUpdate(): Promise<UpdateNotice | null> {
  const current = getVersion();
  const state = await getUpdateCheckState();
  const now = Date.now();

  if (state.lastCheckAt && now - state.lastCheckAt < ONE_DAY_MS && state.latestKnown) {
    if (isNewer(state.latestKnown, current)) {
      return {
        current,
        latest: state.latestKnown,
        installCommand: INSTALL_COMMAND,
      };
    }
    return null;
  }

  const latest = await fetchLatestReleaseTag();
  await setUpdateCheckState({
    lastCheckAt: now,
    latestKnown: latest ?? state.latestKnown,
  });

  if (!latest || !isNewer(latest, current)) {
    return null;
  }

  return {
    current,
    latest,
    installCommand: INSTALL_COMMAND,
  };
}
