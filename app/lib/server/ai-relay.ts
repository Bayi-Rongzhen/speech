import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { ProviderConnection } from '../schemas/ai-provider';

const BLOCKED_SUFFIXES = ['localhost', '.localhost', '.local', '.internal', '.home', '.lan', '.test'];
const SAFE_HEADERS = new Set(['http-referer', 'x-title', 'openai-organization', 'openai-project']);

export class RelayError extends Error {
  code: string;
  status: number;
  retryable: boolean;

  constructor(code: string, message: string, status: number, retryable = false) {
    super(message);
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

function normalizeHostname(hostname: string) {
  return hostname.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '');
}

function ipv4ToInt(address: string) {
  const parts = address.split('.');
  if (parts.length !== 4) return null;
  let result = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const value = Number(part);
    if (value > 255) return null;
    result = (result << 8) | value;
  }
  return result >>> 0;
}

const PRIVATE_IPV4_RANGES: Array<[string, number]> = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
];

function isPrivateIpv4(address: string) {
  const value = ipv4ToInt(address);
  if (value === null) return true;
  return PRIVATE_IPV4_RANGES.some(([base, bits]) => {
    const baseValue = ipv4ToInt(base) ?? 0;
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (value & mask) === (baseValue & mask);
  });
}

function isPrivateIpv6(address: string) {
  const normalized = normalizeHostname(address);
  if (normalized === '::' || normalized === '::1') return true;
  if (normalized.startsWith('::ffff:')) {
    const embedded = normalized.slice('::ffff:'.length);
    if (isIP(embedded) === 4) return isPrivateIpv4(embedded);
  }
  const firstGroup = normalized.split(':')[0];
  return /^fe[89ab]/.test(firstGroup) || /^f[cd]/.test(firstGroup) || /^ff/.test(firstGroup);
}

export function isPrivateOrReservedAddress(address: string) {
  const version = isIP(address);
  if (version === 4) return isPrivateIpv4(address);
  if (version === 6) return isPrivateIpv6(address);
  return true;
}

async function assertResolvesToPublicAddress(hostname: string) {
  let records;
  try {
    records = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    // DNS module unavailable in this runtime (e.g. some edge sandboxes) — the
    // hostname/IP-literal checks above still apply, and on the Cloudflare
    // Workers deployment the `global_fetch_strictly_public` compatibility
    // flag (see vite.config.ts) rejects non-public connect targets at the
    // socket layer regardless of what DNS resolves to.
    return;
  }
  if (records.length === 0 || records.some((record) => isPrivateOrReservedAddress(record.address))) {
    throw new RelayError('unsafe_endpoint', '目标地址解析到了不允许访问的网络地址。', 400);
  }
}

export function assertSafeProviderUrl(rawUrl: string) {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new RelayError('unsafe_endpoint', 'API 地址格式无效。', 400);
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || (url.port && url.port !== '443')) {
    throw new RelayError('unsafe_endpoint', 'API 地址必须是无账号、参数和片段的 HTTPS 地址。', 400);
  }
  const hostname = normalizeHostname(url.hostname);
  if (!hostname || !hostname.includes('.') || BLOCKED_SUFFIXES.some((suffix) => hostname === suffix || hostname.endsWith(suffix))) {
    throw new RelayError('unsafe_endpoint', '不能使用本机、内网或单标签地址。', 400);
  }
  const ipVersion = isIP(hostname);
  if (ipVersion !== 0) {
    throw new RelayError('unsafe_endpoint', '不能直接使用 IP 地址，请填写公开域名。', 400);
  }
  url.pathname = url.pathname.replace(/\/+$/, '');
  return url;
}

export function buildProviderHeaders(provider: ProviderConnection) {
  const headers: Record<string, string> = {};
  for (const header of provider.optionalHeaders) {
    if (!SAFE_HEADERS.has(header.name.toLowerCase())) throw new RelayError('invalid_request', '包含不允许的请求头。', 400);
    headers[header.name] = header.value;
  }
  return headers;
}

export function requireSameOrigin(request: Request) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    throw new RelayError('invalid_request', '请求必须使用 JSON。', 415);
  }
  const origin = request.headers.get('origin');
  if (!origin || origin !== new URL(request.url).origin) throw new RelayError('origin_not_allowed', '请求来源不受信任。', 403);
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite && fetchSite !== 'same-origin') throw new RelayError('origin_not_allowed', '请求来源不受信任。', 403);
}

export function noStoreHeaders() {
  return {
    'Cache-Control': 'no-store, max-age=0',
    Pragma: 'no-cache',
  };
}

export function createRelayFetch() {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const requestUrl = assertSafeProviderUrl(typeof input === 'string' || input instanceof URL ? String(input) : input.url);
    await assertResolvesToPublicAddress(requestUrl.hostname);
    const response = await fetch(requestUrl, { ...init, redirect: 'manual', cache: 'no-store' });
    if (response.status >= 300 && response.status < 400) throw new RelayError('redirect_blocked', '中转站返回了重定向，已为保护密钥而阻止。', 502);
    return response;
  };
}

export function relayErrorResponse(error: unknown) {
  const normalized = error instanceof RelayError
    ? error
    : new RelayError('unexpected_error', 'AI 服务请求暂时无法完成。', 500);
  return Response.json({
    error: {
      code: normalized.code,
      message: normalized.message,
      retryable: normalized.retryable,
    },
  }, { status: normalized.status, headers: noStoreHeaders() });
}
