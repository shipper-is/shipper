const steps = [
  {
    number: "1",
    title: "Plan",
    skill: "shipper-plan",
    description:
      "Explores your codebase, asks clarifying questions, and writes a phased markdown plan to .shipper/open/. Plans are committed to the repo so the whole team stays aligned.",
  },
  {
    number: "2",
    title: "Build",
    skill: "shipper-build",
    description:
      "Executes one phase per agent session until the plan is complete, then moves it to .shipper/done/. Progress updates live as the agent checks boxes in the plan file.",
  },
  {
    number: "3",
    title: "Ship",
    skill: "shipper-ship",
    description:
      "Scaffolds a reviewable pull request from the completed plan — what changed, how to verify, test evidence, reuse receipts, and known risks. The agent creates the PR via gh.",
  },
] as const;

export function Workflow() {
  return (
    <section className="px-6 py-20 md:px-12 md:py-28">
      <div className="mx-auto max-w-6xl">
        <h2 className="text-3xl font-bold tracking-tight md:text-4xl">
          How it works
        </h2>
        <p className="mt-4 max-w-2xl text-white/60">
          A three-step loop: plan the feature, build it phase by phase, then ship a
          reviewable PR. Agent-agnostic — works with Claude Code, Cursor CLI, and
          opencode. Ships as a single compiled binary with no runtime dependencies.
        </p>

        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {steps.map((step) => (
            <article key={step.number} className="border border-white p-6">
              <div className="flex items-baseline gap-4">
                <span className="font-mono text-3xl font-bold text-white/40">
                  {step.number}
                </span>
                <div>
                  <h3 className="text-xl font-bold">{step.title}</h3>
                  <p className="font-mono mt-1 text-sm text-white/60">
                    {step.skill}
                  </p>
                </div>
              </div>
              <p className="mt-4 text-white/60">{step.description}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
