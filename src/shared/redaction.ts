export function redactText(value: string): string {
  return value
    .replace(/([?&#][^=&#\s\"'<>]+)=([^&#\s\"'<>]+)/g, '$1=[REDACTED]')
    .replace(/(https?:\/\/)[^/\s:@]+:[^@\s/]+@/gi, '$1[REDACTED]@');
}
