import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Docs — Shipper",
  description:
    "Use Shipper through the web console or invoke its agent skills directly in your coding agent.",
};

const cards = [
  {
    href: "/docs/console",
    title: "Use the web console",
    description:
      "Install Shipper, run it in your repo, and plan, build, or spike features from the browser.",
  },
  {
    href: "/docs/skills",
    title: "Use the skills directly",
    description:
      "Invoke shipper-plan, shipper-build, and the other bundled skills from Claude Code, Cursor, or opencode — no console required.",
  },
] as const;

export default function DocsPage() {
  return (
    <main className="px-6 py-20 md:px-12 md:py-28">
      <div className="mx-auto max-w-6xl">
        <h1 className="text-3xl font-bold tracking-tight md:text-4xl">Docs</h1>
        <p className="mt-4 max-w-2xl text-white/60">
          Shipper works two ways: a local web console for planning and building,
          or plain agent skills you can invoke directly in your coding agent.
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
