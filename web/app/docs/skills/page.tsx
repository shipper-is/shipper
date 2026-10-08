import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Agent skills — Shipper docs",
  description:
    "Invoke Shipper's bundled agent skills directly from Claude Code, Cursor, or opencode.",
};

const skills = [
  {
    name: "shipper-plan",
    description:
      "Explores your codebase, asks clarifying questions, and writes a phased markdown plan to the configured plans directory (default .shipper/plans/open/). Also supports module URLs — install a Shipper module and plan building it into your repo.",
    example:
      "/shipper-plan https://shipper.is/modules/customer-support",
  },
  {
    name: "shipper-loop",
    description:
      "Orchestrates an entire open plan in one chat. Spins up a fresh subagent per phase that runs shipper-build, monitors progress, and continues until the plan moves to the configured done folder (default .shipper/plans/done/).",
    example: "/shipper-loop on .shipper/plans/open/my-feature.md",
  },
  {
    name: "shipper-build",
    description:
      "Implements a single phase of an open plan in one agent session — checks off tasks and writes Completion Notes. Use when you want one phase at a time; prefer shipper-loop to finish the whole plan.",
    example: "use shipper-build on .shipper/plans/open/my-feature.md Phase 2",
  },
  {
    name: "shipper-spike",
    description:
      "Small one-off feature: plan and build in a single agent session.",
    example: "use shipper-spike to add a copy button to the hero",
  },
  {
    name: "shipper-ship",
    description:
      "Scaffolds a reviewable pull request from a completed plan — what changed, how to verify, and known risks. Creates the PR via gh.",
    example: "use shipper-ship on .shipper/plans/done/my-feature.md",
  },
  {
    name: "shipper-bug",
    description:
      "Evidence-first bug catalog and fix workflow. Reproduce before diagnosing, then drive the fix to proof in .shipper/bugs/.",
    example: "use shipper-bug to fix the login redirect loop",
  },
] as const;

export default function SkillsDocsPage() {
  return (
    <main className="px-6 py-20 md:px-12 md:py-28">
      <div className="mx-auto max-w-6xl">
        <h1 className="text-3xl font-bold tracking-tight md:text-4xl">
          Agent skills
        </h1>
        <p className="mt-4 max-w-2xl text-white/60">
          Planning and building are plain agent skills installed globally for
          your coding agent. Invoke them from Claude Code, Cursor, or opencode.
          The setup console shows configuration; it does not run these skills.
        </p>

        <p className="mt-6 max-w-2xl text-white/60">
          On your first{" "}
          <span className="font-mono text-white">shipper</span> run (or via{" "}
          <span className="font-mono text-white">shipper skills</span>), skills
          are installed into{" "}
          <span className="font-mono text-white">~/.claude/skills/</span>,{" "}
          <span className="font-mono text-white">~/.cursor/skills/</span>, or{" "}
          <span className="font-mono text-white">~/.config/opencode/skills/</span>{" "}
          depending on your agent.
        </p>

        <p className="mt-6 max-w-2xl text-white/60">
          When the{" "}
          <Link
            href="/docs/search"
            className="underline underline-offset-4 hover:text-white/60"
          >
            Shipper MCP server
          </Link>{" "}
          is installed, the skills use{" "}
          <span className="font-mono text-white">shipper_search</span> to find
          related prior work before exploring the codebase, and fall back to
          grep/glob when the tool is not available.
        </p>

        <div className="mt-12 grid gap-6 md:grid-cols-2">
          {skills.map((skill) => (
            <article key={skill.name} className="border border-white p-6">
              <h2 className="font-mono text-lg font-bold">{skill.name}</h2>
              <p className="mt-4 text-white/60">{skill.description}</p>
              <p className="font-mono mt-4 text-sm text-white/60">
                e.g. &ldquo;{skill.example}&rdquo;
              </p>
            </article>
          ))}
        </div>

        <p className="mt-12 max-w-2xl text-white/60">
          Plans are committed markdown. They default to{" "}
          <span className="font-mono text-white">.shipper/plans/</span> and can
          be moved with <span className="font-mono text-white">paths.plans</span>{" "}
          in the repo config. The setup console shows that directory; skills
          write the files.
        </p>
      </div>
    </main>
  );
}
