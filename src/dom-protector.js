/**
 * SafeTranslate — DOM Protector
 * Runs in MAIN world at document_start, BEFORE any page JavaScript.
 *
 * Patches Node.prototype.removeChild / insertBefore to prevent
 * React/Next.js crashes caused by Chrome's built-in translation
 * replacing TextNodes with <font> elements.
 */
(function () {
  'use strict';

  // Prevent double-init (e.g. extension reload)
  if (window.__SAFE_TRANSLATE_PROTECTED__) return;
  window.__SAFE_TRANSLATE_PROTECTED__ = true;

  var ST = globalThis.__SAFE_TRANSLATE__;
  if (!ST) return;

  var state = {
    protected: true,
    version: ST.VERSION,
    translationDetected: false,
    detectedReason: '',
    handledRemoveChild: 0,
    handledInsertBefore: 0,
    handledReplaceChild: 0,
    lastHandledError: '',
  };

  function withRoot(callback) {
    if (document.documentElement) {
      callback(document.documentElement);
      return;
    }

    var observer = new MutationObserver(function () {
      if (!document.documentElement) return;
      observer.disconnect();
      callback(document.documentElement);
    });

    observer.observe(document, { childList: true, subtree: true });
  }

  function syncDomState() {
    withRoot(function (root) {
      root.setAttribute(ST.DOM_ATTRS.PROTECTED, '1');
      root.setAttribute(ST.DOM_ATTRS.VERSION, state.version);
      root.setAttribute(
        ST.DOM_ATTRS.TRANSLATION_DETECTED,
        state.translationDetected ? '1' : '0'
      );
      root.setAttribute(
        ST.DOM_ATTRS.DETECTED_REASON,
        state.detectedReason || ''
      );
      root.setAttribute(
        ST.DOM_ATTRS.REMOVE_FALLBACKS,
        String(state.handledRemoveChild)
      );
      root.setAttribute(
        ST.DOM_ATTRS.INSERT_FALLBACKS,
        String(state.handledInsertBefore)
      );
      root.setAttribute(
        ST.DOM_ATTRS.REPLACE_FALLBACKS,
        String(state.handledReplaceChild)
      );
      root.setAttribute(ST.DOM_ATTRS.LAST_ERROR, state.lastHandledError || '');
    });
  }

  function isRecoverableDomError(error) {
    if (!error) return false;
    var message = String(error.message || '');
    return (
      error.name === 'NotFoundError' ||
      /not a child|removechild|insertbefore|replacechild/i.test(message)
    );
  }

  function emitEvent(type) {
    try {
      document.dispatchEvent(
        new CustomEvent(type, {
          detail: {
            version: state.version,
            translationDetected: state.translationDetected,
            detectedReason: state.detectedReason,
            handledRemoveChild: state.handledRemoveChild,
            handledInsertBefore: state.handledInsertBefore,
            handledReplaceChild: state.handledReplaceChild,
            lastHandledError: state.lastHandledError,
          },
        })
      );
    } catch (_) {}
  }

  function markTranslationDetected(reason) {
    if (!state.detectedReason && reason) {
      state.detectedReason = reason;
    }

    if (state.translationDetected) {
      syncDomState();
      return;
    }

    state.translationDetected = true;
    syncDomState();
    emitEvent(ST.EVENTS.TRANSLATION_DETECTED);
  }

  function recordFallback(kind, error, reason) {
    if (kind === 'removeChild') state.handledRemoveChild += 1;
    if (kind === 'insertBefore') state.handledInsertBefore += 1;
    if (kind === 'replaceChild') state.handledReplaceChild += 1;

    state.lastHandledError = error
      ? String(error.name || 'Error') + ': ' + String(error.message || '')
      : reason || state.lastHandledError;

    markTranslationDetected(reason || 'dom-fallback');
    syncDomState();
  }

  syncDomState();

  // ──────────────────────────────────────────────
  // Tier 1 — DOM Method Patching (crash prevention)
  // ──────────────────────────────────────────────

  var _removeChild = Node.prototype.removeChild;
  Node.prototype.removeChild = function (child) {
    if (!child) {
      return child;
    }

    if (child.parentNode !== this) {
      // Node was already detached by Chrome's translator — return silently
      recordFallback('removeChild', null, 'detached-child');
      return child;
    }

    try {
      return _removeChild.call(this, child);
    } catch (error) {
      if (!isRecoverableDomError(error)) throw error;
      recordFallback('removeChild', error, 'remove-child-error');
      return child;
    }
  };

  var _insertBefore = Node.prototype.insertBefore;
  Node.prototype.insertBefore = function (newNode, refNode) {
    if (refNode && refNode.parentNode !== this) {
      // Reference node relocated by translator — fall back to append
      recordFallback('insertBefore', null, 'reference-node-moved');
      return _insertBefore.call(this, newNode, null);
    }

    try {
      return _insertBefore.call(this, newNode, refNode);
    } catch (error) {
      if (!isRecoverableDomError(error)) throw error;
      recordFallback('insertBefore', error, 'insert-before-error');
      try {
        return _insertBefore.call(this, newNode, null);
      } catch (_) {
        return newNode;
      }
    }
  };

  var _replaceChild = Node.prototype.replaceChild;
  Node.prototype.replaceChild = function (newChild, oldChild) {
    if (!oldChild || oldChild.parentNode !== this) {
      recordFallback('replaceChild', null, 'old-child-moved');
      try {
        return this.appendChild(newChild);
      } catch (_) {
        return newChild;
      }
    }

    try {
      return _replaceChild.call(this, newChild, oldChild);
    } catch (error) {
      if (!isRecoverableDomError(error)) throw error;
      recordFallback('replaceChild', error, 'replace-child-error');
      try {
        return this.appendChild(newChild);
      } catch (_) {
        return newChild;
      }
    }
  };

  // ──────────────────────────────────────────────
  // Tier 2 — Translation Activity Detection
  // ──────────────────────────────────────────────

  var detected = false;

  function onTranslationDetected(reason) {
    if (!detected) {
      detected = true;
    }
    markTranslationDetected(reason || 'mutation-observer');
  }

  var observer = new MutationObserver(function (mutations) {
    for (var i = 0; i < mutations.length; i++) {
      var m = mutations[i];

      // Detect <font> elements injected by Google Translate
      if (m.type === 'childList') {
        for (var j = 0; j < m.addedNodes.length; j++) {
          var node = m.addedNodes[j];
          if (
            node.nodeType === 1 &&
            node.tagName === 'FONT' &&
            !node.className
          ) {
            onTranslationDetected('font-node');
            return;
          }
        }
      }

      // Detect translated-ltr / translated-rtl class on <html>
      if (
        m.type === 'attributes' &&
        m.target === document.documentElement
      ) {
        var cl = document.documentElement.classList;
        if (cl.contains('translated-ltr') || cl.contains('translated-rtl')) {
          onTranslationDetected('translated-class');
          return;
        }
      }
    }
  });

  function startObserver() {
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'lang'],
    });
  }

  if (document.documentElement) {
    startObserver();
  } else {
    document.addEventListener('DOMContentLoaded', startObserver, { once: true });
  }

  emitEvent(ST.EVENTS.PROTECTION_ACTIVE);
})();
