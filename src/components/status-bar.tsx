import React from "react";
import { Box, Text } from "ink";
import type { UpdateNotice } from "../core/update-check.ts";

type StatusBarProps = {
  hints: string;
  updateNotice?: UpdateNotice | null;
};

export function StatusBar({ hints, updateNotice }: StatusBarProps) {
  return (
    <Box borderStyle="single" paddingX={1} justifyContent="space-between">
      <Text dimColor>{hints}</Text>
      {updateNotice && (
        <Text dimColor>
          v{updateNotice.latest} available —{" "}
          <Text color="cyan">{updateNotice.installCommand}</Text>
        </Text>
      )}
    </Box>
  );
}
