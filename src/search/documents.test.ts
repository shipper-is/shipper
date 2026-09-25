import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discoverDocs, readDocMetadata } from "./documents.ts";

const temps: string[] = [];

afterEach(async () => {
  for (const dir of temps.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

async function makeRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "shipper-docs-"));
  temps.push(root);
  return root;
}

describe("discoverDocs", () => {
  it("discovers each typed artifact, legacy files, and skips symlink and non-md", async () => {
    const root = await makeRepo();
    const shipper = join(root, ".shipper");

    await mkdir(join(shipper, "plans", "open"), { recursive: true });
    await mkdir(join(shipper, "plans", "done"), { recursive: true });
    await mkdir(join(shipper, "spikes", "open"), { recursive: true });
    await mkdir(join(shipper, "bugs", "done"), { recursive: true });
    await mkdir(join(shipper, "reviews"), { recursive: true });
    await mkdir(join(shipper, "open"), { recursive: true });

    await writeFile(
      join(shipper, "plans", "open", "alpha.md"),
      "---\ntype: plan\nbranch: feature/a\n---\n\n# Alpha Plan\n",
      "utf8",
    );
    await writeFile(
      join(shipper, "spikes", "open", "beta.md"),
      "---\ntype: spike\n---\n\n# Beta Spike\n",
      "utf8",
    );
    await writeFile(
      join(shipper, "bugs", "done", "gamma.md"),
      "---\nseverity: high\nfixed_at: \"2026-01-01\"\n---\n\n# Gamma Bug\n",
      "utf8",
    );
    await writeFile(
      join(shipper, "reviews", "delta.md"),
      "---\ntype: review\nmerge_risk: low\n---\n\n# Delta Review\n",
      "utf8",
    );
    await writeFile(
      join(shipper, "open", "legacy.md"),
      "---\ntype: spike\n---\n\n# Legacy Spike\n",
      "utf8",
    );
    await writeFile(join(shipper, "plans", "open", "notes.txt"), "not markdown", "utf8");
    await symlink(
      join(shipper, "plans", "open", "alpha.md"),
      join(shipper, "plans", "open", "link.md"),
    );

    const docs = await discoverDocs(root);
    expect(docs.map((d) => d.relPath)).toEqual([
      ".shipper/bugs/done/gamma.md",
      ".shipper/open/legacy.md",
      ".shipper/plans/open/alpha.md",
      ".shipper/reviews/delta.md",
      ".shipper/spikes/open/beta.md",
    ]);

    expect(docs.find((d) => d.relPath.endsWith("alpha.md"))).toMatchObject({
      type: "plan",
      status: "open",
    });
    expect(docs.find((d) => d.relPath.endsWith("legacy.md"))).toMatchObject({
      type: "spike",
      status: "open",
    });
    expect(docs.find((d) => d.relPath.endsWith("delta.md"))).toMatchObject({
      type: "review",
      status: null,
    });
  });

  it("extracts title and scalar frontmatter", async () => {
    const markdown = `---
type: plan
branch: shipper/foo
pr_number: 12
phase_commits:
  1: abc
---

# My Title

Body.
`;
    const meta = readDocMetadata(markdown, { relPath: ".shipper/plans/open/my-title.md" });
    expect(meta.title).toBe("My Title");
    expect(meta.frontmatter).toEqual({
      branch: "shipper/foo",
      pr_number: 12,
    });
  });

  it("falls back to filename when there is no H1", async () => {
    const meta = readDocMetadata("no title here\n", {
      relPath: ".shipper/bugs/open/mystery.md",
    });
    expect(meta.title).toBe("mystery");
  });
});
