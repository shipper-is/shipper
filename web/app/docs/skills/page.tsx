import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Agent skills — Shipper docs",
  description:
    "Invoke Shipper's bundled agent skills directly from Claude Code, Cursor, or opencode.",
};

const skills = [
  {
    name: "shipper-plan",
    description:
      "Explores your codebase, asks clarifying questions, and writes a phased markdown plan to .shipper/open/. Also supports module URLs — install a Shipper module and plan building it into your repo.",
    example:
      "/shipper-plan https://shipper.is/modules/customer-support",
  },
  {
    name: "shipper-build",
    description:
      "Executes one phase per agent session until the plan is complete, then moves it to .shipper/done/.",
    example: "use shipper-build on .shipper/open/my-feature.md Phase 2",
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
    example: "use shipper-ship on .shipper/done/my-feature.md",
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
          Every workflow the console uses is a plain agent skill installed in
          your repo. Invoke them directly from Claude Code, Cursor, or opencode
          — no console required.
        </p>

        <p className="mt-6 max-w-2xl text-white/60">
          On your first{" "}
          <span className="font-mono text-white">shipper</span> run, skills are
          installed automatically into{" "}
          <span className="font-mono text-white">.claude/skills/</span>,{" "}
          <span className="font-mono text-white">.cursor/skills/</span>, or{" "}
          <span className="font-mono text-white">.opencode/skill/</span>{" "}
          depending on your agent.
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
          Plans are committed markdown in{" "}
          <span className="font-mono text-white">.shipper/</span>, so console
          users and direct-skill users work from the same files.
        </p>
      </div>
    </main>
  );
}
