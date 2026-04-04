/**
 * SafeTranslate — Popup Controller
 * Loads settings & per-tab state, binds UI controls,
 * and persists user preference changes via the background worker.
 */
(function () {
  'use strict';

  var ST = globalThis.__SAFE_TRANSLATE__;
  var siteConfig = globalThis.__SAFE_TRANSLATE_SITE_CONFIG__;
  if (!ST) return;
  if (!siteConfig) return;

  // ── DOM refs ──

  var $toggle = document.getElementById('globalToggle');
  var $indicator = document.getElementById('statusIndicator');
  var $label = document.getElementById('statusLabel');
  var $detail = document.getElementById('statusDetail');
  var $count = document.getElementById('protectionCount');
  var $radios = document.querySelectorAll('input[name="mode"]');
  var $siteHost = document.getElementById('siteHost');
  var $siteModeSelect = document.getElementById('siteModeSelect');
  var $diagVersion = document.getElementById('diagVersion');
  var $diagReason = document.getElementById('diagReason');
  var $diagRemove = document.getElementById('diagRemove');
  var $diagInsert = document.getElementById('diagInsert');
  var $diagReplace = document.getElementById('diagReplace');
  var $diagLastError = document.getElementById('diagLastError');
  var activeTab = null;
  var currentSettings = null;

  // ── Load current-tab status ──

  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    if (!tabs[0]) return;
    activeTab = tabs[0];
    $siteHost.textContent = siteConfig.normalizeHost(activeTab.url) || '無法辨識';
    chrome.tabs.sendMessage(
      activeTab.id,
      { type: ST.MESSAGES.GET_PAGE_STATE },
      function (state) {
        if (chrome.runtime.lastError) {
          setStatus('idle', '等待頁面', '重新整理頁面後可取得即時診斷');
          return;
        }

        if (state) {
          renderStatus(state);
          renderDiagnostics(state);
        }
      }
    );
  });

  // ── Load settings ──

  chrome.runtime.sendMessage(
    { type: ST.MESSAGES.GET_SETTINGS },
    function (s) {
      if (!s) return;
      currentSettings = s;
      $toggle.checked = s.globalEnabled;
      selectMode(s.protectionMode);
      renderSiteMode();
    }
  );

  // ── Load stats ──

  chrome.storage.local.get({ protectionCount: 0 }, function (d) {
    $count.textContent = d.protectionCount;
  });

  // ── Event bindings ──

  $toggle.addEventListener('change', function () {
    persist({ globalEnabled: this.checked });
  });

  for (var i = 0; i < $radios.length; i++) {
    $radios[i].addEventListener('change', function () {
      persist({ protectionMode: this.value });
    });
  }

  $siteModeSelect.addEventListener('change', function () {
    if (!activeTab || !currentSettings) return;

    var siteKey = siteConfig.normalizeHost(activeTab.url);
    if (!siteKey) return;

    var overrides = Object.assign({}, currentSettings.siteOverrides || {});
    if (this.value === ST.SITE_OVERRIDES.INHERIT) {
      delete overrides[siteKey];
    } else {
      overrides[siteKey] = this.value;
    }

    persist({ siteOverrides: overrides });
  });

  // ── Helpers ──

  function persist(partial) {
    if (partial.siteOverrides && currentSettings) {
      currentSettings.siteOverrides = partial.siteOverrides;
    }
    if (partial.protectionMode && currentSettings) {
      currentSettings.protectionMode = partial.protectionMode;
    }
    if (partial.globalEnabled !== undefined && currentSettings) {
      currentSettings.globalEnabled = partial.globalEnabled;
    }

    chrome.runtime.sendMessage({
      type: ST.MESSAGES.UPDATE_SETTINGS,
      payload: partial,
      tabId: activeTab ? activeTab.id : null,
    });

    renderSiteMode();
  }

  function selectMode(value) {
    for (var i = 0; i < $radios.length; i++) {
      $radios[i].checked = $radios[i].value === value;
    }
  }

  function renderStatus(state) {
    if (!state.protectionActive) {
      setStatus('error', '未掛載', '頁面尚未回報核心保護狀態');
    } else if (state.translationDetected && state.isReactSite) {
      setStatus('protecting', '保護中', '已偵測到 React 應用，翻譯保護已啟用');
    } else if (state.translationDetected) {
      setStatus('active', '翻譯中', '已偵測到 Chrome 翻譯，保護已就緒');
    } else if (state.isReactSite) {
      setStatus('ready', '就緒', '偵測到 React 應用，保護已啟用');
    } else {
      setStatus('idle', '監控中', '等待偵測翻譯活動');
    }
  }

  function setStatus(cls, label, detail) {
    $indicator.className = 'status-indicator ' + cls;
    $label.textContent = label;
    $detail.textContent = detail;
  }

  function renderDiagnostics(state) {
    $diagVersion.textContent = state.protectionVersion || ST.VERSION;
    $diagReason.textContent = state.detectedReason || '-';
    $diagRemove.textContent = String(state.handledRemoveChild || 0);
    $diagInsert.textContent = String(state.handledInsertBefore || 0);
    $diagReplace.textContent = String(state.handledReplaceChild || 0);
    $diagLastError.textContent = state.lastHandledError || '-';
  }

  function renderSiteMode() {
    if (!activeTab || !currentSettings) return;
    var resolved = siteConfig.resolveSiteSettings(activeTab.url, {
      globalEnabled: currentSettings.globalEnabled,
      protectionMode: currentSettings.protectionMode,
      targetLanguage: currentSettings.targetLanguage,
      siteOverrides: currentSettings.siteOverrides,
    });

    $siteModeSelect.value = resolved.siteMode;
  }
})();
