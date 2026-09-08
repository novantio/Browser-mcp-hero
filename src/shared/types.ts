import type { ProfileState } from './profiles';
export interface BrowserTab {
  id: string;
  title: string;
  url: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  error: string | null;
}

export interface BrowserState extends ProfileState {
  tasks?: AutomationTask[];
  mcpStatus?: "starting" | "ready" | "failed";
  tabs: BrowserTab[];
  activeTabId: string;
}

export type TaskStatus = 'PAUSED' | 'RUNNING' | 'WAITING_FOR_HUMAN' | 'RESUMING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

export interface AutomationTask {
  id: string;
  profileId: string;
  status: TaskStatus;
  createdAt: number;
  updatedAt: number;
  error?: string;
  intervention?: {
    reason: string;
    message: string;
    requestedAt: number;
  };
}

export interface HumanInterventionRequest {
  taskId: string;
  profileId: string;
  reason: string;
  message: string;
}

export type BrowserCommand =
  | { action: 'new-tab' | 'save-session' | 'open-google' | 'stop-sharing' }
  | { action: 'share-session'; targetIds: string[] }
  | { action: 'create-profile'; name: string }
  | { action: 'switch-profile' | 'delete-profile'; profileId: string }
  | { action: 'close-tab' | 'switch-tab'; tabId: string }
  | { action: 'navigate'; input: string }
  | { action: 'back' | 'forward' | 'reload' | 'stop' | 'home' }
  | { action: 'resume-human-intervention'; taskId: string };

export interface ViewBounds { x: number; y: number; width: number; height: number }
export type CommandResult = { ok: true } | { ok: false; error: string };

export interface ActivityEvent {
  id: string;
  timestamp: number;
  action: string;
  summary: string;
  status: 'success' | 'running' | 'waiting' | 'failed';
  detail?: string;
}

export interface McpIntegrationConfig {
  mcpScriptPath: string;
  projectDir: string;
  claudeDesktopConfig: {
    mcpServers: {
      'hero-browser': {
        command: string;
        args: string[];
      };
    };
  };
  geminiAntigravityConfig: {
    'hero-browser': {
      command: string;
      args: string[];
    };
  };
  cliCommand: string;
  bridgePort?: number;
}

export interface BrowserAPI {
  getState(): Promise<BrowserState>;
  command(command: BrowserCommand): Promise<CommandResult>;
  setBounds(bounds: ViewBounds): Promise<void>;
  onState(listener: (state: BrowserState) => void): () => void;
  onFocusAddress(listener: () => void): () => void;
  onHumanIntervention(listener: (req: HumanInterventionRequest | null) => void): () => void;
  onActivity(listener: (event: ActivityEvent) => void): () => void;
  getMcpConfig?(): Promise<McpIntegrationConfig>;
  copyToClipboard?(text: string): Promise<boolean>;
  onOpenMcpModal?(listener: () => void): () => void;
  dataOverview?(): Promise<Record<string, unknown>>;
  dataJobs?(): Promise<unknown[]>;
  dataDatasets?(): Promise<unknown[]>;
  dataRecordings?(): Promise<unknown[]>;
  dataCommand?(action: string, payload?: unknown): Promise<CommandResult & { result?: unknown }>;
}
