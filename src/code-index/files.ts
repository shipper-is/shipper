import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { execa } from "execa";

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];
const MAX_FILE_BYTES = 256 * 1024;

const ALWAYS_SKIPPED = [
  /(^|\/)node_modules\//,
  /(^|\/)dist\//,
  /(^|\/)build\//,
  /(^|\/)\.next\//,
  /(^|\/)coverage\//,
  /\.d\.[cm]?ts$/,
  /\.min\.[cm]?js$/,
];

const TEST_PATHS = [/\.(test|spec)\.[cm]?[jt]sx?$/, /(^|\/)__tests__\//, /(^|\/)__mocks__\//];

export type SourceFile = {
  relPath: string;
  text: string;
};

export type DiscoverOpts = {
  repoRoot: string;
  includeTests?: boolean;
  /** Only keep files under these repo-relative prefixes. */
  paths?: string[];
};

export function isIndexableSourcePath(relPath: string, opts: { includeTests?: boolean } = {}): boolean {
  if (!SOURCE_EXTENSIONS.some((ext) => relPath.endsWith(ext))) {
    return false;
  }
  if (ALWAYS_SKIPPED.some((re) => re.test(relPath))) {
    return false;
  }
  if (!opts.includeTests && TEST_PATHS.some((re) => re.test(relPath))) {
    return false;
  }
  return true;
}

function underPrefixes(relPath: string, prefixes: string[] | undefined): boolean {
  if (!prefixes || prefixes.length === 0) {
    return true;
  }
  return prefixes.some((prefix) => {
    const clean = prefix.replace(/^\.\//, "").replace(/\/+$/, "");
    return relPath === clean || relPath.startsWith(`${clean}/`);
  });
}

/** Tracked and untracked-but-not-ignored source files, so `.gitignore` is respected. */
async function listRepoFiles(repoRoot: string): Promise<string[]> {
  const result = await execa(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    { cwd: repoRoot, reject: false },
  );
  if (result.exitCode !== 0) {
    throw new Error(`git ls-files failed in ${repoRoot}: ${result.stderr || result.stdout}`);
  }
  return [...new Set(result.stdout.split("\0").filter(Boolean))].sort();
}

export async function discoverSourceFiles(opts: DiscoverOpts): Promise<SourceFile[]> {
  const relPaths = (await listRepoFiles(opts.repoRoot)).filter(
    (relPath) =>
      isIndexableSourcePath(relPath, { includeTests: opts.includeTests }) &&
      underPrefixes(relPath, opts.paths),
  );

  const files: SourceFile[] = [];
  for (const relPath of relPaths) {
    const absPath = join(opts.repoRoot, relPath);
    try {
      const info = await stat(absPath);
      if (!info.isFile() || info.size > MAX_FILE_BYTES) {
        continue;
      }
      files.push({ relPath, text: await readFile(absPath, "utf8") });
    } catch {
      // deleted between listing and reading
    }
  }
  return files;
}
