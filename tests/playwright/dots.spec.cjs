const { test, expect } = require('./helpers/extension.cjs');

for (const [mode, shortcut] of [['shift', 'Shift+Enter'], ['ctrl', 'Control+Enter'],
  ['both', 'Shift+Enter'], ['combo', 'Control+Shift+Enter']]) {
  test('Dots mock: newline and one send with ' + mode, async ({ harness: { page, open } }) => {
    await open('dots-composer', { dotsOrigin: true, mode });
    const editor = page.getByTestId('editor');
    await editor.fill('first'); await editor.press('End'); await editor.press('Enter');
    await page.keyboard.type('second');
    expect(await editor.innerText()).toBe('first\nsecond');
    expect(await page.evaluate(() => window.__submitCount)).toBe(0);
    await editor.press(shortcut);
    expect(await page.evaluate(() => [window.__submitCount, window.__otherClicks])).toEqual([1, 0]);
  });
}

for (const reason of ['missing', 'multiple', 'disabled', 'aria-disabled', 'hidden', 'opacity',
  'empty', 'multiple-editors', 'outside-button', 'unknown-fragment']) {
  test('Dots mock: no send when ' + reason, async ({ harness: { page, open } }) => {
    await open('dots-composer', { dotsOrigin: true });
    const editor = page.getByTestId('editor');
    await editor.fill(reason === 'empty' ? '' : 'message');
    await page.evaluate(reason => {
      const button = document.querySelector('[data-testid="send"]');
      const editor = document.querySelector('[data-testid="editor"]');
      if (reason === 'missing') button.remove();
      if (reason === 'multiple') button.parentElement.append(button.cloneNode(true));
      if (reason === 'disabled') button.disabled = true;
      if (reason === 'aria-disabled') button.setAttribute('aria-disabled', 'true');
      if (reason === 'hidden') button.hidden = true;
      if (reason === 'opacity') button.parentElement.style.opacity = '0';
      if (reason === 'multiple-editors') editor.parentElement.append(editor.cloneNode(true));
      if (reason === 'outside-button') document.body.append(button);
      if (reason === 'unknown-fragment') button.querySelector('use').setAttribute('href', '#unknown');
    }, reason);
    await editor.first().press('Shift+Enter');
    expect(await page.evaluate(() => [window.__submitCount, window.__otherClicks])).toEqual([0, 0]);
  });
}

test('Dots mock: composition, repeat and DOM replacement', async ({ harness: { page, open } }) => {
  await open('dots-composer', { dotsOrigin: true });
  const editor = page.getByTestId('editor');
  await editor.fill('message');
  await editor.dispatchEvent('compositionstart');
  await editor.press('Shift+Enter');
  expect(await page.evaluate(() => window.__submitCount)).toBe(0);
  await editor.dispatchEvent('compositionend');
  // Exact 80ms boundary and keyCode 229 are tested deterministically in the VM.
  await editor.evaluate(el => el.replaceWith(el.cloneNode(true)));
  await editor.focus();
  await page.keyboard.down('Shift'); await page.keyboard.down('Enter');
  await page.keyboard.down('Enter'); await page.keyboard.up('Enter'); await page.keyboard.up('Shift');
  expect(await page.evaluate(() => window.__submitCount)).toBe(1);
});

test('Dots mock: OFF preserves host behavior', async ({ harness: { page, open } }) => {
  await open('dots-composer', { dotsOrigin: true, enabled: false });
  const editor = page.getByTestId('editor');
  await editor.fill('message'); await editor.press('Enter');
  expect(await page.evaluate(() => window.__submitCount)).toBe(1);
  await editor.press('Shift+Enter');
  expect(await page.evaluate(() => [window.__submitCount, window.__newlineCount])).toEqual([1, 1]);
});

test('Dots mock: identical DOM outside Dots cannot use the new send route', async ({ harness: { page, open } }) => {
  await open('dots-composer', { pasteOrigin: true });
  const editor = page.getByTestId('editor');
  await editor.fill('message'); await editor.press('Shift+Enter');
  expect(await page.evaluate(() => window.__submitCount)).toBe(0);
});


// Hypothetical language/layout/auxiliary variations. Only the base structure
// and send fragment are observed; English and stop UI are not real captures.
for (const variant of ['Japanese', 'English', 'none', 'arbitrary', 'sprite-hash',
  'auxiliary-removed', 'auxiliary-added', 'auxiliary-attributes', 'hidden-home', 'multiline-narrow']) {
  test('Dots resilience: successful send with ' + variant, async ({ harness: { page, open } }) => {
    await open('dots-composer', { dotsOrigin: true });
    if (variant === 'sprite-hash') await page.route('https://chatgpt.com/cdn/assets/changed.svg', route =>
      route.fulfill({contentType:'image/svg+xml', body:'<svg xmlns="http://www.w3.org/2000/svg"><symbol id="codex-icon-arrow-up-lg-light-20"/></svg>'}));
    await page.evaluate(variant => {
      const footer = document.querySelector('[data-testid="container"]');
      const buttons = footer.querySelectorAll('button');
      if (variant === 'Japanese' || variant === 'English' || variant === 'arbitrary') {
        const labels = variant === 'Japanese' ? ['ファイルなどを追加', '音声入力', '送信'] :
          variant === 'English' ? ['Add files', 'Dictation', 'Send'] : ['一', 'Deux', '任意'];
        buttons.forEach((button, i) => { button.setAttribute('aria-label', labels[i]); button.title = labels[i]; });
      }
      if (variant === 'sprite-hash') buttons[2].querySelector('use').setAttribute('href', '/cdn/assets/changed.svg#codex-icon-arrow-up-lg-light-20');
      if (variant === 'auxiliary-removed') { buttons[0].remove(); buttons[1].remove(); }
      if (variant === 'auxiliary-added') {
        const extra = document.createElement('button'); extra.type='button'; extra.textContent='Other'; footer.prepend(extra);
        const file = document.createElement('input'); file.type='file'; file.hidden=true; footer.append(file);
      }
      if (variant === 'auxiliary-attributes') { buttons[0].removeAttribute('data-composer-navigation-target'); buttons[1].removeAttribute('aria-busy'); }
      if (variant === 'hidden-home') {
        const home = document.querySelector('[data-testid="editor"]').cloneNode(true);
        home.dataset.testid='home'; home.hidden=true; document.body.prepend(home);
      }
      if (variant === 'multiline-narrow') footer.setAttribute('data-composer-layout', 'multi-line');
    }, variant);
    if (variant === 'multiline-narrow') await page.setViewportSize({width:360,height:640});
    const editor = page.getByTestId('editor');
    await editor.fill('first\nsecond'); await editor.press('Shift+Enter');
    expect(await page.evaluate(() => [window.__submitCount,window.__otherClicks])).toEqual([1,0]);
  });
}

for (const fragment of ['hypothetical-stop', 'arrow', 'codex-icon-arrow-up-lg-light-20-stop',
  'stop-codex-icon-arrow-up-lg-light-20']) {
  test('Dots hypothetical stop in same button position: ' + fragment, async ({ harness: { page, open } }) => {
    await open('dots-composer', { dotsOrigin:true });
    const editor = page.getByTestId('editor'); await editor.fill('message');
    await page.getByTestId('send').evaluate((button, fragment) => button.querySelector('use').setAttribute('href','#'+fragment),fragment);
    await editor.press('Shift+Enter');
    expect(await page.evaluate(() => [window.__submitCount,window.__otherClicks])).toEqual([0,0]);
  });
}

test('Dots resilience: independent composers and focus switches', async ({ harness: { page, open } }) => {
  await open('dots-composer', {dotsOrigin:true});
  await page.getByTestId('container').evaluate(footer => {
    const second=footer.cloneNode(true); second.id='secondary'; second.dataset.testid='secondary';
    second.querySelector('[data-testid="editor"]').dataset.testid='second-editor'; footer.parentElement.append(second);
  });
  const first=page.getByTestId('editor'), second=page.getByTestId('second-editor');
  await first.fill('first'); await first.press('Shift+Enter');
  await second.fill('second'); await second.press('Shift+Enter');
  await first.focus(); await first.press('Shift+Enter');
  expect(await page.evaluate(() => window.__clickedComposers)).toEqual(['primary','secondary','primary']);
  expect(await page.evaluate(() => window.__otherClicks)).toBe(0);
});

test('Dots resilience: inert and detached editor never send', async ({ harness: { page, open } }) => {
  await open('dots-composer', {dotsOrigin:true});
  const editor=page.getByTestId('editor'); await editor.fill('message');
  await page.getByTestId('container').evaluate(footer => footer.inert=true);
  await page.keyboard.press('Shift+Enter');
  await page.getByTestId('container').evaluate(footer => footer.inert=false);
  await editor.focus(); await editor.evaluate(el => el.remove());
  await page.keyboard.press('Shift+Enter');
  expect(await page.evaluate(() => window.__submitCount)).toBe(0);
});
