import { useEffect, useRef, useState, type MutableRefObject } from "react";
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
  modelValue,
  pathValue,
  payloadForSave,
  readExtraDirs,
  readGit,
  readSearchEnabled,
  setExtraDirs,
  setGitField,
  setInstruction,
  setModel,
  setPath,
  setSearchEnabled,
} from "../config-draft.ts";
import { AGENT_LABELS } from "../format.ts";
import type { SaveResult } from "../hooks/use-socket.ts";
import { ModelPicker } from "./model-picker.tsx";

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

type PickerTarget = { agent: AgentKind; skill: SkillName };

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

  function chooseModel(agent: AgentKind, skill: SkillName) {
    setPicker({ agent, skill });
    if (modelsByAgent[agent]) {
      setLoadingModels(false);
      return;
    }
    setLoadingModels(true);
    onListModels(agent);
  }

  const untouched = Object.keys(draft).filter((key) => !FORM_KEYS.has(key));
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
          Used when a skill starts a subagent for another skill, for example shipper-loop running
          shipper-build.
        </p>
        {detectedAgents.length === 0 ? (
          <p className="empty-note">No coding agents detected, so models cannot be chosen here.</p>
        ) : (
          detectedAgents.map((agent) => (
            <div key={agent} className="stack-block">
              <h3>{AGENT_LABELS[agent]}</h3>
              {SKILL_NAMES.map((skill) => {
                const value = modelValue(draft, agent, skill);
                return (
                  <div className="model-row" key={skill}>
                    <span className="mono">{skill}</span>
                    <span className="model-row__value mono">{value ?? "Not set"}</span>
                    <span className="button-row">
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => chooseModel(agent, skill)}
                      >
                        Choose
                      </button>
                      {value && (
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() =>
                            setDraft((current) => setModel(current, agent, skill, undefined))
                          }
                        >
                          Clear
                        </button>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          ))
        )}
        {hiddenModelAgents.length > 0 && (
          <p className="config-form__hint">
            This file also sets models for{" "}
            {hiddenModelAgents.map((agent) => AGENT_LABELS[agent]).join(", ")}. Those values are
            kept when you save.
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
          title={`${picker.skill} for ${AGENT_LABELS[picker.agent]}`}
          families={families}
          onSelect={(modelId) => {
            setDraft((current) => setModel(current, picker.agent, picker.skill, modelId));
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
