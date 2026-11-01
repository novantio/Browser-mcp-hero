import type { Session, Cookie } from 'electron';
import type { SocialAccountInfo } from '../shared/profiles';

export interface SocialPlatformRule {
  platform: string;
  name: string;
  domains: string[];
  requiredCookies: string[]; // At least one of these must exist
  secondaryCookies?: string[];
  extractUsername?: (cookies: Cookie[]) => string | undefined;
}

export const SOCIAL_PLATFORM_RULES: SocialPlatformRule[] = [
  {
    platform: 'tiktok',
    name: 'TikTok',
    domains: ['tiktok.com', '.tiktok.com'],
    requiredCookies: ['sessionid', 'sessionid_ss', 'sid_guard'],
    extractUsername: (cookies) => {
      const uid = cookies.find(c => c.name === 'uid_tt' || c.name === 'uid_tt_ss')?.value;
      return uid ? `User (${uid.slice(0, 8)})` : undefined;
    },
  },
  {
    platform: 'youtube',
    name: 'YouTube',
    domains: ['youtube.com', '.youtube.com', 'google.com', '.google.com'],
    requiredCookies: ['LOGIN_INFO', 'SID', '__Secure-3PSID'],
  },
  {
    platform: 'instagram',
    name: 'Instagram',
    domains: ['instagram.com', '.instagram.com'],
    requiredCookies: ['sessionid'],
    extractUsername: (cookies) => {
      const uid = cookies.find(c => c.name === 'ds_user_id')?.value;
      return uid ? `ID:${uid}` : undefined;
    },
  },
  {
    platform: 'x',
    name: 'Twitter / X',
    domains: ['x.com', '.x.com', 'twitter.com', '.twitter.com'],
    requiredCookies: ['auth_token'],
    extractUsername: (cookies) => {
      const twid = cookies.find(c => c.name === 'twid')?.value;
      if (twid) {
        const match = decodeURIComponent(twid).match(/u=(\d+)/);
        if (match) return `ID:${match[1]}`;
      }
      return undefined;
    },
  },
  {
    platform: 'facebook',
    name: 'Facebook',
    domains: ['facebook.com', '.facebook.com'],
    requiredCookies: ['c_user'],
    extractUsername: (cookies) => {
      const uid = cookies.find(c => c.name === 'c_user')?.value;
      return uid ? `ID:${uid}` : undefined;
    },
  },
  {
    platform: 'github',
    name: 'GitHub',
    domains: ['github.com', '.github.com'],
    requiredCookies: ['user_session'],
    extractUsername: (cookies) => {
      const user = cookies.find(c => c.name === 'dotcom_user')?.value;
      return user || undefined;
    },
  },
  {
    platform: 'linkedin',
    name: 'LinkedIn',
    domains: ['linkedin.com', '.linkedin.com'],
    requiredCookies: ['li_at'],
  },
  {
    platform: 'reddit',
    name: 'Reddit',
    domains: ['reddit.com', '.reddit.com'],
    requiredCookies: ['reddit_session', 'token_v2'],
  },
];

/**
 * Checks a list of cookies against known social media platform rules.
 */
export function evaluateSocialCookies(cookies: Cookie[]): SocialAccountInfo[] {
  const now = Math.floor(Date.now() / 1000);
  const results: SocialAccountInfo[] = [];

  for (const rule of SOCIAL_PLATFORM_RULES) {
    // Filter cookies matching domain
    const platformCookies = cookies.filter(c => {
      const domain = (c.domain || '').toLowerCase();
      return rule.domains.some(d => domain === d || domain.endsWith(d));
    });

    if (!platformCookies.length) {
      continue;
    }

    // Check if any required cookie exists and is not expired
    const hasValidAuthCookie = platformCookies.some(c => {
      if (!rule.requiredCookies.includes(c.name)) return false;
      if (!c.value || c.value.trim() === '') return false;
      if (c.expirationDate && c.expirationDate < now) return false;
      return true;
    });

    if (hasValidAuthCookie) {
      const username = rule.extractUsername ? rule.extractUsername(platformCookies) : undefined;
      results.push({
        platform: rule.platform,
        name: rule.name,
        loggedIn: true,
        ...(username ? { username } : {}),
      });
    }
  }

  return results;
}

/**
 * Reads all cookies from an Electron Session and detects active social logins.
 */
export async function detectSessionSocialLogins(session: Session): Promise<SocialAccountInfo[]> {
  try {
    if (!session || !session.cookies) return [];
    const cookies = await session.cookies.get({});
    return evaluateSocialCookies(cookies);
  } catch {
    return [];
  }
}
