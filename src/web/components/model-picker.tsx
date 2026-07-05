import { useState } from "react";
import type { ClientMessage, ModelFamilyDto, ModelPickRequest } from "../../shared/protocol.ts";

type ModelPickerProps = {
  request: ModelPickRequest;
  onSelect: (msg: ClientSelectModel) => void;
  onCancel: () => void;
};

type ClientSelectModel = Extract<ClientMessage, { type: "select-model" }>;

type Step =
  | { type: "family" }
  | { type: "variant"; family: ModelFamilyDto };

export function ModelPicker({ request, onSelect, onCancel }: ModelPickerProps) {
  const [step, setStep] = useState<Step>({ type: "family" });

  const title =
    request.skill === "shipper-plan"
      ? "Choose a model for plan creation"
      : "Choose a model for builds";

  if (step.type === "family") {
    return (
      <div className="modal-overlay" role="dialog" aria-modal="true">
        <div className="modal model-picker-modal">
          <header className="modal-header">
            <h2>{title}</h2>
            <button type="button" className="icon-button" onClick={onCancel} aria-label="Close">
              ✕
            </button>
          </header>
          <p className="modal-subtitle">Select a model family</p>
          <ul className="model-family-list">
            {request.families.map((family) => (
              <li key={family.id}>
                <button
                  type="button"
                  className="model-family-row"
                  onClick={() => {
                    if (family.variants.length === 1) {
                      onSelect({
                        type: "select-model",
                        skill: request.skill,
                        modelId: family.variants[0]!.id,
                      });
                    } else {
                      setStep({ type: "variant", family });
                    }
                  }}
                >
                  <span className="model-family-label">{family.label}</span>
                  <span className="model-family-hint">
                    {family.variants.length === 1
                      ? family.variants[0]!.id
                      : `${family.variants.length} variants`}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal model-picker-modal">
        <header className="modal-header">
          <h2>{step.family.label}</h2>
          <button type="button" className="icon-button" onClick={onCancel} aria-label="Close">
            ✕
          </button>
        </header>
        <p className="modal-subtitle">Choose a variant</p>
        <ul className="model-family-list">
          {step.family.variants.map((variant) => (
            <li key={variant.id}>
              <button
                type="button"
                className="model-family-row"
                onClick={() =>
                  onSelect({
                    type: "select-model",
                    skill: request.skill,
                    modelId: variant.id,
                  })
                }
              >
                <span className="model-family-label">{variant.label}</span>
                <span className="model-family-hint">{variant.id}</span>
              </button>
            </li>
          ))}
        </ul>
        <button type="button" className="text-button" onClick={() => setStep({ type: "family" })}>
          ← Back to families
        </button>
      </div>
    </div>
  );
}
