// Query parameters that only describe what the user looked at (search terms, paging,
// tabs, language). Their values help agents and are not secrets, so they stay visible;
// every other parameter value (tokens, session ids, signatures) is redacted.
const PUBLIC_PARAMS = new Set([
  'q', 'query', 'search', 'search_query', 'search_keyword', 'keyword', 'keywords', 'k', 'term',
  'page', 'p', 'offset', 'limit', 'sort', 'order', 'tab', 'type', 'serp_type', 'category', 'filter',
  'lang', 'hl', 'gl', 'locale', 'lr', 'v', 'list', 't',
]);

export function redactText(value: string): string {
  return value
    .replace(/([?&#])([^=&#\s\"'<>]+)=([^&#\s\"'<>]+)/g, (whole, sep: string, key: string) =>
      PUBLIC_PARAMS.has(key.toLowerCase()) ? whole : `${sep}${key}=[REDACTED]`)
    .replace(/(https?:\/\/)[^/\s:@]+:[^@\s/]+@/gi, '$1[REDACTED]@');
}
