import Link from "next/link";
import { CopyInstallCommand } from "@/components/copy-install-command";
import { GITHUB_URL } from "@/lib/constants";

const TUI_MOCK = `$ cd my-project
$ shipper

  Shipper · my-project · cursor
  ─────────────────────────────────
  Open plans
    ● Add user auth          Phase 2/4 · 13/41 tasks
  ─────────────────────────────────
  ↑↓ select · n new plan · b build · q quit`;

export function Hero() {
  return (
    <section className="px-6 py-20 md:px-12 md:py-28">
      <div className="mx-auto grid max-w-6xl gap-12 lg:grid-cols-2 lg:gap-16 lg:items-center">
        <div>
          <h1 className="text-4xl font-bold tracking-tight md:text-5xl lg:text-6xl">
            Plan it. Build it. Ship it.
          </h1>
          <p className="mt-6 max-w-xl text-lg text-white/60 md:text-xl">
            Shipper is a standalone CLI that orchestrates AI coding agents to
            plan and build features in any repository. Anyone on the team can
            ship confidently.
          </p>

          <div className="mt-10">
            <CopyInstallCommand />
            <p className="mt-3 text-sm text-white/60">
              Installing via curl avoids Gatekeeper quarantine on macOS.
            </p>
          </div>

          <p className="mt-8">
            <Link
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-sm underline underline-offset-4 transition-colors hover:text-white/60"
            >
              View on GitHub
            </Link>
          </p>
        </div>

        <div className="border border-white">
          <pre className="font-mono overflow-x-auto p-6 text-sm leading-relaxed whitespace-pre">
            {TUI_MOCK}
          </pre>
        </div>
      </div>
    </section>
  );
}
