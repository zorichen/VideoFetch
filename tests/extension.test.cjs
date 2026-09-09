const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '../VideoCaptureExtension');

function harness({ settings, page = 'https://ke.renrenjiang.cn/watch', granted = true } = {}) {
  const calls = { attached: 0, fetched: [], listeners: {} };
  const context = vm.createContext({ URL, URLSearchParams, TextDecoder, Uint8Array, console, setTimeout, btoa,
    chrome: {
      storage: { local: { get: async () => ({ captureSettings: settings }) } },
      tabs: { query: async () => [{ id: 7, url: page }] },
      permissions: { contains: async () => granted },
      debugger: {
        attach: async () => { calls.attached++; }, detach: async () => {},
        sendCommand: async () => ({ result: { value: '' } }),
        onEvent: { addListener: fn => { calls.listeners.event = fn; } },
        onDetach: { addListener: () => {} }
      },
      runtime: { onMessage: { addListener: () => {} } }
    },
    fetch: async (url, options) => {
      calls.fetched.push({ url, options });
      return { ok: true, headers: { get: () => 'video/mp2t' }, arrayBuffer: async () => new Uint8Array([1, 2]).buffer };
    }
  });
  context.importScripts = file => vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(root, 'background.js'), 'utf8'), context);
  return { context, calls, run: code => vm.runInContext(code, context), settings: context.CaptureSettings };
}

test('origins normalize without granting paths, wildcards, credentials or subdomains', () => {
  const { settings } = harness();
  assert.equal(settings.normalizeOrigin('Example.org'), 'https://example.org');
  assert.equal(settings.normalizeOrigin('http://localhost:8080'), 'http://localhost:8080');
  for (const origin of ['*.example.org', 'https://u:p@example.org', 'https://example.org/video',
    'file:///tmp/x', 'https://example.org?token=x', 'example.org\\evil']) {
    assert.throws(() => settings.normalizeOrigin(origin));
  }
});

test('relative output folders reject traversal and absolute paths', () => {
  const { settings } = harness();
  assert.equal(settings.normalizeFolder('research/videos'), 'research/videos');
  for (const folder of ['', '/tmp', '../videos', 'outputs/../escape', 'C:\\videos',
    'a//b', 'a/./b', 'a/', 'a/b.', 'a\\b']) assert.throws(() => settings.normalizeFolder(folder));
});

test('unconfigured pages and missing browser permissions never attach debugger', async () => {
  for (const args of [{ page: 'https://unconfigured.example/watch' }, { granted: false }]) {
    const h = harness(args);
    await assert.rejects(h.run('startCapture()'));
    assert.equal(h.calls.attached, 0);
  }
});

test('configured custom origins, port and output path apply to the capture session', async () => {
  const h = harness({ page: 'http://localhost:8080/watch', settings: {
    pageOrigins: ['http://localhost:8080'], mediaOrigins: ['https://cdn.example.org'], outputFolder: 'research/videos'
  } });
  await h.run('startCapture()');
  assert.equal(h.calls.attached, 1);
  assert.equal(h.run('isAllowed("https://cdn.example.org/one.ts")'), true);
  for (const url of ['https://evil.cdn.example.org/a.ts', 'http://cdn.example.org/a.ts',
    'http://localhost:9090/a.ts', 'https://cdn.example.org.evil.test/a.ts']) {
    assert.equal(h.context.isAllowed(url), false);
  }
  assert.equal(h.run('outputPath("video.ts")'), 'research/videos/未分类/video.ts');
  assert.deepEqual(Array.from(h.settings.permissionOrigins(h.settings.normalize({
    pageOrigins: ['http://localhost:8080'], mediaOrigins: []
  }))), ['http://localhost/*']);
});

test('course metadata cannot bypass the configured media allowlist', async () => {
  const h = harness({ settings: { pageOrigins: ['https://ke.renrenjiang.cn'], mediaOrigins: [] } });
  await h.run('startCapture()');
  await h.calls.listeners.event({ tabId: 7 }, 'Network.responseReceived', {
    requestId: 'metadata', response: { url: 'https://api.renrenjiang.cn/api/v2/columns/123', mimeType: 'application/json' }
  });
  assert.equal(h.run('session.responses.size'), 0);
});

test('supplement requests obey allowlist and refuse redirects', async () => {
  const h = harness();
  await h.run('startCapture()');
  await assert.rejects(h.context.fetchSmallMissingSet(['https://unconfigured.example/1.ts'], 10));
  assert.equal(h.calls.fetched.length, 0);
  await h.context.fetchSmallMissingSet(['https://qcloudvod.renrenjiang.cn/1.ts'], 10);
  assert.equal(h.calls.fetched[0].options.redirect, 'error');
});

test('changing stored settings does not change an active session output folder', async () => {
  const settings = { pageOrigins: ['https://ke.renrenjiang.cn'], mediaOrigins: [], outputFolder: 'first' };
  const h = harness({ settings });
  await h.run('startCapture()');
  settings.outputFolder = 'second';
  assert.equal(h.run('outputPath("video.ts")'), 'first/未分类/video.ts');
});

test('encrypted playlists still fail before exporting or fetching segments', async () => {
  const h = harness();
  await h.run('startCapture()');
  const playlistURL = 'https://qcloudvod.renrenjiang.cn/test.m3u8';
  await assert.rejects(h.context.exportPlaylistVideo({ playlistURL }, [{
    item: { url: playlistURL }, text: '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key"\n#EXTINF:10\n1.ts'
  }]), /DRM/);
  assert.equal(h.calls.fetched.length, 0);
});

test('options save requests permissions and does not persist when declined', async () => {
  const h = harness();
  const nodes = new Map();
  let submit;
  let saved;
  let grant = false;
  h.context.document = { querySelector: selector => {
    if (!nodes.has(selector)) nodes.set(selector, { value: '', textContent: '', disabled: false,
      addEventListener: (_, callback) => { submit = callback; } });
    return nodes.get(selector);
  } };
  h.context.chrome.permissions.request = async () => grant;
  h.context.chrome.storage.local.set = async value => { saved = value; };
  vm.runInContext(fs.readFileSync(path.join(root, 'options.js'), 'utf8'), h.context);
  await new Promise(resolve => setImmediate(resolve));
  nodes.get('#pages').value = 'example.org';
  nodes.get('#media').value = 'cdn.example.org';
  nodes.get('#folder').value = 'research/videos';
  await submit({ preventDefault() {} });
  assert.equal(saved, undefined);
  assert.match(nodes.get('#status').textContent, /未保存/);
  grant = true;
  await submit({ preventDefault() {} });
  assert.equal(saved.captureSettings.outputFolder, 'research/videos');
  assert.equal(saved.captureSettings.pageOrigins[0], 'https://example.org');
});
