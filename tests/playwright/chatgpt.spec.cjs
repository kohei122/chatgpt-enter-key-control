const { test, expect } = require('./helpers/extension.cjs');

async function count(page) {
  return page.evaluate(() => window.__submitCount);
}
async function newline(page, editor) {
  await editor.fill('first');
  await editor.press('End');
  await editor.press('Enter');
  await page.keyboard.type('second');
  expect(await editor.innerText()).toBe('first\nsecond');
  expect(await count(page)).toBe(0);
  expect(await page.evaluate(() => window.__newlineCount)).toBe(1);
}

for (const name of ['old-composer', 'current-composer', 'home-composer', 'stale-composer']) {
  test(name + ': Enter newline, Shift+Enter sends exactly once', async ({ harness }) => {
    const { page, open } = harness;
    await open(name);
    const editor = page.getByTestId('editor');
    if (name === 'stale-composer') {
      expect(await page.getByTestId('stale').evaluate(el => {
        const r = el.getBoundingClientRect(); return [r.width, r.height];
      })).toEqual([0, 0]);
    }
    await newline(page, editor);
    await editor.press('Shift+Enter');
    expect(await count(page)).toBe(1);
    expect(await editor.innerText()).toBe('first\nsecond');
  });
}

for (const [mode, key] of [['ctrl', 'Control+Enter'], ['both', 'Control+Enter'],
  ['combo', 'Control+Shift+Enter']]) {
  test(mode + ': configured Windows shortcut sends once', async ({ harness }) => {
    const { page, open } = harness;
    await open('current-composer', { mode });
    const editor = page.getByTestId('editor');
    await newline(page, editor);
    await editor.press(key);
    expect(await count(page)).toBe(1);
  });
}

for (const name of ['no-submitter', 'multiple-submitters', 'unknown-form']) {
  test(name + ': preserve newline and fail closed on send', async ({ harness }) => {
    const { page, open } = harness;
    await open(name);
    const editor = page.getByTestId('editor');
    await newline(page, editor);
    await editor.press('Shift+Enter');
    expect(await count(page)).toBe(0);
  });
}

test('multiple visible composers: focused editor does not resolve ambiguity', async ({ harness }) => {
  const { page, open } = harness;
  await open('multiple-composers');
  for (const id of ['editor', 'second-editor']) {
    const editor = page.getByTestId(id);
    await editor.fill('ambiguous');
    await editor.press('Shift+Enter');
    expect(await count(page)).toBe(0);
  }
  // The extension abstains; it does not promise to suppress the host page's own sends.
});

test('only a zero-size stale composer: trusted shortcut does not send', async ({ harness }) => {
  const { page, open } = harness;
  await open('stale-only');
  const stale = page.getByTestId('stale');
  expect(await stale.evaluate(el => {
    const r = el.getBoundingClientRect(); el.focus(); return [r.width, r.height];
  })).toEqual([0, 0]);
  await expect(stale).toBeFocused();
  await page.keyboard.press('Shift+Enter');
  expect(await count(page)).toBe(0);
});

for (const condition of ['disabled', 'hidden', 'aria-disabled', 'transparent']) {
  test('submitter ' + condition + ': fail closed', async ({ harness }) => {
    const { page, open } = harness;
    await open('current-composer');
    await page.locator('button').evaluate((button, condition) => {
      if (condition === 'disabled') button.disabled = true;
      if (condition === 'hidden') button.hidden = true;
      if (condition === 'aria-disabled') button.setAttribute('aria-disabled', 'true');
      if (condition === 'transparent') button.style.opacity = '0';
    }, condition);
    const editor = page.getByTestId('editor');
    await newline(page, editor);
    await editor.press('Shift+Enter');
    expect(await count(page)).toBe(0);
  });
}

test('composition state prevents shortcut sending; not a native IME emulator', async ({ harness }) => {
  const { page, open } = harness;
  await open('current-composer');
  const editor = page.getByTestId('editor');
  await editor.fill('composing');
  await editor.dispatchEvent('compositionstart', { data: '' });
  await editor.press('Enter');
  await editor.press('Shift+Enter');
  expect(await count(page)).toBe(0);
  await editor.dispatchEvent('compositionend', { data: '' });
  // The exact 80ms grace boundary and keyCode 229 are covered by existing unit tests.
});

test('unapproved shortcut does not send', async ({ harness }) => {
  const { page, open } = harness;
  await open('current-composer');
  const editor = page.getByTestId('editor');
  await editor.fill('draft');
  await editor.press('Control+Enter');
  expect(await count(page)).toBe(0);
  expect(await editor.innerText()).toBe('draft');
});

test('negative control: disabled extension leaves page Enter send and Shift newline', async ({ harness }) => {
  const { page, open } = harness;
  await open('current-composer', { enabled: false });
  const editor = page.getByTestId('editor');
  await editor.fill('draft');
  await editor.press('Enter');
  expect(await count(page)).toBe(1);
  await editor.press('Shift+Enter');
  expect(await count(page)).toBe(1);
  expect(await page.evaluate(() => window.__newlineCount)).toBe(1);
});
