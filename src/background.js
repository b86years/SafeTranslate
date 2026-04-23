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
      loadSettingsBundle().then(function (bundle) {
        var settings = siteConfig.readSettings(bundle.sync);
        settings.providerApiKey = bundle.local[ST.STORAGE_LOCAL.PROVIDER_API_KEY] || '';
        settings.hasProviderApiKey = Boolean(settings.providerApiKey);
        sendResponse(settings);
      });
      return true;

    case ST.MESSAGES.UPDATE_SETTINGS:
      updateSettings(msg.payload, msg.tabId)
        .then(function () {
          sendResponse({ ok: true });
        })
        .catch(function (error) {
          sendResponse({
            ok: false,
            error: true,
            message: error && error.message ? error.message : 'Failed to update settings',
          });
        });
      return true;

    // ── Translation request ──

    case ST.MESSAGES.TRANSLATE_TEXT:
      translate(msg.payload, tabId)
        .then(sendResponse)
        .catch(function (error) {
          sendResponse({
            translated: null,
            error: true,
            message: error && error.message ? error.message : 'Translation failed',
          });
        });
      return true;
  }
});

// ──────────────────────────────────────────────
// Translation engine (with LRU cache)
// ──────────────────────────────────────────────

var cache = new Map();
var CACHE_LIMIT = 500;

async function translate(payload, tabId) {
  var settingsBundle = await loadSettingsBundle();
  var resolved = siteConfig.resolveSiteSettings(
    payload && payload.url ? payload.url : '',
    settingsBundle.sync
  );
  var text = payload.text;
  var lang = payload.targetLang || resolved.targetLanguage || ST.DEFAULTS.TARGET_LANGUAGE;
  var provider =
    payload.provider ||
    resolved.translationProvider ||
    ST.DEFAULTS.TRANSLATION_PROVIDER;
  var providerBaseUrl =
    payload.baseUrl || resolved.providerBaseUrl || ST.DEFAULTS.PROVIDER_BASE_URL;
  var providerModel =
    payload.model || resolved.providerModel || ST.DEFAULTS.PROVIDER_MODEL;
  var sourceLanguage = payload.sourceLanguage || 'auto';
  var key = [provider, providerBaseUrl, providerModel, sourceLanguage, lang, text].join('\t');

  if (!text) {
    return { translated: null, error: true, message: 'No text to translate' };
  }

  // LRU cache hit → move to end
  if (cache.has(key)) {
    var hit = cache.get(key);
    cache.delete(key);
    cache.set(key, hit);
    return { translated: hit, provider: provider, cached: true };
  }

  var result;

  if (provider === ST.PROVIDERS.BUILT_IN) {
    result = await translateViaPage(tabId, {
      text: text,
      targetLang: lang,
      sourceLanguage: sourceLanguage,
      url: payload.url || '',
    });
  } else if (provider === ST.PROVIDERS.OPENAI_COMPATIBLE) {
    result = await translateWithOpenAICompatible({
      text: text,
      sourceLanguage: sourceLanguage,
      targetLang: lang,
      baseUrl: providerBaseUrl,
      model: providerModel,
      apiKey: settingsBundle.local[ST.STORAGE_LOCAL.PROVIDER_API_KEY] || '',
    });
  } else if (provider === ST.PROVIDERS.OLLAMA) {
    result = await translateWithOllama({
      text: text,
      sourceLanguage: sourceLanguage,
      targetLang: lang,
      baseUrl: providerBaseUrl,
      model: providerModel,
    });
  } else {
    throw new Error('Unsupported provider: ' + provider);
  }

  if (result && result.translated) {
    // Evict oldest entry if cache is full
    if (cache.size >= CACHE_LIMIT) {
      cache.delete(cache.keys().next().value);
    }
    cache.set(key, result.translated);
  }

  return Object.assign({ provider: provider }, result);
}

function updateSettings(payload, tabId) {
  var split = splitSettingsPayload(payload || {});
  var tasks = [];

  if (Object.keys(split.sync).length > 0) {
    tasks.push(storageSyncSet(split.sync));
  }

  if (Object.keys(split.local).length > 0) {
    tasks.push(storageLocalSet(split.local));
  }

  return Promise.all(tasks).then(function () {
    var broadcastPayload = Object.assign({}, split.sync);
    if (Object.prototype.hasOwnProperty.call(split.local, ST.STORAGE_LOCAL.PROVIDER_API_KEY)) {
      broadcastPayload.hasProviderApiKey = Boolean(
        split.local[ST.STORAGE_LOCAL.PROVIDER_API_KEY]
      );
    }
    broadcastSettings(broadcastPayload, tabId);
  });
}

function splitSettingsPayload(payload) {
  var sync = Object.assign({}, payload);
  var local = {};

  if (Object.prototype.hasOwnProperty.call(sync, 'providerApiKey')) {
    local[ST.STORAGE_LOCAL.PROVIDER_API_KEY] = sync.providerApiKey || '';
    delete sync.providerApiKey;
  }

  return {
    sync: sync,
    local: local,
  };
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
        url: tab.url || '',
      }, tab.id).then(function (result) {
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

function loadSettingsBundle() {
  return Promise.all([
    storageSyncGet(null),
    storageLocalGet({
      providerApiKey: '',
    }),
  ]).then(function (results) {
    return {
      sync: results[0],
      local: results[1],
    };
  });
}

function storageSyncGet(keys) {
  return new Promise(function (resolve) {
    chrome.storage.sync.get(keys, function (data) {
      resolve(data || {});
    });
  });
}

function storageSyncSet(payload) {
  return new Promise(function (resolve, reject) {
    chrome.storage.sync.set(payload, function () {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve();
    });
  });
}

function storageLocalGet(keys) {
  return new Promise(function (resolve) {
    chrome.storage.local.get(keys, function (data) {
      resolve(data || {});
    });
  });
}

function storageLocalSet(payload) {
  return new Promise(function (resolve, reject) {
    chrome.storage.local.set(payload, function () {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve();
    });
  });
}

function sendMessageToTab(tabId, message) {
  return new Promise(function (resolve, reject) {
    if (!tabId) {
      reject(new Error('Page translation requires an active tab'));
      return;
    }

    chrome.tabs.sendMessage(tabId, message, function (response) {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response || null);
    });
  });
}

async function translateViaPage(tabId, payload) {
  var response = await sendMessageToTab(tabId, {
    type: ST.MESSAGES.TRANSLATE_VIA_PAGE,
    payload: payload,
  });

  if (!response || response.error) {
    throw new Error(
      response && response.message
        ? response.message
        : 'Built-in translation is unavailable on this page'
    );
  }

  return response;
}

async function translateWithOpenAICompatible(payload) {
  if (!payload.baseUrl) {
    throw new Error('OpenAI compatible API base URL is required');
  }
  if (!payload.model) {
    throw new Error('OpenAI compatible model is required');
  }
  if (!payload.apiKey) {
    throw new Error('API key is required for OpenAI compatible provider');
  }

  var body = {
    model: payload.model,
    messages: [
      {
        role: 'system',
        content:
          'You translate text faithfully. Return only the translated text with no commentary.',
      },
      {
        role: 'user',
        content:
          'Translate the following text from ' +
          payload.sourceLanguage +
          ' to ' +
          payload.targetLang +
          ':\n\n' +
          payload.text,
      },
    ],
    temperature: 0.1,
    stream: false,
  };

  var data = await postJson(normalizeOpenAIBaseUrl(payload.baseUrl), body, {
    Authorization: 'Bearer ' + payload.apiKey,
  });
  var translated =
    data &&
    data.choices &&
    data.choices[0] &&
    data.choices[0].message &&
    data.choices[0].message.content
      ? String(data.choices[0].message.content).trim()
      : '';

  if (!translated) {
    throw new Error('OpenAI compatible provider returned an empty response');
  }

  return { translated: translated };
}

async function translateWithOllama(payload) {
  if (!payload.model) {
    throw new Error('Ollama model is required');
  }

  var endpoint = normalizeOllamaBaseUrl(payload.baseUrl);
  var data = await postJson(endpoint, {
    model: payload.model,
    prompt:
      'Translate the following text from ' +
      payload.sourceLanguage +
      ' to ' +
      payload.targetLang +
      '. Return only the translated text.\n\n' +
      payload.text,
    stream: false,
    options: {
      temperature: 0.1,
    },
  });

  var translated = data && data.response ? String(data.response).trim() : '';
  if (!translated) {
    throw new Error('Ollama returned an empty response');
  }

  return { translated: translated };
}

async function postJson(url, body, headers) {
  var controller = new AbortController();
  var timeoutId = setTimeout(function () {
    controller.abort();
  }, ST.DEFAULTS.REQUEST_TIMEOUT_MS);

  var res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: Object.assign(
        {
          'Content-Type': 'application/json',
        },
        headers || {}
      ),
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!res.ok) {
    throw new Error('Provider API ' + res.status);
  }

  return await res.json();
}

function normalizeOpenAIBaseUrl(baseUrl) {
  return String(baseUrl || '')
    .replace(/\/+$/, '')
    .replace(/\/chat\/completions$/, '') + '/chat/completions';
}

function normalizeOllamaBaseUrl(baseUrl) {
  var value = String(baseUrl || 'http://127.0.0.1:11434').replace(/\/+$/, '');
  if (/\/api\/generate$/.test(value)) return value;
  return value + '/api/generate';
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
