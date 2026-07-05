const personas = [
  {
    title: "Developers",
    description:
      "Stay in flow. Plans are committed markdown in your repo; builds run phase-by-phase with your agent of choice — Claude Code, Cursor CLI, or opencode.",
  },
  {
    title: "Vibe-coders",
    description:
      "Structure without ceremony. Describe the feature, answer a few clarifying questions in the TUI, and watch Shipper build it phase by phase — then ship a reviewable PR.",
  },
  {
    title: "Non-developers",
    description:
      "Ship real changes. The plan/build/ship loop asks clarifying questions and handles the code — you focus on what to build, not how.",
  },
] as const;

export function Personas() {
  return (
    <section className="px-6 py-20 md:px-12 md:py-28">
      <div className="mx-auto max-w-6xl">
        <h2 className="text-3xl font-bold tracking-tight md:text-4xl">
          Built for every role on the team
        </h2>
        <p className="mt-4 max-w-2xl text-white/60">
          Shipper turns feature ideas into committed plans and working code —
          whether you write the code yourself or not.
        </p>

        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {personas.map((persona) => (
            <article
              key={persona.title}
              className="border border-white p-6"
            >
              <h3 className="text-xl font-bold">{persona.title}</h3>
              <p className="mt-4 text-white/60">{persona.description}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
