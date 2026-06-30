const DEFAULT_SETTINGS = {
  enabled: true,
  mode: "shift"
};
const FORCE_LANG_STORAGE_KEY = "forceLang";
const FORCE_LANGS = ["en", "ja", "ko", "zh_CN", "zh_TW", "es", "pt_BR"];
const OTHER_EXTENSIONS_URL = "https://chromewebstore.google.com/search/(by%20marusin)?hl=ja&authuser=0";
const CONTENT_SCRIPT_FILE = "content.js";

function sanitizeEnabled(enabled) {
  if (enabled === true || enabled === false) return enabled;
  if (enabled === "true") return true;
  if (enabled === "false") return false;
  return true;
}

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

const toggle = document.getElementById("toggle");
const modeOptions = document.getElementById("mode-options");
const appVersion = document.getElementById("app-version");
const appHeader = document.getElementById("app-header");
const enableEnterControlLabel = document.getElementById("label-enable-enter-control");
const sendKeyTitle = document.getElementById("title-send-key");
const secondaryToggle = document.getElementById("secondary-toggle");
const secondaryToggleWrap = document.getElementById("secondary-toggle-wrap");
const secondaryContent = document.getElementById("secondary-content");
const otherExtensionsLink = document.getElementById("other-extensions-link");
const languageSettingLabel = document.getElementById("language-setting-label");
const languageSelect = document.getElementById("language-select");
let isMacPlatform = false;

function getForcedLang() {
  const forcedLang = localStorage.getItem(FORCE_LANG_STORAGE_KEY);
  return FORCE_LANGS.includes(forcedLang) ? forcedLang : null;
}

async function loadForcedMessages(forceLang) {
  if (!forceLang) return null;

  try {
    const response = await fetch(chrome.runtime.getURL(`_locales/${forceLang}/messages.json`));
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

function getMessage(key, forcedMessages) {
  const forcedMessage = forcedMessages?.[key]?.message;
  if (typeof forcedMessage === "string" && forcedMessage.length > 0) {
    return forcedMessage;
  }
  return chrome.i18n.getMessage(key);
}

function applyPopupTexts(forcedMessages) {
  const appName = getMessage("appNameShort", forcedMessages);
  if (appName) {
    document.title = appName;
  }

  if (appHeader && appName) {
    appHeader.textContent = appName;
  }

  if (enableEnterControlLabel) {
    enableEnterControlLabel.textContent = getMessage("enableEnterControl", forcedMessages);
  }

  if (sendKeyTitle) {
    sendKeyTitle.textContent = getMessage("sendKey", forcedMessages);
  }

  if (languageSettingLabel) {
    languageSettingLabel.textContent = getMessage("languageSetting", forcedMessages);
  }

  if (otherExtensionsLink) {
    otherExtensionsLink.textContent = getMessage("otherExtensions", forcedMessages);
  }

  if (appVersion) {
    appVersion.textContent = `${getMessage("versionLabel", forcedMessages)} v${chrome.runtime.getManifest().version}`;
  }
}

function getModeOptionConfigs(isMac) {
  const baseOptions = [
    { value: "shift", labelKey: "modeShift" },
    { value: "ctrl", labelKey: "modeCtrl" },
    { value: "both", labelKey: "modeBoth" },
    { value: "combo", labelKey: "modeCombo" }
  ];

  if (!isMac) return baseOptions;

  return [
    { value: "shift", labelKey: "modeShift" },
    { value: "ctrl", labelKey: "modeCtrl" },
    { value: "cmd", labelKey: "modeCmd" },
    { value: "both", labelKey: "modeBothMac" },
    { value: "combo", labelKey: "modeCombo" },
    { value: "shiftCmd", labelKey: "modeShiftCmd" }
  ];
}

function renderModeOptions(isMac, selectedMode, forcedMessages) {
  if (!modeOptions) return;

  const title = sendKeyTitle;
  modeOptions.replaceChildren();
  if (title) modeOptions.append(title);

  for (const option of getModeOptionConfigs(isMac)) {
    const label = document.createElement("label");
    const radio = document.createElement("input");
    const text = document.createElement("span");

    radio.type = "radio";
    radio.name = "mode";
    radio.value = option.value;
    radio.checked = option.value === selectedMode;

    text.textContent = getMessage(option.labelKey, forcedMessages);

    label.append(radio, " ", text);
    modeOptions.append(label);
  }
}

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

function setupLanguageSelect(forceLang) {
  if (!languageSelect) return;

  languageSelect.value = forceLang ?? "auto";
  languageSelect.addEventListener("change", () => {
    if (languageSelect.value === "auto") {
      localStorage.removeItem(FORCE_LANG_STORAGE_KEY);
    } else {
      localStorage.setItem(FORCE_LANG_STORAGE_KEY, languageSelect.value);
    }
    window.location.reload();
  });
}

function setupSecondarySection() {
  if (!secondaryToggle || !secondaryContent || !secondaryToggleWrap) return;

  secondaryToggle.addEventListener("click", () => {
    secondaryContent.classList.add("open");
    secondaryToggle.setAttribute("aria-expanded", "true");
    secondaryToggleWrap.classList.add("hidden");
  });
}

function setupOtherExtensionsLink() {
  if (!otherExtensionsLink) return;

  otherExtensionsLink.addEventListener("click", (event) => {
    event.preventDefault();
    chrome.tabs.create({ url: OTHER_EXTENSIONS_URL });
  });
}

function isTargetTabUrl(url) {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" &&
      (parsed.hostname === "chatgpt.com" || parsed.hostname === "chat.openai.com")
    );
  } catch {
    return false;
  }
}

function injectContentScriptIntoActiveTab() {
  if (!chrome.tabs || !chrome.scripting) return;

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (chrome.runtime.lastError) return;

    const tab = tabs[0];
    if (!tab || typeof tab.id !== "number" || !isTargetTabUrl(tab.url)) return;

    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: [CONTENT_SCRIPT_FILE]
    }, () => {
      void chrome.runtime.lastError;
    });
  });
}

async function initializePopup() {
  const forceLang = getForcedLang();
  const [forcedMessages, isMac] = await Promise.all([
    loadForcedMessages(forceLang),
    getIsMacPlatform()
  ]);
  isMacPlatform = isMac;

  injectContentScriptIntoActiveTab();
  setupSecondarySection();
  setupLanguageSelect(forceLang);
  setupOtherExtensionsLink();
  applyPopupTexts(forcedMessages);

  chrome.storage.local.get(DEFAULT_SETTINGS, (stored) => {
    const mode = sanitizeModeForPlatform(stored.mode, isMac);
    const settings = {
      enabled: sanitizeEnabled(stored.enabled),
      mode
    };

    toggle.checked = settings.enabled;
    renderModeOptions(isMac, settings.mode, forcedMessages);

    chrome.storage.local.set(settings);
  });
}

initializePopup();

toggle.addEventListener("change", () => {
  chrome.storage.local.set({ enabled: sanitizeEnabled(toggle.checked) });
});

if (modeOptions) {
  modeOptions.addEventListener("change", (event) => {
    const radio = event.target;
    if (!(radio instanceof HTMLInputElement)) return;
    if (radio.name !== "mode") return;
    if (!radio.checked) return;
    chrome.storage.local.set({ mode: sanitizeModeForPlatform(radio.value, isMacPlatform) });
  });
}
