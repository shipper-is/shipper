import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Docs — Shipper",
  description:
    "Plan and build with Shipper skills in your coding agent, and open the setup console to see how this repo is configured.",
};

const cards = [
  {
    href: "/docs/console",
    title: "Open the setup console",
    description:
      "Run shipper in your repo to see configuration, artifact directories, skills, MCP, and search — and to edit them.",
  },
  {
    href: "/docs/skills",
    title: "Use the skills directly",
    description:
      "Invoke shipper-plan, shipper-loop, shipper-build, and the other bundled skills from Claude Code, Cursor, or opencode — no console required.",
  },
  {
    href: "/docs/search",
    title: "Semantic search",
    description:
      "Give your coding agent an MCP tool that semantically searches every plan, spike, bug, and review in .shipper/ — powered by a small local embeddings model.",
  },
  {
    href: "/modules",
    title: "Modules",
    description:
      "Browse open source feature specs — customer support, analytics, and more — and plan them into your codebase with shipper-plan.",
  },
] as const;

export default function DocsPage() {
  return (
    <main className="px-6 py-20 md:px-12 md:py-28">
      <div className="mx-auto max-w-6xl">
        <h1 className="text-3xl font-bold tracking-tight md:text-4xl">Docs</h1>
        <p className="mt-4 max-w-2xl text-white/60">
          Skills run in your coding agent. The console shows how Shipper is
          set up for this repo and this user. Artifact directories default to{" "}
          <span className="font-mono text-white">.shipper/</span> and can be
          moved in the repo config.
        </p>

        <div className="mt-12 grid gap-6 md:grid-cols-2">
          {cards.map((card) => (
            <Link
              key={card.href}
              href={card.href}
              className="border border-white p-6 transition-colors hover:bg-white/5"
            >
              <h2 className="text-xl font-bold">{card.title}</h2>
              <p className="mt-4 text-white/60">{card.description}</p>
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}
