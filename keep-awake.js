(function (root) {
    'use strict';

    function isIOSHomeScreen() {
        return navigator.standalone === true && /iPad|iPhone|iPod/.test(navigator.userAgent || '');
    }

    class KeepAwakeController {
        constructor() {
            this.desired = false;
            this.sentinel = null;
            this.videoLock = null;
            this.requestToken = 0;
            this.nativeRequest = null;
            this.retryNativeAfterPending = false;
            this.lastError = null;
        }

        enable() {
            this.desired = true;
            const token = ++this.requestToken;
            this.enableVideoFallback();
            this.requestNativeWakeLock(token);
        }

        resume() {
            if (!this.desired) return;
            const token = ++this.requestToken;
            this.enableVideoFallback();
            this.requestNativeWakeLock(token);
        }

        suspend() {
            ++this.requestToken;
            this.retryNativeAfterPending = false;
            this.releaseNativeWakeLock();
            if (this.videoLock) {
                try { this.videoLock.disable(); } catch(e) {}
            }
        }

        disable() {
            this.desired = false;
            ++this.requestToken;
            this.retryNativeAfterPending = false;
            this.releaseNativeWakeLock();
            if (this.videoLock) {
                try { this.videoLock.disable(); } catch(e) {}
                this.videoLock = null;
            }
            this.lastError = null;
        }

        enableVideoFallback() {
            const needsFallback = isIOSHomeScreen() || !('wakeLock' in navigator);
            if (!needsFallback || typeof root.NoSleep !== 'function') return;

            try {
                if (!this.videoLock) this.videoLock = new root.NoSleep();
                // NoSleep 0.9 supports iOS 16 Home Screen apps, but its public
                // enable() method discards the video.play() Promise. Calling the
                // owned video directly lets us handle a rejected play attempt.
                const result = this.videoLock.noSleepVideo
                    && typeof this.videoLock.noSleepVideo.play === 'function'
                    ? this.videoLock.noSleepVideo.play()
                    : this.videoLock.enable();
                this.lastError = null;
                if (result && typeof result.catch === 'function') {
                    result.catch(error => { if (this.desired) this.lastError = error; });
                }
            } catch(error) {
                this.lastError = error;
            }
        }

        requestNativeWakeLock(token) {
            if (!('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
            if (this.sentinel && !this.sentinel.released) return;
            if (this.nativeRequest) {
                this.retryNativeAfterPending = true;
                return this.nativeRequest;
            }

            let request;
            try {
                request = Promise.resolve(navigator.wakeLock.request('screen'));
            } catch(e) {
                return;
            }

            this.nativeRequest = request;
            request.then(sentinel => {
                if (!this.desired || token !== this.requestToken || document.visibilityState !== 'visible') {
                    try {
                        const releaseResult = sentinel.release();
                        if (releaseResult && typeof releaseResult.catch === 'function') releaseResult.catch(() => {});
                    } catch(e) {}
                    return;
                }

                this.sentinel = sentinel;
                sentinel.addEventListener('release', () => {
                    if (this.sentinel !== sentinel) return;
                    this.sentinel = null;
                    if (this.desired && document.visibilityState === 'visible') {
                        this.requestNativeWakeLock(++this.requestToken);
                    }
                });
            }).catch(() => {}).finally(() => {
                if (this.nativeRequest !== request) return;
                this.nativeRequest = null;
                const shouldRetry = this.retryNativeAfterPending;
                this.retryNativeAfterPending = false;
                if (shouldRetry && this.desired && document.visibilityState === 'visible'
                    && (!this.sentinel || this.sentinel.released)) {
                    this.requestNativeWakeLock(++this.requestToken);
                }
            });

            return request;
        }

        releaseNativeWakeLock() {
            const sentinel = this.sentinel;
            this.sentinel = null;
            if (!sentinel) return;
            try {
                const result = sentinel.release();
                if (result && typeof result.catch === 'function') result.catch(() => {});
            } catch(e) {}
        }
    }

    root.KeepAwakeController = KeepAwakeController;
})(typeof globalThis !== 'undefined' ? globalThis : window);
