// ==UserScript==
// @name         WaniKani Kanji Components
// @namespace    https://github.com/EmerenSolutions/wanikani-userscripts
// @version      0.1.1
// @description  Shows whole kanji used as visual components inside WaniKani kanji
// @author       Johan Emeren
// @match        https://www.wanikani.com/*
// @match        https://preview.wanikani.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(() => {
  'use strict';

  const SCRIPT_ID = 'wanikani_kanji_components';
  const MENU_LINK_NAME = `${SCRIPT_ID}_settings`;
  const DEFAULT_SETTINGS = {
    enabled: true,
    runKanjiPages: true,
    runReviews: true,
    runLessons: true,
    showNested: true
  };
  const SETTINGS_META = {
    enabled: {
      label: 'Enabled',
      description: 'Master switch for the component panel.'
    },
    runKanjiPages: {
      label: 'Kanji Pages',
      description: 'Show components on individual WaniKani kanji pages.'
    },
    runReviews: {
      label: 'Reviews',
      description: 'Show components during WaniKani reviews.'
    },
    runLessons: {
      label: 'Lessons',
      description: 'Show components during WaniKani lessons and lesson quizzes.'
    },
    showNested: {
      label: 'Nested Components',
      description: 'Show kanji found inside direct components.'
    }
  };
  const COMPONENTS = __COMPONENTS_JSON__;

  let settings = { ...DEFAULT_SETTINGS };
  let settingsLoaded = false;
  let wkKanji = null;
  let latestCharacter = null;
  let observerTimer = null;

  const $ = selector => document.querySelector(selector);

  const isKanji = value => /^[\u3400-\u9fff]$/u.test(value);

  const unique = values => [...new Set(values)];

  const removePanel = () => {
    $(`#${SCRIPT_ID}_panel`)?.remove();
    latestCharacter = null;
  };

  const readyWkof = async modules => {
    if (!window.wkof?.include || !window.wkof?.ready) return false;

    window.wkof.include(modules);
    await window.wkof.ready(modules);
    return true;
  };

  const loadWkKanji = async () => {
    if (wkKanji) return wkKanji;

    if (!await readyWkof('ItemData')) {
      return null;
    }

    wkKanji = new Set();
    const items = await window.wkof.ItemData.get_items();

    for (const item of items) {
      const data = item?.data || item;
      const characters = data?.characters;
      const type = item?.object || data?.object || item?.item_type || data?.item_type;

      if (type === 'kanji' && isKanji(characters)) {
        wkKanji.add(characters);
      }
    }

    return wkKanji;
  };

  const isKanjiPage = () =>
    /^\/kanji\/[^/?#]+/u.test(decodeURIComponent(location.pathname));

  const isReviewPage = () =>
    location.pathname.startsWith('/subjects/review');

  const isLessonPage = () =>
    location.pathname.startsWith('/subject-lessons/')
    || location.pathname.startsWith('/subjects/lesson')
    || location.pathname.startsWith('/lesson')
    || document.body?.classList.contains('lessons');

  const shouldRunOnCurrentPage = () =>
    settings.enabled
    && (
      (settings.runKanjiPages && isKanjiPage())
      || (settings.runReviews && isReviewPage())
      || (settings.runLessons && isLessonPage())
    );

  const getDirectComponents = character =>
    unique(COMPONENTS[character] || []).filter(component => component !== character);

  const getNestedComponents = (character, seen = new Set()) => {
    const result = [];

    for (const component of getDirectComponents(character)) {
      if (seen.has(component)) continue;

      seen.add(component);
      result.push(component);
      result.push(...getNestedComponents(component, seen));
    }

    return unique(result).filter(component => component !== character);
  };

  const filterToWkKanji = (components, allowed) =>
    components.filter(component => allowed.has(component));

  const getSubjectFromEvent = event => {
    const detail = event?.detail;
    const subject = detail?.subject || detail;
    const data = subject?.data || subject?.subject || subject;
    const type = subject?.object || data?.object || subject?.item_type || data?.item_type;
    const characters = data?.characters || subject?.characters;

    if (type === 'kanji' && isKanji(characters)) return characters;
    return null;
  };

  const getSubjectFromPage = () => {
    const pathMatch = decodeURIComponent(location.pathname).match(/\/kanji\/([^/?#]+)/u);
    if (pathMatch?.[1] && isKanji(pathMatch[1])) return pathMatch[1];

    const selectors = [
      '.subject-character__characters',
      '.character-header__characters',
      '.quiz-header__characters',
      '.lesson-header__characters',
      '.subject-slide__characters',
      '[data-quiz-target="characters"]',
      '[data-subject-character]',
      '[class*="characters"]'
    ];

    for (const selector of selectors) {
      const element = $(selector);
      const text = element?.dataset?.subjectCharacter || element?.textContent?.trim();
      if (isKanji(text)) return text;
    }

    return null;
  };

  const getAnchor = () =>
    $('.subject-section')
    || $('.subject-readings')
    || $('.subject-character')
    || $('.quiz-input')
    || $('.quiz-header')
    || $('main')
    || document.body;

  const createComponentLink = component => {
    const link = document.createElement('a');
    link.className = `${SCRIPT_ID}__link`;
    link.href = `/kanji/${encodeURIComponent(component)}`;
    link.textContent = component;
    link.title = `Open ${component} on WaniKani`;
    return link;
  };

  const createRow = (label, components) => {
    const row = document.createElement('div');
    row.className = `${SCRIPT_ID}__row`;

    const heading = document.createElement('div');
    heading.className = `${SCRIPT_ID}__label`;
    heading.textContent = label;

    const values = document.createElement('div');
    values.className = `${SCRIPT_ID}__values`;

    if (components.length) {
      components.forEach(component => values.appendChild(createComponentLink(component)));
    } else {
      const empty = document.createElement('span');
      empty.className = `${SCRIPT_ID}__empty`;
      empty.textContent = 'None found';
      values.appendChild(empty);
    }

    row.appendChild(heading);
    row.appendChild(values);
    return row;
  };

  const installStyles = () => {
    if ($(`#${SCRIPT_ID}_styles`)) return;

    const style = document.createElement('style');
    style.id = `${SCRIPT_ID}_styles`;
    style.textContent = `
      .${SCRIPT_ID} {
        background: var(--color-background, #fff);
        border: 1px solid rgba(0, 0, 0, 0.12);
        border-radius: 6px;
        color: var(--color-text, #222);
        font-family: inherit;
        margin: 16px 0;
        padding: 14px 16px;
      }

      .${SCRIPT_ID}__title {
        font-size: 16px;
        font-weight: 700;
        margin: 0 0 10px;
      }

      .${SCRIPT_ID}__row {
        align-items: flex-start;
        display: flex;
        gap: 12px;
        margin-top: 8px;
      }

      .${SCRIPT_ID}__label {
        color: inherit;
        flex: 0 0 72px;
        font-size: 13px;
        font-weight: 700;
        line-height: 32px;
        opacity: 0.72;
      }

      .${SCRIPT_ID}__values {
        display: flex;
        flex: 1;
        flex-wrap: wrap;
        gap: 8px;
        min-width: 0;
      }

      .${SCRIPT_ID}__link {
        align-items: center;
        background: #f2f5f7;
        border: 1px solid rgba(0, 0, 0, 0.08);
        border-radius: 4px;
        color: #2f5f9f;
        display: inline-flex;
        font-size: 24px;
        font-weight: 600;
        height: 32px;
        justify-content: center;
        line-height: 1;
        min-width: 32px;
        padding: 0 6px;
        text-decoration: none;
      }

      .${SCRIPT_ID}__link:hover {
        background: #e6eef7;
        color: #1d4f8f;
        text-decoration: none;
      }

      .${SCRIPT_ID}__empty,
      .${SCRIPT_ID}__note {
        color: inherit;
        font-size: 13px;
        line-height: 32px;
        opacity: 0.62;
      }

      .${SCRIPT_ID}__note {
        line-height: 1.35;
        margin: 10px 0 0;
      }
    `;

    document.head.appendChild(style);
  };

  const render = async character => {
    if (!character || !isKanji(character)) return;
    if (!shouldRunOnCurrentPage()) {
      removePanel();
      return;
    }

    if (character === latestCharacter && $(`#${SCRIPT_ID}_panel`)) return;

    latestCharacter = character;
    installStyles();

    const allowed = await loadWkKanji();
    const direct = allowed ? filterToWkKanji(getDirectComponents(character), allowed) : [];
    const nested = allowed
      ? filterToWkKanji(getNestedComponents(character), allowed)
        .filter(component => !direct.includes(component))
      : [];

    $(`#${SCRIPT_ID}_panel`)?.remove();

    const panel = document.createElement('section');
    panel.id = `${SCRIPT_ID}_panel`;
    panel.className = SCRIPT_ID;

    const title = document.createElement('h2');
    title.className = `${SCRIPT_ID}__title`;
    title.textContent = 'Kanji Components';

    panel.appendChild(title);
    panel.appendChild(createRow('Direct', direct));
    if (settings.showNested) {
      panel.appendChild(createRow('Nested', nested));
    }

    if (!allowed) {
      const note = document.createElement('p');
      note.className = `${SCRIPT_ID}__note`;
      note.textContent = 'WaniKani Open Framework is required to filter components to WaniKani kanji.';
      panel.appendChild(note);
    }

    const anchor = getAnchor();
    anchor.insertAdjacentElement('afterend', panel);
  };

  const renderCurrentPage = () => {
    if (!shouldRunOnCurrentPage()) {
      removePanel();
      return;
    }

    const character = getSubjectFromPage();
    if (character) render(character);
  };

  const loadSettings = async () => {
    if (!await readyWkof('Menu,Settings')) return;

    await window.wkof.Settings.load(SCRIPT_ID, DEFAULT_SETTINGS);
    settings = {
      ...DEFAULT_SETTINGS,
      ...(window.wkof.settings?.[SCRIPT_ID] || {})
    };

    settingsLoaded = true;
    scheduleMenuInstall();
  };

  const installSettingsMenu = () => {
    if (!window.wkof?.Menu?.insert_script_link) return;

    window.wkof.Menu.insert_script_link({
      name: MENU_LINK_NAME,
      submenu: 'Settings',
      title: 'WaniKani Kanji Components',
      on_click: openSettings
    });
  };

  const scheduleMenuInstall = () => {
    installSettingsMenu();

    [100, 500, 1500, 3000].forEach(delay => {
      window.setTimeout(installSettingsMenu, delay);
    });
  };

  const saveSettings = () => {
    settings = {
      ...DEFAULT_SETTINGS,
      ...(window.wkof.settings?.[SCRIPT_ID] || {})
    };

    removePanel();
    renderCurrentPage();

    return window.wkof.Settings.save(SCRIPT_ID);
  };

  const openSettings = () => {
    window.wkof.settings[SCRIPT_ID] = { ...settings };

    const dialog = new window.wkof.Settings({
      script_id: SCRIPT_ID,
      title: 'WaniKani Kanji Components',
      on_save: saveSettings,
      content: {
        enabled: {
          type: 'checkbox',
          label: SETTINGS_META.enabled.label,
          default: DEFAULT_SETTINGS.enabled,
          hover_tip: SETTINGS_META.enabled.description
        },
        runKanjiPages: {
          type: 'checkbox',
          label: SETTINGS_META.runKanjiPages.label,
          default: DEFAULT_SETTINGS.runKanjiPages,
          hover_tip: SETTINGS_META.runKanjiPages.description
        },
        runReviews: {
          type: 'checkbox',
          label: SETTINGS_META.runReviews.label,
          default: DEFAULT_SETTINGS.runReviews,
          hover_tip: SETTINGS_META.runReviews.description
        },
        runLessons: {
          type: 'checkbox',
          label: SETTINGS_META.runLessons.label,
          default: DEFAULT_SETTINGS.runLessons,
          hover_tip: SETTINGS_META.runLessons.description
        },
        showNested: {
          type: 'checkbox',
          label: SETTINGS_META.showNested.label,
          default: DEFAULT_SETTINGS.showNested,
          hover_tip: SETTINGS_META.showNested.description
        }
      }
    });

    dialog.open();
  };

  const startup = async () => {
    await loadSettings();
    document.addEventListener('turbo:load', () => {
      scheduleMenuInstall();
      renderCurrentPage();
    });
    document.addEventListener('turbo:render', () => {
      scheduleMenuInstall();
      renderCurrentPage();
    });
    window.addEventListener('popstate', () => window.setTimeout(renderCurrentPage, 50));
    renderCurrentPage();
    [500, 1500, 3000].forEach(delay => window.setTimeout(renderCurrentPage, delay));
    [500, 1500, 3000].forEach(delay => {
      window.setTimeout(async () => {
        if (!settingsLoaded) {
          await loadSettings();
          renderCurrentPage();
        }
      }, delay);
    });

    const observer = new MutationObserver(() => {
      window.clearTimeout(observerTimer);
      observerTimer = window.setTimeout(renderCurrentPage, 100);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  };

  window.addEventListener('willShowNextQuestion', event => {
    if (!settings.enabled || (!settings.runReviews && !settings.runLessons)) return;

    const character = getSubjectFromEvent(event);
    if (character) render(character);
  });

  startup();
})();
