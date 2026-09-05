import type { AgentMessage } from "@earendil-works/pi-agent-core";

export const REASONING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type ReasoningLevel = typeof REASONING_LEVELS[number];

export const REASONING_LEVEL_LABELS: Record<ReasoningLevel, string> = {
  off: "Off",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Max",
};

export function normalizeReasoningLevel(value: unknown): ReasoningLevel {
  return typeof value === "string" && (REASONING_LEVELS as readonly string[]).includes(value) ? value as ReasoningLevel : "off";
}

export interface ApiSettings {
  baseUrl: string;
  apiKey: string;
  modelId: string;
  userPrompt: string;
  maxOutputTokens: number;
  reasoningLevel: ReasoningLevel;
  rememberKey: boolean;
  sendShortcut: "enter" | "mod-enter";
  providers: ProviderProfile[];
  activeProviderId: string;
}

export interface ProviderModel {
  id: string;
  name?: string;
  reasoningLevels?: ReasoningLevel[];
  defaultReasoningLevel?: ReasoningLevel;
}

export interface ProviderProfile {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  rememberKey: boolean;
  models: ProviderModel[];
}

export type WorkspaceAccessMode = "read" | "confirm" | "write";
export const CHAT_WORKSPACE_ID = "chat";

export const WORKSPACE_ACCESS_MODE_LABELS: Record<WorkspaceAccessMode, string> = {
  read: "Read only",
  confirm: "Write with confirmation",
  write: "Write directly",
};

export const WORKSPACE_ACCESS_MODE_DESCRIPTIONS: Record<WorkspaceAccessMode, string> = {
  read: "Inspect and search files. Changes are disabled.",
  confirm: "Ask before every edit, write, patch, or delete.",
  write: "Apply file changes immediately.",
};

export interface WorkspaceWriteRequest {
  operation: string;
  paths: string[];
}

export interface WorkspaceInfo {
  id: string;
  name: string;
  permission: PermissionState;
  canWrite: boolean;
}

export interface WorkspaceRecord extends WorkspaceInfo {
  handle: FileSystemDirectoryHandle;
  updatedAt: string;
}

export interface SessionSummary {
  id: string;
  workspaceId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  baseUrl: string;
  modelId: string;
  titleMode?: "auto" | "manual";
}

export interface SessionRecord extends SessionSummary {
  systemPromptHash: string;
  messages: AgentMessage[];
}

export interface ToolActivity {
  name: string;
  status: "running" | "done" | "error";
  output: string;
}

export const defaultSettings: ApiSettings = {
  baseUrl: "/api",
  apiKey: "",
  modelId: "gpt-4.1-mini",
  userPrompt: "",
  maxOutputTokens: 4096,
  reasoningLevel: "off",
  rememberKey: false,
  sendShortcut: "mod-enter",
  activeProviderId: "server-api",
  providers: [{
    id: "server-api",
    name: "Server API",
    baseUrl: "/api",
    apiKey: "",
    rememberKey: false,
    models: [{ id: "gpt-4.1-mini" }],
  }],
};
