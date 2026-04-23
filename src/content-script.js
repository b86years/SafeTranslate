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
    builtInAiStatus: 'idle',
    builtInAiDetail: '',
    builtInAiSourceLanguage: '',
    builtInAiTargetLanguage: '',
    siteKey: siteConfig.normalizeHost(location.href),
  };
  var hasReportedTranslation = false;
  var currentResolvedSettings = siteConfig.resolveSiteSettings(location.href, {});
  var originalTextByNode = new WeakMap();
  var translatedTargetByNode = new WeakMap();
  var trackedTranslatedNodes = [];
  var translatorCache = new Map();
  var languageDetectorPromise = null;
  var autoTranslateTimer = 0;
  var isApplyingAutoTranslation = false;
  var contentObserver = null;
  var builtInRetryEventsBound = false;

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

  function getPageStateSnapshot() {
    return {
      isReactSite: state.isReactSite,
      translationDetected: state.translationDetected,
      protectionActive: state.protectionActive,
      detectedReason: state.detectedReason,
      handledRemoveChild: state.handledRemoveChild,
      handledInsertBefore: state.handledInsertBefore,
      handledReplaceChild: state.handledReplaceChild,
      lastHandledError: state.lastHandledError,
      protectionVersion: state.protectionVersion,
      builtInAiStatus: state.builtInAiStatus,
      builtInAiDetail: state.builtInAiDetail,
      builtInAiSourceLanguage: state.builtInAiSourceLanguage,
      builtInAiTargetLanguage: state.builtInAiTargetLanguage,
      siteKey: state.siteKey,
      url: location.href,
    };
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
        builtInAiStatus: state.builtInAiStatus,
        builtInAiDetail: state.builtInAiDetail,
        builtInAiSourceLanguage: state.builtInAiSourceLanguage,
        builtInAiTargetLanguage: state.builtInAiTargetLanguage,
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

  function setBuiltInAiStatus(status, detail, sourceLanguage, targetLanguage) {
    state.builtInAiStatus = status || 'idle';
    state.builtInAiDetail = detail || '';
    state.builtInAiSourceLanguage = sourceLanguage || '';
    state.builtInAiTargetLanguage = targetLanguage || '';
    syncBadge();
  }

  async function getBuiltInStatusLanguages() {
    var targetLanguage = normalizeLanguageTag(currentResolvedSettings.targetLanguage);
    return {
      sourceLanguage: await inferBuiltInStatusSourceLanguage(targetLanguage),
      targetLanguage: targetLanguage,
    };
  }

  async function inferBuiltInStatusSourceLanguage(targetLanguage) {
    var nodes = collectCandidateTextNodes(8);
    var detectedNonTarget = '';
    var detectedAny = '';
    var hintedNonTarget = '';
    var hintedAny = '';

    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      var text = String(node && node.nodeValue ? node.nodeValue : '')
        .replace(/\s+/g, ' ')
        .trim();

      if (text.length >= 12) {
        var detected = await detectLanguage(text);
        if (detected) {
          if (!detectedAny) {
            detectedAny = detected;
          }
          if (!sameLanguage(detected, targetLanguage) && !detectedNonTarget) {
            detectedNonTarget = detected;
          }
        }
      }

      var hinted = readLanguageHint(node);
      if (hinted) {
        if (!hintedAny) {
          hintedAny = hinted;
        }
        if (!sameLanguage(hinted, targetLanguage) && !hintedNonTarget) {
          hintedNonTarget = hinted;
        }
      }
    }

    var pageHint = normalizeLanguageTag(
      readLanguageHint(document.body || document.documentElement) || ''
    );
    if (pageHint) {
      if (!hintedAny) {
        hintedAny = pageHint;
      }
      if (!sameLanguage(pageHint, targetLanguage) && !hintedNonTarget) {
        hintedNonTarget = pageHint;
      }
    }

    return detectedNonTarget || hintedNonTarget || detectedAny || hintedAny || '';
  }

  function hasActiveUserGesture() {
    return !!(navigator.userActivation && navigator.userActivation.isActive);
  }

  async function refreshBuiltInAiStatus(options) {
    if (currentResolvedSettings.translationProvider !== ST.PROVIDERS.BUILT_IN) {
      setBuiltInAiStatus('inactive', '目前未使用 Chrome 內建 AI。');
      return;
    }

    if (!('Translator' in self)) {
      setBuiltInAiStatus('unsupported', '目前 Chrome 或裝置不支援 Translator API。');
      return;
    }

    var langs = await getBuiltInStatusLanguages();
    if (!langs.targetLanguage) {
      setBuiltInAiStatus('error', '缺少目標語言設定。');
      return;
    }

    if (!langs.sourceLanguage) {
      setBuiltInAiStatus(
        'waiting-language',
        '此頁面沒有明確語言標記，會在實際翻譯時再偵測來源語言。',
        '',
        langs.targetLanguage
      );
      return;
    }

    setBuiltInAiStatus(
      'checking',
      '正在檢查 Chrome 內建 AI 是否可用。',
      langs.sourceLanguage,
      langs.targetLanguage
    );

    try {
      var availability = await Translator.availability({
        sourceLanguage: langs.sourceLanguage,
        targetLanguage: langs.targetLanguage,
      });

      if (availability === 'unavailable') {
        setBuiltInAiStatus(
          'unavailable',
          'Chrome 內建 AI 不支援 ' + langs.sourceLanguage + ' 到 ' + langs.targetLanguage + '。',
          langs.sourceLanguage,
          langs.targetLanguage
        );
        return;
      }

      if (availability === 'downloading') {
        setBuiltInAiStatus(
          'downloading',
          'Chrome 正在下載翻譯模型，完成後會自動再試。',
          langs.sourceLanguage,
          langs.targetLanguage
        );
        return;
      }

      if (availability === 'downloadable' && !hasActiveUserGesture() && !(options && options.tryCreate)) {
        setBuiltInAiStatus(
          'waiting-activation',
          '需要先在頁面點一下或按鍵，Chrome 才能下載並啟用翻譯模型。',
          langs.sourceLanguage,
          langs.targetLanguage
        );
        return;
      }

      if ((options && options.tryCreate) || availability === 'available') {
        try {
          await getBuiltInTranslator(langs.sourceLanguage, langs.targetLanguage);
          setBuiltInAiStatus(
            'ready',
            'Chrome 內建 AI 已就緒，可將 ' + langs.sourceLanguage + ' 翻到 ' + langs.targetLanguage + '。',
            langs.sourceLanguage,
            langs.targetLanguage
          );
          return;
        } catch (error) {
          setBuiltInAiStatus(
            'error',
            error && error.message
              ? error.message
              : 'Chrome 內建 AI 建立工作階段失敗。',
            langs.sourceLanguage,
            langs.targetLanguage
          );
          return;
        }
      }

      setBuiltInAiStatus(
        'downloadable',
        'Chrome 內建 AI 可下載，互動後會開始準備模型。',
        langs.sourceLanguage,
        langs.targetLanguage
      );
    } catch (error) {
      setBuiltInAiStatus(
        'error',
        error && error.message ? error.message : 'Chrome 內建 AI 狀態檢查失敗。',
        langs.sourceLanguage,
        langs.targetLanguage
      );
    }
  }

  function bindBuiltInRetryEvents() {
    if (builtInRetryEventsBound) return;
    builtInRetryEventsBound = true;

    var handler = function () {
      if (currentResolvedSettings.translationProvider !== ST.PROVIDERS.BUILT_IN) return;
      if (
        state.builtInAiStatus !== 'waiting-activation' &&
        state.builtInAiStatus !== 'downloadable' &&
        state.builtInAiStatus !== 'downloading'
      ) {
        return;
      }

      void refreshBuiltInAiStatus({ tryCreate: true });
      void autoTranslatePage();
    };

    document.addEventListener('mousedown', handler, true);
    document.addEventListener('keydown', handler, true);
    document.addEventListener('touchstart', handler, true);
  }

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
      translatorCache = new Map();
    }

    if (currentResolvedSettings.translationProvider !== ST.PROVIDERS.BUILT_IN) {
      setBuiltInAiStatus('inactive', '目前未使用 Chrome 內建 AI。');
    } else if (
      previousTarget !== currentResolvedSettings.targetLanguage ||
      previousProvider !== currentResolvedSettings.translationProvider ||
      previousTranslationPolicy !== currentResolvedSettings.siteTranslation
    ) {
      setBuiltInAiStatus('idle', '可從工具列面板手動檢查 Chrome 內建 AI 狀態。');
    }

    if (shouldAutoTranslatePage()) {
      scheduleAutoTranslate('settings');
    } else {
      restoreTranslatedNodes();
    }
  }

  function shouldAutoTranslatePage() {
    return (
      window.top === window &&
      currentResolvedSettings.globalEnabled !== false &&
      currentResolvedSettings.autoTranslatePage !== false &&
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
    };
    var nodes = collectCandidateTextNodes(40);

    if (!nodes.length) return;

    isApplyingAutoTranslation = true;
    try {
      for (var i = 0; i < nodes.length; i++) {
        if (!shouldAutoTranslatePage()) break;
        try {
          await translateNode(nodes[i], snapshot);
        } catch (_) {}
      }
    } finally {
      isApplyingAutoTranslation = false;
    }
  }

  function collectCandidateTextNodes(limit) {
    if (!document.body) return [];

    var nodes = [];
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

    while (walker.nextNode() && nodes.length < limit) {
      nodes.push(walker.currentNode);
    }

    return nodes;
  }

  function isTranslatableTextNode(node) {
    if (!node || !node.parentElement) return false;
    if (!node.nodeValue) return false;

    var text = node.nodeValue.replace(/\s+/g, ' ').trim();
    if (!text || text.length < 3 || text.length > 800) return false;

    var parent = node.parentElement;
    if (!parent.isConnected) return false;
    if (parent.closest('#safe-translate-tooltip')) return false;
    if (parent.closest('[data-safe-translate-skip="1"]')) return false;
    if (parent.closest('script, style, noscript, textarea, input, select, option, button, code, pre')) {
      return false;
    }
    if (parent.closest('[contenteditable="true"]')) return false;
    if (parent.getClientRects().length === 0) return false;

    return true;
  }

  async function translateNode(node, snapshot) {
    if (!node || !node.parentElement || !node.isConnected) return;

    var originalText = originalTextByNode.has(node)
      ? originalTextByNode.get(node)
      : node.nodeValue;
    var text = String(originalText || '').replace(/\s+/g, ' ').trim();

    if (!text) return;
    if (translatedTargetByNode.get(node) === snapshot.targetLanguage) return;

    var sourceLanguage = await determineSourceLanguage(node, text, snapshot.provider);
    if (!sourceLanguage) return;
    if (sameLanguage(sourceLanguage, snapshot.targetLanguage)) return;

    var result;
    if (snapshot.provider === ST.PROVIDERS.BUILT_IN) {
      result = await translateTextWithBuiltIn(text, sourceLanguage, snapshot.targetLanguage);
    } else {
      result = await safeSend({
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
    if (provider !== ST.PROVIDERS.BUILT_IN) {
      return hinted || 'auto';
    }

    if (hinted) return hinted;

    var detected = await detectLanguage(text);
    return detected || null;
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

  async function detectLanguage(text) {
    if (!('LanguageDetector' in self)) return '';
    if (!text || text.length < 12) return '';

    try {
      var detector = await getLanguageDetector();
      if (!detector) return '';
      var results = await detector.detect(text);
      if (!results || !results.length) return '';
      if ((results[0].confidence || 0) < 0.6) return '';
      return normalizeLanguageTag(results[0].detectedLanguage);
    } catch (_) {
      return '';
    }
  }

  function getLanguageDetector() {
    if (!('LanguageDetector' in self)) {
      return Promise.resolve(null);
    }

    if (!languageDetectorPromise) {
      languageDetectorPromise = LanguageDetector.availability()
        .then(function (availability) {
          if (availability === 'unavailable') return null;
          return LanguageDetector.create();
        })
        .catch(function () {
          languageDetectorPromise = Promise.resolve(null);
          return null;
        });
    }

    return languageDetectorPromise;
  }

  function getBuiltInTranslator(sourceLanguage, targetLanguage) {
    var source = normalizeLanguageTag(sourceLanguage);
    var target = normalizeLanguageTag(targetLanguage);
    var key = source + '->' + target;

    if (!translatorCache.has(key)) {
      translatorCache.set(
        key,
        Translator.availability({
          sourceLanguage: source,
          targetLanguage: target,
        })
          .then(function (availability) {
            if (availability === 'unavailable') {
              throw new Error('Built-in translation does not support ' + source + ' to ' + target);
            }

            if (availability !== 'available' && !hasActiveUserGesture()) {
              throw new Error('Chrome 內建 AI 需要使用者先與頁面互動，才能下載或啟用翻譯模型。');
            }

            return Translator.create({
              sourceLanguage: source,
              targetLanguage: target,
            });
          })
          .catch(function (error) {
            translatorCache.delete(key);
            throw error;
          })
      );
    }

    return translatorCache.get(key);
  }

  async function translateTextWithBuiltIn(text, sourceLanguage, targetLanguage) {
    if (!('Translator' in self)) {
      setBuiltInAiStatus('unsupported', '目前 Chrome 或裝置不支援 Translator API。');
      throw new Error('Chrome built-in Translator API is unavailable');
    }

    var normalizedSource = normalizeLanguageTag(sourceLanguage);
    var normalizedTarget = normalizeLanguageTag(targetLanguage);

    try {
      var translator = await getBuiltInTranslator(normalizedSource, normalizedTarget);
      var translated = await translator.translate(text);
      if (!translated) {
        throw new Error('Chrome built-in Translator returned an empty response');
      }

      setBuiltInAiStatus(
        'ready',
        'Chrome 內建 AI 已就緒，可將 ' + normalizedSource + ' 翻到 ' + normalizedTarget + '。',
        normalizedSource,
        normalizedTarget
      );

      return { translated: translated };
    } catch (error) {
      setBuiltInAiStatus(
        hasActiveUserGesture() ? 'error' : 'waiting-activation',
        error && error.message
          ? error.message
          : 'Chrome 內建 AI 翻譯失敗。',
        normalizedSource,
        normalizedTarget
      );
      throw error;
    }
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
            '<span class="loading">翻譯失敗</span>';
        }
      })
      .catch(function () {
        if (tooltipContent) {
          tooltipContent.innerHTML =
            '<span class="loading">翻譯失敗</span>';
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

  document.addEventListener('click', function (e) {
    if (tooltipHost && !tooltipHost.contains(e.target)) hideTooltip();
  });

  // Receive messages from background (context menu results, etc.)
  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (msg.type === ST.MESSAGES.GET_PAGE_STATE) {
      readRootState();
      sendResponse(getPageStateSnapshot());
      return true;
    }

    if (msg.type === ST.MESSAGES.CHECK_BUILT_IN_STATUS) {
      refreshBuiltInAiStatus({ tryCreate: false })
        .then(function () {
          readRootState();
          sendResponse(getPageStateSnapshot());
        })
        .catch(function () {
          readRootState();
          sendResponse(getPageStateSnapshot());
        });
      return true;
    }

    if (msg.type === ST.MESSAGES.TRANSLATE_VIA_PAGE) {
      handlePageTranslationRequest(msg.payload)
        .then(sendResponse)
        .catch(function (error) {
          sendResponse({
            translated: null,
            error: true,
            message: error && error.message ? error.message : 'Built-in translation failed',
          });
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

  async function handlePageTranslationRequest(payload) {
    var sourceLanguage = payload && payload.sourceLanguage ? payload.sourceLanguage : '';
    var text = payload && payload.text ? payload.text : '';
    var targetLanguage =
      payload && payload.targetLang
        ? payload.targetLang
        : currentResolvedSettings.targetLanguage;

    if (!text) {
      return { translated: null, error: true, message: 'No text to translate' };
    }

    if (!sourceLanguage || sourceLanguage === 'auto') {
      sourceLanguage = readLanguageHint(document.body ? document.body.firstChild || document.body : null);
      if (!sourceLanguage) {
        sourceLanguage = await detectLanguage(text);
      }
    }

    if (!sourceLanguage) {
      throw new Error('Unable to detect source language for built-in translation');
    }

    return await translateTextWithBuiltIn(text, sourceLanguage, targetLanguage);
  }

  // ──────────────────────────────────────────────
  // Initialization
  // ──────────────────────────────────────────────

  readRootState();
  state.isReactSite = detectReact();
  loadSettings();
  ensureContentObserver();
  bindBuiltInRetryEvents();
  if (state.translationDetected || state.protectionActive) {
    syncFromDomEvent();
  } else {
    syncBadge();
  }
})();
