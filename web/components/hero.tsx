import Link from "next/link";
import { CopyInstallCommand } from "@/components/copy-install-command";
import { GITHUB_URL } from "@/lib/constants";

export function Hero() {
  return (
    <section className="px-6 py-24 md:px-12 md:py-36 lg:py-44">
      <div className="mx-auto flex w-full flex-col items-center text-center">
        <h1 className="w-full text-5xl font-bold tracking-tight md:text-7xl lg:text-8xl">
          Plan it. Build it. Ship it.
        </h1>
        <p className="mt-8 max-w-2xl text-lg text-white/60 md:mt-10 md:text-xl lg:text-2xl">
          Shipper is a standalone CLI that orchestrates AI coding agents to plan
          and build features in any repository. Anyone on the team can ship
          confidently.
        </p>

        <div className="mt-12 w-full max-w-2xl md:mt-14">
          <CopyInstallCommand />
        </div>

        <div className="mt-10 flex items-center justify-center gap-6">
          <Link
            href="/docs"
            className="font-mono text-sm underline underline-offset-4 transition-colors hover:text-white/60"
          >
            Docs
          </Link>
          <Link
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-sm underline underline-offset-4 transition-colors hover:text-white/60"
          >
            View on GitHub
          </Link>
        </div>
      </div>
    </section>
  );
}
