# SafeTranslate

Chinese version: [README.md](README.md)

SafeTranslate is a Chrome Manifest V3 extension that reduces the damage caused by Chrome's built-in translation on React and Next.js applications. It helps avoid common client-side exceptions, hydration mismatches, and DOM mutation errors.

The project is focused on one goal: provide a stable, observable, and overrideable translation protection layer without rewriting site code or forcing application-level changes.

## Use Cases

- React / Next.js sites that frequently crash after Chrome translation
- Teams that want full-page translation support with less DOM mutation risk
- Sites that need per-domain protection policies
- Users who want diagnostics instead of a black-box extension

## Highlights

- Chrome Manifest V3 support
- Early DOM protection for React / Next.js pages
- `document_start` injection in the MAIN world
- Patches `removeChild`, `insertBefore`, and `replaceChild`
- Detects common translation markers such as `<font>` nodes and the `translated-ltr` class
- Two protection modes: `patchOnly` and `blockAndTooltip`
- Per-site override policies
- Built-in diagnostics for detection reasons, fallback counts, and last handled errors
- Background service worker for tab state, context menus, and translation caching

## Problem Statement

Chrome translation mutates the page DOM directly. That is usually harmless for static pages, but React and Next.js rely on virtual DOM coordination and hydration. Once the browser rewrites text nodes or swaps elements during translation, the app can hit:

- `removeChild` / `insertBefore` failures
- hydration mismatches
- client-side exceptions that break the page

SafeTranslate does not modify application code. Instead, it adds a protection and diagnostics layer as early as possible so the page can remain usable when translation happens.

## Installation

1. Download or clone the repository locally.
2. Open Chrome and navigate to `chrome://extensions/`.
3. Enable Developer mode.
4. Click Load unpacked.
5. Select the repository root.

Minimum supported Chrome version: 111.

## Usage

After installation, click the SafeTranslate toolbar icon to open the popup.

- Use the toggle to enable or disable protection globally
- `patchOnly` is the recommended default
- `blockAndTooltip` blocks Chrome translation and uses a safe tooltip-based translation flow
- You can set a policy per site, and site-level overrides take priority over the global mode

You can also translate selected text from the context menu.

## Architecture

- DOM Protector
  Patches high-risk DOM APIs in the MAIN world at `document_start`.

- Translation Detection
  Uses DOM markers and fallback telemetry to detect translation activity.

- Site Policy Resolution
  Resolves global settings, site overrides, and the effective runtime mode through a single shared helper.

- Diagnostics
  Writes protection state to root attributes and exposes it in the popup.

- Safe Tooltip Translation
  Displays translated selected text without mutating the DOM controlled by React.

## Project Structure

- [manifest.json](manifest.json) - MV3 manifest
- [src/background.js](src/background.js) - service worker
- [src/content-script.js](src/content-script.js) - tab state, tooltip, and UI coordination
- [src/dom-protector.js](src/dom-protector.js) - MAIN world DOM protection
- [src/translation-blocker.js](src/translation-blocker.js) - blocking mode logic
- [src/lib/constants.js](src/lib/constants.js) - shared constants and message definitions
- [src/lib/site-config.js](src/lib/site-config.js) - shared site policy resolution helper
- [src/popup/](src/popup/) - popup UI
- [_locales/](./_locales) - localization files
- [icons/](icons/) - extension icons
- [test/](test/) - manual regression test pages

## Testing

- Open [test/index.html](test/index.html) for the manual test hub
- Enable file URL access in Chrome if you want to test `file://` pages
- Verify `removeChild`, `insertBefore`, `replaceChild`, and the popup diagnostics panel after simulating translation

## Known Limitations

- `patchOnly` reduces crash risk but cannot guarantee zero side effects on every site
- `blockAndTooltip` disables Chrome translation, so it is not suitable for users who want full-page translation from Chrome itself
- The safe translation tooltip focuses on selected text, not full-page translation

## Privacy

- The extension does not actively collect page data
- Translation requests are only triggered after the user selects text
- No telemetry or remote event collection is included

## Development Principles

- SSOT: keep settings resolution and constants centralized
- DRY: avoid duplicate logic across background, popup, and content scripts
- Stability first: address translation-induced DOM conflicts before adding more features
- Keep changes minimal and non-invasive to the page

## License

This project is licensed under the [MIT License](LICENSE).