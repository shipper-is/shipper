import type { AgentKind } from "../agents/types.ts";
import {
  QUESTION_PROTOCOL_PREAMBLE,
  claudeQuestionPreamble,
} from "../agents/question-protocol.ts";
import type { BuildGitOptions } from "../shared/protocol.ts";
import { globalSkillPath } from "./skills.ts";

function skillInstruction(
  agent: AgentKind,
  skillName: "shipper-plan" | "shipper-build" | "shipper-spike",
): string {
  const path = globalSkillPath(agent, skillName);
  return `Read and follow the skill at \`${path}\`.`;
}

function questionInstructions(agent: AgentKind): string {
  if (agent === "claude") {
    return claudeQuestionPreamble();
  }
  return QUESTION_PROTOCOL_PREAMBLE;
}

export function buildPlanPrompt(userFeatureDescription: string, agentKind: AgentKind): string {
  return [
    skillInstruction(agentKind, "shipper-plan"),
    "",
    "Create a Shipper plan for the following feature or task:",
    userFeatureDescription,
    "",
    questionInstructions(agentKind),
  ].join("\n");
}

export function buildSpikePrompt(description: string, agentKind: AgentKind): string {
  return [
    skillInstruction(agentKind, "shipper-spike"),
    "",
    "Run a Shipper Spike for the following feature or task:",
    description,
    "",
    questionInstructions(agentKind),
  ].join("\n");
}

export function gitWorkflowInstructions(git: BuildGitOptions): string[] {
  const lines: string[] = [];

  if (git.mode === "new-branch") {
    lines.push(
      "Git workflow: use the feature-branch mode from GIT.md (create or reuse the `shipper/<plan-name>` branch).",
    );
  } else {
    lines.push(
      "Git workflow: work directly on the currently checked-out branch. Do not create or switch branches, and do not set `branch` or `base_branch` in the plan frontmatter.",
    );
  }

  if (git.commitEachPhase) {
    lines.push("Commit after completing the phase, following the commit workflow in GIT.md.");
  } else {
    lines.push(
      "Do not make any git commits — leave all changes uncommitted in the working tree, and do not write `phase_commits` to the plan frontmatter.",
    );
  }

  return lines;
}

export function buildBuildPrompt(
  planRelativePath: string,
  phaseNumber: number,
  agentKind: AgentKind,
  git?: BuildGitOptions,
): string {
  return [
    skillInstruction(agentKind, "shipper-build"),
    "",
    `Implement Phase ${phaseNumber} of the plan at \`${planRelativePath}\`.`,
    `Work only on Phase ${phaseNumber} — do not ask which phase to implement.`,
    ...(git ? gitWorkflowInstructions(git) : []),
    "",
    questionInstructions(agentKind),
  ].join("\n");
}

export function appendPendingUserMessages(prompt: string, messages: string[]): string {
  if (messages.length === 0) {
    return prompt;
  }

  const block = [
    "Messages from the user since the last session:",
    ...messages.map((message) => `- ${message}`),
    "",
  ].join("\n");

  return `${prompt}\n\n${block}`;
}

export function buildFollowUpPrompt(
  message: string,
  agentKind: AgentKind,
  options?: { planRelativePath?: string; resuming?: boolean },
): string {
  const lines: string[] = [];

  if (!options?.resuming && options?.planRelativePath) {
    lines.push(
      `This message continues work on the plan at \`${options.planRelativePath}\`.`,
      "Review the repository and recent changes before acting.",
      "",
    );
  }

  lines.push(message, "", questionInstructions(agentKind));
  return lines.join("\n");
}
