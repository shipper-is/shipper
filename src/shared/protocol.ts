import { z } from "zod";

export type ModelVariantDto = {
  id: string;
  label: string;
};

export type ModelFamilyDto = {
  id: string;
  label: string;
  variants: ModelVariantDto[];
};

export type ServerMessage = {
  type: "hello";
  repoPath: string;
  version: string;
};

export type ClientMessage = {
  type: "refresh";
};

export const clientMessageSchema = z.object({
  type: z.literal("refresh"),
});

export function parseClientMessage(raw: unknown): ClientMessage | null {
  const result = clientMessageSchema.safeParse(raw);
  return result.success ? result.data : null;
}
