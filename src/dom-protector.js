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

  // ──────────────────────────────────────────────
  // Tier 1 — DOM Method Patching (crash prevention)
  // ──────────────────────────────────────────────

  var _removeChild = Node.prototype.removeChild;
  Node.prototype.removeChild = function (child) {
    if (!child || child.parentNode !== this) {
      // Node was already detached by Chrome's translator — return silently
      return child;
    }
    return _removeChild.call(this, child);
  };

  var _insertBefore = Node.prototype.insertBefore;
  Node.prototype.insertBefore = function (newNode, refNode) {
    if (refNode && refNode.parentNode !== this) {
      // Reference node relocated by translator — fall back to append
      return _insertBefore.call(this, newNode, null);
    }
    return _insertBefore.call(this, newNode, refNode);
  };

  // ──────────────────────────────────────────────
  // Tier 2 — Translation Activity Detection
  // ──────────────────────────────────────────────

  var detected = false;

  function onTranslationDetected() {
    if (detected) return;
    detected = true;
    try {
      document.dispatchEvent(
        new CustomEvent(ST.EVENTS.TRANSLATION_DETECTED, {
          detail: { timestamp: Date.now() },
        })
      );
    } catch (_) {
      /* page may restrict CustomEvent */
    }
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
            onTranslationDetected();
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
          onTranslationDetected();
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

  // Notify ISOLATED world that protection is active
  document.addEventListener(
    'DOMContentLoaded',
    function () {
      try {
        document.dispatchEvent(
          new CustomEvent(ST.EVENTS.PROTECTION_ACTIVE, {
            detail: { version: '1.0.0' },
          })
        );
      } catch (_) {}
    },
    { once: true }
  );
})();
