import {
  DEFAULT_CONFIG,
  DEFAULT_RISK_FLOOR,
  LANES,
  resolveConfig,
  type Lane,
} from "../../../skills/shipper-review/scripts/review-config.ts";
import type { ConfigSource } from "../../shared/config-schema.ts";
import {
  evidenceText,
  isRecord,
  readFloorIgnore,
  readRiskRules,
  reviewBudgetText,
  reviewReplacesDefaults,
  reviewSampleRateText,
  setEvidenceText,
  setFloorIgnore,
  setReviewBudgetText,
  setReviewReplacesDefaults,
  setReviewSampleRate,
  setRiskRules,
} from "../config-draft.ts";
import { SourceBadge } from "./source-badge.tsx";

function ruleName(rule: Record<string, unknown>): string {
  return typeof rule.name === "string" ? rule.name : "";
}

function rulePaths(rule: Record<string, unknown>): string[] {
  if (!Array.isArray(rule.paths)) return [];
  return rule.paths.map((entry) => (typeof entry === "string" ? entry : ""));
}

function ruleLanes(rule: Record<string, unknown>): string[] {
  if (!Array.isArray(rule.lanes)) return [];
  return rule.lanes.filter((entry): entry is string => typeof entry === "string");
}

function updateRule(
  rules: Array<Record<string, unknown>>,
  index: number,
  patch: Record<string, unknown>,
): Array<Record<string, unknown>> {
  return rules.map((rule, ruleIndex) => (ruleIndex === index ? { ...rule, ...patch } : rule));
}

export function ReviewSummary({
  raw,
  repoSkipped,
}: {
  raw: unknown;
  repoSkipped: boolean;
}) {
  const { config, warnings } = resolveConfig(raw);
  const record = isRecord(raw) ? raw : null;
  const replaced = record?.replaceDefaultRiskFloor === true;
  const builtinCount = replaced ? 0 : DEFAULT_RISK_FLOOR.length;

  const rows: Array<{ key: string; value: string; source: ConfigSource }> = [
    {
      key: "review.sampleRate",
      value: String(config.sampleRate),
      source:
        record !== null &&
        typeof record.sampleRate === "number" &&
        record.sampleRate >= 0 &&
        record.sampleRate <= 1
          ? "repo"
          : "default",
    },
    {
      key: "review.budget.maxFiles",
      value: String(config.budget.maxFiles),
      source: budgetFromRepo(record, "maxFiles") ? "repo" : "default",
    },
    {
      key: "review.budget.maxChangedLines",
      value: String(config.budget.maxChangedLines),
      source: budgetFromRepo(record, "maxChangedLines") ? "repo" : "default",
    },
    {
      key: "review.floorIgnore",
      value: config.floorIgnore.join(", "),
      source:
        record !== null &&
        Array.isArray(record.floorIgnore) &&
        record.floorIgnore.every((entry) => typeof entry === "string" && entry.length > 0)
          ? "repo"
          : "default",
    },
    {
      key: "review.replaceDefaultRiskFloor",
      value: replaced ? "Yes" : "No",
      source: replaced ? "repo" : "default",
    },
  ];

  return (
    <div>
      <h2>Review</h2>
      <p className="layer-note">
        Team policy for shipper-review. Built-in risk rules apply unless the repo config replaces
        them. Global and local copies of <code>review</code> are ignored.
      </p>
      {repoSkipped && (
        <div className="setup-warning">
          <p>The repo config was skipped, so these are the built-in review defaults.</p>
        </div>
      )}
      {warnings.length > 0 && (
        <div className="setup-warning">
          {warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </div>
      )}
      <div className="table-wrap">
        <table className="setup-table">
          <thead>
            <tr>
              <th scope="col">Key</th>
              <th scope="col">Value</th>
              <th scope="col">Source</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <td className="mono">{row.key}</td>
                <td>{row.value}</td>
                <td>
                  <SourceBadge source={row.source} />
                </td>
              </tr>
            ))}
            {LANES.map((lane) => (
              <tr key={lane}>
                <td className="mono">review.evidenceKinds.{lane}</td>
                <td>{config.evidenceKinds[lane].join(", ")}</td>
                <td>
                  <SourceBadge source={evidenceFromRepo(record, lane) ? "repo" : "default"} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3>Risk floor</h3>
      <p className="layer-note">
        A matching path forces a heavy review on the listed lanes. A diff larger than the budget
        escalates instead of being reviewed.
      </p>
      <div className="table-wrap">
        <table className="setup-table">
          <thead>
            <tr>
              <th scope="col">Rule</th>
              <th scope="col">Lanes</th>
              <th scope="col">Paths</th>
              <th scope="col">Source</th>
            </tr>
          </thead>
          <tbody>
            {config.riskFloor.map((rule, index) => (
              <tr key={`${rule.name}-${index}`}>
                <td className="mono">{rule.name}</td>
                <td>{rule.lanes.join(", ")}</td>
                <td className="review-paths">{rule.paths.join(", ")}</td>
                <td>
                  <SourceBadge source={index < builtinCount ? "default" : "repo"} />
                </td>
              </tr>
            ))}
            {config.riskFloor.length === 0 && (
              <tr>
                <td colSpan={4}>No risk-floor rules. Built-in rules are turned off.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function budgetFromRepo(
  record: Record<string, unknown> | null,
  key: "maxFiles" | "maxChangedLines",
): boolean {
  if (record === null || !isRecord(record.budget)) return false;
  const value = record.budget[key];
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function evidenceFromRepo(record: Record<string, unknown> | null, lane: Lane): boolean {
  if (record === null || !isRecord(record.evidenceKinds)) return false;
  const value = record.evidenceKinds[lane];
  return Array.isArray(value) && value.every((entry) => typeof entry === "string" && entry.length > 0);
}

export function ReviewFields({
  draft,
  issueFor,
  onChange,
}: {
  draft: Record<string, unknown>;
  issueFor: (path: string) => string | undefined;
  onChange: (next: Record<string, unknown>) => void;
}) {
  const floorIgnore = readFloorIgnore(draft);
  const rules = readRiskRules(draft);
  const replaces = reviewReplacesDefaults(draft);

  return (
    <fieldset className="config-form__fieldset">
      <legend>Review</legend>
      <p className="config-form__hint">
        Saved in the committed repo config. Blank fields keep the default (
        {DEFAULT_CONFIG.sampleRate} of low-risk changes are reviewed heavily, and a diff over{" "}
        {DEFAULT_CONFIG.budget.maxFiles} files or {DEFAULT_CONFIG.budget.maxChangedLines} lines
        escalates).
      </p>

      <div className="config-form__row">
        <label className="config-form__label" htmlFor="repo-review-sample">
          Sample rate
        </label>
        <div>
          <input
            id="repo-review-sample"
            type="text"
            inputMode="decimal"
            value={reviewSampleRateText(draft)}
            placeholder={String(DEFAULT_CONFIG.sampleRate)}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => onChange(setReviewSampleRate(draft, event.target.value))}
          />
          {issueFor("review.sampleRate") && (
            <span className="field-error">{issueFor("review.sampleRate")}</span>
          )}
        </div>
      </div>

      <div className="config-form__row">
        <label className="config-form__label" htmlFor="repo-review-files">
          Max files
        </label>
        <div>
          <input
            id="repo-review-files"
            type="text"
            inputMode="numeric"
            value={reviewBudgetText(draft, "maxFiles")}
            placeholder={String(DEFAULT_CONFIG.budget.maxFiles)}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => onChange(setReviewBudgetText(draft, "maxFiles", event.target.value))}
          />
          {issueFor("review.budget.maxFiles") && (
            <span className="field-error">{issueFor("review.budget.maxFiles")}</span>
          )}
        </div>
      </div>

      <div className="config-form__row">
        <label className="config-form__label" htmlFor="repo-review-lines">
          Max changed lines
        </label>
        <div>
          <input
            id="repo-review-lines"
            type="text"
            inputMode="numeric"
            value={reviewBudgetText(draft, "maxChangedLines")}
            placeholder={String(DEFAULT_CONFIG.budget.maxChangedLines)}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) =>
              onChange(setReviewBudgetText(draft, "maxChangedLines", event.target.value))
            }
          />
          {issueFor("review.budget.maxChangedLines") && (
            <span className="field-error">{issueFor("review.budget.maxChangedLines")}</span>
          )}
        </div>
      </div>

      <div className="config-form__row">
        <span className="config-form__label">Ignore globs</span>
        <div>
          {floorIgnore === null ? (
            <button
              type="button"
              className="secondary-button"
              onClick={() => onChange(setFloorIgnore(draft, []))}
            >
              Set list
            </button>
          ) : (
            <>
              {floorIgnore.length === 0 && (
                <p className="config-form__hint">No ignore globs in this file.</p>
              )}
              {floorIgnore.map((glob, index) => (
                <div className="extra-dir-row" key={index}>
                  <input
                    type="text"
                    aria-label={`Ignore glob ${index + 1}`}
                    value={glob}
                    placeholder="*.md"
                    autoComplete="off"
                    spellCheck={false}
                    onChange={(event) => {
                      const next = floorIgnore.slice();
                      next[index] = event.target.value;
                      onChange(setFloorIgnore(draft, next));
                    }}
                  />
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() =>
                      onChange(setFloorIgnore(draft, floorIgnore.filter((_, row) => row !== index)))
                    }
                  >
                    Remove
                  </button>
                  {issueFor(`review.floorIgnore.${index}`) && (
                    <span className="field-error">{issueFor(`review.floorIgnore.${index}`)}</span>
                  )}
                </div>
              ))}
              <div className="button-row">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => onChange(setFloorIgnore(draft, [...floorIgnore, ""]))}
                >
                  Add glob
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => onChange(setFloorIgnore(draft, undefined))}
                >
                  Not set
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="config-form__row">
        <span className="config-form__label">Built-in rules</span>
        <div>
          <label className="lane-choices">
            <input
              type="checkbox"
              checked={replaces}
              onChange={(event) => onChange(setReviewReplacesDefaults(draft, event.target.checked))}
            />
            Replace built-in rules
          </label>
          <ul className="plain-list">
            {(replaces ? [] : DEFAULT_RISK_FLOOR).map((rule) => (
              <li key={rule.name}>
                <span className="mono">{rule.name}</span> — {rule.lanes.join(", ")}
                <p className="review-paths">{rule.paths.join(", ")}</p>
              </li>
            ))}
          </ul>
          {replaces && (
            <p className="config-form__hint">
              Auth, billing, migrations, infra, dependencies, and secrets are not applied. Only the
              extra rules below force a heavy review.
            </p>
          )}
        </div>
      </div>

      <div className="config-form__row">
        <span className="config-form__label">Extra rules</span>
        <div>
          {rules === null ? (
            <button
              type="button"
              className="secondary-button"
              onClick={() =>
                onChange(setRiskRules(draft, [{ name: "", paths: [""], lanes: ["security"] }]))
              }
            >
              Add rule
            </button>
          ) : (
            <>
              {rules.map((rule, index) => {
                const lanes = ruleLanes(rule);
                const paths = rulePaths(rule);
                return (
                  <div className="stack-block" key={index}>
                    <div className="extra-dir-row">
                      <input
                        type="text"
                        aria-label={`Risk rule ${index + 1} name`}
                        value={ruleName(rule)}
                        placeholder="payments-webhooks"
                        autoComplete="off"
                        spellCheck={false}
                        onChange={(event) =>
                          onChange(
                            setRiskRules(draft, updateRule(rules, index, { name: event.target.value })),
                          )
                        }
                      />
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() =>
                          onChange(setRiskRules(draft, rules.filter((_, row) => row !== index)))
                        }
                      >
                        Remove rule
                      </button>
                    </div>
                    {issueFor(`review.riskFloor.${index}.name`) && (
                      <span className="field-error">{issueFor(`review.riskFloor.${index}.name`)}</span>
                    )}
                    <div className="lane-choices">
                      {LANES.map((lane) => (
                        <label key={lane}>
                          <input
                            type="checkbox"
                            checked={lanes.includes(lane)}
                            onChange={(event) => {
                              const next = event.target.checked
                                ? [...lanes, lane]
                                : lanes.filter((item) => item !== lane);
                              onChange(setRiskRules(draft, updateRule(rules, index, { lanes: next })));
                            }}
                          />
                          {lane}
                        </label>
                      ))}
                    </div>
                    {issueFor(`review.riskFloor.${index}.lanes`) && (
                      <span className="field-error">{issueFor(`review.riskFloor.${index}.lanes`)}</span>
                    )}
                    {paths.map((glob, pathIndex) => (
                      <div className="extra-dir-row" key={pathIndex}>
                        <input
                          type="text"
                          aria-label={`Risk rule ${index + 1} glob ${pathIndex + 1}`}
                          value={glob}
                          placeholder="**/payments/**"
                          autoComplete="off"
                          spellCheck={false}
                          onChange={(event) => {
                            const next = paths.slice();
                            next[pathIndex] = event.target.value;
                            onChange(setRiskRules(draft, updateRule(rules, index, { paths: next })));
                          }}
                        />
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() =>
                            onChange(
                              setRiskRules(
                                draft,
                                updateRule(rules, index, {
                                  paths: paths.filter((_, row) => row !== pathIndex),
                                }),
                              ),
                            )
                          }
                        >
                          Remove
                        </button>
                        {issueFor(`review.riskFloor.${index}.paths.${pathIndex}`) && (
                          <span className="field-error">
                            {issueFor(`review.riskFloor.${index}.paths.${pathIndex}`)}
                          </span>
                        )}
                      </div>
                    ))}
                    {issueFor(`review.riskFloor.${index}.paths`) && (
                      <span className="field-error">{issueFor(`review.riskFloor.${index}.paths`)}</span>
                    )}
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() =>
                        onChange(setRiskRules(draft, updateRule(rules, index, { paths: [...paths, ""] })))
                      }
                    >
                      Add glob
                    </button>
                  </div>
                );
              })}
              <button
                type="button"
                className="secondary-button"
                onClick={() =>
                  onChange(
                    setRiskRules(draft, [...rules, { name: "", paths: [""], lanes: ["security"] }]),
                  )
                }
              >
                Add rule
              </button>
            </>
          )}
        </div>
      </div>

      <div className="config-form__row">
        <span className="config-form__label">Evidence kinds</span>
        <div>
          <p className="config-form__hint">
            Comma-separated proof that lets a finding block. Blank keeps the default for that lane.
          </p>
          {LANES.map((lane) => (
            <div className="extra-dir-row" key={lane}>
              <label className="mono" htmlFor={`repo-review-evidence-${lane}`}>
                {lane}
              </label>
              <input
                id={`repo-review-evidence-${lane}`}
                type="text"
                value={evidenceText(draft, lane)}
                placeholder={DEFAULT_CONFIG.evidenceKinds[lane].join(", ")}
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => onChange(setEvidenceText(draft, lane, event.target.value))}
              />
              {issueFor(`review.evidenceKinds.${lane}`) && (
                <span className="field-error">{issueFor(`review.evidenceKinds.${lane}`)}</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </fieldset>
  );
}
