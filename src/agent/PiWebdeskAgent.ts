import { Agent, type AgentEvent, type AgentMessage } from "@earendil-works/pi-agent-core";
import type { ApiSettings, WorkspaceAccessMode, WorkspaceInfo } from "../app/state.ts";
import { createModel, createStreamFunction } from "./createModel.ts";
import { createSystemPrompt } from "./systemPrompt.ts";
import { createBrowserTools } from "./createBrowserTools.ts";
import { BrowserWorkspace } from "../filesystem/BrowserWorkspace.ts";
import type { WriteConfirmation } from "../tools/common.ts";

export class PiWebdeskAgent {
  readonly agent: Agent;
  constructor(workspace: BrowserWorkspace, workspaceInfo: WorkspaceInfo, settings: ApiSettings, messages: AgentMessage[] = [], accessMode: WorkspaceAccessMode = "write", confirmWrite?: WriteConfirmation) {
    this.agent = new Agent({
      initialState: { systemPrompt: createSystemPrompt(workspaceInfo, accessMode, settings.userPrompt), model: createModel(settings), thinkingLevel: settings.reasoningLevel, tools: createBrowserTools(workspace, accessMode, confirmWrite), messages },
      streamFn: createStreamFunction(settings),
      toolExecution: "parallel",
      steeringMode: "one-at-a-time",
      followUpMode: "one-at-a-time",
    });
  }
  prompt(text: string): Promise<void> { return this.agent.prompt(text); }
  steer(text: string): void { this.agent.steer({ role: "user", content: text, timestamp: Date.now() }); }
  abort(): void { this.agent.abort(); }
  subscribe(listener: (event: AgentEvent) => void): () => void { return this.agent.subscribe((event) => listener(event)); }
  get messages(): AgentMessage[] { return this.agent.state.messages; }
  get busy(): boolean { return this.agent.state.isStreaming; }
}
