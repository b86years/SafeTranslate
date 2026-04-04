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
      payload: { text: text },
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
      readRootState();
      syncBadge();
    }
  });

  // ──────────────────────────────────────────────
  // Initialization
  // ──────────────────────────────────────────────

  readRootState();
  state.isReactSite = detectReact();
  if (state.translationDetected || state.protectionActive) {
    syncFromDomEvent();
  } else {
    syncBadge();
  }
})();
