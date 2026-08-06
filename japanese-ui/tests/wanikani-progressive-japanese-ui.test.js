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
    buildLearnedMeaningTranslations,
    buildTranslations,
    buildTranslationsFromCache,
    collectLearnedItems,
    collectLearnedVocabulary,
    createLearnedCache,
    isUiTextNode,
    isValidLearnedCache,
    isWaniKaniHost,
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
  WeakMap
};
context.window = context;
vm.runInNewContext(exposeInternals, context, { filename: SCRIPT_PATH });

const api = context.__japaneseUiTest;

test('limits execution to WaniKani and the private site allowlist', () => {
  for (const match of [
    'https://www.wanikani.com/*',
    'https://preview.wanikani.com/*',
    'https://www.youtube.com/*',
    'https://www.nexusmods.com/*',
    'https://keep.google.com/*'
  ]) {
    assert.match(SCRIPT_SOURCE, new RegExp(`@match\\s+${match.replaceAll('.', '\\.')}`));
  }

  assert.equal(api.isWaniKaniHost('www.wanikani.com'), true);
  assert.equal(api.isWaniKaniHost('preview.wanikani.com'), true);
  assert.equal(api.isWaniKaniHost('www.youtube.com'), false);
  assert.match(SCRIPT_SOURCE, /@inject-into\s+page/u);
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
  assert.equal(api.translateText('Extra Study', translations), 'Extra 研究');
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
