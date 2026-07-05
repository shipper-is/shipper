import Link from "next/link";

const linkClass =
  "font-mono text-sm underline underline-offset-4 transition-colors hover:text-white/60";

export default function DocsLayout({
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
            <Link href="/docs/console" className={linkClass}>
              Console
            </Link>
            <Link href="/docs/skills" className={linkClass}>
              Skills
            </Link>
          </nav>
        </div>
      </header>
      {children}
    </div>
  );
}
