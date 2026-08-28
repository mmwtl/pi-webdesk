import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { AgentEvent, AgentMessage } from "@earendil-works/pi-agent-core";
import { BrowserWorkspace } from "../filesystem/BrowserWorkspace.ts";
import type { BrowserEntry } from "../filesystem/types.ts";
import { checkApi, fetchServerProviders, type ApiModelRecord } from "../agent/serverApi.ts";
import { PiWebdeskAgent } from "../agent/PiWebdeskAgent.ts";
import { sha256 } from "../persistence/hash.ts";
import { loadSettings, saveSettings } from "../persistence/settings.ts";
import { createSession, deleteSession, listSessions, loadSession, renameSession, saveSession } from "../persistence/sessions.ts";
import { restoreWorkspaces, saveWorkspace } from "../persistence/workspaces.ts";
import { defaultSettings, REASONING_LEVEL_LABELS, REASONING_LEVELS, WORKSPACE_ACCESS_MODE_DESCRIPTIONS, WORKSPACE_ACCESS_MODE_LABELS, type ApiSettings, type ProviderModel, type ProviderProfile, type ReasoningLevel, type SessionSummary, type ToolActivity, type WorkspaceAccessMode, type WorkspaceInfo, type WorkspaceRecord, type WorkspaceWriteRequest } from "./state.ts";
import { deriveSessionName } from "./sessionName.ts";
import { groupTranscriptMessages } from "./transcript.ts";
import { summarizeError } from "./errors.ts";
import { ProviderAdmin } from "./ProviderAdmin.tsx";
import "../styles/app.css";

function textFromMessage(message: any): string {
  const content = typeof message?.content === "string" ? message.content : Array.isArray(message?.content) ? message.content.map((block: any) => block.type === "text" ? block.text : "").filter(Boolean).join("\n") : "";
  return message?.errorMessage ? `${content ? `${content}\n` : ""}Request failed: ${summarizeError(message.errorMessage)}` : content;
}

function thinkingFromMessage(message: any): string {
  return Array.isArray(message?.content) ? message.content.map((block: any) => block.type === "thinking" ? block.thinking : "").filter(Boolean).join("\n") : "";
}

function safeHref(href: string): string | undefined {
  try {
    const url = new URL(href, window.location.origin);
    return ["http:", "https:", "mailto:"].includes(url.protocol) ? href : undefined;
  } catch {
    return undefined;
  }
}

function inlineMarkdown(text: string, keyPrefix: string): React.ReactNode[] {
  const pattern = /(\[[^\]]+\]\((?:https?:\/\/|mailto:)[^\s)]+\)|`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|~~[^~]+~~|\*[^*]+\*|_[^_]+_)/g;
  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index));
    const token = match[0];
    if (token.startsWith("[") && token.includes("](")) {
      const splitAt = token.indexOf("](");
      const label = token.slice(1, splitAt);
      const href = token.slice(splitAt + 2, -1);
      const safe = safeHref(href);
      nodes.push(safe ? <a key={`${keyPrefix}-link-${match.index}`} href={safe} target="_blank" rel="noreferrer">{label}</a> : label);
    } else if (token.startsWith("`")) {
      nodes.push(<code key={`${keyPrefix}-code-${match.index}`}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith("**") || token.startsWith("__")) {
      nodes.push(<strong key={`${keyPrefix}-strong-${match.index}`}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("~~")) {
      nodes.push(<del key={`${keyPrefix}-del-${match.index}`}>{token.slice(2, -2)}</del>);
    } else {
      nodes.push(<em key={`${keyPrefix}-em-${match.index}`}>{token.slice(1, -1)}</em>);
    }
    cursor = match.index + token.length;
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

function safeMarkdown(text: string): React.ReactNode {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: React.ReactNode[] = [];
  let index = 0;
  let blockKey = 0;
  const isBlockStart = (line: string) => /^(#{1,6}\s|```|>\s?|[-*+]\s+|\d+[.]\s+|\s*([-*_])(?:\s*\2){2,}\s*$)/.test(line);

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) { index += 1; continue; }
    if (line.startsWith("```")) {
      const language = line.slice(3).trim();
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith("```")) code.push(lines[index++]);
      if (index < lines.length) index += 1;
      blocks.push(<pre key={`block-${blockKey++}`} className="code-block"><code data-language={language || undefined}>{code.join("\n")}</code></pre>);
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      const Heading = `h${level}` as keyof React.JSX.IntrinsicElements;
      blocks.push(React.createElement(Heading, { key: `block-${blockKey++}` }, inlineMarkdown(heading[2], `heading-${blockKey}`)));
      index += 1;
      continue;
    }
    if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
      blocks.push(<hr key={`block-${blockKey++}`} />);
      index += 1;
      continue;
    }
    if (/^>\s?/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) quote.push(lines[index++].replace(/^>\s?/, ""));
      blocks.push(<blockquote key={`block-${blockKey++}`}>{inlineMarkdown(quote.join(" "), `quote-${blockKey}`)}</blockquote>);
      continue;
    }
    const unordered = line.match(/^\s*[-*+]\s+(.+)$/);
    const ordered = line.match(/^\s*\d+[.]\s+(.+)$/);
    if (unordered || ordered) {
      const items: string[] = [];
      const matcher = unordered ? /^\s*[-*+]\s+(.+)$/ : /^\s*\d+[.]\s+(.+)$/;
      while (index < lines.length) {
        const item = lines[index].match(matcher);
        if (!item) break;
        items.push(item[1]);
        index += 1;
      }
      const List = ordered ? "ol" : "ul";
      blocks.push(React.createElement(List, { key: `block-${blockKey++}` }, items.map((item, itemIndex) => <li key={`${blockKey}-${itemIndex}`}>{inlineMarkdown(item, `list-${blockKey}-${itemIndex}`)}</li>)));
      continue;
    }
    const paragraph: string[] = [line];
    index += 1;
    while (index < lines.length && lines[index].trim() && !isBlockStart(lines[index])) paragraph.push(lines[index++]);
    blocks.push(<p key={`block-${blockKey++}`}>{inlineMarkdown(paragraph.join(" "), `paragraph-${blockKey}`)}</p>);
  }
  return <>{blocks}</>;
}

function errorText(reason: unknown): string { return reason instanceof Error ? reason.message : String(reason); }

function reconcileReasoningLevel(current: ReasoningLevel, available: readonly ReasoningLevel[], preferred?: ReasoningLevel): ReasoningLevel {
  if (available.includes(current)) return current;
  if (preferred && available.includes(preferred)) return preferred;
  const currentIndex = REASONING_LEVELS.indexOf(current);
  for (let index = currentIndex; index < REASONING_LEVELS.length; index += 1) {
    if (available.includes(REASONING_LEVELS[index])) return REASONING_LEVELS[index];
  }
  for (let index = currentIndex - 1; index >= 0; index -= 1) {
    if (available.includes(REASONING_LEVELS[index])) return REASONING_LEVELS[index];
  }
  return available[0] ?? "off";
}

type Theme = "dark" | "light";

const DEFAULT_SIDEBAR_WIDTH = 250;
const MIN_SIDEBAR_WIDTH = 200;
const MAX_SIDEBAR_WIDTH = 360;
const SIDEBAR_WIDTH_KEY = "pi-webdesk-sidebar-width";
const LEGACY_SIDEBAR_WIDTH_KEY = "webharness-sidebar-width";
const WORKSPACE_ACCESS_MODE_KEY = "pi-webdesk-workspace-access-mode";
const LEGACY_WORKSPACE_ACCESS_MODE_KEY = "webharness-workspace-access-mode";
const WORKSPACE_ACCESS_OPTIONS: WorkspaceAccessMode[] = ["read", "confirm", "write"];
const WORKSPACE_ACCESS_BUTTON_LABELS: Record<WorkspaceAccessMode, string> = {
  read: "Read only",
  confirm: "Confirm writes",
  write: "Write directly",
};

type ComposerModel = { provider: ProviderProfile; model: ProviderModel };

type ComposerCatalogState = {
  status: "idle" | "loading" | "ready" | "error";
  models: ApiModelRecord[];
  error?: string;
};

type InspectorTab = "overview" | "details";

function settingsProviders(settings: ApiSettings): ProviderProfile[] {
  if (settings.providers.length > 0) return settings.providers;
  return [{ id: "server-api", name: "Server API", baseUrl: "/api", apiKey: "", rememberKey: false, models: [{ id: settings.modelId }] }];
}

function applyServerProviders(settings: ApiSettings, providers: ProviderProfile[]): ApiSettings {
  if (providers.length === 0) return settings;
  const activeProvider = providers.find((provider) => provider.id === settings.activeProviderId) ?? providers[0];
  const activeModel = activeProvider.models.find((model) => model.id === settings.modelId) ?? activeProvider.models[0];
  return {
    ...settings,
    providers,
    activeProviderId: activeProvider.id,
    baseUrl: "/api",
    apiKey: "",
    rememberKey: false,
    modelId: activeModel?.id ?? settings.modelId,
  };
}

function mergeModelMetadata(model: ProviderModel, records: ApiModelRecord[] | undefined): ProviderModel {
  const record = records?.find((item) => item.id === model.id);
  if (!record) return model;
  return {
    ...model,
    ...(record.name ? { name: record.name } : {}),
    ...(record.reasoning ? { reasoningLevels: record.reasoning.levels, ...(record.reasoning.defaultLevel ? { defaultReasoningLevel: record.reasoning.defaultLevel } : {}) } : {}),
  };
}

function composerModels(settings: ApiSettings, catalogs: Record<string, ComposerCatalogState> = {}): ComposerModel[] {
  return settingsProviders(settings).flatMap((provider) => provider.models.map((model) => ({ provider, model: mergeModelMetadata(model, catalogs[provider.id]?.models) })));
}

function activeComposerModel(settings: ApiSettings, catalogs: Record<string, ComposerCatalogState> = {}): ComposerModel {
  const provider = settingsProviders(settings).find((item) => item.id === settings.activeProviderId) ?? settingsProviders(settings)[0];
  const baseModel = provider.models.find((item) => item.id === settings.modelId) ?? provider.models[0] ?? { id: settings.modelId };
  const model = mergeModelMetadata(baseModel, catalogs[provider.id]?.models);
  return { provider, model };
}

function clampSidebarWidth(width: number): number {
  const viewportLimit = typeof window === "undefined" ? MAX_SIDEBAR_WIDTH : Math.max(MIN_SIDEBAR_WIDTH, window.innerWidth - 360);
  return Math.min(Math.max(width, MIN_SIDEBAR_WIDTH), MAX_SIDEBAR_WIDTH, viewportLimit);
}

function initialSidebarWidth(): number {
  const saved = Number(readMigratedStorage(SIDEBAR_WIDTH_KEY, LEGACY_SIDEBAR_WIDTH_KEY));
  return clampSidebarWidth(Number.isFinite(saved) && saved > 0 ? saved : DEFAULT_SIDEBAR_WIDTH);
}

function initialTheme(): Theme {
  const saved = readMigratedStorage("pi-webdesk-theme", "webharness-theme");
  if (saved === "dark" || saved === "light") return saved;
  return matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function initialWorkspaceAccessMode(): WorkspaceAccessMode {
  const saved = readMigratedStorage(WORKSPACE_ACCESS_MODE_KEY, LEGACY_WORKSPACE_ACCESS_MODE_KEY);
  return saved === "read" || saved === "confirm" || saved === "write" ? saved : "write";
}

function readMigratedStorage(key: string, legacyKey: string): string | null {
  const current = localStorage.getItem(key);
  if (current !== null) return current;
  const legacy = localStorage.getItem(legacyKey);
  if (legacy !== null) localStorage.setItem(key, legacy);
  return legacy;
}

function LogoMark() {
  return <svg className="logo-mark" viewBox="0 0 800 800" aria-hidden="true"><path fill="currentColor" fillRule="evenodd" d="M165.29 165.29h352.07V400H400v117.36H282.65v117.36H165.29zM282.65 282.65V400H400V282.65z" /><path fill="currentColor" d="M517.36 400h117.36v234.72H517.36z" /></svg>;
}

function UiIcon({ name }: { name: "folder" | "plus" | "edit" | "close" | "settings" | "send" | "stop" | "sun" | "moon" | "search" | "filter" | "file" | "globe" | "eye" | "refresh" | "check" | "info" | "code" | "message" | "arrow-right" | "spark" }) {
  let paths: React.ReactNode;
  if (name === "folder") paths = <><path d="M2.5 5.5h4l1.5 1.7h5.5v5.3h-11z" /><path d="M2.5 5.5V4h4l1.4 1.5" /></>;
  else if (name === "plus") paths = <path d="M8 3v10M3 8h10" />;
  else if (name === "edit") paths = <><path d="m3 11.8 1.1-3.2 6.7-6.7 2.3 2.3-6.7 6.7z" /><path d="m9.6 3.1 2.3 2.3" /></>;
  else if (name === "close") paths = <path d="m4 4 8 8M12 4 4 12" />;
  else if (name === "settings") paths = <><circle cx="8" cy="8" r="2.2" /><path d="M6.8 1.8h2.4l.5 1.7 1.5.9 1.8-.4 1.2 2.1-1.3 1.3v1.7l1.3 1.3-1.2 2.1-1.8-.4-1.5.9-.5 1.7H6.8L6.3 13l-1.5-.9-1.8.4-1.2-2.1 1.3-1.3V7.4L1.8 6.1 3 4l1.8.4 1.5-.9z" /></>;
  else if (name === "send") paths = <path d="m2.3 3 11.2 5-11.2 5 1.5-4.1L9 8 3.8 7.1z" />;
  else if (name === "stop") paths = <rect x="3.5" y="3.5" width="9" height="9" rx="1.5" />;
  else if (name === "sun") paths = <><circle cx="8" cy="8" r="2.7" /><path d="M8 1.5v1.3M8 13.2v1.3M1.5 8h1.3M13.2 8h1.3M3.4 3.4l.9.9M11.7 11.7l.9.9M12.6 3.4l-.9.9M4.3 11.7l-.9.9" /></>;
  else if (name === "moon") paths = <path d="M12.8 10.7A5.6 5.6 0 0 1 5.3 3.2 5.6 5.6 0 1 0 12.8 10.7z" />;
  else if (name === "search") paths = <><circle cx="7" cy="7" r="4.1" /><path d="m10.1 10.1 3.2 3.2" /></>;
  else if (name === "filter") paths = <path d="M2.4 3.2h11.2L9.3 8.4v3.4l-2.6 1V8.4z" />;
  else if (name === "file") paths = <><path d="M4 1.8h5l3 3v9.4H4z" /><path d="M9 1.8v3h3M6 8h4M6 10.5h3" /></>;
  else if (name === "globe") paths = <><circle cx="8" cy="8" r="5.6" /><path d="M2.7 8h10.6M8 2.4c1.5 1.5 2.2 3.4 2.2 5.6S9.5 12.1 8 13.6C6.5 12.1 5.8 10.2 5.8 8S6.5 3.9 8 2.4z" /></>;
  else if (name === "eye") paths = <><path d="M1.8 8s2.2-3.5 6.2-3.5S14.2 8 14.2 8 12 11.5 8 11.5 1.8 8 1.8 8z" /><circle cx="8" cy="8" r="1.4" /></>;
  else if (name === "refresh") paths = <><path d="M12.7 5.4A5.5 5.5 0 0 0 3.1 4.3L2.3 6.5" /><path d="M2.3 3.8v2.7H5" /><path d="M3.3 10.6a5.5 5.5 0 0 0 9.6 1.1l.8-2.2" /><path d="M13.7 12.2V9.5H11" /></>;
  else if (name === "check") paths = <path d="m3 8.2 3.1 3.1L13 4.7" />;
  else if (name === "info") paths = <><circle cx="8" cy="8" r="5.6" /><path d="M8 7.1v3.5M8 4.9h.01" /></>;
  else if (name === "code") paths = <><path d="m6 4-3 4 3 4M10 4l3 4-3 4" /></>;
  else if (name === "message") paths = <path d="M3 3.2h10v7.1H7.7L4.3 13v-2.7H3z" />;
  else if (name === "arrow-right") paths = <path d="M2.5 8h10.5M9 4l4 4-4 4" />;
  else if (name === "spark") paths = <><path d="m8 1.8 1.3 3.4 3.4 1.3-3.4 1.3L8 11.2 6.7 7.8 3.3 6.5l3.4-1.3z" /><path d="m12.4 10.4.5 1.3 1.3.5-1.3.5-.5 1.3-.5-1.3-1.3-.5 1.3-.5z" /></>;
  else paths = null;
  return <svg className={`ui-icon ${name}`} viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round">{paths}</svg>;
}

function Chevron({ open }: { open: boolean }) {
  return <svg className={`chevron ${open ? "open" : ""}`} viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function ToolGlyph({ name }: { name: string }) {
  const glyph = name === "grep" ? <><circle cx="7" cy="7" r="3.5" /><path d="m10 10 3 3" /></> : name === "ls" || name === "find" ? <><path d="M2.5 5.5h4l1.4 1.6h5.6v5.4h-11z" /><path d="M2.5 5.5V4h4l1.4 1.5" /></> : name === "edit" || name === "write" || name === "apply_patch" ? <><path d="m3 11.8 1.2-3.4L10.8 1.8l2.4 2.4-6.6 6.6z" /><path d="m9.5 3.1 2.4 2.4" /></> : <><path d="M4 2.5h5l3 3v8H4z" /><path d="M9 2.5v3h3M6 9h4M6 11.5h3" /></>;
  return <svg className="tool-glyph" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round">{glyph}</svg>;
}

function toolSummary(name: string, args: Record<string, unknown>): string {
  const path = typeof args.path === "string" ? args.path : "";
  if (name === "grep") return `${typeof args.pattern === "string" ? `/${args.pattern}/` : "pattern"}${path ? ` · ${path}` : ""}`;
  if (name === "find") return `${typeof args.pattern === "string" ? args.pattern : "pattern"}${path ? ` · ${path}` : ""}`;
  if (name === "edit") return path || "exact replacement";
  if (name === "write") return path || "file";
  if (name === "apply_patch") return "multi-file patch";
  if (name === "delete") return path || "path";
  return path || ".";
}

function toolResultText(result: any): string {
  return typeof result?.content === "string" ? result.content : textFromMessage(result);
}

function ToolCallDisclosure({ call, activity, result }: { call: { id: string; name: string; arguments: Record<string, unknown> }; activity?: ToolActivity; result?: any }) {
  const status: ToolActivity["status"] = activity?.status ?? (result ? result.isError ? "error" : "done" : "running");
  const [open, setOpen] = useState(status === "running" || status === "error");
  const details = result ? toolResultText(result) : activity?.output ?? "";
  return <div className={`tool-disclosure ${status} ${open ? "expanded" : ""}`}>
    <button className="tool-disclosure-row" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      <Chevron open={open} /><ToolGlyph name={call.name} /><strong>{call.name}</strong><span className="tool-summary">{toolSummary(call.name, call.arguments ?? {})}</span><span className={`tool-state ${status}`}><i />{status === "running" ? "Working" : status === "error" ? "Failed" : "Done"}</span>
    </button>
    {open && <div className="tool-disclosure-panel"><div className="tool-panel-label">{result?.isError ? "Error output" : "Tool output"}<span>{result ? "Completed" : "Live"}</span></div><pre>{details || "Waiting for output…"}</pre></div>}
  </div>;
}

function AssistantSegment({ message, toolActivity, results }: { message: any; toolActivity: Record<string, ToolActivity>; results: Map<string, any> }) {
  const calls = Array.isArray(message.content) ? message.content.filter((block: any) => block.type === "toolCall") : [];
  const text = textFromMessage(message);
  const thinking = thinkingFromMessage(message);
  return <div className="assistant-segment">{thinking && <details className="thinking-disclosure"><summary>Reasoning</summary><div className="thinking-text">{safeMarkdown(thinking)}</div></details>}{text && <div className="message-text">{safeMarkdown(text)}</div>}{calls.length > 0 && <div className="tool-stack">{calls.map((call: any) => <ToolCallDisclosure key={call.id} call={call} activity={toolActivity[call.id]} result={results.get(call.id)} />)}</div>}</div>;
}

function AssistantTurn({ messages, toolActivity, results }: { messages: any[]; toolActivity: Record<string, ToolActivity>; results: Map<string, any> }) {
  const knownIds = new Set(messages.flatMap((message) => message.role === "assistant" && Array.isArray(message.content) ? message.content.filter((block: any) => block.type === "toolCall").map((block: any) => block.id) : []));
  const timestamped = messages.find((message) => message.role === "assistant") ?? messages[0];
  return <article className="message assistant"><div className="message-body"><div className="message-meta"><strong>Pi Webdesk</strong><time>{new Date(timestamped?.timestamp || Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time></div>{messages.map((message, index) => message.role === "assistant" ? <AssistantSegment key={index} message={message} toolActivity={toolActivity} results={results} /> : message.role === "toolResult" && !knownIds.has(message.toolCallId) ? <ToolCallDisclosure key={message.toolCallId || index} call={{ id: message.toolCallId || `result-${index}`, name: message.toolName || "tool", arguments: {} }} result={message} /> : null)}</div></article>;
}

function ResponsePending({ runningTools, preparing }: { runningTools: boolean; preparing: boolean }) {
  const title = preparing ? "Sending request" : runningTools ? "Working in your workspace" : "Request sent";
  const detail = preparing ? "Connecting to the selected provider…" : runningTools ? "Pi Webdesk is gathering context…" : "Waiting for a response…";
  return <div className="response-pending" role="status" aria-live="polite">
    <span className="response-pending-dots" aria-hidden="true"><i /><i /><i /></span>
    <span className="response-pending-copy"><strong>{title}</strong><small>{detail}</small></span>
  </div>;
}

function formatFileSize(size: number): string {
  if (!size) return "—";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size > 10 * 1024 ? 0 : 1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function compactCount(value: number): string {
  if (value < 1000) return String(value);
  return `${(value / 1000).toFixed(value > 9999 ? 0 : 1)}k`;
}

function pathDepth(path: string): number { return path.split("/").length - 1; }

function extensionOf(path: string): string {
  const name = path.split("/").at(-1) ?? path;
  const index = name.lastIndexOf(".");
  return index > 0 ? name.slice(index + 1).toLowerCase() : "";
}

function languageForEntries(entries: BrowserEntry[]): string {
  const labels: Record<string, string> = { ts: "TypeScript", tsx: "TypeScript", js: "JavaScript", jsx: "JavaScript", css: "CSS", html: "HTML", json: "JSON", md: "Markdown", py: "Python", rs: "Rust", go: "Go", swift: "Swift" };
  const counts = new Map<string, number>();
  for (const entry of entries) {
    if (entry.kind !== "file") continue;
    const extension = extensionOf(entry.path);
    if (labels[extension]) counts.set(labels[extension], (counts.get(labels[extension]) ?? 0) + 1);
  }
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—";
}

function sortedTreeEntries(entries: BrowserEntry[], query: string, expandedPaths: string[]): BrowserEntry[] {
  const sorted = [...entries].sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
  const normalizedQuery = query.trim().toLowerCase();
  const expanded = new Set(expandedPaths);
  if (normalizedQuery) {
    const visible = new Set<string>();
    for (const entry of sorted) {
      if (!entry.name.toLowerCase().includes(normalizedQuery) && !entry.path.toLowerCase().includes(normalizedQuery)) continue;
      visible.add(entry.path);
      const parts = entry.path.split("/");
      for (let index = 1; index < parts.length; index += 1) visible.add(parts.slice(0, index).join("/"));
    }
    return sorted.filter((entry) => visible.has(entry.path));
  }
  return sorted.filter((entry) => {
    const parts = entry.path.split("/");
    return parts.slice(0, -1).every((_, index) => expanded.has(parts.slice(0, index + 1).join("/")));
  });
}

function FileTypeGlyph({ entry, open }: { entry: BrowserEntry; open?: boolean }) {
  return <span className={`file-type-glyph ${entry.kind} ${open ? "open" : ""}`} aria-hidden="true"><UiIcon name={entry.kind === "directory" ? "folder" : "file"} /></span>;
}

function WorkspaceTree({ entries, query, expandedPaths, selectedPath, onToggle, onSelect }: { entries: BrowserEntry[]; query: string; expandedPaths: string[]; selectedPath: string; onToggle: (path: string) => void; onSelect: (entry: BrowserEntry) => void }) {
  const rows = sortedTreeEntries(entries, query, expandedPaths);
  if (!entries.length) {
    return <div className="file-tree-empty"><FileTypeGlyph entry={{ name: "", path: ".", kind: "directory", size: 0 }} /><strong>No files loaded</strong><span>Open a folder to browse it here.</span></div>;
  }
  return <div className="file-tree" role="tree" aria-label="Workspace files">{rows.map((entry) => {
    const isOpen = expandedPaths.includes(entry.path);
    const depth = pathDepth(entry.path);
    return <button className={`file-tree-row ${entry.path === selectedPath ? "selected" : ""}`} style={{ "--tree-depth": depth } as React.CSSProperties} key={entry.path} role="treeitem" aria-expanded={entry.kind === "directory" ? isOpen : undefined} onClick={() => entry.kind === "directory" ? onToggle(entry.path) : onSelect(entry)}><span className={`tree-caret ${entry.kind === "directory" ? "" : "placeholder"}`}><Chevron open={isOpen} /></span><FileTypeGlyph entry={entry} open={isOpen} /><span className="file-tree-name">{entry.name}</span></button>;
  })}</div>;
}

function sessionDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function SessionList({ sessions, activeSessionId, editingSessionId, sessionNameDraft, onSelect, onRenameStart, onRenameChange, onRenameCommit, onRenameCancel, onDelete }: { sessions: SessionSummary[]; activeSessionId?: string; editingSessionId?: string; sessionNameDraft: string; onSelect: (session: SessionSummary) => void; onRenameStart: (session: SessionSummary) => void; onRenameChange: (value: string) => void; onRenameCommit: (session: SessionSummary) => void | Promise<void>; onRenameCancel: () => void; onDelete: (session: SessionSummary) => void | Promise<void> }) {
  if (!sessions.length) {
    return <div className="session-empty"><strong>{activeSessionId ? "No sessions yet" : "Open a workspace first"}</strong><span>{activeSessionId ? "Start a new session to begin." : "Your sessions will appear here."}</span></div>;
  }
  return <div className="session-list" aria-label="Sessions">{sessions.map((session) => <div className={`session-row ${session.id === activeSessionId ? "active" : ""}`} key={session.id}>
    {editingSessionId === session.id ? <input className="session-rename-input" value={sessionNameDraft} autoFocus aria-label={`Rename session ${session.name}`} onChange={(event) => onRenameChange(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void onRenameCommit(session); } if (event.key === "Escape") onRenameCancel(); }} onBlur={() => void onRenameCommit(session)} /> : <button className="session-select" onClick={() => onSelect(session)} aria-current={session.id === activeSessionId ? "page" : undefined}><span className="session-name">{session.name}</span><small>{sessionDate(session.updatedAt)}</small></button>}
    <div className="session-row-actions"><button className="session-action" aria-label={`Rename session ${session.name}`} title="Rename session" onClick={() => onRenameStart(session)}><UiIcon name="edit" /></button><button className="session-action delete" aria-label={`Delete session ${session.name}`} title="Delete session" onClick={() => void onDelete(session)}><UiIcon name="close" /></button></div>
  </div>)}</div>;
}

function WorkspaceAccessMenu({ mode, onChange }: { mode: WorkspaceAccessMode; onChange: (mode: WorkspaceAccessMode) => void }) {
  return <div className="workspace-access-menu" role="menu" aria-label="Workspace access mode">
    <div className="workspace-access-heading"><strong>Workspace access</strong><span>{WORKSPACE_ACCESS_MODE_LABELS[mode]}</span></div>
    <div className="workspace-access-options">{WORKSPACE_ACCESS_OPTIONS.map((option) => <button className={`workspace-access-option ${option === mode ? "selected" : ""}`} key={option} role="menuitemradio" aria-checked={option === mode} onClick={() => onChange(option)}><span className="workspace-access-indicator" aria-hidden="true">{option === mode ? "✓" : ""}</span><span><strong>{WORKSPACE_ACCESS_MODE_LABELS[option]}</strong><small>{WORKSPACE_ACCESS_MODE_DESCRIPTIONS[option]}</small></span></button>)}</div>
  </div>;
}

function WorkspaceInspector({ info, accessMode, entries, messages, tab, onTabChange, query, onQueryChange, expandedPaths, selectedPath, onToggle, onSelect }: { info?: WorkspaceInfo; accessMode: WorkspaceAccessMode; entries: BrowserEntry[]; messages: AgentMessage[]; tab: InspectorTab; onTabChange: (tab: InspectorTab) => void; query: string; onQueryChange: (value: string) => void; expandedPaths: string[]; selectedPath: string; onToggle: (path: string) => void; onSelect: (entry: BrowserEntry) => void }) {
  const files = entries.filter((entry) => entry.kind === "file");
  const folders = entries.filter((entry) => entry.kind === "directory");
  const toolEvents = messages.filter((message: any) => message.role === "toolResult" && (message.toolName || message.toolCallId)).slice(-4).reverse() as any[];
  const selectedEntry = entries.find((entry) => entry.path === selectedPath);
  return <aside className="workspace-panel">
    <div className="workspace-panel-header"><h2>Workspace</h2></div>
    <div className="workspace-tabs" role="tablist"><button className={tab === "overview" ? "active" : ""} role="tab" aria-selected={tab === "overview"} onClick={() => onTabChange("overview")}>Overview</button><button className={tab === "details" ? "active" : ""} role="tab" aria-selected={tab === "details"} onClick={() => onTabChange("details")}>Details</button></div>
    {tab === "overview" ? <>
      <div className="workspace-stats"><div><span>Files</span><strong>{info ? compactCount(files.length) : "—"}</strong></div><div><span>Folders</span><strong>{info ? compactCount(folders.length) : "—"}</strong></div><div><span>Lines</span><strong>{info ? "—" : "—"}</strong></div><div><span>Language</span><strong>{info ? languageForEntries(files) : "—"}</strong></div></div>
      <section className="inspector-card workspace-files-card"><div className="inspector-card-heading"><strong>Files</strong><span>{files.length ? `${files.length} files` : "No files"}</span></div><label className="inspector-file-search"><UiIcon name="search" /><input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Search files..." aria-label="Search workspace files" /></label><div className="workspace-tree"><WorkspaceTree entries={entries} query={query} expandedPaths={expandedPaths} selectedPath={selectedPath} onToggle={onToggle} onSelect={onSelect} /></div></section>
      <section className="inspector-card activity-card"><div className="inspector-card-heading"><strong>Recent activity</strong><span>{toolEvents.length ? "Live" : "Waiting"}</span></div>{toolEvents.length ? <div className="activity-list">{toolEvents.map((event, index) => <div className="activity-row" key={`${event.toolCallId || event.toolName}-${index}`}><span className="activity-icon"><UiIcon name={event.toolName === "edit" || event.toolName === "write" ? "edit" : event.toolName === "grep" || event.toolName === "find" ? "search" : "file"} /></span><span><b>{event.toolName || "Read"}</b><small>{typeof event.content === "string" ? event.content.slice(0, 34) : "Completed"}</small></span><time>now</time></div>)}</div> : <p className="inspector-empty">Your file reads and edits will appear here.</p>}</section>
    </> : <section className="inspector-details"><div><span>Workspace</span><strong>{info?.name ?? "No workspace selected"}</strong></div><div><span>Folder permission</span><strong>{info?.canWrite ? "Read and write" : info ? "Permission needed" : "Not connected"}</strong></div><div><span>Agent access</span><strong>{WORKSPACE_ACCESS_MODE_LABELS[accessMode]}</strong></div><div><span>Storage</span><strong>Browser only</strong></div><div><span>Files in view</span><strong>{info ? compactCount(files.length) : "—"}</strong></div>{selectedEntry && <div><span>Selected file</span><strong title={selectedEntry.path}>{selectedEntry.name}</strong></div>}<p>Pi Webdesk uses the File System Access API. Nothing is uploaded until a provider request is sent.</p></section>}
  </aside>;
}

export function App() {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [sidebarWidth, setSidebarWidth] = useState(initialSidebarWidth);
  const [resizingSidebar, setResizingSidebar] = useState(false);
  const [settings, setSettings] = useState<ApiSettings>(defaultSettings);
  const [workspace, setWorkspace] = useState<BrowserWorkspace>();
  const [workspaceInfo, setWorkspaceInfo] = useState<WorkspaceInfo>();
  const [savedWorkspaces, setSavedWorkspaces] = useState<WorkspaceRecord[]>([]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [activeSession, setActiveSession] = useState<SessionSummary>();
  const [agent, setAgent] = useState<PiWebdeskAgent>();
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [composer, setComposer] = useState("");
  const [error, setError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [composerCatalogs, setComposerCatalogs] = useState<Record<string, ComposerCatalogState>>({});
  const [workspaceAccessMode, setWorkspaceAccessMode] = useState<WorkspaceAccessMode>(initialWorkspaceAccessMode);
  const [workspaceFocusOpen, setWorkspaceFocusOpen] = useState(false);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [workspaceEntries, setWorkspaceEntries] = useState<BrowserEntry[]>([]);
  const [expandedPaths, setExpandedPaths] = useState<string[]>([]);
  const [fileQuery, setFileQuery] = useState("");
  const [selectedFilePath, setSelectedFilePath] = useState("");
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("overview");
  const [editingSessionId, setEditingSessionId] = useState<string>();
  const [sessionNameDraft, setSessionNameDraft] = useState("");
  const [toolActivity, setToolActivity] = useState<Record<string, ToolActivity>>({});
  const [requestPending, setRequestPending] = useState(false);
  const [apiStatus, setApiStatus] = useState<"unknown" | "checking" | "ready" | "error">("unknown");
  const bottomRef = useRef<HTMLDivElement>(null);
  const appShellRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const sidebarResizeRef = useRef({ active: false, startX: 0, startWidth: DEFAULT_SIDEBAR_WIDTH, width: DEFAULT_SIDEBAR_WIDTH });
  const agentSessionRef = useRef<SessionSummary | undefined>(undefined);
  const agentSubscriptionRef = useRef<(() => void) | undefined>(undefined);
  const composerCatalogLoadingRef = useRef(new Set<string>());
  const modelPickerAnchorRef = useRef<HTMLDivElement>(null);
  const modelPickerTriggerRef = useRef<HTMLButtonElement>(null);
  const workspaceFocusAnchorRef = useRef<HTMLDivElement>(null);
  const workspaceFocusTriggerRef = useRef<HTMLButtonElement>(null);
  const workspacePickerRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("pi-webdesk-theme", theme);
  }, [theme]);
  useEffect(() => {
    localStorage.setItem(WORKSPACE_ACCESS_MODE_KEY, workspaceAccessMode);
  }, [workspaceAccessMode]);
  const settingsRevisionRef = useRef(0);

  const discardAgent = () => {
    agentSubscriptionRef.current?.();
    agentSubscriptionRef.current = undefined;
    agent?.abort();
    setAgent(undefined);
  };

  const applySidebarWidth = (width: number) => {
    const next = clampSidebarWidth(width);
    sidebarResizeRef.current.width = next;
    appShellRef.current?.style.setProperty("--sidebar-width", `${next}px`);
    return next;
  };

  const finishSidebarResize = (target?: HTMLDivElement, pointerId?: number) => {
    if (!sidebarResizeRef.current.active) return;
    sidebarResizeRef.current.active = false;
    if (target && pointerId !== undefined && target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId);
    const next = applySidebarWidth(sidebarResizeRef.current.width);
    setSidebarWidth(next);
    setResizingSidebar(false);
    localStorage.setItem(SIDEBAR_WIDTH_KEY, String(Math.round(next)));
  };

  const resizeSidebarFromKeyboard = (event: React.KeyboardEvent<HTMLDivElement>) => {
    let next: number | undefined;
    if (event.key === "ArrowLeft") next = sidebarResizeRef.current.width - 10;
    else if (event.key === "ArrowRight") next = sidebarResizeRef.current.width + 10;
    else if (event.key === "Home") next = MIN_SIDEBAR_WIDTH;
    else if (event.key === "End") next = MAX_SIDEBAR_WIDTH;
    if (next === undefined) return;
    event.preventDefault();
    const applied = applySidebarWidth(next);
    setSidebarWidth(applied);
    localStorage.setItem(SIDEBAR_WIDTH_KEY, String(Math.round(applied)));
  };

  useEffect(() => {
    let cancelled = false;
    const initialSettingsRevision = settingsRevisionRef.current;
    void Promise.all([loadSettings(), restoreWorkspaces()]).then(([loadedSettings, restored]) => {
      if (cancelled) return;
      if (settingsRevisionRef.current === initialSettingsRevision) {
        setSettings(loadedSettings);
        setApiStatus("checking");
        void checkApi().then(() => {
          if (!cancelled && settingsRevisionRef.current === initialSettingsRevision) setApiStatus("ready");
        }).catch(() => {
          if (!cancelled && settingsRevisionRef.current === initialSettingsRevision) setApiStatus("error");
        });
        void fetchServerProviders().then((providers) => {
          if (!cancelled && settingsRevisionRef.current === initialSettingsRevision) setSettings((current) => applyServerProviders(current, providers));
        }).catch(() => {
          // The health check below surfaces backend configuration errors without blocking local UI restoration.
        });
      }
      setSavedWorkspaces(restored);
      const granted = restored.find((item) => item.permission === "granted");
      if (granted) void activateWorkspace(new BrowserWorkspace(granted.handle, granted.id));
    }).catch((reason) => setError(errorText(reason)));
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (requestPending || messages.length > 0 || Object.keys(toolActivity).length > 0) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, requestPending, toolActivity]);
  useEffect(() => {
    if (!modelPickerOpen && !workspaceFocusOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (modelPickerOpen && !modelPickerAnchorRef.current?.contains(target) && !modelPickerTriggerRef.current?.contains(target)) setModelPickerOpen(false);
      if (workspaceFocusOpen && !workspaceFocusAnchorRef.current?.contains(target) && !workspaceFocusTriggerRef.current?.contains(target)) setWorkspaceFocusOpen(false);
      if (workspaceOpen && !workspacePickerRef.current?.contains(target)) setWorkspaceOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [modelPickerOpen, workspaceFocusOpen, workspaceOpen]);
  useEffect(() => () => agentSubscriptionRef.current?.(), []);

  const refreshWorkspaceTree = async (target: BrowserWorkspace) => {
    try {
      const entries: BrowserEntry[] = [];
      for await (const entry of target.walk()) {
        entries.push({ name: entry.path.split("/").at(-1) ?? entry.path, path: entry.path, kind: entry.kind, size: entry.size });
        if (entries.length >= 240) break;
      }
      setWorkspaceEntries(entries);
      setExpandedPaths(entries.filter((entry) => entry.kind === "directory").map((entry) => entry.path));
    } catch (reason) {
      setWorkspaceEntries([]);
      setError(errorText(reason));
    }
  };

  const activateWorkspace = async (next: BrowserWorkspace) => {
    const permission = await next.permission();
    if (permission !== "granted") throw new Error("Folder access is not granted. Choose Open folder and approve read/write access.");
    const saved = await saveWorkspace(next);
    const info: WorkspaceInfo = { id: saved.id, name: saved.name, permission: "granted", canWrite: true };
    discardAgent();
    setWorkspace(next); setWorkspaceInfo(info); setSavedWorkspaces(await restoreWorkspaces()); setSessions(await listSessions(info.id));
    setWorkspaceEntries([]); setExpandedPaths([]); setSelectedFilePath(""); setInspectorTab("overview");
    agentSessionRef.current = undefined; setActiveSession(undefined); setMessages([]); setToolActivity({}); setWorkspaceOpen(false); setError("");
    void refreshWorkspaceTree(next);
  };

  const openFolder = async () => {
    try { await activateWorkspace(await BrowserWorkspace.pick()); } catch (reason) { if ((reason as DOMException)?.name !== "AbortError") setError(errorText(reason)); }
  };

  const reopenWorkspace = async (record: WorkspaceRecord) => {
    try {
      const next = new BrowserWorkspace(record.handle, record.id);
      if (await next.permission() !== "granted") {
        const permission = await next.requestPermission(true);
        if (permission !== "granted") throw new Error("Folder permission was not granted");
      }
      await activateWorkspace(next);
    } catch (reason) { setError(errorText(reason)); }
  };

  const confirmWorkspaceWrite = ({ operation, paths }: WorkspaceWriteRequest): boolean => {
    const visiblePaths = paths.length > 4
      ? `${paths.slice(0, 4).join("\n")}\n…and ${paths.length - 4} more`
      : paths.join("\n");
    return window.confirm(`Allow Pi Webdesk to ${operation} in the selected workspace?\n\n${visiblePaths}`);
  };

  const ensureAgent = async (): Promise<PiWebdeskAgent> => {
    if (!workspace || !workspaceInfo) throw new Error("Open a workspace folder first");
    if (!workspaceInfo.canWrite && workspaceAccessMode !== "read") throw new Error("Workspace does not have write permission. Re-open the folder and grant write access.");
    let session = activeSession;
    if (!session) { session = await createSession(workspaceInfo.id, settings.baseUrl, settings.modelId, `${workspaceInfo.name} session`); setActiveSession(session); setSessions(await listSessions(workspaceInfo.id)); }
    agentSessionRef.current = session;
    if (agent) return agent;
    const next = new PiWebdeskAgent(workspace, workspaceInfo, settings, messages, workspaceAccessMode, workspaceAccessMode === "confirm" ? confirmWorkspaceWrite : undefined);
    agentSubscriptionRef.current?.();
    agentSubscriptionRef.current = next.subscribe((event: AgentEvent) => {
      setMessages([...next.messages]);
      if (event.type === "tool_execution_start") setToolActivity((current) => ({ ...current, [event.toolCallId]: { name: event.toolName, status: "running", output: "" } }));
      if (event.type === "tool_execution_update") setToolActivity((current) => ({ ...current, [event.toolCallId]: { ...(current[event.toolCallId] ?? { name: event.toolName, status: "running", output: "" }), output: `${current[event.toolCallId]?.output ?? ""}${textFromMessage(event.partialResult)}` } }));
      if (event.type === "tool_execution_end") setToolActivity((current) => ({ ...current, [event.toolCallId]: { ...(current[event.toolCallId] ?? { name: event.toolName, output: "" }), status: event.isError ? "error" : "done" } }));
      if (event.type === "agent_end") {
        const last = event.messages.at(-1) as any;
        if (last?.stopReason === "error") setError(last.errorMessage || "The API request failed");
        if (agentSessionRef.current) void persist(next, agentSessionRef.current);
      }
    });
    setAgent(next);
    return next;
  };

  const persist = async (currentAgent: PiWebdeskAgent, session: SessionSummary) => {
    try {
      const hash = await sha256(currentAgent.agent.state.systemPrompt);
      const updated = await saveSession({ ...session, messages: currentAgent.messages, systemPromptHash: hash });
      setActiveSession(updated); setSessions((current) => current.map((item) => item.id === updated.id ? updated : item));
    } catch (reason) { setError(errorText(reason)); }
  };

  const send = async () => {
    const text = composer.trim(); if (!text) return;
    setComposer(""); setError(""); setToolActivity({}); setRequestPending(true);
    try {
      const current = await ensureAgent();
      const session = agentSessionRef.current;
      const hasUserMessage = messages.some((message: any) => message.role === "user");
      if (session && !hasUserMessage && session.titleMode !== "manual") {
        try {
          const renamed = await renameSession(session.id, deriveSessionName(text), "auto");
          agentSessionRef.current = renamed; setActiveSession(renamed); setSessions((items) => items.map((item) => item.id === renamed.id ? renamed : item));
        } catch (reason) { setError(`Could not name session: ${errorText(reason)}`); }
      }
      if (current.busy) current.steer(text); else await current.prompt(text); setMessages([...current.messages]);
    }
    catch (reason) { setError(errorText(reason)); setComposer(text); }
    finally { setRequestPending(false); }
  };

  const startSession = async () => {
    if (!workspaceInfo) { setWorkspaceOpen(true); return; }
    try { const session = await createSession(workspaceInfo.id, settings.baseUrl, settings.modelId, `${workspaceInfo.name} session`); discardAgent(); agentSessionRef.current = session; setActiveSession(session); setSessions(await listSessions(workspaceInfo.id)); setMessages([]); setToolActivity({}); } catch (reason) { setError(errorText(reason)); }
  };

  const loadExistingSession = async (summary: SessionSummary) => {
    try {
      const loaded = await loadSession(summary.id); if (!loaded) throw new Error("Session no longer exists");
      settingsRevisionRef.current += 1;
      discardAgent(); agentSessionRef.current = summary; setActiveSession(summary); setMessages(loaded.messages); setSettings((current) => {
        const matchingProvider = settingsProviders(current).find((provider) => provider.models.some((model) => model.id === loaded.modelId));
        if (!matchingProvider) return current;
        return { ...current, activeProviderId: matchingProvider.id, baseUrl: "/api", apiKey: "", modelId: loaded.modelId, rememberKey: false };
      }); setToolActivity({});
    } catch (reason) { setError(errorText(reason)); }
  };

  const removeSession = async (summary: SessionSummary) => {
    if (!window.confirm(`Delete session “${summary.name}”?`)) return;
    try { await deleteSession(summary.id); setSessions((current) => current.filter((item) => item.id !== summary.id)); if (activeSession?.id === summary.id) { discardAgent(); agentSessionRef.current = undefined; setActiveSession(undefined); setMessages([]); setToolActivity({}); } } catch (reason) { setError(errorText(reason)); }
  };

  const beginSessionRename = (session: SessionSummary) => { setEditingSessionId(session.id); setSessionNameDraft(session.name); };
  const cancelSessionRename = () => { setEditingSessionId(undefined); setSessionNameDraft(""); };
  const commitSessionRename = async (session: SessionSummary) => {
    const name = sessionNameDraft.trim();
    if (!name || name === session.name) { cancelSessionRename(); return; }
    try {
      const renamed = await renameSession(session.id, name, "manual");
      setSessions((items) => items.map((item) => item.id === renamed.id ? renamed : item));
      if (activeSession?.id === renamed.id) { agentSessionRef.current = renamed; setActiveSession(renamed); }
      cancelSessionRename();
    } catch (reason) { setError(errorText(reason)); }
  };

  const syncActiveSessionModel = async (next: ApiSettings) => {
    if (!activeSession || (activeSession.baseUrl === next.baseUrl && activeSession.modelId === next.modelId)) return;
    const loaded = await loadSession(activeSession.id);
    if (!loaded) return;
    const updated = await saveSession({ ...loaded, baseUrl: next.baseUrl, modelId: next.modelId });
    setActiveSession(updated);
    setSessions((current) => current.map((item) => item.id === updated.id ? updated : item));
  };

  const persistComposerSettings = async (next: ApiSettings) => {
    settingsRevisionRef.current += 1;
    setSettings(next);
    discardAgent();
    setApiStatus("unknown");
    try {
      await saveSettings(next);
      await syncActiveSessionModel(next);
    } catch (reason) {
      setError(errorText(reason));
    }
  };

  const updateSettings = async (next: ApiSettings) => {
    settingsRevisionRef.current += 1;
    setSettings(next);
    discardAgent();
    setApiStatus("unknown");
    try {
      await saveSettings(next);
      await syncActiveSessionModel(next);
      setError("");
    } catch (reason) {
      setError(errorText(reason));
      throw reason;
    }
  };
  const testApi = async (_candidate = settings) => { setApiStatus("checking"); try { await checkApi(); setApiStatus("ready"); setError(""); } catch (reason) { setApiStatus("error"); setError(errorText(reason)); } };
  const refreshServerCatalog = async () => {
    try {
      const providers = await fetchServerProviders();
      await persistComposerSettings(applyServerProviders(settings, providers));
      setComposerCatalogs({});
      setError("");
    } catch (reason) {
      setError(errorText(reason));
    }
  };
  const chooseWorkspaceAccessMode = (mode: WorkspaceAccessMode) => {
    setWorkspaceFocusOpen(false);
    if (mode === workspaceAccessMode) return;
    setWorkspaceAccessMode(mode);
    setModelPickerOpen(false);
    setToolActivity({});
    setError("");
    discardAgent();
  };
  const toggleWorkspaceFocus = () => {
    const nextOpen = !workspaceFocusOpen;
    setWorkspaceFocusOpen(nextOpen);
    if (nextOpen) setModelPickerOpen(false);
  };
  const activeSelection = activeComposerModel(settings, composerCatalogs);
  const availableComposerModels = composerModels(settings, composerCatalogs);
  const loadComposerCatalog = async (provider: ProviderProfile) => {
    if (composerCatalogLoadingRef.current.has(provider.id)) return;
    composerCatalogLoadingRef.current.add(provider.id);
    setComposerCatalogs((current) => ({ ...current, [provider.id]: { status: "loading", models: current[provider.id]?.models ?? [] } }));
    try {
      const providers = await fetchServerProviders();
      const refreshed = providers.find((item) => item.id === provider.id);
      const records: ApiModelRecord[] = (refreshed?.models ?? []).map((model) => ({ id: model.id, ...(model.name ? { name: model.name } : {}), ...(model.reasoningLevels ? { reasoning: { levels: model.reasoningLevels, defaultLevel: model.defaultReasoningLevel, mandatory: !model.reasoningLevels.includes("off") } } : {}) }));
      setSettings((current) => applyServerProviders(current, providers));
      setComposerCatalogs((current) => ({ ...current, [provider.id]: { status: "ready", models: records } }));
    } catch (reason) {
      setComposerCatalogs((current) => ({ ...current, [provider.id]: { status: "error", models: current[provider.id]?.models ?? [], error: errorText(reason) } }));
    } finally {
      composerCatalogLoadingRef.current.delete(provider.id);
    }
  };
  const toggleModelPicker = () => {
    const nextOpen = !modelPickerOpen;
    setModelPickerOpen(nextOpen);
    if (nextOpen) {
      setWorkspaceFocusOpen(false);
      void loadComposerCatalog(activeSelection.provider);
    }
  };
  const chooseComposerModel = (providerId: string, modelId: string) => {
    const selected = availableComposerModels.find((item) => item.provider.id === providerId && item.model.id === modelId);
    const provider = selected?.provider ?? settingsProviders(settings).find((item) => item.id === providerId);
    const model = selected?.model ?? provider?.models.find((item) => item.id === modelId);
    if (!provider || !model) return;
    const levels = model.reasoningLevels?.length ? model.reasoningLevels : REASONING_LEVELS;
    const next: ApiSettings = { ...settings, activeProviderId: provider.id, baseUrl: provider.baseUrl, apiKey: provider.apiKey, modelId: model.id, rememberKey: provider.rememberKey, reasoningLevel: reconcileReasoningLevel(settings.reasoningLevel, levels, model.defaultReasoningLevel) };
    setModelPickerOpen(false);
    void persistComposerSettings(next);
  };
  const chooseComposerReasoning = (level: ReasoningLevel) => {
    if (level === settings.reasoningLevel) return;
    void persistComposerSettings({ ...settings, reasoningLevel: level });
  };
  const busy = Boolean(agent?.busy);
  const responsePending = requestPending || busy;
  const permissionLabel = workspaceInfo?.canWrite ? "Folder ready" : workspaceInfo ? "Permission needed" : "No folder";
  const quickPrompts = ["Inspect this workspace", "Find TODOs and FIXME comments", "Summarize the project structure"];
  const toolResults = new Map(messages.filter((message: any) => message.role === "toolResult").map((message: any) => [message.toolCallId, message]));
  const knownToolIds = new Set<string>(messages.flatMap((message: any) => message.role === "assistant" && Array.isArray(message.content) ? message.content.filter((block: any) => block.type === "toolCall").map((block: any) => block.id) : []));
  const transcriptGroups = groupTranscriptMessages(messages as any[]);
  const activeModelLabel = activeSelection.model.name && activeSelection.model.name !== activeSelection.model.id ? activeSelection.model.name : activeSelection.model.id;
  const activeReasoningLabel = REASONING_LEVEL_LABELS[settings.reasoningLevel];
  const quickActions = [
    { title: "Read project structure", description: "Summarize files and folders", prompt: "Inspect this workspace", icon: "folder" as const },
    { title: "Find relevant files", description: "Search across your codebase", prompt: "Find TODOs and FIXME comments", icon: "search" as const },
    { title: "Refactor code", description: "Improve structure and readability", prompt: "Suggest a focused refactor for this workspace", icon: "code" as const },
    { title: "Answer questions", description: "Ask about your codebase", prompt: "Answer a question about this codebase", icon: "message" as const },
  ];
  const toggleTreePath = (path: string) => setExpandedPaths((current) => current.includes(path) ? current.filter((item) => item !== path) : [...current, path]);
  const selectFile = (entry: BrowserEntry) => { setSelectedFilePath(entry.path); setInspectorTab("details"); };

  return <div ref={appShellRef} className={`app-shell ${resizingSidebar ? "resizing-sidebar" : ""}`} style={{ "--sidebar-width": `${sidebarWidth}px` } as React.CSSProperties}>
    <aside ref={sidebarRef} className="sidebar">
      <div className="brand"><LogoMark /><span>Pi Webdesk</span></div>
      <div ref={workspacePickerRef} className="workspace-picker">
        <button className="workspace-switcher" aria-haspopup="menu" aria-expanded={workspaceOpen} onClick={() => { setWorkspaceOpen((value) => !value); setModelPickerOpen(false); setWorkspaceFocusOpen(false); }}><UiIcon name="folder" /><span>{workspaceInfo?.name || "Open workspace"}</span><Chevron open={workspaceOpen} /></button>
        {workspaceOpen && <WorkspaceMenu saved={savedWorkspaces} activeId={workspaceInfo?.id} onOpen={openFolder} onChoose={reopenWorkspace} />}
      </div>
      <div className="sidebar-section-heading"><span>Sessions</span><button className="file-tool-button" aria-label="New session" title="New session" onClick={() => void startSession()}><UiIcon name="plus" /></button></div>
      <SessionList sessions={sessions} activeSessionId={activeSession?.id} editingSessionId={editingSessionId} sessionNameDraft={sessionNameDraft} onSelect={(session) => void loadExistingSession(session)} onRenameStart={beginSessionRename} onRenameChange={setSessionNameDraft} onRenameCommit={commitSessionRename} onRenameCancel={cancelSessionRename} onDelete={removeSession} />
      <div className="sidebar-bottom"><div className="sidebar-actions"><button className="settings-link" onClick={() => setSettingsOpen(true)}><UiIcon name="settings" /><span>Settings</span></button><button className="theme-toggle sidebar-theme-toggle" aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`} title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`} onClick={() => setTheme((value) => value === "dark" ? "light" : "dark")}><UiIcon name={theme === "dark" ? "sun" : "moon"} /></button></div><span className="version">v0.1.0 · Vercel API</span></div>
    </aside>
    <div className="sidebar-resizer" role="separator" aria-label="Resize sidebar" aria-orientation="vertical" aria-valuemin={MIN_SIDEBAR_WIDTH} aria-valuemax={MAX_SIDEBAR_WIDTH} aria-valuenow={Math.round(sidebarWidth)} tabIndex={0} title="Drag to resize · Double-click to reset" onPointerDown={(event) => { if (event.button !== 0) return; const currentWidth = sidebarRef.current?.getBoundingClientRect().width ?? sidebarWidth; sidebarResizeRef.current = { active: true, startX: event.clientX, startWidth: currentWidth, width: currentWidth }; event.currentTarget.setPointerCapture(event.pointerId); setResizingSidebar(true); }} onPointerMove={(event) => { if (!sidebarResizeRef.current.active) return; applySidebarWidth(sidebarResizeRef.current.startWidth + event.clientX - sidebarResizeRef.current.startX); }} onPointerUp={(event) => finishSidebarResize(event.currentTarget, event.pointerId)} onPointerCancel={(event) => finishSidebarResize(event.currentTarget, event.pointerId)} onDoubleClick={() => { const next = applySidebarWidth(DEFAULT_SIDEBAR_WIDTH); setSidebarWidth(next); localStorage.setItem(SIDEBAR_WIDTH_KEY, String(next)); }} onKeyDown={resizeSidebarFromKeyboard} />
    <section className="app-workspace">
      <header className="topbar"><div className="topbar-left"><span className="topbar-session-title">{activeSession?.name || "New session"}</span></div><div className="topbar-status"><button className="theme-toggle topbar-theme" aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`} title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`} onClick={() => setTheme((value) => value === "dark" ? "light" : "dark")}><UiIcon name={theme === "dark" ? "sun" : "moon"} /></button><button className="account-avatar" aria-label="Account">A</button></div></header>
      <div className="content-grid">
        <main className="main-pane">
          {error && <div className="error-banner" role="alert"><div className="error-banner-copy"><span>Full error details</span><small>{error}</small></div><button onClick={() => setError("")} aria-label="Dismiss error">×</button></div>}
          {workspaceInfo && !workspaceInfo.canWrite && <div className="workspace-callout warning"><strong>Permission required for {workspaceInfo.name}</strong><span>The saved folder handle is available, but the browser needs a fresh read/write approval.</span><button className="callout-button" onClick={() => setWorkspaceOpen(true)}>Grant access</button></div>}
          <section className="transcript" aria-live="polite">
            {messages.length === 0 && <div className="empty-state"><div className="empty-badge"><UiIcon name="spark" /><span>Browser workspace agent</span></div><h1>How can I help you with your workspace?</h1><p>I can read, edit and organize files in your workspace.</p><div className="quick-actions">{quickActions.map((action) => <button className="quick-action" key={action.title} onClick={() => setComposer(action.prompt)}><span className="quick-action-icon"><UiIcon name={action.icon} /></span><span className="quick-action-copy"><strong>{action.title}</strong><small>{action.description}</small></span><UiIcon name="arrow-right" /></button>)}</div></div>}
            {transcriptGroups.map((group) => group.role === "assistant" ? <AssistantTurn key={group.key} messages={group.messages} toolActivity={toolActivity} results={toolResults} /> : <article className="message user" key={group.key}><div className="message-body"><div className="message-meta"><strong>You</strong><time>{new Date((group.message as any).timestamp || Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time></div><div className="message-text">{safeMarkdown(textFromMessage(group.message))}</div></div></article>)}
            {Object.entries(toolActivity).filter(([id]) => !knownToolIds.has(id)).map(([id, activity]) => <ToolCallDisclosure key={id} call={{ id, name: activity.name, arguments: {} }} activity={activity} />)}
            {responsePending && <ResponsePending preparing={requestPending && !busy} runningTools={Object.values(toolActivity).some((activity) => activity.status === "running")} />}
            <div ref={bottomRef} />
          </section>
          <footer className="composer-wrap">
            <textarea value={composer} onChange={(event) => setComposer(event.target.value)} onKeyDown={(event) => { const enterSends = settings.sendShortcut === "enter" && event.key === "Enter" && !event.shiftKey; const modifiedEnterSends = settings.sendShortcut === "mod-enter" && event.key === "Enter" && (event.metaKey || event.ctrlKey); if (!event.nativeEvent.isComposing && (enterSends || modifiedEnterSends)) { event.preventDefault(); void send(); } }} placeholder={busy ? "Steer Pi Webdesk while it works…" : "Message the agent..."} rows={2} />
            {workspaceFocusOpen && <div ref={workspaceFocusAnchorRef} className="workspace-access-anchor"><WorkspaceAccessMenu mode={workspaceAccessMode} onChange={chooseWorkspaceAccessMode} /></div>}
            {modelPickerOpen && <div ref={modelPickerAnchorRef} className="composer-picker-anchor"><ComposerSelectionPicker models={availableComposerModels} activeModelKey={`${activeSelection.provider.id}:${activeSelection.model.id}`} activeModel={activeSelection} selectedReasoning={settings.reasoningLevel} catalogState={composerCatalogs[activeSelection.provider.id]} onSelectModel={chooseComposerModel} onSelectReasoning={chooseComposerReasoning} onManage={() => { setSettingsOpen(true); setModelPickerOpen(false); }} /></div>}
            <div className="composer-actions"><button className="composer-round-button" aria-label="Manage providers and models" title="Manage providers and models" onClick={() => { setSettingsOpen(true); setModelPickerOpen(false); setWorkspaceFocusOpen(false); }}><UiIcon name="plus" /></button><button ref={workspaceFocusTriggerRef} className={`composer-workspace-button ${workspaceFocusOpen ? "open" : ""}`} aria-label={`Workspace access: ${WORKSPACE_ACCESS_MODE_LABELS[workspaceAccessMode]}`} aria-haspopup="menu" aria-expanded={workspaceFocusOpen} title={`Workspace access: ${WORKSPACE_ACCESS_MODE_LABELS[workspaceAccessMode]}`} onClick={toggleWorkspaceFocus}><span>{WORKSPACE_ACCESS_BUTTON_LABELS[workspaceAccessMode]}</span><Chevron open={workspaceFocusOpen} /></button><span className="composer-actions-spacer" /><div className="composer-selection"><span className="composer-provider-name" title={activeSelection.provider.name}>{activeSelection.provider.name}</span><button ref={modelPickerTriggerRef} className={`composer-model-summary ${modelPickerOpen ? "open" : ""}`} aria-label={`Choose model and reasoning level: ${activeModelLabel}`} title={`${activeSelection.provider.name} · ${activeModelLabel} · ${activeReasoningLabel}`} onClick={toggleModelPicker}><span className="composer-model-name">{activeModelLabel}</span><span className="composer-reasoning-value">{activeReasoningLabel}</span><Chevron open={modelPickerOpen} /></button></div>{busy && <button className="stop-button" aria-label="Stop agent" title="Stop agent" onClick={() => agent?.abort()}><UiIcon name="stop" /></button>}<button className="send-button" aria-label={busy ? "Steer agent" : "Send message"} title={busy ? "Steer agent" : "Send message"} onClick={() => void send()} disabled={!composer.trim()}><UiIcon name="send" /></button></div>
          </footer>
        </main>
        <WorkspaceInspector info={workspaceInfo} accessMode={workspaceAccessMode} entries={workspaceEntries} messages={messages} tab={inspectorTab} onTabChange={setInspectorTab} query={fileQuery} onQueryChange={setFileQuery} expandedPaths={expandedPaths} selectedPath={selectedFilePath} onToggle={toggleTreePath} onSelect={selectFile} />
      </div>
    </section>
    {settingsOpen && <SettingsDialog settings={settings} apiStatus={apiStatus} onTest={() => void testApi()} onChange={updateSettings} onProvidersChanged={() => void refreshServerCatalog()} onClose={() => setSettingsOpen(false)} />}
  </div>;
}

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) { return <div className="dialog-backdrop" role="presentation"><div className="dialog" role="dialog" aria-modal="true"><div className="dialog-title"><h2>{title}</h2><button onClick={onClose} aria-label="Close">×</button></div>{children}</div></div>; }

function ComposerSelectionPicker({ models, activeModelKey, activeModel, selectedReasoning, catalogState, onSelectModel, onSelectReasoning, onManage }: { models: ComposerModel[]; activeModelKey: string; activeModel: ComposerModel; selectedReasoning: ReasoningLevel; catalogState?: ComposerCatalogState; onSelectModel: (providerId: string, modelId: string) => void; onSelectReasoning: (level: ReasoningLevel) => void; onManage: () => void }) {
  const groups = models.reduce<Map<string, ComposerModel[]>>((result, item) => {
    const group = result.get(item.provider.id) ?? [];
    group.push(item);
    result.set(item.provider.id, group);
    return result;
  }, new Map());
  const reasoningLevels = activeModel.model.reasoningLevels?.length ? activeModel.model.reasoningLevels : REASONING_LEVELS;
  const modelLabel = activeModel.model.name && activeModel.model.name !== activeModel.model.id ? activeModel.model.name : activeModel.model.id;
  const reasoningIndex = Math.max(0, reasoningLevels.indexOf(selectedReasoning));
  const reasoningNote = catalogState?.status === "loading"
    ? "Refreshing configured model capabilities…"
    : catalogState?.status === "error"
      ? `Could not load model capabilities${catalogState.error ? `: ${catalogState.error}` : "."}`
      : activeModel.model.reasoningLevels?.length
        ? "Levels configured by the administrator."
        : `No capability metadata is configured for ${modelLabel} — all levels are available.`;
  return <div className="composer-picker-menu model-picker-menu" role="menu">
    <div className="picker-menu-heading"><strong>Choose model</strong><span>{models.length} available</span></div>
    <div className="picker-results">{Array.from(groups.entries()).map(([providerId, items]) => <section className="picker-group" key={providerId}><div className="picker-group-heading"><span>{items[0].provider.name}</span><small>{items.length}</small></div>{items.map(({ provider, model }) => { const key = `${provider.id}:${model.id}`; return <button className={`picker-model-option ${key === activeModelKey ? "selected" : ""}`} key={key} onClick={() => onSelectModel(provider.id, model.id)}><span><strong>{model.name && model.name !== model.id ? model.name : model.id}</strong><small>{model.id}{model.reasoningLevels?.length ? ` · ${model.reasoningLevels.length} reasoning levels` : " · all reasoning levels"}</small></span><b>{key === activeModelKey ? "✓" : ""}</b></button>; })}</section>)}</div>
    <div className="picker-divider" />
    <div className="picker-menu-heading picker-reasoning-heading"><strong>Reasoning level</strong><span>{REASONING_LEVEL_LABELS[selectedReasoning]}</span></div>
    <div className="reasoning-slider-wrap"><input className="reasoning-slider" type="range" min="0" max={Math.max(0, reasoningLevels.length - 1)} step="1" value={reasoningIndex} aria-label="Reasoning level" aria-valuetext={REASONING_LEVEL_LABELS[selectedReasoning]} onChange={(event) => onSelectReasoning(reasoningLevels[Number(event.target.value)] ?? reasoningLevels[0])} /><div className="reasoning-slider-labels">{reasoningLevels.map((level) => <span className={selectedReasoning === level ? "active" : ""} key={level}>{REASONING_LEVEL_LABELS[level]}</span>)}</div></div>
    <p className="picker-menu-note">{reasoningNote}</p>
    <button className="picker-manage" onClick={onManage}>＋ Manage provider models</button>
  </div>;
}

function SettingsDialog({ settings, apiStatus, onTest, onChange, onProvidersChanged, onClose }: { settings: ApiSettings; apiStatus: string; onTest: () => void; onChange: (settings: ApiSettings) => Promise<void>; onProvidersChanged: () => void; onClose: () => void }) {
  const [draft, setDraft] = useState(() => ({ maxOutputTokens: settings.maxOutputTokens, userPrompt: settings.userPrompt, sendShortcut: settings.sendShortcut }));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!dirty) setDraft({ maxOutputTokens: settings.maxOutputTokens, userPrompt: settings.userPrompt, sendShortcut: settings.sendShortcut });
  }, [dirty, settings]);

  const updateDraft = <K extends keyof typeof draft>(key: K, value: typeof draft[K]) => {
    setDirty(true);
    setDraft((current) => ({ ...current, [key]: value }));
  };
  const save = async () => {
    setSaving(true);
    try {
      await onChange({ ...settings, ...draft, baseUrl: "/api", apiKey: "", rememberKey: false });
      onClose();
    } catch {
      // The parent displays the persistence error and leaves the dialog open.
    } finally {
      setSaving(false);
    }
  };
  return <Dialog title="Application settings" onClose={onClose}>
    <section className="provider-editor"><div className="provider-editor-heading"><div><strong>Server API</strong><small>Provider URLs and keys are server-side only.</small></div><div className="provider-api-actions"><button className="ghost-button" onClick={onTest} disabled={apiStatus === "checking" || saving}><UiIcon name="check" />{apiStatus === "checking" ? "Checking…" : "Check server API"}</button><span className={`api-connected ${apiStatus === "ready" ? "ready" : ""}`}>{apiStatus === "ready" ? "✓ Connected" : "Not connected"}</span></div></div></section>
    <ProviderAdmin onChanged={onProvidersChanged} />
    <label className="setting-field"><span className="field-title">Max output tokens</span><small className="field-helper">Maximum number of tokens for model responses</small><input type="number" min="256" max="32768" value={draft.maxOutputTokens} onChange={(event) => updateDraft("maxOutputTokens", Number(event.target.value) || 4096)} /></label>
    <label className="setting-field"><span className="field-title">Custom prompt</span><small className="field-helper">Added to the built-in instructions for every new agent session. It does not replace browser and workspace constraints.</small><textarea value={draft.userPrompt} maxLength={8000} rows={6} onChange={(event) => updateDraft("userPrompt", event.target.value)} placeholder="For example: Prefer concise answers and explain risky changes before applying them." /></label>
    <fieldset className="shortcut-setting"><legend>Send messages</legend><div className="shortcut-options"><label><input type="radio" name="send-shortcut" checked={draft.sendShortcut === "enter"} onChange={() => updateDraft("sendShortcut", "enter")} /><span><strong>Enter</strong><small>Shift+Enter adds a new line</small></span></label><label><input type="radio" name="send-shortcut" checked={draft.sendShortcut === "mod-enter"} onChange={() => updateDraft("sendShortcut", "mod-enter")} /><span><strong>⌘/Ctrl + Enter</strong><small>Enter adds a new line</small></span></label></div></fieldset>
    <p className="dialog-note"><UiIcon name="info" /> <span>Provider changes are applied on the server. Model and reasoning choices appear in the composer after saving or importing them.</span></p>
    <div className="dialog-actions"><button className="send-button" onClick={() => void save()} disabled={saving}>{saving ? "Saving…" : "Save settings"}</button></div>
  </Dialog>;
}

function WorkspaceMenu({ saved, activeId, onOpen, onChoose }: { saved: WorkspaceRecord[]; activeId?: string; onOpen: () => void; onChoose: (record: WorkspaceRecord) => void }) {
  return <div className="workspace-menu" role="menu" aria-label="Workspaces">
    <div className="workspace-menu-heading"><strong>Workspace</strong><span>{saved.length ? `${saved.length} saved` : "No saved folders"}</span></div>
    <button className="workspace-menu-open" role="menuitem" onClick={() => void onOpen()}><UiIcon name="folder" /><span>Open folder</span></button>
    {saved.length > 0 ? <><div className="workspace-menu-section-label">RECENT FOLDERS</div><div className="saved-workspaces">{saved.map((record) => <button role="menuitem" className={`saved-workspace ${activeId === record.id ? "selected" : ""}`} key={record.id} aria-current={activeId === record.id ? "page" : undefined} onClick={() => void onChoose(record)}><span>{record.name}</span><small>{record.permission === "granted" ? "Access ready" : "Click to grant access"}</small></button>)}</div></> : <p className="workspace-menu-empty">Choose a folder to browse it in the workspace.</p>}
  </div>;
}
