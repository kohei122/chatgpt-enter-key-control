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
  return mode === "ctrl" || mode === "both" || mode === "combo" ? mode : "shift";
}

const toggle = document.getElementById("toggle");
const radios = document.querySelectorAll('input[name="mode"]');
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
  const forcedMessages = await loadForcedMessages(forceLang);

  injectContentScriptIntoActiveTab();
  setupSecondarySection();
  setupLanguageSelect(forceLang);
  setupOtherExtensionsLink();
  applyPopupTexts(forcedMessages);

  chrome.storage.local.get(DEFAULT_SETTINGS, (stored) => {
    const settings = {
      enabled: sanitizeEnabled(stored.enabled),
      mode: sanitizeMode(stored.mode)
    };

    toggle.checked = settings.enabled;

    const selected = document.querySelector(`input[name="mode"][value="${settings.mode}"]`);
    if (selected) selected.checked = true;

    chrome.storage.local.set(settings);
  });
}

initializePopup();

toggle.addEventListener("change", () => {
  chrome.storage.local.set({ enabled: sanitizeEnabled(toggle.checked) });
});

radios.forEach((radio) => {
  radio.addEventListener("change", () => {
    if (!radio.checked) return;
    chrome.storage.local.set({ mode: sanitizeMode(radio.value) });
  });
});
