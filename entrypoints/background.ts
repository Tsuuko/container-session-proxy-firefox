import {
  DEFAULT_COOKIE_STORE_ID,
  DEFAULT_SETTINGS,
  STORAGE_KEY,
  buildProxyFromSettings,
  createSessionContext,
  loadSettings,
  normalizeSettings,
  saveSettings,
  type ParsedProxy,
  type ProxyCredentials,
  type ProxyInfoShape,
  type ProxySettings,
} from '@/utils/proxy-config';

type RuntimeRequest =
  | { type: 'get-status' }
  | { type: 'open-ip-check' }
  | { type: 'randomize-hash' }
  | { settings: ProxySettings; type: 'save-settings' };

interface StatusResponse {
  configError?: string;
  cookieStoreId: string;
  enabled: boolean;
  proxyType?: ProxyInfoShape['type'];
  sessionId: string;
  settings: ProxySettings;
}

interface RandomizeHashResponse {
  hashSalt: string;
}

interface WebRequestDetails {
  cookieStoreId?: string;
  requestId: string;
  tabId?: number;
  url?: string;
}

interface AuthRequestDetails extends WebRequestDetails {
  challenger?: {
    host?: string;
    port?: number;
  };
  isProxy?: boolean;
}

interface FirefoxProxyApi {
  onError: {
    addListener(listener: (error: { message: string }) => void): void;
  };
  onRequest: {
    addListener(
      listener: (
        details: WebRequestDetails,
      ) => Promise<ProxyInfoShape | Array<ProxyInfoShape | null>>,
      filter: { urls: string[] },
    ): void;
  };
}

const DIRECT_PROXY_RESULT: Array<ProxyInfoShape | null> = [
  { type: 'direct' },
  null,
];
const BLOCKED_PROXY: ProxyInfoShape = {
  failoverTimeout: 1,
  host: '127.0.0.1',
  port: 9,
  type: 'http',
};
const ALL_URLS_FILTER = { urls: ['<all_urls>'] };
const IP_CHECK_SITE_URL = 'https://ipleak.net/';

let activeSettings: ProxySettings = DEFAULT_SETTINGS;
let settingsReady: Promise<void> | undefined;
const authCredentialsByRequestId = new Map<string, ProxyCredentials>();
const attemptedProxyAuthRequestIds = new Set<string>();

export default defineBackground(() => {
  settingsReady = refreshSettings();
  const proxyApi = browser.proxy as unknown as FirefoxProxyApi;

  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes[STORAGE_KEY]) {
      return;
    }

    activeSettings = normalizeSettings(changes[STORAGE_KEY].newValue);
  });

  proxyApi.onRequest.addListener(handleProxyRequest, ALL_URLS_FILTER);
  proxyApi.onError.addListener((error) => {
    console.warn('Container Session Proxy error:', error.message);
  });

  browser.webRequest.onAuthRequired.addListener(
    handleProxyAuthRequired,
    ALL_URLS_FILTER,
    ['blocking'],
  );
  browser.webRequest.onCompleted.addListener(cleanAuthState, ALL_URLS_FILTER);
  browser.webRequest.onErrorOccurred.addListener(
    cleanAuthState,
    ALL_URLS_FILTER,
  );

  browser.runtime.onMessage.addListener((message: RuntimeRequest) => {
    if (!message || typeof message !== 'object') {
      return undefined;
    }

    if (message.type === 'get-status') {
      return getStatus();
    }

    if (message.type === 'save-settings') {
      return updateSettings(message.settings);
    }

    if (message.type === 'open-ip-check') {
      return openIpCheckSite();
    }

    if (message.type === 'randomize-hash') {
      return randomizeHashSalt();
    }

    return undefined;
  });
});

async function refreshSettings(): Promise<void> {
  activeSettings = await loadSettings();
  await applyPrivacySettings(activeSettings);
}

async function handleProxyRequest(
  details: WebRequestDetails,
): Promise<ProxyInfoShape | Array<ProxyInfoShape | null>> {
  await settingsReady;
  const cookieStoreId = await resolveRequestCookieStoreId(details);

  if (shouldUseDirectConnection(cookieStoreId, details.url)) {
    return DIRECT_PROXY_RESULT;
  }

  try {
    const parsedProxy = buildProxy({ cookieStoreId });

    rememberAuthCredentials(details.requestId, parsedProxy.credentials);

    return [parsedProxy.info, null];
  } catch (error) {
    console.warn('Proxy configuration is invalid:', getErrorMessage(error));
    return [BLOCKED_PROXY, null];
  }
}

function shouldUseDirectConnection(
  cookieStoreId: string | undefined,
  url: string | undefined,
): boolean {
  return (
    !activeSettings.enabled ||
    (activeSettings.directNonContainer &&
      !isContainerCookieStoreId(cookieStoreId)) ||
    (activeSettings.bypassLocal && isLocalUrl(url))
  );
}

function handleProxyAuthRequired(details: AuthRequestDetails) {
  if (!details.isProxy) {
    return {};
  }

  const credentials =
    authCredentialsByRequestId.get(details.requestId) ||
    getFallbackCredentials(details);

  if (!credentials) {
    return {};
  }

  if (attemptedProxyAuthRequestIds.has(details.requestId)) {
    return { cancel: true };
  }

  attemptedProxyAuthRequestIds.add(details.requestId);

  return {
    authCredentials: {
      password: credentials.password,
      username: credentials.username,
    },
  };
}

function cleanAuthState(details: WebRequestDetails): void {
  authCredentialsByRequestId.delete(details.requestId);
  attemptedProxyAuthRequestIds.delete(details.requestId);
}

function rememberAuthCredentials(
  requestId: string,
  credentials: ProxyCredentials | undefined,
): void {
  if (!credentials) {
    return;
  }

  authCredentialsByRequestId.set(requestId, credentials);
}

function getFallbackCredentials(
  details: AuthRequestDetails,
): ProxyCredentials | undefined {
  if (!activeSettings.enabled) {
    return undefined;
  }

  try {
    return buildProxy(details).credentials;
  } catch {
    return undefined;
  }
}

function buildProxy(details: Pick<WebRequestDetails, 'cookieStoreId'>): ParsedProxy {
  return buildProxyFromSettings(
    activeSettings,
    details.cookieStoreId || DEFAULT_COOKIE_STORE_ID,
  );
}

async function resolveRequestCookieStoreId(
  details: WebRequestDetails,
): Promise<string | undefined> {
  if (details.cookieStoreId) {
    return details.cookieStoreId;
  }

  if (typeof details.tabId !== 'number' || details.tabId < 0) {
    return undefined;
  }

  try {
    const tab = await browser.tabs.get(details.tabId);

    return getTabCookieStoreId(tab);
  } catch {
    return undefined;
  }
}

async function getStatus(): Promise<StatusResponse> {
  await settingsReady;

  const tab = await getActiveTab();
  return createStatusResponse(getTabCookieStoreId(tab));
}

async function updateSettings(settings: ProxySettings): Promise<StatusResponse> {
  const nextSettings = normalizeSettings(settings);

  if (nextSettings.enabled) {
    const validationError = validateProxySettings(nextSettings);

    if (validationError) {
      const status = await getStatus();
      status.configError = validationError;

      return status;
    }
  }

  activeSettings = nextSettings;
  await saveSettings(activeSettings);
  await applyPrivacySettings(activeSettings);

  return getStatus();
}

function validateProxySettings(settings: ProxySettings): string | undefined {
  try {
    buildProxyFromSettings(settings, DEFAULT_COOKIE_STORE_ID);
    return undefined;
  } catch (error) {
    return getErrorMessage(error);
  }
}

async function randomizeHashSalt(): Promise<RandomizeHashResponse> {
  await settingsReady;

  const hashSalt = createRandomSalt();
  activeSettings = normalizeSettings({
    ...activeSettings,
    hashSalt,
  });
  await saveSettings(activeSettings);

  return { hashSalt };
}

async function applyPrivacySettings(settings: ProxySettings): Promise<void> {
  const privacyApi = browser.privacy as typeof browser.privacy & {
    network?: {
      peerConnectionEnabled?: {
        clear(details: Record<string, never>): Promise<void>;
        set(details: { value: boolean }): Promise<void>;
      };
    };
  };
  const peerConnectionEnabled = privacyApi.network?.peerConnectionEnabled;

  if (!peerConnectionEnabled) {
    console.warn('WebRTC privacy setting is unavailable in this Firefox build.');
    return;
  }

  if (settings.disableWebRtc) {
    await peerConnectionEnabled.set({ value: false });
    return;
  }

  await peerConnectionEnabled.clear({});
}

async function openIpCheckSite(): Promise<void> {
  const tab = await getActiveTab();
  const createProperties: Record<string, unknown> = {
    active: true,
    cookieStoreId: getTabCookieStoreId(tab),
    url: IP_CHECK_SITE_URL,
  };

  if (typeof tab?.id === 'number') {
    createProperties.openerTabId = tab.id;
  }

  if (typeof tab?.windowId === 'number') {
    createProperties.windowId = tab.windowId;
  }

  const createTab = browser.tabs.create as unknown as (
    properties: Record<string, unknown>,
  ) => Promise<Browser.tabs.Tab>;

  await createTab(createProperties);
}

function createStatusResponse(cookieStoreId: string): StatusResponse {
  const context = createSessionContext(cookieStoreId, activeSettings);
  const response: StatusResponse = {
    cookieStoreId,
    enabled: activeSettings.enabled,
    sessionId: context.session,
    settings: activeSettings,
  };

  if (!activeSettings.proxyUrlTemplate.trim()) {
    if (activeSettings.enabled) {
      response.configError = 'Proxy URL is empty.';
    }

    return response;
  }

  try {
    const parsedProxy = buildProxyFromSettings(activeSettings, cookieStoreId);

    response.proxyType = parsedProxy.info.type;
  } catch (error) {
    response.configError = getErrorMessage(error);
  }

  return response;
}

async function getActiveTab(): Promise<Browser.tabs.Tab | undefined> {
  const tabs = await browser.tabs.query({
    active: true,
    currentWindow: true,
  });

  return tabs[0];
}

function getTabCookieStoreId(tab: Browser.tabs.Tab | undefined): string {
  return (
    (tab as (Browser.tabs.Tab & { cookieStoreId?: string }) | undefined)
      ?.cookieStoreId || DEFAULT_COOKIE_STORE_ID
  );
}

function isContainerCookieStoreId(cookieStoreId: string | undefined): boolean {
  return Boolean(cookieStoreId?.startsWith('firefox-container-'));
}

function isLocalUrl(urlValue: string | undefined): boolean {
  if (!urlValue) {
    return false;
  }

  try {
    const url = new URL(urlValue);
    const hostname = normalizeHostname(url.hostname);

    return (
      isLocalHostname(hostname) ||
      isPrivateIpv4(hostname) ||
      isPrivateIpv6(hostname)
    );
  } catch {
    return false;
  }
}

function normalizeHostname(hostname: string): string {
  return hostname.replace(/^\[|\]$/gu, '').toLowerCase();
}

function isLocalHostname(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local')
  );
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split('.');

  if (parts.length !== 4) {
    return false;
  }

  const octets = parts.map((part) => Number(part));

  if (
    octets.some(
      (octet, index) =>
        !Number.isInteger(octet) ||
        octet < 0 ||
        octet > 255 ||
        String(octet) !== parts[index],
    )
  ) {
    return false;
  }

  const [a, b] = octets;

  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function isPrivateIpv6(hostname: string): boolean {
  if (!hostname.includes(':')) {
    return false;
  }

  if (hostname === '::1' || hostname === '0:0:0:0:0:0:0:1') {
    return true;
  }

  const firstHextet = hostname.split(':').find(Boolean);

  if (!firstHextet) {
    return false;
  }

  const firstValue = Number.parseInt(firstHextet, 16);

  if (!Number.isInteger(firstValue)) {
    return false;
  }

  return (
    (firstValue & 0xfe00) === 0xfc00 ||
    (firstValue & 0xffc0) === 0xfe80
  );
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createRandomSalt(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);

  return Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}
