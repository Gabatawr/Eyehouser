import { defineConfig } from 'wxt';

export default defineConfig({
  extensionApi: 'chrome',
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Eyehouser',
    description: 'Universal data collector for competitive analysis',
    permissions: [
      'storage',
      'scripting',
      'tabs',
      'webRequest',
      'activeTab'
    ],
    host_permissions: ['<all_urls>'],
    action: {
      default_title: 'Eyehouser',
      default_icon: '/icons/icon.svg'
    },
    web_accessible_resources: [
      {
        resources: ['content-scripts/interception.js', 'overlay.html'],
        matches: ['<all_urls>']
      }
    ]
  }
});
