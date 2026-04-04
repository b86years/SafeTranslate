/**
 * SafeTranslate — Background Service Worker
 * Manages per-tab state, handles translation API calls,
 * and coordinates popup ↔ content-script communication.
 */
importScripts('lib/constants.js');

var ST = globalThis.__SAFE_TRANSLATE__;

// ──────────────────────────────────────────────
// Per-tab state
// ──────────────────────────────────────────────

var tabStates = new Map();

function getTabState(tabId) {
  if (!tabStates.has(tabId)) {
    tabStates.set(tabId, {
      status: 'idle',
      isReactSite: false,
      translationDetected: false,
      selectedText: null,
    });
  }
  return tabStates.get(tabId);
}

chrome.tabs.onRemoved.addListener(function (tabId) {
  tabStates.delete(tabId);
});

// ──────────────────────────────────────────────
// Badge
// ──────────────────────────────────────────────

var BADGE_MAP = {
  idle: { text: '', color: ST.BADGE.DISABLED },
  ready: { text: '✓', color: ST.BADGE.ACTIVE },
  active: { text: 'T', color: ST.BADGE.DETECTING },
  protecting: { text: '🛡', color: ST.BADGE.ACTIVE },
  error: { text: '!', color: ST.BADGE.ERROR },
};

function setBadge(tabId, status) {
  var cfg = BADGE_MAP[status] || BADGE_MAP.idle;
  chrome.action.setBadgeText({ tabId: tabId, text: cfg.text });
  chrome.action.setBadgeBackgroundColor({ tabId: tabId, color: cfg.color });
}

// ──────────────────────────────────────────────
// Message router
// ──────────────────────────────────────────────

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  var tabId = sender.tab ? sender.tab.id : null;

  switch (msg.type) {
    // ── Content-script → Background ──

    case ST.MESSAGES.UPDATE_TAB_STATUS:
      if (tabId) {
        Object.assign(getTabState(tabId), msg.payload);
        setBadge(tabId, msg.payload.status);
      }
      break;

    case 'translationDetected':
      if (tabId) {
        getTabState(tabId).translationDetected = true;
        incrementStat();
      }
      break;

    case 'selectedText':
      if (tabId) {
        getTabState(tabId).selectedText = msg.payload;
      }
      break;

    // ── Popup → Background ──

    case ST.MESSAGES.GET_TAB_STATUS:
      sendResponse(msg.tabId ? getTabState(msg.tabId) : null);
      return true;

    case ST.MESSAGES.GET_SETTINGS:
      chrome.storage.sync.get(null, function (raw) {
        sendResponse(withDefaults(raw));
      });
      return true;

    case ST.MESSAGES.UPDATE_SETTINGS:
      chrome.storage.sync.set(msg.payload, function () {
        sendResponse({ ok: true });
      });
      return true;

    // ── Translation request ──

    case ST.MESSAGES.TRANSLATE_TEXT:
      translate(msg.payload)
        .then(sendResponse)
        .catch(function () {
          sendResponse({ translated: null, error: true });
        });
      return true;
  }
});

// ──────────────────────────────────────────────
// Translation engine (with LRU cache)
// ──────────────────────────────────────────────

var cache = new Map();
var CACHE_LIMIT = 500;

async function translate(payload) {
  var text = payload.text;
  var lang = payload.targetLang || ST.DEFAULTS.TARGET_LANGUAGE;
  var key = lang + '\t' + text;

  // LRU cache hit → move to end
  if (cache.has(key)) {
    var hit = cache.get(key);
    cache.delete(key);
    cache.set(key, hit);
    return { translated: hit };
  }

  var url =
    'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=' +
    encodeURIComponent(lang) +
    '&dt=t&q=' +
    encodeURIComponent(text);

  var res = await fetch(url);
  if (!res.ok) throw new Error('API ' + res.status);

  var data = await res.json();
  var out = '';
  if (data && data[0]) {
    for (var i = 0; i < data[0].length; i++) {
      if (data[0][i] && data[0][i][0]) out += data[0][i][0];
    }
  }

  if (out) {
    // Evict oldest entry if cache is full
    if (cache.size >= CACHE_LIMIT) {
      cache.delete(cache.keys().next().value);
    }
    cache.set(key, out);
  }

  return { translated: out || null };
}

// ──────────────────────────────────────────────
// Context menu
// ──────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(function () {
  chrome.contextMenus.create({
    id: 'safe-translate-selection',
    title: chrome.i18n.getMessage('contextMenuTranslate') || '安全翻譯選取文字',
    contexts: ['selection'],
  });
});

chrome.contextMenus.onClicked.addListener(function (info, tab) {
  if (
    info.menuItemId === 'safe-translate-selection' &&
    info.selectionText &&
    tab &&
    tab.id
  ) {
    translate({
      text: info.selectionText,
      targetLang: ST.DEFAULTS.TARGET_LANGUAGE,
    }).then(function (result) {
      if (result.translated) {
        chrome.tabs.sendMessage(tab.id, {
          type: 'showTranslation',
          text: result.translated,
          x: 100,
          y: 100,
        });
      }
    });
  }
});

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function withDefaults(raw) {
  return {
    globalEnabled:
      raw[ST.STORAGE.GLOBAL_ENABLED] !== undefined
        ? raw[ST.STORAGE.GLOBAL_ENABLED]
        : ST.DEFAULTS.GLOBAL_ENABLED,
    protectionMode:
      raw[ST.STORAGE.PROTECTION_MODE] || ST.DEFAULTS.PROTECTION_MODE,
    targetLanguage:
      raw[ST.STORAGE.TARGET_LANGUAGE] || ST.DEFAULTS.TARGET_LANGUAGE,
    siteOverrides: raw[ST.STORAGE.SITE_OVERRIDES] || {},
  };
}

function incrementStat() {
  chrome.storage.local.get({ protectionCount: 0 }, function (d) {
    chrome.storage.local.set({ protectionCount: d.protectionCount + 1 });
  });
}
