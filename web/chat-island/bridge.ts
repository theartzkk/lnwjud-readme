export type AwhTaskView = {
  taskId: string;
  goal: string;
  state: string;
  progress: number;
  title: string;
  detail: string;
  canCancel: boolean;
  updatedAt: string | null;
  journey: Array<{ label: string; state: string }>;
  tools: Array<{ id: string; label: string; reason: string }>;
};

export type AwhChatSnapshot = {
  schemaVersion: 1;
  ready: boolean;
  authenticated: boolean;
  project: { projectId: string; name: string } | null;
  conversation: Record<string, any> | null;
  conversations: Array<Record<string, any>>;
  messages: Array<Record<string, any>>;
  tasks: AwhTaskView[];
  artifacts: Array<Record<string, any>>;
  attachments: Array<Record<string, any>>;
  approvals: Array<Record<string, any>>;
  pendingAttachments: Array<{ index: number; name: string; size: number; type: string }>;
  sending: boolean;
  running: boolean;
  canCancel: boolean;
  continuity: Record<string, any> | null;
  workers: Array<{ workerId: string | null; name: string; state: string }>;
  error: string;
};

export type AwhChatBridge = {
  version: 1;
  subscribe(listener: (snapshot: AwhChatSnapshot) => void): () => void;
  getSnapshot(): AwhChatSnapshot;
  sendText(text: string): Promise<void>;
  addFiles(files: FileList | File[] | null | undefined): number;
  removePendingAttachment(index: number): boolean;
  pickFiles(): void;
  cancel(): Promise<void>;
  decide(approvalId: string, decision: "approve" | "reject"): Promise<void>;
  newConversation(): Promise<void>;
  searchConversations(query?: string): Promise<Array<Record<string, any>>>;
  switchConversation(conversationId: string): Promise<void>;
  renameConversation(conversationId: string, title: string): Promise<void>;
  archiveConversation(conversationId: string): Promise<void>;
  deleteConversation(conversationId: string): Promise<void>;
  openConversationManager(): void;
  openArtifact(artifactId: string): void;
  refresh(): Promise<void>;
};
declare global {
  var AWH_CHAT_BRIDGE: AwhChatBridge | undefined;
  interface Window { AWH_CHAT_BRIDGE?: AwhChatBridge }
}

export const emptySnapshot: AwhChatSnapshot = {
  schemaVersion: 1, ready: false, authenticated: false, project: null,
  conversation: null, conversations: [], messages: [], tasks: [],
  artifacts: [], attachments: [], approvals: [], pendingAttachments: [],
  sending: false, running: false, canCancel: false, continuity: null,
  workers: [], error: "",
};

export function currentBridge(): AwhChatBridge | null {
  return globalThis.AWH_CHAT_BRIDGE ?? null;
}

export function snapshotFromBridge(): AwhChatSnapshot {
  return currentBridge()?.getSnapshot() ?? emptySnapshot;
}
