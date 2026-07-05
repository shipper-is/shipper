import React from "react";
import { Box, Text } from "ink";
import type { PlanFile } from "../core/plan-store.ts";

function progressBar(checked: number, total: number, width = 16): string {
  if (total === 0) {
    return "░".repeat(width);
  }
  const filled = Math.round((checked / total) * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

function formatProgress(plan: PlanFile): string {
  const { progress } = plan;
  const total = progress.totalChecked + progress.totalUnchecked;
  const bar = progressBar(progress.totalChecked, total);
  const phase =
    progress.phaseCount > 0 && progress.currentPhase !== null
      ? `Phase ${progress.currentPhase}/${progress.phaseCount}`
      : progress.phaseCount > 0
        ? `Phase ${progress.phaseCount}/${progress.phaseCount}`
        : "No phases";
  return `${bar} ${progress.totalChecked}/${total} · ${phase}`;
}

export type PlanListItem =
  | { kind: "header"; label: string }
  | { kind: "plan"; plan: PlanFile; selectable: boolean };

export function buildPlanListItems(open: PlanFile[], done: PlanFile[]): PlanListItem[] {
  const items: PlanListItem[] = [];
  items.push({ kind: "header", label: "Open" });
  if (open.length === 0) {
    items.push({ kind: "header", label: "  (none)" });
  } else {
    for (const plan of open) {
      items.push({ kind: "plan", plan, selectable: true });
    }
  }
  items.push({ kind: "header", label: "Done" });
  if (done.length === 0) {
    items.push({ kind: "header", label: "  (none)" });
  } else {
    for (const plan of done) {
      items.push({ kind: "plan", plan, selectable: false });
    }
  }
  return items;
}

export function firstSelectableIndex(items: PlanListItem[]): number {
  return items.findIndex((item) => item.kind === "plan" && item.selectable);
}

type PlanListProps = {
  items: PlanListItem[];
  selectedIndex: number;
};

export function PlanList({ items, selectedIndex }: PlanListProps) {
  return (
    <Box flexDirection="column">
      {items.map((item, index) => {
        if (item.kind === "header") {
          return (
            <Text key={`h-${item.label}-${index}`} bold={!item.label.startsWith("  ")} dimColor={item.label.startsWith("  ")}>
              {item.label}
            </Text>
          );
        }

        const selected = index === selectedIndex;
        const { plan, selectable } = item;
        const color = !selectable ? "gray" : selected ? "cyan" : undefined;
        const prefix = selectable ? (selected ? "› " : "  ") : "  ";

        return (
          <Box key={plan.path} flexDirection="column" marginBottom={1}>
            <Text color={color} bold={selected && selectable}>
              {prefix}
              {plan.title}
            </Text>
            <Text dimColor>
              {"    "}
              {plan.filename}
            </Text>
            <Text dimColor>
              {"    "}
              {formatProgress(plan)}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}

export function getSelectedPlan(
  items: PlanListItem[],
  selectedIndex: number,
): PlanFile | null {
  const item = items[selectedIndex];
  if (item?.kind === "plan" && item.selectable) {
    return item.plan;
  }
  return null;
}

export function indexForPlanFilename(items: PlanListItem[], filename: string): number {
  return items.findIndex(
    (item) => item.kind === "plan" && item.selectable && item.plan.filename === filename,
  );
}
