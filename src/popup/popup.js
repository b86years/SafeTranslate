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
  var $providerBaseGroup = document.getElementById('providerBaseGroup');
  var $providerBaseUrlInput = document.getElementById('providerBaseUrlInput');
  var $providerModelGroup = document.getElementById('providerModelGroup');
  var $providerModelInput = document.getElementById('providerModelInput');
  var $providerModelSelect = document.getElementById('providerModelSelect');
  var $providerModelHint = document.getElementById('providerModelHint');
  var $providerApiKeyGroup = document.getElementById('providerApiKeyGroup');
  var $providerApiKeyInput = document.getElementById('providerApiKeyInput');
  var $autoTranslateToggle = document.getElementById('autoTranslateToggle');
  var $builtInStatusCard = document.getElementById('builtInStatusCard');
  var $providerStatusTitle = document.getElementById('providerStatusTitle');
  var $builtInStatusLabel = document.getElementById('builtInStatusLabel');
  var $builtInStatusDetail = document.getElementById('builtInStatusDetail');
  var $builtInCheckButton = document.getElementById('builtInCheckButton');
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
          if (
            currentSettings &&
            currentSettings.translationProvider === ST.PROVIDERS.BUILT_IN
          ) {
            renderProviderStatus(state.builtInAiStatus || null);
          }
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
      $targetLanguageSelect.value = s.targetLanguage || ST.DEFAULTS.TARGET_LANGUAGE;
      $providerSelect.value = s.translationProvider || ST.DEFAULTS.TRANSLATION_PROVIDER;
      $providerBaseUrlInput.value = s.providerBaseUrl || '';
      $providerModelInput.value = s.providerModel || '';
      $providerApiKeyInput.value = s.providerApiKey || '';
      $autoTranslateToggle.checked = s.autoTranslatePage !== false;
      renderProviderFields();
      renderSiteMode();
      renderProviderStatus(null);
    }
  );

  // ── Load stats ──

  chrome.storage.local.get({ protectionCount: 0 }, function (d) {
    $count.textContent = d.protectionCount;
  });

  $footerVersion.textContent = 'v' + ST.VERSION;

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

  $builtInCheckButton.addEventListener('click', function () {
    checkSelectedProviderStatus();
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

    $providerBaseGroup.hidden = !showBaseUrl;
    $providerModelGroup.hidden = !showModel;
    $providerApiKeyGroup.hidden = !showApiKey;
    $builtInStatusCard.hidden = false;
    $providerModelSelect.hidden = provider !== ST.PROVIDERS.OLLAMA;
    $providerModelInput.hidden = provider === ST.PROVIDERS.OLLAMA;
    $providerStatusTitle.textContent = getProviderStatusTitle(provider);

    if (provider === ST.PROVIDERS.BUILT_IN) {
      $providerHint.textContent = '優先使用本機 Translator API，在支援裝置上可離線運作。';
      $providerBaseUrlInput.placeholder = '';
      $providerModelInput.placeholder = '';
      $providerModelHint.textContent = 'Chrome 內建 AI 會由瀏覽器自動管理模型。';
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
    if (provider === ST.PROVIDERS.BUILT_IN) {
      return 'Chrome 內建 AI 狀態';
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
    value = value.replace(/\/api\/(generate|chat|tags)$/, '');
    return value;
  }

  function renderProviderStatus(status) {
    var provider = currentSettings
      ? currentSettings.translationProvider || ST.DEFAULTS.TRANSLATION_PROVIDER
      : ST.DEFAULTS.TRANSLATION_PROVIDER;
    var next = status || createIdleProviderStatus(provider);

    $builtInStatusLabel.className = 'status-pill ' + next.kind;
    $builtInStatusLabel.textContent = next.label;
    $builtInStatusDetail.textContent = next.detail;
    $builtInCheckButton.disabled = false;
    $builtInCheckButton.textContent = '點擊檢查';
  }

  function createIdleProviderStatus(provider) {
    if (provider === ST.PROVIDERS.BUILT_IN) {
      return {
        kind: 'idle',
        label: '點擊檢查',
        detail: '尚未檢查目前選擇的 Chrome 內建 AI。',
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

    $builtInCheckButton.disabled = true;
    $builtInCheckButton.textContent = '檢查中...';
    $builtInStatusLabel.className = 'status-pill idle';
    $builtInStatusLabel.textContent = '檢查中';
    $builtInStatusDetail.textContent = getCheckingStatusDetail(provider);

    if (provider === ST.PROVIDERS.BUILT_IN) {
      checkBuiltInProviderStatus();
      return;
    }

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

  function checkBuiltInProviderStatus() {
    if (!activeTab) {
      renderProviderStatus({
        kind: 'error',
        label: '無法檢查',
        detail: '目前沒有可檢查的活動分頁。',
      });
      return;
    }

    chrome.tabs.sendMessage(
      activeTab.id,
      { type: ST.MESSAGES.CHECK_BUILT_IN_AI_STATUS },
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
    if (provider === ST.PROVIDERS.BUILT_IN) {
      return '正在檢查目前分頁的 Chrome 內建 AI 可用性。';
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
