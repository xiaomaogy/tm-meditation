const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

function createHarness({
    iosStandalone = false,
    videoRequiresActivation = false,
    videoPlayFailures = 0,
    wakeLockRequest = async () => createWakeLockSentinel()
} = {}) {
    let now = 1_000;
    let nextTimerId = 1;
    let nextUuid = 1;
    const intervals = new Map();
    const documentListeners = new Map();
    const windowListeners = new Map();
    const elements = new Map();
    const videos = [];
    const wakeLockRequests = [];
    let userActivation = false;

    function listenersFor(registry, type) {
        if (!registry.has(type)) registry.set(type, []);
        return registry.get(type);
    }

    function classList() {
        const values = new Set();
        return {
            add: (...names) => names.forEach(name => values.add(name)),
            remove: (...names) => names.forEach(name => values.delete(name)),
            toggle(name, force) {
                if (force === undefined) {
                    if (values.has(name)) values.delete(name);
                    else values.add(name);
                    return values.has(name);
                }
                if (force) values.add(name);
                else values.delete(name);
                return force;
            },
            contains: name => values.has(name)
        };
    }

    function makeElement(id = '') {
        let html = '';
        const eventListeners = new Map();
        return {
            id,
            style: {},
            classList: classList(),
            scrollTop: 0,
            onclick: null,
            appendChild() {},
            addEventListener(type, handler) {
                listenersFor(eventListeners, type).push(handler);
            },
            removeEventListener(type, handler) {
                const handlers = listenersFor(eventListeners, type);
                const index = handlers.indexOf(handler);
                if (index >= 0) handlers.splice(index, 1);
            },
            dispatch(type, event = {}) {
                const wasActive = userActivation;
                userActivation = type === 'click' || type === 'touchend' || type === 'mouseup';
                for (const handler of [...listenersFor(eventListeners, type)]) {
                    handler({ type, preventDefault() {}, ...event });
                }
                userActivation = wasActive;
            },
            querySelector: () => null,
            querySelectorAll: () => [],
            setAttribute() {},
            get innerHTML() { return html; },
            set innerHTML(value) {
                html = value;
                for (const match of value.matchAll(/id="([^"]+)"/g)) {
                    elements.set(match[1], makeElement(match[1]));
                }
            }
        };
    }

    function makeVideo() {
        const videoListeners = new Map();
        const video = {
            paused: true,
            duration: 1,
            currentTime: 0,
            playCalls: 0,
            playAttempts: 0,
            pauseCalls: 0,
            rejectionHandled: false,
            children: [],
            setAttribute() {},
            appendChild(child) { this.children.push(child); },
            addEventListener(type, handler) {
                listenersFor(videoListeners, type).push(handler);
            },
            play() {
                this.playAttempts += 1;
                if (videoRequiresActivation && !userActivation) return Promise.resolve();
                if (videoPlayFailures > 0) {
                    videoPlayFailures -= 1;
                    const error = new Error('video playback was blocked');
                    return {
                        catch: handler => {
                            this.rejectionHandled = true;
                            handler(error);
                            return Promise.resolve();
                        }
                    };
                }
                this.playCalls += 1;
                this.paused = false;
                return Promise.resolve();
            },
            pause() {
                this.pauseCalls += 1;
                this.paused = true;
            }
        };
        videos.push(video);
        return video;
    }

    const document = {
        visibilityState: 'visible',
        hidden: false,
        body: makeElement('body'),
        getElementById(id) {
            if (!elements.has(id)) elements.set(id, makeElement(id));
            return elements.get(id);
        },
        querySelectorAll: () => [],
        createElement(tag) {
            return tag === 'video' ? makeVideo() : makeElement(tag);
        },
        addEventListener(type, handler) {
            listenersFor(documentListeners, type).push(handler);
        },
        removeEventListener(type, handler) {
            const handlers = listenersFor(documentListeners, type);
            const index = handlers.indexOf(handler);
            if (index >= 0) handlers.splice(index, 1);
        }
    };

    const window = {
        addEventListener(type, handler) {
            listenersFor(windowListeners, type).push(handler);
        },
        removeEventListener(type, handler) {
            const handlers = listenersFor(windowListeners, type);
            const index = handlers.indexOf(handler);
            if (index >= 0) handlers.splice(index, 1);
        },
        stop() {}
    };

    const navigator = {
        standalone: iosStandalone,
        userAgent: iosStandalone
            ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_7 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148'
            : 'Mozilla/5.0 Test Browser',
        wakeLock: {
            request(type) {
                wakeLockRequests.push(type);
                return wakeLockRequest(type);
            }
        }
    };

    class FakeDate extends Date {
        constructor(...args) {
            super(...(args.length ? args : [now]));
        }
        static now() { return now; }
    }

    const context = vm.createContext({
        console,
        document,
        window,
        navigator,
        Date: FakeDate,
        Promise,
        Math,
        JSON,
        crypto: { randomUUID: () => `test-${nextUuid++}` },
        localStorage: {
            getItem: () => null,
            setItem() {}
        },
        confirm: () => true,
        setInterval(callback) {
            const id = nextTimerId++;
            intervals.set(id, callback);
            return id;
        },
        clearInterval(id) {
            intervals.delete(id);
        },
        setTimeout(callback) {
            callback();
            return 0;
        },
        clearTimeout() {}
    });

    window.setInterval = context.setInterval;
    window.clearInterval = context.clearInterval;
    window.setTimeout = context.setTimeout;
    window.clearTimeout = context.clearTimeout;
    window.navigator = navigator;

    const noSleepPath = path.join(ROOT, 'vendor', 'nosleep.min.js');
    if (fs.existsSync(noSleepPath)) {
        vm.runInContext(fs.readFileSync(noSleepPath, 'utf8'), context, {
            filename: noSleepPath
        });
    }
    const keepAwakePath = path.join(ROOT, 'keep-awake.js');
    if (fs.existsSync(keepAwakePath)) {
        vm.runInContext(fs.readFileSync(keepAwakePath, 'utf8'), context, {
            filename: keepAwakePath
        });
    }
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8'), context, {
        filename: path.join(ROOT, 'app.js')
    });

    return {
        App: vm.runInContext('App', context),
        document,
        videos,
        wakeLockRequests,
        element: id => document.getElementById(id),
        advance(ms) { now += ms; },
        runIntervals() {
            for (const callback of [...intervals.values()]) callback();
        },
        dispatchDocument(type, event = {}) {
            const wasActive = userActivation;
            userActivation = type === 'click' || type === 'touchend' || type === 'mouseup';
            for (const handler of [...listenersFor(documentListeners, type)]) {
                handler({ type, preventDefault() {}, ...event });
            }
            userActivation = wasActive;
        },
        setVisibility(value) {
            document.visibilityState = value;
            document.hidden = value !== 'visible';
        }
    };
}

function createWakeLockSentinel() {
    const listeners = new Map();
    return {
        released: false,
        releaseCalls: 0,
        addEventListener(type, handler) {
            if (!listeners.has(type)) listeners.set(type, []);
            listeners.get(type).push(handler);
        },
        async release() {
            this.releaseCalls += 1;
            this.released = true;
            for (const handler of listeners.get('release') || []) handler();
        },
        triggerRelease() {
            this.released = true;
            for (const handler of listeners.get('release') || []) handler();
        }
    };
}

async function flushPromises() {
    await Promise.resolve();
    await Promise.resolve();
}

test('End invalidates every re-entrant start so idle progress cannot keep moving', () => {
    const h = createHarness();
    h.App.mins = 1;

    h.App.start();
    h.App.start();
    h.advance(30_000);
    h.App.stop();

    const idleFill = h.element('fill');
    assert.equal(idleFill.style.height || '', '');
    h.runIntervals();
    assert.equal(idleFill.style.height || '', '');

    h.App.start();
    assert.equal(h.App.state, 'running');
});

test('a delayed tick enters phase out at the progress implied by the original deadline', () => {
    const h = createHarness();
    h.App.mins = 1;

    h.App.start();
    h.advance(90_000);
    h.runIntervals();

    assert.equal(h.App.state, 'phaseout');
    assert.ok(Math.abs(parseFloat(h.element('fill').style.height) - (100 / 6)) < 0.01);
});

test('a delayed tick past both deadlines completes instead of restarting phase out', () => {
    const h = createHarness();
    h.App.mins = 1;

    h.App.start();
    h.advance((4 * 60 * 1000) + 1);
    h.runIntervals();

    assert.equal(h.App.state, 'feedback');
    assert.equal(h.App.sessions.length, 1);
});

test('iOS Home Screen start synchronously enables video keep-awake until End', () => {
    const h = createHarness({ iosStandalone: true });

    h.App.start();
    assert.equal(h.videos.length, 1);
    assert.equal(h.videos[0].playCalls, 1);

    h.App.stop();
    assert.equal(h.videos[0].pauseCalls, 1);
});

test('drag-to-start enables iOS video keep-awake from the touchend user gesture', () => {
    const h = createHarness({ iosStandalone: true, videoRequiresActivation: true });
    h.App.init();

    h.element('thumb').dispatch('touchstart', { touches: [{ clientY: 100 }] });
    h.dispatchDocument('touchmove', { touches: [{ clientY: 150 }] });
    h.dispatchDocument('touchend');

    assert.equal(h.App.state, 'running');
    assert.equal(h.videos.length, 1);
    assert.equal(h.videos[0].playCalls, 1);
});

test('a wake lock that resolves after End is immediately released', async () => {
    const pending = deferred();
    const sentinel = createWakeLockSentinel();
    const h = createHarness({ wakeLockRequest: () => pending.promise });

    h.App.start();
    h.App.stop();
    pending.resolve(sentinel);
    await flushPromises();

    assert.equal(sentinel.releaseCalls, 1);
});

test('an active session releases while hidden and reacquires when visible', async () => {
    const sentinels = [];
    const h = createHarness({
        wakeLockRequest: async () => {
            const sentinel = createWakeLockSentinel();
            sentinels.push(sentinel);
            return sentinel;
        }
    });
    h.App.init();
    h.App.start();
    await flushPromises();

    h.setVisibility('hidden');
    h.dispatchDocument('visibilitychange');
    await flushPromises();
    assert.equal(sentinels[0].releaseCalls, 1);

    h.setVisibility('visible');
    h.dispatchDocument('visibilitychange');
    await flushPromises();
    assert.equal(h.wakeLockRequests.length, 2);
});

test('an active session reacquires a wake lock after the system releases it', async () => {
    const sentinels = [];
    const h = createHarness({
        wakeLockRequest: async () => {
            const sentinel = createWakeLockSentinel();
            sentinels.push(sentinel);
            return sentinel;
        }
    });

    h.App.start();
    await flushPromises();
    sentinels[0].triggerRelease();
    await flushPromises();

    assert.equal(h.wakeLockRequests.length, 2);
    assert.equal(sentinels.length, 2);
});

test('a rejected iOS video wake-lock attempt is handled and can recover on resume', async () => {
    const h = createHarness({ iosStandalone: true, videoPlayFailures: 1 });

    h.App.init();
    h.App.start();
    assert.equal(h.videos[0].rejectionHandled, true);
    assert.match(h.App.keepAwake.lastError.message, /video playback was blocked/);

    h.setVisibility('hidden');
    h.dispatchDocument('visibilitychange');
    h.setVisibility('visible');
    h.dispatchDocument('visibilitychange');
    await flushPromises();

    assert.equal(h.videos[0].playAttempts, 2);
    assert.equal(h.videos[0].playCalls, 1);
    assert.equal(h.App.keepAwake.lastError, null);
});
