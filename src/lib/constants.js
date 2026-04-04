/**
 * SafeTranslate — Shared Constants (SSOT)
 * Loaded in all execution contexts: MAIN world, ISOLATED world, Service Worker.
 * Uses IIFE + globalThis to work across all Chrome extension environments.
 */
(function () {
  'use strict';

  var SAFE_TRANSLATE = Object.freeze({
    // Custom DOM events for MAIN ↔ ISOLATED world communication
    EVENTS: Object.freeze({
      TRANSLATION_DETECTED: 'safe-translate:translation-detected',
      PROTECTION_ACTIVE: 'safe-translate:protection-active',
    }),

    // Chrome runtime message types for ContentScript ↔ Background
    MESSAGES: Object.freeze({
      GET_TAB_STATUS: 'getTabStatus',
      UPDATE_TAB_STATUS: 'updateTabStatus',
      TRANSLATE_TEXT: 'translateText',
      GET_SETTINGS: 'getSettings',
      UPDATE_SETTINGS: 'updateSettings',
    }),

    // Chrome storage keys
    STORAGE: Object.freeze({
      GLOBAL_ENABLED: 'globalEnabled',
      PROTECTION_MODE: 'protectionMode',
      TARGET_LANGUAGE: 'targetLanguage',
      SITE_OVERRIDES: 'siteOverrides',
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
