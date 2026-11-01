import { contextBridge, ipcRenderer } from 'electron';
import type { BrowserAPI, BrowserState, HumanInterventionRequest, ActivityEvent } from '../shared/types';

const api: BrowserAPI = {
  engineCommand: action => ipcRenderer.invoke('browser:engine-command', action),
  getState: () => ipcRenderer.invoke('browser:state'),
  command: command => ipcRenderer.invoke('browser:command', command),
  setBounds: bounds => ipcRenderer.invoke('browser:bounds', bounds),
  onState(listener) {
    const handler = (_event: Electron.IpcRendererEvent, state: BrowserState) => listener(state);
    ipcRenderer.on('browser:state-changed', handler);
    return () => ipcRenderer.removeListener('browser:state-changed', handler);
  },
  onFocusAddress(listener) {
    const handler = () => listener();
    ipcRenderer.on('browser:focus-address', handler);
    return () => ipcRenderer.removeListener('browser:focus-address', handler);
  },
  onHumanIntervention(listener) {
    const handler = (_event: Electron.IpcRendererEvent, req: HumanInterventionRequest | null) => listener(req);
    ipcRenderer.on('browser:human-intervention', handler);
    return () => ipcRenderer.removeListener('browser:human-intervention', handler);
  },
  onActivity(listener) {
    const handler = (_event: Electron.IpcRendererEvent, event: ActivityEvent) => listener(event);
    ipcRenderer.on('browser:activity', handler);
    return () => ipcRenderer.removeListener('browser:activity', handler);
  },
  getMcpConfig: () => ipcRenderer.invoke('browser:get-mcp-config'),
  copyToClipboard: (text: string) => ipcRenderer.invoke('browser:copy-clipboard', text),
  onOpenMcpModal(listener) {
    const handler = () => listener();
    ipcRenderer.on('browser:open-mcp-modal', handler);
    return () => ipcRenderer.removeListener('browser:open-mcp-modal', handler);
  },
  onMenuAction(listener) {
    const handler = (_event: Electron.IpcRendererEvent, action: 'toggle-panel' | 'manage-profiles') => listener(action);
    ipcRenderer.on('browser:menu-action', handler);
    return () => ipcRenderer.removeListener('browser:menu-action', handler);
  },
  dataOverview: () => ipcRenderer.invoke('data:overview'),
  dataJobs: () => ipcRenderer.invoke('data:jobs'),
  dataDatasets: () => ipcRenderer.invoke('data:datasets'),
  dataRecordings: () => ipcRenderer.invoke('data:recordings'),
  dataCommand: (action: string, payload?: unknown) => ipcRenderer.invoke('data:command', { action, payload }),
};
contextBridge.exposeInMainWorld('browser', api);
