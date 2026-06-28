#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const sourcePath = path.join(root, 'vendor', 'cjk-decomp', 'cjk-decomp.txt');
const outputPath = path.join(root, 'data', 'components.json');

const normalizeComponent = new Map([
  ['亻', '人'],
  ['𠆢', '人'],
  ['忄', '心'],
  ['㣺', '心'],
  ['氵', '水'],
  ['氺', '水'],
  ['扌', '手'],
  ['龵', '手'],
  ['朩', '木'],
  ['訁', '言'],
  ['讠', '言'],
  ['糹', '糸'],
  ['纟', '糸'],
  ['刂', '刀'],
  ['灬', '火'],
  ['犭', '犬'],
  ['礻', '示'],
  ['衤', '衣'],
  ['⺮', '竹'],
  ['𥫗', '竹'],
  ['飠', '食'],
  ['饣', '食'],
  ['钅', '金'],
  ['牜', '牛'],
  ['⺗', '心']
]);

const isBmpHan = value => /^[\u4e00-\u9fff]$/u.test(value);
const isKanjiLike = value => isBmpHan(normalizeComponent.get(value) || value);

const parseComponents = expression => {
  const components = [];
  const match = expression.match(/\((.*)\)$/u);
  if (!match) return components;

  for (const part of match[1].split(',')) {
    const value = part.trim();
    if (isKanjiLike(value)) {
      const normalized = normalizeComponent.get(value) || value;
      components.push({
        kanji: normalized,
        form: value === normalized ? null : value
      });
    }
  }

  return components.filter((component, index) =>
    components.findIndex(candidate => candidate.kanji === component.kanji) === index
  );
};

const direct = new Map();

for (const line of fs.readFileSync(sourcePath, 'utf8').split(/\r?\n/u)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;

  const separator = trimmed.indexOf(':');
  if (separator === -1) continue;

  const character = trimmed.slice(0, separator);
  if (!isBmpHan(character)) continue;

  const components = parseComponents(trimmed.slice(separator + 1));
  const filtered = components.filter(component => component.kanji !== character);

  if (filtered.length) {
    direct.set(character, filtered);
  }
}

const output = {};

for (const [character, components] of direct.entries()) {
  output[character] = components;
}

fs.writeFileSync(outputPath, `${JSON.stringify(output)}\n`);

console.log(`Wrote ${Object.keys(output).length} entries to ${path.relative(process.cwd(), outputPath)}`);
