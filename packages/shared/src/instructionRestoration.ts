import { ALL_PROVIDERS, type ProviderName } from "./types.js";

export interface InstructionRestorationSettings {
  providers: Partial<Record<ProviderName, boolean>>;
  pathPrefix: string;
  pattern: string;
  delayTurns: number;
}

export const DEFAULT_INSTRUCTION_RESTORATION: InstructionRestorationSettings = {
  providers: {},
  pathPrefix: "",
  pattern: "*.md",
  delayTurns: 2,
};

export const INSTRUCTION_RESTORATION_PREAMBLE =
  "[Yep Anywhere instruction restoration]";

export function parseInstructionRestorationSettings(
  value: unknown,
): InstructionRestorationSettings | null {
  if (value === undefined)
    return { ...DEFAULT_INSTRUCTION_RESTORATION, providers: {} };
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (
    typeof v.pathPrefix !== "string" ||
    (v.pathPrefix !== "" && !/^(\/|~\/|[A-Za-z]:[\\/])/.test(v.pathPrefix)) ||
    typeof v.pattern !== "string" ||
    !v.pattern.endsWith(".md") ||
    /(^\/|\.\.|\\|[{}[\]])/.test(v.pattern) ||
    typeof v.delayTurns !== "number" ||
    !Number.isInteger(v.delayTurns) ||
    v.delayTurns < 0 ||
    v.delayTurns > 10 ||
    !v.providers ||
    typeof v.providers !== "object" ||
    Array.isArray(v.providers)
  )
    return null;
  const providers: InstructionRestorationSettings["providers"] = {};
  for (const [name, enabled] of Object.entries(v.providers)) {
    if (
      !ALL_PROVIDERS.includes(name as ProviderName) ||
      typeof enabled !== "boolean"
    )
      return null;
    providers[name as ProviderName] = enabled;
  }
  if (Object.values(providers).some(Boolean) && !v.pathPrefix) return null;
  return {
    providers,
    pathPrefix: v.pathPrefix,
    pattern: v.pattern,
    delayTurns: v.delayTurns,
  };
}
