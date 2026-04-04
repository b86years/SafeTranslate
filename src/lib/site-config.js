/**
 * SafeTranslate — Site Configuration Helpers (SSOT)
 * Shared between popup, content scripts, and background worker.
 */
(function () {
  'use strict';

  var ST = globalThis.__SAFE_TRANSLATE__;
  if (!ST) return;

  function normalizeHost(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch (_) {
      return '';
    }
  }

  function readSettings(raw) {
    var globalEnabled =
      raw[ST.STORAGE.GLOBAL_ENABLED] !== undefined
        ? raw[ST.STORAGE.GLOBAL_ENABLED]
        : raw.globalEnabled;
    var protectionMode =
      raw[ST.STORAGE.PROTECTION_MODE] || raw.protectionMode;
    var targetLanguage =
      raw[ST.STORAGE.TARGET_LANGUAGE] || raw.targetLanguage;
    var siteOverrides = raw[ST.STORAGE.SITE_OVERRIDES] || raw.siteOverrides;

    return {
      globalEnabled:
        globalEnabled !== undefined ? globalEnabled : ST.DEFAULTS.GLOBAL_ENABLED,
      protectionMode: protectionMode || ST.DEFAULTS.PROTECTION_MODE,
      targetLanguage: targetLanguage || ST.DEFAULTS.TARGET_LANGUAGE,
      siteOverrides: siteOverrides || {},
    };
  }

  function resolveSiteSettings(url, raw) {
    var settings = readSettings(raw || {});
    var siteKey = normalizeHost(url);
    var siteMode = siteKey
      ? settings.siteOverrides[siteKey] || ST.SITE_OVERRIDES.INHERIT
      : ST.SITE_OVERRIDES.INHERIT;

    return {
      globalEnabled: settings.globalEnabled,
      protectionMode: settings.protectionMode,
      targetLanguage: settings.targetLanguage,
      siteOverrides: settings.siteOverrides,
      siteKey: siteKey,
      siteMode: siteMode,
      effectiveMode:
        siteMode === ST.SITE_OVERRIDES.INHERIT
          ? settings.protectionMode
          : siteMode,
    };
  }

  globalThis.__SAFE_TRANSLATE_SITE_CONFIG__ = Object.freeze({
    normalizeHost: normalizeHost,
    readSettings: readSettings,
    resolveSiteSettings: resolveSiteSettings,
  });
})();