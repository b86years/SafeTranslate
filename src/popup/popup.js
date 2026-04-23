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
  var $targetLanguageSelect = document.getElementById('targetLanguageSelect');
  var $providerSelect = document.getElementById('providerSelect');
  var $providerHint = document.getElementById('providerHint');
  var $builtInStatusGroup = document.getElementById('builtInStatusGroup');
  var $builtInStatusChip = document.getElementById('builtInStatusChip');
  var $builtInStatusDetail = document.getElementById('builtInStatusDetail');
  var $providerBaseGroup = document.getElementById('providerBaseGroup');
  var $providerBaseUrlInput = document.getElementById('providerBaseUrlInput');
  var $providerModelGroup = document.getElementById('providerModelGroup');
  var $providerModelInput = document.getElementById('providerModelInput');
  var $providerApiKeyGroup = document.getElementById('providerApiKeyGroup');
  var $providerApiKeyInput = document.getElementById('providerApiKeyInput');
  var $autoTranslateToggle = document.getElementById('autoTranslateToggle');
  var $siteHost = document.getElementById('siteHost');
  var $siteModeSelect = document.getElementById('siteModeSelect');
  var $siteTranslationSelect = document.getElementById('siteTranslationSelect');
  var $diagVersion = document.getElementById('diagVersion');
  var $diagReason = document.getElementById('diagReason');
  var $diagRemove = document.getElementById('diagRemove');
  var $diagInsert = document.getElementById('diagInsert');
  var $diagReplace = document.getElementById('diagReplace');
  var $diagLastError = document.getElementById('diagLastError');
  var $footerVersion = document.getElementById('footerVersion');
  var activeTab = null;
  var currentSettings = null;
  var currentPageState = null;
  var pageStatePollId = 0;

  // ── Load current-tab status ──

  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    if (!tabs[0]) return;
    activeTab = tabs[0];
    $siteHost.textContent = siteConfig.normalizeHost(activeTab.url) || '無法辨識';
    refreshPageState();
    startPageStatePolling();
  });

  // ── Load settings ──

  chrome.runtime.sendMessage(
    { type: ST.MESSAGES.GET_SETTINGS },
    function (s) {
      if (!s) return;
      currentSettings = s;
      $toggle.checked = s.globalEnabled;
      selectMode(s.protectionMode);
      $targetLanguageSelect.value = s.targetLanguage || ST.DEFAULTS.TARGET_LANGUAGE;
      $providerSelect.value = s.translationProvider || ST.DEFAULTS.TRANSLATION_PROVIDER;
      $providerBaseUrlInput.value = s.providerBaseUrl || '';
      $providerModelInput.value = s.providerModel || '';
      $providerApiKeyInput.value = s.providerApiKey || '';
      $autoTranslateToggle.checked = s.autoTranslatePage !== false;
      renderProviderFields();
      renderSiteMode();
    }
  );

  // ── Load stats ──

  chrome.storage.local.get({ protectionCount: 0 }, function (d) {
    $count.textContent = d.protectionCount;
  });

  $footerVersion.textContent = 'v' + ST.VERSION;
  window.addEventListener('unload', stopPageStatePolling);

  // ── Event bindings ──

  $toggle.addEventListener('change', function () {
    persist({ globalEnabled: this.checked });
  });

  for (var i = 0; i < $radios.length; i++) {
    $radios[i].addEventListener('change', function () {
      persist({ protectionMode: this.value });
    });
  }

  $targetLanguageSelect.addEventListener('change', function () {
    persist({ targetLanguage: this.value });
  });

  $providerSelect.addEventListener('change', function () {
    var provider = this.value;
    persist({ translationProvider: provider });
    renderProviderFields();
  });

  $providerBaseUrlInput.addEventListener('change', function () {
    persist({ providerBaseUrl: this.value.trim() });
  });

  $providerModelInput.addEventListener('change', function () {
    persist({ providerModel: this.value.trim() });
  });

  $providerApiKeyInput.addEventListener('change', function () {
    persist({ providerApiKey: this.value.trim() });
  });

  $autoTranslateToggle.addEventListener('change', function () {
    persist({ autoTranslatePage: this.checked });
  });

  $siteModeSelect.addEventListener('change', function () {
    if (!activeTab || !currentSettings) return;

    var siteKey = siteConfig.normalizeHost(activeTab.url);
    if (!siteKey) return;

    updateSiteOverride(siteKey, {
      mode: this.value,
    });
  });

  $siteTranslationSelect.addEventListener('change', function () {
    if (!activeTab || !currentSettings) return;

    var siteKey = siteConfig.normalizeHost(activeTab.url);
    if (!siteKey) return;

    updateSiteOverride(siteKey, {
      translation: this.value,
    });
  });

  // ── Helpers ──

  function persist(partial) {
    if (partial.siteOverrides && currentSettings) {
      currentSettings.siteOverrides = partial.siteOverrides;
    }
    if (partial.protectionMode && currentSettings) {
      currentSettings.protectionMode = partial.protectionMode;
    }
    if (partial.targetLanguage && currentSettings) {
      currentSettings.targetLanguage = partial.targetLanguage;
    }
    if (partial.translationProvider && currentSettings) {
      currentSettings.translationProvider = partial.translationProvider;
    }
    if (partial.providerBaseUrl !== undefined && currentSettings) {
      currentSettings.providerBaseUrl = partial.providerBaseUrl;
    }
    if (partial.providerModel !== undefined && currentSettings) {
      currentSettings.providerModel = partial.providerModel;
    }
    if (partial.providerApiKey !== undefined && currentSettings) {
      currentSettings.providerApiKey = partial.providerApiKey;
    }
    if (partial.autoTranslatePage !== undefined && currentSettings) {
      currentSettings.autoTranslatePage = partial.autoTranslatePage;
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
    renderProviderFields();
    refreshPageState();
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

  function refreshPageState() {
    if (!activeTab) return;

    chrome.tabs.sendMessage(
      activeTab.id,
      { type: ST.MESSAGES.GET_PAGE_STATE },
      function (state) {
        if (chrome.runtime.lastError) {
          currentPageState = null;
          setStatus('idle', '等待頁面', '重新整理頁面後可取得即時診斷');
          renderBuiltInStatus(null);
          return;
        }

        if (state) {
          currentPageState = state;
          renderStatus(state);
          renderDiagnostics(state);
          renderBuiltInStatus(state);
        }
      }
    );
  }

  function startPageStatePolling() {
    stopPageStatePolling();
    pageStatePollId = setInterval(function () {
      refreshPageState();
    }, 1200);
  }

  function stopPageStatePolling() {
    if (!pageStatePollId) return;
    clearInterval(pageStatePollId);
    pageStatePollId = 0;
  }

  function renderSiteMode() {
    if (!activeTab || !currentSettings) return;
    var resolved = siteConfig.resolveSiteSettings(activeTab.url, {
      globalEnabled: currentSettings.globalEnabled,
      protectionMode: currentSettings.protectionMode,
      targetLanguage: currentSettings.targetLanguage,
      autoTranslatePage: currentSettings.autoTranslatePage,
      translationProvider: currentSettings.translationProvider,
      providerBaseUrl: currentSettings.providerBaseUrl,
      providerModel: currentSettings.providerModel,
      siteOverrides: currentSettings.siteOverrides,
    });

    $siteModeSelect.value = resolved.siteMode;
    $siteTranslationSelect.value = resolved.siteTranslation;
  }

  function renderProviderFields() {
    if (!currentSettings) return;

    var provider = currentSettings.translationProvider || ST.DEFAULTS.TRANSLATION_PROVIDER;
    var showBaseUrl = provider !== ST.PROVIDERS.BUILT_IN;
    var showModel = provider !== ST.PROVIDERS.BUILT_IN;
    var showApiKey = provider === ST.PROVIDERS.OPENAI_COMPATIBLE;
    var showBuiltInStatus = provider === ST.PROVIDERS.BUILT_IN;

    $providerBaseGroup.hidden = !showBaseUrl;
    $providerModelGroup.hidden = !showModel;
    $providerApiKeyGroup.hidden = !showApiKey;
    $builtInStatusGroup.hidden = !showBuiltInStatus;

    if (provider === ST.PROVIDERS.BUILT_IN) {
      $providerHint.textContent = '優先使用本機 Translator API，在支援裝置上可離線運作。';
      $providerBaseUrlInput.placeholder = '';
      $providerModelInput.placeholder = '';
    } else if (provider === ST.PROVIDERS.OPENAI_COMPATIBLE) {
      $providerHint.textContent = '支援自訂 OpenAI 相容端點，API Key 只會留在目前裝置。';
      $providerBaseUrlInput.placeholder = 'https://api.example.com/v1';
      $providerModelInput.placeholder = 'gpt-4.1-mini';
    } else {
      $providerHint.textContent = '適合本機 Ollama，請確認 Chrome 可連到你的 Ollama 服務。';
      $providerBaseUrlInput.placeholder = 'http://127.0.0.1:11434';
      $providerModelInput.placeholder = 'qwen2.5:3b';
    }

    renderBuiltInStatus(currentPageState);
  }

  function renderBuiltInStatus(state) {
    if (!currentSettings || currentSettings.translationProvider !== ST.PROVIDERS.BUILT_IN) {
      return;
    }

    var status = state && state.builtInAiStatus ? state.builtInAiStatus : 'idle';
    var detail = state && state.builtInAiDetail
      ? state.builtInAiDetail
      : '等待目前分頁回報 Chrome 內建 AI 狀態。';
    var visual = mapBuiltInStatus(status);

    $builtInStatusChip.className = 'provider-status-chip ' + visual.tone;
    $builtInStatusChip.textContent = visual.label;
    $builtInStatusDetail.textContent = detail;
  }

  function mapBuiltInStatus(status) {
    if (status === 'ready') {
      return { tone: 'ready', label: '已就緒' };
    }
    if (
      status === 'checking' ||
      status === 'waiting-activation' ||
      status === 'downloadable' ||
      status === 'downloading' ||
      status === 'waiting-language'
    ) {
      return { tone: 'warn', label: status === 'checking' ? '檢查中' : '待準備' };
    }
    if (status === 'inactive') {
      return { tone: 'idle', label: '未使用' };
    }
    if (status === 'unsupported' || status === 'unavailable' || status === 'error') {
      return { tone: 'error', label: '不可用' };
    }
    return { tone: 'idle', label: '待檢查' };
  }

  function updateSiteOverride(siteKey, patch) {
    var overrides = Object.assign({}, currentSettings.siteOverrides || {});
    var existing = overrides[siteKey] || {
      mode: ST.SITE_OVERRIDES.INHERIT,
      translation: ST.SITE_TRANSLATION.INHERIT,
    };
    var next = {
      mode:
        patch.mode !== undefined
          ? patch.mode
          : existing.mode || ST.SITE_OVERRIDES.INHERIT,
      translation:
        patch.translation !== undefined
          ? patch.translation
          : existing.translation || ST.SITE_TRANSLATION.INHERIT,
    };

    if (
      next.mode === ST.SITE_OVERRIDES.INHERIT &&
      next.translation === ST.SITE_TRANSLATION.INHERIT
    ) {
      delete overrides[siteKey];
    } else {
      overrides[siteKey] = next;
    }

    persist({ siteOverrides: overrides });
  }
})();
