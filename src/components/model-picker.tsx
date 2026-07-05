import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import { AGENT_LABELS } from "../agents/labels.ts";
import {
  EFFORT_LABELS,
  contextLabel,
  familyHasVariants,
  getFamilyContexts,
  getFamilyEfforts,
  groupModelFamilies,
  hasSpeedChoice,
  parseSavedModelChoice,
  resolveVariantChoice,
  type ModelEffort,
  type ModelFamily,
} from "../agents/model-variants.ts";
import { clearModelListCache, listModels, type ModelOption } from "../agents/models.ts";
import type { AgentKind } from "../agents/types.ts";
import type { SkillName } from "../core/skills.ts";
import { SearchableList } from "./searchable-list.tsx";

const SKILL_LABELS: Record<SkillName, string> = {
  "shipper-plan": "shipper-plan",
  "shipper-build": "shipper-build",
};

type PickerStep = "family" | "context" | "effort" | "speed";

type ModelPickerProps = {
  agent: AgentKind;
  skill: SkillName;
  currentModel?: string;
  onSelect: (model: string) => void;
  onCancel?: () => void;
  onBack?: () => void;
  allowSkip?: boolean;
};

type VariantSelection = {
  familyId: string;
  context?: string;
  effort: ModelEffort;
  fast: boolean;
};

function defaultEffortForFamily(family: ModelFamily, context?: string): ModelEffort {
  const efforts = getFamilyEfforts(family, context);
  if (efforts.includes("high")) {
    return "high";
  }
  if (efforts.includes("medium")) {
    return "medium";
  }
  return efforts[0] ?? "default";
}

export function ModelPicker({
  agent,
  skill,
  currentModel,
  onSelect,
  onCancel,
  onBack,
  allowSkip = false,
}: ModelPickerProps) {
  const [models, setModels] = useState<ModelOption[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [step, setStep] = useState<PickerStep>("family");
  const [selectedFamily, setSelectedFamily] = useState<ModelFamily | null>(null);
  const [selection, setSelection] = useState<VariantSelection | null>(null);
  const [savedChoice, setSavedChoice] = useState<ReturnType<typeof parseSavedModelChoice>>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setError(null);
      setModels(null);
      try {
        const list = await listModels(agent);
        if (!cancelled) {
          setModels(list);
          if (currentModel) {
            setSavedChoice(parseSavedModelChoice(list, currentModel));
          }
        }
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : String(err);
          setError(message);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [agent, retryCount, currentModel]);

  const families = useMemo(() => (models ? groupModelFamilies(models) : []), [models]);

  useInput((input) => {
    if (input === "r" && error) {
      clearModelListCache();
      setRetryCount((count) => count + 1);
      return;
    }

    if (allowSkip && input === "s" && onCancel) {
      onCancel();
    }
  });

  const finishSelection = (family: ModelFamily, choice: VariantSelection) => {
    const resolved = resolveVariantChoice(family, choice);
    if (resolved) {
      onSelect(resolved);
      return;
    }

    if (family.variants.length === 1) {
      onSelect(family.variants[0]!.id);
    }
  };

  const beginVariantFlow = (family: ModelFamily, preset?: VariantSelection) => {
    if (!familyHasVariants(family)) {
      finishSelection(family, {
        familyId: family.id,
        effort: preset?.effort ?? family.variants[0]?.effort ?? "default",
        fast: preset?.fast ?? family.variants[0]?.fast ?? false,
        context: preset?.context ?? family.variants[0]?.context,
      });
      return;
    }

    setSelectedFamily(family);

    const contexts = getFamilyContexts(family);
    const initialContext = preset?.context ?? (contexts.length === 1 ? contexts[0] : undefined);

    if (contexts.length > 1 && !initialContext) {
      setSelection({
        familyId: family.id,
        effort: preset?.effort ?? "default",
        fast: preset?.fast ?? false,
      });
      setStep("context");
      return;
    }

    const efforts = getFamilyEfforts(family, initialContext);
    if (efforts.length > 1) {
      setSelection({
        familyId: family.id,
        context: initialContext,
        effort: preset?.effort ?? defaultEffortForFamily(family, initialContext),
        fast: preset?.fast ?? false,
      });
      setStep("effort");
      return;
    }

    const effort = efforts[0] ?? "default";
    if (hasSpeedChoice(family, effort, initialContext)) {
      setSelection({
        familyId: family.id,
        context: initialContext,
        effort,
        fast: preset?.fast ?? false,
      });
      setStep("speed");
      return;
    }

    finishSelection(family, {
      familyId: family.id,
      context: initialContext,
      effort,
      fast: family.variants.find((variant) => variant.effort === effort && variant.context === initialContext)?.fast ?? false,
    });
  };

  const goBack = () => {
    if (step === "speed") {
      setStep("effort");
      return;
    }
    if (step === "effort") {
      const contexts = selectedFamily ? getFamilyContexts(selectedFamily) : [];
      if (contexts.length > 1) {
        setStep("context");
        return;
      }
      setStep("family");
      setSelectedFamily(null);
      setSelection(null);
      return;
    }
    if (step === "context") {
      setStep("family");
      setSelectedFamily(null);
      setSelection(null);
      return;
    }
    onBack?.();
  };

  if (error) {
    return (
      <Box flexDirection="column">
        <Text color="red">{error}</Text>
        <Box marginTop={1}>
          <Text dimColor>
            <Text color="cyan">r</Text> retry
            {onBack ? (
              <>
                {" "}
                · <Text color="cyan">q</Text> back
              </>
            ) : null}
          </Text>
        </Box>
      </Box>
    );
  }

  if (!models) {
    return (
      <Box flexDirection="column">
        <Text dimColor>Fetching models for {AGENT_LABELS[agent]}…</Text>
      </Box>
    );
  }

  const header = `Default model for ${SKILL_LABELS[skill]} — ${AGENT_LABELS[agent]}`;
  const skipFooter = allowSkip ? "s skip" : undefined;

  if (step === "family") {
    return (
      <Box flexDirection="column">
        {allowSkip && onCancel && (
          <Box marginBottom={1}>
            <Text dimColor>
              <Text color="cyan">s</Text>{" "}
              {currentModel ? `keep current (${currentModel})` : "skip for now"}
            </Text>
          </Box>
        )}
        <SearchableList
          title={header}
          items={families.map((family) => ({
            id: family.id,
            label: family.label,
            hint: familyHasVariants(family)
              ? `${family.variants.length} variants`
              : family.variants[0]?.id,
          }))}
          selectedId={savedChoice?.familyId}
          countLabel={`${families.length} models`}
          onSelect={(familyId) => {
            const family = families.find((entry) => entry.id === familyId);
            if (!family) {
              return;
            }

            const preset =
              savedChoice?.familyId === family.id
                ? {
                    familyId: family.id,
                    context: savedChoice.context,
                    effort: savedChoice.effort,
                    fast: savedChoice.fast,
                  }
                : undefined;

            beginVariantFlow(family, preset);
          }}
          onBack={onBack}
          footerExtra={skipFooter}
        />
      </Box>
    );
  }

  if (!selectedFamily || !selection) {
    return null;
  }

  if (step === "context") {
    const contexts = getFamilyContexts(selectedFamily);
    return (
      <SearchableList
        title={header}
        subtitle={`${selectedFamily.label} · choose context window`}
        items={contexts.map((context) => ({
          id: context,
          label: contextLabel(context),
        }))}
        selectedId={selection.context}
        countLabel={`${contexts.length} context windows`}
        onSelect={(context) => {
          const efforts = getFamilyEfforts(selectedFamily, context);
          const effort =
            savedChoice?.familyId === selectedFamily.id && savedChoice.context === context
              ? savedChoice.effort
              : defaultEffortForFamily(selectedFamily, context);

          if (efforts.length > 1) {
            setSelection({ ...selection, context, effort });
            setStep("effort");
            return;
          }

          const resolvedEffort = efforts[0] ?? "default";
          if (hasSpeedChoice(selectedFamily, resolvedEffort, context)) {
            setSelection({
              ...selection,
              context,
              effort: resolvedEffort,
              fast:
                savedChoice?.familyId === selectedFamily.id &&
                savedChoice.context === context
                  ? savedChoice.fast
                  : false,
            });
            setStep("speed");
            return;
          }

          finishSelection(selectedFamily, {
            ...selection,
            context,
            effort: resolvedEffort,
            fast:
              selectedFamily.variants.find(
                (variant) =>
                  variant.effort === resolvedEffort && variant.context === context,
              )?.fast ?? false,
          });
        }}
        onBack={goBack}
        footerExtra={skipFooter}
      />
    );
  }

  if (step === "effort") {
    const efforts = getFamilyEfforts(selectedFamily, selection.context);
    return (
      <SearchableList
        title={header}
        subtitle={`${selectedFamily.label}${
          selection.context ? ` · ${contextLabel(selection.context)}` : ""
        } · choose effort`}
        items={efforts.map((effort) => ({
          id: effort,
          label: EFFORT_LABELS[effort],
        }))}
        selectedId={selection.effort}
        countLabel={`${efforts.length} effort levels`}
        onSelect={(effortId) => {
          const effort = effortId as ModelEffort;
          if (hasSpeedChoice(selectedFamily, effort, selection.context)) {
            setSelection({
              ...selection,
              effort,
              fast:
                savedChoice?.familyId === selectedFamily.id &&
                savedChoice.effort === effort &&
                savedChoice.context === selection.context
                  ? savedChoice.fast
                  : false,
            });
            setStep("speed");
            return;
          }

          finishSelection(selectedFamily, {
            ...selection,
            effort,
            fast:
              selectedFamily.variants.find(
                (variant) =>
                  variant.effort === effort && variant.context === selection.context,
              )?.fast ?? false,
          });
        }}
        onBack={goBack}
        footerExtra={skipFooter}
      />
    );
  }

  return (
    <SearchableList
      title={header}
      subtitle={`${selectedFamily.label}${
        selection.context ? ` · ${contextLabel(selection.context)}` : ""
      } · ${EFFORT_LABELS[selection.effort]} · choose speed`}
      items={[
        { id: "standard", label: "Standard" },
        { id: "fast", label: "Fast" },
      ]}
      selectedId={selection.fast ? "fast" : "standard"}
      countLabel="2 speed options"
      onSelect={(speedId) => {
        finishSelection(selectedFamily, {
          ...selection,
          fast: speedId === "fast",
        });
      }}
      onBack={goBack}
      footerExtra={skipFooter}
    />
  );
}
