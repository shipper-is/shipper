import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import {
  PlanList,
  buildPlanListItems,
  firstSelectableIndex,
  getSelectedPlan,
  indexForPlanFilename,
} from "../components/plan-list.tsx";
import { listPlans, watchPlans } from "../core/plan-store.ts";
import { useAppContext } from "../state/app-context.tsx";

export function HomeScreen() {
  const { repoPath, setScreen, setSelectedPlan, highlightPlanFilename, setHighlightPlanFilename, quit } =
    useAppContext();
  const [openPlans, setOpenPlans] = useState<Awaited<ReturnType<typeof listPlans>>["open"]>([]);
  const [donePlans, setDonePlans] = useState<Awaited<ReturnType<typeof listPlans>>["done"]>([]);
  const [loading, setLoading] = useState(true);

  const items = useMemo(
    () => buildPlanListItems(openPlans, donePlans),
    [openPlans, donePlans],
  );

  const [selectedIndex, setSelectedIndex] = useState(() => firstSelectableIndex(items));

  const refresh = async () => {
    const plans = await listPlans(repoPath);
    setOpenPlans(plans.open);
    setDonePlans(plans.done);
    setLoading(false);
  };

  useEffect(() => {
    void refresh();
    const watcher = watchPlans(repoPath, () => {
      void refresh();
    });
    return () => {
      void watcher.close();
    };
  }, [repoPath]);

  useEffect(() => {
    if (!highlightPlanFilename) {
      return;
    }
    const idx = indexForPlanFilename(items, highlightPlanFilename);
    if (idx >= 0) {
      setSelectedIndex(idx);
      setHighlightPlanFilename(null);
    }
  }, [highlightPlanFilename, items, setHighlightPlanFilename]);

  useEffect(() => {
    const next = firstSelectableIndex(items);
    if (next >= 0) {
      setSelectedIndex(next);
    }
  }, [items.length, openPlans.length]);

  useInput((input, key) => {
    if (input === "q" || (key.ctrl && input === "c")) {
      quit();
      return;
    }
    if (input === "n") {
      setScreen("new-plan");
      return;
    }
    if (input === "s") {
      setScreen("settings");
      return;
    }
    if (key.upArrow) {
      setSelectedIndex((current) => {
        for (let i = current - 1; i >= 0; i--) {
          const item = items[i];
          if (item?.kind === "plan" && item.selectable) {
            return i;
          }
        }
        return current;
      });
      return;
    }
    if (key.downArrow) {
      setSelectedIndex((current) => {
        for (let i = current + 1; i < items.length; i++) {
          const item = items[i];
          if (item?.kind === "plan" && item.selectable) {
            return i;
          }
        }
        return current;
      });
      return;
    }
    if (key.return || input === "b") {
      const plan = getSelectedPlan(items, selectedIndex);
      if (plan) {
        setSelectedPlan(plan);
        setScreen("build");
      }
    }
  });

  const empty = !loading && openPlans.length === 0 && donePlans.length === 0;

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      {loading ? (
        <Text dimColor>Loading plans…</Text>
      ) : empty ? (
        <Box flexDirection="column" marginTop={2}>
          <Text bold>No plans yet</Text>
          <Box marginTop={1}>
            <Text dimColor>
              Press <Text color="cyan">n</Text> to create a new plan with your coding agent.
            </Text>
          </Box>
        </Box>
      ) : (
        <PlanList items={items} selectedIndex={selectedIndex} />
      )}
    </Box>
  );
}
