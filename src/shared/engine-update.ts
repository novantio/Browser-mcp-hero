export interface EngineUpdateState {
 status:'idle'|'checking'|'downloading'|'verifying'|'ready'|'up_to_date'|'error'|'unsupported';
 enabled:boolean;currentElectron:string;currentChromium:string;latestElectron:string|null;readyElectron:string|null;
 progress:number|null;lastCheckedAt:number|null;message:string;
}
export interface EngineSelection {
 version:string;chromium:string;platform:string;arch:string;directory:string;executableSha256:string;verifiedAt:number;
}
