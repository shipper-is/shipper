import type { AgentKind } from "../agents/types.ts";
import {
  QUESTION_PROTOCOL_PREAMBLE,
  claudeQuestionPreamble,
} from "../agents/question-protocol.ts";
import { skillPathForAgent } from "./skills.ts";

function skillInstruction(
  agent: AgentKind,
  skillName: "shipper-plan" | "shipper-build" | "shipper-ship",
): string {
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

export function buildShipPrompt(planRelativePath: string, agentKind: AgentKind): string {
  return [
    skillInstruction(agentKind, "shipper-ship"),
    "",
    `Create a pull request for the work completed in the plan at \`${planRelativePath}\`.`,
    "Review the Completion Notes in each phase, verify the implementation against the plan, then create the PR using the format described in the skill.",
    "",
    questionInstructions(agentKind),
  ].join("\n");
}
