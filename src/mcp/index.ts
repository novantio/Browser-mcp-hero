import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { toolContracts } from '../shared/mcp-contracts';
import { dataContracts } from '../shared/data-contracts';
import { RpcError, publicError } from '../shared/rpc-error';

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
            z.object({ ok: z.literal(true), result: z.unknown() }).strict(),
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

async function ensureBridge(signal?: AbortSignal): Promise<BridgeInfo> {
  const filePath = getBridgeFilePath();
  const deadline = Date.now() + 15000;
  let launched = false;
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
  const server = new McpServer({ name: 'hero-browser', version: '0.4.0' });
  const allContracts = [...toolContracts, ...dataContracts];
  for (const tool of allContracts) {
    const outputSchema = z.object({ result: tool.output }).strict();
    server.registerTool(tool.name, {
      description: tool.description, inputSchema: tool.input, outputSchema,
    }, async (args, extra) => {
      try {
        const signal = AbortSignal.any([extra.signal, AbortSignal.timeout(70000)]);
        const bridge = await ensureBridge(signal);
        // Never retry a dispatched action: its side effects may already exist.
        const result = await requestRpc(bridge.port, bridge.token, tool.method, args, { signal });
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
  }
  return server;
}
async function main(): Promise<void> {
  const server = createHeroMcpServer();
  await server.connect(new StdioServerTransport());
  process.stderr.write('Hero Browser MCP siap.\n');
}
if (require.main === module) void main().catch(() => { process.stderr.write('MCP gagal dimulai.\n'); process.exitCode = 1; });
