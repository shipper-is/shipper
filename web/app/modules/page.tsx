import type { Metadata } from "next";
import Link from "next/link";
import { CopyModuleCommand } from "@/components/copy-module-command";
import { modulePlanCommand } from "@/lib/constants";
import { getAllModules } from "@/lib/modules";

export const metadata: Metadata = {
  title: "Modules — Shipper",
  description:
    "Open source, agent-buildable feature specs — customer support, analytics, and more — that your coding agent implements directly in your codebase.",
};

function formatReplaces(replaces: string[]): string {
  if (replaces.length === 0) {
    return "";
  }
  if (replaces.length === 1) {
    return replaces[0]!;
  }
  if (replaces.length === 2) {
    return `${replaces[0]} and ${replaces[1]}`;
  }
  return `${replaces.slice(0, -1).join(", ")}, and ${replaces[replaces.length - 1]}`;
}

export default async function ModulesPage() {
  const modules = await getAllModules();

  return (
    <main className="px-6 py-20 md:px-12 md:py-28">
      <div className="mx-auto max-w-6xl">
        <h1 className="text-3xl font-bold tracking-tight md:text-4xl">Modules</h1>
        <p className="mt-4 max-w-2xl text-white/60">
          SaaS tools made sense when building software was expensive. Agents changed
          that. Modules are opinionated, open source feature specs your coding agent
          builds directly into your codebase — so you own the code and the agent can
          maintain it.
        </p>

        <h2 className="mt-12 text-xl font-bold">How it works</h2>
        <ol className="mt-4 max-w-2xl list-decimal space-y-2 pl-5 text-white/60">
          <li>Copy the plan command for a module below.</li>
          <li>Paste it into Claude Code, Cursor, or opencode.</li>
          <li>Review the tailored plan your agent writes to <span className="font-mono text-white">.shipper/open/</span>.</li>
          <li>Build it phase by phase with <span className="font-mono text-white">shipper-build</span>.</li>
        </ol>

        <div className="mt-12 grid gap-6 md:grid-cols-2">
          {modules.map((module) => (
            <article key={module.id} className="border border-white p-6">
              <p className="font-mono text-sm text-white/60">{module.id}</p>
              <h2 className="mt-2 text-xl font-bold">{module.name}</h2>
              <p className="mt-4 text-white/60">{module.description}</p>
              <p className="font-mono mt-4 text-sm text-white/60">
                {module.category}
                {module.replaces.length > 0 && (
                  <> · replaces {formatReplaces(module.replaces)}</>
                )}
              </p>
              <div className="mt-6">
                <CopyModuleCommand command={modulePlanCommand(module.id)} />
              </div>
              <Link
                href={`/modules/${module.id}`}
                className="font-mono mt-4 inline-block text-sm underline underline-offset-4 transition-colors hover:text-white/60"
              >
                View module details →
              </Link>
            </article>
          ))}
        </div>
      </div>
    </main>
  );
}
