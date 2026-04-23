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
    activeTranslationCount: 0,
    loadingFrameIndex: 0,
    loadingTimer: null,
    loadingStopTimer: null,
    isVisualLoading: false,
    visualLoadingUntil: 0,
    lastTranslationStartedAt: 0,
    lastTranslationFinishedAt: 0,
  };
}

function getTabState(tabId) {
  if (!tabStates.has(tabId)) {
    tabStates.set(tabId, createTabState());
  }
  return tabStates.get(tabId);
}

chrome.tabs.onRemoved.addListener(function (tabId) {
  clearLoadingAnimation(tabId, tabStates.get(tabId));
  tabStates.delete(tabId);
});

chrome.tabs.onUpdated.addListener(function (tabId, changeInfo) {
  if (changeInfo.status === 'loading') {
    clearLoadingAnimation(tabId, tabStates.get(tabId));
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

var DEFAULT_ACTION_ICON = {
  16: 'icons/icon16.png',
  48: 'icons/icon48.png',
};

var LOADING_ICON_SIZES = [16, 32];
var LOADING_ICON_INTERVAL_MS = 120;
var LOADING_ICON_FRAME_COUNT = 15;
var MIN_LOADING_VISIBLE_MS = 1000;
var loadingIconFrames = null;

function setBadge(tabId, status) {
  var cfg = BADGE_MAP[status] || BADGE_MAP.idle;
  chrome.action.setBadgeText({ tabId: tabId, text: cfg.text });
  chrome.action.setBadgeBackgroundColor({ tabId: tabId, color: cfg.color });
}

function setDefaultActionIcon(tabId) {
  if (!tabId) {
    return;
  }

  chrome.action.setIcon({
    tabId: tabId,
    path: DEFAULT_ACTION_ICON,
  });
}

function clearLoadingAnimation(tabId, state) {
  var targetState = state || tabStates.get(tabId);

  if (targetState && targetState.loadingTimer) {
    clearInterval(targetState.loadingTimer);
  }
  if (targetState && targetState.loadingStopTimer) {
    clearTimeout(targetState.loadingStopTimer);
  }

  if (targetState) {
    targetState.activeTranslationCount = 0;
    targetState.loadingFrameIndex = 0;
    targetState.loadingTimer = null;
    targetState.loadingStopTimer = null;
    targetState.isVisualLoading = false;
    targetState.visualLoadingUntil = 0;
  }

  setDefaultActionIcon(tabId);
}

function startLoadingAnimation(tabId) {
  if (!tabId) {
    return;
  }

  var state = getTabState(tabId);
  var now = Date.now();
  var wasIdle = state.activeTranslationCount === 0;

  state.activeTranslationCount += 1;
  state.isVisualLoading = true;
  if (wasIdle) {
    state.lastTranslationStartedAt = now;
  }
  state.visualLoadingUntil = Math.max(state.visualLoadingUntil || 0, now + MIN_LOADING_VISIBLE_MS);

  if (state.loadingStopTimer) {
    clearTimeout(state.loadingStopTimer);
    state.loadingStopTimer = null;
  }

  if (state.loadingTimer) {
    return;
  }

  var frames = getLoadingIconFrames();
  if (!frames.length) {
    return;
  }

  state.loadingFrameIndex = 0;
  applyLoadingFrame(tabId, state.loadingFrameIndex);
  state.loadingTimer = setInterval(function () {
    var liveState = tabStates.get(tabId);

    if (!liveState || liveState.activeTranslationCount <= 0) {
      clearLoadingAnimation(tabId, liveState);
      return;
    }

    liveState.loadingFrameIndex =
      (liveState.loadingFrameIndex + 1) % frames.length;
    applyLoadingFrame(tabId, liveState.loadingFrameIndex);
  }, LOADING_ICON_INTERVAL_MS);
}

function stopLoadingAnimation(tabId) {
  var state = tabStates.get(tabId);

  if (!state) {
    setDefaultActionIcon(tabId);
    return;
  }

  state.activeTranslationCount = Math.max(0, state.activeTranslationCount - 1);
  if (state.activeTranslationCount > 0) {
    return;
  }

  if (state.loadingStopTimer) {
    clearTimeout(state.loadingStopTimer);
    state.loadingStopTimer = null;
  }

  var remaining = Math.max(0, (state.visualLoadingUntil || 0) - Date.now());
  if (remaining > 0) {
    state.loadingStopTimer = setTimeout(function () {
      var liveState = tabStates.get(tabId);

      if (!liveState) {
        setDefaultActionIcon(tabId);
        return;
      }

      liveState.loadingStopTimer = null;
      if (liveState.activeTranslationCount > 0) {
        return;
      }

      finishLoadingAnimation(tabId, liveState);
    }, remaining);
    return;
  }

  finishLoadingAnimation(tabId, state);
}

function finishLoadingAnimation(tabId, state) {
  if (state) {
    state.lastTranslationFinishedAt = Date.now();
  }

  clearLoadingAnimation(tabId, state);
}

function applyLoadingFrame(tabId, frameIndex) {
  var frames = getLoadingIconFrames();
  var frame = frames[frameIndex % frames.length];

  if (!frame) {
    return;
  }

  chrome.action.setIcon({
    tabId: tabId,
    imageData: frame,
  });
}

function getLoadingIconFrames() {
  if (loadingIconFrames) {
    return loadingIconFrames;
  }

  if (typeof OffscreenCanvas === 'undefined') {
    loadingIconFrames = [];
    return loadingIconFrames;
  }

  loadingIconFrames = [];

  for (var frameIndex = 0; frameIndex < LOADING_ICON_FRAME_COUNT; frameIndex += 1) {
    var frame = {};

    LOADING_ICON_SIZES.forEach(function (size) {
      frame[size] = drawLoadingIconFrame(size, frameIndex);
    });

    loadingIconFrames.push(frame);
  }

  return loadingIconFrames;
}

function drawLoadingIconFrame(size, frameIndex) {
  var canvas = new OffscreenCanvas(size, size);
  var ctx = canvas.getContext('2d');

  if (!ctx) {
    return null;
  }

  drawLoadingBackground(ctx, size);
  drawLoadingGrid(ctx, size, frameIndex);
  drawLoadingLabel(ctx, size);
  return ctx.getImageData(0, 0, size, size);
}

function drawLoadingBackground(ctx, size) {
  var gradient = ctx.createLinearGradient(0, 0, size, size);

  gradient.addColorStop(0, '#6757ff');
  gradient.addColorStop(1, '#3d32c3');

  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
  fillGridCell(ctx, size, 1, 2, 14, 1);
  fillGridCell(ctx, size, 2, 12, 11, 1);
}

function drawLoadingGrid(ctx, size, frameIndex) {
  var cells = [
    { x: 1, y: 1 },
    { x: 4, y: 1 },
    { x: 7, y: 1 },
    { x: 10, y: 1 },
    { x: 13, y: 1 },
    { x: 13, y: 4 },
    { x: 13, y: 7 },
    { x: 13, y: 10 },
    { x: 10, y: 13 },
    { x: 7, y: 13 },
    { x: 4, y: 13 },
    { x: 1, y: 13 },
    { x: 1, y: 10 },
    { x: 1, y: 7 },
    { x: 1, y: 4 },
  ];
  var activeIndex = frameIndex % cells.length;

  cells.forEach(function (cell, index) {
    var distance = (index - activeIndex + cells.length) % cells.length;
    var color = 'rgba(255, 255, 255, 0.16)';

    if (distance === 0) {
      color = '#ecfeff';
    } else if (distance === 1 || distance === 2) {
      color = 'rgba(165, 243, 252, 0.92)';
    } else if (distance === 3) {
      color = 'rgba(125, 211, 252, 0.65)';
    }

    ctx.fillStyle = color;
    fillGridCell(ctx, size, cell.x, cell.y, 2, 2);
  });
}

function drawLoadingLabel(ctx, size) {
  var sGlyph = [
    '11111',
    '10000',
    '10000',
    '11111',
    '00001',
    '00001',
    '11111',
  ];
  var tGlyph = [
    '11111',
    '00100',
    '00100',
    '00100',
    '00100',
    '00100',
    '00100',
  ];

  ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
  drawGlyph(ctx, size, sGlyph, 3, 5, 1, 1);
  drawGlyph(ctx, size, tGlyph, 9, 5, 1, 1);

  ctx.fillStyle = '#ffffff';
  drawGlyph(ctx, size, sGlyph, 3, 4, 1, 1);
  drawGlyph(ctx, size, tGlyph, 9, 4, 1, 1);
}

function drawGlyph(ctx, size, rows, originX, originY, cellWidth, cellHeight) {
  rows.forEach(function (row, rowIndex) {
    for (var colIndex = 0; colIndex < row.length; colIndex += 1) {
      if (row.charAt(colIndex) !== '1') {
        continue;
      }

      fillGridCell(
        ctx,
        size,
        originX + colIndex * cellWidth,
        originY + rowIndex * cellHeight,
        cellWidth,
        cellHeight
      );
    }
  });
}

function fillGridCell(ctx, size, x, y, width, height) {
  var unit = size / 16;
  var left = Math.round(x * unit);
  var top = Math.round(y * unit);
  var cellWidth = Math.max(1, Math.round(width * unit));
  var cellHeight = Math.max(1, Math.round(height * unit));

  ctx.fillRect(left, top, cellWidth, cellHeight);
}

function getTabActivity(tabId) {
  var state = tabId ? tabStates.get(tabId) : null;

  if (!state) {
    return {
      activeTranslationCount: 0,
      isVisualLoading: false,
      visualLoadingUntil: 0,
      lastTranslationStartedAt: 0,
      lastTranslationFinishedAt: 0,
    };
  }

  return {
    activeTranslationCount: state.activeTranslationCount || 0,
    isVisualLoading: Boolean(state.isVisualLoading),
    visualLoadingUntil: state.visualLoadingUntil || 0,
    lastTranslationStartedAt: state.lastTranslationStartedAt || 0,
    lastTranslationFinishedAt: state.lastTranslationFinishedAt || 0,
  };
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

    case ST.MESSAGES.GET_TAB_ACTIVITY:
      sendResponse(getTabActivity(msg.tabId || tabId));
      return true;

    case ST.MESSAGES.GET_OLLAMA_MODELS:
      listOllamaModels(msg.payload || {})
        .then(sendResponse)
        .catch(function (error) {
          sendResponse({
            ok: false,
            error: true,
            models: [],
            message: error && error.message ? error.message : 'Failed to load Ollama models',
          });
        });
      return true;

    case ST.MESSAGES.CHECK_PROVIDER_STATUS:
      checkProviderStatus(msg.payload || {})
        .then(sendResponse)
        .catch(function (error) {
          sendResponse({
            kind: 'error',
            label: '無法檢查',
            detail: error && error.message ? error.message : 'Failed to check provider status',
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
var inFlightTranslations = new Map();
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
  var providerBaseUrl = getProviderBaseUrl(
    provider,
    payload.baseUrl || resolved.providerBaseUrl || ST.DEFAULTS.PROVIDER_BASE_URL
  );
  var providerModel = payload.model || resolved.providerModel || ST.DEFAULTS.PROVIDER_MODEL;
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

  if (inFlightTranslations.has(key)) {
    return await inFlightTranslations.get(key);
  }

  startLoadingAnimation(tabId);

  var translationTask = (async function () {
    var result;

    if (provider === ST.PROVIDERS.BUILT_IN) {
      result = await translateViaPage(tabId, {
        text: text,
        targetLang: lang,
        sourceLanguage: sourceLanguage,
        url: payload.url || '',
      });
    } else if (provider === ST.PROVIDERS.GOOGLE_TRANSLATE) {
      result = await translateWithGoogleTranslate({
        text: text,
        sourceLanguage: sourceLanguage,
        targetLang: lang,
      });
    } else if (provider === ST.PROVIDERS.OPENROUTER) {
      result = await translateWithOpenRouter({
        text: text,
        sourceLanguage: sourceLanguage,
        targetLang: lang,
        baseUrl: providerBaseUrl,
        model: providerModel,
        apiKey: settingsBundle.local[ST.STORAGE_LOCAL.PROVIDER_API_KEY] || '',
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
      if (cache.size >= CACHE_LIMIT) {
        cache.delete(cache.keys().next().value);
      }
      cache.set(key, result.translated);
    }

    return Object.assign({ provider: provider }, result);
  })();

  inFlightTranslations.set(key, translationTask);

  try {
    return await translationTask;
  } finally {
    inFlightTranslations.delete(key);
    stopLoadingAnimation(tabId);
  }
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

async function translateWithOpenRouter(payload) {
  if (!payload.model) {
    throw new Error('OpenRouter model is required');
  }
  if (!payload.apiKey) {
    throw new Error('API key is required for OpenRouter');
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

  var data = await postJson(normalizeOpenAIBaseUrl(payload.baseUrl), body, buildOpenRouterHeaders(payload.apiKey));
  var translated =
    data &&
    data.choices &&
    data.choices[0] &&
    data.choices[0].message &&
    data.choices[0].message.content
      ? String(data.choices[0].message.content).trim()
      : '';

  if (!translated) {
    throw new Error('OpenRouter returned an empty response');
  }

  return { translated: translated };
}

async function translateWithGoogleTranslate(payload) {
  var params = new URLSearchParams({
    client: 'gtx',
    sl: normalizeGoogleLanguage(payload.sourceLanguage || 'auto'),
    tl: normalizeGoogleLanguage(payload.targetLang),
    dt: 't',
    q: payload.text,
  });
  var endpoint = 'https://translate.googleapis.com/translate_a/single?' + params.toString();
  var data = await fetchAnyJson(endpoint);
  var translated = extractGoogleTranslateText(data);

  if (!translated) {
    throw new Error('Google Translate returned an empty response');
  }

  return { translated: translated };
}

async function translateWithOllama(payload) {
  if (!payload.model) {
    throw new Error('Ollama model is required');
  }

  var systemPrompt =
    'You are a professional translation engine. Return only the translated text without explanations.';
  var userPrompt =
    'Translate the following text from ' +
    payload.sourceLanguage +
    ' to ' +
    payload.targetLang +
    '. Return only the translated text.\n\n' +
    payload.text;
  var attempts = [
    {
      endpoint: normalizeOllamaChatCompletionsUrl(payload.baseUrl),
      body: {
        model: payload.model,
        stream: false,
        temperature: 0.1,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      },
      pick: function (data) {
        return data &&
          data.choices &&
          data.choices[0] &&
          data.choices[0].message &&
          data.choices[0].message.content
          ? String(data.choices[0].message.content).trim()
          : '';
      },
    },
    {
      endpoint: normalizeOllamaNativeChatUrl(payload.baseUrl),
      body: {
        model: payload.model,
        stream: false,
        options: {
          temperature: 0.1,
        },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      },
      pick: function (data) {
        return data && data.message && data.message.content
          ? String(data.message.content).trim()
          : '';
      },
    },
    {
      endpoint: normalizeOllamaGenerateUrl(payload.baseUrl),
      body: {
        model: payload.model,
        prompt: userPrompt,
        stream: false,
        options: {
          temperature: 0.1,
        },
      },
      pick: function (data) {
        return data && data.response ? String(data.response).trim() : '';
      },
    },
  ];
  var lastError = null;
  var attemptErrors = [];

  for (var i = 0; i < attempts.length; i++) {
    var attempt = attempts[i];

    try {
      var data = await postJson(attempt.endpoint, attempt.body);
      var translated = attempt.pick(data);

      if (translated) {
        return { translated: translated };
      }

      lastError = new Error('Ollama returned an empty response from ' + attempt.endpoint);
    } catch (error) {
      lastError = buildOllamaRequestError(error, attempt.endpoint);
      attemptErrors.push(lastError.message);
    }
  }

  if (attemptErrors.length && allOllamaAttemptsForbidden(attemptErrors)) {
    throw new Error(getOllamaForbiddenHelpMessage());
  }

  throw lastError || new Error('Ollama translation failed');
}

async function listOllamaModels(payload) {
  var endpoint = normalizeOllamaTagsUrl(payload.baseUrl);
  var data;

  try {
    data = await fetchJson(endpoint, null, ST.DEFAULTS.STATUS_CHECK_TIMEOUT_MS);
  } catch (error) {
    throw buildOllamaRequestError(error, endpoint);
  }

  var rawModels = data && Array.isArray(data.models) ? data.models : [];
  var models = rawModels
    .map(function (item) {
      return {
        name: item && item.name ? String(item.name) : '',
        size: item && item.size ? item.size : 0,
        family:
          item && item.details && item.details.family
            ? String(item.details.family)
            : '',
        parameterSize:
          item && item.details && item.details.parameter_size
            ? String(item.details.parameter_size)
            : '',
      };
    })
    .filter(function (item) {
      return Boolean(item.name);
    });

  models.sort(function (a, b) {
    return a.name.localeCompare(b.name);
  });

  return {
    ok: true,
    models: models,
    endpoint: endpoint,
  };
}

async function checkProviderStatus(payload) {
  var settingsBundle = await loadSettingsBundle();
  var syncSettings = siteConfig.readSettings(settingsBundle.sync);
  var provider =
    payload.provider ||
    syncSettings.translationProvider ||
    ST.DEFAULTS.TRANSLATION_PROVIDER;

  if (provider === ST.PROVIDERS.GOOGLE_TRANSLATE) {
    return await checkGoogleTranslateStatus({
      targetLang: syncSettings.targetLanguage || ST.DEFAULTS.TARGET_LANGUAGE,
    });
  }

  if (provider === ST.PROVIDERS.OPENROUTER) {
    return await checkOpenRouterStatus({
      baseUrl: getProviderBaseUrl(
        provider,
        payload.baseUrl || syncSettings.providerBaseUrl || ''
      ),
      model: payload.model || syncSettings.providerModel || '',
      apiKey: settingsBundle.local[ST.STORAGE_LOCAL.PROVIDER_API_KEY] || '',
    });
  }

  if (provider === ST.PROVIDERS.OPENAI_COMPATIBLE) {
    return await checkOpenAICompatibleStatus({
      baseUrl: getProviderBaseUrl(
        provider,
        payload.baseUrl || syncSettings.providerBaseUrl || ''
      ),
      model: payload.model || syncSettings.providerModel || '',
      apiKey: settingsBundle.local[ST.STORAGE_LOCAL.PROVIDER_API_KEY] || '',
    });
  }

  if (provider === ST.PROVIDERS.OLLAMA) {
    return await checkOllamaStatus({
      baseUrl: payload.baseUrl || syncSettings.providerBaseUrl || '',
      model: payload.model || syncSettings.providerModel || '',
    });
  }

  return {
    kind: 'warning',
    label: '請在頁面檢查',
    detail: 'Chrome 內建 AI 需要在目前分頁中檢查可用性。',
  };
}

async function checkOpenRouterStatus(payload) {
  if (!payload.apiKey) {
    return {
      kind: 'warning',
      label: '缺少 API Key',
      detail: '請先填入 OpenRouter API Key。',
    };
  }
  if (!payload.model) {
    return {
      kind: 'warning',
      label: '缺少 Model',
      detail: '請先設定要使用的 OpenRouter 模型名稱。',
    };
  }

  var endpoint = normalizeOpenAIModelsUrl(payload.baseUrl);
  var data = await fetchJson(endpoint, buildOpenRouterHeaders(payload.apiKey));
  var models = data && Array.isArray(data.data) ? data.data : [];
  var matched = false;

  for (var i = 0; i < models.length; i++) {
    if (models[i] && models[i].id === payload.model) {
      matched = true;
      break;
    }
  }

  if (matched) {
    return {
      kind: 'available',
      label: '可用',
      detail: '已連線到 OpenRouter，且可使用模型 ' + payload.model + '。',
    };
  }

  if (models.length) {
    return {
      kind: 'warning',
      label: '模型未列出',
      detail: 'OpenRouter 可連線，但 models 清單中找不到 ' + payload.model + '。',
    };
  }

  return {
    kind: 'warning',
    label: '清單為空',
    detail: 'OpenRouter 可連線，但沒有回傳可用模型。',
  };
}

async function checkOpenAICompatibleStatus(payload) {
  if (!payload.baseUrl) {
    return {
      kind: 'warning',
      label: '缺少 Base URL',
      detail: '請先設定 OpenAI 相容 API 的 Base URL。',
    };
  }
  if (!payload.apiKey) {
    return {
      kind: 'warning',
      label: '缺少 API Key',
      detail: '請先填入 API Key。',
    };
  }
  if (!payload.model) {
    return {
      kind: 'warning',
      label: '缺少 Model',
      detail: '請先設定要使用的模型名稱。',
    };
  }

  var endpoint = normalizeOpenAIModelsUrl(payload.baseUrl);
  var data = await fetchJson(endpoint, {
    Authorization: 'Bearer ' + payload.apiKey,
  });
  var models = data && Array.isArray(data.data) ? data.data : [];
  var matched = false;

  for (var i = 0; i < models.length; i++) {
    if (models[i] && models[i].id === payload.model) {
      matched = true;
      break;
    }
  }

  if (matched) {
    return {
      kind: 'available',
      label: '可用',
      detail: '已連線到 API，且可使用模型 ' + payload.model + '。',
    };
  }

  if (models.length) {
    return {
      kind: 'warning',
      label: '模型未列出',
      detail: '端點可連線，但 models 清單中找不到 ' + payload.model + '。',
    };
  }

  return {
    kind: 'warning',
    label: '清單為空',
    detail: '端點可連線，但沒有回傳可用模型。',
  };
}

async function checkOllamaStatus(payload) {
  if (!payload.model) {
    return {
      kind: 'warning',
      label: '尚未選擇模型',
      detail: '請先選擇要使用的 Ollama 模型。',
    };
  }

  var data = await listOllamaModels({ baseUrl: payload.baseUrl });
  var models = data && Array.isArray(data.models) ? data.models : [];
  var matched = false;

  for (var i = 0; i < models.length; i++) {
    if (models[i] && models[i].name === payload.model) {
      matched = true;
      break;
    }
  }

  if (matched) {
    try {
      await translateWithOllama({
        model: payload.model,
        baseUrl: payload.baseUrl,
        sourceLanguage: 'en',
        targetLang: 'zh-TW',
        text: 'Hello world',
      });

      return {
        kind: 'available',
        label: '可用',
        detail: '已連線到 Ollama，且模型 ' + payload.model + ' 可成功回應翻譯請求。',
      };
    } catch (error) {
      return {
        kind: 'error',
        label: '翻譯失敗',
        detail: error && error.message ? error.message : 'Ollama 無法完成翻譯請求。',
      };
    }
  }

  if (models.length) {
    return {
      kind: 'warning',
      label: '模型未安裝',
      detail: 'Ollama 可連線，但目前清單中沒有 ' + payload.model + '。',
    };
  }

  return {
    kind: 'warning',
    label: '沒有模型',
    detail: 'Ollama 可連線，但目前沒有任何本機模型。',
  };
}

async function checkGoogleTranslateStatus(payload) {
  try {
    await translateWithGoogleTranslate({
      text: 'Hello world',
      sourceLanguage: 'en',
      targetLang: payload.targetLang || ST.DEFAULTS.TARGET_LANGUAGE,
    });

    return {
      kind: 'available',
      label: '可用',
      detail: '已成功連線到 Google 翻譯公開端點。',
    };
  } catch (error) {
    return {
      kind: 'error',
      label: '翻譯失敗',
      detail: error && error.message ? error.message : 'Google 翻譯無法完成請求。',
    };
  }
}

async function postJson(url, body, headers, timeoutMs) {
  var controller = new AbortController();
  var timeoutId = setTimeout(function () {
    controller.abort();
  }, timeoutMs || ST.DEFAULTS.REQUEST_TIMEOUT_MS);

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

async function fetchJson(url, headers, timeoutMs) {
  var controller = new AbortController();
  var timeoutId = setTimeout(function () {
    controller.abort();
  }, timeoutMs || ST.DEFAULTS.REQUEST_TIMEOUT_MS);

  var res;
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: headers || {},
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

async function fetchAnyJson(url, headers, timeoutMs) {
  var controller = new AbortController();
  var timeoutId = setTimeout(function () {
    controller.abort();
  }, timeoutMs || ST.DEFAULTS.REQUEST_TIMEOUT_MS);

  var res;
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: headers || {},
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

function extractGoogleTranslateText(data) {
  if (!data || !Array.isArray(data) || !Array.isArray(data[0])) {
    return '';
  }

  var chunks = [];

  for (var i = 0; i < data[0].length; i++) {
    var item = data[0][i];
    if (item && item[0]) {
      chunks.push(String(item[0]));
    }
  }

  return chunks.join('').trim();
}

function normalizeGoogleLanguage(language) {
  var value = String(language || 'auto').trim();
  if (!value || value === 'auto') return 'auto';
  return value;
}

function buildOpenRouterHeaders(apiKey) {
  return {
    Authorization: 'Bearer ' + apiKey,
    'X-Title': 'SafeTranslate',
  };
}

function getProviderBaseUrl(provider, configuredBaseUrl) {
  if (provider === ST.PROVIDERS.OPENROUTER) {
    return String(configuredBaseUrl || 'https://openrouter.ai/api/v1').trim();
  }

  return String(configuredBaseUrl || '').trim();
}

function normalizeOpenAIBaseUrl(baseUrl) {
  return String(baseUrl || '')
    .replace(/\/+$/, '')
    .replace(/\/chat\/completions$/, '') + '/chat/completions';
}

function normalizeOpenAIModelsUrl(baseUrl) {
  return String(baseUrl || '')
    .replace(/\/+$/, '')
    .replace(/\/chat\/completions$/, '')
    .replace(/\/models$/, '') + '/models';
}

function normalizeOllamaRootUrl(baseUrl) {
  var value = String(baseUrl || 'http://127.0.0.1:11434').replace(/\/+$/, '');
  return value.replace(/\/(api\/(generate|chat|tags)|v1\/chat\/completions)$/, '');
}

function normalizeOllamaGenerateUrl(baseUrl) {
  var value = String(baseUrl || 'http://127.0.0.1:11434').replace(/\/+$/, '');
  if (/\/api\/generate$/.test(value)) return value;
  return normalizeOllamaRootUrl(value) + '/api/generate';
}

function normalizeOllamaNativeChatUrl(baseUrl) {
  var value = String(baseUrl || 'http://127.0.0.1:11434').replace(/\/+$/, '');
  if (/\/api\/chat$/.test(value)) return value;
  return normalizeOllamaRootUrl(value) + '/api/chat';
}

function normalizeOllamaChatCompletionsUrl(baseUrl) {
  var value = String(baseUrl || 'http://127.0.0.1:11434').replace(/\/+$/, '');
  if (/\/v1\/chat\/completions$/.test(value)) return value;
  return normalizeOllamaRootUrl(value) + '/v1/chat/completions';
}

function normalizeOllamaTagsUrl(baseUrl) {
  return normalizeOllamaRootUrl(baseUrl) + '/api/tags';
}

function buildOllamaRequestError(error, endpoint) {
  var message = error && error.message ? error.message : 'Unknown error';

  if (/Provider API 403/.test(message)) {
    return new Error(getOllamaForbiddenHelpMessage());
  }

  return new Error('Ollama request failed at ' + endpoint + ': ' + message);
}

function allOllamaAttemptsForbidden(errors) {
  for (var i = 0; i < errors.length; i++) {
    if (errors[i] !== getOllamaForbiddenHelpMessage()) {
      return false;
    }
  }
  return errors.length > 0;
}

function getOllamaForbiddenHelpMessage() {
  return 'Ollama 拒絕了瀏覽器擴充來源（HTTP 403）。請設定 OLLAMA_ORIGINS=*，Windows 另外確認 OLLAMA_HOST=0.0.0.0，然後完整重啟 Ollama；Base URL 建議使用 http://127.0.0.1:11434/v1/chat/completions。';
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
