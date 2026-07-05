import React, { useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useInput } from "ink";

export const VISIBLE_ROWS = 8;

export type SearchableListItem = {
  id: string;
  label: string;
  hint?: string;
  marker?: string;
};

export function filterItems<T extends { id: string; label: string }>(
  items: T[],
  query: string,
): T[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return items;
  }

  return items.filter(
    (item) =>
      item.id.toLowerCase().includes(normalized) ||
      item.label.toLowerCase().includes(normalized),
  );
}

export function listWindow(
  cursor: number,
  total: number,
  visibleRows = VISIBLE_ROWS,
): { start: number; end: number } {
  if (total === 0) {
    return { start: 0, end: 0 };
  }

  let start = 0;
  if (cursor >= visibleRows) {
    start = cursor - visibleRows + 1;
  }
  if (start + visibleRows > total) {
    start = Math.max(0, total - visibleRows);
  }

  return { start, end: Math.min(start + visibleRows, total) };
}

type SearchableListProps = {
  title: string;
  subtitle?: string;
  items: SearchableListItem[];
  selectedId?: string;
  countLabel?: string;
  emptyLabel?: string;
  onSelect: (id: string) => void;
  onBack?: () => void;
  footerExtra?: string;
};

export function SearchableList({
  title,
  subtitle,
  items,
  selectedId,
  countLabel,
  emptyLabel = "No matches.",
  onSelect,
  onBack,
  footerExtra,
}: SearchableListProps) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const positionedRef = useRef(false);

  const filtered = useMemo(() => filterItems(items, query), [items, query]);

  useEffect(() => {
    setCursor(0);
    positionedRef.current = false;
  }, [query, items]);

  useEffect(() => {
    if (!selectedId || positionedRef.current) {
      return;
    }
    const index = filtered.findIndex((item) => item.id === selectedId);
    if (index >= 0) {
      setCursor(index);
      positionedRef.current = true;
    }
  }, [selectedId, filtered]);

  const { start, end } = listWindow(cursor, filtered.length);
  const visibleItems = filtered.slice(start, end);
  const aboveCount = start;
  const belowCount = filtered.length - end;

  useInput((input, key) => {
    if (input === "q" && onBack) {
      onBack();
      return;
    }

    if (key.escape) {
      setQuery("");
      return;
    }

    if (key.upArrow) {
      setCursor((current) => Math.max(0, current - 1));
      return;
    }

    if (key.downArrow) {
      setCursor((current) => Math.min(Math.max(filtered.length - 1, 0), current + 1));
      return;
    }

    if (key.return) {
      const selected = filtered[cursor];
      if (selected) {
        onSelect(selected.id);
      }
      return;
    }

    if (key.backspace || key.delete) {
      setQuery((current) => current.slice(0, -1));
      return;
    }

    if (!key.ctrl && !key.meta && input) {
      setQuery((current) => current + input);
    }
  });

  return (
    <Box flexDirection="column">
      <Text bold>{title}</Text>
      {subtitle && (
        <Box marginTop={1}>
          <Text dimColor>{subtitle}</Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text>
          Filter: <Text color="cyan">{query}</Text>
          <Text dimColor>█</Text>
        </Text>
      </Box>

      {countLabel && (
        <Box marginTop={1}>
          <Text dimColor>{countLabel}</Text>
        </Box>
      )}

      {filtered.length === 0 ? (
        <Box marginTop={1}>
          <Text dimColor>{emptyLabel}</Text>
        </Box>
      ) : (
        <Box marginTop={1} flexDirection="column">
          {aboveCount > 0 && <Text dimColor>▲ {aboveCount} more above</Text>}
          {visibleItems.map((item, index) => {
            const absoluteIndex = start + index;
            const selected = absoluteIndex === cursor;
            return (
              <Text key={item.id} color={selected ? "cyan" : undefined} wrap="truncate">
                {selected ? "› " : "  "}
                {item.marker ? `${item.marker} ` : ""}
                {item.label}
                {item.hint ? <Text dimColor> · {item.hint}</Text> : null}
              </Text>
            );
          })}
          {belowCount > 0 && <Text dimColor>▼ {belowCount} more below</Text>}
        </Box>
      )}

      <Box marginTop={1}>
        <Text dimColor>
          ↑↓ select · enter confirm · type to filter · esc clear
          {footerExtra ? ` · ${footerExtra}` : ""}
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
