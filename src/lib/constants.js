/**
 * SafeTranslate — Shared Constants (SSOT)
 * Loaded in all execution contexts: MAIN world, ISOLATED world, Service Worker.
 * Uses IIFE + globalThis to work across all Chrome extension environments.
 */
(function () {
  'use strict';

  var SAFE_TRANSLATE = Object.freeze({
    VERSION: '1.3.0',

    // Custom DOM events for MAIN ↔ ISOLATED world communication
    EVENTS: Object.freeze({
      TRANSLATION_DETECTED: 'safe-translate:translation-detected',
      PROTECTION_ACTIVE: 'safe-translate:protection-active',
    }),

    // Chrome runtime message types for ContentScript ↔ Background
    MESSAGES: Object.freeze({
      UPDATE_TAB_STATUS: 'updateTabStatus',
      TRANSLATE_TEXT: 'translateText',
      GET_TAB_ACTIVITY: 'getTabActivity',
      CHECK_PROVIDER_STATUS: 'checkProviderStatus',
      GET_OLLAMA_MODELS: 'getOllamaModels',
      GET_SETTINGS: 'getSettings',
      UPDATE_SETTINGS: 'updateSettings',
      GET_PAGE_STATE: 'getPageState',
      SETTINGS_UPDATED: 'settingsUpdated',
      AUTO_TRANSLATE_PAGE: 'autoTranslatePage',
      RESOLVE_SELECTION_ORIGINAL: 'resolveSelectionOriginal',
      EXPORT_SETTINGS_JSON: 'exportSettingsJson',
      IMPORT_SETTINGS_JSON: 'importSettingsJson',
    }),

    // Chrome storage keys
    STORAGE: Object.freeze({
      GLOBAL_ENABLED: 'globalEnabled',
      PROTECTION_MODE: 'protectionMode',
      TARGET_LANGUAGE: 'targetLanguage',
      AUTO_TRANSLATE_PAGE: 'autoTranslatePage',
      TRANSLATION_PROVIDER: 'translationProvider',
      PROVIDER_BASE_URL: 'providerBaseUrl',
      PROVIDER_MODEL: 'providerModel',
      SITE_OVERRIDES: 'siteOverrides',
      IGNORE_TERMS: 'ignoreTerms',
    }),

    STORAGE_LOCAL: Object.freeze({
      PROVIDER_API_KEY: 'providerApiKey',
      SETTINGS_JSON: 'settingsJson',
    }),

    PROVIDERS: Object.freeze({
      GOOGLE_TRANSLATE: 'googleTranslate',
      OPENROUTER: 'openRouter',
      OPENAI_COMPATIBLE: 'openaiCompatible',
      OLLAMA: 'ollama',
    }),

    SITE_OVERRIDES: Object.freeze({
      INHERIT: 'inherit',
      PATCH_ONLY: 'patchOnly',
      BLOCK_AND_TOOLTIP: 'blockAndTooltip',
    }),

    SITE_TRANSLATION: Object.freeze({
      INHERIT: 'inherit',
      ALWAYS: 'always',
      NEVER: 'never',
    }),

    // Protection modes
    MODES: Object.freeze({
      PATCH_ONLY: 'patchOnly',
      BLOCK_AND_TOOLTIP: 'blockAndTooltip',
    }),

    // Default settings
    DEFAULTS: Object.freeze({
      GLOBAL_ENABLED: true,
      PROTECTION_MODE: 'patchOnly',
      TARGET_LANGUAGE: 'zh-TW',
      AUTO_TRANSLATE_PAGE: true,
      TRANSLATION_PROVIDER: 'googleTranslate',
      PROVIDER_BASE_URL: '',
      PROVIDER_MODEL: '',
      REQUEST_TIMEOUT_MS: 45000,
      STATUS_CHECK_TIMEOUT_MS: 5000,
    }),

    DOM_ATTRS: Object.freeze({
      PROTECTED: 'data-safe-translate-protected',
      VERSION: 'data-safe-translate-version',
      TRANSLATION_DETECTED: 'data-safe-translate-detected',
      DETECTED_REASON: 'data-safe-translate-detected-reason',
      REMOVE_FALLBACKS: 'data-safe-translate-remove-fallbacks',
      INSERT_FALLBACKS: 'data-safe-translate-insert-fallbacks',
      REPLACE_FALLBACKS: 'data-safe-translate-replace-fallbacks',
      LAST_ERROR: 'data-safe-translate-last-error',
    }),

    // Badge colors
    BADGE: Object.freeze({
      ACTIVE: '#4F46E5',
      DETECTING: '#F59E0B',
      ERROR: '#EF4444',
      DISABLED: '#6B7280',
    }),
  });

  if (typeof globalThis !== 'undefined') {
    globalThis.__SAFE_TRANSLATE__ = SAFE_TRANSLATE;
  }
})();
