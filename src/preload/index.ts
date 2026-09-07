import { contextBridge, ipcRenderer } from 'electron';
import type { BrowserAPI, BrowserState } from '../shared/types';

const api: BrowserAPI = {
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
};
contextBridge.exposeInMainWorld('browser', api);
