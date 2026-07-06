"use client";

import Link from "next/link";
import { CopyModuleCommand } from "@/components/copy-module-command";
import { INSTALL_COMMAND } from "@/lib/constants";

const setupSteps = [
  {
    title: "Install Shipper",
    description:
      "Run the install script once on your machine. Shipper ships as a single compiled binary — no Node.js required.",
    command: INSTALL_COMMAND,
  },
  {
    title: "Install skills in your repo",
    description:
      "From your project directory, install the bundled agent skills. On first run this also detects your coding agent (Claude Code, Cursor CLI, or opencode).",
    command: "cd your-repo && shipper skills",
  },
] as const;

const skillGuides = [
  {
    number: "1",
    title: "Plan",
    skill: "shipper-plan",
    description:
      "Explores your codebase, asks clarifying questions, and writes a phased markdown plan to .shipper/open/.",
    command: "/shipper-plan add a user settings page",
    steps: [
      "Open your coding agent in the repo.",
      "Run the slash command with a short description of the feature.",
      "Answer clarifying questions inline.",
      "A phased plan lands in .shipper/open/ — commit it so the team stays aligned.",
    ],
  },
  {
    number: "2",
    title: "Build",
    skill: "shipper-build",
    description:
      "Executes one phase per agent session until the plan is complete, then moves it to .shipper/done/.",
    command: "/shipper-build on .shipper/open/my-feature.md",
    steps: [
      "Run the slash command with the path to an open plan file.",
      "The agent runs one phase, checking off tasks in the plan as it goes.",
      "Run again for the next phase until every checkbox is done.",
      "The finished plan moves to .shipper/done/.",
    ],
  },
  {
    number: "3",
    title: "Ship",
    skill: "shipper-ship",
    description:
      "Scaffolds a reviewable pull request from a completed plan — what changed, how to verify, and known risks.",
    command: "/shipper-ship on .shipper/done/my-feature.md",
    steps: [
      "Run the slash command with the path to a completed plan in .shipper/done/.",
      "The agent writes a PR summary with verification steps and test evidence.",
      "A pull request is created via gh — ready for review.",
    ],
  },
] as const;

const alternateSkills = [
  {
    title: "Spike",
    skill: "shipper-spike",
    description:
      "Small one-off features: plan and build in a single agent session.",
    command: "/shipper-spike add a copy button to the hero",
    steps: [
      "Describe a small change that fits in one session.",
      "The agent gathers context, writes a lightweight spike plan, and implements it.",
      "The spike file moves to .shipper/done/ when finished.",
    ],
  },
  {
    title: "Bug",
    skill: "shipper-bug",
    description:
      "Evidence-first bug workflow: reproduce, diagnose, fix, and prove it in .shipper/bugs/.",
    command: "/shipper-bug fix the login redirect loop",
    steps: [
      "Run the slash command with a short description of the bug.",
      "The agent reproduces it before diagnosing root cause.",
      "A targeted fix is applied with proof it works.",
      "The bug file moves to .shipper/bugs/done/.",
    ],
  },
] as const;

function StepList({ steps }: { steps: readonly string[] }) {
  return (
    <ol className="mt-4 list-decimal space-y-2 pl-5 text-white/60">
      {steps.map((step) => (
        <li key={step}>{step}</li>
      ))}
    </ol>
  );
}

function SkillCard({
  number,
  title,
  skill,
  description,
  command,
  steps,
}: {
  number?: string;
  title: string;
  skill: string;
  description: string;
  command: string;
  steps: readonly string[];
}) {
  return (
    <article className="border border-white p-6">
      <div className="flex items-baseline gap-4">
        {number ? (
          <span className="font-mono text-3xl font-bold text-white/40">
            {number}
          </span>
        ) : null}
        <div>
          <h3 className="text-xl font-bold">{title}</h3>
          <p className="font-mono mt-1 text-sm text-white/60">{skill}</p>
        </div>
      </div>
      <p className="mt-4 text-white/60">{description}</p>
      <div className="mt-4">
        <CopyModuleCommand command={command} />
      </div>
      <StepList steps={steps} />
    </article>
  );
}

export function HowToUseShipper() {
  return (
    <section className="px-6 py-20 md:px-12 md:py-28">
      <div className="mx-auto max-w-6xl">
        <h2 className="text-3xl font-bold tracking-tight md:text-4xl">
          How to use Shipper
        </h2>
        <p className="mt-4 max-w-2xl text-white/60">
          Install once, then invoke skills directly in your coding agent — Claude
          Code, Cursor CLI, or opencode. No web console required. Prefer a
          browser UI? Run{" "}
          <span className="font-mono text-white">shipper</span> in your repo
          instead.
        </p>

        <div className="mt-12 space-y-10">
          <div>
            <h3 className="text-xl font-bold">Get started</h3>
            <p className="mt-2 max-w-2xl text-white/60">
              Two terminal commands and you&apos;re ready to plan features in
              your agent.
            </p>
            <ol className="mt-8 space-y-8">
              {setupSteps.map((step, index) => (
                <li key={step.title}>
                  <div className="flex items-baseline gap-4">
                    <span className="font-mono text-3xl font-bold text-white/40">
                      {index + 1}
                    </span>
                    <h4 className="text-lg font-bold">{step.title}</h4>
                  </div>
                  <p className="mt-2 pl-12 text-white/60">{step.description}</p>
                  <div className="mt-4 pl-12">
                    <CopyModuleCommand command={step.command} />
                  </div>
                </li>
              ))}
            </ol>
          </div>

          <div className="border-t border-white/20 pt-12">
            <h3 className="text-xl font-bold">Plan, build, ship</h3>
            <p className="mt-2 max-w-2xl text-white/60">
              The core loop for larger features. Paste each command into your
              coding agent as you move through the workflow.
            </p>
            <div className="mt-8 grid gap-6">
              {skillGuides.map((skill) => (
                <SkillCard key={skill.skill} {...skill} />
              ))}
            </div>
          </div>

          <div className="border-t border-white/20 pt-12">
            <h3 className="text-xl font-bold">Also available</h3>
            <p className="mt-2 max-w-2xl text-white/60">
              Smaller tasks and bug fixes have dedicated skills with the same
              agent-first workflow.
            </p>
            <div className="mt-8 grid gap-6 md:grid-cols-2">
              {alternateSkills.map((skill) => (
                <SkillCard key={skill.skill} {...skill} />
              ))}
            </div>
          </div>

          <p className="text-white/60">
            Plans are committed markdown in{" "}
            <span className="font-mono text-white">.shipper/</span> — console
            users and direct-skill users work from the same files.{" "}
            <Link
              href="/docs/skills"
              className="font-mono underline underline-offset-4 transition-colors hover:text-white"
            >
              Full skills reference →
            </Link>
          </p>
        </div>
      </div>
    </section>
  );
}
