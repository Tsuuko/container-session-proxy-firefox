export const STORAGE_KEY = 'containerSessionProxy.settings';
export const DEFAULT_COOKIE_STORE_ID = 'firefox-default';

export type ProxyMode = 'http' | 'https' | 'socks';

export interface ProxySettings {
  bypassLocal: boolean;
  directNonContainer: boolean;
  enabled: boolean;
  hashSalt: string;
  proxyUrlTemplate: string;
  sessionTemplate: string;
  proxyDns: boolean;
  disableWebRtc: boolean;
}

type StoredProxySettings = Partial<ProxySettings> & {
  sessionPrefix?: unknown;
};

export interface ProxyCredentials {
  username: string;
  password: string;
}

export interface ProxyInfoShape {
  type: 'direct' | ProxyMode;
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  proxyDNS?: boolean;
  proxyAuthorizationHeader?: string;
  connectionIsolationKey?: string;
  failoverTimeout?: number;
}

export interface ParsedProxy {
  credentials?: ProxyCredentials;
  info: ProxyInfoShape;
  redactedUrl: string;
  renderedUrl: string;
}

export interface SessionContext {
  containerId: string;
  containerSlug: string;
  cookieStoreId: string;
  hash: string;
  hash_long: string;
  session: string;
}

export const DEFAULT_SETTINGS: ProxySettings = {
  bypassLocal: true,
  directNonContainer: true,
  enabled: false,
  hashSalt: '',
  proxyUrlTemplate: '',
  sessionTemplate: '${hash}',
  proxyDns: true,
  disableWebRtc: false,
};

export function normalizeSettings(value: unknown): ProxySettings {
  const input =
    value && typeof value === 'object' ? (value as StoredProxySettings) : {};

  return {
    bypassLocal:
      typeof input.bypassLocal === 'boolean'
        ? input.bypassLocal
        : DEFAULT_SETTINGS.bypassLocal,
    directNonContainer:
      typeof input.directNonContainer === 'boolean'
        ? input.directNonContainer
        : DEFAULT_SETTINGS.directNonContainer,
    enabled: Boolean(input.enabled),
    disableWebRtc:
      typeof input.disableWebRtc === 'boolean'
        ? input.disableWebRtc
        : DEFAULT_SETTINGS.disableWebRtc,
    hashSalt:
      typeof input.hashSalt === 'string'
        ? input.hashSalt
        : DEFAULT_SETTINGS.hashSalt,
    proxyUrlTemplate:
      typeof input.proxyUrlTemplate === 'string'
        ? input.proxyUrlTemplate
        : DEFAULT_SETTINGS.proxyUrlTemplate,
    sessionTemplate:
      typeof input.sessionTemplate === 'string'
        ? input.sessionTemplate
        : migrateLegacySessionPrefix(input.sessionPrefix),
    proxyDns: true,
  };
}

export async function loadSettings(): Promise<ProxySettings> {
  const values = await browser.storage.local.get(STORAGE_KEY);
  return normalizeSettings(values[STORAGE_KEY]);
}

export async function saveSettings(settings: ProxySettings): Promise<void> {
  await browser.storage.local.set({
    [STORAGE_KEY]: normalizeSettings(settings),
  });
}

export function createSessionContext(
  cookieStoreId: string | undefined,
  settings: ProxySettings,
): SessionContext {
  const normalizedCookieStoreId = cookieStoreId || DEFAULT_COOKIE_STORE_ID;
  const normalizedContainerId = sanitizeSlugPart(normalizedCookieStoreId);
  const containerSlug = sanitizeSlugPart(
    normalizedCookieStoreId.replace(/^firefox-/, ''),
  );
  const hashInput = `${normalizedCookieStoreId}:${settings.hashSalt}`;
  const hash = hashString(hashInput);
  const hashLong = hashLongString(hashInput);

  return {
    containerId: normalizedContainerId,
    containerSlug,
    cookieStoreId: normalizedContainerId,
    hash,
    hash_long: hashLong,
    session: renderSessionTemplate(settings.sessionTemplate, {
      containerId: normalizedContainerId,
      containerSlug,
      cookieStoreId: normalizedContainerId,
      hash,
      hash_long: hashLong,
    }),
  };
}

export function createSessionId(
  cookieStoreId: string | undefined,
  sessionTemplate: string,
): string {
  const normalizedCookieStoreId = cookieStoreId || DEFAULT_COOKIE_STORE_ID;
  const context = createSessionContext(normalizedCookieStoreId, {
    ...DEFAULT_SETTINGS,
    sessionTemplate,
  });

  return context.session;
}

export function renderProxyTemplate(
  proxyUrlTemplate: string,
  context: SessionContext,
): string {
  const replacements: Record<string, string> = {
    containerId: context.containerId,
    containerSlug: context.containerSlug,
    cookieStoreId: context.cookieStoreId,
    hash: context.hash,
    hash_long: context.hash_long,
    session: context.session,
  };

  return replaceTemplateVariables(proxyUrlTemplate, replacements);
}

function renderSessionTemplate(
  sessionTemplate: string,
  replacements: Record<string, string>,
): string {
  const template = sessionTemplate.trim() || DEFAULT_SETTINGS.sessionTemplate;
  const { session: _session, ...sessionTemplateReplacements } = replacements;
  const rendered = replaceTemplateVariables(
    template,
    sessionTemplateReplacements,
  );

  return sanitizeSessionTokenPart(rendered).slice(0, 64) || replacements.hash;
}

function replaceTemplateVariables(
  template: string,
  replacements: Record<string, string>,
): string {
  return Object.entries(replacements).reduce((url, [key, value]) => {
    const patterns = [
      new RegExp(`\\$\\{\\s*${key}\\s*\\}`, 'gu'),
      new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'gu'),
      new RegExp(`\\{\\s*${key}\\s*\\}`, 'gu'),
    ];

    return patterns.reduce(
      (nextUrl, pattern) => nextUrl.replace(pattern, value),
      url,
    );
  }, template);
}

export function buildProxyFromSettings(
  settings: ProxySettings,
  cookieStoreId: string | undefined,
): ParsedProxy {
  const normalizedSettings = normalizeSettings(settings);
  const template = normalizedSettings.proxyUrlTemplate.trim();

  if (!template) {
    throw new Error('Proxy URL is empty.');
  }

  const context = createSessionContext(cookieStoreId, normalizedSettings);
  const renderedUrl = renderProxyTemplate(template, context).trim();
  const url = new URL(renderedUrl);
  const proxyType = resolveProxyType(url.protocol);

  if (!proxyType) {
    throw new Error(
      'Proxy URL must start with http://, https://, socks5://, or socks5h://.',
    );
  }

  if (!url.hostname) {
    throw new Error('Proxy host is empty.');
  }

  const port = resolvePort(url, proxyType);
  const credentials = readCredentials(url);
  const info: ProxyInfoShape = {
    type: proxyType,
    host: url.hostname,
    port,
    connectionIsolationKey: context.session,
    failoverTimeout: 5,
  };

  if (proxyType === 'socks') {
    info.proxyDNS = normalizedSettings.proxyDns;

    if (credentials) {
      info.username = credentials.username;
      info.password = credentials.password;
    }
  } else if (credentials) {
    info.proxyAuthorizationHeader = createBasicAuthHeader(credentials);
  }

  return {
    credentials,
    info,
    redactedUrl: redactProxyUrl(renderedUrl),
    renderedUrl,
  };
}

export function redactProxyUrl(proxyUrl: string): string {
  try {
    const url = new URL(proxyUrl);

    if (url.username) {
      url.username = '***';
    }

    if (url.password) {
      url.password = '***';
    }

    return url.toString();
  } catch {
    return proxyUrl.replace(/\/\/([^/@:]+)(:[^/@]*)?@/u, '//***:***@');
  }
}

function resolveProxyType(protocol: string): ProxyMode | undefined {
  switch (protocol.toLowerCase()) {
    case 'http:':
      return 'http';
    case 'https:':
      return 'https';
    case 'socks:':
    case 'socks5:':
    case 'socks5h:':
      return 'socks';
    default:
      return undefined;
  }
}

function resolvePort(url: URL, proxyType: ProxyMode): number {
  if (url.port) {
    const port = Number(url.port);

    if (Number.isInteger(port) && port > 0 && port <= 65535) {
      return port;
    }

    throw new Error('Proxy port is invalid.');
  }

  if (proxyType === 'http') {
    return 80;
  }

  if (proxyType === 'https') {
    return 443;
  }

  return 1080;
}

function readCredentials(url: URL): ProxyCredentials | undefined {
  if (!url.username && !url.password) {
    return undefined;
  }

  return {
    username: safeDecode(url.username),
    password: safeDecode(url.password),
  };
}

function createBasicAuthHeader(credentials: ProxyCredentials): string {
  return `Basic ${encodeBase64(`${credentials.username}:${credentials.password}`)}`;
}

function encodeBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';

  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return btoa(binary);
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function sanitizeSlugPart(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, '_')
      .replace(/^_+|_+$/gu, '') || 'default'
  );
}

function sanitizeSessionTokenPart(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]+/gu, '_')
      .replace(/^_+|_+$/gu, '') || 'default'
  );
}

function migrateLegacySessionPrefix(value: unknown): string {
  if (typeof value !== 'string') {
    return DEFAULT_SETTINGS.sessionTemplate;
  }

  const prefix = sanitizeSessionTokenPart(value);

  return prefix
    ? `${prefix}_${DEFAULT_SETTINGS.sessionTemplate}`
    : DEFAULT_SETTINGS.sessionTemplate;
}

function hashString(value: string): string {
  let hash = 0x811c9dc5;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(36).padStart(6, '0');
}

function hashLongString(value: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = (hash * prime) & mask;
  }

  return hash.toString(36).padStart(13, '0');
}
