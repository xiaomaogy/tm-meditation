const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

test('service worker installation precaches every script needed for offline startup', async () => {
    const listeners = new Map();
    let openedCache = '';
    let cachedAssets = [];

    const context = vm.createContext({
        Promise,
        self: {
            addEventListener(type, handler) { listeners.set(type, handler); },
            skipWaiting() {},
            clients: { claim() {} }
        },
        caches: {
            async open(name) {
                openedCache = name;
                return {
                    async addAll(assets) { cachedAssets = Array.from(assets); },
                    async put() {}
                };
            },
            async keys() { return []; },
            async delete() {},
            async match() { return null; }
        },
        fetch: async () => ({ clone() { return this; } })
    });

    vm.runInContext(fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8'), context, {
        filename: path.join(ROOT, 'sw.js')
    });

    let installation;
    listeners.get('install')({ waitUntil(promise) { installation = promise; } });
    await installation;

    assert.equal(openedCache, 'tm-v18');
    assert.ok(cachedAssets.includes('./vendor/nosleep.min.js'));
    assert.ok(cachedAssets.includes('./keep-awake.js'));
    assert.ok(cachedAssets.includes('./app.js'));
});
