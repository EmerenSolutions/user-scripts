const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const script = fs.readFileSync(path.resolve(__dirname, '../src/webtoon-gap-trimmer.user.js'), 'utf8');
const rangesCode = script.slice(script.indexOf('  function retainedRanges'), script.indexOf('  const style ='));
const scanCode = script.slice(script.indexOf('  async function scan('), script.indexOf('  async function processImage'));
let active, top = 0, width;
const context = {
  Uint8Array, setTimeout: (fn) => fn(),
  document: { createElement() { return { getContext() { return {
    clearRect() {},
    drawImage(source, x, y, w) { active = source; top = y; width = w; },
    getImageData(x, y, w, h) { return { data: active.subarray(top * width * 4, (top + h) * width * 4) }; }
  }; } }; } },
};
vm.createContext(context);
const configCode = script.slice(script.indexOf('  const WHITE'), script.indexOf('  function retainedRanges'));
vm.runInContext(configCode + rangesCode + scanCode, context);
async function check(data, w, h) {
  const ranges = await context.scan(data, w, h);
  const kept = new Set(ranges.flatMap(([a,b]) => Array.from({length:b-a}, (_,i) => a+i)));
  for (let y=0; y<h; y++) {
    if (kept.has(y)) continue;
    for (let x=0; x<w; x++) {
      const i=(y*w+x)*4;
      assert(data[i]>=250 && data[i+1]>=250 && data[i+2]>=250 && data[i+3]===255, `Removed nonwhite pixel ${x},${y}`);
    }
  }
  return { ranges: JSON.parse(JSON.stringify(ranges)), removed: h-kept.size };
}
test('preserves narrow dark marks, transparent rows, and short white gaps', async () => {
  const solid = Buffer.alloc(720 * 400 * 4, 255);
  for (let y = 0; y < 400; y++) solid[(y * 720 + 300) * 4] = 0;
  assert.equal((await check(solid, 720, 400)).removed, 0);
  assert.equal((await check(Buffer.alloc(720 * 400 * 4, 0), 720, 400)).removed, 0);
  assert.equal((await check(Buffer.alloc(720 * 80 * 4, 255), 720, 80)).removed, 0);
});

test('shortens a white image while retaining breathing room', async () => {
  assert.equal((await check(Buffer.alloc(720 * 400 * 4, 255), 720, 400)).removed, 353);
});

test('shortens an interior gap without removing the artwork on either side', async () => {
  const data = Buffer.alloc(720 * 600 * 4, 255);
  for (let y = 0; y < 600; y++) {
    if (y < 150 || y >= 450) data[(y * 720 + 360) * 4] = 0;
  }
  const result = await check(data, 720, 600);
  assert.equal(result.removed, 253);
  assert.deepEqual(result.ranges, [[0, 173], [426, 600]]);
});

test('CDN image requests include the comic origin without cookies or chapter details', async () => {
  const requestCode = script.slice(script.indexOf('  function fetchBitmap'), script.indexOf('  async function scan'));
  let request;
  const bitmap = { width: 720, height: 600 };
  const harness = vm.createContext({
    Blob,
    location: { origin: 'https://www.mangakakalot.gg' },
    GM_xmlhttpRequest(options) { request = options; },
    async createImageBitmap() { return bitmap; }
  });
  vm.runInContext(requestCode, harness);
  const result = harness.fetchBitmap('https://images.example/chapter.png');
  assert.equal(request.url, 'https://images.example/chapter.png');
  assert.equal(request.headers.Referer, 'https://www.mangakakalot.gg/');
  assert.equal(request.anonymous, true);
  await request.onload({ status: 200, response: new Blob(['image']) });
  assert.equal(await result, bitmap);
  const failure = harness.fetchBitmap('https://images.example/chapter.png');
  const rejection = assert.rejects(failure, /HTTP 403/);
  await request.onload({ status: 403 });
  await rejection;
});
