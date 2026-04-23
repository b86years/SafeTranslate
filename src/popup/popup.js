/**
 * SafeTranslate — Popup Controller
 * Loads settings & per-tab state, binds UI controls,
 * and persists user preference changes via the background worker.
 */
(function () {
  'use strict';

  var ST = globalThis.__SAFE_TRANSLATE__;
  var ignoreTermsHelper = globalThis.__SAFE_TRANSLATE_IGNORE_TERMS__;
  var siteConfig = globalThis.__SAFE_TRANSLATE_SITE_CONFIG__;
  if (!ST) return;
  if (!ignoreTermsHelper) return;
  if (!siteConfig) return;

  // ── DOM refs ──

  var $toggle = document.getElementById('globalToggle');
  var $statusCard = document.getElementById('statusCard');
  var $indicator = document.getElementById('statusIndicator');
  var $label = document.getElementById('statusLabel');
  var $detail = document.getElementById('statusDetail');
  var $activityChip = document.getElementById('activityChip');
  var $activityMeta = document.getElementById('activityMeta');
  var $count = document.getElementById('protectionCount');
  var $throughput = document.getElementById('throughputValue');
  var $radios = document.querySelectorAll('input[name="mode"]');
  var $targetLanguageSelect = document.getElementById('targetLanguageSelect');
  var $providerSelect = document.getElementById('providerSelect');
  var $providerHint = document.getElementById('providerHint');
  var $providerBaseGroup = document.getElementById('providerBaseGroup');
  var $providerBaseUrlInput = document.getElementById('providerBaseUrlInput');
  var $providerModelGroup = document.getElementById('providerModelGroup');
  var $providerModelInput = document.getElementById('providerModelInput');
  var $providerModelSelect = document.getElementById('providerModelSelect');
  var $providerModelHint = document.getElementById('providerModelHint');
  var $providerApiKeyGroup = document.getElementById('providerApiKeyGroup');
  var $providerApiKeyInput = document.getElementById('providerApiKeyInput');
  var $autoTranslateToggle = document.getElementById('autoTranslateToggle');
  var $providerStatusCard = document.getElementById('providerStatusCard');
  var $providerStatusTitle = document.getElementById('providerStatusTitle');
  var $providerStatusLabel = document.getElementById('providerStatusLabel');
  var $providerStatusDetail = document.getElementById('providerStatusDetail');
  var $providerCheckButton = document.getElementById('providerCheckButton');
  var $ignoreTermsInput = document.getElementById('ignoreTermsInput');
  var $importSettingsButton = document.getElementById('importSettingsButton');
  var $exportSettingsButton = document.getElementById('exportSettingsButton');
  var $settingsImportInput = document.getElementById('settingsImportInput');
  var $settingsJsonStatus = document.getElementById('settingsJsonStatus');
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
  var ollamaModelsLoadedFor = '';
  var currentPageState = null;
  var currentTranslationMetrics = null;
  var currentTabActivity = createIdleTabActivity();
  var liveRefreshTimer = 0;

  // ── Load current-tab status ──

  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    if (!tabs[0]) return;
    activeTab = tabs[0];
    $siteHost.textContent = siteConfig.normalizeHost(activeTab.url) || '無法辨識';
    refreshCurrentTabState();
    startLiveRefresh();
  });

  // ── Load settings ──

  chrome.runtime.sendMessage(
    { type: ST.MESSAGES.GET_SETTINGS },
    function (s) {
      if (!s) return;
      applyLoadedSettings(s);
    }
  );

  // ── Load stats ──

  chrome.storage.local.get({ protectionCount: 0 }, function (d) {
    $count.textContent = d.protectionCount;
  });

  $footerVersion.textContent = 'v' + ST.VERSION;

  window.addEventListener('unload', function () {
    if (liveRefreshTimer) {
      clearInterval(liveRefreshTimer);
      liveRefreshTimer = 0;
    }
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
    if ((currentSettings && currentSettings.translationProvider) === ST.PROVIDERS.OLLAMA) {
      loadOllamaModels(true);
    }
  });

  $providerModelInput.addEventListener('change', function () {
    persist({ providerModel: this.value.trim() });
  });

  $providerModelSelect.addEventListener('change', function () {
    persist({ providerModel: this.value });
  });

  $providerApiKeyInput.addEventListener('change', function () {
    persist({ providerApiKey: this.value.trim() });
  });

  $autoTranslateToggle.addEventListener('change', function () {
    persist({ autoTranslatePage: this.checked });
  });

  $providerCheckButton.addEventListener('click', function () {
    checkSelectedProviderStatus();
  });

  $ignoreTermsInput.addEventListener('change', persistIgnoreTermsFromInput);
  $ignoreTermsInput.addEventListener('blur', persistIgnoreTermsFromInput);

  $exportSettingsButton.addEventListener('click', function () {
    exportSettingsAsJson();
  });

  $importSettingsButton.addEventListener('click', function () {
    $settingsImportInput.click();
  });

  $settingsImportInput.addEventListener('change', function () {
    importSettingsFromSelectedFile();
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
      ollamaModelsLoadedFor = '';
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
    if (partial.ignoreTerms !== undefined && currentSettings) {
      currentSettings.ignoreTerms = ignoreTermsHelper.normalizeIgnoreTerms(partial.ignoreTerms);
      $ignoreTermsInput.value = ignoreTermsHelper.formatIgnoreTerms(currentSettings.ignoreTerms);
    }

    chrome.runtime.sendMessage({
      type: ST.MESSAGES.UPDATE_SETTINGS,
      payload: partial,
      tabId: activeTab ? activeTab.id : null,
    });

    renderSiteMode();
    renderProviderFields();
    if (
      partial.targetLanguage !== undefined ||
      partial.translationProvider !== undefined
    ) {
      renderProviderStatus(null);
    }
  }

  function applyLoadedSettings(settings) {
    currentSettings = settings;
    $toggle.checked = settings.globalEnabled;
    selectMode(settings.protectionMode);
    $targetLanguageSelect.value = settings.targetLanguage || ST.DEFAULTS.TARGET_LANGUAGE;
    $providerSelect.value = settings.translationProvider || ST.DEFAULTS.TRANSLATION_PROVIDER;
    $providerBaseUrlInput.value = settings.providerBaseUrl || '';
    $providerModelInput.value = settings.providerModel || '';
    $providerApiKeyInput.value = settings.providerApiKey || '';
    $autoTranslateToggle.checked = settings.autoTranslatePage !== false;
    $ignoreTermsInput.value = ignoreTermsHelper.formatIgnoreTerms(settings.ignoreTerms || []);
    renderProviderFields();
    renderSiteMode();
    renderProviderStatus(null);
  }

  function persistIgnoreTermsFromInput() {
    if (!currentSettings) return;

    var normalized = ignoreTermsHelper.normalizeIgnoreTerms($ignoreTermsInput.value);
    var formatted = ignoreTermsHelper.formatIgnoreTerms(normalized);

    if ($ignoreTermsInput.value !== formatted) {
      $ignoreTermsInput.value = formatted;
    }

    showSettingsJsonStatus('已更新不翻譯詞彙清單，本機 JSON 快照也已同步。', 'success');
    persist({ ignoreTerms: normalized });
  }

  function exportSettingsAsJson() {
    chrome.runtime.sendMessage(
      { type: ST.MESSAGES.EXPORT_SETTINGS_JSON },
      function (response) {
        var blob;
        var url;
        var link;

        if (chrome.runtime.lastError) {
          showSettingsJsonStatus(chrome.runtime.lastError.message, 'error');
          return;
        }

        if (!response || response.ok === false || !response.json) {
          showSettingsJsonStatus(
            response && response.message ? response.message : '匯出 JSON 失敗。',
            'error'
          );
          return;
        }

        blob = new Blob([response.json], { type: 'application/json' });
        url = URL.createObjectURL(blob);
        link = document.createElement('a');
        link.href = url;
        link.download = response.fileName || 'safe-translate-settings.json';
        link.click();

        setTimeout(function () {
          URL.revokeObjectURL(url);
        }, 0);

        showSettingsJsonStatus('已匯出 JSON 設定檔。', 'success');
      }
    );
  }

  function importSettingsFromSelectedFile() {
    var file = $settingsImportInput.files && $settingsImportInput.files[0];
    var reader;

    if (!file) return;

    reader = new FileReader();
    reader.onload = function () {
      chrome.runtime.sendMessage(
        {
          type: ST.MESSAGES.IMPORT_SETTINGS_JSON,
          payload: {
            json: String(reader.result || ''),
          },
          tabId: activeTab ? activeTab.id : null,
        },
        function (response) {
          if (chrome.runtime.lastError) {
            showSettingsJsonStatus(chrome.runtime.lastError.message, 'error');
            $settingsImportInput.value = '';
            return;
          }

          if (!response || response.ok === false || !response.settings) {
            showSettingsJsonStatus(
              response && response.message ? response.message : '匯入 JSON 失敗。',
              'error'
            );
            $settingsImportInput.value = '';
            return;
          }

          applyLoadedSettings(response.settings);
          showSettingsJsonStatus('已從 JSON 匯入設定，並同步更新本機快照。', 'success');
          $settingsImportInput.value = '';
        }
      );
    };
    reader.onerror = function () {
      showSettingsJsonStatus('讀取檔案失敗。', 'error');
      $settingsImportInput.value = '';
    };
    reader.readAsText(file, 'utf-8');
  }

  function showSettingsJsonStatus(message, tone) {
    $settingsJsonStatus.textContent = message;
    $settingsJsonStatus.classList.remove('error', 'success');

    if (tone) {
      $settingsJsonStatus.classList.add(tone);
    }
  }

  function selectMode(value) {
    for (var i = 0; i < $radios.length; i++) {
      $radios[i].checked = $radios[i].value === value;
    }
  }

  function renderStatus(state) {
    currentPageState = state || null;
    currentTranslationMetrics = normalizeTranslationMetrics(
      state && state.translationMetrics
    );
    renderTranslationMetrics();
    renderCompositeStatus();
  }

  function setStatus(cls, label, detail) {
    $indicator.className = 'status-indicator ' + cls;
    $label.textContent = label;
    $detail.textContent = detail;
  }

  function setActivityState(mode, label, meta) {
    $statusCard.classList.remove('is-idle', 'is-busy', 'is-cooldown');
    $statusCard.classList.add(
      mode === 'busy' ? 'is-busy' : mode === 'cooldown' ? 'is-cooldown' : 'is-idle'
    );
    $activityChip.className = 'activity-chip ' + mode;
    $activityChip.textContent = label;
    $activityMeta.textContent = meta;
  }

  function renderCompositeStatus() {
    var baseStatus = getPageStatusSummary(currentPageState);

    if (currentTabActivity.isVisualLoading) {
      setStatus(
        'active',
        '翻譯中',
        currentPageState && currentPageState.isReactSite
          ? '正在翻譯頁面文字，React 保護持續啟用。'
          : '正在處理頁面文字，完成後會自動收斂。'
      );
      setActivityState(
        'busy',
        currentTabActivity.activeTranslationCount > 1
          ? 'LIVE ×' + currentTabActivity.activeTranslationCount
          : 'LIVE',
        describeBusyActivity(currentTabActivity)
      );
      return;
    }

    if (wasRecentlyActive(currentTabActivity)) {
      setStatus(
        baseStatus.cls === 'error' ? 'ready' : baseStatus.cls,
        '剛完成',
        currentPageState && currentPageState.isReactSite
          ? '最近一輪翻譯已完成，保護仍維持啟用。'
          : '最近一輪翻譯已完成，仍持續監控新內容。'
      );
      setActivityState('cooldown', 'DONE', describeCooldownActivity(currentTabActivity));
      return;
    }

    setStatus(baseStatus.cls, baseStatus.label, baseStatus.detail);
    setActivityState('idle', 'STANDBY', describeIdleActivity(baseStatus));
  }

  function getPageStatusSummary(state) {
    if (!state) {
      return {
        cls: 'idle',
        label: '等待頁面',
        detail: '重新整理頁面後可取得即時診斷。',
      };
    }

    if (!state.protectionActive) {
      return {
        cls: 'error',
        label: '未掛載',
        detail: '頁面尚未回報核心保護狀態。',
      };
    }

    if (state.translationDetected && state.isReactSite) {
      return {
        cls: 'protecting',
        label: '保護中',
        detail: '已偵測到 React 應用，翻譯保護已啟用。',
      };
    }

    if (state.translationDetected) {
      return {
        cls: 'active',
        label: '翻譯中',
        detail: '已偵測到 Chrome 翻譯，保護已就緒。',
      };
    }

    if (state.isReactSite) {
      return {
        cls: 'ready',
        label: '就緒',
        detail: '偵測到 React 應用，保護已啟用。',
      };
    }

    return {
      cls: 'idle',
      label: '監控中',
      detail: '等待偵測翻譯活動。',
    };
  }

  function createIdleTabActivity() {
    return {
      activeTranslationCount: 0,
      isVisualLoading: false,
      visualLoadingUntil: 0,
      lastTranslationStartedAt: 0,
      lastTranslationFinishedAt: 0,
    };
  }

  function normalizeTabActivity(activity) {
    var safe = activity || {};
    return {
      activeTranslationCount: Number(safe.activeTranslationCount || 0),
      isVisualLoading: Boolean(safe.isVisualLoading),
      visualLoadingUntil: Number(safe.visualLoadingUntil || 0),
      lastTranslationStartedAt: Number(safe.lastTranslationStartedAt || 0),
      lastTranslationFinishedAt: Number(safe.lastTranslationFinishedAt || 0),
    };
  }

  function wasRecentlyActive(activity) {
    return Boolean(
      activity &&
      !activity.isVisualLoading &&
      activity.lastTranslationFinishedAt &&
      Date.now() - activity.lastTranslationFinishedAt < 8000
    );
  }

  function describeBusyActivity(activity) {
    var elapsed = activity.lastTranslationStartedAt
      ? formatElapsed(Date.now() - activity.lastTranslationStartedAt)
      : '剛開始';
    var queueLabel = activity.activeTranslationCount > 1
      ? '批次並行 ' + activity.activeTranslationCount + ' 筆'
      : '單筆翻譯處理中';

    return elapsed + ' · ' + queueLabel;
  }

  function describeCooldownActivity(activity) {
    var ago = formatElapsed(Date.now() - activity.lastTranslationFinishedAt);
    return ago + ' 前完成，介面維持穩定回饋';
  }

  function describeIdleActivity(baseStatus) {
    if (baseStatus.label === '就緒') {
      return '保護已掛載，等待新一輪翻譯工作';
    }
    if (baseStatus.label === '保護中') {
      return '已偵測翻譯風險，保護持續工作中';
    }
    if (baseStatus.label === '未掛載') {
      return '此分頁尚未回報執行狀態';
    }
    return '尚未收到新的翻譯工作階段';
  }

  function formatElapsed(ms) {
    if (ms < 1000) {
      return Math.max(0.1, Math.round(ms / 100) / 10).toFixed(1) + 's';
    }

    if (ms < 60000) {
      return Math.round(ms / 1000) + 's';
    }

    return Math.round(ms / 60000) + 'm';
  }

  function renderDiagnostics(state) {
    $diagVersion.textContent = state.protectionVersion || ST.VERSION;
    $diagReason.textContent = state.detectedReason || '-';
    $diagRemove.textContent = String(state.handledRemoveChild || 0);
    $diagInsert.textContent = String(state.handledInsertBefore || 0);
    $diagReplace.textContent = String(state.handledReplaceChild || 0);
    $diagLastError.textContent = state.lastHandledError || '-';
  }

  function renderTranslationMetrics() {
    var metrics = currentTranslationMetrics;
    $throughput.textContent = formatThroughput(metrics);
  }

  function normalizeTranslationMetrics(metrics) {
    var safe = metrics || {};
    return {
      completedTranslations: Number(safe.completedTranslations || 0),
      translatedCharCount: Number(safe.translatedCharCount || 0),
      totalDurationMs: Number(safe.totalDurationMs || 0),
      lastCompletedAt: Number(safe.lastCompletedAt || 0),
    };
  }

  function formatThroughput(metrics) {
    if (!metrics.completedTranslations || metrics.totalDurationMs <= 0) {
      return '-';
    }

    var charsPerSecond = (metrics.translatedCharCount * 1000) / metrics.totalDurationMs;
    if (!isFinite(charsPerSecond) || charsPerSecond <= 0) {
      return '-';
    }

    if (charsPerSecond >= 100) {
      return Math.round(charsPerSecond) + ' 字/秒';
    }
    if (charsPerSecond >= 10) {
      return charsPerSecond.toFixed(1) + ' 字/秒';
    }
    return charsPerSecond.toFixed(2) + ' 字/秒';
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
    var showBaseUrl =
      provider === ST.PROVIDERS.OPENAI_COMPATIBLE ||
      provider === ST.PROVIDERS.OPENROUTER ||
      provider === ST.PROVIDERS.OLLAMA;
    var showModel =
      provider === ST.PROVIDERS.OPENAI_COMPATIBLE ||
      provider === ST.PROVIDERS.OPENROUTER ||
      provider === ST.PROVIDERS.OLLAMA;
    var showApiKey =
      provider === ST.PROVIDERS.OPENAI_COMPATIBLE ||
      provider === ST.PROVIDERS.OPENROUTER;

    $providerBaseGroup.hidden = !showBaseUrl;
    $providerModelGroup.hidden = !showModel;
    $providerApiKeyGroup.hidden = !showApiKey;
    $providerStatusCard.hidden = false;
    $providerModelSelect.hidden = provider !== ST.PROVIDERS.OLLAMA;
    $providerModelInput.hidden = provider === ST.PROVIDERS.OLLAMA;
    $providerStatusTitle.textContent = getProviderStatusTitle(provider);

    if (provider === ST.PROVIDERS.GOOGLE_TRANSLATE) {
      $providerHint.textContent = '使用 Google 翻譯公開端點，不需要另外填 API Key 或模型。';
      $providerBaseUrlInput.placeholder = '';
      $providerModelInput.placeholder = '';
      $providerModelHint.textContent = 'Google 翻譯會直接使用目前選擇的目標語言。';
    } else if (provider === ST.PROVIDERS.OPENROUTER) {
      $providerHint.textContent = 'OpenRouter 使用 OpenAI 相容格式，Base URL 可留空使用預設端點。';
      $providerBaseUrlInput.placeholder = 'https://openrouter.ai/api/v1';
      $providerModelInput.placeholder = 'google/gemini-2.0-flash-exp';
      $providerModelHint.textContent = '輸入要使用的 OpenRouter 模型名稱。';
    } else if (provider === ST.PROVIDERS.OPENAI_COMPATIBLE) {
      $providerHint.textContent = '支援自訂 OpenAI 相容端點，API Key 只會留在目前裝置。';
      $providerBaseUrlInput.placeholder = 'https://api.example.com/v1';
      $providerModelInput.placeholder = 'gpt-4.1-mini';
      $providerModelHint.textContent = '輸入要使用的模型名稱。';
    } else {
      $providerHint.textContent = '適合本機 Ollama，請確認 Chrome 可連到你的 Ollama 服務。';
      $providerBaseUrlInput.placeholder = 'http://127.0.0.1:11434';
      $providerModelInput.placeholder = 'qwen2.5:3b';
      $providerModelHint.textContent = '直接讀取目前 Ollama 可用模型。';
      if (!ollamaModelsLoadedFor || ollamaModelsLoadedFor !== normalizeOllamaBaseUrlForUi()) {
        loadOllamaModels(false);
      } else {
        syncOllamaModelSelection(currentSettings.providerModel || '');
      }
    }
  }

  function getProviderStatusTitle(provider) {
    if (provider === ST.PROVIDERS.GOOGLE_TRANSLATE) {
      return 'Google 翻譯狀態';
    }
    if (provider === ST.PROVIDERS.OPENROUTER) {
      return 'OpenRouter 狀態';
    }
    if (provider === ST.PROVIDERS.OPENAI_COMPATIBLE) {
      return 'OpenAI 相容 API 狀態';
    }
    return 'Ollama 狀態';
  }

  function loadOllamaModels(forceReload) {
    if (!currentSettings) return;

    var baseUrl = normalizeOllamaBaseUrlForUi();
    if (!forceReload && ollamaModelsLoadedFor === baseUrl) {
      syncOllamaModelSelection(currentSettings.providerModel || '');
      return;
    }

    ollamaModelsLoadedFor = '';
    $providerModelSelect.innerHTML = '<option value="">載入模型清單中...</option>';
    $providerModelSelect.value = '';

    chrome.runtime.sendMessage(
      {
        type: ST.MESSAGES.GET_OLLAMA_MODELS,
        payload: {
          baseUrl: currentSettings.providerBaseUrl || '',
        },
      },
      function (response) {
        if (chrome.runtime.lastError) {
          renderOllamaModelOptions([], currentSettings.providerModel || '', chrome.runtime.lastError.message);
          return;
        }

        if (!response || response.error || response.ok === false) {
          renderOllamaModelOptions(
            [],
            currentSettings.providerModel || '',
            response && response.message ? response.message : '無法讀取 Ollama 模型。'
          );
          return;
        }

        ollamaModelsLoadedFor = baseUrl;
        renderOllamaModelOptions(response.models || [], currentSettings.providerModel || '', '');
      }
    );
  }

  function renderOllamaModelOptions(models, selectedValue, errorMessage) {
    $providerModelSelect.innerHTML = '';

    if (errorMessage) {
      appendOption($providerModelSelect, '', '無法載入模型');
      $providerModelSelect.value = '';
      $providerModelHint.textContent = errorMessage;
      return;
    }

    if (!models.length) {
      appendOption($providerModelSelect, '', '找不到可用模型');
      $providerModelSelect.value = '';
      $providerModelHint.textContent = '此 Ollama 端點目前沒有可選模型。';
      return;
    }

    appendOption($providerModelSelect, '', '選擇 Ollama 模型');
    for (var i = 0; i < models.length; i++) {
      var item = models[i];
      var label = item.name;
      if (item.parameterSize || item.family) {
        label += ' · ' + [item.parameterSize, item.family].filter(Boolean).join(' / ');
      }
      appendOption($providerModelSelect, item.name, label);
    }

    syncOllamaModelSelection(selectedValue);
    $providerModelHint.textContent = '直接讀取目前 Ollama 可用模型。';
  }

  function syncOllamaModelSelection(selectedValue) {
    var value = selectedValue || '';
    for (var i = 0; i < $providerModelSelect.options.length; i++) {
      if ($providerModelSelect.options[i].value === value) {
        $providerModelSelect.value = value;
        return;
      }
    }

    if (value) {
      appendOption($providerModelSelect, value, value + ' · 目前設定');
      $providerModelSelect.value = value;
      return;
    }

    $providerModelSelect.value = '';
  }

  function appendOption(selectEl, value, label) {
    var option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    selectEl.appendChild(option);
  }

  function normalizeOllamaBaseUrlForUi() {
    var value = String((currentSettings && currentSettings.providerBaseUrl) || 'http://127.0.0.1:11434').replace(/\/+$/, '');
    value = value.replace(/\/(api\/(generate|chat|tags)|v1\/chat\/completions)$/, '');
    return value;
  }

  function renderProviderStatus(status) {
    var provider = currentSettings
      ? currentSettings.translationProvider || ST.DEFAULTS.TRANSLATION_PROVIDER
      : ST.DEFAULTS.TRANSLATION_PROVIDER;
    var next = status || createIdleProviderStatus(provider);

    $providerStatusLabel.className = 'status-pill ' + next.kind;
    $providerStatusLabel.textContent = next.label;
    $providerStatusDetail.textContent = next.detail;
    $providerCheckButton.disabled = false;
    $providerCheckButton.textContent = '點擊檢查';
  }

  function startLiveRefresh() {
    if (liveRefreshTimer) {
      clearInterval(liveRefreshTimer);
    }

    liveRefreshTimer = setInterval(function () {
      refreshCurrentTabState();
    }, 500);
  }

  function refreshCurrentTabState() {
    if (!activeTab) {
      return;
    }

    chrome.tabs.sendMessage(
      activeTab.id,
      { type: ST.MESSAGES.GET_PAGE_STATE },
      function (state) {
        if (chrome.runtime.lastError) {
          currentPageState = null;
          renderTranslationMetrics();
          renderCompositeStatus();
          return;
        }

        if (state) {
          renderStatus(state);
          renderDiagnostics(state);
        }
      }
    );

    chrome.runtime.sendMessage(
      {
        type: ST.MESSAGES.GET_TAB_ACTIVITY,
        tabId: activeTab.id,
      },
      function (activity) {
        if (chrome.runtime.lastError) {
          currentTabActivity = createIdleTabActivity();
          renderCompositeStatus();
          return;
        }

        currentTabActivity = normalizeTabActivity(activity);
        renderCompositeStatus();
      }
    );
  }

  function createIdleProviderStatus(provider) {
    if (provider === ST.PROVIDERS.GOOGLE_TRANSLATE) {
      return {
        kind: 'idle',
        label: '點擊檢查',
        detail: '尚未檢查目前選擇的 Google 翻譯端點。',
      };
    }

    if (provider === ST.PROVIDERS.OPENROUTER) {
      return {
        kind: 'idle',
        label: '點擊檢查',
        detail: '尚未檢查目前選擇的 OpenRouter API 與模型。',
      };
    }

    if (provider === ST.PROVIDERS.OPENAI_COMPATIBLE) {
      return {
        kind: 'idle',
        label: '點擊檢查',
        detail: '尚未檢查目前選擇的 OpenAI 相容 API 與模型。',
      };
    }

    return {
      kind: 'idle',
      label: '點擊檢查',
      detail: '尚未檢查目前選擇的 Ollama 服務與模型。',
    };
  }

  function checkSelectedProviderStatus() {
    if (!currentSettings) {
      renderProviderStatus({
        kind: 'error',
        label: '無法檢查',
        detail: '設定尚未載入完成。',
      });
      return;
    }

    var provider = currentSettings.translationProvider || ST.DEFAULTS.TRANSLATION_PROVIDER;

    $providerCheckButton.disabled = true;
    $providerCheckButton.textContent = '檢查中...';
    $providerStatusLabel.className = 'status-pill idle';
    $providerStatusLabel.textContent = '檢查中';
    $providerStatusDetail.textContent = getCheckingStatusDetail(provider);

    chrome.runtime.sendMessage(
      {
        type: ST.MESSAGES.CHECK_PROVIDER_STATUS,
        payload: {
          provider: provider,
          baseUrl: currentSettings.providerBaseUrl || '',
          model: currentSettings.providerModel || '',
        },
      },
      function (response) {
        if (chrome.runtime.lastError) {
          renderProviderStatus({
            kind: 'error',
            label: '無法檢查',
            detail: chrome.runtime.lastError.message,
          });
          return;
        }

        renderProviderStatus(response || null);
      }
    );
  }

  function getCheckingStatusDetail(provider) {
    if (provider === ST.PROVIDERS.GOOGLE_TRANSLATE) {
      return '正在檢查 Google 翻譯公開端點是否可用。';
    }
    if (provider === ST.PROVIDERS.OPENROUTER) {
      return '正在檢查目前 OpenRouter API 與模型是否可用。';
    }
    if (provider === ST.PROVIDERS.OPENAI_COMPATIBLE) {
      return '正在檢查目前 OpenAI 相容 API 與模型是否可用。';
    }
    return '正在檢查目前 Ollama 服務與模型是否可用。';
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
