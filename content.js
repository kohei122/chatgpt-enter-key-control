(() => {
const INIT_KEY = "__chatgptEnterKeyControlInitialized";
if (window[INIT_KEY]) return;
window[INIT_KEY] = true;

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

function handleKey(event) {
  const isEnter = event.code === "Enter" || event.code === "NumpadEnter";
  const isPromptTextarea = event.target && event.target.id === "prompt-textarea";
  const inCompositionGraceWindow =
    lastCompositionEndAt > 0 &&
    performance.now() - lastCompositionEndAt < COMPOSITION_END_GRACE_MS;

  if (!event.isTrusted) return;
  if (isComposingActive || event.isComposing || event.keyCode === 229 || inCompositionGraceWindow) return;
  if (!settingsLoaded) return;
  if (!settings.enabled) return;
  if (!isPromptTextarea || !isEnter) return;

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
    event.preventDefault();
    dispatchEnter(event.target, { shiftKey: true });
    return;
  }

  // Configured shortcut -> send
  if (isSend) {
    event.preventDefault();
    dispatchEnter(event.target, { metaKey: true });
    return;
  }

  // Block unapproved modified Enter to avoid ChatGPT default shortcuts.
  if (event.ctrlKey || event.shiftKey || event.metaKey) {
    event.preventDefault();
  }
}

document.addEventListener("keydown", handleKey, { capture: true });

document.addEventListener("compositionstart", (event) => {
  if (!event.target || event.target.id !== "prompt-textarea") return;
  isComposingActive = true;
}, { capture: true });

document.addEventListener("compositionend", (event) => {
  if (!event.target || event.target.id !== "prompt-textarea") return;
  isComposingActive = false;
  lastCompositionEndAt = performance.now();
}, { capture: true });
})();
