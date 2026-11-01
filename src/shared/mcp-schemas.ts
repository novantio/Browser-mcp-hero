/** Shared zod schemas for the browser MCP tool contracts (see mcp-contracts.ts). */
import { z } from 'zod';

export const id = z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/);
export const short = z.string().min(1).max(2000);
export const taskInput = { taskId: id };
export const task = z.object({
  id, profileId: id, status: z.enum(['RUNNING', 'PAUSED', 'WAITING_FOR_HUMAN', 'RESUMING', 'COMPLETED', 'FAILED', 'CANCELLED']),
  createdAt: z.number(), updatedAt: z.number(), ttlMs: z.number().optional(), retentionMs: z.number().optional(),
  pausedReason: z.enum(['manual', 'inactivity', 'preempted']).optional(), error: z.string().optional(),
  intervention: z.object({ reason: z.string(), message: z.string(), requestedAt: z.number() }).strict().optional(),
}).strict();
export const socialAccount = z.object({
  platform: z.string(),
  name: z.string(),
  loggedIn: z.boolean(),
  username: z.string().optional(),
}).strict();

export const profile = z.object({
  id, name: z.string(), createdAt: z.number(), sharedWith: id.optional(), stealth: z.boolean().optional(), persistSessionCookies: z.boolean().optional(), lockOwner: id.nullable(),
  sessionProfileId: id, sharedProfiles: z.array(id), isActive: z.boolean(), isLocked: z.boolean(),
  loggedInServices: z.array(z.string()).optional(),
  socialAccounts: z.array(socialAccount).optional(),
}).strict();

export const tab = z.object({
  id, title: z.string(), url: z.string(), loading: z.boolean(), canGoBack: z.boolean(), canGoForward: z.boolean(), error: z.string().nullable(),
  certificateWarning: z.object({ requestId: id, host: z.string(), url: z.string() }).strict().nullable().optional(),
}).strict();
export const ok = z.object({ ok: z.literal(true) }).strict();
export const expectCondition = z.object({
  selector: short.optional(),
  text: short.optional(),
  url: short.optional(),
  timeoutMs: z.number().int().min(100).max(30000).optional(),
}).strict();
export const actionResult = z.object({
  ok: z.literal(true),
  status: z.enum(['verified', 'unverified', 'not_executed']).optional(),
  detail: z.string().optional(),
  healed: z.boolean().optional(),
}).strict();
export const observedElement = z.object({
  id: z.number().int().min(1),
  tag: z.string(),
  role: z.string(),
  name: z.string(),
  type: z.string().optional(),
  value: z.string().optional(),
  checked: z.boolean().optional(),
  disabled: z.boolean().optional(),
  required: z.boolean().optional(),
  options: z.array(z.string()).optional(),
  selected: z.string().optional(),
  href: z.string().optional(),
  context: z.string().optional(),
}).strict();
export const observeResult = z.object({
  url: z.string(),
  title: z.string(),
  loading: z.boolean(),
  elements: z.array(observedElement).optional(),
  text: z.string(),
}).strict();
export const consoleEntry = z.object({
  level: z.enum(['info', 'warn', 'error', 'debug']),
  message: z.string(),
  source: z.string().optional(),
  line: z.number().int().optional(),
  timestamp: z.number(),
  tabId: z.string().optional(),
}).strict();
export const consoleLogsResult = z.object({
  entries: z.array(consoleEntry),
  summary: z.object({
    total: z.number().int(),
    errorCount: z.number().int(),
    warnCount: z.number().int(),
    infoCount: z.number().int(),
  }).strict(),
}).strict();
export const networkActivityEntry = z.object({
  id: z.string(),
  url: z.string(),
  method: z.string(),
  status: z.number().int().optional(),
  mimeType: z.string().optional(),
  durationMs: z.number(),
}).strict();
export const networkActivityResult = z.object({
  inflightCount: z.number().int(),
  inflightRequests: z.array(z.object({
    id: z.string(),
    url: z.string(),
    method: z.string(),
    durationMs: z.number(),
  }).strict()),
  failedRequests: z.array(networkActivityEntry),
  recentRequests: z.array(networkActivityEntry),
  summary: z.object({
    totalRecorded: z.number().int(),
    inflightCount: z.number().int(),
    failedCount: z.number().int(),
  }).strict(),
}).strict();
export const formField = z.object({
  name: z.string(),
  id: z.string(),
  elementId: z.number().int().min(1),
  tag: z.enum(['input', 'select', 'textarea']),
  type: z.string().optional(),
  label: z.string(),
  value: z.string().optional(),
  placeholder: z.string().optional(),
  required: z.boolean(),
  disabled: z.boolean(),
  readOnly: z.boolean(),
  checked: z.boolean().optional(),
  options: z.array(z.object({
    value: z.string(),
    text: z.string(),
    selected: z.boolean(),
  }).strict()).optional(),
}).strict();

export const formSubmitButton = z.object({
  elementId: z.number().int().min(1).optional(),
  text: z.string().optional(),
  tag: z.string(),
  selector: z.string().optional(),
}).strict();

export const inspectFormResult = z.object({
  forms: z.array(z.object({
    id: z.string(),
    name: z.string().optional(),
    action: z.string().optional(),
    method: z.string().optional(),
    elementId: z.number().int().min(1).optional(),
    fields: z.array(formField),
    submitButton: formSubmitButton.optional(),
  }).strict()),
}).strict();

export const fillFormResult = z.object({
  ok: z.boolean(),
  filled: z.array(z.object({
    field: z.string(),
    elementId: z.number().int().min(1).optional(),
    matchedBy: z.string(),
    type: z.string(),
  }).strict()),
  skipped: z.array(z.object({
    field: z.string(),
    reason: z.string(),
  }).strict()),
  submitted: z.boolean(),
  valid: z.boolean(),
  summary: z.string(),
}).strict();

export const foundElement = z.object({
  elementId: z.number().int().min(1),
  score: z.number(),
  name: z.string(),
  role: z.string(),
  tag: z.string(),
  selector: z.string().optional(),
  boundingBox: z.object({
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
  }).strict(),
  attributes: z.record(z.string(), z.string()),
  context: z.string().optional(),
}).strict();

export const findElementResult = z.object({
  query: z.string(),
  elements: z.array(foundElement),
}).strict();

export const getStateResult = z.object({
  activeTab: tab.nullable(),
  tabs: z.array(tab),
  activeProfile: z.object({
    id: z.string(),
    name: z.string(),
    isLocked: z.boolean(),
  }).strict(),
  taskStatus: z.string(),
  focusedElement: z.object({
    elementId: z.number().int().min(1).optional(),
    tag: z.string(),
    role: z.string().optional(),
    name: z.string().optional(),
    id: z.string().optional(),
  }).strict().nullable(),
  network: z.object({
    inflightCount: z.number().int(),
  }).strict(),
  console: z.object({
    errorCount: z.number().int(),
    warnCount: z.number().int(),
  }).strict(),
}).strict();

export const healSelectorResult = z.object({
  targetSelector: z.string(),
  resolvedSelector: z.string(),
  confidence: z.number(),
  strategyUsed: z.string(),
  candidates: z.array(z.object({
    selector: z.string(),
    confidence: z.number(),
    tag: z.string(),
    sampleText: z.string(),
  }).strict()),
}).strict();

export const detectChallengeResult = z.object({
  detected: z.boolean(),
  provider: z.string().optional(),
  details: z.string().optional(),
  status: z.string().optional(),
  taskId: id.optional(),
  resumeToken: id.optional(),
}).strict();

export const uploadFileResult = z.object({
  ok: z.literal(true),
  fileCount: z.number().int(),
  files: z.array(z.string()),
}).strict();

export const waitForDownloadResult = z.object({
  ok: z.literal(true),
  fileName: z.string(),
  filePath: z.string(),
  sizeBytes: z.number(),
  mimeType: z.string(),
}).strict();

export const createCheckpointResult = z.object({
  ok: z.literal(true),
  name: z.string(),
  url: z.string(),
  fieldsCount: z.number().int(),
  timestamp: z.number(),
}).strict();

export const rollbackCheckpointResult = z.object({
  ok: z.literal(true),
  name: z.string(),
  url: z.string(),
  restoredCount: z.number().int(),
}).strict();

export const actResult = z.object({
  ok: z.boolean(),
  intent: z.string(),
  targetResolved: z.object({
    elementId: z.number().int().min(1).optional(),
    name: z.string(),
    role: z.string(),
    selector: z.string().optional(),
  }).strict().optional(),
  healed: z.boolean().optional(),
  verified: z.boolean().optional(),
  challengeDetected: z.boolean().optional(),
  message: z.string(),
  status: z.string().optional(),
  resumeToken: id.optional(),
}).strict();

export const profileLoginSummary = z.object({
  profileId: id,
  profileName: z.string(),
  isActive: z.boolean(),
  loggedInServices: z.array(z.string()),
  socialAccounts: z.array(socialAccount),
}).strict();

export const getProfileLoginsResult = z.object({
  profiles: z.array(profileLoginSummary),
  recommendations: z.record(z.string(), id),
}).strict();

export const cookieEntry = z.object({
  name: z.string(),
  value: z.string(),
  domain: z.string().optional(),
  path: z.string().optional(),
  secure: z.boolean().optional(),
  httpOnly: z.boolean().optional(),
  sameSite: z.string().optional(),
  expirationDate: z.number().optional(),
}).strict();

export const getCookiesResult = z.object({
  cookies: z.array(cookieEntry),
  count: z.number().int(),
}).strict();

export const setCookieResult = z.object({
  ok: z.literal(true),
  name: z.string(),
  domain: z.string().optional(),
}).strict();

export const getStorageResult = z.object({
  type: z.enum(['local', 'session']),
  entries: z.record(z.string(), z.string()),
  count: z.number().int(),
}).strict();

export const setStorageResult = z.object({
  ok: z.literal(true),
  action: z.enum(['set', 'remove', 'clear']),
  type: z.enum(['local', 'session']),
}).strict();

export const dragAndDropResult = z.object({
  ok: z.literal(true),
  from: z.object({ x: z.number(), y: z.number() }).strict(),
  to: z.object({ x: z.number(), y: z.number() }).strict(),
}).strict();

export const selected = z.object({ activeProfileId: id }).strict();

export const engineState = z.object({
  status:z.enum(['idle','checking','downloading','verifying','ready','up_to_date','error','unsupported']),
  enabled:z.boolean(),currentElectron:z.string(),currentChromium:z.string(),latestElectron:z.string().nullable(),readyElectron:z.string().nullable(),
  progress:z.number().nullable(),lastCheckedAt:z.number().nullable(),message:z.string(),
}).strict();
