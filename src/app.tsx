import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import type { AgentEvent, AgentKind, AgentQuestion, DetectedAgent } from "./agents/types.ts";
import { detectAgents } from "./agents/detect.ts";
import { ACTIVITY_FEED_MAX_EVENTS } from "./components/activity-feed.tsx";
import { QuestionModal } from "./components/question-modal.tsx";
import { StatusBar } from "./components/status-bar.tsx";
import { TitleBar } from "./components/title-bar.tsx";
import { getDefaultAgent, getProjectConfig, setProjectConfig } from "./core/config.ts";
import { checkForUpdate, type UpdateNotice } from "./core/update-check.ts";
import type { PlanFile } from "./core/plan-store.ts";
import { BuildScreen } from "./screens/build.tsx";
import { DemoScreen } from "./screens/demo.tsx";
import { HomeScreen } from "./screens/home.tsx";
import { NewPlanScreen } from "./screens/new-plan.tsx";
import { NoAgentsScreen } from "./screens/no-agents.tsx";
import { SettingsScreen } from "./screens/settings.tsx";
import { AppProvider, useAppContext } from "./state/app-context.tsx";
import type { ActiveRun, Screen } from "./state/types.ts";

type AppProps = {
  repoPath: string;
  demoMode?: boolean;
};

function statusHints(
  screen: Screen,
  waitingForAnswer: boolean,
  activeRun: ActiveRun | null,
): string {
  if (waitingForAnswer) {
    return "waiting for your answer";
  }
  switch (screen) {
    case "home":
      return "↑↓ select · enter/b build · n new plan · s settings · q quit";
    case "new-plan":
      return "type description · ctrl+d confirm · q back";
    case "build":
      return activeRun?.kind === "build"
        ? "ctrl+c cancel · activity feed below"
        : "q home";
    case "settings":
      return "↑↓ select · enter confirm · q back";
    case "no-agents":
      return "r rescan · s settings · q quit";
    case "demo":
      return "demo feed — q quit · b home";
    default:
      return "q quit";
  }
}

function needsAgentSetup(
  selected: AgentKind | null,
  detected: DetectedAgent[],
): boolean {
  if (!selected) {
    return true;
  }
  return !detected.some((a) => a.kind === selected);
}

function AppBody({
  screen,
  settingsInitialOnly,
}: {
  screen: Screen;
  settingsInitialOnly: boolean;
}) {
  switch (screen) {
    case "home":
      return <HomeScreen />;
    case "new-plan":
      return <NewPlanScreen />;
    case "build":
      return <BuildScreen />;
    case "settings":
      return <SettingsScreen initialOnly={settingsInitialOnly} />;
    case "no-agents":
      return <NoAgentsScreen />;
    case "demo":
      return <DemoScreen />;
    default:
      return <HomeScreen />;
  }
}

function QuestionModalOverlay({ question }: { question: AgentQuestion }) {
  const { setPendingQuestion, setWaitingForAnswer, appendFeedEvents } = useAppContext();

  return (
    <>
      <Box position="absolute" width="100%" height="100%" backgroundColor="black" />
      <QuestionModal
        question={question}
        onSubmit={(answers) => {
          setPendingQuestion(null);
          setWaitingForAnswer(false);
          appendFeedEvents({
            type: "text",
            text: `Answers: ${JSON.stringify(answers)}`,
          });
        }}
      />
    </>
  );
}

export function App({ repoPath, demoMode = false }: AppProps) {
  const { exit } = useApp();
  const [booting, setBooting] = useState(true);
  const [detectedAgents, setDetectedAgents] = useState<DetectedAgent[]>([]);
  const [selectedAgent, setSelectedAgentState] = useState<AgentKind | null>(null);
  const [screen, setScreen] = useState<Screen>(demoMode ? "demo" : "home");
  const [selectedPlan, setSelectedPlan] = useState<PlanFile | null>(null);
  const [feedEvents, setFeedEvents] = useState<AgentEvent[]>([]);
  const [pendingQuestion, setPendingQuestion] = useState<AgentQuestion | null>(null);
  const [waitingForAnswer, setWaitingForAnswer] = useState(false);
  const [activeRun, setActiveRun] = useState<ActiveRun | null>(
    demoMode ? { kind: "demo" } : null,
  );
  const [highlightPlanFilename, setHighlightPlanFilename] = useState<string | null>(null);
  const [settingsInitialOnly, setSettingsInitialOnly] = useState(false);
  const [updateNotice, setUpdateNotice] = useState<UpdateNotice | null>(null);

  const rescanAgents = useCallback(async () => {
    const agents = await detectAgents();
    setDetectedAgents(agents);
    if (agents.length > 0 && screen === "no-agents") {
      setScreen("settings");
      setSettingsInitialOnly(true);
    }
  }, [screen, setScreen]);

  const quit = useCallback(() => {
    exit();
  }, [exit]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const [agents, projectConfig, defaultAgent] = await Promise.all([
        detectAgents(),
        getProjectConfig(repoPath),
        getDefaultAgent(),
      ]);

      if (cancelled) {
        return;
      }

      setDetectedAgents(agents);
      const agent = projectConfig.agent ?? defaultAgent ?? null;
      setSelectedAgentState(agent);

      if (!demoMode) {
        void checkForUpdate().then((notice) => {
          if (!cancelled && notice) {
            setUpdateNotice(notice);
          }
        });
      }

      if (demoMode) {
        setBooting(false);
        return;
      }

      if (agents.length === 0) {
        setScreen("no-agents");
        setBooting(false);
        return;
      }

      if (needsAgentSetup(agent, agents)) {
        setSettingsInitialOnly(true);
        setScreen("settings");
      }

      setBooting(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [repoPath, demoMode]);

  const setSelectedAgent = useCallback(
    async (agent: AgentKind) => {
      await setProjectConfig(repoPath, { agent });
      setSelectedAgentState(agent);
      if (settingsInitialOnly) {
        setSettingsInitialOnly(false);
        setScreen("home");
      }
    },
    [repoPath, settingsInitialOnly],
  );

  const appendFeedEvents = useCallback((...events: AgentEvent[]) => {
    setFeedEvents((prev) => {
      let next = [...prev];
      for (const event of events) {
        const last = next[next.length - 1];
        if (
          event.type === "text" &&
          event.delta === true &&
          last?.type === "text"
        ) {
          next = [
            ...next.slice(0, -1),
            { type: "text", text: last.text + event.text },
          ];
        } else {
          next = [...next, event];
        }
      }
      return next.slice(-ACTIVITY_FEED_MAX_EVENTS);
    });
  }, []);

  const clearFeedEvents = useCallback(() => {
    setFeedEvents([]);
  }, []);

  const contextValue = useMemo(
    () => ({
      repoPath,
      screen,
      setScreen,
      detectedAgents,
      selectedAgent,
      setSelectedAgent,
      selectedPlan,
      setSelectedPlan,
      feedEvents,
      appendFeedEvents,
      clearFeedEvents,
      pendingQuestion,
      setPendingQuestion,
      waitingForAnswer,
      setWaitingForAnswer,
      activeRun,
      setActiveRun,
      highlightPlanFilename,
      setHighlightPlanFilename,
      updateNotice,
      rescanAgents,
      demoMode,
      quit,
    }),
    [
      repoPath,
      screen,
      detectedAgents,
      selectedAgent,
      setSelectedAgent,
      selectedPlan,
      feedEvents,
      appendFeedEvents,
      clearFeedEvents,
      pendingQuestion,
      waitingForAnswer,
      activeRun,
      demoMode,
      highlightPlanFilename,
      updateNotice,
      rescanAgents,
      quit,
    ],
  );

  useInput(
    (input, key) => {
      if (screen === "no-agents") {
        if (input === "r") {
          void rescanAgents();
          return;
        }
        if (input === "s") {
          setScreen("settings");
          return;
        }
        if (input === "q") {
          quit();
          return;
        }
      }

      if (key.ctrl && input === "c") {
        if (screen === "build" && activeRun?.kind === "build") {
          return;
        }
        quit();
      }
    },
    { isActive: !pendingQuestion },
  );

  const hints = statusHints(screen, waitingForAnswer, activeRun);

  return (
    <AppProvider value={contextValue}>
      <Box flexDirection="column" width="100%" height="100%">
        <TitleBar repoPath={repoPath} agent={selectedAgent} />

        <Box flexGrow={1} flexDirection="column" position="relative">
          {booting ? (
            <Box paddingX={1}>
              <Text dimColor>Starting…</Text>
            </Box>
          ) : (
            <>
              <AppBody
                screen={screen}
                settingsInitialOnly={settingsInitialOnly}
              />
              {pendingQuestion && screen !== "demo" && screen !== "build" && (
                <QuestionModalOverlay question={pendingQuestion} />
              )}
            </>
          )}
        </Box>

        <StatusBar hints={hints} updateNotice={updateNotice} />
      </Box>
    </AppProvider>
  );
}
