import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import SelectInput from "ink-select-input";
import { AGENT_LABELS } from "../agents/labels.ts";
import type { AgentKind } from "../agents/types.ts";
import { ModelPicker } from "../components/model-picker.tsx";
import { resolveDefaultModel, saveModelChoice } from "../core/config.ts";
import { SKILL_NAMES } from "../core/skills.ts";
import { useAppContext } from "../state/app-context.tsx";

const ALL_AGENTS: AgentKind[] = ["claude", "cursor", "opencode"];

const INSTALL_HINTS: Record<AgentKind, string> = {
  claude: "https://docs.anthropic.com/en/docs/claude-code",
  cursor: "https://cursor.com/docs/cli",
  opencode: "https://opencode.ai",
};

type SettingsScreenProps = {
  initialOnly?: boolean;
};

export function SettingsScreen({ initialOnly = false }: SettingsScreenProps) {
  const { repoPath, detectedAgents, selectedAgent, setSelectedAgent, setScreen } =
    useAppContext();

  const [step, setStep] = useState<"agent" | "models">("agent");
  const [skillIndex, setSkillIndex] = useState(0);
  const [configuredAgent, setConfiguredAgent] = useState<AgentKind | null>(null);
  const [currentModel, setCurrentModel] = useState<string | undefined>(undefined);

  const detectedByKind = useMemo(
    () => new Map(detectedAgents.map((a) => [a.kind, a])),
    [detectedAgents],
  );

  const selectableItems = useMemo(
    () =>
      detectedAgents.map((agent) => ({
        label: `${AGENT_LABELS[agent.kind]} — ${agent.version}`,
        value: agent.kind,
      })),
    [detectedAgents],
  );

  const missingAgents = ALL_AGENTS.filter((kind) => !detectedByKind.has(kind));

  const currentSkill = configuredAgent ? SKILL_NAMES[skillIndex] : null;

  useEffect(() => {
    if (step !== "models" || !configuredAgent || !currentSkill) {
      return;
    }

    let cancelled = false;

    void resolveDefaultModel(repoPath, configuredAgent, currentSkill).then((model) => {
      if (!cancelled) {
        setCurrentModel(model);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [step, configuredAgent, currentSkill, repoPath]);

  useInput((input) => {
    if (input !== "q" || initialOnly || step === "models") {
      return;
    }

    setScreen("home");
  });

  const advanceSkill = () => {
    if (skillIndex + 1 >= SKILL_NAMES.length) {
      setScreen("home");
      return;
    }
    setSkillIndex((index) => index + 1);
    setCurrentModel(undefined);
  };

  if (step === "models" && configuredAgent && currentSkill) {
    return (
      <Box flexDirection="column" flexGrow={1} paddingX={1}>
        <ModelPicker
          agent={configuredAgent}
          skill={currentSkill}
          currentModel={currentModel}
          allowSkip
          onSelect={(model) => {
            void saveModelChoice(repoPath, configuredAgent, currentSkill, model).then(() => {
              advanceSkill();
            });
          }}
          onCancel={advanceSkill}
          onBack={() => {
            setStep("agent");
            setConfiguredAgent(null);
            setSkillIndex(0);
            setCurrentModel(undefined);
          }}
        />
      </Box>
    );
  }

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      <Text bold>Select coding agent</Text>
      <Box marginBottom={1}>
        <Text dimColor>Saved per project on this machine (not in the repo).</Text>
      </Box>

      {detectedAgents.length === 0 ? (
        <Box flexDirection="column" marginBottom={1}>
          <Text color="yellow">No agents detected.</Text>
          <Text dimColor>Install at least one:</Text>
          {ALL_AGENTS.map((kind) => (
            <Text key={kind} dimColor>
              {"  "}· {AGENT_LABELS[kind]}: {INSTALL_HINTS[kind]}
            </Text>
          ))}
        </Box>
      ) : (
        <>
          <SelectInput
            items={selectableItems}
            initialIndex={Math.max(
              0,
              selectableItems.findIndex((item) => item.value === selectedAgent),
            )}
            onSelect={(item) => {
              void setSelectedAgent(item.value).then(() => {
                if (initialOnly) {
                  return;
                }
                setConfiguredAgent(item.value);
                setSkillIndex(0);
                setCurrentModel(undefined);
                setStep("models");
              });
            }}
          />
          {missingAgents.length > 0 && (
            <Box flexDirection="column" marginTop={1}>
              <Text dimColor>Not installed:</Text>
              {missingAgents.map((kind) => (
                <Text key={kind} dimColor>
                  {"  "}· {AGENT_LABELS[kind]} — {INSTALL_HINTS[kind]}
                </Text>
              ))}
            </Box>
          )}
        </>
      )}

      {!initialOnly && (
        <Box marginTop={1}>
          <Text dimColor>q back to home</Text>
        </Box>
      )}
    </Box>
  );
}
