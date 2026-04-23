(function () {
  'use strict';

  var ST = globalThis.__SAFE_TRANSLATE__;
  if (!ST) return;

  function normalizeIgnoreTerm(term) {
    return String(term || '').replace(/\s+/g, ' ').trim();
  }

  function normalizeIgnoreTerms(value) {
    var rawTerms = [];

    if (Array.isArray(value)) {
      rawTerms = value;
    } else if (typeof value === 'string') {
      rawTerms = value.split(/\r?\n/);
    }

    var normalized = [];
    var seen = new Set();

    for (var i = 0; i < rawTerms.length; i++) {
      var term = normalizeIgnoreTerm(rawTerms[i]);
      var key;

      if (!term) continue;

      key = term.toLocaleLowerCase();
      if (seen.has(key)) continue;

      seen.add(key);
      normalized.push(term);
    }

    return normalized;
  }

  function formatIgnoreTerms(terms) {
    return normalizeIgnoreTerms(terms).join('\n');
  }

  function escapeRegExp(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function collectIgnoreTermMatches(text, terms) {
    var normalizedTerms = normalizeIgnoreTerms(terms);
    var matches = [];
    var sourceText = String(text || '');
    var lowerText;
    var occupied = [];

    if (!sourceText || !normalizedTerms.length) {
      return matches;
    }

    normalizedTerms.sort(function (left, right) {
      return right.length - left.length;
    });

    lowerText = sourceText.toLocaleLowerCase();

    for (var i = 0; i < normalizedTerms.length; i++) {
      var term = normalizedTerms[i];
      var lowerTerm = term.toLocaleLowerCase();
      var fromIndex = 0;

      while (fromIndex < lowerText.length) {
        var nextIndex = lowerText.indexOf(lowerTerm, fromIndex);
        var endIndex;
        var overlaps = false;

        if (nextIndex === -1) break;

        endIndex = nextIndex + lowerTerm.length;

        if (!hasRequiredSpacingAroundTerm(sourceText, nextIndex, endIndex)) {
          fromIndex = nextIndex + lowerTerm.length;
          continue;
        }

        for (var j = 0; j < occupied.length; j++) {
          if (nextIndex < occupied[j].end && endIndex > occupied[j].start) {
            overlaps = true;
            break;
          }
        }

        if (!overlaps) {
          occupied.push({ start: nextIndex, end: endIndex });
          matches.push({
            start: nextIndex,
            end: endIndex,
            value: sourceText.slice(nextIndex, endIndex),
          });
        }

        fromIndex = nextIndex + lowerTerm.length;
      }
    }

    matches.sort(function (left, right) {
      return left.start - right.start;
    });

    return matches;
  }

  function hasRequiredSpacingAroundTerm(text, startIndex, endIndex) {
    if (startIndex <= 0 || endIndex >= text.length) {
      return false;
    }

    return /\s/.test(text.charAt(startIndex - 1)) && /\s/.test(text.charAt(endIndex));
  }

  function maskTextWithIgnoreTerms(text, terms) {
    var sourceText = String(text || '');
    var matches = collectIgnoreTermMatches(sourceText, terms);
    var placeholders = [];
    var cursor = 0;
    var masked = '';

    if (!matches.length) {
      return {
        text: sourceText,
        placeholders: placeholders,
      };
    }

    for (var i = 0; i < matches.length; i++) {
      var token = '__SAFE_TRANSLATE_KEEP_' + i + '__';
      var match = matches[i];

      masked += sourceText.slice(cursor, match.start);
      masked += token;
      placeholders.push({ token: token, value: match.value });
      cursor = match.end;
    }

    masked += sourceText.slice(cursor);

    return {
      text: masked,
      placeholders: placeholders,
    };
  }

  function restoreMaskedTerms(text, placeholders) {
    var restored = String(text || '');
    var safePlaceholders = Array.isArray(placeholders) ? placeholders : [];

    for (var i = 0; i < safePlaceholders.length; i++) {
      restored = restored.split(safePlaceholders[i].token).join(safePlaceholders[i].value);
    }

    return restored;
  }

  function createSettingsBackup(settings) {
    return {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      settings: {
        globalEnabled: settings && settings.globalEnabled !== false,
        protectionMode: settings && settings.protectionMode ? settings.protectionMode : ST.DEFAULTS.PROTECTION_MODE,
        targetLanguage: settings && settings.targetLanguage ? settings.targetLanguage : ST.DEFAULTS.TARGET_LANGUAGE,
        autoTranslatePage: !settings || settings.autoTranslatePage !== false,
        translationProvider:
          settings && settings.translationProvider
            ? settings.translationProvider
            : ST.DEFAULTS.TRANSLATION_PROVIDER,
        providerBaseUrl: settings && settings.providerBaseUrl ? settings.providerBaseUrl : '',
        providerModel: settings && settings.providerModel ? settings.providerModel : '',
        providerApiKey: settings && settings.providerApiKey ? settings.providerApiKey : '',
        siteOverrides:
          settings && settings.siteOverrides && typeof settings.siteOverrides === 'object'
            ? settings.siteOverrides
            : {},
        ignoreTerms: normalizeIgnoreTerms(settings && settings.ignoreTerms),
      },
    };
  }

  function normalizeImportedSettings(raw) {
    var payload = raw && typeof raw === 'object' && raw.settings ? raw.settings : raw;

    if (!payload || typeof payload !== 'object') {
      throw new Error('JSON 格式不正確');
    }

    return {
      globalEnabled: payload.globalEnabled !== false,
      protectionMode: payload.protectionMode || ST.DEFAULTS.PROTECTION_MODE,
      targetLanguage: payload.targetLanguage || ST.DEFAULTS.TARGET_LANGUAGE,
      autoTranslatePage: payload.autoTranslatePage !== false,
      translationProvider: payload.translationProvider || ST.DEFAULTS.TRANSLATION_PROVIDER,
      providerBaseUrl: payload.providerBaseUrl || '',
      providerModel: payload.providerModel || '',
      providerApiKey: payload.providerApiKey || '',
      siteOverrides:
        payload.siteOverrides && typeof payload.siteOverrides === 'object'
          ? payload.siteOverrides
          : {},
      ignoreTerms: normalizeIgnoreTerms(payload.ignoreTerms),
    };
  }

  globalThis.__SAFE_TRANSLATE_IGNORE_TERMS__ = Object.freeze({
    normalizeIgnoreTerm: normalizeIgnoreTerm,
    normalizeIgnoreTerms: normalizeIgnoreTerms,
    formatIgnoreTerms: formatIgnoreTerms,
    escapeRegExp: escapeRegExp,
    maskTextWithIgnoreTerms: maskTextWithIgnoreTerms,
    restoreMaskedTerms: restoreMaskedTerms,
    createSettingsBackup: createSettingsBackup,
    normalizeImportedSettings: normalizeImportedSettings,
  });
})();