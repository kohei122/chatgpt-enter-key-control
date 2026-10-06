const { test: base, expect, chromium } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');

const repo = path.resolve(__dirname, '../../..');
const fixtures = path.resolve(__dirname, '../fixtures');

const test = base.extend({
  harness: async ({}, use) => {
    const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'chatgpt-mock-dom-'));
    const extensionPath = path.join(temporaryRoot, 'extension');
    let context;
    let server;
    const errors = [];
    const unexpectedRequests = [];
    try {
      await fs.mkdir(extensionPath);
      // Copy the shipping code and assets verbatim. No copied/reimplemented extension logic.
      const manifest = JSON.parse(await fs.readFile(path.join(repo, 'manifest.json'), 'utf8'));
      expect(manifest.background).toBeUndefined();
      for (const name of ['content.js', 'popup.js', 'popup.html',
        'icon16.png', 'icon48.png', 'icon128.png', '_locales']) {
        await fs.cp(path.join(repo, name), path.join(extensionPath, name), { recursive: true });
      }
      for (const script of manifest.content_scripts) {
        script.matches = ['http://127.0.0.1/*'];
      }
      // Test-only bootstrap gives access to the actual extension's chrome.storage.
      // Production has no service worker; this worker has no keyboard/DOM/send logic.
      manifest.background = { service_worker: 'test-bootstrap.js' };
      await fs.writeFile(path.join(extensionPath, 'test-bootstrap.js'),
        'chrome.runtime.onInstalled.addListener(() => {});\n');
      await fs.writeFile(path.join(extensionPath, 'manifest.json'), JSON.stringify(manifest));

      server = http.createServer(async (request, response) => {
        const name = new URL(request.url, 'http://127.0.0.1').pathname.slice(1);
        if (!/^[a-z-]+\.(html|js|css)$/.test(name)) {
          response.writeHead(404).end();
          return;
        }
        try {
          const body = await fs.readFile(path.join(fixtures, name));
          const type = name.endsWith('.html') ? 'text/html' :
            name.endsWith('.js') ? 'text/javascript' : 'text/css';
          response.writeHead(200, {
            'Content-Type': type + '; charset=utf-8',
            'Cache-Control': 'no-store',
            'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; connect-src 'none'; form-action 'none'; object-src 'none'",
          }).end(body);
        } catch {
          response.writeHead(404).end();
        }
      });
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      });
      const origin = 'http://127.0.0.1:' + server.address().port;
      context = await chromium.launchPersistentContext(path.join(temporaryRoot, 'profile'), {
        channel: 'chromium',
        headless: true,
        args: [
          '--disable-extensions-except=' + extensionPath,
          '--load-extension=' + extensionPath,
          '--disable-background-networking',
          '--no-proxy-server',
          // Only loopback fixture hosts can resolve. No real ChatGPT navigation is used.
          '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
        ],
      });
      await context.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.origin === origin) return route.continue();
        if (url.protocol === 'chrome-extension:') return route.continue();
        unexpectedRequests.push(route.request().url());
        return route.abort('blockedbyclient');
      });
      context.on('weberror', error => errors.push(error.error().message));
      context.on('page', page => {
        page.on('console', message => {
          if (message.type() === 'error') errors.push(message.text());
        });
      });
      const worker = context.serviceWorkers()[0] ||
        await context.waitForEvent('serviceworker');
      expect(worker.url()).toMatch(/^chrome-extension:\/\/[a-p]{32}\/test-bootstrap\.js$/);
      const page = await context.newPage();
      const open = async (name, { mode = 'shift', enabled = true } = {}) => {
        // Existing sanitization of string booleans gives an observable ready signal:
        // content.js sets settingsLoaded before persisting the boolean value.
        await worker.evaluate(async ({ mode, enabled }) => {
          await chrome.storage.local.clear();
          await chrome.storage.local.set({ mode, enabled: String(enabled) });
        }, { mode, enabled });
        await page.goto(origin + '/' + name + '.html');
        await expect(page.locator('html')).toHaveAttribute(
          'data-chatgpt-enter-key-control-initialized', 'true');
        await expect.poll(() => worker.evaluate(async () =>
          (await chrome.storage.local.get('enabled')).enabled)).toBe(enabled);
        await page.bringToFront();
      };
      await use({ page, open, worker });
      expect(errors, 'JavaScript/console errors').toEqual([]);
      expect(unexpectedRequests, 'non-fixture network requests').toEqual([]);
      expect(await context.cookies(), 'no cookies').toEqual([]);
    } finally {
      try {
        if (context) await context.close();
      } finally {
        try {
          if (server) await new Promise((resolve, reject) =>
            server.close(error => error ? reject(error) : resolve()));
        } finally {
          // Only our fresh temporary directory, including Chromium profile, is removed.
          await fs.rm(temporaryRoot, { recursive: true, force: true });
        }
      }
    }
  },
});
module.exports = { test, expect };
