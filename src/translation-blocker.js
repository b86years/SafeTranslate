/**
 * SafeTranslate — Translation Blocker
 * Runs in ISOLATED world at document_start.
 * When "blockAndTooltip" mode is active, prevents Chrome from
 * offering / performing its built-in translation on the page.
 */
(function () {
  'use strict';

  var ST = globalThis.__SAFE_TRANSLATE__;
  if (!ST) return;

  chrome.storage.sync.get(
    [ST.STORAGE.PROTECTION_MODE, ST.STORAGE.GLOBAL_ENABLED],
    function (data) {
      if (data[ST.STORAGE.GLOBAL_ENABLED] === false) return;

      var mode =
        data[ST.STORAGE.PROTECTION_MODE] || ST.DEFAULTS.PROTECTION_MODE;

      if (mode === ST.MODES.BLOCK_AND_TOOLTIP) {
        blockChromeTranslation();
      }
    }
  );

  function blockChromeTranslation() {
    // Attribute-level blocking
    document.documentElement.setAttribute('translate', 'no');
    document.documentElement.classList.add('notranslate');

    // Meta tag blocking (apply once <head> exists)
    var injectMeta = function () {
      if (!document.head) return;
      var meta = document.createElement('meta');
      meta.name = 'google';
      meta.content = 'notranslate';
      document.head.insertBefore(meta, document.head.firstChild);
    };

    if (document.head) {
      injectMeta();
    } else {
      document.addEventListener('DOMContentLoaded', injectMeta, {
        once: true,
      });
    }
  }
})();
