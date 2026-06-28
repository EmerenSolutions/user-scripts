#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const templatePath = path.join(root, 'scripts', 'wanikani-kanji-components.template.js');
const componentsPath = path.join(root, 'data', 'components.json');
const outputPath = path.join(root, 'src', 'wanikani-kanji-components.user.js');

const template = fs.readFileSync(templatePath, 'utf8');
const components = fs.readFileSync(componentsPath, 'utf8').trim();
const output = template.replace('__COMPONENTS_JSON__', components);

fs.writeFileSync(outputPath, output);

console.log(`Wrote ${path.relative(process.cwd(), outputPath)}`);

