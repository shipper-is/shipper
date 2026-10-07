import type { ClientMessage, SetupSnapshot } from "../../shared/protocol.ts";
import { AGENT_LABELS } from "../format.ts";

export function SkillsSection({
  setup,
  busy,
  connected,
  send,
}: {
  setup: SetupSnapshot;
  busy: boolean;
  connected: boolean;
  send: (msg: ClientMessage) => void;
}) {
  return (
    <section className="setup-section" data-setup-section="skills">
      <h1>Skills</h1>
      <p className="setup-section__lede">
        Installed skill files compared with the copy bundled in this Shipper build.
      </p>
      <div className="button-row">
        <button
          type="button"
          className="primary-button"
          data-action="refresh-skills"
          disabled={busy || !connected}
          onClick={() => send({ type: "run-action", action: { kind: "refresh-skills" } })}
        >
          Refresh skills
        </button>
      </div>
      {setup.skills.length === 0 ? (
        <p className="empty-note">No coding agents detected.</p>
      ) : (
        setup.skills.map((group) => (
          <div key={group.agent} className="stack-block">
            <h2>{AGENT_LABELS[group.agent]}</h2>
            <p className="mono">{group.root}</p>
            <div className="table-wrap">
              <table className="setup-table">
                <thead>
                  <tr>
                    <th scope="col">Skill</th>
                    <th scope="col">State</th>
                  </tr>
                </thead>
                <tbody>
                  {group.skills.map((skill) => (
                    <tr key={skill.name}>
                      <td className="mono">{skill.name}</td>
                      <td>
                        <span className={`skill-state skill-state--${skill.state}`}>{skill.state}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))
      )}
    </section>
  );
}
