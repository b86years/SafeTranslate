/**
 * SafeTranslate — Translation Blocker
 * Runs in ISOLATED world at document_start.
 * When "blockAndTooltip" mode is active, prevents Chrome from
 * offering / performing its built-in translation on the page.
 */
(function () {
  'use strict';

  var ST = globalThis.__SAFE_TRANSLATE__;
  var siteConfig = globalThis.__SAFE_TRANSLATE_SITE_CONFIG__;
  if (!ST) return;
  if (!siteConfig) return;

  chrome.storage.sync.get(
    [
      ST.STORAGE.PROTECTION_MODE,
      ST.STORAGE.GLOBAL_ENABLED,
      ST.STORAGE.TARGET_LANGUAGE,
      ST.STORAGE.AUTO_TRANSLATE_PAGE,
      ST.STORAGE.TRANSLATION_PROVIDER,
      ST.STORAGE.SITE_OVERRIDES,
    ],
    function (data) {
      var resolved = siteConfig.resolveSiteSettings(location.href, data);
      if (resolved.globalEnabled === false) return;

      if (
        resolved.effectiveMode === ST.MODES.BLOCK_AND_TOOLTIP ||
        resolved.neverTranslate
      ) {
        blockChromeTranslation();
      }
    }
  );

  chrome.runtime.onMessage.addListener(function (message) {
    if (message.type !== ST.MESSAGES.SETTINGS_UPDATED) return;

    var resolved = siteConfig.resolveSiteSettings(location.href, message.payload);
    if (
      resolved.globalEnabled !== false &&
      (
        resolved.effectiveMode === ST.MODES.BLOCK_AND_TOOLTIP ||
        resolved.neverTranslate
      )
    ) {
        blockChromeTranslation();
    }
  });

  function blockChromeTranslation() {
    // Attribute-level blocking
    document.documentElement.setAttribute('translate', 'no');
    document.documentElement.classList.add('notranslate');

    // Meta tag blocking (apply once <head> exists)
    var injectMeta = function () {
      if (!document.head) return;
      if (document.head.querySelector('meta[name="google"][content="notranslate"]')) {
        return;
      }
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
