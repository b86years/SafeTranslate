# SafeTranslate

English version: [README.en.md](README.en.md)

SafeTranslate 是一個 Chrome Manifest V3 擴充功能，專門降低 Chrome 內建翻譯對 React / Next.js 頁面的破壞性影響，避免常見的 client-side exception、hydration mismatch 與 DOM 操作錯誤，並提供可切換的翻譯引擎設定。

專案核心目標很明確：在不重寫網站、不侵入應用程式程式碼的前提下，提供一層穩定、可觀測、可覆寫的翻譯保護機制。

## 適用場景

- React / Next.js 網站在 Chrome 內建翻譯後容易崩潰
- 需要保留整頁翻譯能力，但希望降低 DOM mutation 導致的風險
- 想對特定網站單獨套用不同保護策略
- 需要可診斷的保護狀態，而不是單純「裝了擴充功能」

## 特色

- 支援 Chrome Manifest V3
- 對 React / Next.js 頁面進行翻譯崩潰防護
- 以 `document_start` 在 MAIN world 先行修補 `removeChild`、`insertBefore` 與 `replaceChild`
- 偵測 Chrome 翻譯常見的 DOM 痕跡，例如 `<font>` 節點與 `translated-ltr` 類別
- 提供兩種保護模式：`patchOnly` 與 `blockAndTooltip`
- 支援每網站覆寫策略，可針對特定網站強制套用模式
- 支援 Google 翻譯、OpenRouter、OpenAI 相容 API 與 Ollama 四種翻譯來源
- 支援目標語言選擇、自動翻譯頁面可見內容，以及網站層級的「總是翻譯」與「絕不翻譯」
- 內建診斷資訊，可查看偵測原因、fallback 次數與最後處理錯誤
- 透過背景服務 worker 管理分頁狀態、右鍵選單與翻譯快取

## 問題背景

Chrome 內建翻譯會直接修改頁面 DOM，常見行為是把原本的文字節點替換成新的元素。對一般靜態頁面影響不大，但 React / Next.js 依賴虛擬 DOM 與 hydration 協調，當原始節點被瀏覽器翻譯機制改寫後，就可能出現：

- `removeChild` / `insertBefore` 失敗
- hydration mismatch
- 客戶端例外導致整頁錯誤畫面

SafeTranslate 的做法不是修改網站程式碼，而是在頁面最早期建立一層保護與診斷能力，降低這類錯誤的發生機率與衝擊範圍。

## 安裝

1. 下載或複製此專案到本機資料夾。
2. 開啟 Chrome，前往 `chrome://extensions/`。
3. 開啟右上角的「開發人員模式」。
4. 點選「載入未封裝項目」。
5. 選擇此專案根目錄。

此專案的最低 Chrome 版本需求為 111。

## 使用

安裝後，點擊 Chrome 工具列上的 SafeTranslate 圖示即可開啟 popup。

- 開關可控制全域啟用與停用
- 可選擇目標語言與翻譯引擎
- 可設定 OpenRouter 或 OpenAI 相容 API 的 base URL、model 與 API key，或設定 Ollama 的 base URL 與 model，也可直接使用 Google 翻譯
- 可控制是否自動翻譯目前頁面的可見文字內容
- 「修補模式」建議作為預設值
- 「攔截模式」適合不希望頁面被 Chrome 內建翻譯直接改寫的情境
- 可對目前網站單獨指定策略與「總是翻譯／絕不翻譯」，優先於全域模式與全域自動翻譯設定

在頁面上選取文字後，也可以透過右鍵選單執行安全翻譯提示。

## 架構概覽

- DOM Protector
  在 `document_start` 與 MAIN world 修補高風險 DOM API，降低翻譯造成的節點錯位錯誤。

- Translation Detection
  使用 DOM 痕跡與 fallback 記錄判斷翻譯是否已介入頁面。

- Site Policy Resolution
  透過統一的 site-config 決定全域模式、網站覆寫與實際生效策略。

- Diagnostics
  將保護狀態寫入根節點 attributes，並同步到 popup 顯示。

- Safe Tooltip Translation
  在攔截模式下，用不改動 React 控管 DOM 的方式顯示翻譯結果。

- Translation Providers
  同一套設定模型可切換 Google 翻譯、OpenRouter、OpenAI 相容 API 與 Ollama，並統一由背景服務處理翻譯請求。

## 專案結構

- [manifest.json](manifest.json) - MV3 設定檔
- [src/background.js](src/background.js) - 背景服務 worker
- [src/content-script.js](src/content-script.js) - 分頁狀態、tooltip 與 UI 協調
- [src/dom-protector.js](src/dom-protector.js) - MAIN world DOM 修補
- [src/translation-blocker.js](src/translation-blocker.js) - 攔截模式邏輯
- [src/lib/constants.js](src/lib/constants.js) - 共用常數與訊息定義
- [src/lib/site-config.js](src/lib/site-config.js) - 網站設定解析與覆寫策略計算
- [src/popup/](src/popup/) - 擴充功能 popup UI
- [_locales/](./_locales) - 多語系訊息檔
- [icons/](icons/) - 擴充功能圖示
- [test/](test/) - 手動回歸測試頁

## 測試

- 手動測試入口位於 [test/index.html](test/index.html)
- 若要驗證 `file://` 測試頁注入，需在 Chrome 擴充功能頁開啟「允許存取檔案網址」
- 建議至少驗證模擬翻譯後的 `removeChild`、`insertBefore`、`replaceChild` 行為與 popup 診斷面板

## 已知限制

- 修補模式會降低崩潰風險，但無法保證所有網站都能完全無副作用
- 攔截模式會阻止 Chrome 原生翻譯，不適合想直接使用瀏覽器原生整頁翻譯的情境
- 自動翻譯會改寫頁面文字節點；雖然已盡量避開高風險區塊，但對高度動態的前端應用仍可能有相容性風險

## 隱私

- 擴充功能不主動收集頁面資料
- 使用 Google 翻譯、OpenRouter、OpenAI 相容 API 或 Ollama 時，翻譯文字會送往對應的服務端點
- API key 只儲存在目前裝置，不會透過同步設定跨裝置同步
- 專案不包含遙測上報或遠端事件收集

## 開發原則

- SSOT：設定解析與常數定義集中管理
- DRY：避免背景、popup、content script 各自推導相同邏輯
- 穩定性優先：先處理 translation-induced DOM conflicts，再談功能擴充
- 變更應保持最小侵入，避免改變頁面既有行為

## 授權

本專案採用 [MIT License](LICENSE)。
