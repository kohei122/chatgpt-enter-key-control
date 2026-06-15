(() => {
const INIT_KEY = "__chatgptEnterKeyControlInitialized";
if (window[INIT_KEY]) return;
window[INIT_KEY] = true;

function sanitizeMode(mode) {
  return mode === "ctrl" || mode === "both" || mode === "combo" ? mode : "shift";
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

let settings = { ...DEFAULT_SETTINGS };
let settingsLoaded = false;

chrome.storage.local.get(DEFAULT_SETTINGS, (stored) => {
  const next = {
    enabled: sanitizeEnabled(stored.enabled),
    mode: sanitizeMode(stored.mode)
  };

  settings = next;
  settingsLoaded = true;
  chrome.storage.local.set(next);
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;

  if (changes.enabled) {
    settings.enabled = sanitizeEnabled(changes.enabled.newValue);
  }

  if (changes.mode) {
    settings.mode = sanitizeMode(changes.mode.newValue);
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

  if (!event.isTrusted) return;
  if (event.isComposing) return;
  if (!settingsLoaded) return;
  if (!settings.enabled) return;
  if (!isPromptTextarea || !isEnter) return;

  const mode = sanitizeMode(settings.mode);
  const isOnlyEnter = !event.ctrlKey && !event.metaKey && !event.shiftKey;
  let isSend = false;

  if (mode === "shift") {
    isSend = event.shiftKey && !event.ctrlKey && !event.metaKey;
  } else if (mode === "ctrl") {
    isSend = event.ctrlKey && !event.shiftKey && !event.metaKey;
  } else if (mode === "both") {
    isSend =
      (event.shiftKey && !event.ctrlKey && !event.metaKey) ||
      (event.ctrlKey && !event.shiftKey && !event.metaKey);
  } else if (mode === "combo") {
    isSend = event.shiftKey && event.ctrlKey && !event.metaKey;
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
})();
