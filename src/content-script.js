/**
 * SafeTranslate — Content Script
 * Runs in ISOLATED world at document_idle.
 * Detects React / Next.js, tracks translation activity,
 * manages the selection-translation tooltip, and
 * communicates state to the background service worker.
 */
(function () {
  'use strict';

  var ST = globalThis.__SAFE_TRANSLATE__;
  var siteConfig = globalThis.__SAFE_TRANSLATE_SITE_CONFIG__;
  if (!ST) return;
  if (!siteConfig) return;

  // ──────────────────────────────────────────────
  // Page state
  // ──────────────────────────────────────────────

  var state = {
    isReactSite: false,
    translationDetected: false,
    protectionActive: false,
    detectedReason: '',
    handledRemoveChild: 0,
    handledInsertBefore: 0,
    handledReplaceChild: 0,
    lastHandledError: '',
    protectionVersion: '',
    siteKey: siteConfig.normalizeHost(location.href),
  };
  var hasReportedTranslation = false;
  var currentResolvedSettings = siteConfig.resolveSiteSettings(location.href, {});
  var originalTextByNode = new WeakMap();
  var translatedTargetByNode = new WeakMap();
  var trackedTranslatedNodes = [];
  var autoTranslateTimer = 0;
  var isApplyingAutoTranslation = false;
  var contentObserver = null;
  var AUTO_TRANSLATE_CONCURRENCY = 6;
  var CANDIDATE_SCAN_LIMIT = 400;
  var translationMetrics = createTranslationMetrics();

  function createTranslationMetrics() {
    return {
      completedTranslations: 0,
      translatedCharCount: 0,
      totalDurationMs: 0,
      lastCompletedAt: 0,
    };
  }

  function recordTranslationMetrics(charCount, durationMs) {
    translationMetrics.completedTranslations += 1;
    translationMetrics.translatedCharCount += Math.max(0, Number(charCount || 0));
    translationMetrics.totalDurationMs += Math.max(0, Number(durationMs || 0));
    translationMetrics.lastCompletedAt = Date.now();
  }

  function readRootState() {
    var root = document.documentElement;
    if (!root) return;

    state.protectionActive =
      root.getAttribute(ST.DOM_ATTRS.PROTECTED) === '1';
    state.translationDetected =
      root.getAttribute(ST.DOM_ATTRS.TRANSLATION_DETECTED) === '1';
    state.detectedReason =
      root.getAttribute(ST.DOM_ATTRS.DETECTED_REASON) || state.detectedReason;
    state.protectionVersion =
      root.getAttribute(ST.DOM_ATTRS.VERSION) || state.protectionVersion;
    state.handledRemoveChild = parseInt(
      root.getAttribute(ST.DOM_ATTRS.REMOVE_FALLBACKS) || '0',
      10
    );
    state.handledInsertBefore = parseInt(
      root.getAttribute(ST.DOM_ATTRS.INSERT_FALLBACKS) || '0',
      10
    );
    state.handledReplaceChild = parseInt(
      root.getAttribute(ST.DOM_ATTRS.REPLACE_FALLBACKS) || '0',
      10
    );
    state.lastHandledError =
      root.getAttribute(ST.DOM_ATTRS.LAST_ERROR) || state.lastHandledError;
  }

  // ──────────────────────────────────────────────
  // React / Next.js Detection
  // ──────────────────────────────────────────────

  function detectReact() {
    // Next.js marker
    if (document.querySelector('script#__NEXT_DATA__')) return true;

    // React root markers
    if (document.querySelector('[data-reactroot]')) return true;

    // Check common root element IDs for React internal fibers
    var roots = ['__next', 'root', 'app'];
    for (var i = 0; i < roots.length; i++) {
      var el = document.getElementById(roots[i]);
      if (el && hasReactInternals(el)) return true;
    }
    return false;
  }

  function hasReactInternals(el) {
    var keys = Object.keys(el);
    for (var i = 0; i < keys.length; i++) {
      if (
        keys[i].indexOf('__reactFiber$') === 0 ||
        keys[i].indexOf('__reactInternalInstance$') === 0
      ) {
        return true;
      }
    }
    return false;
  }

  // ──────────────────────────────────────────────
  // MAIN-world event listeners
  // ──────────────────────────────────────────────

  function syncFromDomEvent(event) {
    readRootState();
    if (event && event.detail) {
      state.detectedReason = event.detail.detectedReason || state.detectedReason;
      state.protectionVersion =
        event.detail.version || state.protectionVersion;
    }
    state.isReactSite = state.isReactSite || detectReact();
    syncBadge();

    if (state.translationDetected && !hasReportedTranslation) {
      hasReportedTranslation = true;
      safeSend({
        type: 'translationDetected',
        payload: {
          url: location.href,
          reason: state.detectedReason,
        },
      });
    }
  }

  document.addEventListener(ST.EVENTS.PROTECTION_ACTIVE, syncFromDomEvent);
  document.addEventListener(ST.EVENTS.TRANSLATION_DETECTED, syncFromDomEvent);

  // ──────────────────────────────────────────────
  // Badge sync (content → background)
  // ──────────────────────────────────────────────

  function deriveBadgeStatus() {
    if (!state.protectionActive) return 'error';
    if (state.translationDetected) {
      return state.isReactSite ? 'protecting' : 'active';
    }
    return 'ready';
  }

  function syncBadge() {
    safeSend({
      type: ST.MESSAGES.UPDATE_TAB_STATUS,
      payload: {
        status: deriveBadgeStatus(),
        isReactSite: state.isReactSite,
        translationDetected: state.translationDetected,
        detectedReason: state.detectedReason,
        handledRemoveChild: state.handledRemoveChild,
        handledInsertBefore: state.handledInsertBefore,
        handledReplaceChild: state.handledReplaceChild,
        lastHandledError: state.lastHandledError,
        protectionVersion: state.protectionVersion,
        siteKey: state.siteKey,
      },
    });
  }

  // ──────────────────────────────────────────────
  // Safe message sender (handles context invalidation)
  // ──────────────────────────────────────────────

  function safeSend(message) {
    try {
      return chrome.runtime.sendMessage(message).catch(noop);
    } catch (_) {
      return Promise.resolve();
    }
  }

  function noop() {}

  function loadSettings() {
    chrome.storage.sync.get(null, function (raw) {
      applyResolvedSettings(raw || {});
    });
  }

  function applyResolvedSettings(raw) {
    var previousTarget = currentResolvedSettings.targetLanguage;
    var previousProvider = currentResolvedSettings.translationProvider;
    var previousTranslationPolicy = currentResolvedSettings.siteTranslation;

    currentResolvedSettings = siteConfig.resolveSiteSettings(location.href, raw || {});

    if (
      previousTarget !== currentResolvedSettings.targetLanguage ||
      previousProvider !== currentResolvedSettings.translationProvider ||
      previousTranslationPolicy !== currentResolvedSettings.siteTranslation
    ) {
      restoreTranslatedNodes();
    }

    if (shouldAutoTranslatePage()) {
      scheduleAutoTranslate('settings');
    } else {
      restoreTranslatedNodes();
    }
  }

  function shouldAutoTranslatePage() {
    var translateByPolicy =
      currentResolvedSettings.alwaysTranslate ||
      currentResolvedSettings.autoTranslatePage !== false;

    return (
      window.top === window &&
      currentResolvedSettings.globalEnabled !== false &&
      translateByPolicy &&
      !currentResolvedSettings.neverTranslate
    );
  }

  function scheduleAutoTranslate(_reason) {
    if (!shouldAutoTranslatePage()) return;
    if (autoTranslateTimer) {
      clearTimeout(autoTranslateTimer);
    }
    autoTranslateTimer = setTimeout(function () {
      autoTranslateTimer = 0;
      void autoTranslatePage();
    }, 250);
  }

  async function autoTranslatePage() {
    if (!shouldAutoTranslatePage()) return;
    if (!document.body) return;
    if (isApplyingAutoTranslation) return;

    var snapshot = {
      provider: currentResolvedSettings.translationProvider,
      targetLanguage: currentResolvedSettings.targetLanguage,
      baseUrl: currentResolvedSettings.providerBaseUrl,
      model: currentResolvedSettings.providerModel,
      sourceLanguage: '',
    };
    var nodes = collectCandidateTextNodes(40);

    if (!nodes.length) return;

    isApplyingAutoTranslation = true;
    try {
      snapshot.sourceLanguage = await resolveAutoTranslateSourceLanguage(snapshot.provider);
      await translateNodesWithConcurrency(nodes, snapshot);
    } finally {
      isApplyingAutoTranslation = false;
    }
  }

  async function translateNodesWithConcurrency(nodes, snapshot) {
    var concurrency = Math.min(
      getAutoTranslateConcurrency(snapshot.provider),
      Math.max(nodes.length, 1)
    );
    var nextIndex = 0;
    var workers = [];

    async function worker() {
      while (nextIndex < nodes.length) {
        if (!shouldAutoTranslatePage()) return;

        var node = nodes[nextIndex++];

        try {
          await translateNode(node, snapshot);
        } catch (error) {
          console.warn(
            'SafeTranslate auto translation failed:',
            error && error.message ? error.message : error
          );
        }
      }
    }

    for (var i = 0; i < concurrency; i++) {
      workers.push(worker());
    }

    await Promise.all(workers);
  }

  function getAutoTranslateConcurrency(provider) {
    return AUTO_TRANSLATE_CONCURRENCY;
  }

  function collectCandidateTextNodes(limit) {
    if (!document.body) return [];

    var candidates = [];
    var walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: function (node) {
          return isTranslatableTextNode(node)
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_REJECT;
        },
      }
    );

    while (walker.nextNode() && candidates.length < CANDIDATE_SCAN_LIMIT) {
      candidates.push({
        node: walker.currentNode,
        distance: getNodeViewportDistance(walker.currentNode),
      });
    }

    candidates.sort(function (left, right) {
      return left.distance - right.distance;
    });

    return candidates.slice(0, limit).map(function (entry) {
      return entry.node;
    });
  }

  function isTranslatableTextNode(node) {
    if (!node || !node.parentElement) return false;
    if (!node.nodeValue) return false;

    var text = node.nodeValue.replace(/\s+/g, ' ').trim();
    if (!text || text.length < 3 || text.length > 800) return false;

    var parent = node.parentElement;
    if (!parent.isConnected) return false;
    if (translatedTargetByNode.get(node) === currentResolvedSettings.targetLanguage) {
      return false;
    }
    if (parent.closest('#safe-translate-tooltip')) return false;
    if (parent.closest('[data-safe-translate-skip="1"]')) return false;
    if (parent.closest('script, style, noscript, textarea, input, select, option, code, pre')) {
      return false;
    }
    if (parent.closest('[contenteditable="true"]')) return false;
    if (parent.getClientRects().length === 0) return false;

    return true;
  }

  function getNodeViewportDistance(node) {
    if (!node || !node.parentElement) return Number.MAX_SAFE_INTEGER;

    var rect = node.parentElement.getBoundingClientRect();
    var viewportTop = 0;
    var viewportBottom = window.innerHeight || document.documentElement.clientHeight || 0;
    var margin = 200;

    if (rect.bottom >= viewportTop - margin && rect.top <= viewportBottom + margin) {
      return 0;
    }

    if (rect.top > viewportBottom) {
      return rect.top - viewportBottom;
    }

    return viewportTop - rect.bottom;
  }

  async function translateNode(node, snapshot) {
    if (!node || !node.parentElement || !node.isConnected) return;

    var originalText = originalTextByNode.has(node)
      ? originalTextByNode.get(node)
      : node.nodeValue;
    var text = String(originalText || '').replace(/\s+/g, ' ').trim();

    if (!text) return;
    if (translatedTargetByNode.get(node) === snapshot.targetLanguage) return;

    var sourceLanguage = snapshot.sourceLanguage || '';
    if (!sourceLanguage) {
      sourceLanguage = await determineSourceLanguage(node, text, snapshot.provider);
    }
    if (!sourceLanguage) return;
    if (sourceLanguage !== 'auto' && sameLanguage(sourceLanguage, snapshot.targetLanguage)) {
      return;
    }

    var requestStartedAt = Date.now();
    var result = await safeSend({
      type: ST.MESSAGES.TRANSLATE_TEXT,
      payload: {
        text: text,
        sourceLanguage: sourceLanguage,
        targetLang: snapshot.targetLanguage,
        provider: snapshot.provider,
        baseUrl: snapshot.baseUrl,
        model: snapshot.model,
        url: location.href,
      },
    });

    if (result && result.error) {
      throw new Error(result.message || 'Translation failed');
    }

    if (result && result.translated) {
      recordTranslationMetrics(text.length, Date.now() - requestStartedAt);
    }

    if (!result || !result.translated || result.translated === text) return;

    if (!originalTextByNode.has(node)) {
      originalTextByNode.set(node, node.nodeValue);
      trackedTranslatedNodes.push(node);
    }

    node.nodeValue = result.translated;
    translatedTargetByNode.set(node, snapshot.targetLanguage);
  }

  function restoreTranslatedNodes() {
    for (var i = 0; i < trackedTranslatedNodes.length; i++) {
      var node = trackedTranslatedNodes[i];
      if (!node || !node.isConnected) continue;
      if (!originalTextByNode.has(node)) continue;
      node.nodeValue = originalTextByNode.get(node);
    }

    trackedTranslatedNodes = [];
    originalTextByNode = new WeakMap();
    translatedTargetByNode = new WeakMap();
  }

  async function determineSourceLanguage(node, text, provider) {
    var hinted = readLanguageHint(node);
    return hinted || 'auto';
  }

  async function resolveAutoTranslateSourceLanguage(provider) {
    return readLanguageHint(document.body || document.documentElement) || 'auto';
  }

  function readLanguageHint(node) {
    var langSource = '';

    if (node.parentElement) {
      var nearest = node.parentElement.closest('[lang]');
      if (nearest) {
        langSource = nearest.getAttribute('lang') || '';
      }
    }

    if (!langSource) {
      langSource = document.documentElement.getAttribute('lang') || '';
    }

    return normalizeLanguageTag(langSource);
  }

  function normalizeLanguageTag(value) {
    var raw = String(value || '').trim();
    if (!raw) return '';

    var lower = raw.toLowerCase();
    if (lower === 'zh-tw' || lower === 'zh-hk' || lower === 'zh-mo') {
      return 'zh-Hant';
    }
    if (lower === 'zh-cn' || lower === 'zh-sg') {
      return 'zh';
    }
    if (lower === 'he') {
      return 'iw';
    }

    var parts = raw.split('-');
    if (parts.length === 1) {
      return parts[0];
    }
    return parts[0];
  }

  function sameLanguage(sourceLanguage, targetLanguage) {
    return normalizeLanguageTag(sourceLanguage) === normalizeLanguageTag(targetLanguage);
  }

  function ensureContentObserver() {
    if (contentObserver || !document.body || window.top !== window) return;

    contentObserver = new MutationObserver(function (mutations) {
      if (isApplyingAutoTranslation) return;

      for (var i = 0; i < mutations.length; i++) {
        var mutation = mutations[i];
        if (mutation.type === 'childList' && mutation.addedNodes.length) {
          scheduleAutoTranslate('mutation');
          return;
        }
      }
    });

    contentObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  // ──────────────────────────────────────────────
  // Selection-based Translation Tooltip
  // ──────────────────────────────────────────────

  var tooltipHost = null;
  var tooltipContent = null;

  function ensureTooltip() {
    if (tooltipHost) return;

    tooltipHost = document.createElement('div');
    tooltipHost.id = 'safe-translate-tooltip';

    var shadow = tooltipHost.attachShadow({ mode: 'closed' });

    var style = document.createElement('style');
    style.textContent = [
      ':host{position:fixed;z-index:2147483647;pointer-events:none;display:none}',
      '.tt{background:#1F2937;color:#F9FAFB;padding:8px 12px;border-radius:6px;',
      'font:14px/1.5 system-ui,-apple-system,sans-serif;max-width:400px;',
      'word-wrap:break-word;box-shadow:0 4px 12px rgba(0,0,0,.3);pointer-events:auto}',
      '.loading{color:#9CA3AF;font-style:italic}',
      '.src{font-size:11px;color:#6B7280;margin-top:4px}',
    ].join('\n');
    shadow.appendChild(style);

    tooltipContent = document.createElement('div');
    tooltipContent.className = 'tt';
    shadow.appendChild(tooltipContent);

    document.body.appendChild(tooltipHost);
  }

  function showTooltip(text, x, y) {
    ensureTooltip();
    tooltipContent.innerHTML = '<span class="loading">翻譯中…</span>';
    tooltipHost.style.display = 'block';
    tooltipHost.style.left = Math.min(x, window.innerWidth - 420) + 'px';
    tooltipHost.style.top = y + 10 + 'px';

    safeSend({
      type: ST.MESSAGES.TRANSLATE_TEXT,
      payload: { text: text, url: location.href },
    })
      .then(function (res) {
        if (!tooltipContent) return;
        if (res && res.translated) {
          tooltipContent.innerHTML =
            escapeHtml(res.translated) +
            '<div class="src">SafeTranslate</div>';
        } else {
          tooltipContent.innerHTML =
            '<span class="loading">' +
            escapeHtml(res && res.message ? res.message : '翻譯失敗') +
            '</span>';
        }
      })
      .catch(function (error) {
        if (tooltipContent) {
          tooltipContent.innerHTML =
            '<span class="loading">' +
            escapeHtml(error && error.message ? error.message : '翻譯失敗') +
            '</span>';
        }
      });
  }

  function hideTooltip() {
    if (tooltipHost) tooltipHost.style.display = 'none';
  }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  }

  // ──────────────────────────────────────────────
  // User interaction listeners
  // ──────────────────────────────────────────────

  // Store selected text for context-menu translation
  document.addEventListener('mouseup', function (e) {
    var sel = window.getSelection();
    var text = sel ? sel.toString().trim() : '';
    if (text.length > 0 && text.length < 5000) {
      safeSend({
        type: 'selectedText',
        payload: { text: text, x: e.clientX, y: e.clientY },
      });
    } else {
      hideTooltip();
    }
  });

  document.addEventListener('scroll', hideTooltip, { passive: true });
  document.addEventListener(
    'scroll',
    function () {
      scheduleAutoTranslate('scroll');
    },
    { passive: true }
  );

  document.addEventListener('click', function (e) {
    if (tooltipHost && !tooltipHost.contains(e.target)) hideTooltip();
  });

  // Receive messages from background (context menu results, etc.)
  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (msg.type === ST.MESSAGES.GET_PAGE_STATE) {
      readRootState();
      sendResponse({
        isReactSite: state.isReactSite,
        translationDetected: state.translationDetected,
        protectionActive: state.protectionActive,
        detectedReason: state.detectedReason,
        handledRemoveChild: state.handledRemoveChild,
        handledInsertBefore: state.handledInsertBefore,
        handledReplaceChild: state.handledReplaceChild,
        lastHandledError: state.lastHandledError,
        protectionVersion: state.protectionVersion,
        siteKey: state.siteKey,
        translationMetrics: {
          completedTranslations: translationMetrics.completedTranslations,
          translatedCharCount: translationMetrics.translatedCharCount,
          totalDurationMs: translationMetrics.totalDurationMs,
          lastCompletedAt: translationMetrics.lastCompletedAt,
        },
        url: location.href,
      });
      return true;
    }

    if (msg.type === 'showTranslation') {
      showTooltip(msg.text, msg.x || 100, msg.y || 100);
    }
    if (msg.type === 'hideTranslation') {
      hideTooltip();
    }
    if (msg.type === ST.MESSAGES.SETTINGS_UPDATED) {
      applyResolvedSettings(msg.payload || {});
      readRootState();
      syncBadge();
    }
  });

  // ──────────────────────────────────────────────
  // Initialization
  // ──────────────────────────────────────────────

  readRootState();
  state.isReactSite = detectReact();
  loadSettings();

  // Directly listen to storage so settings apply without page refresh.
  // This is the primary path; the SETTINGS_UPDATED message remains as a fallback.
  chrome.storage.sync.onChanged.addListener(function () {
    loadSettings();
  });

  ensureContentObserver();
  if (state.translationDetected || state.protectionActive) {
    syncFromDomEvent();
  } else {
    syncBadge();
  }
})();
