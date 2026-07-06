import Link from "next/link";

const linkClass =
  "font-mono text-sm underline underline-offset-4 transition-colors hover:text-white/60";

export default function ModulesLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="min-h-screen">
      <header className="px-6 pt-8 md:px-12">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2">
          <Link href="/" className={linkClass}>
            ← Home
          </Link>
          <nav className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <Link href="/docs" className={linkClass}>
              Docs
            </Link>
            <Link href="/modules" className={linkClass}>
              Modules
            </Link>
          </nav>
        </div>
      </header>
      {children}
    </div>
  );
}
