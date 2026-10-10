const { test: nodeTest } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../content.js'), 'utf8');

// Deterministic event/DOM test doubles. These do NOT emulate ProseMirror, native Undo, or IME.
class Target {
  constructor() { this.listeners = new Map(); }
  addEventListener(t, f) { if (!this.listeners.has(t)) this.listeners.set(t, []); this.listeners.get(t).push(f); }
  removeEventListener(t, f) { this.listeners.set(t, (this.listeners.get(t) || []).filter(x => x !== f)); }
  fire(t, e) { for (const f of [...(this.listeners.get(t) || [])]) { f(e); if (e.immediate) break; } }
  listenerCount() { return [...this.listeners.values()].reduce((n, a) => n + a.length, 0); }
}
class Element extends Target {
  constructor(tag, attrs = {}) {
    super(); this.nodeType = 1; this.tagName = tag; this.attrs = attrs;
    this.childNodes = []; this.parentNode = null; this.isConnected = true; this.isContentEditable = true;
    this.classList = { contains: s => (this.attrs.class || '').split(' ').includes(s) };
  }
  get parentElement() { return this.parentNode?.nodeType === 1 ? this.parentNode : null; }
  get form() { return this.formOverride !== undefined ? this.formOverride : this.closest('form'); }
  getClientRects() { return this.noRect ? [] : [this.getBoundingClientRect()]; }
  getBoundingClientRect() { return { x: 863, y: 1210, width: 524, height: 36, ...this.rect }; }
  matches(selector) {
    return selector.split(',').some(part => {
      if (part.trim() === ':disabled') return !!this.disabled || !!this.closest('fieldset[disabled]');
      let ok = true;
      const rest = part.trim().replace(/#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:="([^"]*)")?\]/g,
        (_, id, cls, attr, value) => {
          ok = ok && (id ? this.id === id : cls ? this.classList.contains(cls)
            : value === undefined ? this.hasAttribute(attr) : this.getAttribute(attr) === value);
          return '';
        });
      assert.match(rest, /^[a-z]*$/i, `Unsupported fixture selector: ${part}`);
      return ok && (!rest || this.tagName === rest.toUpperCase());
    });
  }
  closest(selector) {
    for (let node = this; node; node = node.parentElement) if (node.matches(selector)) return node;
    return null;
  }
  querySelectorAll(selector) {
    const found = [];
    const visit = node => {
      for (const child of node.childNodes || []) {
        if (child.nodeType === 1 && child.isConnected && child.matches(selector)) found.push(child);
        visit(child);
      }
    };
    visit(this); return found;
  }
  get id() { return this.attrs.id || ''; }
  get firstChild() { return this.childNodes[0]; }
  get textContent() { return this.childNodes.map(n => n.textContent).join(''); }
  get attributes() { return Object.entries(this.attrs).map(([name, value]) => ({ name, value })); }
  getAttribute(n) { return this.attrs[n] ?? null; }
  hasAttribute(n) { return n in this.attrs; }
  setAttribute(n, v) { this.attrs[n] = v; }
  contains(n) { return n === this || this.childNodes.some(c => c.contains(n)); }
  append(n) { n.parentNode = this; this.childNodes.push(n); return n; }
}
class Text {
  constructor(data) { this.nodeType = 3; this.data = data; this.isConnected = true; }
  get length() { return this.data.length; }
  get textContent() { return this.data; }
  contains(n) { return this === n; }
}

// Keep all existing DOM regressions and add the Work home form observed on 2026-10-08.
for (const dom of ['legacy', 'modern', 'thread-chat', 'thread-work', 'home-work']) {
const test = (name, fn) => nodeTest(`${dom}: ${name}`, fn);
async function setup(extensionEnabled = true, os = 'win', mode = 'shift', extraStored = {}) {
  const document = new Target(), window = new Target();
  const html = new Element('HTML'), body = html.append(new Element('BODY'));
  const form = dom !== 'legacy' ? body.append(new Element('FORM', dom === 'modern'
    ? { 'data-chatgpt-composer': '', 'data-composer-placement': 'thread' }
    : { 'data-composer-placement': dom === 'home-work' ? 'home' : 'thread',
        'data-thread-find-composer': 'true' })) : null;
  const root = (form || body).append(new Element('DIV', dom === 'legacy'
    ? { id: 'prompt-textarea', contenteditable: 'true', class: 'ProseMirror' }
    : { contenteditable: 'true', 'aria-multiline': 'true', dir: 'auto', role: 'textbox',
        spellcheck: 'true', translate: 'no', class: 'ProseMirror',
        'data-composer-markdown': '', 'data-virtualkeyboard': 'true' }));
  root.append(new Element('P', { dir: 'auto' })).append(new Element('BR', { class: 'ProseMirror-trailingBreak' }));
  let selection = { rangeCount: 1, isCollapsed: true, anchorNode: root.firstChild, focusNode: root.firstChild, anchorOffset: 0, focusOffset: 0 };
  let now = 1000, serial = 0;
  const timers = new Map(), output = [], changes = [];
  document.documentElement = html; document.activeElement = root; document.visibilityState = 'visible';
  document.hasFocus = () => true; document.getElementById = () => body.childNodes.find(n => n.id === 'prompt-textarea') || null;
  document.querySelectorAll = selector => html.querySelectorAll(selector);
  window.getComputedStyle = node => ({ display: 'block', visibility: 'visible', opacity: '1', ...node.style });
  const submissions = [], clicks = [];
  const button = form ? form.append(new Element('BUTTON', { type: 'submit' })) : null;
  if (button) {
    // Model button activation, not ChatGPT internals. The submit listener is the app boundary.
    form.addEventListener('submit', e => submissions.push({ submitter: e.submitter, text: root.textContent }));
    button.click = () => { clicks.push(button); form.fire('submit', { submitter: button }); };
    for (let i = 0; i < 3; i++) {
      const other = form.append(new Element('BUTTON', { type: 'button' }));
      other.click = () => assert.fail('Unrelated button clicked');
    }
    form.submit = form.requestSubmit = () => assert.fail('Direct form submission must not be used');
  }
  window.getSelection = () => selection;
  const stored = { enabled: extensionEnabled, mode, ...extraStored };
  const context = vm.createContext({ window, document, location: { href: 'https://chatgpt.com/' },
    performance: { now: () => now }, console: { info: (...a) => output.push(a), warn: (...a) => output.push(a) },
    chrome: { runtime: { getPlatformInfo: cb => cb({ os }) }, storage: {
      local: { get: (defaults, cb) => cb({ ...defaults, ...stored }), set: () => {} },
      onChanged: { addListener: f => changes.push(f) }
    } },
    setTimeout: (f, ms) => { const id = ++serial; timers.set(id, { f, at: now + ms }); return id; },
    clearTimeout: id => timers.delete(id),
    KeyboardEvent: class { constructor(type, options) { Object.assign(this, options, { type, isTrusted: false }); } }
  });
  vm.runInContext(source, context);
  await new Promise(resolve => setImmediate(resolve));
  const baseline = document.listenerCount();
  const windowBaseline = window.listenerCount();
  function event(type, extra = {}) {
    const e = { type, target: root, isTrusted: true, isComposing: false, cancelable: true, defaultPrevented: false,
      preventDefault() { this.prevented = true; this.defaultPrevented = true; }, stopImmediatePropagation() { this.immediate = true; }, ...extra };
    window.fire(type, e); if (!e.immediate) document.fire(type, e); return e;
  }
  function populate(lines = ['abc', 'def']) {
    root.childNodes = [];
    const nodes = lines.map(s => root.append(new Element('P', { dir: 'auto' })).append(new Text(s)));
    const last = nodes.at(-1);
    selection = { rangeCount: 1, isCollapsed: true, anchorNode: last, focusNode: last, anchorOffset: last.length, focusOffset: last.length };
    return nodes;
  }
  function paste(text = 'abc\r\ndef', overrides = {}) {
    return event('paste', { clipboardData: { files: [], items: [{ kind: 'string', type: 'text/plain' }], types: ['text/plain'], getData: () => text, ...overrides } });
  }
  function frame(ms = 16) {
    now += ms;
    for (const [id, t] of [...timers]) if (now >= t.at) { timers.delete(id); t.f(); }
  }
  function clean() {
    assert.equal(timers.size, 0); assert.equal(window.listenerCount(), windowBaseline);
    assert.deepEqual(output, []);
    assert.equal(document.listenerCount(), baseline);
  }
  const commands = [];
  document.execCommand = (command, ui, text) => {
    commands.push({ command, ui, text }); populate(text.split('\n')); return true;
  };
  return { root, body, form, button, submissions, clicks, document, window, output, context, baseline, event, populate, paste, frame, clean, commands,
    resetEmpty() {
      root.childNodes = [];
      const p = root.append(new Element('P', { dir: 'auto' }));
      p.append(new Element('BR', { class: 'ProseMirror-trailingBreak' }));
      document.activeElement = root;
      selection = { rangeCount: 1, isCollapsed: true, anchorNode: p, focusNode: p, anchorOffset: 0, focusOffset: 0 };
    },
    change(key, value) { stored[key] = value; changes.forEach(f => f({ [key]: { newValue: value } }, 'local')); },
    setSelection(s) { selection = s; }
  };
}


function assertSkipped(h, e) {
  assert.equal(e.prevented, undefined);
  assert.equal(e.immediate, undefined);
  assert.equal(h.commands.length, 0);
  h.clean();
}

test('enabled by the extension setting only; disabled extension leaves paste untouched', async () => {
  const h = await setup(false); assertSkipped(h, h.paste());
  h.change('enabled', true); h.paste(); assert.equal(h.commands.length, 1); h.frame(500); h.clean();
});

test('normalization inserts exactly once, blocks downstream paste, and allows a later fresh paste', async () => {
  const h = await setup();
  let downstream = 0;
  const listener = () => downstream++;
  h.document.addEventListener('paste', listener);
  const e = h.paste('private-one\r\nprivate-two');
  assert.equal(e.defaultPrevented, true); assert.equal(e.immediate, true); assert.equal(downstream, 0);
  assert.deepEqual(h.commands, [{ command: 'insertText', ui: false, text: 'private-one\nprivate-two' }]);
  h.window.fire('paste', e); assert.equal(h.commands.length, 1);
  h.frame(500); h.document.removeEventListener('paste', listener); h.clean();
  h.resetEmpty(); h.paste(); h.frame(500); assert.equal(h.commands.length, 2); h.clean();
});

test('single line, URL, LF, lone CR, mixed EOL, blanks, rich content, files and limits are untouched', async () => {
  const cases = [
    ['abc', {}], ['https://example.com/', {}], ['abc\ndef', {}], ['abc\rdef', {}],
    ['abc\r\ndef\nghi', {}], ['abc\r\n\r\ndef', {}], ['abc\r\n \r\ndef', {}],
    ['abc\r\ndef\r\n', {}], ['a\r\n'.repeat(20) + 'a', {}], ['a'.repeat(8000) + '\r\nb', {}],
    ['abc\r\ndef', { types: ['text/plain', 'text/html'] }], ['abc\r\ndef', { files: [{}] }],
    ['abc\r\ndef', { items: [{ kind: 'file', type: 'image/png' }] }],
    ['abc\r\ndef', { items: [{ kind: 'string', type: 'text/html' }] }],
    ['abc\r\ndef', { getData: () => { throw Error('private clipboard content'); } }]
  ];
  for (const [text, data] of cases) { const h = await setup(); assertSkipped(h, h.paste(text, data)); }
});

test('20 lines and 8000 characters are accepted at the supported boundaries', async () => {
  for (const text of ['a\r\n'.repeat(19) + 'a', 'a'.repeat(7997) + '\r\nb']) {
    const h = await setup(); h.paste(text); h.frame(500);
    assert.equal(h.commands.length, 1); assert.equal(h.commands[0].text.includes('\r'), false); h.clean();
  }
});

test('only observed empty paragraph shapes are eligible, including placeholder and trailingBreak', async () => {
  for (const form of ['normal', 'placeholder', 'bare-br', 'empty-p', 'empty-text']) {
    const h = await setup(), p = h.root.firstChild;
    if (form === 'placeholder' || form === 'bare-br') {
      p.attrs = { 'data-empty-paragraph': 'true', 'data-placeholder': 'private label', class: 'placeholder' };
    }
    if (form === 'bare-br') p.firstChild.attrs = {};
    if (form === 'empty-p') p.childNodes = [];
    if (form === 'empty-text') { p.childNodes = []; p.append(new Text('')); }
    h.paste(); assert.equal(h.commands.length, 1, form); h.frame(500); h.clean();
  }
});

test('nonempty, unknown empty structure, focus and selection failures do not intervene', async () => {
  for (const reason of ['real-text', 'space', 'zero-width', 'attribute', 'class', 'noneditable', 'image',
    'two-p', 'blurred', 'outside-focus', 'child-focus', 'null-selection', 'zero-ranges', 'no-anchor',
    'outside-anchor', 'outside-focus-node', 'expanded', 'two-ranges']) {
    const h = await setup(), p = h.root.firstChild;
    if (reason === 'real-text') h.populate(['private composer body']);
    if (reason === 'space') h.populate([' ']);
    if (reason === 'zero-width') h.populate(['\u200b']);
    if (reason === 'attribute') p.setAttribute('data-other', 'private attribute');
    if (reason === 'class') p.setAttribute('class', 'unknown');
    if (reason === 'noneditable') p.isContentEditable = false;
    if (reason === 'image') { p.childNodes = []; p.append(new Element('IMG')); }
    if (reason === 'two-p') h.root.append(new Element('P'));
    if (reason === 'blurred') h.document.hasFocus = () => false;
    if (reason === 'outside-focus') h.document.activeElement = h.body;
    if (reason === 'child-focus') h.document.activeElement = p;
    const s = { rangeCount: 1, isCollapsed: true, anchorNode: p, focusNode: p, anchorOffset: 0, focusOffset: 0 };
    if (reason === 'null-selection') h.setSelection(null);
    if (reason === 'zero-ranges') h.setSelection({ rangeCount: 0 });
    if (reason === 'no-anchor') h.setSelection({ ...s, anchorNode: null });
    if (reason === 'outside-anchor') h.setSelection({ ...s, anchorNode: h.body });
    if (reason === 'outside-focus-node') h.setSelection({ ...s, focusNode: h.body });
    if (reason === 'expanded') h.setSelection({ ...s, isCollapsed: false });
    if (reason === 'two-ranges') h.setSelection({ ...s, rangeCount: 2 });
    assertSkipped(h, h.paste());
  }
});

test('URL, composer, trusted event, cancellation and API guards are preserved', async () => {
  for (const reason of ['url', 'outside', 'detached', 'class', 'editable', 'untrusted', 'cancelable', 'prevented', 'api']) {
    const h = await setup();
    if (reason === 'url') h.context.location.href = 'https://example.com/';
    if (reason === 'detached') h.root.isConnected = false;
    if (reason === 'class') h.root.attrs.class = '';
    if (reason === 'editable') h.root.attrs.contenteditable = 'false';
    if (reason === 'api') h.document.execCommand = undefined;
    const data = { files: [], types: ['text/plain'], items: [], getData: () => 'abc\r\ndef' };
    const extra = reason === 'outside' ? { target: h.body } : reason === 'untrusted' ? { isTrusted: false }
      : reason === 'cancelable' ? { cancelable: false } : reason === 'prevented' ? { defaultPrevented: true } : {};
    assertSkipped(h, h.event('paste', { clipboardData: data, ...extra }));
  }
});

test('composition on root or child and the IME grace interval keep native paste', async () => {
  for (const type of ['compositionstart', 'compositionupdate', 'keydown']) {
    const h = await setup();
    h.event(type, { target: h.root.firstChild, code: 'KeyM', keyCode: 229 });
    assertSkipped(h, h.paste());
    h.event('compositionend', { target: h.root.firstChild }); assertSkipped(h, h.paste());
    h.frame(81); h.paste(); h.frame(500); assert.equal(h.commands.length, 1); h.clean();
  }
});

test('false or exception disables normalization until reload, with no retry or output', async () => {
  for (const result of [false, 'throw']) {
    const h = await setup(); let calls = 0;
    h.document.execCommand = () => { calls++; if (result === 'throw') throw Error('private content'); return result; };
    assert.equal(h.paste().prevented, true); assert.equal(calls, 1); h.clean();
    assert.equal(h.paste().prevented, undefined); assert.equal(calls, 1);
    h.change('enabled', false); h.change('enabled', true); h.paste(); assert.equal(calls, 1); h.clean();
  }
});

test('DOM mismatch, duplicate text, CR, BR, wrong caret or replaced root disables without repair', async () => {
  for (const reason of ['no-edit', 'duplicate', 'CR', 'BR', 'selection', 'root']) {
    const h = await setup(); let calls = 0;
    h.document.execCommand = () => {
      calls++;
      if (reason !== 'no-edit') h.populate(reason === 'duplicate' ? ['abc', 'def', 'abc', 'def']
        : reason === 'CR' ? ['abc\r', 'def'] : ['abc', 'def']);
      if (reason === 'BR') h.root.firstChild.append(new Element('BR'));
      if (reason === 'selection') h.setSelection(null);
      if (reason === 'root') h.root.isConnected = false;
      return true;
    };
    h.paste(); h.frame(500); assert.equal(calls, 1);
    h.root.isConnected = true; h.resetEmpty();
    assert.equal(h.paste().prevented, undefined); assert.equal(calls, 1); h.clean();
  }
});

test('delayed duplicate insertion is checked across beforeinput, without repair', async () => {
  const h = await setup(); h.paste(); h.frame(150);
  h.event('beforeinput', { inputType: 'insertText' }); h.populate(['abc', 'def', 'abc', 'def']); h.frame(350);
  assert.equal(h.root.childNodes.length, 4); h.resetEmpty(); h.paste();
  assert.equal(h.commands.length, 1); h.clean();
});

test('nested paste cannot reenter the command, and reinjection cannot duplicate listeners', async () => {
  const h = await setup();
  const before = [h.document.listenerCount(), h.window.listenerCount()];
  vm.runInContext(source, h.context);
  assert.deepEqual([h.document.listenerCount(), h.window.listenerCount()], before);
  const exec = h.document.execCommand;
  h.document.execCommand = (...args) => { h.paste(); return exec(...args); };
  h.paste(); h.frame(500); assert.equal(h.commands.length, 1); h.clean();
});

test('next user action and settings change end verification without intercepting that action', async () => {
  for (const action of ['keydown', 'pointerdown', 'compositionstart', 'setting']) {
    const h = await setup(); h.paste();
    if (action === 'setting') h.change('enabled', false);
    else assert.equal(h.event(action, { code: 'KeyA' }).prevented, undefined);
    h.clean();
  }
});

test('Enter newline and configured shortcuts work across Windows and Mac modes', async () => {
  const cases = [
    ['win', 'shift', { shiftKey: true }], ['win', 'ctrl', { ctrlKey: true }],
    ['win', 'both', { ctrlKey: true }], ['win', 'combo', { shiftKey: true, ctrlKey: true }],
    ['mac', 'cmd', { metaKey: true }], ['mac', 'shiftCmd', { shiftKey: true, metaKey: true }],
    ['mac', 'both', { metaKey: true }], ['win', 'cmd', { shiftKey: true }],
    ['win', 'both', { shiftKey: true }], ['win', 'shiftCmd', { shiftKey: true }],
    ['mac', 'shift', { shiftKey: true }], ['mac', 'ctrl', { ctrlKey: true }],
    ['mac', 'both', { shiftKey: true }], ['mac', 'both', { ctrlKey: true }],
    ['mac', 'combo', { shiftKey: true, ctrlKey: true }]
  ];
  for (const [os, mode, modifiers] of cases) {
    const h = await setup(true, os, mode), dispatched = [];
    h.root.dispatchEvent = e => dispatched.push(e);
    h.paste();
    assert.equal(h.event('keydown', { code: 'Enter', keyCode: 13 }).prevented, true);
    assert.equal(dispatched.length, 1); assert.equal(dispatched[0].shiftKey, true);
    assert.equal(h.event('keydown', { code: 'Enter', keyCode: 13, ...modifiers }).prevented, true);
    if (dom === 'legacy') {
      assert.equal(dispatched.length, 2); assert.equal(dispatched[1].metaKey, true);
    } else {
      assert.equal(dispatched.length, 1, 'Send must not synthesize Meta+Enter');
      assert.equal(h.submissions.length, 1); assert.equal(h.submissions[0].text, 'abcdef');
      assert.equal(h.submissions[0].submitter, h.button);
    }
    h.clean();
  }
});

test('IME Enter protection, synthetic event filtering, and modifier blocking are unchanged', async () => {
  const h = await setup(), dispatched = [];
  h.root.dispatchEvent = e => dispatched.push(e);
  for (const extra of [{ isComposing: true }, { keyCode: 229 }, { isTrusted: false }]) {
    assert.equal(h.event('keydown', { code: 'Enter', ...extra }).prevented, undefined);
  }
  h.event('compositionstart'); assert.equal(h.event('keydown', { code: 'Enter' }).prevented, undefined);
  h.event('compositionend'); assert.equal(h.event('keydown', { code: 'Enter' }).prevented, undefined);
  h.frame(81);
  assert.equal(h.event('keydown', { code: 'Enter', ctrlKey: true }).prevented, true);
  assert.equal(dispatched.length, 0);
  h.change('enabled', false); assert.equal(h.event('keydown', { code: 'Enter' }).prevented, undefined); h.clean();
});


test('composer root, child element and text-node events work without localized labels', async () => {
  for (const label of [null, 'ChatGPT に聞く', 'Ask ChatGPT', 'ChatGPT에게 물어보기', '询问 ChatGPT']) {
    for (const kind of ['root', 'child', 'text']) {
      const h = await setup();
      if (label !== null) h.root.setAttribute('aria-label', label);
      const target = kind === 'root' ? h.root : kind === 'child' ? h.root.firstChild
        : h.root.firstChild.append(new Text(''));
      const dispatched = []; target.dispatchEvent = e => dispatched.push(e);
      assert.equal(h.event('keydown', { target, code: 'Enter' }).prevented, true);
      assert.equal(dispatched[0].shiftKey, true);
      assert.equal(h.event('keydown', { target, code: 'Enter', shiftKey: true }).prevented, true);
      if (dom === 'legacy') assert.equal(dispatched[1].metaKey, true);
      else { assert.equal(dispatched.length, 1); assert.equal(h.submissions.length, 1); }
      h.clean();
    }
  }
});

test('outside events never control Enter or start composer composition protection', async () => {
  const h = await setup(), outside = h.body.append(new Element('DIV', { contenteditable: 'true' }));
  assert.equal(h.event('keydown', { target: outside, code: 'Enter' }).prevented, undefined);
  h.event('compositionstart', { target: outside });
  const dispatched = []; h.root.dispatchEvent = e => dispatched.push(e);
  assert.equal(h.event('keydown', { code: 'Enter' }).prevented, true);
  assert.equal(dispatched.length, 1);
  h.paste(); h.frame(500); assert.equal(h.commands.length, 1); h.clean();
});

test('partial matches, noneditable, detached and wrong-tag roots are excluded', async () => {
  const attrs = [
    { contenteditable: 'true' }, { role: 'textbox' }, { class: 'ProseMirror' },
    { 'data-composer-markdown': '' }, { id: 'prompt-textarea' },
    ...['contenteditable', 'class', 'role', 'data-composer-markdown'].map(missing => {
      const a = { contenteditable: 'true', class: 'ProseMirror', role: 'textbox', 'data-composer-markdown': '' };
      delete a[missing]; return a;
    })
  ];
  for (const attributes of attrs) {
    const h = await setup(); h.root.attrs = attributes;
    assert.equal(h.event('keydown', { code: 'Enter' }).prevented, undefined);
    assertSkipped(h, h.paste());
  }
  for (const reason of ['detached', 'inherited-readonly', 'wrong-tag', 'false-editable']) {
    const h = await setup();
    if (reason === 'detached') { h.root.isConnected = false; h.body.childNodes = []; }
    if (reason === 'inherited-readonly') h.root.isContentEditable = false;
    if (reason === 'wrong-tag') h.root.tagName = 'SPAN';
    if (reason === 'false-editable') h.root.attrs.contenteditable = 'false';
    assert.equal(h.event('keydown', { code: 'Enter' }).prevented, undefined);
    assertSkipped(h, h.paste());
  }
});

test('multiple valid candidates are ambiguous even when one is legacy or focused', async () => {
  for (const attrs of [
    { id: 'prompt-textarea', class: 'ProseMirror', contenteditable: 'true' },
    { class: 'ProseMirror', contenteditable: 'true', role: 'textbox', 'data-composer-markdown': '' }
  ]) {
    const h = await setup(), other = h.body.append(new Element('DIV', attrs));
    for (const target of [h.root, h.root.firstChild, other]) {
      assert.equal(h.event('keydown', { target, code: 'Enter' }).prevented, undefined);
      h.event('compositionstart', { target });
    }
    assertSkipped(h, h.paste());
    h.body.childNodes = [h.root]; other.isConnected = false;
    h.root.dispatchEvent = () => {};
    assert.equal(h.event('keydown', { code: 'Enter' }).prevented, true);
    h.paste(); h.frame(500); assert.equal(h.commands.length, 1); h.clean();
  }
});

test('root matching both selectors is counted once; unrelated editable does not hide composer', async () => {
  const h = await setup();
  Object.assign(h.root.attrs, { id: 'prompt-textarea', role: 'textbox', 'data-composer-markdown': '' });
  h.body.append(new Element('DIV', { contenteditable: 'true', class: 'ProseMirror' }));
  h.root.dispatchEvent = () => {};
  assert.equal(h.event('keydown', { code: 'Enter' }).prevented, true);
  h.paste(); h.frame(500); assert.equal(h.commands.length, 1); h.clean();
});

test('root and descendant IME Enter protection includes composition and exact grace boundary', async () => {
  for (const child of [false, true]) {
    const h = await setup(), target = child ? h.root.firstChild : h.root;
    const dispatched = []; target.dispatchEvent = e => dispatched.push(e);
    for (const extra of [{ isComposing: true }, { keyCode: 229 }, { isTrusted: false }]) {
      assert.equal(h.event('keydown', { target, code: 'Enter', ...extra }).prevented, undefined);
    }
    h.event('compositionstart', { target });
    assert.equal(h.event('keydown', { target, code: 'Enter' }).prevented, undefined);
    h.event('compositionend', { target }); h.frame(79);
    assert.equal(h.event('keydown', { target, code: 'Enter' }).prevented, undefined);
    h.frame(1);
    assert.equal(h.event('keydown', { target, code: 'Enter' }).prevented, true);
    assert.equal(dispatched.length, 1); h.clean();
  }
});

test('legacy URL remains supported and a second composer during paste validation faults safely', async () => {
  const h = await setup(); h.context.location.href = 'https://chat.openai.com/c/test';
  h.paste(); assert.equal(h.commands.length, 1);
  h.body.append(new Element('DIV', { role: 'textbox', class: 'ProseMirror', contenteditable: 'true', 'data-composer-markdown': '' }));
  h.frame(500); h.body.childNodes = [h.root]; h.resetEmpty();
  assert.equal(h.paste().prevented, undefined); assert.equal(h.commands.length, 1); h.clean();
});


test('send requires one trusted, allowed shortcut with focus and no IME activity', async () => {
  for (const reason of ['untrusted', 'composing', '229', 'active-ime', 'grace', 'repeat', 'alt',
    'prevented', 'not-cancelable', 'failed-cancel', 'disabled', 'outside-target', 'outside-focus', 'blurred', 'wrong-shortcut', 'ambiguous']) {
    const h = await setup(), dispatched = [];
    h.root.dispatchEvent = e => dispatched.push(e);
    const extra = { code: 'Enter', shiftKey: true };
    if (reason === 'untrusted') extra.isTrusted = false;
    if (reason === 'composing') extra.isComposing = true;
    if (reason === '229') extra.keyCode = 229;
    if (reason === 'active-ime') h.event('compositionstart');
    if (reason === 'grace') { h.event('compositionstart'); h.event('compositionend'); h.frame(79); }
    if (reason === 'repeat') extra.repeat = true;
    if (reason === 'alt') extra.altKey = true;
    if (reason === 'prevented') extra.defaultPrevented = true;
    if (reason === 'not-cancelable') extra.cancelable = false;
    if (reason === 'failed-cancel') extra.preventDefault = () => {};
    if (reason === 'disabled') h.change('enabled', false);
    if (reason === 'outside-target') extra.target = h.body;
    if (reason === 'outside-focus') h.document.activeElement = h.body;
    if (reason === 'blurred') h.document.hasFocus = () => false;
    if (reason === 'wrong-shortcut') { extra.shiftKey = false; extra.ctrlKey = true; }
    if (reason === 'ambiguous') h.body.append(new Element('DIV', { ...h.root.attrs }));
    h.event('keydown', extra);
    assert.equal(h.submissions.length, 0, reason); assert.equal(dispatched.length, 0, reason); h.clean();
  }
});

test('devForceMacPlatform and runtime setting changes preserve the selected send mode', async () => {
  const h = await setup(true, 'win', 'cmd', { devForceMacPlatform: true }), dispatched = [];
  h.root.dispatchEvent = e => dispatched.push(e);
  h.event('keydown', { code: 'Enter', metaKey: true });
  h.change('mode', 'shiftCmd');
  h.event('keydown', { code: 'Enter', shiftKey: true, metaKey: true });
  assert.equal(dom !== 'legacy' ? h.submissions.length : dispatched.length, 2);
  h.event('keydown', { code: 'Enter', metaKey: true });
  assert.equal(dom !== 'legacy' ? h.submissions.length : dispatched.length, 2);
  h.clean();
});

if (dom === 'legacy') {
  test('legacy ID retains keyboard sending with an unmarked form or markdown attribute', async () => {
    const h = await setup(), dispatched = [];
    h.root.attrs['data-composer-markdown'] = '';
    const form = h.body.append(new Element('FORM'));
    h.body.childNodes = h.body.childNodes.filter(n => n !== h.root); form.append(h.root);
    h.root.dispatchEvent = e => dispatched.push(e);
    h.event('keydown', { code: 'Enter', shiftKey: true });
    assert.equal(dispatched.length, 1); assert.equal(dispatched[0].metaKey, true); h.clean();
  });
}

if (dom !== 'legacy') {
  test('form recognition requires the old marker or both exact thread/home attribute values', async () => {
    const cases = [
      [{ 'data-chatgpt-composer': '' }, true],
      [{ 'data-composer-placement': 'thread', 'data-thread-find-composer': 'true' }, true],
      [{ 'data-composer-placement': 'home', 'data-thread-find-composer': 'true' }, true],
      [{ 'data-composer-placement': 'thread' }, false],
      [{ 'data-composer-placement': 'home' }, false],
      [{ 'data-thread-find-composer': 'true' }, false],
      [{}, false],
      [{ 'data-composer-placement': 'other', 'data-thread-find-composer': 'true' }, false],
      [{ 'data-composer-placement': 'thread', 'data-thread-find-composer': 'false' }, false],
      [{ 'data-composer-placement': 'thread', 'data-thread-find-composer': '' }, false],
      [{ 'data-composer-placement': 'home', 'data-thread-find-composer': 'false' }, false],
      [{ 'data-composer-placement': 'home', 'data-thread-find-composer': '' }, false],
      [{ 'data-composer-placement': 'home', 'data-thread-find-composer': 'TRUE' }, false],
      [{ 'data-composer-placement': 'home', 'data-thread-find-composer': ' true ' }, false],
      [{ 'data-composer-placement': 'HOME', 'data-thread-find-composer': 'true' }, false],
      [{ 'data-composer-placement': ' home ', 'data-thread-find-composer': 'true' }, false],
      [{ 'data-composer-placement': '', 'data-thread-find-composer': 'true' }, false]
    ];
    for (const [attrs, accepted] of cases) {
      const h = await setup(); h.form.attrs = attrs;
      h.root.dispatchEvent = () => assert.fail('No synthetic fallback for modern composers');
      h.event('keydown', { code: 'Enter', shiftKey: true });
      assert.equal(h.clicks.length, accepted ? 1 : 0, JSON.stringify(attrs));
      assert.equal(h.submissions.length, accepted ? 1 : 0); h.clean();
    }
  });

  test('verified form button submits once even when the page ignores synthetic Meta+Enter', async () => {
    const h = await setup(); h.populate(['draft']);
    const keys = []; h.root.dispatchEvent = e => keys.push(e); // New UI ignores synthetic sends.
    h.event('keydown', { code: 'Enter' });
    assert.equal(keys.length, 1); assert.equal(keys[0].shiftKey, true);
    h.event('keydown', { code: 'Enter', shiftKey: true });
    h.event('keydown', { code: 'Enter', shiftKey: true, repeat: true });
    assert.equal(h.clicks.length, 1); assert.equal(h.submissions.length, 1);
    assert.equal(h.submissions[0].text, 'draft'); assert.equal(keys.length, 1); h.clean();
  });

  test('missing, ambiguous, disabled, hidden or incorrectly owned send UI fails closed', async () => {
    const reasons = ['no-form', 'unmarked-form', 'detached-form', 'missing-button', 'duplicate', 'extra-input',
      'wrong-type', 'input-submit', 'input-image', 'detached-button', 'foreign-form', 'nested-form', 'disabled', 'fieldset',
      'hidden', 'inert', 'aria-hidden', 'aria-disabled', 'ancestor-hidden', 'ancestor-disabled',
      'no-rect', 'display', 'visibility', 'opacity', 'ancestor-opacity', 'no-click'];
    for (const reason of reasons) {
      const h = await setup(), synthetic = [];
      h.root.dispatchEvent = e => synthetic.push(e);
      if (reason === 'no-form') { h.form.childNodes = h.form.childNodes.filter(x => x !== h.root); h.body.append(h.root); }
      if (reason === 'unmarked-form') h.form.attrs = {};
      if (reason === 'detached-form') h.form.isConnected = false;
      if (reason === 'missing-button') h.form.childNodes = h.form.childNodes.filter(x => x !== h.button);
      if (reason === 'duplicate') h.form.append(new Element('BUTTON', { type: 'submit' }));
      if (reason === 'extra-input') h.form.append(new Element('INPUT', { type: 'submit' }));
      if (reason === 'wrong-type') h.button.attrs.type = 'button';
      if (reason === 'input-submit' || reason === 'input-image') {
        h.button.tagName = 'INPUT'; h.button.attrs.type = reason === 'input-image' ? 'image' : 'submit';
      }
      if (reason === 'detached-button') h.button.isConnected = false;
      if (reason === 'foreign-form') h.button.formOverride = h.body.append(new Element('FORM'));
      if (reason === 'nested-form' || reason === 'fieldset') {
        h.form.childNodes = h.form.childNodes.filter(x => x !== h.button);
        h.form.append(new Element(reason === 'fieldset' ? 'FIELDSET' : 'FORM', reason === 'fieldset' ? { disabled: '' } : {})).append(h.button);
      }
      if (reason === 'disabled') h.button.disabled = true;
      if (['hidden', 'inert'].includes(reason)) h.button.attrs[reason] = '';
      if (['aria-hidden', 'aria-disabled'].includes(reason)) h.button.attrs[reason] = 'true';
      if (reason === 'ancestor-hidden') h.form.attrs.hidden = '';
      if (reason === 'ancestor-disabled') h.form.attrs['aria-disabled'] = 'true';
      if (reason === 'no-rect') h.button.noRect = true;
      if (reason === 'display') h.button.style = { display: 'none' };
      if (reason === 'visibility') h.button.style = { visibility: 'hidden' };
      if (reason === 'opacity') h.button.style = { opacity: '0' };
      if (reason === 'ancestor-opacity') h.form.style = { opacity: '0' };
      if (reason === 'no-click') h.button.click = undefined;
      const e = h.event('keydown', { code: 'Enter', shiftKey: true });
      assert.equal(e.defaultPrevented, reason !== 'ancestor-hidden', reason);
      assert.equal(h.clicks.length, 0, reason); assert.equal(h.submissions.length, 0, reason);
      assert.equal(synthetic.length, 0, reason); h.clean();
    }
  });

  test('button route is label-independent and used even with a legacy root ID in a marked form', async () => {
    for (const label of [null, '送信', 'Send', '发送', '보내기']) {
      const h = await setup(); h.root.attrs.id = 'prompt-textarea';
      h.form.attrs['data-chatgpt-composer'] = ''; // Existing marked legacy-ID route.
      if (label) h.button.attrs['aria-label'] = label;
      h.root.dispatchEvent = () => assert.fail('No synthetic fallback for the verified form UI');
      const other = h.body.append(new Element('FORM')).append(new Element('BUTTON', { type: 'submit' }));
      other.click = () => assert.fail('Other form clicked');
      h.event('keydown', { code: 'Enter', shiftKey: true });
      assert.equal(h.submissions.length, 1); h.clean();
    }
  });

  test('click errors never retry or invoke a second submission route', async () => {
    const h = await setup(); let clicks = 0;
    h.root.dispatchEvent = () => assert.fail('No fallback after attempted click');
    h.button.click = () => { clicks++; h.form.fire('submit', { submitter: h.button }); throw Error('private'); };
    h.event('keydown', { code: 'Enter', shiftKey: true });
    h.frame(1000);
    assert.equal(clicks, 1); assert.equal(h.submissions.length, 1); h.clean();
  });

  test('two normalized pastes retain one edit each and shortcuts add no editor edits', async () => {
    const h = await setup();
    for (let i = 0; i < 2; i++) {
      h.resetEmpty(); const p = h.root.firstChild;
      p.attrs = { 'data-empty-paragraph': 'true', 'data-placeholder': 'ChatGPT に聞く', class: 'placeholder' };
      h.paste('abc\r\ndef'); h.frame(500);
      assert.equal(h.root.textContent, 'abcdef'); assert.ok(!h.root.textContent.includes('\r'));
      h.event('keydown', { code: 'Enter', shiftKey: true });
      assert.equal(h.commands.length, i + 1); assert.equal(h.submissions.length, i + 1); h.clean();
    }
    assert.ok(h.commands.every(c => c.command === 'insertText' && c.text === 'abc\ndef'));
  });
}


test('visible composer remains usable with a connected zero-size stale composer', async () => {
  for (const staleFirst of [false, true]) {
    const h = await setup(), stale = new Element('DIV', { ...h.root.attrs });
    stale.rect = { x: 0, y: 0, width: 0, height: 0 };
    const staleForm = new Element('FORM', { 'data-chatgpt-composer': '' }); staleForm.append(stale);
    if (staleFirst) { staleForm.parentNode = h.body; h.body.childNodes.unshift(staleForm); }
    else h.body.append(staleForm);
    const dispatched = []; h.root.dispatchEvent = e => dispatched.push(e);
    assert.equal(h.event('keydown', { code: 'Enter', target: stale }).prevented, undefined);
    h.event('compositionstart', { target: stale }); // Hidden editor must not block active editor's IME.
    assert.equal(h.event('keydown', { code: 'Enter' }).prevented, true);
    assert.equal(dispatched[0].shiftKey, true);
    assert.equal(h.event('keydown', { code: 'Enter', shiftKey: true }).prevented, true);
    assert.equal(dom !== 'legacy' ? h.submissions.length : dispatched.length - 1, 1);
    h.event('keydown', { code: 'Enter', shiftKey: true, repeat: true });
    assert.equal(dom !== 'legacy' ? h.submissions.length : dispatched.length - 1, 1);
    h.event('compositionstart');
    assert.equal(h.event('keydown', { code: 'Enter' }).prevented, undefined);
    h.event('compositionend'); h.frame(79);
    assert.equal(h.event('keydown', { code: 'Enter' }).prevented, undefined);
    h.frame(1);
    for (let i = 0; i < 2; i++) {
      h.resetEmpty(); h.paste(); h.frame(500);
      assert.equal(h.commands.length, i + 1); assert.equal(h.root.textContent, 'abcdef'); h.clean();
    }
    // Candidate changes must be evaluated live, even with focus still on the original root.
    stale.rect = { width: 524, height: 36 };
    assert.equal(h.event('keydown', { code: 'Enter' }).prevented, undefined);
    stale.rect = { width: 0, height: 0 };
    assert.equal(h.event('keydown', { code: 'Enter' }).prevented, true); h.clean();
  }
});

test('non-displayed composers are excluded from Enter, send, IME and paste handling', async () => {
  for (const reason of ['zero', 'width-zero', 'height-zero', 'no-rect', 'disconnected',
    'hidden', 'inert', 'aria-hidden', 'ancestor-hidden', 'ancestor-inert', 'ancestor-aria-hidden',
    'visibility-hidden', 'visibility-collapse', 'display-none', 'no-composer']) {
    const h = await setup(), dispatched = [];
    h.root.dispatchEvent = e => dispatched.push(e);
    if (reason === 'zero') h.root.rect = { width: 0, height: 0 };
    if (reason === 'width-zero') h.root.rect = { width: 0 };
    if (reason === 'height-zero') h.root.rect = { height: 0 };
    if (reason === 'no-rect') h.root.noRect = true;
    if (reason === 'disconnected') h.root.isConnected = false;
    if (['hidden', 'inert'].includes(reason)) h.root.attrs[reason] = '';
    if (reason === 'aria-hidden') h.root.attrs['aria-hidden'] = 'true';
    if (reason.startsWith('ancestor-')) {
      const name = reason.slice('ancestor-'.length);
      h.body.attrs[name] = name === 'aria-hidden' ? 'true' : '';
    }
    if (reason === 'visibility-hidden') h.root.style = { visibility: 'hidden' };
    if (reason === 'visibility-collapse') h.root.style = { visibility: 'collapse' };
    if (reason === 'display-none') h.root.style = { display: 'none' };
    if (reason === 'no-composer') h.body.childNodes = [];
    assert.equal(h.event('keydown', { code: 'Enter' }).prevented, undefined, reason);
    assert.equal(h.event('keydown', { code: 'Enter', shiftKey: true }).prevented, undefined, reason);
    h.event('compositionstart'); assertSkipped(h, h.paste());
    assert.equal(dispatched.length, 0); assert.equal(h.submissions.length, 0);
    // Recover without compositionend: the excluded editor must not set IME state.
    h.root.rect = {}; h.root.noRect = false; h.root.isConnected = true; h.root.style = {};
    for (const name of ['hidden', 'inert', 'aria-hidden']) { delete h.root.attrs[name]; delete h.body.attrs[name]; }
    if (reason === 'no-composer') h.body.append(h.form || h.root);
    assert.equal(h.event('keydown', { code: 'Enter' }).prevented, true, reason); h.clean();
  }
});

test('display eligibility has no fixed position, minimum size, focus or ancestor opacity heuristic', async () => {
  const h = await setup(), dispatched = [];
  h.root.rect = { x: -1000, y: 10000, width: 0.5, height: 0.5 };
  h.root.attrs['aria-hidden'] = 'false';
  h.body.style = { visibility: 'hidden', opacity: '0.2' };
  h.root.style = { visibility: 'visible' }; // A descendant may override inherited visibility.
  h.document.activeElement = h.body;
  h.root.dispatchEvent = e => dispatched.push(e);
  assert.equal(h.event('keydown', { code: 'Enter' }).prevented, true);
  assert.equal(dispatched.length, 1); h.clean();
});
}
