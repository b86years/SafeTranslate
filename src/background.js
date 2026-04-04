/**
 * SafeTranslate — Background Service Worker
 * Manages per-tab state, handles translation API calls,
 * and coordinates popup ↔ content-script communication.
 */
importScripts('lib/constants.js', 'lib/site-config.js');

var ST = globalThis.__SAFE_TRANSLATE__;
var siteConfig = globalThis.__SAFE_TRANSLATE_SITE_CONFIG__;

// ──────────────────────────────────────────────
// Per-tab state
// ──────────────────────────────────────────────

var tabStates = new Map();

function createTabState() {
  return {
    status: 'idle',
    isReactSite: false,
    translationDetected: false,
    detectedReason: '',
    handledRemoveChild: 0,
    handledInsertBefore: 0,
    handledReplaceChild: 0,
    lastHandledError: '',
    protectionVersion: '',
    selectionAnchor: null,
    siteKey: '',
  };
}

function getTabState(tabId) {
  if (!tabStates.has(tabId)) {
    tabStates.set(tabId, createTabState());
  }
  return tabStates.get(tabId);
}

chrome.tabs.onRemoved.addListener(function (tabId) {
  tabStates.delete(tabId);
});

chrome.tabs.onUpdated.addListener(function (tabId, changeInfo) {
  if (changeInfo.status === 'loading') {
    tabStates.set(tabId, createTabState());
    setBadge(tabId, 'idle');
  }
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
        var detectedState = getTabState(tabId);
        detectedState.translationDetected = true;
        detectedState.detectedReason = msg.payload && msg.payload.reason
          ? msg.payload.reason
          : detectedState.detectedReason;
        incrementStat();
      }
      break;

    case 'selectedText':
      if (tabId) {
        getTabState(tabId).selectionAnchor = msg.payload;
      }
      break;

    // ── Popup → Background ──

    case ST.MESSAGES.GET_SETTINGS:
      chrome.storage.sync.get(null, function (raw) {
        sendResponse(siteConfig.readSettings(raw));
      });
      return true;

    case ST.MESSAGES.UPDATE_SETTINGS:
      chrome.storage.sync.set(msg.payload, function () {
        broadcastSettings(msg.payload, msg.tabId);
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

  var controller = new AbortController();
  var timeoutId = setTimeout(function () {
    controller.abort();
  }, ST.DEFAULTS.REQUEST_TIMEOUT_MS);

  var res;
  try {
    res = await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }

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
    chrome.storage.sync.get(null, function (raw) {
      var resolved = siteConfig.resolveSiteSettings(tab.url || '', raw);
      var anchor = getTabState(tab.id).selectionAnchor;

      translate({
        text: info.selectionText,
        targetLang: resolved.targetLanguage,
      }).then(function (result) {
        if (result.translated) {
          chrome.tabs.sendMessage(tab.id, {
            type: 'showTranslation',
            text: result.translated,
            x: anchor && anchor.x ? anchor.x : 100,
            y: anchor && anchor.y ? anchor.y : 100,
          });
        }
      });
    });
  }
});

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function incrementStat() {
  chrome.storage.local.get({ protectionCount: 0 }, function (d) {
    chrome.storage.local.set({ protectionCount: d.protectionCount + 1 });
  });
}

function broadcastSettings(_partial, tabId) {
  if (!tabId) return;
  chrome.storage.sync.get(null, function (raw) {
    chrome.tabs.sendMessage(
      tabId,
      {
        type: ST.MESSAGES.SETTINGS_UPDATED,
        payload: raw,
      },
      function () {
        void chrome.runtime.lastError;
      }
    );
  });
}
