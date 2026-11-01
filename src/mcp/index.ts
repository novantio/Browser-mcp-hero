import { McpServer, type RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { toolContracts } from '../shared/mcp-contracts';
import { HERO_INSTRUCTIONS } from './instructions';
import { dataContracts } from '../shared/data-contracts';
import { RpcError, publicError } from '../shared/rpc-error';

export type ToolPreset = 'all' | 'core' | 'automation' | 'data';

export const CORE_TOOL_NAMES = new Set<string>([
  'browser_start_task',
  'browser_get_task_status',
  'browser_complete_task',
  'browser_cancel_task',
  'browser_pause_task',
  'browser_resume_task',
  'browser_list_profiles',
  'browser_get_profile_logins',
  'browser_duplicate_profile',

  'browser_list_tabs',
  'browser_new_tab',
  'browser_close_tab',
  'browser_switch_tab',
  'browser_navigate',
  'browser_reload',
  'browser_back',
  'browser_read_text',
  'browser_extract_list',
  'browser_set_media_mode',
  'browser_observe',
  'browser_act',
  'browser_click',
  'browser_type',
  'browser_fill_form',
  'browser_press_key',
  'browser_scroll',
  'browser_wait',
  'browser_evaluate',
  'browser_extract',
  'browser_screenshot',
  'browser_request_human_intervention',
  'browser_restart_app',
  'browser_set_tool_preset',
  'browser_get_tool_preset',
]);

export const ALWAYS_ENABLED_TOOLS = new Set<string>([
  'browser_set_tool_preset',
  'browser_get_tool_preset',
]);

const toolContractNames = new Set(toolContracts.map(t => t.name));
const dataContractNames = new Set(dataContracts.map(t => t.name));

const bridgeInfo = z.object({ port: z.number().int().min(1).max(65535), token: z.string().regex(/^[a-f0-9]{48}$/), pid: z.number(), createdAt: z.number() }).strict();
type BridgeInfo = z.infer<typeof bridgeInfo>;

function getBridgeFilePath(): string {
  const appData = process.env.APPDATA || (process.platform === 'darwin'
    ? path.join(process.env.HOME || '', 'Library/Application Support') : path.join(process.env.HOME || '', '.config'));
  return path.join(process.env.HERO_USER_DATA_DIR || path.join(appData, 'Hero Browser Profiles'), 'mcp-bridge.json');
}

export function requestRpc(port: number, token: string, method: string, params: Record<string, unknown> = {},
  options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({ method, params });
    const req = http.request({
      hostname: '127.0.0.1', port, path: '/rpc', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData), Authorization: 'Bearer ' + token },
    });
    let settled = false;
    const cleanup = () => { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); };
    const fail = (error: unknown) => { if (settled) return; settled = true; cleanup(); reject(error); };
    const abort = () => {
      const error = new RpcError('CANCELLED', 'Permintaan dibatalkan.');
      fail(error); req.destroy(error);
    };
    const timer = setTimeout(() => {
      const error = new RpcError('TIMEOUT', 'Batas waktu permintaan habis.');
      fail(error); req.destroy(error);
    }, options.timeoutMs ?? 70000);
    req.on('error', () => fail(new RpcError('BRIDGE_DISCONNECTED', 'Koneksi browser terputus. Periksa hasil tindakan sebelum mencoba lagi.')));
    req.on('response', res => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('aborted', () => fail(new RpcError('BRIDGE_DISCONNECTED', 'Respons terputus. Periksa hasil tindakan sebelum mencoba lagi.')));
      res.on('error', () => fail(new RpcError('BRIDGE_DISCONNECTED', 'Respons browser gagal diterima.')));
      res.on('data', chunk => {
        raw += String(chunk);
        if (Buffer.byteLength(raw) > 20000000) { fail(new RpcError('OUTPUT_LIMIT', 'Hasil terlalu besar.')); req.destroy(); }
      });
      res.on('end', () => {
        if (settled) return;
        if (res.statusCode !== 200) { fail(new RpcError('BRIDGE_REJECTED', 'Browser menolak permintaan.')); return; }
        try {
          const value: unknown = JSON.parse(raw);
          const parsed = z.discriminatedUnion('ok', [
            z.object({ ok: z.literal(true), result: z.unknown().optional() }).strict(),
            z.object({ ok: z.literal(false), error: z.string(), code: z.string() }).strict(),
          ]).parse(value);
          if (!parsed.ok) { fail(new RpcError(parsed.code, parsed.error)); return; }
          settled = true; cleanup(); resolve(parsed.result);
        } catch { fail(new RpcError('INVALID_RESPONSE', 'Respons browser tidak valid.')); }
      });
    });
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) { abort(); return; }
    req.end(postData);
  });
}

// After browser_restart_app the app relaunches itself; launching another copy meanwhile
// would race the rebuild, so only wait for the new bridge during this window.
let restartingUntil = 0;

async function ensureBridge(signal?: AbortSignal): Promise<BridgeInfo> {
  const filePath = getBridgeFilePath();
  const restarting = Date.now() < restartingUntil;
  const deadline = Date.now() + (restarting ? 60000 : 15000);
  let launched = restarting;
  while (Date.now() < deadline) {
    signal?.throwIfAborted();
    if (existsSync(filePath)) {
      try {
        const info = bridgeInfo.parse(JSON.parse(readFileSync(filePath, 'utf8')));
        await requestRpc(info.port, info.token, 'ping', {}, { signal, timeoutMs: Math.min(1500, deadline - Date.now()) });
        return info;
      } catch { signal?.throwIfAborted(); }
    }
    if (!launched) {
      launched = true;
      const child = spawn(process.execPath, [path.resolve(__dirname, '../../scripts/start.cjs')], {
        detached: true, stdio: 'ignore', windowsHide: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
      });
      child.on('error', () => {}); child.unref();
    }
    await delay(250, undefined, { signal });
  }
  throw new RpcError('BRIDGE_UNAVAILABLE', 'Hero Browser belum dapat dihubungi. Buka aplikasi dan coba kembali.');
}

export function createHeroMcpServer(): McpServer {
  const server = new McpServer({ name: 'hero-browser', version: '0.4.0' }, { instructions: HERO_INSTRUCTIONS });
  const registeredTools = new Map<string, RegisteredTool>();

  const setPresetInput = z.object({
    preset: z.enum(['all', 'core', 'automation', 'data']).describe(
      'Nama preset tool: "all" (semua 100+ tool), "core" (default, ~30 tool esensial navigasi, baca, dan interaksi), "automation" (54 tool browser interaction lengkap), "data" (scraping & dataset pipeline).'
    ),
    customInclude: z.array(z.string()).optional().describe(
      'Daftar nama tool tambahan yang ingin diaktifkan di luar preset yang dipilih.'
    ),
    customExclude: z.array(z.string()).optional().describe(
      'Daftar nama tool yang ingin dinonaktifkan dari preset yang dipilih.'
    ),
  }).strict();

  const setPresetOutput = z.object({
    result: z.object({
      success: z.boolean(),
      activePreset: z.string(),
      enabledToolsCount: z.number(),
      totalToolsCount: z.number(),
      message: z.string(),
    }).strict(),
  }).strict();

  const getPresetInput = z.object({}).strict();

  const getPresetOutput = z.object({
    result: z.object({
      activePreset: z.string(),
      enabledToolsCount: z.number(),
      totalToolsCount: z.number(),
      availablePresets: z.record(z.string(), z.string()),
      enabledTools: z.array(z.string()),
    }).strict(),
  }).strict();

  // Default to the lean preset: ~105 tool definitions cost tens of thousands of tokens
  // and make tool choice harder. Agents widen it with browser_set_tool_preset.
  let currentPreset: ToolPreset = (process.env.HERO_TOOL_PROFILE as ToolPreset) || 'core';
  if (!['all', 'core', 'automation', 'data'].includes(currentPreset)) {
    currentPreset = 'core';
  }

  function applyPreset(
    preset: ToolPreset,
    customInclude?: string[],
    customExclude?: string[]
  ): { enabledCount: number; totalCount: number } {
    const includeSet = new Set(customInclude || []);
    const excludeSet = new Set(customExclude || []);
    let enabledCount = 0;

    for (const [name, tool] of registeredTools) {
      let shouldEnable = false;

      if (ALWAYS_ENABLED_TOOLS.has(name)) {
        shouldEnable = true;
      } else if (includeSet.has(name)) {
        shouldEnable = true;
      } else if (excludeSet.has(name)) {
        shouldEnable = false;
      } else if (preset === 'all') {
        shouldEnable = true;
      } else if (preset === 'core') {
        shouldEnable = CORE_TOOL_NAMES.has(name);
      } else if (preset === 'automation') {
        shouldEnable = toolContractNames.has(name);
      } else if (preset === 'data') {
        shouldEnable = dataContractNames.has(name) || CORE_TOOL_NAMES.has(name);
      }

      if (shouldEnable) {
        tool.enabled = true;
        enabledCount++;
      } else {
        tool.enabled = false;
      }
    }

    currentPreset = preset;
    return { enabledCount, totalCount: registeredTools.size };
  }

  // 1. Register dynamic preset management tools
  const setPresetTool = server.registerTool('browser_set_tool_preset', {
    description: 'Pilih atau ganti preset tool Hero Browser secara dinamis untuk menghemat token dan merampingkan daftar tool. Presets: "all" (semua tool), "core" (default, ~30 tool esensial), "automation" (browser interaction lengkap), "data" (scraping & dataset pipeline).',
    inputSchema: setPresetInput,
    outputSchema: setPresetOutput,
  }, async (args) => {
    try {
      const res = applyPreset(args.preset, args.customInclude, args.customExclude);
      try {
        await server.sendToolListChanged();
      } catch {
        // Transport might not be connected yet
      }
      const output = setPresetOutput.parse({
        result: {
          success: true,
          activePreset: currentPreset,
          enabledToolsCount: res.enabledCount,
          totalToolsCount: res.totalCount,
          message: `Preset tool berhasil diubah ke '${currentPreset}'. ${res.enabledCount} dari ${res.totalCount} tools sekarang aktif.`,
        },
      });
      return {
        structuredContent: output,
        content: [{ type: 'text' as const, text: JSON.stringify(output) }],
      };
    } catch (error) {
      const safe = publicError(error);
      return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify(safe) }] };
    }
  });
  registeredTools.set('browser_set_tool_preset', setPresetTool);

  const getPresetTool = server.registerTool('browser_get_tool_preset', {
    description: 'Melihat preset tool yang sedang aktif, jumlah tool yang aktif vs total, dan daftar tool yang tersedia.',
    inputSchema: getPresetInput,
    outputSchema: getPresetOutput,
  }, async () => {
    try {
      const enabledList: string[] = [];
      for (const [name, tool] of registeredTools) {
        if (tool.enabled) enabledList.push(name);
      }
      const output = getPresetOutput.parse({
        result: {
          activePreset: currentPreset,
          enabledToolsCount: enabledList.length,
          totalToolsCount: registeredTools.size,
          availablePresets: {
            all: 'Semua tool aktif (~105 tool)',
            core: 'Default. Tool esensial navigasi, baca teks, & interaksi web (~30 tool)',
            automation: 'Tool interaksi browser & UI lengkap (~55 tool)',
            data: 'Tool data extraction, scraping, monitor & analytics pipeline (~60 tool)',

          },
          enabledTools: enabledList,
        },
      });
      return {
        structuredContent: output,
        content: [{ type: 'text' as const, text: JSON.stringify(output) }],
      };
    } catch (error) {
      const safe = publicError(error);
      return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify(safe) }] };
    }
  });
  registeredTools.set('browser_get_tool_preset', getPresetTool);

  // 2. Register all browser and data RPC contract tools
  const allContracts = [...toolContracts, ...dataContracts];
  for (const tool of allContracts) {
    const outputSchema = z.object({ result: tool.output }).strict();
    const registered = server.registerTool(tool.name, {
      description: tool.description, inputSchema: tool.input, outputSchema,
    }, async (args, extra) => {
      try {
        const signal = AbortSignal.any([extra.signal, AbortSignal.timeout(70000)]);
        const bridge = await ensureBridge(signal);
        // Never retry a dispatched action: its side effects may already exist.
        const result = await requestRpc(bridge.port, bridge.token, tool.method, args, { signal });
        if (tool.method === 'app.restart') restartingUntil = Date.now() + 60000;
        const output = outputSchema.parse({ result });
        if (tool.method === 'automation.screenshot') {
          return { structuredContent: output, content: [{ type: 'image' as const, data: String(result), mimeType: 'image/png' }] };
        }
        return { structuredContent: output, content: [{ type: 'text' as const, text: JSON.stringify(output) }] };
      } catch (error) {
        const safe = publicError(error);
        return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify(safe) }] };
      }
    });
    registeredTools.set(tool.name, registered);
  }

  // 3. Apply initial preset (defaults to 'core'; HERO_TOOL_PROFILE=all exposes everything)
  applyPreset(currentPreset);

  return server;
}
async function main(): Promise<void> {
  const server = createHeroMcpServer();
  await server.connect(new StdioServerTransport());
  process.stderr.write('Hero Browser MCP siap.\n');
}
if (require.main === module) void main().catch(() => { process.stderr.write('MCP gagal dimulai.\n'); process.exitCode = 1; });
