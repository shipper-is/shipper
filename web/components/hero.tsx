import Link from "next/link";
import { CopyInstallCommand } from "@/components/copy-install-command";
import { GITHUB_URL } from "@/lib/constants";

export function Hero() {
  return (
    <section className="px-5 py-16 sm:px-6 sm:py-20 md:px-12 md:py-36 lg:py-44">
      <div className="mx-auto flex w-full max-w-2xl flex-col items-center text-center md:max-w-none">
        <h1 className="w-full text-4xl font-bold leading-[1.05] tracking-tight text-balance sm:text-5xl md:text-7xl md:leading-none lg:text-8xl">
          <span className="block md:inline">Plan it.</span>{" "}
          <span className="block md:inline">Build it.</span>{" "}
          <span className="block md:inline">Ship it.</span>
        </h1>
        <p className="mt-6 max-w-sm text-base leading-relaxed text-white/60 sm:mt-8 sm:max-w-xl sm:text-lg md:mt-10 md:max-w-2xl md:text-xl lg:text-2xl">
          Shipper is a standalone CLI that orchestrates AI coding agents to plan
          and build features in any repository. Anyone on the team can ship
          confidently.
        </p>

        <div className="mt-8 w-full sm:mt-10 md:mt-14 md:max-w-2xl">
          <CopyInstallCommand />
        </div>

        <div className="mt-8 flex flex-col items-center gap-4 sm:mt-10 sm:flex-row sm:gap-6">
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
