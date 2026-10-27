# Vocabify

[![CI](https://github.com/EllianCarlos/vocabify/actions/workflows/ci.yml/badge.svg)](https://github.com/EllianCarlos/vocabify/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/EllianCarlos/vocabify?display_name=tag&sort=semver)](https://github.com/EllianCarlos/vocabify/releases/latest)

![Example Usage](docs/Example.gif)

Vocabify is a browser extension that helps you practise Japanese vocabulary while you read the web. It replaces English words on web pages with the kanji and vocabulary that you are learning on [WaniKani](https://www.wanikani.com/). Move the pointer over a replaced word to see the English word.

It was inspired by WaniKanify / WaniKanify 2.0. This fork is based on [rowan-walshe/vocabify](https://github.com/rowan-walshe/vocabify).

## Install

### Chrome, Edge, Brave and other Chromium browsers

1. Download **[vocabify-chrome.zip](https://github.com/EllianCarlos/vocabify/releases/latest/download/vocabify-chrome.zip)** from the latest release.
2. Unzip it into a folder that you will keep (the browser loads the extension from this folder).
3. Open `chrome://extensions` (or `edge://extensions`).
4. Turn on **Developer mode**.
5. Click **Load unpacked** and select the unzipped folder.

To update, download the new zip, replace the folder contents, and click the reload icon on the extension card.

### Firefox

1. Download **[vocabify-firefox.zip](https://github.com/EllianCarlos/vocabify/releases/latest/download/vocabify-firefox.zip)** from the latest release.
2. Open `about:debugging#/runtime/this-firefox`.
3. Click **Load Temporary Add-on…** and select the zip file.

> [!NOTE]
> Firefox removes temporary add-ons when it closes. A permanent install needs a version signed by Mozilla.

### Set up

1. Create a WaniKani personal access token at [wanikani.com/settings/personal_access_tokens](https://www.wanikani.com/settings/personal_access_tokens). The default read-only permissions are sufficient.
2. Click the Vocabify icon in the toolbar and paste the token.
3. Reload a page. Words that you learn on WaniKani are now replaced.

In the popup you can select which subject types and SRS stages to show, and turn Vocabify on or off for each site.

## What Vocabify does not change

Vocabify does not change text in input fields, text areas, rich-text editors (`contenteditable`), code blocks, scripts and styles. It processes new text on dynamic pages when the browser is idle.

## Privacy

Vocabify sends your token only to the WaniKani API. All data stays in your browser. See the [privacy policy](Privacy-Policy.md).

## Build from source

You need Node.js 22.12 or later and pnpm 9 (`corepack enable` installs the correct version).

```bash
pnpm install
pnpm build           # Chrome, output in dist/
pnpm build:firefox   # Firefox, output in dist/
pnpm test            # unit tests
```

For the full developer guide, see [CONTRIBUTING](CONTRIBUTING.md).

### Make a release

1. Update the version: `pnpm update-version 0.0.3`
2. Commit and push the change.
3. Push a tag with the same version: `git tag v0.0.3 && git push origin v0.0.3`

The [Release workflow](.github/workflows/release.yml) builds the Chrome and Firefox zips and publishes them on the [releases page](https://github.com/EllianCarlos/vocabify/releases). The install links above always point to the latest release.

## Future plans

- [ ] Add UI elements that show the update progress after you set the API key
- [ ] Add a force-refresh button to the popup (for now, set the API key again and reload the page)
- [ ] Add more details to the tooltips, and an option to disable them
- [ ] Add options for the update interval (now subject and user data update every 24 hours, and assignment data every hour)
- [ ] Create a stats page
- [ ] Add support for custom vocabulary lists

## Special thanks to

[Rowan Walshe](https://github.com/rowan-walshe), who wrote the original Vocabify, and [Jonghakseo](https://jonghakseo.github.io/) for the [chrome-extension-boilerplate-react-vite](https://github.com/Jonghakseo/chrome-extension-boilerplate-react-vite) template.
