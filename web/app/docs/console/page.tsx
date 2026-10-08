import type { Metadata } from "next";
import { CopyInstallCommand } from "@/components/copy-install-command";

export const metadata: Metadata = {
  title: "Setup console — Shipper docs",
  description:
    "Run shipper to see how this repo is configured: artifact paths, skills, MCP, and search. Planning and building happen in your coding agent.",
};

const steps = [
  {
    title: "Install",
    content: (
      <>
        <p className="text-white/60">
          Run the install script once on your machine:
        </p>
        <div className="mt-4">
          <CopyInstallCommand />
        </div>
      </>
    ),
  },
  {
    title: "Open the console",
    content: (
      <p className="text-white/60">
        Run <span className="font-mono text-white">shipper</span> in your repo.
        Your browser opens at{" "}
        <span className="font-mono text-white">http://shipper.localhost</span>.
        The page shows how Shipper is set up for this repo and this user. It
        does not plan or build features. Those skills run in Claude Code,
        Cursor, or opencode. On first run, Shipper installs the bundled skills
        for each detected agent and creates the default artifact folders under{" "}
        <span className="font-mono text-white">.shipper/</span>. It does not
        write a config file until you save one.
      </p>
    ),
  },
  {
    title: "Read the sections",
    content: (
      <p className="text-white/60">
        <span className="text-white">Overview</span> summarizes the rest.{" "}
        <span className="text-white">Configuration</span> shows the merged
        settings and the three files that produce them.{" "}
        <span className="text-white">Artifacts</span> lists each directory
        (defaults under <span className="font-mono text-white">.shipper/</span>
        , overridable in the repo config), open and done counts, and any files
        left behind in an old location. <span className="text-white">Skills</span>
        , <span className="text-white">Search</span>,{" "}
        <span className="text-white">MCP</span>, and{" "}
        <span className="text-white">Agents</span> show what is installed on
        this machine. A section with a problem is marked in the nav.
      </p>
    ),
  },
  {
    title: "Edit configuration",
    content: (
      <p className="text-white/60">
        The Configuration section has four tabs.{" "}
        <span className="text-white">Effective</span> is read-only and names
        the layer behind each value.{" "}
        <span className="text-white">Repo (committed)</span> edits{" "}
        <span className="font-mono text-white">.shipper/config.json</span>,
        including artifact paths — commit that file so the team shares it.{" "}
        <span className="text-white">Local</span> edits{" "}
        <span className="font-mono text-white">.shipper/config.local.json</span>
        , which Shipper keeps out of git.{" "}
        <span className="text-white">Global</span> edits{" "}
        <span className="font-mono text-white">~/.config/shipper/config.json</span>{" "}
        for every repo on this machine. Paths belong only in the repo file.
        Instructions from each layer are combined. Later layers win on other
        keys. Save writes the whole draft for that layer.
      </p>
    ),
  },
  {
    title: "Run an action",
    content: (
      <p className="text-white/60">
        <span className="text-white">Refresh skills</span> reinstalls the
        bundled skills. <span className="text-white">Install</span> and{" "}
        <span className="text-white">Uninstall</span> register the MCP server
        for one agent or all of them. <span className="text-white">Sync index</span>{" "}
        and <span className="text-white">Rebuild index</span> update semantic
        search. <span className="text-white">Start server</span> and{" "}
        <span className="text-white">Stop server</span> control the local
        embedding process. One action runs at a time, and its progress stays on
        screen. Index buttons stay off when search is disabled for the repo.
        Hand-edits to a config file show up in the console on their own.
      </p>
    ),
  },
] as const;

export default function ConsoleDocsPage() {
  return (
    <main className="px-6 py-20 md:px-12 md:py-28">
      <div className="mx-auto max-w-6xl">
        <h1 className="text-3xl font-bold tracking-tight md:text-4xl">
          Setup console
        </h1>
        <p className="mt-4 max-w-2xl text-white/60">
          See how Shipper is set up for this repo. Plan and build in your
          coding agent.
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
      </div>
    </main>
  );
}
