const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const REPOSITORY_URL = 'https://github.com/EmerenSolutions/user-scripts';
const RAW_ROOT = 'https://raw.githubusercontent.com/EmerenSolutions/user-scripts/main';
const ROOT_README = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');

const scripts = [
  {
    directory: 'safe-auto-commit',
    source: 'safe-auto-commit/src/wanikani-safe-auto-commit.user.js',
    namespace: 'https://github.com/EmerenSolutions/wanikani-userscripts',
    license: 'MIT'
  },
  {
    directory: 'kanji-components',
    source: 'kanji-components/src/wanikani-kanji-components.user.js',
    namespace: 'https://github.com/EmerenSolutions/wanikani-userscripts',
    license: 'MIT AND Apache-2.0'
  },
  {
    directory: 'review-forecast-open-today',
    source: 'review-forecast-open-today/src/wanikani-review-forecast-open-today.user.js',
    namespace: 'https://github.com/EmerenSolutions/wanikani-userscripts',
    license: 'MIT'
  },
  {
    directory: 'japanese-ui',
    source: 'japanese-ui/src/wanikani-progressive-japanese-ui.user.js',
    namespace: REPOSITORY_URL,
    license: 'MIT'
  },
  {
    directory: 'universal-speed',
    source: 'universal-speed/src/universal-speed-control.user.js',
    namespace: REPOSITORY_URL,
    license: 'MIT'
  }
];

const read = relativePath => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');

const parseMetadata = source => {
  const metadata = new Map();
  const block = source.match(/\/\/ ==UserScript==([\s\S]*?)\/\/ ==\/UserScript==/u);
  assert.ok(block, 'userscript metadata block is present');

  for (const line of block[1].split('\n')) {
    const match = line.match(/^\/\/ @(\S+)\s+(.+)$/u);
    if (!match) continue;

    const values = metadata.get(match[1]) || [];
    values.push(match[2].trim());
    metadata.set(match[1], values);
  }

  return metadata;
};

const singleMetadataValue = (metadata, key) => {
  const values = metadata.get(key) || [];
  assert.equal(values.length, 1, `@${key} appears exactly once`);
  return values[0];
};

for (const script of scripts) {
  test(`${script.directory} has consistent release metadata and documentation`, () => {
    const source = read(script.source);
    const metadata = parseMetadata(source);
    const version = singleMetadataValue(metadata, 'version');
    const expectedRawUrl = `${RAW_ROOT}/${script.source}`;

    assert.match(version, /^\d+\.\d+\.\d+$/u);
    assert.equal(singleMetadataValue(metadata, 'namespace'), script.namespace);
    assert.equal(singleMetadataValue(metadata, 'license'), script.license);
    assert.equal(singleMetadataValue(metadata, 'copyright'), '2026, Johan Emerén');
    assert.equal(singleMetadataValue(metadata, 'downloadURL'), expectedRawUrl);
    assert.equal(singleMetadataValue(metadata, 'updateURL'), expectedRawUrl);

    const scriptReadme = read(`${script.directory}/README.md`);
    assert.ok(scriptReadme.includes(`Current version: \`${version}\`.`));
    assert.ok(ROOT_README.includes(script.directory));
    assert.ok(ROOT_README.includes(expectedRawUrl));
  });
}

test('generated Kanji Components userscript matches its template and data', () => {
  const template = read('kanji-components/scripts/wanikani-kanji-components.template.js');
  const components = read('kanji-components/data/components.json').trim();
  const apacheLicense = read('kanji-components/vendor/cjk-decomp/LICENSE')
    .trim()
    .split(/\r?\n/u)
    .map(line => line ? ` * ${line}` : ' *')
    .join('\n');
  const generated = read('kanji-components/src/wanikani-kanji-components.user.js');

  const expected = template
    .replace('__CJK_DECOMP_LICENSE__', apacheLicense)
    .replace('__COMPONENTS_JSON__', components);

  assert.equal(generated, expected);
  assert.match(generated, /source data was modified/u);
  assert.match(generated, /Apache License\s+\*\s+Version 2\.0/u);
});

test('third-party data retains its license and repository notice', () => {
  assert.match(read('kanji-components/vendor/cjk-decomp/LICENSE'), /Apache License/u);
  assert.match(read('THIRD_PARTY_NOTICES.md'), /cjk-decomp/u);
});

test('repository package metadata declares the root license and source', () => {
  const packageMetadata = JSON.parse(read('package.json'));

  assert.equal(packageMetadata.private, true);
  assert.equal(packageMetadata.license, 'MIT');
  assert.equal(packageMetadata.author, 'Johan Emerén');
  assert.equal(packageMetadata.repository.url, `${REPOSITORY_URL}.git`);
  assert.match(read('LICENSE'), /MIT License/u);
});
