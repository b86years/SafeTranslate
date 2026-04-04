# SafeTranslate

SafeTranslate 是一個 Chrome Manifest V3 擴充功能，用來降低 Chrome 內建翻譯功能在 React / Next.js 網站上造成的客戶端錯誤，特別是常見的「應用程式錯誤：發生客戶端異常（有關更多信息，請參閱瀏覽器控制台）」問題。

它的核心思路不是單純「禁止翻譯」，而是提供兩層保護：

1. 在頁面載入最早期修補 DOM 方法，避免翻譯引起的節點異動導致 React hydration 或 reconciliation 崩潰。
2. 在需要時可切換到攔截模式，直接阻止頁面使用 Chrome 原生翻譯，改用安全的選取文字翻譯提示。

## 特色

- 支援 Chrome Manifest V3
- 對 React / Next.js 頁面進行翻譯崩潰防護
- 以 `document_start` 在 MAIN world 先行修補 `removeChild` 與 `insertBefore`
- 偵測 Chrome 翻譯常見的 DOM 痕跡，例如 `<font>` 節點與 `translated-ltr` 類別
- 提供兩種模式：
  - 修補模式：允許 Chrome 翻譯繼續運作，但盡量避免頁面崩潰
  - 攔截模式：阻止 Chrome 翻譯，改用安全翻譯提示顯示選取文字的翻譯結果
- 內建 popup 介面，可快速切換保護模式與啟用狀態
- 透過背景服務 worker 管理分頁狀態、右鍵選單與翻譯快取

## 為什麼需要這個擴充功能

Chrome 內建翻譯會直接修改頁面 DOM，常見行為是把原本的文字節點替換成新的元素。對一般靜態頁面影響不大，但 React / Next.js 依賴虛擬 DOM 與 hydration 協調，當原始節點被瀏覽器翻譯機制改寫後，就可能出現：

- `removeChild` / `insertBefore` 失敗
- hydration mismatch
- 客戶端例外導致整頁錯誤畫面

SafeTranslate 的目標是把這個風險降到最低，並讓網站在使用者翻譯頁面時仍維持可用。

## 安裝方式

1. 下載或複製此專案到本機資料夾。
2. 開啟 Chrome，前往 `chrome://extensions/`。
3. 開啟右上角的「開發人員模式」。
4. 點選「載入未封裝項目」。
5. 選擇此專案根目錄。

此專案的最低 Chrome 版本需求為 111。

## 使用方式

安裝後，點擊 Chrome 工具列上的 SafeTranslate 圖示即可開啟 popup。

- 開關可控制全域啟用與停用
- 「修補模式」建議作為預設值
- 「攔截模式」適合不希望頁面被 Chrome 內建翻譯直接改寫的情境

在頁面上選取文字後，也可以透過右鍵選單執行安全翻譯提示。

## 運作原理

### 1. DOM 修補

擴充功能會在頁面最早載入時，以 MAIN world 注入修補邏輯，針對 Chrome 翻譯常造成的節點移除與插入失敗做防護。這能避免 React 在協調 DOM 時直接崩潰。

### 2. 翻譯偵測

透過 MutationObserver 偵測 Chrome 翻譯常見的 DOM 痕跡，例如：

- 新增的 `<font>` 節點
- `html` 上的 `translated-ltr` / `translated-rtl` 類別

### 3. 攔截模式

當使用者切換到攔截模式時，擴充功能會在頁面上加上 `translate="no"` 與 `notranslate`，並注入 `meta name="google" content="notranslate"`，盡量阻止 Chrome 原生翻譯介入。

### 4. 安全翻譯提示

若使用者在攔截模式下選取文字，背景服務 worker 會透過翻譯 API 取得結果，再以 Shadow DOM tooltip 顯示。這樣可以避免直接修改 React 控管的頁面節點。

## 專案結構

- [manifest.json](manifest.json) - MV3 設定檔
- [src/background.js](src/background.js) - 背景服務 worker
- [src/content-script.js](src/content-script.js) - 分頁狀態、tooltip 與 UI 協調
- [src/dom-protector.js](src/dom-protector.js) - MAIN world DOM 修補
- [src/translation-blocker.js](src/translation-blocker.js) - 攔截模式邏輯
- [src/lib/constants.js](src/lib/constants.js) - 共用常數與訊息定義
- [src/popup/](src/popup/) - 擴充功能 popup UI
- [_locales/](./_locales) - 多語系訊息檔
- [icons/](icons/) - 擴充功能圖示

## 已知限制

- 修補模式會降低崩潰風險，但無法保證所有網站都能完美翻譯且完全無副作用。
- 攔截模式會阻止 Chrome 原生翻譯，因此不適合想直接使用整頁翻譯的情境。
- 目前的安全翻譯提示以選取文字為主，不是完整頁面翻譯引擎。

## 開發說明

此專案使用純前端 Chrome Extension 結構，未依賴打包工具。若要擴充功能，建議保持以下原則：

- 常數集中管理，避免訊息字串散落各處
- Content script 與 background worker 只透過明確訊息協作
- 對 React / Next.js 這類依賴 hydration 的站點優先做非破壞式修補
- 新增設定時先更新 popup、storage 與背景狀態同步

## 安全性與隱私

- 擴充功能只在使用者啟用時作用於頁面
- 翻譯查詢僅在使用者選取文字後進行
- 專案不會主動收集頁面內容以外的資料

## 授權

如需正式對外開源，建議再補上 `LICENSE` 檔案與第三方相依性說明。
