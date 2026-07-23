// ==UserScript==
// @name         WaniKani Kanji Components
// @namespace    https://github.com/EmerenSolutions/wanikani-userscripts
// @version      0.1.11
// @description  Shows whole kanji used as visual components inside WaniKani kanji
// @author       Johan Emerén
// @match        https://www.wanikani.com/*
// @match        https://preview.wanikani.com/*
// @grant        none
// @run-at       document-idle
// @downloadURL  https://raw.githubusercontent.com/EmerenSolutions/wanikani-userscripts/main/kanji-components/src/wanikani-kanji-components.user.js
// @updateURL    https://raw.githubusercontent.com/EmerenSolutions/wanikani-userscripts/main/kanji-components/src/wanikani-kanji-components.user.js
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
    const items = await window.wkof.ItemData.get_items({
      wk_items: {
        filters: {
          item_type: 'kan'
        }
      }
    });

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
    /^(?:\/kanji\/|\/subjects\/kanji\/)[^/?#]+/u.test(decodeURIComponent(location.pathname));

  const isReviewPage = () =>
    /^\/subjects\/review(?:\/|$)/u.test(location.pathname);

  const isLessonPickerPage = () =>
    /^\/subject-lessons\/picker(?:\/|$)/u.test(location.pathname);

  const isLessonPage = () =>
    (
      /^\/subject-lessons(?:\/|$)/u.test(location.pathname)
      && !isLessonPickerPage()
    )
    || /^\/subjects\/lesson(?:\/|$)/u.test(location.pathname)
    || /^\/lesson\/session(?:\/|$)/u.test(location.pathname);

  const shouldRunOnCurrentPage = () =>
    settings.enabled
    && (
      (settings.runKanjiPages && isKanjiPage())
      || (settings.runReviews && isReviewPage())
      || (settings.runLessons && isLessonPage())
    );

  const normalizeEntry = entry => {
    if (typeof entry === 'string') {
      return {
        kanji: entry,
        form: null
      };
    }

    return {
      kanji: entry?.kanji,
      form: entry?.form || null
    };
  };

  const uniqueComponents = components => {
    const seen = new Set();
    const result = [];

    for (const component of components) {
      if (!component.kanji || seen.has(component.kanji)) continue;

      seen.add(component.kanji);
      result.push(component);
    }

    return result;
  };

  const getDirectComponents = character =>
    uniqueComponents((COMPONENTS[character] || []).map(normalizeEntry))
      .filter(component => component.kanji !== character);

  const getNestedComponents = (character, seen = new Set()) => {
    const result = [];

    for (const component of getDirectComponents(character)) {
      if (seen.has(component.kanji)) continue;

      seen.add(component.kanji);
      result.push(component);
      result.push(...getNestedComponents(component.kanji, seen));
    }

    return uniqueComponents(result).filter(component => component.kanji !== character);
  };

  const filterToWkKanji = (components, allowed) =>
    components.filter(component => allowed.has(component.kanji));

  const getDisplayDirectComponents = (character, allowed) => {
    const result = [];

    const collectDisplayable = (component, seen = new Set()) => {
      if (!component.kanji || component.kanji === character || seen.has(component.kanji)) return;
      seen.add(component.kanji);

      if (allowed.has(component.kanji)) {
        result.push(component);
        return;
      }

      getDirectComponents(component.kanji)
        .forEach(child => collectDisplayable(child, seen));
    };

    getDirectComponents(character).forEach(component => collectDisplayable(component));
    return uniqueComponents(result);
  };

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
    const pathMatch = decodeURIComponent(location.pathname).match(/(?:\/kanji\/|\/subjects\/kanji\/)([^/?#]+)/u);
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

    const candidates = [];

    for (const selector of selectors) {
      document.querySelectorAll(selector).forEach(element => {
        if (element.closest(`#${SCRIPT_ID}_panel`)) return;

        const rect = element.getBoundingClientRect();
        const text = element?.dataset?.subjectCharacter || element?.textContent?.trim();

        if (isKanji(text) && rect.width > 0 && rect.height > 0) {
          candidates.push({
            text,
            area: rect.width * rect.height,
            top: rect.top
          });
        }
      });
    }

    candidates.sort((a, b) => b.area - a.area || a.top - b.top);
    if (candidates.length) return candidates[0].text;

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
    link.href = `/kanji/${encodeURIComponent(component.kanji)}`;
    link.title = component.form
      ? `Open ${component.kanji} on WaniKani. Visible form: ${component.form}`
      : `Open ${component.kanji} on WaniKani`;

    const kanji = document.createElement('span');
    kanji.className = `${SCRIPT_ID}__kanji`;
    kanji.textContent = component.kanji;
    link.appendChild(kanji);

    if (component.form) {
      const alias = document.createElement('span');
      alias.className = `${SCRIPT_ID}__alias`;
      alias.textContent = `as ${component.form}`;
      link.appendChild(alias);
    }

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
        display: inline-grid;
        font-size: 24px;
        font-weight: 600;
        gap: 2px;
        justify-content: center;
        line-height: 1;
        min-height: 32px;
        min-width: 36px;
        padding: 4px 7px;
        text-decoration: none;
      }

      .${SCRIPT_ID}__kanji {
        display: block;
      }

      .${SCRIPT_ID}__alias {
        color: inherit;
        display: block;
        font-size: 10px;
        font-weight: 700;
        line-height: 1;
        opacity: 0.7;
        white-space: nowrap;
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
    const direct = allowed ? getDisplayDirectComponents(character, allowed) : [];
    const nested = allowed
      ? filterToWkKanji(getNestedComponents(character), allowed)
        .filter(component => !direct.some(directComponent => directComponent.kanji === component.kanji))
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
      title: 'Kanji Components',
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

  const enhanceSettingsDialog = () => {
    const descriptions = Object.values(SETTINGS_META)
      .reduce((result, item) => {
        result[item.label] = item.description;
        return result;
      }, {});

    const applyEnhancement = () => {
      const labels = [...document.querySelectorAll('label')]
        .filter(label => Object.hasOwn(descriptions, label.textContent.trim()));

      labels.forEach(label => {
        if (label.dataset.wanikaniKanjiComponentsEnhanced) return;

        const title = label.textContent.trim();

        label.dataset.wanikaniKanjiComponentsEnhanced = 'true';
        label.innerHTML = [
          `<strong style="display:block;font-weight:700;">${title}</strong>`,
          `<span style="display:block;margin-top:2px;color:#666;font-size:12px;line-height:1.25;">${descriptions[title]}</span>`
        ].join('');

        Object.assign(label.style, {
          display: 'inline-block',
          minWidth: '250px',
          textAlign: 'left',
          verticalAlign: 'middle'
        });

        const row = label.closest('tr, .row, div');
        if (row) {
          Object.assign(row.style, {
            minHeight: '44px'
          });
        }
      });
    };

    [0, 50, 150, 300].forEach(delay => {
      window.setTimeout(applyEnhancement, delay);
    });
  };

  const openSettings = () => {
    window.wkof.settings[SCRIPT_ID] = { ...settings };

    const dialog = new window.wkof.Settings({
      script_id: SCRIPT_ID,
      title: 'Kanji Components',
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
    enhanceSettingsDialog();
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
