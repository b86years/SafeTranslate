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
    var autoTranslatePage =
      raw[ST.STORAGE.AUTO_TRANSLATE_PAGE] !== undefined
        ? raw[ST.STORAGE.AUTO_TRANSLATE_PAGE]
        : raw.autoTranslatePage;
    var translationProvider =
      raw[ST.STORAGE.TRANSLATION_PROVIDER] || raw.translationProvider;
    var providerBaseUrl =
      raw[ST.STORAGE.PROVIDER_BASE_URL] || raw.providerBaseUrl;
    var providerModel =
      raw[ST.STORAGE.PROVIDER_MODEL] || raw.providerModel;
    var siteOverrides = raw[ST.STORAGE.SITE_OVERRIDES] || raw.siteOverrides;
    var ignoreTerms = raw[ST.STORAGE.IGNORE_TERMS] || raw.ignoreTerms;

    return {
      globalEnabled:
        globalEnabled !== undefined ? globalEnabled : ST.DEFAULTS.GLOBAL_ENABLED,
      protectionMode: protectionMode || ST.DEFAULTS.PROTECTION_MODE,
      targetLanguage: targetLanguage || ST.DEFAULTS.TARGET_LANGUAGE,
      autoTranslatePage:
        autoTranslatePage !== undefined
          ? autoTranslatePage
          : ST.DEFAULTS.AUTO_TRANSLATE_PAGE,
      translationProvider:
        normalizeProvider(translationProvider) ||
        ST.DEFAULTS.TRANSLATION_PROVIDER,
      providerBaseUrl: providerBaseUrl || ST.DEFAULTS.PROVIDER_BASE_URL,
      providerModel: providerModel || ST.DEFAULTS.PROVIDER_MODEL,
      siteOverrides: normalizeSiteOverrides(siteOverrides || {}),
      ignoreTerms: globalThis.__SAFE_TRANSLATE_IGNORE_TERMS__
        ? globalThis.__SAFE_TRANSLATE_IGNORE_TERMS__.normalizeIgnoreTerms(ignoreTerms)
        : [],
    };
  }

  function normalizeProvider(value) {
    if (value === ST.PROVIDERS.GOOGLE_TRANSLATE) return value;
    if (value === ST.PROVIDERS.OPENROUTER) return value;
    if (value === ST.PROVIDERS.OPENAI_COMPATIBLE) return value;
    if (value === ST.PROVIDERS.OLLAMA) return value;
    return ST.DEFAULTS.TRANSLATION_PROVIDER;
  }

  function normalizeSiteOverrides(siteOverrides) {
    var normalized = {};
    var entries = Object.entries(siteOverrides || {});

    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i];
      var host = entry[0];
      var raw = entry[1];

      if (!host) continue;

      if (typeof raw === 'string') {
        normalized[host] = {
          mode: raw,
          translation: ST.SITE_TRANSLATION.INHERIT,
        };
        continue;
      }

      if (!raw || typeof raw !== 'object') continue;

      normalized[host] = {
        mode: normalizeMode(raw.mode),
        translation: normalizeSiteTranslation(raw.translation),
      };
    }

    return normalized;
  }

  function normalizeMode(value) {
    if (value === ST.MODES.BLOCK_AND_TOOLTIP) return value;
    if (value === ST.MODES.PATCH_ONLY) return value;
    return ST.SITE_OVERRIDES.INHERIT;
  }

  function normalizeSiteTranslation(value) {
    if (value === ST.SITE_TRANSLATION.ALWAYS) return value;
    if (value === ST.SITE_TRANSLATION.NEVER) return value;
    return ST.SITE_TRANSLATION.INHERIT;
  }

  function resolveSiteSettings(url, raw) {
    var settings = readSettings(raw || {});
    var siteKey = normalizeHost(url);
    var siteOverride = siteKey
      ? settings.siteOverrides[siteKey] || null
      : null;
    var siteMode = siteOverride
      ? siteOverride.mode
      : ST.SITE_OVERRIDES.INHERIT;
    var siteTranslation = siteOverride
      ? siteOverride.translation
      : ST.SITE_TRANSLATION.INHERIT;

    return {
      globalEnabled: settings.globalEnabled,
      protectionMode: settings.protectionMode,
      targetLanguage: settings.targetLanguage,
      autoTranslatePage: settings.autoTranslatePage,
      translationProvider: settings.translationProvider,
      providerBaseUrl: settings.providerBaseUrl,
      providerModel: settings.providerModel,
      siteOverrides: settings.siteOverrides,
      ignoreTerms: settings.ignoreTerms,
      siteKey: siteKey,
      siteMode: siteMode,
      siteTranslation: siteTranslation,
      alwaysTranslate: siteTranslation === ST.SITE_TRANSLATION.ALWAYS,
      neverTranslate: siteTranslation === ST.SITE_TRANSLATION.NEVER,
      effectiveMode:
        siteMode === ST.SITE_OVERRIDES.INHERIT
          ? settings.protectionMode
          : siteMode,
    };
  }

  globalThis.__SAFE_TRANSLATE_SITE_CONFIG__ = Object.freeze({
    normalizeHost: normalizeHost,
    normalizeMode: normalizeMode,
    normalizeProvider: normalizeProvider,
    normalizeSiteOverrides: normalizeSiteOverrides,
    normalizeSiteTranslation: normalizeSiteTranslation,
    readSettings: readSettings,
    resolveSiteSettings: resolveSiteSettings,
  });
})();