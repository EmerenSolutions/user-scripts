# Webtoon Gap Trimmer (MangaKakalot)

Current version: `0.1.1`.

Build: `3`. Firefox beta; installable source: `src/webtoon-gap-trimmer.user.js`.

## Installation

Install [Webtoon Gap Trimmer](https://raw.githubusercontent.com/EmerenSolutions/user-scripts/main/webtoon-gap-trimmer/src/webtoon-gap-trimmer.user.js)
with [Violentmonkey](https://violentmonkey.github.io/), then reload the chapter.

### Local development installation

Use Firefox's existing [Violentmonkey](https://violentmonkey.github.io/) extension.

1. From the repository root, run `python3 -m http.server 8765 --bind 127.0.0.1`.
2. Open `http://127.0.0.1:8765/webtoon-gap-trimmer/src/webtoon-gap-trimmer.user.js` in a new Firefox tab.
3. Verify the script name and local source, click **Install**, and wait for **Script installed**.
4. Close the installer/source tabs, stop the server with Ctrl+C, and reload the chapter.

Do not enable blanket local-file access or Track external edits. Reopen the same
localhost URL for later updates. If the earlier standalone copy was installed,
disable it before installing this repository copy: the namespace now follows
the repository convention, so Violentmonkey treats it as a separate script.

## Behavior

A button at the bottom right switches between shortened gaps and the original images. Images are processed as you approach them while scrolling.

The script is limited to MangaKakalot chapter pages. It checks full-resolution image rows locally, then displays clipped copies of the original images without resizing the text or changing source files. It does not upload images or use AI services.

If the browser prevents reading an image from its CDN, the script can request that same image through Violentmonkey. The `@connect *` permission accommodates unknown CDN domains; requests are only made to existing chapter image URLs, without cookies. The request includes the comic site origin as its Referer so the image server accepts it; chapter paths are not sent in that header. Blocked images remain unchanged and are counted as unreadable. This may require an extra image download. Do not approve unrelated website prompts.

Detection only shortens long, fully opaque, near-white bands spanning the entire image width. It intentionally misses colored gaps, gaps containing marks, and short gaps split across separate files. Very pale artwork may be treated as white; use the original toggle to compare. It does not remove ordinary CSS margins or fixed-height containers on the website.

## Validation

Run `npm run check` from the repository root, or
`node --test webtoon-gap-trimmer/tests/*.test.js` for the detector checks.

The detector was checked against a supplied screenshot (129 blank rows removed)
and synthetic edge cases. The screenshot is not included in the repository.
Firefox with Violentmonkey was verified on MangaKakalot on 2026-09-08:
version 0.1.1 shortened 4 of 4 checked images without unreadable errors.
The earlier version received HTTP 403 because CDN requests lacked a Referer.
The status now includes the actual error message if an image cannot be read.

## License

Copyright © 2026 Johan Emerén. Licensed under the repository's MIT License.
