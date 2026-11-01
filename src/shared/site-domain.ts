// Second-level labels used under country codes (shopee.co.id, bbc.co.uk, ui.ac.id).
const COUNTRY_SECOND_LEVEL = new Set(['co', 'com', 'net', 'org', 'ac', 'go', 'or', 'gov', 'edu', 'sch', 'my', 'web', 'biz', 'mil']);

/**
 * The site a cookie host belongs to, for grouping in the UI: ".seller.shopee.co.id"
 * -> "shopee.co.id", "www.tiktok.com" -> "tiktok.com". IP addresses stay as they are.
 */
export function siteOf(host: string): string {
  const clean = host.trim().toLowerCase().replace(/^\./, '').replace(/\.$/, '');
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(clean) || !clean.includes('.')) return clean;
  const labels = clean.split('.');
  const tld = labels[labels.length - 1]!;
  const second = labels[labels.length - 2]!;
  const take = tld.length === 2 && COUNTRY_SECOND_LEVEL.has(second) && labels.length >= 3 ? 3 : 2;
  return labels.slice(-take).join('.');
}

/** True when a cookie host belongs to the given site (the site itself or a subdomain). */
export function belongsToSite(host: string, site: string): boolean {
  const clean = host.trim().toLowerCase().replace(/^\./, '');
  return clean === site || clean.endsWith('.' + site);
}
