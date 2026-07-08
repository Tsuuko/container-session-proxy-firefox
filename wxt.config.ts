import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'Container Session Proxy',
    description: 'Assigns a deterministic proxy session to each Firefox container.',
    permissions: [
      'cookies',
      'privacy',
      'proxy',
      'storage',
      'tabs',
      'webRequest',
      'webRequestBlocking',
      '<all_urls>',
    ],
    browser_action: {
      default_title: 'Container Session Proxy',
    },
    browser_specific_settings: {
      gecko: {
        data_collection_permissions: {
          required: [
            'authenticationInfo',
            'browsingActivity',
            'websiteContent',
          ],
        },
        id: 'container-session-proxy@example.local',
      },
    },
  },
});
