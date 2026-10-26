const { test, expect } = require('./helpers/extension.cjs');

async function count(page) {
  return page.evaluate(() => window.__submitCount);
}
async function newline(page, editor) {
  const sendsBefore = await count(page);
  const newlinesBefore = await page.evaluate(() => window.__newlineCount);
  await editor.fill('first');
  await editor.press('End');
  await editor.press('Enter');
  await page.keyboard.type('second');
  expect(await editor.innerText()).toBe('first\nsecond');
  expect(await count(page)).toBe(sendsBefore);
  expect(await page.evaluate(() => window.__newlineCount)).toBe(newlinesBefore + 1);
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

test('side-chat: two exact eligible editors route newline and one send to the focused form', async ({ harness }) => {
  const { page, open } = harness;
  await open('multiple-composers');
  expect(await page.locator('.ProseMirror[contenteditable="true"][role="textbox"][data-composer-markdown]').count()).toBe(2);
  for (const id of ['editor', 'second-editor', 'editor']) {
    const editor = page.getByTestId(id);
    const before = await count(page);
    await editor.fill('first');
    await editor.press('End');
    await editor.press('Enter');
    await page.keyboard.type('second');
    expect(await editor.innerText()).toBe('first\nsecond');
    expect(await count(page)).toBe(before);
    await editor.press('Shift+Enter');
    expect(await count(page)).toBe(before + 1);
  }
  expect(await page.evaluate(() => window.__submittedForms)).toEqual(['primary-form', 'side-form', 'primary-form']);
});

test('side-chat alone: same observed thread contract works without the primary form', async ({ harness }) => {
  const { page, open } = harness;
  await open('multiple-composers');
  await page.getByTestId('primary-form').evaluate(form => form.remove());
  const editor = page.getByTestId('second-editor');
  await newline(page, editor);
  await editor.press('Shift+Enter');
  expect(await count(page)).toBe(1);
  expect(await page.evaluate(() => window.__submittedForms)).toEqual(['side-form']);
});

test('side-chat: opening, closing, reopening and replacing editors are resolved live', async ({ harness }) => {
  const { page, open } = harness;
  await open('multiple-composers');
  await page.getByTestId('side-form').evaluate(form => {
    window.__sideMarkup = form.outerHTML; form.remove();
  });
  const primary = page.getByTestId('editor');
  await primary.fill('main'); await primary.press('Shift+Enter');
  for (let i = 0; i < 2; i++) {
    await page.evaluate(() => document.body.insertAdjacentHTML('beforeend', window.__sideMarkup));
    const side = page.getByTestId('second-editor');
    await side.fill('side'); await side.press('Shift+Enter');
    await side.evaluate(editor => editor.replaceWith(editor.cloneNode(true)));
    await side.focus(); await side.press('Shift+Enter');
    await page.getByTestId('side-form').evaluate(form => form.remove());
    await primary.focus(); await primary.press('Shift+Enter');
  }
  expect(await page.evaluate(() => window.__submittedForms)).toEqual([
    'primary-form', 'side-form', 'side-form', 'primary-form', 'side-form', 'side-form', 'primary-form'
  ]);
});

test('side-chat: same-form candidates abstain while the other form remains usable', async ({ harness }) => {
  const { page, open } = harness;
  await open('multiple-composers');
  await page.getByTestId('editor').evaluate(editor => {
    const duplicate = editor.cloneNode(true); duplicate.dataset.testid = 'ambiguous-editor';
    editor.parentElement.append(duplicate);
  });
  for (const id of ['editor', 'ambiguous-editor']) {
    await page.getByTestId(id).fill('ambiguous');
    await page.getByTestId(id).press('Shift+Enter');
    expect(await count(page)).toBe(0);
  }
  const side = page.getByTestId('second-editor');
  await newline(page, side); await side.press('Shift+Enter');
  expect(await page.evaluate(() => window.__submittedForms)).toEqual(['side-form']);
});

for (const condition of ['missing', 'multiple', 'foreign', 'disabled', 'hidden', 'unknown']) {
  test('side-chat: unsafe primary ' + condition + ' cannot use the side button', async ({ harness }) => {
    const { page, open } = harness;
    await open('multiple-composers');
    await page.getByTestId('primary-form').evaluate((form, condition) => {
      const button = form.querySelector('button');
      if (condition === 'missing') button.remove();
      if (condition === 'multiple') form.append(button.cloneNode(true));
      if (condition === 'foreign') {
        const side = document.querySelector('[data-testid="side-form"]');
        side.id = 'side-form'; button.setAttribute('form', side.id);
      }
      if (condition === 'disabled') button.disabled = true;
      if (condition === 'hidden') button.hidden = true;
      if (condition === 'unknown') form.removeAttribute('data-thread-find-composer');
    }, condition);
    const primary = page.getByTestId('editor');
    await primary.fill('do not send'); await primary.press('Shift+Enter');
    expect(await count(page)).toBe(0);
    expect(await page.evaluate(() => window.__submittedForms)).toEqual([]);
  });
}

test('side-chat: unrelated ProseMirror never receives extension shortcuts', async ({ harness }) => {
  const { page, open } = harness;
  await open('multiple-composers');
  await page.getByTestId('second-editor').evaluate(editor => editor.removeAttribute('data-composer-markdown'));
  const unrelated = page.getByTestId('second-editor');
  await unrelated.fill('unrelated'); await unrelated.press('Shift+Enter');
  expect(await count(page)).toBe(0);
  expect(await page.evaluate(() => window.__unhandledKeys)).toEqual([
    { shift: true, ctrl: false, meta: false, trusted: true }
  ]);
  expect(await page.evaluate(() => window.__newlineCount)).toBe(1);
  await page.getByTestId('editor').fill('main'); await page.getByTestId('editor').press('Shift+Enter');
  expect(await page.evaluate(() => window.__submittedForms)).toEqual(['primary-form']);
});

test('side-chat: IME activity and focus loss in one editor do not block the other', async ({ harness }) => {
  const { page, open } = harness;
  await open('multiple-composers');
  const primary = page.getByTestId('editor'), side = page.getByTestId('second-editor');
  await primary.fill('main'); await primary.dispatchEvent('compositionstart');
  await primary.press('Shift+Enter'); expect(await count(page)).toBe(0);
  await side.fill('side'); await side.press('Shift+Enter');
  expect(await page.evaluate(() => window.__submittedForms)).toEqual(['side-form']);
  await primary.dispatchEvent('compositionend');
  await page.getByTestId('side-form').evaluate(form => form.remove());
  await primary.focus();
  // Unit tests check the exact 79/80ms boundary; no OS IME is emulated here.
  await expect.poll(() => primary.evaluate(el => el === document.activeElement)).toBe(true);
});

test('side-chat: trusted CRLF paste in each form retains one native Undo and Redo step', async ({ harness }) => {
  const { page, open } = harness;
  await open('multiple-composers', { pasteOrigin: true });
  for (const id of ['editor', 'second-editor']) {
    const editor = page.getByTestId(id);
    await editor.evaluate(el => { el.innerHTML = '<p><br></p>'; });
    await editor.focus(); await editor.press('Control+Home');
    await page.evaluate(() => {
      window.__pastePrevented = null;
      return navigator.clipboard.writeText('first\r\nsecond');
    });
    await editor.press('Control+v');
    await expect.poll(() => page.evaluate(() => window.__pastePrevented)).toBe(true);
    expect(await page.evaluate(() => [window.__pasteTrusted, window.__pasteHasCRLF])).toEqual([true, true]);
    expect(await editor.evaluate(el => el.textContent.includes('\r'))).toBe(false);
    expect(await editor.locator('p').allTextContents()).toEqual(['first', 'second']);
    await editor.press('Control+z'); expect(await editor.textContent()).toBe('');
    await editor.press('Control+y');
    expect(await editor.locator('p').allTextContents()).toEqual(['first', 'second']);
  }
  expect(await count(page)).toBe(0);
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
