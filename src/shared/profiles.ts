export interface BrowserProfile {
  id: string;
  name: string;
  createdAt: number;
  sharedWith?: string;
}
export interface ProfileSummary extends BrowserProfile {
  lockOwner: string | null;
  sessionProfileId: string;
  sharedProfiles: string[];
}
export interface ProfileState {
  profiles: ProfileSummary[];
  activeProfileId: string;
  persistent: true;
}
