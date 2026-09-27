(() => {
const INIT_KEY = "__chatgptEnterKeyControlInitialized";
const INIT_MARKER_ATTRIBUTE = "data-chatgpt-enter-key-control-initialized";
if (window[INIT_KEY] || document.documentElement?.hasAttribute(INIT_MARKER_ATTRIBUTE)) return;
window[INIT_KEY] = true;
document.documentElement?.setAttribute(INIT_MARKER_ATTRIBUTE, "true");

function sanitizeMode(mode) {
  return mode === "ctrl" ||
    mode === "cmd" ||
    mode === "both" ||
    mode === "combo" ||
    mode === "shiftCmd"
    ? mode
    : "shift";
}

function sanitizeModeForPlatform(mode, isMac) {
  const sanitized = sanitizeMode(mode);
  if (!isMac && (sanitized === "cmd" || sanitized === "shiftCmd")) {
    return "shift";
  }
  return sanitized;
}

function sanitizeEnabled(enabled) {
  if (enabled === true || enabled === false) return enabled;
  if (enabled === "true") return true;
  if (enabled === "false") return false;
  return true;
}

const DEFAULT_SETTINGS = {
  enabled: true,
  mode: "shift"
};
const DEV_FORCE_MAC_PLATFORM_KEY = "devForceMacPlatform";

let settings = { ...DEFAULT_SETTINGS };
let settingsLoaded = false;
let isMacPlatform = false;
let isComposingActive = false;
let lastCompositionEndAt = 0;
const COMPOSITION_END_GRACE_MS = 80;

function getIsMacPlatform() {
  return new Promise((resolve) => {
    if (typeof chrome === "undefined" || !chrome.runtime?.getPlatformInfo) {
      resolve(false);
      return;
    }

    chrome.runtime.getPlatformInfo((info) => {
      if (chrome.runtime.lastError) {
        resolve(false);
        return;
      }
      resolve(info?.os === "mac");
    });
  });
}

function getDevForceMacPlatform() {
  return new Promise((resolve) => {
    chrome.storage.local.get({ [DEV_FORCE_MAC_PLATFORM_KEY]: false }, (stored) => {
      resolve(stored[DEV_FORCE_MAC_PLATFORM_KEY] === true);
    });
  });
}

async function resolveIsMacPlatform() {
  const devForceMacPlatform = await getDevForceMacPlatform();
  if (devForceMacPlatform) return true;
  return getIsMacPlatform();
}

async function loadSettings() {
  isMacPlatform = await resolveIsMacPlatform();

  chrome.storage.local.get(DEFAULT_SETTINGS, (stored) => {
    const next = {
      enabled: sanitizeEnabled(stored.enabled),
      mode: sanitizeModeForPlatform(stored.mode, isMacPlatform)
    };

    settings = next;
    settingsLoaded = true;
    chrome.storage.local.set(next);
  });
}

loadSettings();

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;

  if (changes.enabled) {
    settings.enabled = sanitizeEnabled(changes.enabled.newValue);
  }

  if (changes.mode) {
    settings.mode = sanitizeModeForPlatform(changes.mode.newValue, isMacPlatform);
  }

  if (changes[DEV_FORCE_MAC_PLATFORM_KEY]) {
    resolveIsMacPlatform().then((nextIsMacPlatform) => {
      isMacPlatform = nextIsMacPlatform;
      settings.mode = sanitizeModeForPlatform(settings.mode, isMacPlatform);
    });
  }
});

function dispatchEnter(target, options = {}) {
  const event = new KeyboardEvent("keydown", {
    key: "Enter",
    code: "Enter",
    bubbles: true,
    cancelable: true,
    ctrlKey: Boolean(options.ctrlKey),
    metaKey: Boolean(options.metaKey),
    shiftKey: Boolean(options.shiftKey)
  });

  target.dispatchEvent(event);
}

function blockEnterEvent(event) {
  event.preventDefault();
  event.stopImmediatePropagation();
}

// Require a unique, connected editor; never guess between multiple composers.
const CHATGPT_COMPOSER_SELECTOR =
  '#prompt-textarea, .ProseMirror[contenteditable="true"][role="textbox"][data-composer-markdown]';

function isValidChatGPTComposer(root) {
  return root?.nodeType === 1 && root.tagName === "DIV" && root.isConnected &&
    root.getAttribute("contenteditable") === "true" && root.isContentEditable &&
    root.classList.contains("ProseMirror") &&
    (root.id === "prompt-textarea" ||
      (root.getAttribute("role") === "textbox" && root.hasAttribute("data-composer-markdown")));
}

function getChatGPTComposer() {
  const candidates = Array.from(document.querySelectorAll(CHATGPT_COMPOSER_SELECTOR))
    .filter(isValidChatGPTComposer);
  return candidates.length === 1 ? candidates[0] : null;
}

function getComposerForTarget(target) {
  const root = getChatGPTComposer();
  return root && target && typeof target.nodeType === "number" && root.contains(target) ? root : null;
}

function sendFromComposer(composer, target) {
  if (getChatGPTComposer() !== composer || !document.hasFocus() ||
      !composer.contains(document.activeElement)) return;

  const form = composer.closest("form");
  const usesFormSend = composer.id !== "prompt-textarea" ||
    form?.hasAttribute("data-chatgpt-composer");
  if (!usesFormSend) {
    // Preserve the previous ChatGPT keyboard route only for the legacy editor.
    if (composer.id === "prompt-textarea") dispatchEnter(target, { metaKey: true });
    return;
  }

  // Observed new UI: this composer's marked form has exactly one submit button.
  // Never fall back to a synthetic send when this UI is missing or unavailable.
  if (!form?.isConnected || !form.hasAttribute("data-chatgpt-composer") ||
      !form.contains(composer)) return;
  const submitters = form.querySelectorAll(
    'button[type="submit"], input[type="submit"], input[type="image"]'
  );
  if (submitters.length !== 1) return;
  const button = submitters[0];
  if (button.tagName !== "BUTTON" || !button.isConnected || button.form !== form ||
      button.closest("form") !== form || button.disabled || button.matches(":disabled") ||
      button.closest('[hidden], [inert], [aria-hidden="true"], [aria-disabled="true"]') ||
      button.getClientRects().length === 0 || typeof button.click !== "function") return;
  for (let node = button; node; node = node.parentElement) {
    const style = window.getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden" ||
        style.visibility === "collapse" || style.opacity === "0") return;
  }
  // Synchronous with the trusted shortcut. Keep native button activation and app handlers.
  // Do not retry or submit the form separately: a click handler may already have sent.
  try { button.click(); }
  catch (_) { /* Fail closed without exposing message content. */ }
}

function handleKey(event) {
  const isEnter = event.code === "Enter" || event.code === "NumpadEnter";
  const composer = getComposerForTarget(event.target);
  const inCompositionGraceWindow =
    lastCompositionEndAt > 0 &&
    performance.now() - lastCompositionEndAt < COMPOSITION_END_GRACE_MS;

  if (!event.isTrusted) return;
  if (isComposingActive || event.isComposing || event.keyCode === 229 || inCompositionGraceWindow) return;
  if (!settingsLoaded) return;
  if (!settings.enabled) return;
  if (!composer || !isEnter) return;

  const mode = sanitizeModeForPlatform(settings.mode, isMacPlatform);
  const isOnlyEnter = !event.ctrlKey && !event.metaKey && !event.shiftKey;
  let isSend = false;

  if (mode === "shift") {
    isSend = event.shiftKey && !event.ctrlKey && !event.metaKey;
  } else if (mode === "ctrl") {
    isSend = event.ctrlKey && !event.shiftKey && !event.metaKey;
  } else if (mode === "cmd") {
    isSend = isMacPlatform && event.metaKey && !event.shiftKey && !event.ctrlKey;
  } else if (mode === "both") {
    if (isMacPlatform) {
      isSend = [event.shiftKey, event.ctrlKey, event.metaKey].filter(Boolean).length === 1;
    } else {
      isSend =
        (event.shiftKey && !event.ctrlKey && !event.metaKey) ||
        (event.ctrlKey && !event.shiftKey && !event.metaKey);
    }
  } else if (mode === "combo") {
    isSend = event.shiftKey && event.ctrlKey && !event.metaKey;
  } else if (mode === "shiftCmd") {
    isSend = isMacPlatform && event.shiftKey && event.metaKey && !event.ctrlKey;
  }

  // Enter only -> newline
  if (isOnlyEnter) {
    blockEnterEvent(event);
    dispatchEnter(event.target, { shiftKey: true });
    return;
  }

  // Configured shortcut -> send
  if (isSend) {
    const canSend = event.cancelable && !event.defaultPrevented && !event.repeat && !event.altKey;
    blockEnterEvent(event);
    if (canSend && event.defaultPrevented) sendFromComposer(composer, event.target);
    return;
  }

  // Block unapproved modified Enter to avoid ChatGPT default shortcuts.
  if (event.ctrlKey || event.shiftKey || event.metaKey) {
    blockEnterEvent(event);
  }
}

// Normalize only narrowly eligible plain-text pastes before insertion.
initPasteCRNormalization();

document.addEventListener("keydown", handleKey, { capture: true });

document.addEventListener("compositionstart", (event) => {
  if (!getComposerForTarget(event.target)) return;
  isComposingActive = true;
}, { capture: true });

document.addEventListener("compositionend", (event) => {
  if (!getComposerForTarget(event.target)) return;
  isComposingActive = false;
  lastCompositionEndAt = performance.now();
}, { capture: true });

function initPasteCRNormalization() {
  let faulted = false, composing = false, imeAt = -Infinity;
  let session = null, inCommand = false;
  const handled = new WeakSet();

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.enabled && session) session.finish();
  });

  // Independent paste safeguards; preserve the existing Enter composition handling.
  for (const type of ["compositionstart", "compositionupdate", "compositionend"]) {
    window.addEventListener(type, event => {
      if (!getComposerForTarget(event.target)) return;
      composing = type !== "compositionend";
      imeAt = performance.now();
    }, true);
  }
  window.addEventListener("keydown", event => {
    if (getComposerForTarget(event.target) && (event.isComposing || event.keyCode === 229)) {
      imeAt = performance.now();
    }
  }, true);

  function isSupportedComposer(root) {
    return isValidChatGPTComposer(root) && getChatGPTComposer() === root;
  }
  function isExpectedEmptyComposer(root) {
    if (root.textContent !== "" || root.childNodes.length !== 1) return false;
    const p = root.firstChild;
    return p.nodeType === 1 && p.tagName === "P" && p.isContentEditable &&
      Array.from(p.attributes).every(a =>
        a.name === "dir" || a.name === "data-placeholder" ||
        (a.name === "data-empty-paragraph" && a.value === "true") ||
        (a.name === "class" && a.value.trim().split(/\s+/).every(c => c === "placeholder"))) &&
      (p.childNodes.length === 0 || (p.childNodes.length === 1 &&
        ((p.firstChild.nodeType === 3 && p.firstChild.length === 0) ||
         (p.firstChild.nodeType === 1 && p.firstChild.tagName === "BR" &&
          Array.from(p.firstChild.attributes).every(a => a.name === "class") &&
          (!p.firstChild.hasAttribute("class") ||
           p.firstChild.getAttribute("class") === "ProseMirror-trailingBreak")))));
  }

  function hasComposerSelection(root) {
    const s = window.getSelection();
    return s?.rangeCount === 1 && s.isCollapsed && !!s.anchorNode && !!s.focusNode &&
      root.contains(s.anchorNode) && root.contains(s.focusNode);
  }

  // Do not broaden this to rich content, mixed newlines, blank lines, or nonempty editors.
  function normalizePlainTextPaste(data) {
    if (!data || data.files.length || data.types.length !== 1 || data.types[0] !== "text/plain" ||
        Array.from(data.items).some(i => i.kind !== "string" || i.type !== "text/plain")) return null;
    const text = data.getData("text/plain");
    if (text.length > 8000 || !text.includes("\r\n") ||
        /[\r\n]/.test(text.replace(/\r\n/g, ""))) return null;
    const normalized = text.replace(/\r\n/g, "\n");
    if (normalized === text) return null;
    const lines = normalized.split("\n");
    return lines.length >= 2 && lines.length <= 20 && lines.every(line => line.trim())
      ? { normalized, lines } : null;
  }

  function selectionAtEnd(root) {
    if (!hasComposerSelection(root)) return false;
    const s = window.getSelection();
    const lastP = root.childNodes[root.childNodes.length - 1];
    const last = lastP?.childNodes[lastP.childNodes.length - 1];
    const endPoint = (node, offset) =>
      (node === last && node?.nodeType === 3 && offset === node.length) ||
      (node === lastP && offset === lastP?.childNodes.length) ||
      (node === root && offset === root.childNodes.length);
    return endPoint(s.anchorNode, s.anchorOffset) && endPoint(s.focusNode, s.focusOffset);
  }

  function matchesInsertedParagraphs(root, lines) {
    return root.childNodes.length === lines.length && Array.from(root.childNodes).every((p, i) =>
      p.nodeType === 1 && p.tagName === "P" && p.isContentEditable &&
      Array.from(p.attributes).every(a => a.name === "dir") && p.childNodes.length === 1 &&
      p.firstChild.nodeType === 3 && p.firstChild.data === lines[i]);
  }

  function handlePasteCRNormalization(event) {
    if (handled.has(event) || inCommand) return;
    if (session) session.finish();
    if (faulted || !settingsLoaded || !settings.enabled) return;
    if (!event.isTrusted || !event.cancelable || event.defaultPrevented) return;
    if (!/^https:\/\/(chatgpt\.com|chat\.openai\.com)(\/|$)/.test(location.href)) return;
    const root = getComposerForTarget(event.target);
    if (!root) return;
    if (composing || isComposingActive || performance.now() - imeAt < COMPOSITION_END_GRACE_MS ||
        (lastCompositionEndAt > 0 && performance.now() - lastCompositionEndAt < COMPOSITION_END_GRACE_MS)) return;
    if (!isExpectedEmptyComposer(root) || !document.hasFocus() || document.activeElement !== root ||
        !hasComposerSelection(root) || typeof document.execCommand !== "function") return;

    let paste;
    try { paste = normalizePlainTextPaste(event.clipboardData); }
    catch (_) { return; }
    if (!paste) return;

    handled.add(event);
    const url = location.href;
    let done = false, result = null, timer = null;
    const listeners = [];
    function finish(forceFailure = false) {
      if (done) return;
      done = true;
      if (timer !== null) clearTimeout(timer);
      for (const [type, fn] of listeners) window.removeEventListener(type, fn, true);
      listeners.length = 0;
      session = null;
      let ok = false;
      try {
        ok = !forceFailure && result === true && isSupportedComposer(root) && location.href === url &&
          document.hasFocus() && document.activeElement === root &&
          matchesInsertedParagraphs(root, paste.lines) && selectionAtEnd(root);
      } catch (_) { /* Never expose clipboard content through exception messages. */ }
      paste = null;
      if (!ok) faulted = true;
    }
    session = { finish };
    try {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!event.defaultPrevented) return finish(true);
      // Deprecated, but verified on the target editor to preserve one Undo/Redo step.
      // One native edit only: no DOM repair, Selection writes, retries, or synthetic paste.
      inCommand = true;
      try { result = document.execCommand("insertText", false, paste.normalized); }
      finally { inCommand = false; }
      if (result !== true) return finish(true);
      // Read-only validation after page processing, or before the next user action.
      // Exact text equality also detects retained CR, missing text, and duplicate insertion.
      // beforeinput may be delayed page insertion, so do not end verification on it.
      const nextAction = e => { if (e.isTrusted) finish(); };
      for (const type of ["keydown", "compositionstart", "pointerdown", "mousedown",
        "touchstart", "selectstart", "blur", "pagehide", "popstate", "hashchange"]) {
        window.addEventListener(type, nextAction, true);
        listeners.push([type, nextAction]);
      }
      timer = setTimeout(() => finish(), 500);
    } catch (_) {
      // Cancellation cannot safely be undone. Disable until reload, without retrying.
      finish(true);
    }
  }
  window.addEventListener("paste", handlePasteCRNormalization, { capture: true });
}
})();
