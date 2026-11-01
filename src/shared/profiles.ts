export interface BrowserProfile {
  id: string;
  name: string;
  createdAt: number;
  sharedWith?: string;
  /** Anti-detection script on this profile's pages. Absent = on (behaviour before the setting existed). */
  stealth?: boolean;
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

