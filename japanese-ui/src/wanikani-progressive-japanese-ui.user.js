// ==UserScript==
// @name         WaniKani Progressive Japanese UI
// @namespace    https://github.com/EmerenSolutions/user-scripts
// @version      0.1.0
// @description  Replaces UI words with Japanese vocabulary learned in WaniKani
// @author       Johan Emerén
// @copyright    2026, Johan Emerén
// @license      MIT
// @match        https://www.wanikani.com/*
// @match        https://preview.wanikani.com/*
// @match        https://www.youtube.com/*
// @match        https://www.nexusmods.com/*
// @match        https://keep.google.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        unsafeWindow
// @inject-into  page
// @run-at       document-idle
// @downloadURL  https://raw.githubusercontent.com/EmerenSolutions/user-scripts/main/japanese-ui/src/wanikani-progressive-japanese-ui.user.js
// @updateURL    https://raw.githubusercontent.com/EmerenSolutions/user-scripts/main/japanese-ui/src/wanikani-progressive-japanese-ui.user.js
// ==/UserScript==

(() => {
  'use strict';

  const SCRIPT_NAME = 'WaniKani Progressive Japanese UI';
  const SCRIPT_VERSION = '0.1.0';
  const CACHE_KEY = 'learned-vocabulary-cache-v1';
  const CACHE_SCHEMA_VERSION = 1;
  const MINIMUM_SRS_STAGE = 1;
  // Page-context injection is intentional: WKOF lives on the page's window,
  // while Violentmonkey still supplies the GM storage functions used below.
  const pageWindow = typeof unsafeWindow === 'undefined' ? window : unsafeWindow;
  const UI_ANCESTOR_SELECTOR = [
    'a',
    'button',
    'label',
    'summary',
    'nav',
    'header',
    'footer',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'th',
    '[role="button"]',
    '[role="heading"]',
    '[role="menuitem"]',
    '[role="tab"]'
  ].join(',');
  const UI_DIRECT_SELECTOR = [
    '[class*="forecast"]',
    '[class*="header"]',
    '[class*="heading"]',
    '[class*="label"]',
    '[class*="lesson"]',
    '[class*="menu"]',
    '[class*="navigation"]',
    '[class*="progress"]',
    '[class*="quiz"]',
    '[class*="subtitle"]',
    '[class*="summary"]',
    '[class*="title"]'
  ].join(',');
  const EXCLUDED_SELECTOR = [
    'script',
    'style',
    'textarea',
    'input',
    'select',
    'option',
    'code',
    'pre',
    '[contenteditable="true"]',
    '[class*="context-sentence"]',
    '[class*="explanation"]',
    '[class*="mnemonic"]'
  ].join(',');
  const TOKEN_STOP_WORDS = new Set([
    'a',
    'an',
    'and',
    'are',
    'as',
    'at',
    'be',
    'been',
    'being',
    'but',
    'by',
    'did',
    'do',
    'does',
    'for',
    'from',
    'he',
    'her',
    'his',
    'in',
    'is',
    'it',
    'its',
    'of',
    'on',
    'or',
    'our',
    'she',
    'that',
    'the',
    'their',
    'these',
    'they',
    'this',
    'those',
    'to',
    'was',
    'we',
    'were',
    'with',
    'you',
    'your'
  ]);
  const AMBIGUOUS_MEANINGS = new Set([
    'about',
    'back',
    'down',
    'left',
    'master',
    'right',
    'safe',
    'up'
  ]);

  // Each rule names the exact WaniKani vocabulary required to reveal it.
  // Composite labels use the most complete variant the learner has unlocked.
  const TERM_RULES = Object.freeze([
    { source: 'Today', target: '今日', requires: ['今日'] },
    { source: "Today's", target: '今日の', requires: ['今日'] },
    { source: 'Tomorrow', target: '明日', requires: ['明日'] },
    { source: 'Yesterday', target: '昨日', requires: ['昨日'] },
    { source: 'Monday', target: '月曜日', requires: ['月曜日'] },
    { source: 'Tuesday', target: '火曜日', requires: ['火曜日'] },
    { source: 'Wednesday', target: '水曜日', requires: ['水曜日'] },
    { source: 'Thursday', target: '木曜日', requires: ['木曜日'] },
    { source: 'Friday', target: '金曜日', requires: ['金曜日'] },
    { source: 'Saturday', target: '土曜日', requires: ['土曜日'] },
    { source: 'Sunday', target: '日曜日', requires: ['日曜日'] },
    { source: 'Hour', target: '時間', requires: ['時間'] },
    { source: 'Hours', target: '時間', requires: ['時間'] },

    { source: 'Lesson', target: '授業', requires: ['授業'] },
    { source: 'Lessons', target: '授業', requires: ['授業'] },
    {
      source: "Today's Lessons",
      variants: [
        { target: '今日の授業', requires: ['今日', '授業'] },
        { target: '今日の Lessons', requires: ['今日'] },
        { target: "Today's 授業", requires: ['授業'] }
      ]
    },
    {
      source: 'Lesson Picker',
      variants: [
        { target: '授業選択', requires: ['授業', '選択'] },
        { target: '授業 Picker', requires: ['授業'] },
        { target: 'Lesson 選択', requires: ['選択'] }
      ]
    },
    {
      source: 'Start Lessons',
      variants: [
        { target: '授業開始', requires: ['授業', '開始'] },
        { target: 'Start 授業', requires: ['授業'] },
        { target: 'Lessons 開始', requires: ['開始'] }
      ]
    },
    {
      source: 'Interleave Lessons',
      variants: [
        { target: '授業を混ぜる', requires: ['授業', '混ぜる'] },
        { target: 'Interleave 授業', requires: ['授業'] },
        { target: 'Lessonsを混ぜる', requires: ['混ぜる'] }
      ]
    },
    {
      source: 'Lesson Summary',
      variants: [
        { target: '授業概要', requires: ['授業', '概要'] },
        { target: '授業 Summary', requires: ['授業'] },
        { target: 'Lesson 概要', requires: ['概要'] }
      ]
    },

    { source: 'Review', target: '復習', requires: ['復習'] },
    { source: 'Reviews', target: '復習', requires: ['復習'] },
    {
      source: 'Review Forecast',
      variants: [
        { target: '復習予報', requires: ['復習', '予報'] },
        { target: '復習 Forecast', requires: ['復習'] },
        { target: 'Review 予報', requires: ['予報'] }
      ]
    },
    {
      source: 'Review Summary',
      variants: [
        { target: '復習概要', requires: ['復習', '概要'] },
        { target: '復習 Summary', requires: ['復習'] },
        { target: 'Review 概要', requires: ['概要'] }
      ]
    },
    {
      source: 'Next Review',
      variants: [
        { target: '次の復習', requires: ['次', '復習'] },
        { target: '次の Review', requires: ['次'] },
        { target: 'Next 復習', requires: ['復習'] }
      ]
    },
    {
      source: 'Next Reviews',
      variants: [
        { target: '次の復習', requires: ['次', '復習'] },
        { target: '次の Reviews', requires: ['次'] },
        { target: 'Next 復習', requires: ['復習'] }
      ]
    },
    {
      source: 'Upcoming Reviews',
      variants: [
        { target: '今後の復習', requires: ['今後', '復習'] },
        { target: '今後の Reviews', requires: ['今後'] },
        { target: 'Upcoming 復習', requires: ['復習'] }
      ]
    },

    { source: 'Radical', target: '部首', requires: ['部首'] },
    { source: 'Radicals', target: '部首', requires: ['部首'] },
    { source: 'Kanji', target: '漢字', requires: ['漢字'] },
    { source: 'Vocabulary', target: '単語', requires: ['単語'] },
    {
      source: 'Kanji Composition',
      variants: [
        { target: '漢字の構成', requires: ['漢字', '構成'] },
        { target: '漢字 Composition', requires: ['漢字'] },
        { target: 'Kanjiの構成', requires: ['構成'] }
      ]
    },

    { source: 'Meaning', target: '意味', requires: ['意味'] },
    { source: 'Meanings', target: '意味', requires: ['意味'] },
    { source: 'Reading', target: '読み方', requires: ['読み方'] },
    { source: 'Readings', target: '読み方', requires: ['読み方'] },
    { source: 'Pronunciation', target: '発音', requires: ['発音'] },
    { source: 'Context', target: '文脈', requires: ['文脈'] },
    { source: 'Name', target: '名前', requires: ['名前'] },
    { source: 'Names', target: '名前', requires: ['名前'] },
    { source: 'Example', target: '例', requires: ['例'] },
    { source: 'Examples', target: '例', requires: ['例'] },
    { source: 'Answer', target: '答え', requires: ['答え'] },
    { source: 'Question', target: '質問', requires: ['質問'] },

    { source: 'Correct', target: '正解', requires: ['正解'] },
    { source: 'Incorrect', target: '不正解', requires: ['不正解'] },
    { source: 'Answered Correctly', target: '正解', requires: ['正解'] },
    { source: 'Answered Incorrectly', target: '不正解', requires: ['不正解'] },
    { source: 'Progress', target: '進行', requires: ['進行'] },
    { source: 'Summary', target: '概要', requires: ['概要'] },
    { source: 'Details', target: '詳細', requires: ['詳細'] },
    { source: 'Settings', target: '設定', requires: ['設定'] },
    { source: 'Item', target: '項目', requires: ['項目'] },
    { source: 'Items', target: '項目', requires: ['項目'] },
    { source: 'All', target: '全て', requires: ['全て'] },
    {
      source: 'Select All',
      variants: [
        { target: '全て選択', requires: ['全て', '選択'] },
        { target: 'Select 全て', requires: ['全て'] },
        { target: 'All 選択', requires: ['選択'] }
      ]
    },
    { source: 'Recent', target: '最近', requires: ['最近'] },
    {
      source: 'Recent Mistakes',
      variants: [
        { target: '最近の間違い', requires: ['最近', '間違い'] },
        { target: '最近の Mistakes', requires: ['最近'] },
        { target: 'Recent 間違い', requires: ['間違い'] }
      ]
    },
    {
      source: 'Recent Unlocks',
      variants: [
        { target: '最近の解放', requires: ['最近', '解放'] },
        { target: '最近の Unlocks', requires: ['最近'] },
        { target: 'Recent 解放', requires: ['解放'] }
      ]
    },
    {
      source: 'Recently Learned',
      variants: [
        { target: '最近習った', requires: ['最近', '習う'] },
        { target: '最近 Learned', requires: ['最近'] },
        { target: 'Recently 習った', requires: ['習う'] }
      ]
    },
    {
      source: 'Extra Study',
      variants: [
        { target: '追加の勉強', requires: ['追加', '勉強'] },
        { target: '追加の Study', requires: ['追加'] },
        { target: 'Extra 勉強', requires: ['勉強'] }
      ]
    },
    {
      source: 'Critical Items',
      variants: [
        { target: '危険な項目', requires: ['危険', '項目'] },
        { target: '危険な Items', requires: ['危険'] },
        { target: 'Critical 項目', requires: ['項目'] }
      ]
    },

    {
      source: 'Radical Name',
      variants: [
        { target: '部首の名前', requires: ['部首', '名前'] },
        { target: '部首 Name', requires: ['部首'] },
        { target: 'Radicalの名前', requires: ['名前'] }
      ]
    },
    {
      source: 'Radical Meaning',
      variants: [
        { target: '部首の意味', requires: ['部首', '意味'] },
        { target: '部首 Meaning', requires: ['部首'] },
        { target: 'Radicalの意味', requires: ['意味'] }
      ]
    },
    {
      source: 'Kanji Meaning',
      variants: [
        { target: '漢字の意味', requires: ['漢字', '意味'] },
        { target: '漢字 Meaning', requires: ['漢字'] },
        { target: 'Kanjiの意味', requires: ['意味'] }
      ]
    },
    {
      source: 'Kanji Reading',
      variants: [
        { target: '漢字の読み方', requires: ['漢字', '読み方'] },
        { target: '漢字 Reading', requires: ['漢字'] },
        { target: 'Kanjiの読み方', requires: ['読み方'] }
      ]
    },
    {
      source: 'Vocabulary Meaning',
      variants: [
        { target: '単語の意味', requires: ['単語', '意味'] },
        { target: '単語 Meaning', requires: ['単語'] },
        { target: 'Vocabularyの意味', requires: ['意味'] }
      ]
    },
    {
      source: 'Vocabulary Reading',
      variants: [
        { target: '単語の読み方', requires: ['単語', '読み方'] },
        { target: '単語 Reading', requires: ['単語'] },
        { target: 'Vocabularyの読み方', requires: ['読み方'] }
      ]
    }
  ]);

  let translations = new Map();
  let observer = null;
  const translatedNodes = new Map();
  const runtimeStatus = {
    version: SCRIPT_VERSION,
    source: null,
    lastSyncedAt: null,
    learnedItems: 0,
    learnedMeanings: 0,
    translatedNodes: 0,
    replacements: []
  };

  const normalizeSource = value => String(value).toLocaleLowerCase('en-US');

  const isLearnedVocabularyItem = item => (
    (item?.object === 'vocabulary' || item?.object === 'kana_vocabulary')
    && item?.data?.hidden_at == null
    && item?.assignments?.started_at != null
    && Number(item.assignments.srs_stage) >= MINIMUM_SRS_STAGE
  );

  const collectLearnedItems = items => items.filter(isLearnedVocabularyItem);

  const collectLearnedVocabulary = items => new Set(
    collectLearnedItems(items)
      .map(item => item.data.characters || item.data.slug)
      .filter(Boolean)
  );

  // A learned meaning can map to more than one vocabulary item. Prefer primary
  // accepted meanings, then make equal-score selection deterministic. Common
  // and ambiguous English words are excluded rather than translated poorly.
  const buildLearnedMeaningTranslations = learnedItems => {
    const candidates = new Map();

    for (const item of learnedItems) {
      const target = item.data.characters || item.data.slug;
      if (!target) continue;

      for (const meaning of item.data.meanings || []) {
        const source = normalizeSource(meaning.meaning).trim();
        if (
          !/^[a-z][a-z '\-]*$/u.test(source)
          || TOKEN_STOP_WORDS.has(source)
          || AMBIGUOUS_MEANINGS.has(source)
        ) continue;

        const candidate = {
          target,
          score: (meaning.primary ? 100 : 0)
            + (meaning.accepted_answer === false ? 0 : 10)
            - [...target].length
        };
        const current = candidates.get(source);
        if (
          !current
          || candidate.score > current.score
          || (
            candidate.score === current.score
            && candidate.target.localeCompare(current.target, 'ja') < 0
          )
        ) candidates.set(source, candidate);
      }
    }

    return new Map(
      [...candidates].map(([source, candidate]) => [source, candidate.target])
    );
  };

  const applyTermRules = (activeTranslations, learnedVocabulary) => {
    for (const rule of TERM_RULES) {
      const variants = rule.variants || [rule];
      const activeVariant = variants.find(variant => (
        variant.requires.every(term => learnedVocabulary.has(term))
      ));

      if (activeVariant) {
        activeTranslations.set(normalizeSource(rule.source), activeVariant.target);
      }
    }

    return activeTranslations;
  };

  // Retained as a focused composition boundary and instrumented by the unit
  // tests, even though production cache activation uses the function below.
  // deno-lint-ignore no-unused-vars
  const buildTranslations = (learnedVocabulary, learnedItems = []) => (
    applyTermRules(
      buildLearnedMeaningTranslations(learnedItems),
      learnedVocabulary
    )
  );

  const createLearnedCache = (learnedItems, savedAt = new Date().toISOString()) => {
    const learnedVocabulary = collectLearnedVocabulary(learnedItems);
    const learnedMeanings = buildLearnedMeaningTranslations(learnedItems);

    return {
      schemaVersion: CACHE_SCHEMA_VERSION,
      savedAt,
      learnedItems: learnedItems.length,
      learnedVocabulary: [...learnedVocabulary],
      learnedMeanings: [...learnedMeanings]
    };
  };

  const isValidLearnedCache = cache => (
    cache?.schemaVersion === CACHE_SCHEMA_VERSION
    && typeof cache.savedAt === 'string'
    && Number.isInteger(cache.learnedItems)
    && Array.isArray(cache.learnedVocabulary)
    && Array.isArray(cache.learnedMeanings)
  );

  const buildTranslationsFromCache = cache => applyTermRules(
    new Map(cache.learnedMeanings),
    new Set(cache.learnedVocabulary)
  );

  const isWaniKaniHost = hostname => (
    hostname === 'www.wanikani.com' || hostname === 'preview.wanikani.com'
  );

  const singularize = word => {
    if (word.endsWith('ies') && word.length > 4) return `${word.slice(0, -3)}y`;
    if (/(?:ches|shes|sses|xes|zes)$/u.test(word)) return word.slice(0, -2);
    if (word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
    return word;
  };

  const translateEnglishWords = (value, activeTranslations) => value.replace(
    /[A-Za-z]+(?:['’][A-Za-z]+)?/gu,
    word => {
      const normalized = normalizeSource(word);
      if (TOKEN_STOP_WORDS.has(normalized)) return word;

      return activeTranslations.get(normalized)
        || activeTranslations.get(singularize(normalized))
        || word;
    }
  );

  const translateCoreText = (core, activeTranslations = translations) => {
    const direct = activeTranslations.get(normalizeSource(core));
    if (direct) return direct;

    const countMatch = core.match(/^([\d,]+)\s+(.+)$/u);
    if (countMatch) {
      const countedTerm = activeTranslations.get(normalizeSource(countMatch[2]));
      if (countedTerm) return `${countMatch[1]} ${countedTerm}`;
    }

    return translateEnglishWords(core, activeTranslations);
  };

  const translateText = (value, activeTranslations = translations) => {
    const raw = String(value ?? '');
    const match = raw.match(/^(\s*)(.*?)(\s*)$/su);
    if (!match) return raw;

    const translated = translateCoreText(match[2], activeTranslations);
    return translated === match[2]
      ? raw
      : `${match[1]}${translated}${match[3]}`;
  };

  const isUiTextNode = node => {
    if (!node || node.nodeType !== 3 || !node.parentElement) return false;
    if (node.parentElement.closest(EXCLUDED_SELECTOR)) return false;
    return Boolean(
      node.parentElement.closest(UI_ANCESTOR_SELECTOR)
      || node.parentElement.matches(UI_DIRECT_SELECTOR)
    );
  };

  const publishStatus = () => {
    runtimeStatus.translatedNodes = translatedNodes.size;
    runtimeStatus.replacements = [...translatedNodes.values()]
      .slice(0, 100)
      .map(({ original, translated }) => ({
        original: original.trim(),
        translated: translated.trim()
      }));
    pageWindow.__wanikaniProgressiveJapaneseUI = { ...runtimeStatus };
  };

  // Keep the original text for Turbo page caching and for host pages that
  // rewrite an already translated node after a dynamic update.
  const processTextNode = node => {
    const previous = translatedNodes.get(node);
    if (previous) {
      if (node.nodeValue === previous.translated) return;
      translatedNodes.delete(node);
    }

    if (!isUiTextNode(node)) return;

    const original = node.nodeValue;
    const translated = translateText(original);
    if (translated === original) return;

    translatedNodes.set(node, { original, translated });
    node.nodeValue = translated;
  };

  const processSubtree = root => {
    if (!root) return;
    if (root.nodeType === 3) {
      processTextNode(root);
      return;
    }
    if (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return;

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      processTextNode(node);
      node = walker.nextNode();
    }
    publishStatus();
  };

  const stopObserving = () => {
    observer?.disconnect();
    observer = null;
  };

  const restoreTranslatedNodes = () => {
    stopObserving();
    for (const [node, record] of translatedNodes) {
      if (node.nodeValue === record.translated) node.nodeValue = record.original;
    }
    translatedNodes.clear();
    publishStatus();
  };

  const startObserving = () => {
    stopObserving();
    processSubtree(document.body || document.documentElement);

    observer = new MutationObserver(mutations => {
      for (const mutation of mutations) {
        if (mutation.type === 'characterData') {
          processTextNode(mutation.target);
          continue;
        }

        for (const node of mutation.addedNodes) processSubtree(node);
      }
      publishStatus();
    });
    observer.observe(document.documentElement, {
      characterData: true,
      childList: true,
      subtree: true
    });
  };

  const loadLearnedItems = async () => {
    pageWindow.wkof.include('ItemData');
    await pageWindow.wkof.ready('ItemData');

    const items = await pageWindow.wkof.ItemData.get_items({
      wk_items: {
        options: { assignments: true },
        filters: { item_type: 'vocabulary,kana_vocabulary' }
      }
    });

    return collectLearnedItems(items);
  };

  const activateTranslations = cache => {
    translations = buildTranslationsFromCache(cache);
    runtimeStatus.source = isWaniKaniHost(window.location.hostname)
      ? 'wkof'
      : 'cache';
    runtimeStatus.lastSyncedAt = cache.savedAt;
    runtimeStatus.learnedItems = cache.learnedItems;
    runtimeStatus.learnedMeanings = cache.learnedMeanings.length;
    startObserving();

    console.info(
      `[${SCRIPT_NAME}] Translated ${translatedNodes.size} UI text nodes `
      + `using ${runtimeStatus.learnedMeanings} learned meanings from `
      + `${runtimeStatus.learnedItems} vocabulary items (${runtimeStatus.source}).`
    );
  };

  // WaniKani is the only API-backed host. Other allowlisted sites can read the
  // vocabulary cache but never receive WKOF or the user's API token.
  const initializeFromWaniKani = async () => {
    if (!pageWindow.wkof?.include || !pageWindow.wkof?.ready) {
      console.warn(
        `[${SCRIPT_NAME}] WaniKani Open Framework is required: `
        + 'https://community.wanikani.com/t/28549'
      );
      return;
    }

    const learnedItems = await loadLearnedItems();
    const cache = createLearnedCache(learnedItems);
    GM_setValue(CACHE_KEY, cache);
    activateTranslations(cache);
  };

  const initializeFromCache = () => {
    const cache = GM_getValue(CACHE_KEY, null);
    if (!isValidLearnedCache(cache)) {
      console.warn(
        `[${SCRIPT_NAME}] No learned-vocabulary cache yet. `
        + 'Open WaniKani once to sync through WKOF.'
      );
      return;
    }

    activateTranslations(cache);
  };

  const initialize = async () => {
    try {
      if (isWaniKaniHost(window.location.hostname)) {
        await initializeFromWaniKani();
        document.addEventListener('turbo:before-cache', restoreTranslatedNodes);
        document.addEventListener('turbo:load', startObserving);
      } else {
        initializeFromCache();
      }
    } catch (error) {
      console.error(`[${SCRIPT_NAME}] Failed to initialize.`, error);
    }
  };

  void initialize();
})();
