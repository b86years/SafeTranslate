/**
 * SafeTranslate — Popup Controller
 * Loads settings & per-tab state, binds UI controls,
 * and persists user preference changes via the background worker.
 */
(function () {
  'use strict';

  var ST = globalThis.__SAFE_TRANSLATE__;
  if (!ST) return;

  // ── DOM refs ──

  var $toggle = document.getElementById('globalToggle');
  var $indicator = document.getElementById('statusIndicator');
  var $label = document.getElementById('statusLabel');
  var $detail = document.getElementById('statusDetail');
  var $count = document.getElementById('protectionCount');
  var $radios = document.querySelectorAll('input[name="mode"]');

  // ── Load current-tab status ──

  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    if (!tabs[0]) return;
    chrome.runtime.sendMessage(
      { type: ST.MESSAGES.GET_TAB_STATUS, tabId: tabs[0].id },
      function (state) {
        if (state) renderStatus(state);
      }
    );
  });

  // ── Load settings ──

  chrome.runtime.sendMessage(
    { type: ST.MESSAGES.GET_SETTINGS },
    function (s) {
      if (!s) return;
      $toggle.checked = s.globalEnabled;
      selectMode(s.protectionMode);
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

  // ── Helpers ──

  function persist(partial) {
    chrome.runtime.sendMessage({
      type: ST.MESSAGES.UPDATE_SETTINGS,
      payload: partial,
    });
  }

  function selectMode(value) {
    for (var i = 0; i < $radios.length; i++) {
      $radios[i].checked = $radios[i].value === value;
    }
  }

  function renderStatus(state) {
    if (state.translationDetected && state.isReactSite) {
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
})();
