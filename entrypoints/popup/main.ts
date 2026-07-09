import {
  DEFAULT_COOKIE_STORE_ID,
  DEFAULT_SETTINGS,
  createSessionContext,
  normalizeSettings,
  type ProxySettings,
} from '@/utils/proxy-config';
import './style.css';

declare const __APP_VERSION__: string;

type RuntimeRequest =
  | { type: 'get-status' }
  | { type: 'open-ip-check' }
  | { type: 'randomize-hash' }
  | { settings: ProxySettings; type: 'save-settings' };

interface StatusResponse {
  configError?: string;
  cookieStoreId: string;
  enabled: boolean;
  proxyType?: string;
  sessionId: string;
  settings: ProxySettings;
}

interface RandomizeHashResponse {
  hashSalt: string;
}

const appVersion = __APP_VERSION__;

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <main class="shell">
    <header class="header">
      <div>
        <p class="eyebrow">Firefox containers</p>
        <div class="title-row">
          <img class="title-icon" src="/icon/icon.svg" alt="" aria-hidden="true" />
          <h1>Session Proxy</h1>
          <span class="version-badge">${appVersion}</span>
        </div>
      </div>
      <div class="header-controls">
        <button id="openIpCheck" class="secondary" type="button">IP Check</button>
        <label class="switch" title="Enable proxy">
          <input id="enabled" type="checkbox" />
          <span></span>
        </label>
      </div>
    </header>

    <section class="status-grid">
      <div>
        <span class="meta-label">Container</span>
        <code id="cookieStoreId">-</code>
      </div>
      <div>
        <span class="meta-label">Session</span>
        <code id="sessionId">-</code>
      </div>
    </section>

    <form id="settingsForm" class="settings">
      <label class="field">
        <span>Proxy URL template</span>
        <textarea
          id="proxyUrlTemplate"
          spellcheck="false"
          placeholder="socks5h://user-session-\${session}:pass@host.example:22228"
        ></textarea>
      </label>

      <label class="field">
        <span>Session template</span>
        <input
          id="sessionTemplate"
          type="text"
          spellcheck="false"
          placeholder="csp\${hash}test"
        />
      </label>

      <div class="proxy-actions">
        <p id="message" class="message" role="status"></p>
        <button id="save" type="submit">Save</button>
      </div>

      <section class="preview-panel">
        <span class="meta-label">Session preview</span>
        <code id="sessionPreview">-</code>
      </section>

      <section class="template-list">
        <div class="panel-heading">
          <span class="meta-label">Session template variables</span>
          <button id="randomizeHash" class="link-button" type="button">
            <svg class="spin-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M21 12a9 9 0 1 1-2.64-6.36" />
              <path d="M21 3v6h-6" />
            </svg>
            <span>Randomize hash</span>
          </button>
        </div>
        <dl>
          <div>
            <dt><code>\${hash}</code></dt>
            <dd><code id="templateHash">-</code></dd>
          </div>
          <div>
            <dt><code>\${hash_long}</code></dt>
            <dd><code id="templateHashLong">-</code></dd>
          </div>
          <div>
            <dt><code>\${cookieStoreId}</code></dt>
            <dd><code id="templateCookieStoreId">-</code></dd>
          </div>
          <div>
            <dt><code>\${containerId}</code></dt>
            <dd><code id="templateContainerId">-</code></dd>
          </div>
          <div>
            <dt><code>\${containerSlug}</code></dt>
            <dd><code id="templateContainerSlug">-</code></dd>
          </div>
        </dl>
      </section>

      <section class="option-list">
        <label class="checkbox-field" title="Use direct connection for normal tabs and private tabs that are not Firefox containers.">
          <input id="directNonContainer" type="checkbox" />
          <span>Direct for non-container tabs</span>
        </label>
        <label class="checkbox-field" title="Bypass the proxy for localhost, .local, private IPv4 ranges, and local IPv6 ranges.">
          <input id="bypassLocal" type="checkbox" />
          <span>Exclude local/private addresses</span>
        </label>
        <label class="checkbox-field" title="Disable WebRTC peer connections to prevent WebRTC IP leaks.">
          <input id="disableWebRtc" type="checkbox" />
          <span>Disable WebRTC</span>
        </label>
      </section>
    </form>
  </main>
`;

const elements = {
  bypassLocal: query<HTMLInputElement>('#bypassLocal'),
  cookieStoreId: query<HTMLElement>('#cookieStoreId'),
  disableWebRtc: query<HTMLInputElement>('#disableWebRtc'),
  directNonContainer: query<HTMLInputElement>('#directNonContainer'),
  enabled: query<HTMLInputElement>('#enabled'),
  message: query<HTMLElement>('#message'),
  openIpCheck: query<HTMLButtonElement>('#openIpCheck'),
  proxyUrlTemplate: query<HTMLTextAreaElement>('#proxyUrlTemplate'),
  randomizeHash: query<HTMLButtonElement>('#randomizeHash'),
  save: query<HTMLButtonElement>('#save'),
  sessionId: query<HTMLElement>('#sessionId'),
  sessionPreview: query<HTMLElement>('#sessionPreview'),
  sessionTemplate: query<HTMLInputElement>('#sessionTemplate'),
  settingsForm: query<HTMLFormElement>('#settingsForm'),
  templateContainerId: query<HTMLElement>('#templateContainerId'),
  templateContainerSlug: query<HTMLElement>('#templateContainerSlug'),
  templateCookieStoreId: query<HTMLElement>('#templateCookieStoreId'),
  templateHash: query<HTMLElement>('#templateHash'),
  templateHashLong: query<HTMLElement>('#templateHashLong'),
};

let currentCookieStoreId = DEFAULT_COOKIE_STORE_ID;
let currentHashSalt = DEFAULT_SETTINGS.hashSalt;
let savedSettings = DEFAULT_SETTINGS;
let autoSaveTask: Promise<void> = Promise.resolve();

void initialize();

elements.settingsForm.addEventListener('submit', (event) => {
  event.preventDefault();
  void saveCurrentSettings();
});

elements.sessionTemplate.addEventListener('input', () => {
  renderTemplateValues(currentCookieStoreId, collectSettings());
});

[
  elements.bypassLocal,
  elements.disableWebRtc,
  elements.directNonContainer,
  elements.enabled,
].forEach((element) => {
  element.addEventListener('change', () => {
    queueControlSettingsSave();
  });
});

elements.openIpCheck.addEventListener('click', () => {
  void openIpCheckSite();
});

elements.randomizeHash.addEventListener('click', () => {
  void randomizeHash();
});

async function initialize(): Promise<void> {
  setMessage('Loading...', 'muted');
  setBusy(true);

  try {
    const status = await sendMessage<StatusResponse>({ type: 'get-status' });
    renderStatus(status);
    setMessage(
      status.configError || '',
      status.configError ? 'error' : 'muted',
    );
  } catch (error) {
    setMessage(getErrorMessage(error), 'error');
  } finally {
    setBusy(false);
  }
}

async function saveCurrentSettings(): Promise<void> {
  setBusy(true);
  setMessage('Saving...', 'muted');

  try {
    await autoSaveTask;

    const status = await sendMessage<StatusResponse>({
      settings: collectSettings(),
      type: 'save-settings',
    });

    renderStatus(status);

    if (status.configError) {
      setMessage(status.configError, 'error');
      return;
    }

    setMessage('Saved.', 'success');
  } catch (error) {
    setMessage(getErrorMessage(error), 'error');
  } finally {
    setBusy(false);
  }
}

function queueControlSettingsSave(): void {
  setMessage('Applying...', 'muted');

  autoSaveTask = autoSaveTask.catch(() => undefined).then(saveControlSettings);
}

async function saveControlSettings(): Promise<void> {
  try {
    const status = await sendMessage<StatusResponse>({
      settings: collectControlSettings(),
      type: 'save-settings',
    });

    renderStatus(status, { updateInputs: false });

    if (status.configError) {
      setMessage(status.configError, 'error');
      return;
    }

    setMessage('Applied.', 'success');
  } catch (error) {
    setMessage(getErrorMessage(error), 'error');
  }
}

async function randomizeHash(): Promise<void> {
  elements.randomizeHash.disabled = true;
  setMessage('Randomizing hash...', 'muted');

  try {
    const response = await sendMessage<RandomizeHashResponse>({
      type: 'randomize-hash',
    });

    currentHashSalt = response.hashSalt;
    savedSettings = normalizeSettings({
      ...savedSettings,
      hashSalt: response.hashSalt,
    });
    renderTemplateValues(currentCookieStoreId, collectSettings());
    setMessage('Hash randomized.', 'success');
  } catch (error) {
    setMessage(getErrorMessage(error), 'error');
  } finally {
    elements.randomizeHash.disabled = false;
  }
}

async function openIpCheckSite(): Promise<void> {
  elements.openIpCheck.disabled = true;

  try {
    await sendMessage<void>({ type: 'open-ip-check' });
  } catch (error) {
    setMessage(getErrorMessage(error), 'error');
  } finally {
    elements.openIpCheck.disabled = false;
  }
}

function renderStatus(
  status: StatusResponse,
  options: { updateInputs?: boolean } = {},
): void {
  const settings = normalizeSettings(status.settings || DEFAULT_SETTINGS);
  const updateInputs = options.updateInputs ?? true;
  savedSettings = settings;
  currentCookieStoreId = status.cookieStoreId;
  currentHashSalt = settings.hashSalt;

  elements.enabled.checked = settings.enabled;
  elements.bypassLocal.checked = settings.bypassLocal;
  elements.directNonContainer.checked = settings.directNonContainer;
  elements.disableWebRtc.checked = settings.disableWebRtc;

  if (updateInputs) {
    elements.proxyUrlTemplate.value = settings.proxyUrlTemplate;
    elements.sessionTemplate.value = settings.sessionTemplate;
  }

  renderTemplateValues(status.cookieStoreId, collectSettings());
  document.body.dataset.enabled = status.enabled ? 'true' : 'false';
}

function renderTemplateValues(
  cookieStoreId: string,
  settings: ProxySettings,
): void {
  const context = createSessionContext(cookieStoreId, settings);

  elements.cookieStoreId.textContent = context.cookieStoreId;
  elements.sessionId.textContent = context.session;
  elements.sessionPreview.textContent = context.session;
  elements.templateContainerId.textContent = context.containerId;
  elements.templateCookieStoreId.textContent = context.cookieStoreId;
  elements.templateContainerSlug.textContent = context.containerSlug;
  elements.templateHash.textContent = context.hash;
  elements.templateHashLong.textContent = context.hash_long;
}

function collectSettings(): ProxySettings {
  return normalizeSettings({
    bypassLocal: elements.bypassLocal.checked,
    disableWebRtc: elements.disableWebRtc.checked,
    directNonContainer: elements.directNonContainer.checked,
    enabled: elements.enabled.checked,
    hashSalt: currentHashSalt,
    proxyDns: true,
    proxyUrlTemplate: elements.proxyUrlTemplate.value,
    sessionTemplate: elements.sessionTemplate.value,
  });
}

function collectControlSettings(): ProxySettings {
  return normalizeSettings({
    ...savedSettings,
    bypassLocal: elements.bypassLocal.checked,
    disableWebRtc: elements.disableWebRtc.checked,
    directNonContainer: elements.directNonContainer.checked,
    enabled: elements.enabled.checked,
    hashSalt: currentHashSalt,
    proxyDns: true,
  });
}

function setBusy(isBusy: boolean): void {
  elements.save.disabled = isBusy;
  elements.randomizeHash.disabled = isBusy;
}

function setMessage(
  message: string,
  tone: 'error' | 'muted' | 'success',
): void {
  elements.message.textContent = message;
  elements.message.dataset.tone = tone;
}

async function sendMessage<T>(message: RuntimeRequest): Promise<T> {
  return browser.runtime.sendMessage(message) as Promise<T>;
}

function query<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);

  if (!element) {
    throw new Error(`Missing element: ${selector}`);
  }

  return element;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
