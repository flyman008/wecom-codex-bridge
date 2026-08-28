export type AgentName = 'codex';

export type AgentOperation = 'document_to_wecom' | 'spreadsheet_to_wecom';

export interface AgentAttachment {
  filePath: string;
  fileName: string;
  extension: string;
  sizeBytes: number;
}

export type AgentEvent =
  | { kind: 'status'; text: string }
  | { kind: 'delta'; text: string }
  | { kind: 'replace'; text: string }
  | { kind: 'image'; filePath: string };

export interface AgentRequest {
  prompt: string;
  quotedContext: string | undefined;
  personaPrompt?: string;
  sessionKey: string;
  signal: AbortSignal;
  operation?: AgentOperation;
  attachments?: readonly AgentAttachment[];
}

export interface AgentAdapter {
  readonly name: AgentName;
  isAvailable(): boolean;
  unavailableReason(): string;
  run(request: AgentRequest): AsyncGenerator<AgentEvent, void>;
}
