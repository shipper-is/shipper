import Link from "next/link";
import { CopyInstallCommand } from "@/components/copy-install-command";
import { GITHUB_URL } from "@/lib/constants";

export function Footer() {
  return (
    <footer className="px-6 py-20 md:px-12 md:py-28">
      <div className="mx-auto max-w-6xl">
        <p className="text-2xl font-bold tracking-tight">Shipper</p>

        <div className="mt-8 max-w-2xl">
          <CopyInstallCommand />
        </div>

        <div className="mt-8 flex items-center gap-6">
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
            github.com/shipper-is/shipper
          </Link>
        </div>
      </div>
    </footer>
  );
}
