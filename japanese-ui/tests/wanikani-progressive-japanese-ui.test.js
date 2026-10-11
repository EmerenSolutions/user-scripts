const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const SCRIPT_PATH = path.resolve(
  __dirname,
  '..',
  'src',
  'wanikani-progressive-japanese-ui.user.js'
);
const SCRIPT_SOURCE = fs.readFileSync(SCRIPT_PATH, 'utf8');

const exposeInternals = SCRIPT_SOURCE.replace(
  '  void initialize();\n})();',
  `  window.__japaneseUiTest = {
    activateTranslations,
    restoreTranslatedNodes,
    buildLearnedMeaningTranslations,
    buildTranslations,
    buildTranslationsFromCache,
    collectLearnedItems,
    collectLearnedVocabulary,
    createWkofBridgeSource,
    createLearnedCache,
    forgetDetachedTextNodes,
    isAllowedPage,
    isSubjectLink,
    initialize,
    startObserving,
    translatedNodes,
    isUiTextNode,
    isValidLearnedCache,
    isWaniKaniHost,
    parseWkofBridgeDetail,
    serializeWkofItems,
    singularize,
    translateCoreText,
    translateText
  };
})();`
);

const context = {
  console,
  document: {},
  Map,
  MutationObserver: class {},
  NodeFilter: { SHOW_TEXT: 4 },
  Number,
  Object,
  Set,
  String,
  WeakMap,
  URL
};
context.window = context;
vm.runInNewContext(exposeInternals, context, { filename: SCRIPT_PATH });

const api = context.__japaneseUiTest;

test('requests access to WaniKani browsing pages through one site match', () => {
  const matches = [...SCRIPT_SOURCE.matchAll(/^\/\/ @match\s+(.+)$/gmu)];
  assert.deepEqual(matches.map(match => match[1]), ['https://www.wanikani.com/*']);

  assert.equal(api.isWaniKaniHost('www.wanikani.com'), true);
  assert.equal(api.isWaniKaniHost('preview.wanikani.com'), true);
  assert.equal(api.isWaniKaniHost('www.youtube.com'), false);
  assert.match(SCRIPT_SOURCE, /@inject-into\s+content/u);
  assert.match(SCRIPT_SOURCE, /@grant\s+GM_addElement/u);
  assert.match(SCRIPT_SOURCE, /@noframes/u);
  assert.doesNotMatch(SCRIPT_SOURCE, /@grant\s+unsafeWindow/u);
  assert.doesNotMatch(SCRIPT_SOURCE, /__wanikaniProgressiveJapaneseUI/u);
});

test('serializes only the WKOF fields required to build translations', () => {
  const serialized = api.serializeWkofItems([{
    object: 'vocabulary',
    apiToken: 'must-not-cross-the-bridge',
    data: {
      characters: '今日',
      slug: '今日',
      hidden_at: null,
      level: 3,
      meanings: [{
        meaning: 'Today',
        primary: true,
        accepted_answer: true,
        auxiliary: 'not-required'
      }]
    },
    assignments: {
      srs_stage: 2,
      started_at: '2026-08-06T00:00:00Z',
      available_at: '2026-08-07T00:00:00Z'
    }
  }]);
  const plain = JSON.parse(JSON.stringify(serialized));

  assert.deepEqual(plain, [{
    object: 'vocabulary',
    data: {
      characters: '今日',
      slug: '今日',
      hidden_at: null,
      meanings: [{
        meaning: 'Today',
        primary: true,
        accepted_answer: true
      }]
    },
    assignments: {
      srs_stage: 2,
      started_at: '2026-08-06T00:00:00Z'
    }
  }]);
  assert.doesNotMatch(JSON.stringify(plain), /must-not-cross-the-bridge/u);
});

test('creates a narrow page bridge and validates its response', () => {
  const eventName = 'wanikani-progressive-japanese-ui:wkof:test';
  const source = api.createWkofBridgeSource(eventName);
  const items = [{ object: 'vocabulary', data: {}, assignments: null }];

  assert.match(source, new RegExp(eventName));
  assert.match(source, /window\.wkof/u);
  assert.doesNotMatch(source, /GM_(?:get|set)Value/u);
  assert.deepEqual(
    JSON.parse(JSON.stringify(api.parseWkofBridgeDetail(JSON.stringify({
      ok: true,
      items
    })))),
    items
  );
  assert.throws(
    () => api.parseWkofBridgeDetail(JSON.stringify({ ok: false, error: 'WKOF failed' })),
    /WKOF failed/u
  );
  assert.throws(() => api.parseWkofBridgeDetail({}), /invalid response/u);
});

test('page bridge requests WKOF data and emits a minimized JSON response', async () => {
  const calls = [];
  const events = [];
  const bridgeContext = {
    Array,
    Boolean,
    CustomEvent: class {
      constructor(type, options) {
        this.type = type;
        this.detail = options.detail;
      }
    },
    Error,
    JSON,
    String,
    document: {
      documentElement: {
        dispatchEvent(event) {
          events.push(event);
        }
      }
    },
    window: {
      wkof: {
        include(module) {
          calls.push(['include', module]);
        },
        ready(module) {
          calls.push(['ready', module]);
          return Promise.resolve();
        },
        ItemData: {
          get_items(options) {
            calls.push(['get_items', JSON.parse(JSON.stringify(options))]);
            return Promise.resolve([{
              object: 'vocabulary',
              apiToken: 'must-not-cross-the-bridge',
              data: {
                characters: '今日',
                slug: '今日',
                hidden_at: null,
                meanings: [{
                  meaning: 'Today',
                  primary: true,
                  accepted_answer: true
                }]
              },
              assignments: {
                srs_stage: 2,
                started_at: '2026-08-06T00:00:00Z'
              }
            }]);
          }
        }
      }
    }
  };

  vm.runInNewContext(
    api.createWkofBridgeSource('wanikani-progressive-japanese-ui:wkof:test'),
    bridgeContext
  );
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(calls, [
    ['include', 'ItemData'],
    ['ready', 'ItemData'],
    ['get_items', {
      wk_items: {
        options: { assignments: true },
        filters: { item_type: 'vocabulary,kana_vocabulary' }
      }
    }]
  ]);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'wanikani-progressive-japanese-ui:wkof:test');

  const response = JSON.parse(events[0].detail);
  assert.equal(response.ok, true);
  assert.equal(response.items[0].data.characters, '今日');
  assert.doesNotMatch(events[0].detail, /must-not-cross-the-bridge/u);
});

const vocabulary = (characters, options = {}) => ({
  object: options.object || 'vocabulary',
  data: {
    characters,
    hidden_at: options.hiddenAt || null,
    meanings: options.meanings || [],
    slug: characters
  },
  assignments: options.withoutAssignment
    ? undefined
    : {
      srs_stage: options.srsStage ?? 1,
      started_at: options.startedAt === undefined
        ? '2026-08-06T00:00:00.000000Z'
        : options.startedAt
    }
});

test('counts only vocabulary whose lesson has been completed', () => {
  const learned = api.collectLearnedVocabulary([
    vocabulary('今日'),
    vocabulary('ホテル', { object: 'kana_vocabulary' }),
    vocabulary('授業', { startedAt: null, srsStage: 0 }),
    vocabulary('復習', { withoutAssignment: true }),
    vocabulary('古い言葉', { hiddenAt: '2025-01-01T00:00:00Z' }),
    { object: 'kanji', data: { characters: '日', hidden_at: null } }
  ]);

  assert.deepEqual([...learned].sort(), ['ホテル', '今日']);
});

test('enables simple labels only after their exact vocabulary is learned', () => {
  const translations = api.buildTranslations(new Set(['今日', '授業']));

  assert.equal(api.translateText('Today', translations), '今日');
  assert.equal(api.translateText('Lessons', translations), '授業');
  assert.equal(api.translateText('Reviews', translations), 'Reviews');
});

test('progressively replaces the learned parts of composite labels', () => {
  const firstWord = api.buildTranslations(new Set(['復習']));
  const secondWord = api.buildTranslations(new Set(['予報']));
  const complete = api.buildTranslations(new Set(['復習', '予報']));

  assert.equal(api.translateText('Review Forecast', firstWord), '復習 Forecast');
  assert.equal(api.translateText('Review Forecast', secondWord), 'Review 予報');
  assert.equal(api.translateText('Review Forecast', complete), '復習予報');
});

test('uses a partial dashboard label before the whole phrase is learned', () => {
  const partial = api.buildTranslations(new Set(['今日']));
  const complete = api.buildTranslations(new Set(['今日', '授業']));

  assert.equal(api.translateText("Today's", partial), '今日の');
  assert.equal(api.translateText("Today's Lessons", partial), '今日の Lessons');
  assert.equal(api.translateText("Today's Lessons", complete), '今日の授業');
});

test('derives UI translations from meanings on learned vocabulary', () => {
  const items = [
    vocabulary('時', {
      meanings: [{ meaning: 'Hour', primary: true, accepted_answer: true }]
    }),
    vocabulary('時間', {
      meanings: [{ meaning: 'Hour', primary: true, accepted_answer: true }]
    }),
    vocabulary('研究', {
      meanings: [{ meaning: 'Study', primary: false, accepted_answer: true }]
    })
  ];
  const learnedItems = api.collectLearnedItems(items);
  const translations = api.buildTranslations(
    api.collectLearnedVocabulary(items),
    learnedItems
  );

  assert.equal(api.translateText('Next 24 Hours', translations), 'Next 24 時間');
  assert.equal(api.translateText('Extra Study', translations), 'Extra Study');
});

test('round-trips learned vocabulary through the cross-site cache', () => {
  const items = [
    vocabulary('今日', {
      meanings: [{ meaning: 'Today', primary: true, accepted_answer: true }]
    }),
    vocabulary('時間', {
      meanings: [{ meaning: 'Hour', primary: true, accepted_answer: true }]
    })
  ];
  const savedAt = '2026-08-06T05:00:00.000Z';
  const cache = api.createLearnedCache(items, savedAt);
  const translations = api.buildTranslationsFromCache(cache);

  assert.equal(api.isValidLearnedCache(cache), true);
  assert.equal(cache.savedAt, savedAt);
  assert.equal(cache.learnedItems, 2);
  assert.equal(translations.get('today'), '今日');
  assert.equal(translations.get('hours'), '時間');
});

test('does not derive unsafe translations for stop words or ambiguous UI terms', () => {
  const translations = api.buildLearnedMeaningTranslations([
    vocabulary('あなた', {
      meanings: [{ meaning: 'You', primary: true, accepted_answer: true }]
    }),
    vocabulary('主人', {
      meanings: [{ meaning: 'Master', primary: true, accepted_answer: true }]
    }),
    vocabulary('大体', {
      meanings: [{ meaning: 'About', primary: true, accepted_answer: true }]
    })
  ]);

  assert.equal(translations.has('you'), false);
  assert.equal(translations.has('master'), false);
  assert.equal(translations.has('about'), false);
});

test('translates count-prefixed labels and preserves surrounding whitespace', () => {
  const translations = api.buildTranslations(new Set(['授業', '復習']));

  assert.equal(api.translateText('  10 Lessons\n', translations), '  10 授業\n');
  assert.equal(api.translateText('0 Reviews', translations), '0 復習');
});

test('matches UI labels without depending on English capitalization', () => {
  const translations = api.buildTranslations(new Set(['漢字', '意味']));

  assert.equal(api.translateCoreText('kanji meaning', translations), '漢字の意味');
});

test('limits replacements to UI-like elements and excludes explanations', () => {
  const makeParent = ({ excluded = false, inAncestor = false, direct = false }) => ({
    closest(selector) {
      if (selector.includes('explanation')) return excluded ? this : null;
      return inAncestor ? this : null;
    },
    matches() {
      return direct;
    }
  });

  assert.equal(api.isUiTextNode({
    nodeType: 3,
    parentElement: makeParent({ inAncestor: true })
  }), true);
  assert.equal(api.isUiTextNode({
    nodeType: 3,
    parentElement: makeParent({ direct: true })
  }), true);
  assert.equal(api.isUiTextNode({
    nodeType: 3,
    parentElement: makeParent({ excluded: true, inAncestor: true, direct: true })
  }), false);
  assert.equal(api.isUiTextNode({
    nodeType: 3,
    parentElement: makeParent({})
  }), false);
});

test('forgets removed translated nodes but retains nodes moved within the document', () => {
  const removed = { nodeType: 3, isConnected: false };
  const moved = { nodeType: 3, isConnected: true };
  const records = new Map([
    [removed, { original: 'Lessons', translated: '授業' }],
    [moved, { original: 'Reviews', translated: '復習' }]
  ]);

  api.forgetDetachedTextNodes(removed, records);
  api.forgetDetachedTextNodes(moved, records);

  assert.equal(records.has(removed), false);
  assert.equal(records.has(moved), true);
});


test('allows WaniKani browsing pages and rejects active study sessions and other origins', () => {
  for (const path of [
    '/',
    '/?test=1',
    '/#forecast',
    '/dashboard',
    '/dashboard/',
    '/dashboard?test=1',
    '/subject-lessons/picker',
    '/subject-lessons/picker/',
    '/subject-lessons/picker?test=1',
    '/subject-lessons/picker/#lessons',
    '/kanji?difficulty=pleasant',
    '/radicals',
    '/vocabulary',
    '/level/1',
    '/kanji/山',
    '/radicals/barb',
    '/vocabulary/山',
    '/settings',
    '/new-browsing-page'
  ]) {
    assert.equal(api.isAllowedPage(new URL(`https://www.wanikani.com${path}`)), true, path);
  }
  for (const url of [
    'https://www.wanikani.com/subjects/review',
    'https://www.wanikani.com/lesson',
    'https://www.wanikani.com/subject-lessons/picker/extra',
    'https://www.wanikani.com/subjects/extra_study',
    'https://www.wanikani.com/review/session',
    'https://www.wanikani.com/lessons',
    'https://www.wanikani.com/subject-lessons/start',
    'https://preview.wanikani.com/',
    'https://community.wanikani.com/',
    'http://www.wanikani.com/',
    'https://example.com/'
  ]) {
    assert.equal(api.isAllowedPage(new URL(url)), false, url);
  }
});

test('does not initialize on a different origin', async () => {
  const isolated = { ...context, location: new URL('https://example.com/') };
  isolated.window = isolated;
  isolated.console = { error() { assert.fail('Initialization should not start'); } };
  vm.runInNewContext(exposeInternals, isolated);
  await isolated.__japaneseUiTest.initialize();
});

test('stops translating after leaving allowed pages and resumes on an allowed page', () => {
  let callback;
  let disconnected = 0;
  let observed = 0;
  const isolated = {
    ...context,
    location: new URL('https://www.wanikani.com/'),
    document: {
      documentElement: { nodeType: 1 },
      createTreeWalker() { return { nextNode() { return null; } }; }
    },
    MutationObserver: class {
      constructor(handler) { callback = handler; }
      disconnect() { disconnected += 1; }
      observe() { observed += 1; }
    }
  };
  isolated.window = isolated;
  vm.runInNewContext(exposeInternals, isolated);
  const runtime = isolated.__japaneseUiTest;
  runtime.startObserving();
  assert.equal(observed, 1);
  const node = { nodeValue: '授業' };
  runtime.translatedNodes.set(node, { original: 'Lessons', translated: '授業' });
  isolated.location = new URL('https://www.wanikani.com/subjects/review');
  callback([]);
  assert.equal(disconnected, 1);
  assert.equal(node.nodeValue, 'Lessons');
  assert.equal(runtime.translatedNodes.size, 0);
  runtime.startObserving();
  assert.equal(observed, 1);
  isolated.location = new URL('https://www.wanikani.com/dashboard');
  runtime.startObserving();
  assert.equal(observed, 2);
});


test('uses the curated study sense only after the study vocabulary is learned', () => {
  const items = [vocabulary('研究', {
    meanings: [{ meaning: 'Study', primary: true, accepted_answer: true }]
  })];
  const cache = api.createLearnedCache(items);
  assert.equal(api.translateText('Study', api.buildTranslationsFromCache(cache)), 'Study');
  assert.equal(api.translateText('Extra Study', api.buildTranslations(new Set(['勉強']))), 'Extra 勉強');
});

test('rejects an unrelated meaning for a curated UI label', () => {
  const items = [vocabulary('読書', {
    meanings: [{ meaning: 'Reading', primary: true, accepted_answer: true }]
  })];
  const translations = api.buildTranslations(api.collectLearnedVocabulary(items), items);
  assert.equal(api.translateText('Reading', translations), 'Reading');
  assert.equal(api.translateText('Readings', translations), 'Readings');
});

test('translates all forecast weekday abbreviations through weekday vocabulary', () => {
  const weekdays = [
    ['Mon', '月曜日'], ['Tue', '火曜日'], ['Wed', '水曜日'],
    ['Thu', '木曜日'], ['Fri', '金曜日'], ['Sat', '土曜日'], ['Sun', '日曜日']
  ];
  const translations = api.buildTranslations(new Set(weekdays.map(([, target]) => target)));
  translations.set('sun', '太陽');
  translations.set('sat', '座った');
  for (const [source, target] of weekdays) {
    assert.equal(api.translateText(source, translations, { forecast: true }), target);
    assert.equal(api.translateText(`  ${source}. 11 Oct\n`, translations, { forecast: true }), `  ${target} 11 Oct\n`);
  }
  assert.equal(api.translateText('tues', translations, { forecast: true }), '火曜日');
  assert.equal(api.translateText('Thurs, 15', translations, { forecast: true }), '木曜日, 15');
});

test('keeps an unlearned forecast weekday English even when its ordinary meaning is learned', () => {
  const cache = api.createLearnedCache([vocabulary('太陽', {
    meanings: [{ meaning: 'Sun', primary: true, accepted_answer: true }]
  })]);
  const translations = api.buildTranslationsFromCache(cache);
  assert.equal(api.translateText('Sun', translations, { forecast: true }), 'Sun');
  assert.equal(api.translateText('Sun 11 Oct', translations, { forecast: true }), 'Sun 11 Oct');
  assert.equal(api.translateText('Sun', translations), '太陽');
  assert.equal(api.translateText('Sunshine', translations, { forecast: true }), 'Sunshine');
});

const createRuntime = () => {
  let callback;
  const nodes = [];
  const parent = {
    closest(selector) {
      if (selector.includes('explanation')) return null;
      if (selector.includes('widgets/review-forecast')) return this.forecast ? this : null;
      return this;
    },
    matches() { return false; }
  };
  const isolated = {
    ...context,
    console: { info() {} },
    location: new URL('https://www.wanikani.com/dashboard'),
    document: {
      documentElement: { nodeType: 1 },
      createTreeWalker(root) {
        const entries = root.nodes || nodes;
        let index = 0;
        return { nextNode() { return entries[index++] || null; } };
      }
    },
    MutationObserver: class {
      constructor(handler) { callback = handler; }
      disconnect() {}
      observe() {}
    }
  };
  isolated.window = isolated;
  vm.runInNewContext(exposeInternals, isolated);
  return {
    isolated,
    runtime: isolated.__japaneseUiTest,
    nodes,
    add(text, forecast = false) {
      const node = {
        nodeType: 3, nodeValue: text, isConnected: true,
        parentElement: { ...parent, forecast }
      };
      nodes.push(node);
      return node;
    },
    mutate(records) { callback(records); }
  };
};

test('applies forecast context to initial and dynamically inserted text without changing controls', () => {
  const harness = createRuntime();
  const initial = harness.add('Sun', true);
  // The script only changes text nodes; link attributes and click handlers stay intact.
  const click = () => {};
  initial.parentElement.href = '#forecast-content-0';
  initial.parentElement.onclick = click;
  harness.runtime.activateTranslations(api.createLearnedCache([vocabulary('日曜日')]));
  assert.equal(initial.nodeValue, '日曜日');
  assert.equal(initial.parentElement.href, '#forecast-content-0');
  assert.equal(initial.parentElement.onclick, click);
  const dynamic = harness.add('Sun 11 Oct', true);
  harness.mutate([{ type: 'childList', addedNodes: [dynamic], removedNodes: [] }]);
  assert.equal(dynamic.nodeValue, '日曜日 11 Oct');
  harness.runtime.restoreTranslatedNodes();
  assert.equal(initial.nodeValue, 'Sun');
  assert.equal(dynamic.nodeValue, 'Sun 11 Oct');
});

test('restores Turbo cache text and resumes across dashboard and lesson picker navigation', () => {
  const harness = createRuntime();
  const node = harness.add('Lessons');
  harness.runtime.activateTranslations(api.createLearnedCache([vocabulary('授業'), vocabulary('復習')]));
  assert.equal(node.nodeValue, '授業');
  harness.runtime.restoreTranslatedNodes();
  assert.equal(node.nodeValue, 'Lessons');
  harness.isolated.location = new URL('https://www.wanikani.com/subject-lessons/picker');
  harness.runtime.startObserving();
  assert.equal(node.nodeValue, '授業');
  node.nodeValue = 'Reviews';
  harness.mutate([{ type: 'characterData', target: node }]);
  assert.equal(node.nodeValue, '復習');
  harness.isolated.location = new URL('https://www.wanikani.com/subjects/review');
  harness.mutate([]);
  assert.equal(node.nodeValue, 'Reviews');
  assert.equal(harness.runtime.translatedNodes.size, 0);
  harness.isolated.location = new URL('https://www.wanikani.com/dashboard');
  harness.runtime.startObserving();
  assert.equal(node.nodeValue, '復習');
});

test('preserves host text updates during restoration', () => {
  const harness = createRuntime();
  const node = harness.add('Lessons');
  harness.runtime.activateTranslations(api.createLearnedCache([vocabulary('授業')]));
  node.nodeValue = 'Host replacement';
  harness.runtime.restoreTranslatedNodes();
  assert.equal(node.nodeValue, 'Host replacement');
});


test('protects subject links while keeping category and level navigation eligible', () => {
  for (const href of ['/kanji/山', '/radicals/barb', '/vocabulary/大きい', '/kana-vocabulary/はい',
    'https://www.wanikani.com/kanji/山/?test=1#meaning']) {
    assert.equal(api.isSubjectLink(href), true, href);
  }
  for (const href of ['/kanji', '/kanji/?difficulty=pleasant', '/level/1', '/vocabulary',
    'https://example.com/kanji/山', '#meaning', null]) {
    assert.equal(api.isSubjectLink(href), false, String(href));
  }
});

test('protects a subject link even without the standard card class', () => {
  const node = { nodeType: 3, parentElement: {
    closest(selector) {
      if (selector.includes('explanation')) return null;
      if (selector === 'a[href]') return { getAttribute() { return '/radicals/barb'; } };
      return this;
    }
  } };
  assert.equal(api.isUiTextNode(node), false);
});

test('restores a translated label when moved into protected study content', () => {
  const harness = createRuntime();
  const node = harness.add('Name');
  harness.runtime.activateTranslations(api.createLearnedCache([vocabulary('名前')]));
  assert.equal(node.nodeValue, '名前');
  const originalClosest = node.parentElement.closest;
  node.parentElement.closest = function(selector) {
    if (selector.includes('.subject-character')) return this;
    return originalClosest.call(this, selector);
  };
  harness.mutate([{ type: 'childList', addedNodes: [node], removedNodes: [node] }]);
  assert.equal(node.nodeValue, 'Name');
  assert.equal(harness.runtime.translatedNodes.size, 0);
});

test('restores text when its parent becomes a protected component', () => {
  const harness = createRuntime();
  const node = harness.add('Name');
  harness.runtime.activateTranslations(api.createLearnedCache([vocabulary('名前')]));
  node.parentElement.closest = selector => selector.includes('.subject-character') ? node.parentElement : null;
  harness.mutate([{ type: 'attributes', target: { nodeType: 1, nodes: [node] } }]);
  assert.equal(node.nodeValue, 'Name');
});

test('refreshes existing translated nodes when learned vocabulary changes', () => {
  const harness = createRuntime();
  const node = harness.add('Review Forecast');
  harness.runtime.activateTranslations(api.createLearnedCache([vocabulary('復習')]));
  assert.equal(node.nodeValue, '復習 Forecast');
  harness.runtime.activateTranslations(api.createLearnedCache([vocabulary('復習'), vocabulary('予報')]));
  assert.equal(node.nodeValue, '復習予報');
});


test('protects card meanings and subject-detail sections even inside UI-like ancestors', () => {
  for (const component of ['.subject-character', '.subject-page-header__subject',
    '.subject-section__content', '.subject-subsection__content', '.last-item__meanings']) {
    const node = { nodeType: 3, parentElement: {
      closest(selector) {
        if (selector.split(',').includes(component)) return this;
        if (selector.includes('explanation') || selector === 'a[href]') return null;
        return this;
      }
    } };
    assert.equal(api.isUiTextNode(node), false, component);
  }
});

test('registers Turbo handling before refresh and resumes after starting in a quiz', async () => {
  const harness = createRuntime();
  const node = harness.add('Lessons');
  const events = new Map();
  const isolated = harness.isolated;
  isolated.location = new URL('https://www.wanikani.com/subjects/review');
  isolated.document.addEventListener = (name, handler) => events.set(name, handler);
  isolated.GM_getValue = () => api.createLearnedCache([vocabulary('授業')]);
  let finishRefresh;
  isolated.syncForTest = () => new Promise(resolve => { finishRefresh = resolve; });
  vm.runInNewContext(exposeInternals.replace('await initializeFromWaniKani();', 'await window.syncForTest();'), isolated);
  const pending = isolated.__japaneseUiTest.initialize();
  assert.equal(node.nodeValue, 'Lessons');
  assert.equal(events.has('turbo:before-cache'), true);
  assert.equal(events.has('turbo:load'), true);
  isolated.location = new URL('https://www.wanikani.com/level/1');
  events.get('turbo:load')();
  assert.equal(node.nodeValue, '授業');
  events.get('turbo:before-cache')();
  assert.equal(node.nodeValue, 'Lessons');
  finishRefresh();
  await pending;
});


test('keeps the software Account label English, including older cached meaning maps', () => {
  const items = [vocabulary('記事', {
    meanings: [{ meaning: 'Account', primary: false, accepted_answer: true }]
  })];
  const fresh = api.buildTranslations(api.collectLearnedVocabulary(items), items);
  assert.equal(api.translateText('Account', fresh), 'Account');
  const cache = api.createLearnedCache(items);
  cache.learnedMeanings.push(['account', '記事']);
  assert.equal(api.translateText('Account', api.buildTranslationsFromCache(cache)), 'Account');
});
