import type { AgentKind } from "../agents/types.ts";
import {
  QUESTION_PROTOCOL_PREAMBLE,
  claudeQuestionPreamble,
} from "../agents/question-protocol.ts";
import { skillPathForAgent } from "./skills.ts";

function skillInstruction(agent: AgentKind, skillName: "shipper-plan" | "shipper-build"): string {
  const path = skillPathForAgent(agent, skillName);
  return `Read and follow the skill at \`${path}\` in the target repository.`;
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

export function buildBuildPrompt(
  planRelativePath: string,
  phaseNumber: number,
  agentKind: AgentKind,
): string {
  return [
    skillInstruction(agentKind, "shipper-build"),
    "",
    `Implement Phase ${phaseNumber} of the plan at \`${planRelativePath}\`.`,
    `Work only on Phase ${phaseNumber} — do not ask which phase to implement.`,
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
