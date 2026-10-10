const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('./helpers/extension.cjs');

const repo = path.resolve(__dirname, '../..');
const version = JSON.parse(fs.readFileSync(path.join(repo, 'manifest.json'), 'utf8')).version;

for (const lang of ['en', 'ja', 'ko', 'zh_CN', 'zh_TW', 'es', 'pt_BR']) {
  test('popup ' + lang + ': layout, language, link and settings persist', async ({ harness }, testInfo) => {
    const { page, open, worker } = harness;
    await open('home-composer', { mode: 'ctrl' });
    const homeUrl = page.url();
    await page.setViewportSize({ width: 220, height: 600 });
    await page.goto(worker.url().replace('test-bootstrap.js', 'popup.html'));
    const details = page.locator('#secondary-toggle');
    const content = page.locator('#secondary-content');
    const language = page.locator('#language-select');
    const toggle = page.locator('#toggle');
    const ctrl = page.locator('input[name="mode"][value="ctrl"]');
    const combo = page.locator('input[name="mode"][value="combo"]');
    await expect(ctrl).toBeChecked();
    await expect(toggle).toBeChecked();
    await expect(details).toHaveAttribute('aria-expanded', 'false');
    await expect(content).toBeHidden();
    await details.click();
    await expect(details).toHaveAttribute('aria-expanded', 'true');
    await expect(details).toBeHidden();
    await expect(content).toBeVisible();
    await language.selectOption(lang);

    const messages = JSON.parse(fs.readFileSync(path.join(repo, '_locales', lang, 'messages.json'), 'utf8'));
    await expect(language).toHaveValue(lang);
    await expect(details.locator('[data-i18n="detailsLabel"]')).toHaveText(messages.detailsLabel.message);
    await expect(details.locator('[aria-hidden="true"]')).toHaveText('▼');
    await expect(page.locator('#app-version')).toHaveText('v' + version);
    for (const [id, key] of [['app-header', 'appNameShort'], ['label-enable-enter-control', 'enableEnterControl'],
      ['title-send-key', 'sendKey'], ['language-setting-label', 'languageSetting'], ['other-extensions-link', 'otherExtensions']]) {
      await expect(page.locator('#' + id)).toHaveText(messages[key].message);
    }
    for (const [mode, key] of [['shift', 'modeShift'], ['ctrl', 'modeCtrl'], ['both', 'modeBoth'], ['combo', 'modeCombo']]) {
      await expect(page.locator('label').filter({ has: page.locator('input[value="' + mode + '"]') }).locator('span')).toHaveText(messages[key].message);
    }
    await expect(page.locator('input[name="mode"]')).toHaveCount(4);
    await expect(content).toBeHidden(); // Reload starts with the existing collapsed state.
    await details.click();
    await expect(content).toHaveCSS('opacity', '1');
    const layout = await page.evaluate(() => {
      const rect = id => document.getElementById(id).getBoundingClientRect();
      const footer = document.querySelector('.popup-footer').getBoundingClientRect();
      const link = rect('other-extensions-link'), version = rect('app-version');
      return {
        sameRow: Math.abs(link.top - version.top) < 5,
        rightAligned: Math.abs(version.right - footer.right) < 1,
        noOverlap: link.right <= version.left,
        noOverflow: document.body.scrollWidth <= document.body.clientWidth &&
          rect('language-select').right <= document.body.clientWidth,
        noClipping: document.getElementById('secondary-content').scrollHeight <= rect('secondary-content').height + 1,
      };
    });
    expect(layout).toEqual({ sameRow: true, rightAligned: true, noOverlap: true, noOverflow: true, noClipping: true });
    await page.screenshot({ path: testInfo.outputPath('popup-' + lang + '.png') });

    // Observe the actual link handler's API call without navigating to the external store.
    await page.evaluate(() => {
      window.__openedUrls = [];
      chrome.tabs.create = options => window.__openedUrls.push(options.url);
    });
    await page.locator('#other-extensions-link').click();
    expect(await page.evaluate(() => window.__openedUrls)).toEqual([
      'https://chromewebstore.google.com/search/(by%20marusin)?hl=ja&authuser=0',
    ]);
    await toggle.uncheck();
    await combo.check();
    await expect.poll(() => worker.evaluate(async () => {
      const { enabled, mode } = await chrome.storage.local.get(['enabled', 'mode']);
      return { enabled, mode };
    })).toEqual({ enabled: false, mode: 'combo' });
    await page.reload();
    await expect(toggle).not.toBeChecked();
    await expect(combo).toBeChecked();
    await expect(language).toHaveValue(lang);
    await expect(details.locator('[data-i18n="detailsLabel"]')).toHaveText(messages.detailsLabel.message);
    await toggle.check();
    await ctrl.check();
    await expect.poll(() => worker.evaluate(async () => {
      const { enabled, mode } = await chrome.storage.local.get(['enabled', 'mode']);
      return { enabled, mode };
    })).toEqual({ enabled: true, mode: 'ctrl' });
    await page.goto(homeUrl);
    const editor = page.getByTestId('editor');
    await editor.fill('draft');
    await editor.press('Enter');
    await page.keyboard.type('second');
    expect(await editor.innerText()).toBe('draft\nsecond');
    await editor.press('Control+Enter');
    expect(await page.evaluate(() => window.__submitCount)).toBe(1);
  });
}
