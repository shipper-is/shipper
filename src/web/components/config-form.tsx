import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { modelVendor } from "../../agents/model-variants.ts";
import {
  AGENT_KINDS,
  ARTIFACT_TYPES,
  DEFAULT_ARTIFACT_PATHS,
  SKILL_NAMES,
  type AgentKind,
  type ConfigLayer,
  type SkillName,
} from "../../shared/config-schema.ts";
import type { LayerStateDto, ModelFamilyDto } from "../../shared/protocol.ts";
import {
  cloneDraft,
  draftIssues,
  draftsEqual,
  instructionValue,
  isRecord,
  pathValue,
  payloadForSave,
  readExtraDirs,
  readGit,
  readReviewModels,
  readSkillModel,
  readSearchEnabled,
  setExtraDirs,
  setGitField,
  setInstruction,
  setModel,
  setPath,
  setSearchEnabled,
  writeReviewModels,
  writeSkillModel,
} from "../config-draft.ts";
import { AGENT_LABELS } from "../format.ts";
import type { SaveResult } from "../hooks/use-socket.ts";
import { ModelPicker } from "./model-picker.tsx";
import { ReviewFields } from "./review-fields.tsx";

const FORM_KEYS = new Set(["models", "instructions", "git", "search", "paths", "embeddings", "state"]);

function SkillInstructions({
  skill,
  text,
  onChange,
}: {
  skill: SkillName;
  text: string;
  onChange: (value: string) => void;
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const initialText = useRef(text);
  useEffect(() => {
    if (detailsRef.current && initialText.current.length > 0) detailsRef.current.open = true;
  }, []);

  return (
    <details ref={detailsRef} className="config-form__skill">
      <summary>{skill}</summary>
      <textarea
        aria-label={`${skill} instructions`}
        value={text}
        onChange={(event) => onChange(event.target.value)}
      />
    </details>
  );
}

type SkillRole = "research" | "investigate" | "phase";

type ModelSlot =
  | { kind: "launch"; skill: SkillName }
  | { kind: "role"; skill: SkillName; role: SkillRole }
  | { kind: "triage" }
  | { kind: "list"; tier: "light" | "heavy" };

type PickerTarget = { agent: AgentKind; slot: ModelSlot };

const ROLE_ROWS: Array<{
  skill: SkillName;
  role: SkillRole;
  label: string;
  hint?: string;
}> = [
  { skill: "shipper-plan", role: "research", label: "shipper-plan research" },
  { skill: "shipper-spike", role: "research", label: "shipper-spike research" },
  { skill: "shipper-bug", role: "investigate", label: "shipper-bug investigate" },
  {
    skill: "shipper-loop",
    role: "phase",
    label: "shipper-loop phase",
    hint: "Falls back to the shipper-build model when unset",
  },
];

function slotTitle(slot: ModelSlot): string {
  switch (slot.kind) {
    case "launch":
      return slot.skill;
    case "role":
      return `${slot.skill} ${slot.role}`;
    case "triage":
      return "review triage";
    case "list":
      return `review ${slot.tier}`;
  }
}

function assignModel(
  draft: Record<string, unknown>,
  agent: AgentKind,
  slot: ModelSlot,
  modelId: string,
): Record<string, unknown> {
  if (slot.kind === "launch") return setModel(draft, agent, slot.skill, modelId);
  if (slot.kind === "role") {
    const skill = readSkillModel(draft, agent, slot.skill);
    return writeSkillModel(draft, agent, slot.skill, { ...skill, [slot.role]: modelId });
  }
  const review = readReviewModels(draft, agent);
  if (slot.kind === "triage") {
    return writeReviewModels(draft, agent, { ...review, triage: modelId });
  }
  const list = review[slot.tier] ?? [];
  if (list.includes(modelId)) return draft;
  return writeReviewModels(draft, agent, { ...review, [slot.tier]: [...list, modelId] });
}

function moveItem(ids: string[], index: number, delta: number): string[] {
  const target = index + delta;
  if (target < 0 || target >= ids.length) return ids;
  const next = ids.slice();
  const current = next[index];
  const swapped = next[target];
  if (current === undefined || swapped === undefined) return ids;
  next[index] = swapped;
  next[target] = current;
  return next;
}

function singleFamilyList(ids: string[]): boolean {
  if (ids.length < 2) return false;
  return new Set(ids.map((id) => modelVendor(id))).size < 2;
}

function ModelChoiceRow({
  label,
  value,
  hint,
  issue,
  onChoose,
  onClear,
}: {
  label: string;
  value: string | undefined;
  hint?: string;
  issue?: string;
  onChoose: () => void;
  onClear: () => void;
}) {
  return (
    <>
      <div className="model-row">
        <span className="mono">{label}</span>
        <span className="model-row__value mono">{value ?? "Not set"}</span>
        <span className="button-row">
          <button type="button" className="secondary-button" onClick={onChoose}>
            Choose
          </button>
          {(value || issue) && (
            <button type="button" className="secondary-button" onClick={onClear}>
              Clear
            </button>
          )}
        </span>
      </div>
      {hint && <p className="config-form__hint">{hint}</p>}
      {issue && <span className="field-error">{issue}</span>}
    </>
  );
}

function ModelListRows({
  label,
  ids,
  issue,
  onAdd,
  onChange,
}: {
  label: string;
  ids: string[];
  issue?: string;
  onAdd: () => void;
  onChange: (ids: string[]) => void;
}) {
  return (
    <>
      <div className="model-row">
        <span className="mono">{label}</span>
        <span className="model-row__value mono">{ids.length === 0 ? "Not set" : ""}</span>
        <span className="button-row">
          <button type="button" className="secondary-button" onClick={onAdd}>
            Add
          </button>
          {issue && ids.length === 0 && (
            <button type="button" className="secondary-button" onClick={() => onChange([])}>
              Clear
            </button>
          )}
        </span>
      </div>
      {ids.map((id, index) => (
        <div className="model-row" key={id}>
          <span />
          <span className="model-row__value mono">{id}</span>
          <span className="button-row">
            {index > 0 && (
              <button
                type="button"
                className="secondary-button"
                onClick={() => onChange(moveItem(ids, index, -1))}
              >
                Move up
              </button>
            )}
            {index < ids.length - 1 && (
              <button
                type="button"
                className="secondary-button"
                onClick={() => onChange(moveItem(ids, index, 1))}
              >
                Move down
              </button>
            )}
            <button
              type="button"
              className="secondary-button"
              onClick={() => onChange(ids.filter((_, row) => row !== index))}
            >
              Remove
            </button>
          </span>
        </div>
      ))}
      {singleFamilyList(ids) && (
        <span className="field-error">This list is a single model family. Review panels look for two.</span>
      )}
      {issue && <span className="field-error">{issue}</span>}
    </>
  );
}

export function ConfigForm({
  layer,
  layerState,
  detectedAgents,
  modelsByAgent,
  lastSave,
  saveEventId,
  notice,
  dirtyRef,
  connected,
  onSave,
  onListModels,
}: {
  layer: ConfigLayer;
  layerState: LayerStateDto;
  detectedAgents: AgentKind[];
  modelsByAgent: Partial<Record<AgentKind, ModelFamilyDto[]>>;
  lastSave: SaveResult | null;
  saveEventId: number;
  notice: string | null;
  dirtyRef: MutableRefObject<boolean>;
  connected: boolean;
  onSave: (draft: Record<string, unknown>) => void;
  onListModels: (agent: AgentKind) => void;
}) {
  const serverDraft = cloneDraft(layerState.value);
  const serverKey = JSON.stringify(serverDraft);
  const [draft, setDraft] = useState(serverDraft);
  const [baseline, setBaseline] = useState(serverDraft);
  const [diskChanged, setDiskChanged] = useState(false);
  const [picker, setPicker] = useState<PickerTarget | null>(null);
  const [loadingModels, setLoadingModels] = useState(false);
  const pendingSaveKey = useRef<string | null>(null);
  const handledSave = useRef(saveEventId);
  const seenNotice = useRef(notice);

  const dirty = !draftsEqual(draft, baseline);
  dirtyRef.current = dirty;

  useEffect(() => {
    return () => {
      dirtyRef.current = false;
    };
  }, [dirtyRef]);

  // Draft keystrokes must not rerun this. A second pass would treat a successful
  // save as a clean form and copy the previous server snapshot over it.
  useEffect(() => {
    const next = cloneDraft(layerState.value);
    const nextKey = JSON.stringify(next);
    const pending = pendingSaveKey.current;
    const justSaved = saveEventId !== handledSave.current && saveEventId !== 0;

    if (justSaved) {
      handledSave.current = saveEventId;
      pendingSaveKey.current = null;
      if (lastSave?.layer === layer && lastSave.ok && pending !== null) {
        const currentPayload = JSON.stringify(payloadForSave(layer, draft));
        if (currentPayload === pending) {
          const serverPayload = JSON.stringify(payloadForSave(layer, next));
          const chosen = serverPayload === pending ? next : cloneDraft(draft);
          setDraft(chosen);
          setBaseline(chosen);
          setDiskChanged(false);
          return;
        }
      }
    }

    if (draftsEqual(draft, baseline)) {
      if (nextKey !== JSON.stringify(baseline)) {
        setDraft(next);
        setBaseline(next);
      }
      setDiskChanged(false);
      return;
    }

    setDiskChanged(nextKey !== JSON.stringify(baseline));
  }, [serverKey, saveEventId]);

  useEffect(() => {
    if (picker && modelsByAgent[picker.agent]) setLoadingModels(false);
  }, [picker, modelsByAgent]);

  useEffect(() => {
    if (notice && notice !== seenNotice.current && loadingModels) {
      setPicker(null);
      setLoadingModels(false);
    }
    seenNotice.current = notice;
  }, [notice, loadingModels]);

  const issues = draftIssues(layer, draft);
  const issueFor = (path: string) => issues.find((issue) => issue.path === path)?.message;
  const git = readGit(draft);
  const extraDirs = readExtraDirs(draft);
  const searchEnabled = readSearchEnabled(draft);
  const saveDisabled = issues.length > 0 || !dirty || layerState.error !== null || !connected;

  function save() {
    if (saveDisabled) return;
    const payload = payloadForSave(layer, draft);
    pendingSaveKey.current = JSON.stringify(payload);
    onSave(payload);
  }

  function discard() {
    setDraft(cloneDraft(baseline));
  }

  function reloadFromDisk() {
    const next = cloneDraft(layerState.value);
    setDraft(next);
    setBaseline(next);
    setDiskChanged(false);
  }

  function chooseModel(agent: AgentKind, slot: ModelSlot) {
    setPicker({ agent, slot });
    if (modelsByAgent[agent]) {
      setLoadingModels(false);
      return;
    }
    setLoadingModels(true);
    onListModels(agent);
  }

  const untouched = Object.keys(draft).filter(
    (key) => !FORM_KEYS.has(key) && !(layer === "repo" && key === "review"),
  );
  const hiddenModelAgents = AGENT_KINDS.filter((agent) => {
    if (detectedAgents.includes(agent)) return false;
    return isRecord(draft.models) && isRecord(draft.models[agent]);
  });

  const families = picker ? modelsByAgent[picker.agent] : undefined;

  return (
    <form
      className="config-form"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      {diskChanged && (
        <div className="setup-warning">
          <p>This file changed on disk.</p>
          <button type="button" className="secondary-button" onClick={reloadFromDisk}>
            Reload
          </button>
        </div>
      )}

      {layer === "repo" && (
        <fieldset className="config-form__fieldset">
          <legend>Paths</legend>
          <p className="config-form__hint">
            Leave a field blank to keep the default. The placeholder shows that default.
          </p>
          {ARTIFACT_TYPES.map((type) => {
            const message = issueFor(`paths.${type}`);
            return (
              <div className="config-form__row" key={type}>
                <label className="config-form__label" htmlFor={`${layer}-path-${type}`}>
                  {type}
                </label>
                <div>
                  <input
                    id={`${layer}-path-${type}`}
                    type="text"
                    value={pathValue(draft, type)}
                    placeholder={DEFAULT_ARTIFACT_PATHS[type]}
                    autoComplete="off"
                    spellCheck={false}
                    onChange={(event) => {
                      const value = event.target.value;
                      setDraft((current) => setPath(current, type, value));
                    }}
                  />
                  {message && <span className="field-error">{message}</span>}
                </div>
              </div>
            );
          })}
        </fieldset>
      )}

      <fieldset className="config-form__fieldset">
        <legend>Git</legend>
        <p className="config-form__hint">Not set removes the key so a lower layer can apply.</p>
        <div className="config-form__row">
          <label className="config-form__label" htmlFor={`${layer}-branch-mode`}>
            Branch mode
          </label>
          <select
            id={`${layer}-branch-mode`}
            value={git.branchMode}
            onChange={(event) => {
              const value = event.target.value;
              setDraft((current) =>
                setGitField(
                  current,
                  "branchMode",
                  value === "current" || value === "feature" ? value : undefined,
                ),
              );
            }}
          >
            <option value="">Not set</option>
            <option value="current">Current branch</option>
            <option value="feature">Feature branch</option>
          </select>
        </div>
        <div className="config-form__row">
          <label className="config-form__label" htmlFor={`${layer}-commit`}>
            Commit each phase
          </label>
          <select
            id={`${layer}-commit`}
            value={git.commitEachPhase}
            onChange={(event) => {
              const value = event.target.value;
              setDraft((current) =>
                setGitField(
                  current,
                  "commitEachPhase",
                  value === "yes" ? true : value === "no" ? false : undefined,
                ),
              );
            }}
          >
            <option value="">Not set</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </div>
        <div className="config-form__row">
          <label className="config-form__label" htmlFor={`${layer}-prefix`}>
            Branch prefix
          </label>
          <div>
            <input
              id={`${layer}-prefix`}
              type="text"
              value={git.branchPrefix}
              placeholder="Not set"
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => {
                const value = event.target.value;
                setDraft((current) =>
                  setGitField(current, "branchPrefix", value === "" ? undefined : value),
                );
              }}
            />
            {issueFor("git.branchPrefix") && (
              <span className="field-error">{issueFor("git.branchPrefix")}</span>
            )}
          </div>
        </div>
      </fieldset>

      <fieldset className="config-form__fieldset">
        <legend>Instructions</legend>
        <p className="config-form__hint">
          Instructions accumulate across layers. Empty text removes that entry from this layer.
        </p>
        <div className="config-form__row">
          <label className="config-form__label" htmlFor={`${layer}-instructions-all`}>
            All skills
          </label>
          <textarea
            id={`${layer}-instructions-all`}
            value={instructionValue(draft, "all")}
            onChange={(event) => {
              const value = event.target.value;
              setDraft((current) => setInstruction(current, "all", value));
            }}
          />
        </div>
        {SKILL_NAMES.map((skill) => (
          <SkillInstructions
            key={skill}
            skill={skill}
            text={instructionValue(draft, skill)}
            onChange={(value) => setDraft((current) => setInstruction(current, skill, value))}
          />
        ))}
      </fieldset>

      <fieldset className="config-form__fieldset">
        <legend>Models</legend>
        <p className="config-form__hint">
          Launch rows are the model used when another skill starts that skill. The rows below are
          the helpers that skill starts itself.
        </p>
        {detectedAgents.length === 0 ? (
          <p className="empty-note">No coding agents detected, so models cannot be chosen here.</p>
        ) : (
          detectedAgents.map((agent) => {
            const review = readReviewModels(draft, agent);
            return (
              <div key={agent} className="stack-block">
                <h3>{AGENT_LABELS[agent]}</h3>
                {SKILL_NAMES.map((skill) => {
                  const value = readSkillModel(draft, agent, skill).model;
                  return (
                    <ModelChoiceRow
                      key={skill}
                      label={skill}
                      value={value}
                      issue={
                        issueFor(`models.${agent}.${skill}`) ??
                        issueFor(`models.${agent}.${skill}.model`)
                      }
                      onChoose={() => chooseModel(agent, { kind: "launch", skill })}
                      onClear={() =>
                        setDraft((current) => setModel(current, agent, skill, undefined))
                      }
                    />
                  );
                })}
                {ROLE_ROWS.map((row) => {
                  const value = readSkillModel(draft, agent, row.skill)[row.role];
                  return (
                    <ModelChoiceRow
                      key={row.label}
                      label={row.label}
                      value={value}
                      hint={row.hint}
                      issue={issueFor(`models.${agent}.${row.skill}.${row.role}`)}
                      onChoose={() =>
                        chooseModel(agent, { kind: "role", skill: row.skill, role: row.role })
                      }
                      onClear={() =>
                        setDraft((current) => {
                          const skill = readSkillModel(current, agent, row.skill);
                          delete skill[row.role];
                          return writeSkillModel(current, agent, row.skill, skill);
                        })
                      }
                    />
                  );
                })}
                <ModelChoiceRow
                  label="review triage"
                  value={review.triage}
                  issue={
                    issueFor(`models.${agent}.shipper-review.triage`) ??
                    issueFor(`models.${agent}.shipper-review`)
                  }
                  onChoose={() => chooseModel(agent, { kind: "triage" })}
                  onClear={() =>
                    setDraft((current) => {
                      const next = readReviewModels(current, agent);
                      delete next.triage;
                      return writeReviewModels(current, agent, next);
                    })
                  }
                />
                {(["light", "heavy"] as const).map((tier) => (
                  <ModelListRows
                    key={tier}
                    label={`review ${tier}`}
                    ids={review[tier] ?? []}
                    issue={issueFor(`models.${agent}.shipper-review.${tier}`)}
                    onAdd={() => chooseModel(agent, { kind: "list", tier })}
                    onChange={(ids) =>
                      setDraft((current) => {
                        const next = readReviewModels(current, agent);
                        if (ids.length === 0) delete next[tier];
                        else next[tier] = ids;
                        return writeReviewModels(current, agent, next);
                      })
                    }
                  />
                ))}
              </div>
            );
          })
        )}
        {hiddenModelAgents.length > 0 && (
          <p className="config-form__hint">
            This file also sets models for{" "}
            {hiddenModelAgents.map((agent) => AGENT_LABELS[agent]).join(", ")}. Those values are
            kept when you save, including review tiers and helper roles.
          </p>
        )}
      </fieldset>

      <fieldset className="config-form__fieldset">
        <legend>Search</legend>
        <div className="config-form__row">
          <label className="config-form__label" htmlFor={`${layer}-search-enabled`}>
            Enabled
          </label>
          <select
            id={`${layer}-search-enabled`}
            value={searchEnabled === undefined ? "" : searchEnabled ? "on" : "off"}
            onChange={(event) => {
              const value = event.target.value;
              setDraft((current) =>
                setSearchEnabled(current, value === "on" ? true : value === "off" ? false : undefined),
              );
            }}
          >
            <option value="">Not set</option>
            <option value="on">On</option>
            <option value="off">Off</option>
          </select>
        </div>
        <div className="config-form__row">
          <span className="config-form__label">Extra directories</span>
          <div>
            {extraDirs === null ? (
              <button
                type="button"
                className="secondary-button"
                onClick={() => setDraft((current) => setExtraDirs(current, []))}
              >
                Set list
              </button>
            ) : (
              <>
                {extraDirs.length === 0 && <p className="config-form__hint">No directories in this layer.</p>}
                {extraDirs.map((dir, index) => (
                  <div className="extra-dir-row" key={index}>
                    <input
                      type="text"
                      aria-label={`Extra directory ${index + 1}`}
                      value={dir}
                      placeholder="docs/adr"
                      autoComplete="off"
                      spellCheck={false}
                      onChange={(event) => {
                        const value = event.target.value;
                        setDraft((current) => {
                          const rows = readExtraDirs(current) ?? [];
                          const next = rows.slice();
                          next[index] = value;
                          return setExtraDirs(current, next);
                        });
                      }}
                    />
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() =>
                        setDraft((current) => {
                          const rows = readExtraDirs(current) ?? [];
                          return setExtraDirs(
                            current,
                            rows.filter((_, rowIndex) => rowIndex !== index),
                          );
                        })
                      }
                    >
                      Remove
                    </button>
                    {issueFor(`search.extraDirs.${index}`) && (
                      <span className="field-error">{issueFor(`search.extraDirs.${index}`)}</span>
                    )}
                  </div>
                ))}
                <div className="button-row">
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() =>
                      setDraft((current) => setExtraDirs(current, [...(readExtraDirs(current) ?? []), ""]))
                    }
                  >
                    Add directory
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => setDraft((current) => setExtraDirs(current, undefined))}
                  >
                    Not set
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </fieldset>

      {layer === "repo" && (
        <ReviewFields
          draft={draft}
          issueFor={issueFor}
          onChange={(next) => setDraft(next)}
        />
      )}

      {layer === "global" && (isRecord(draft.embeddings) || isRecord(draft.state)) && (
        <p className="config-form__hint">
          Embedding idle time and update-check state stay as they are on disk.
        </p>
      )}
      {untouched.length > 0 && (
        <p className="config-form__hint">
          This file has other keys that stay as they are: {untouched.join(", ")}.
        </p>
      )}

      <div className="config-form__actions">
        <button type="submit" className="primary-button" disabled={saveDisabled}>
          Save
        </button>
        <button type="button" className="secondary-button" disabled={!dirty} onClick={discard}>
          Discard
        </button>
      </div>
      {layerState.error && (
        <p className="field-error">This file cannot be replaced until the JSON is fixed.</p>
      )}
      {lastSave?.layer === layer && !lastSave.ok && (
        <p className="field-error">{lastSave.error ?? "Save failed."}</p>
      )}
      {lastSave?.layer === layer && lastSave.ok && !dirty && !diskChanged && (
        <p className="save-ok">Saved.</p>
      )}

      {picker && loadingModels && (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal">
            <p>Loading models for {AGENT_LABELS[picker.agent]}…</p>
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                setPicker(null);
                setLoadingModels(false);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {picker && !loadingModels && families && families.length > 0 && (
        <ModelPicker
          title={`${slotTitle(picker.slot)} for ${AGENT_LABELS[picker.agent]}`}
          families={families}
          onSelect={(modelId) => {
            setDraft((current) => assignModel(current, picker.agent, picker.slot, modelId));
            setPicker(null);
          }}
          onCancel={() => setPicker(null)}
        />
      )}
      {picker && !loadingModels && families && families.length === 0 && (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal">
            <p>No models were reported for {AGENT_LABELS[picker.agent]}.</p>
            <button type="button" className="secondary-button" onClick={() => setPicker(null)}>
              Close
            </button>
          </div>
        </div>
      )}
    </form>
  );
}
