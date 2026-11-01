export interface BrowserProfile {
  id: string;
  name: string;
  createdAt: number;
  sharedWith?: string;
}
export interface SocialAccountInfo {
  platform: string;
  name: string;
  loggedIn: boolean;
  username?: string;
}

export interface ProfileSummary extends BrowserProfile {
  lockOwner: string | null;
  sessionProfileId: string;
  sharedProfiles: string[];
  loggedInServices?: string[];
  socialAccounts?: SocialAccountInfo[];
}
export interface ProfileState {
  profiles: ProfileSummary[];
  activeProfileId: string;
  persistent: true;
}

