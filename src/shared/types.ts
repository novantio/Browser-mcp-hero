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
  tabs: BrowserTab[];
  activeTabId: string;
}

export type BrowserCommand =
  | { action: 'new-tab' | 'save-session' }
  | { action: 'create-profile'; name: string }
  | { action: 'switch-profile' | 'delete-profile'; profileId: string }
  | { action: 'close-tab' | 'switch-tab'; tabId: string }
  | { action: 'navigate'; input: string }
  | { action: 'back' | 'forward' | 'reload' | 'stop' | 'home' };

export interface ViewBounds { x: number; y: number; width: number; height: number }
export type CommandResult = { ok: true } | { ok: false; error: string };

export interface BrowserAPI {
  getState(): Promise<BrowserState>;
  command(command: BrowserCommand): Promise<CommandResult>;
  setBounds(bounds: ViewBounds): Promise<void>;
  onState(listener: (state: BrowserState) => void): () => void;
  onFocusAddress(listener: () => void): () => void;
}
