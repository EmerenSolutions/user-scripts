// ==UserScript==
// @name         WK Safe Auto Commit
// @namespace    emerensolutions
// @version      0.10.4
// @description  Lightweight safe auto commit for WaniKani reviews and lessons
// @author       Johan Emerén
// @match        https://www.wanikani.com/*
// @match        https://preview.wanikani.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(() => {
  'use strict';

  const SCRIPT_ID = 'wk_safe_auto_commit';
  const MENU_LINK_NAME = `${SCRIPT_ID}_settings`;
  const DEFAULT_SETTINGS = {
    enabled: true,
    runReviews: true,
    runLessons: false,
    autoMeanings: true,
    autoReadings: true,
    showToggleButton: true,
    autoAdvance: true
  };
  const SETTINGS_META = {
    enabled: {
      label: 'Enabled',
      description: 'Master switch for saved behavior.'
    },
    runReviews: {
      label: 'Reviews',
      description: 'Allow auto-commit on review sessions.'
    },
    runLessons: {
      label: 'Lessons',
      description: 'Allow auto-commit on lesson quizzes.'
    },
    autoMeanings: {
      label: 'Meanings',
      description: 'Submit when a meaning answer matches.'
    },
    autoReadings: {
      label: 'Readings',
      description: 'Submit when a reading answer matches.'
    },
    showToggleButton: {
      label: 'Button',
      description: 'Show a session-only pause/resume button.'
    },
    autoAdvance: {
      label: 'Advance',
      description: 'Continue after a correct answer.'
    }
  };

  let settings = { ...DEFAULT_SETTINGS };
  let sessionEnabled = true;
  let locked = false;
  let failed = false;
  let expected = [];
  let synonyms = {};
  let composing = false;
  let checkTimer = null;
  const subjectCache = new Map();

  const DEBUG_FAILURE_TRIGGER = 'wksafeautocommit.debug.failure';

  const $ = selector => document.querySelector(selector);

  const getInput = () => $('#user-response');
  const getButton = () => $('.quiz-input__submit-button');
  const getFooter = () => $('.quiz-footer');
  const getToggleButton = () => $('#WK_SAFE_AUTOCOMMIT_TOGGLE');

  const isReviewPage = () =>
    location.pathname.startsWith('/subjects/review');

  const isLessonPage = () =>
    location.pathname.startsWith('/subject-lessons/');

  const isAllowedPage = () =>
    (isReviewPage() && settings.runReviews) || (isLessonPage() && settings.runLessons);

  const isAllowedQuestionType = questionType =>
    (questionType === 'meaning' && settings.autoMeanings)
      || (questionType === 'reading' && settings.autoReadings);

  const shouldRun = () =>
    settings.enabled && sessionEnabled && isAllowedPage();

  const updateToggleButton = () => {
    const button = getToggleButton();
    if (!button) return;

    if (!settings.showToggleButton) {
      button.remove();
      return;
    }

    if (!settings.enabled) {
      button.textContent = 'Auto Commit: OFF';
      button.style.opacity = '0.5';
      return;
    }

    button.textContent = sessionEnabled ? 'Auto Commit: ON' : 'Auto Commit: PAUSED';
    button.style.opacity = sessionEnabled ? '1' : '0.5';
  };

  const normalize = value =>
    String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, '').toLowerCase();

  const getQuestionTypeFromDom = () => {
    const text = [
      $('.quiz-header')?.textContent,
      $('.quiz-question')?.textContent,
      $('[class*="question"]')?.textContent
    ].filter(Boolean).join(' ').toLowerCase();

    if (text.includes('meaning')) return 'meaning';
    if (text.includes('reading')) return 'reading';
    return null;
  };

  const getQuestionType = item =>
    item?.questionType
      || item?.question_type
      || item?.question?.type
      || getQuestionTypeFromDom();

  const getSubjectData = subject =>
    subject?.data || subject?.subject || subject;

  const getSubjectId = item => {
    const subject = item?.subject;

    if (typeof subject === 'number' || typeof subject === 'string') {
      return subject;
    }

    return subject?.id
      ?? subject?.data?.id
      ?? subject?.subject_id
      ?? item?.subjectId
      ?? item?.subject_id
      ?? item?.id;
  };

  const getSubjectCharactersFromDom = () => {
    const candidates = [
      '.character-header__characters',
      '.quiz-header__characters',
      '[data-quiz-target="characters"]',
      '[class*="characters"]'
    ];

    for (const selector of candidates) {
      const text = $(selector)?.textContent?.trim();
      if (text) return text;
    }

    return null;
  };

  const isAcceptedAnswer = answer =>
    answer?.accepted_answer === true || answer?.acceptedAnswer === true;

  const collectExpectedAnswers = (subjectData, subjectId, questionType) => {
    const answers = [];

    if (!isAllowedQuestionType(questionType)) return answers;

    if (questionType === 'meaning') {
      if (Array.isArray(subjectData?.meanings)) {
        answers.push(
          ...subjectData.meanings
            .filter(m => m?.meaning && isAcceptedAnswer(m))
            .map(m => normalize(m.meaning))
        );
      }

      const userSynonyms = getSynonyms(subjectId);

      if (Array.isArray(userSynonyms)) {
        answers.push(...userSynonyms.map(normalize));
      }

      if (Array.isArray(subjectData?.auxiliary_meanings)) {
        answers.push(
          ...subjectData.auxiliary_meanings
            .filter(m => m?.meaning && m.type === 'whitelist')
            .map(m => normalize(m.meaning))
        );
      }
    }

    if (questionType === 'reading') {
      if (Array.isArray(subjectData?.readings)) {
        answers.push(
          ...subjectData.readings
            .filter(r => r?.reading && isAcceptedAnswer(r))
            .map(r => normalize(r.reading))
        );
      }
    }

    return [...new Set(answers)];
  };

  const readyWkof = async modules => {
    if (!window.wkof?.include || !window.wkof?.ready) return false;

    window.wkof.include(modules);
    await window.wkof.ready(modules);
    return true;
  };

  const loadSubjectFromWkofApi = async subjectId => {
    if (!subjectId) return null;

    const cacheKey = String(subjectId);
    if (subjectCache.has(cacheKey)) return subjectCache.get(cacheKey);

    if (!await readyWkof('Apiv2')) {
      return null;
    }

    const collection = await window.wkof.Apiv2.fetch_endpoint('subjects', {
      filters: { ids: subjectId },
      disable_progress_dialog: true
    });

    const resource = collection?.data?.find(item => String(item.id) === cacheKey) || null;
    subjectCache.set(cacheKey, resource);
    return resource;
  };

  const loadSubjectFromWkof = async (subjectId, characters) => {
    if (!await readyWkof('ItemData')) return null;

    const items = await window.wkof.ItemData.get_items();

    return items.find(item => String(item.id) === String(subjectId))
      || items.find(item => item?.data?.characters === characters)
      || null;
  };

  const fail = (reason, detail) => {
    if (failed) return;

    failed = true;
    sessionEnabled = false;

    console.error('[WK Safe Auto Commit]', reason, detail ?? '');

    if ($('#WK_SAFE_AUTOCOMMIT_FAILURE')) return;

    const banner = document.createElement('div');
    banner.id = 'WK_SAFE_AUTOCOMMIT_FAILURE';

    Object.assign(banner.style, {
      position: 'fixed',
      top: '20px',
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: '999999',
      background: '#c62828',
      color: '#fff',
      padding: '12px 18px',
      borderRadius: '8px',
      fontSize: '14px',
      fontWeight: 'bold',
      boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      maxWidth: '90vw'
    });

    const text = document.createElement('span');
    text.textContent = 'WK Safe Auto Commit requires updating';

    const sub = document.createElement('span');
    sub.textContent = reason;
    Object.assign(sub.style, {
      fontSize: '11px',
      fontWeight: 'normal',
      marginTop: '4px',
      opacity: '0.9'
    });

    const close = document.createElement('button');
    close.textContent = '✕';

    Object.assign(close.style, {
      marginLeft: '12px',
      background: 'transparent',
      border: '0',
      color: '#fff',
      cursor: 'pointer',
      fontSize: '16px',
      fontWeight: 'bold',
      padding: '0'
    });

    close.addEventListener('click', () => {
      banner.remove();
    });

    banner.appendChild(text);
    banner.appendChild(sub);
    banner.appendChild(close);

    document.body.appendChild(banner);
  };

  const loadSynonyms = () => {
    const el = $('script[data-quiz-user-synonyms-target]');
    if (!el) return;

    try {
      synonyms = JSON.parse(el.textContent || '{}') || {};
    } catch (err) {
      fail('synonym-json-parse', err);
    }
  };

  const getSynonyms = subjectId =>
    synonyms[subjectId] || synonyms[String(subjectId)] || [];

  const submit = () => {
    if (locked || failed || !shouldRun()) return;

    const input = getInput();
    const button = getButton();

    if (!input || !button) {
      fail('missing-dom', { input: !!input, button: !!button });
      return;
    }

    if (!input.value.trim()) return;

    locked = true;

    button.click();

    if (settings.autoAdvance) {
      setTimeout(() => {
        button.click();
      }, 80);
    }

    setTimeout(() => {
      locked = false;
    }, 500);
  };

  const checkAnswer = () => {
    if (!shouldRun() || locked || failed || composing) return;

    const input = getInput();
    if (!input) return;

    const value = normalize(input.value);
    if (!value) return;

    if (value === DEBUG_FAILURE_TRIGGER) {
      fail('debug-trigger');
      return;
    }

    if (expected.length && expected.includes(value)) {
      submit();
    }
  };

  const scheduleCheckAnswer = () => {
    window.clearTimeout(checkTimer);

    window.requestAnimationFrame(checkAnswer);
    checkTimer = window.setTimeout(checkAnswer, 60);
    window.setTimeout(checkAnswer, 160);
  };

  const buildExpectedAnswers = async item => {
    expected = [];
    if (!isAllowedPage()) return;

    const subject = item?.subject;
    const subjectData = getSubjectData(subject);
    const subjectId = getSubjectId(item);
    const questionType = getQuestionType(item);
    const characters = subjectData?.characters || getSubjectCharactersFromDom();

    if (!isAllowedQuestionType(questionType)) return;

    expected = collectExpectedAnswers(subjectData, subjectId, questionType);

    if (!expected.length && (subjectId || characters)) {
      const wkofSubject = await loadSubjectFromWkof(subjectId, characters);
      expected = collectExpectedAnswers(wkofSubject?.data || wkofSubject, subjectId, questionType);
    }

    if (!expected.length && subjectId) {
      const apiSubject = await loadSubjectFromWkofApi(subjectId);
      expected = collectExpectedAnswers(apiSubject?.data || apiSubject, subjectId, questionType);
    }

    expected = [...new Set(expected)];

    if (!expected.length) {
      console.warn('[WK Safe Auto Commit] empty-expected', {
        questionType,
        subjectId,
        characters,
        item
      });
      return;
    }
  };

  const addToggleButton = () => {
    if (!settings.showToggleButton) {
      getToggleButton()?.remove();
      return;
    }

    if ($('#WK_SAFE_AUTOCOMMIT_TOGGLE')) return;

    const footer = getFooter();
    if (!footer) return;

    const button = document.createElement('button');

    button.id = 'WK_SAFE_AUTOCOMMIT_TOGGLE';
    button.type = 'button';
    button.title = 'Temporary. Save defaults in Settings.';
    button.textContent = 'Auto Commit: ON';

    Object.assign(button.style, {
      background: '#c55',
      color: '#fff',
      border: '0',
      borderRadius: '4px',
      cursor: 'pointer',
      padding: '8px 10px',
      marginLeft: '10px',
      fontSize: '13px'
    });

    button.addEventListener('click', () => {
      if (failed || !settings.enabled) return;

      sessionEnabled = !sessionEnabled;

      updateToggleButton();
    });

    footer.appendChild(button);
    updateToggleButton();
  };

  const bindInput = () => {
    const input = getInput();
    if (!input) return;

    if (input.dataset.wkSafeAutoCommitBound) return;

    input.dataset.wkSafeAutoCommitBound = 'true';

    input.addEventListener('compositionstart', () => {
      composing = true;
    });

    input.addEventListener('compositionend', () => {
      composing = false;
      scheduleCheckAnswer();
    });

    input.addEventListener('input', scheduleCheckAnswer);

    input.addEventListener('keyup', scheduleCheckAnswer);

    input.addEventListener('paste', () => {
      scheduleCheckAnswer();
    });
  };

  const loadSettings = async () => {
    if (!await readyWkof('Menu,Settings')) return;

    await window.wkof.Settings.load(SCRIPT_ID, DEFAULT_SETTINGS);
    settings = {
      ...DEFAULT_SETTINGS,
      ...(window.wkof.settings?.[SCRIPT_ID] || {})
    };

    scheduleMenuInstall();
  };

  const installSettingsMenu = () => {
    if (!window.wkof?.Menu?.insert_script_link) return;

    window.wkof.Menu.insert_script_link({
      name: MENU_LINK_NAME,
      submenu: 'Settings',
      title: 'WK Safe Auto Commit',
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

    expected = [];
    updateToggleButton();
    if (settings.showToggleButton) addToggleButton();

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
        if (label.dataset.wkSafeAutoCommitEnhanced) return;

        const title = label.textContent.trim();

        label.dataset.wkSafeAutoCommitEnhanced = 'true';
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
      title: 'WK Safe Auto Commit',
      on_save: saveSettings,
      content: {
        enabled: {
          type: 'checkbox',
          label: SETTINGS_META.enabled.label,
          default: DEFAULT_SETTINGS.enabled,
          hover_tip: SETTINGS_META.enabled.description
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
        autoMeanings: {
          type: 'checkbox',
          label: SETTINGS_META.autoMeanings.label,
          default: DEFAULT_SETTINGS.autoMeanings,
          hover_tip: SETTINGS_META.autoMeanings.description
        },
        autoReadings: {
          type: 'checkbox',
          label: SETTINGS_META.autoReadings.label,
          default: DEFAULT_SETTINGS.autoReadings,
          hover_tip: SETTINGS_META.autoReadings.description
        },
        showToggleButton: {
          type: 'checkbox',
          label: SETTINGS_META.showToggleButton.label,
          default: DEFAULT_SETTINGS.showToggleButton,
          hover_tip: SETTINGS_META.showToggleButton.description
        },
        autoAdvance: {
          type: 'checkbox',
          label: SETTINGS_META.autoAdvance.label,
          default: DEFAULT_SETTINGS.autoAdvance,
          hover_tip: SETTINGS_META.autoAdvance.description
        }
      }
    });

    dialog.open();
    enhanceSettingsDialog();
  };

  const startup = async () => {
    try {
      await loadSettings();
      document.addEventListener('turbo:load', scheduleMenuInstall);
      document.addEventListener('turbo:render', scheduleMenuInstall);
      window.addEventListener('popstate', scheduleMenuInstall);
      loadSynonyms();
      if (isAllowedPage()) {
        bindInput();
        addToggleButton();
      }
    } catch (err) {
      fail('startup', err);
    }
  };

  window.addEventListener('willShowNextQuestion', async event => {
    try {
      loadSynonyms();
      await buildExpectedAnswers(event.detail);
      bindInput();
      addToggleButton();
    } catch (err) {
      fail('willShowNextQuestion', err);
    }
  });

  window.addEventListener('didUpdateUserSynonyms', event => {
    const detail = event.detail;

    if (!detail?.subjectId) return;

    synonyms[detail.subjectId] = detail.synonyms || [];
  });

  startup();
})();
