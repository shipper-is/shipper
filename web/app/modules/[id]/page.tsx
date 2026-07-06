import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import { CopyModuleCommand } from "@/components/copy-module-command";
import { GITHUB_URL, modulePlanCommand } from "@/lib/constants";
import { getAllModules, getModule } from "@/lib/modules";

type PageProps = {
  params: Promise<{ id: string }>;
};

const markdownComponents: Components = {
  h1: ({ children }) => (
    <h2 className="mt-10 text-2xl font-bold first:mt-0">{children}</h2>
  ),
  h2: ({ children }) => (
    <h3 className="mt-8 text-xl font-bold">{children}</h3>
  ),
  h3: ({ children }) => (
    <h4 className="mt-6 text-lg font-bold">{children}</h4>
  ),
  p: ({ children }) => <p className="mt-4 text-white/60">{children}</p>,
  ul: ({ children }) => (
    <ul className="mt-4 list-disc space-y-2 pl-5 text-white/60">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="mt-4 list-decimal space-y-2 pl-5 text-white/60">{children}</ol>
  ),
  li: ({ children }) => <li>{children}</li>,
  strong: ({ children }) => (
    <strong className="font-semibold text-white">{children}</strong>
  ),
  a: ({ href, children }) => (
    <a
      href={href}
      className="font-mono underline underline-offset-4 transition-colors hover:text-white/60"
      target={href?.startsWith("http") ? "_blank" : undefined}
      rel={href?.startsWith("http") ? "noopener noreferrer" : undefined}
    >
      {children}
    </a>
  ),
  code: ({ children }) => (
    <code className="font-mono text-sm text-white">{children}</code>
  ),
};

export async function generateStaticParams() {
  const modules = await getAllModules();
  return modules.map((module) => ({ id: module.id }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const module = await getModule(id);
  if (!module) {
    return { title: "Module not found — Shipper" };
  }
  return {
    title: `${module.name} — Shipper Modules`,
    description: module.description,
  };
}

export default async function ModuleDetailPage({ params }: PageProps) {
  const { id } = await params;
  const module = await getModule(id);
  if (!module) {
    notFound();
  }

  const moduleTreeUrl = `${GITHUB_URL}/tree/main/modules/${module.id}`;

  return (
    <main className="px-6 py-20 md:px-12 md:py-28">
      <div className="mx-auto max-w-6xl">
        <p className="font-mono text-sm text-white/60">{module.id}</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight md:text-4xl">
          {module.name}
        </h1>
        <p className="mt-4 max-w-2xl text-white/60">{module.description}</p>

        <div className="mt-8 max-w-2xl">
          <CopyModuleCommand command={modulePlanCommand(module.id)} />
        </div>

        <div className="mt-12 max-w-3xl">
          <ReactMarkdown components={markdownComponents}>{module.body}</ReactMarkdown>
        </div>

        {module.referenceFiles.length > 0 && (
          <section className="mt-12 max-w-2xl">
            <h2 className="text-xl font-bold">Reference files</h2>
            <ul className="mt-4 space-y-2">
              {module.referenceFiles.map((filename) => (
                <li key={filename}>
                  <a
                    href={`${moduleTreeUrl}/${filename}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-sm underline underline-offset-4 transition-colors hover:text-white/60"
                  >
                    {filename}
                  </a>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-white/60">
              <a
                href={moduleTreeUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-sm underline underline-offset-4 transition-colors hover:text-white/60"
              >
                View all files on GitHub →
              </a>
            </p>
          </section>
        )}

        <Link
          href="/modules"
          className="font-mono mt-12 inline-block text-sm underline underline-offset-4 transition-colors hover:text-white/60"
        >
          ← All modules
        </Link>
      </div>
    </main>
  );
}
