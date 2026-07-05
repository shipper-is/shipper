import type { Metadata } from "next";
import { CopyInstallCommand } from "@/components/copy-install-command";

export const metadata: Metadata = {
  title: "Web console — Shipper docs",
  description:
    "Install Shipper and use the local web console to plan, build, and spike features with AI agents.",
};

const steps = [
  {
    title: "Install",
    content: (
      <>
        <p className="text-white/60">
          Run the install script once on your machine:
        </p>
        <div className="mt-4">
          <CopyInstallCommand />
        </div>
      </>
    ),
  },
  {
    title: "Run",
    content: (
      <p className="text-white/60">
        Run <span className="font-mono text-white">shipper</span> in your repo.
        Your browser opens at{" "}
        <span className="font-mono text-white">http://shipper.localhost</span>.
        On first run, pick your agent (Claude Code, Cursor CLI, or opencode) —
        Shipper auto-installs all five bundled skills into the repo.
      </p>
    ),
  },
  {
    title: "Plan",
    content: (
      <p className="text-white/60">
        Press <span className="font-mono text-white">n</span>, describe the
        feature, and answer clarifying questions inline. A phased plan lands in{" "}
        <span className="font-mono text-white">.shipper/open/</span>.
      </p>
    ),
  },
  {
    title: "Build",
    content: (
      <p className="text-white/60">
        Press <span className="font-mono text-white">b</span> on an open plan.
        Shipper runs one agent session per phase until the plan is complete, then
        moves it to{" "}
        <span className="font-mono text-white">.shipper/done/</span>. Progress
        updates live as the agent checks boxes in the plan file.
      </p>
    ),
  },
  {
    title: "Spike",
    content: (
      <p className="text-white/60">
        Press <span className="font-mono text-white">s</span> for small one-off
        tasks. A single agent session gathers context, writes a lightweight plan,
        implements the work, and moves the file to{" "}
        <span className="font-mono text-white">.shipper/done/</span>.
      </p>
    ),
  },
] as const;

export default function ConsoleDocsPage() {
  return (
    <main className="px-6 py-20 md:px-12 md:py-28">
      <div className="mx-auto max-w-6xl">
        <h1 className="text-3xl font-bold tracking-tight md:text-4xl">
          Web console
        </h1>
        <p className="mt-4 max-w-2xl text-white/60">
          The fastest way to plan and build features with Shipper.
        </p>

        <ol className="mt-12 space-y-10">
          {steps.map((step, index) => (
            <li key={step.title}>
              <div className="flex items-baseline gap-4">
                <span className="font-mono text-3xl font-bold text-white/40">
                  {index + 1}
                </span>
                <h2 className="text-xl font-bold">{step.title}</h2>
              </div>
              <div className="mt-4 pl-12">{step.content}</div>
            </li>
          ))}
        </ol>
      </div>
    </main>
  );
}
