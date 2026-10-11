// ==UserScript==
// @name         Wanikani Safe Auto Commit
// @namespace    https://github.com/EmerenSolutions/wanikani-userscripts
// @version      1.0.0
// @description  Submits exact accepted answers in WaniKani reviews and lesson quizzes
// @author       Johan Emerén
// @copyright    2026, Johan Emerén
// @license      MIT
// @match        https://www.wanikani.com/*
// @match        https://preview.wanikani.com/*
// @grant        none
// @run-at       document-idle
// @downloadURL  https://raw.githubusercontent.com/EmerenSolutions/user-scripts/main/safe-auto-commit/src/wanikani-safe-auto-commit.user.js
// @updateURL    https://raw.githubusercontent.com/EmerenSolutions/user-scripts/main/safe-auto-commit/src/wanikani-safe-auto-commit.user.js
// ==/UserScript==

(() => {
  'use strict';

  const SCRIPT_ID = 'wanikani_safe_auto_commit';
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
  let locked = null;
  let activeQuestion = null;
  let failed = false;
  let expected = [];
  let synonyms = {};
  let composing = false;
  let checkTimer = null;
  const subjectCache = new Map();

  const DEBUG_FAILURE_TRIGGER = 'wanikanisafeautocommit.debug.failure';

  const $ = selector => document.querySelector(selector);

  const getInput = () => $('#user-response');
  const getButton = () => $('.quiz-input__submit-button');
  const getFooter = () => $('.quiz-footer');
  const getInputContainer = () => $('[data-quiz-input-target="inputContainer"]')
    || $('.quiz-input__input-container');
  const getQuizInputController = () => {
    const element = $('[data-controller~="quiz-input"]');
    try {
      return element && window.Stimulus?.getControllerForElementAndIdentifier(element, 'quiz-input');
    } catch {
      return null;
    }
  };

  const invalidateQuestion = () => {
    activeQuestion = null;
    expected = [];
    locked = null;
  };

  const matchesNativeQuestion = (controller, question) =>
    !!controller && !!question && question.subjectId != null
    && String(getSubjectId({ subject: controller.currentSubject })) === String(question.subjectId)
    && controller.currentQuestionType === question.questionType;
  const getToggleButton = () => $('#WANIKANI_SAFE_AUTOCOMMIT_TOGGLE');

  const isReviewPage = () =>
    /^\/subjects\/review(?:\/|$)/u.test(location.pathname);

  const isLessonQuizPage = () =>
    /^\/subject-lessons\/[^/]+\/quiz(?:\/|$)/u.test(location.pathname);

  const isAllowedPage = () =>
    (isReviewPage() && settings.runReviews)
    || (isLessonQuizPage() && settings.runLessons);

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

  // Exact matching still normalizes width, case, and incidental whitespace so
  // equivalent IME and keyboard input is treated consistently.
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
    console.error('[Wanikani Safe Auto Commit]', reason, detail ?? '');

    if (!settings.enabled || !isAllowedPage()) return;
    if (failed) return;

    failed = true;
    sessionEnabled = false;

    if ($('#WANIKANI_SAFE_AUTOCOMMIT_FAILURE')) return;

    const banner = document.createElement('div');
    banner.id = 'WANIKANI_SAFE_AUTOCOMMIT_FAILURE';

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
    text.textContent = 'Wanikani Safe Auto Commit requires updating';

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

  // WaniKani's first click checks the answer; a second click advances after a
  // correct result. The lock prevents overlapping input events from clicking
  // either stage more than once.
  const submit = () => {
    if (locked || failed || !shouldRun() || !activeQuestion) return;

    const input = getInput();
    const button = getButton();

    if (!input || !button) {
      fail('missing-dom', { input: !!input, button: !!button });
      return;
    }

    const container = getInputContainer();
    const controller = getQuizInputController();
    const question = activeQuestion;
    const value = normalize(input.value);

    // Never turn an input event on an already graded answer into an advance.
    if (!value || container?.getAttribute('correct') != null) return;
    if (controller && !matchesNativeQuestion(controller, question)) return;

    const submission = { question };
    locked = submission;
    button.click();

    if (settings.autoAdvance) {
      setTimeout(() => {
        if (locked !== submission || activeQuestion !== question
          || failed || !shouldRun() || !settings.autoAdvance || composing) return;
        if (getInput() !== input || getButton() !== button
          || getInputContainer() !== container || !button.isConnected
          || button.disabled || normalize(input.value) !== value) return;
        if (getQuizInputController() !== controller
          || !matchesNativeQuestion(controller, question)) return;
        if (container?.getAttribute('correct') !== 'true') return;

        button.click();
      }, 80);
    }

    setTimeout(() => {
      if (locked === submission) locked = null;
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

  // The immediate animation-frame check handles normal typing. Delayed checks
  // cover paste, IME completion, and page state that settles after the event.
  const scheduleCheckAnswer = () => {
    window.clearTimeout(checkTimer);

    window.requestAnimationFrame(checkAnswer);
    checkTimer = window.setTimeout(checkAnswer, 60);
    window.setTimeout(checkAnswer, 160);
  };

  // Prefer answer data delivered with the quiz event, then fall back to WKOF's
  // cached items and API data. An empty answer set always leaves submission to
  // the user instead of guessing.
  const buildExpectedAnswers = async (item, question) => {
    if (!isAllowedPage()) return;

    const subjectData = getSubjectData(item?.subject);
    const { subjectId, questionType } = question;
    const characters = subjectData?.characters || getSubjectCharactersFromDom();
    const isCurrent = () => activeQuestion === question && isAllowedPage();

    if (!isAllowedQuestionType(questionType)) return;

    let answers = collectExpectedAnswers(subjectData, subjectId, questionType);

    if (!answers.length && (subjectId || characters)) {
      const wkofSubject = await loadSubjectFromWkof(subjectId, characters);
      if (!isCurrent()) return;
      answers = collectExpectedAnswers(wkofSubject?.data || wkofSubject, subjectId, questionType);
    }

    if (!answers.length && subjectId) {
      const apiSubject = await loadSubjectFromWkofApi(subjectId);
      if (!isCurrent()) return;
      answers = collectExpectedAnswers(apiSubject?.data || apiSubject, subjectId, questionType);
    }

    if (!isCurrent()) return;
    expected = [...new Set(answers)];

    if (!expected.length) {
      console.warn('[Wanikani Safe Auto Commit] empty-expected', {
        questionType,
        subjectId,
        characters,
        item
      });
    }
  };

  const addToggleButton = () => {
    if (!settings.showToggleButton) {
      getToggleButton()?.remove();
      return;
    }

    if ($('#WANIKANI_SAFE_AUTOCOMMIT_TOGGLE')) return;

    const footer = getFooter();
    if (!footer) return;

    const button = document.createElement('button');

    button.id = 'WANIKANI_SAFE_AUTOCOMMIT_TOGGLE';
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

    if (input.dataset.wanikaniSafeAutoCommitBound) return;

    input.dataset.wanikaniSafeAutoCommitBound = 'true';

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
    try {
      if (!await readyWkof('Menu,Settings')) return;

      await window.wkof.Settings.load(SCRIPT_ID, DEFAULT_SETTINGS);
      settings = {
        ...DEFAULT_SETTINGS,
        ...(window.wkof.settings?.[SCRIPT_ID] || {})
      };

      scheduleMenuInstall();
    } catch (err) {
      console.error('[Wanikani Safe Auto Commit] settings-load', err);
    }
  };

  const installSettingsMenu = () => {
    try {
      if (!window.wkof?.Menu?.insert_script_link) return;

      window.wkof.Menu.insert_script_link({
        name: MENU_LINK_NAME,
        submenu: 'Settings',
        title: 'Safe Auto Commit',
        on_click: openSettings
      });
    } catch (err) {
      console.error('[Wanikani Safe Auto Commit] menu-install', err);
    }
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

    invalidateQuestion();
    updateToggleButton();
    if (settings.showToggleButton && isAllowedPage()) {
      addToggleButton();
    } else {
      getToggleButton()?.remove();
    }

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
        if (label.dataset.wanikaniSafeAutoCommitEnhanced) return;

        const title = label.textContent.trim();

        label.dataset.wanikaniSafeAutoCommitEnhanced = 'true';
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
      title: 'Safe Auto Commit',
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

  const activateCurrentPage = () => {
    invalidateQuestion();

    if (!isAllowedPage()) {
      getToggleButton()?.remove();
      return;
    }

    loadSynonyms();
    bindInput();
    addToggleButton();
  };

  const handlePageChange = () => {
    scheduleMenuInstall();

    try {
      activateCurrentPage();
    } catch (err) {
      fail('page-change', err);
    }
  };

  const startup = async () => {
    await loadSettings();
    document.addEventListener('turbo:before-render', invalidateQuestion);
    document.addEventListener('turbo:load', handlePageChange);
    document.addEventListener('turbo:render', handlePageChange);
    window.addEventListener('popstate', handlePageChange);

    try {
      activateCurrentPage();
    } catch (err) {
      fail('startup', err);
    }
  };

  window.addEventListener('willShowNextQuestion', async event => {
    invalidateQuestion();
    if (!isAllowedPage()) {
      getToggleButton()?.remove();
      return;
    }

    const question = {
      subjectId: getSubjectId(event.detail),
      questionType: getQuestionType(event.detail)
    };
    activeQuestion = question;

    try {
      loadSynonyms();
      await buildExpectedAnswers(event.detail, question);
      if (activeQuestion !== question) return;
      bindInput();
      addToggleButton();
    } catch (err) {
      if (activeQuestion === question) fail('willShowNextQuestion', err);
    }
  });

  window.addEventListener('didUpdateUserSynonyms', event => {
    const detail = event.detail;

    if (!detail?.subjectId) return;

    synonyms[detail.subjectId] = detail.synonyms || [];
  });

  startup();
})();
