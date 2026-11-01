import type { EngineUpdateState } from './engine-update';
import type { ProfileState } from './profiles';
export interface CertificateWarning {
  requestId: string;
  host: string;
  url: string;
}

export interface BrowserTab {
  id: string;
  title: string;
  url: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  error: string | null;
  certificateWarning?: CertificateWarning | null;
}

export interface BrowserState extends ProfileState {
  engineUpdate?: EngineUpdateState;
  tasks?: AutomationTask[];
  mcpStatus?: "starting" | "ready" | "failed";
  /** 'no-video' = images load, video/audio do not; 'lite' = neither (fonts and text always load). */
  mediaMode?: 'full' | 'no-video' | 'lite';
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
  ttlMs?: number;
  retentionMs?: number;
  pausedReason?: 'manual' | 'inactivity' | 'preempted';
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
  | { action: 'rename-profile'; profileId: string; name: string }
  | { action: 'duplicate-profile'; profileId: string; name: string; copyLogin: boolean }
  | { action: 'close-tab' | 'switch-tab'; tabId: string }
  | { action: 'navigate'; input: string }
  | { action: 'back' | 'forward' | 'reload' | 'stop' | 'home' }
  | { action: 'resume-human-intervention'; taskId: string }
  | { action: 'certificate-response'; allow: boolean }
  | { action: 'set-media-mode'; mode: 'full' | 'no-video' | 'lite' }
  | { action: 'set-stealth' | 'set-session-cookies'; profileId: string; enabled: boolean }
  | { action: 'clear-site-data'; profileId: string; domains: string[] };

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
  engineCommand(action: 'check' | 'enable' | 'disable'): Promise<EngineUpdateState>;
  getState(): Promise<BrowserState>;
  command(command: BrowserCommand): Promise<CommandResult>;
  setBounds(bounds: ViewBounds): Promise<void>;
  /** True while an app dialog is open, so the web page view does not cover it. */
  setOverlay(open: boolean): Promise<void>;
  /** Sites that have cookies stored in a profile, for the "clear site data" picker. */
  listSiteData(profileId: string): Promise<Array<{ site: string; cookies: number; hosts: string[] }>>;
  onState(listener: (state: BrowserState) => void): () => void;
  onFocusAddress(listener: () => void): () => void;
  onHumanIntervention(listener: (req: HumanInterventionRequest | null) => void): () => void;
  onActivity(listener: (event: ActivityEvent) => void): () => void;
  getMcpConfig?(): Promise<McpIntegrationConfig>;
  copyToClipboard?(text: string): Promise<boolean>;
  onOpenMcpModal?(listener: () => void): () => void;
  /** Menu shortcuts that must work while a web page has keyboard focus. */
  onMenuAction?(listener: (action: 'toggle-panel' | 'manage-profiles' | 'toggle-media') => void): () => void;
  dataOverview?(): Promise<Record<string, unknown>>;
  dataJobs?(): Promise<unknown[]>;
  dataDatasets?(): Promise<unknown[]>;
  dataRecordings?(): Promise<unknown[]>;
  dataCommand?(action: string, payload?: unknown): Promise<CommandResult & { result?: unknown }>;
}
