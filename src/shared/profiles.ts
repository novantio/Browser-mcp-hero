export interface BrowserProfile {
  id: string;
  name: string;
  createdAt: number;
}
export interface ProfileSummary extends BrowserProfile {
  lockOwner: string | null;
}
export interface ProfileState {
  profiles: ProfileSummary[];
  activeProfileId: string;
  persistent: true;
}
