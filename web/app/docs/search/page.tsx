import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Semantic search — Shipper docs",
  description:
    "Give your coding agent an MCP tool that semantically searches every plan, spike, bug, and review in .shipper/.",
};

const steps = [
  {
    title: "Install",
    content: (
      <p className="text-white/60">
        Install the Shipper CLI if you have not already. Semantic search ships
        with the binary — no extra packages.
      </p>
    ),
  },
  {
    title: "Register",
    content: (
      <>
        <p className="text-white/60">
          Register the MCP server with your coding agents:
        </p>
        <p className="mt-4 font-mono text-white">shipper mcp install</p>
        <p className="mt-4 text-white/60">
          This writes the Shipper entry for Claude Code, Cursor, and opencode
          (or one agent via{" "}
          <span className="font-mono text-white">--agent</span>), prefetches
          the embedding model, and asks you to restart the agent. Use{" "}
          <span className="font-mono text-white">--no-download</span> to skip
          the prefetch.
        </p>
      </>
    ),
  },
  {
    title: "Use",
    content: (
      <p className="text-white/60">
        In your agent, call{" "}
        <span className="font-mono text-white">shipper_search</span> with a
        short natural-language query. Bundled skills (
        <span className="font-mono text-white">shipper-plan</span>,{" "}
        <span className="font-mono text-white">shipper-spike</span>,{" "}
        <span className="font-mono text-white">shipper-bug</span>,{" "}
        <span className="font-mono text-white">shipper-build</span>) do this
        automatically when the tool is available. From a terminal you can also
        run <span className="font-mono text-white">shipper search</span> or{" "}
        <span className="font-mono text-white">shipper index</span>.
      </p>
    ),
  },
  {
    title: "Manage",
    content: (
      <>
        <p className="text-white/60">
          The shared embedding server runs on{" "}
          <span className="font-mono text-white">127.0.0.1</span> and shuts down
          after 15 idle minutes by default. Check or stop it anytime:
        </p>
        <p className="mt-4 font-mono text-white">
          shipper embed status
          <br />
          shipper embed stop
          <br />
          shipper embed start --idle-minutes 30
        </p>
      </>
    ),
  },
] as const;

const tools = [
  {
    name: "shipper_search",
    description: "Semantic search across plans, spikes, bugs, and reviews.",
  },
  {
    name: "shipper_similar",
    description: "Find documents similar to an existing Shipper file.",
  },
  {
    name: "shipper_get_doc",
    description: "Read a Shipper markdown file (optional line range).",
  },
  {
    name: "shipper_list_docs",
    description: "List indexed Shipper documents.",
  },
  {
    name: "shipper_reindex",
    description: "Rebuild or refresh the search index.",
  },
] as const;

export default function SearchDocsPage() {
  return (
    <main className="px-6 py-20 md:px-12 md:py-28">
      <div className="mx-auto max-w-6xl">
        <h1 className="text-3xl font-bold tracking-tight md:text-4xl">
          Semantic search
        </h1>
        <p className="mt-4 max-w-2xl text-white/60">
          Give your coding agent an MCP tool that semantically searches every
          plan, spike, bug, and review in{" "}
          <span className="font-mono text-white">.shipper/</span> — powered by a
          small local embeddings model.
        </p>

        <ol className="mt-12 space-y-10">
          {steps.map((step, index) => (
            <li key={step.title}>
              <div className="flex items-baseline gap-4">
                <span className="font-mono text-3xl font-bold text-white/40">
                  {index + 1}
                </span>
                <h2 className="text-xl font-bold">{step.title}</h2>
              </div>
              <div className="mt-4 pl-12">{step.content}</div>
            </li>
          ))}
        </ol>

        <h2 className="mt-16 text-xl font-bold">Tools</h2>
        <ul className="mt-6 space-y-4">
          {tools.map((tool) => (
            <li key={tool.name}>
              <span className="font-mono text-white">{tool.name}</span>
              <span className="text-white/60"> — {tool.description}</span>
            </li>
          ))}
        </ul>

        <h2 className="mt-16 text-xl font-bold">What gets downloaded</h2>
        <p className="mt-4 max-w-2xl text-white/60">
          On first use, Shipper downloads a pinned llama.cpp build from GitHub
          (about 12–17 MB depending on platform) and an 84 MB GGUF model from
          Hugging Face (
          <span className="font-mono text-white">nomic-embed-text-v1.5</span>{" "}
          Q4_K_M). Both are SHA-256 verified into{" "}
          <span className="font-mono text-white">~/.cache/shipper/</span>. No
          document text or embeddings leave your machine. Remove everything with{" "}
          <span className="font-mono text-white">shipper mcp uninstall</span>,{" "}
          <span className="font-mono text-white">shipper embed stop</span>, and{" "}
          <span className="font-mono text-white">rm -rf ~/.cache/shipper</span>.
          See also the{" "}
          <Link
            href="/docs/skills"
            className="underline underline-offset-4 hover:text-white/60"
          >
            skills docs
          </Link>{" "}
          for how agents use search during plan and build.
        </p>
      </div>
    </main>
  );
}
