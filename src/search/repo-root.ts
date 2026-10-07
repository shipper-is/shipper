import { access, realpath } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** Walk up from `start` looking for a directory that contains `marker`. */
async function findAncestorWith(start: string, marker: string): Promise<string | null> {
  let current = resolve(start);
  for (;;) {
    if (await pathExists(resolve(current, marker))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

export async function resolveRepoRoot(opts: {
  explicitDir?: string;
  rootUris?: string[];
  cwd: string;
}): Promise<string> {
  let candidate: string | undefined;

  const explicit = opts.explicitDir?.trim();
  if (explicit && !explicit.includes("${")) {
    candidate = resolve(explicit);
  }

  if (!candidate && opts.rootUris) {
    for (const uri of opts.rootUris) {
      if (uri.startsWith("file:")) {
        candidate = fileURLToPath(uri);
        break;
      }
    }
  }

  if (!candidate) {
    candidate = resolve(opts.cwd);
  }

  const withShipper = await findAncestorWith(candidate, ".shipper");
  if (withShipper) {
    return realpath(withShipper);
  }

  const withGit = await findAncestorWith(candidate, ".git");
  if (withGit) {
    return realpath(withGit);
  }

  return realpath(candidate);
}
