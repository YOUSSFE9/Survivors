/**
 * mobileUtils.js — fullscreen, orientation locking, and PWA install prompt manager.
 *
 * Usage:
 *   import { enterGameFullscreen, pwaInstallManager } from './mobileUtils';
 *
 *   // On Play button click (MUST be inside a user-gesture):
 *   enterGameFullscreen();
 *
 *   // Show PWA install banner:
 *   pwaInstallManager.showPrompt();
 */

// ─── Fullscreen + Orientation Lock ─────────────────────────────────────────

/**
 * Request fullscreen (removes browser chrome) and lock orientation to landscape.
 * Must be called inside a user-gesture (e.g. button click).
 */
export function enterGameFullscreen() {
    const el = document.documentElement;

    // 1. Fullscreen API
    const req = el.requestFullscreen
        || el.webkitRequestFullscreen
        || el.mozRequestFullScreen
        || el.msRequestFullscreen;
    if (req) {
        req.call(el).catch(() => { /* not granted — ok */ });
    }

    // 2. Screen Orientation Lock (forces landscape at OS level)
    if (screen.orientation && screen.orientation.lock) {
        screen.orientation.lock('landscape').catch(() => { /* not supported — ok */ });
    }
}

/**
 * Exit fullscreen (e.g. if user navigates back to the landing page).
 */
export function exitFullscreen() {
    if (document.fullscreenElement) {
        (document.exitFullscreen
            || document.webkitExitFullscreen
            || document.mozCancelFullScreen
            || document.msExitFullscreen
            || (() => {})).call(document);
    }
    if (screen.orientation && screen.orientation.unlock) {
        screen.orientation.unlock();
    }
}

// ─── PWA Install Banner Manager ────────────────────────────────────────────

/** Captures and holds the browser's before-install-prompt event. */
class PWAInstallManager {
    constructor() {
        this._deferredPrompt = null;
        this._bannerShown = false;
        this._listeners = [];

        window.addEventListener('beforeinstallprompt', (e) => {
            e.preventDefault();
            this._deferredPrompt = e;
            this._listeners.forEach(fn => fn());
        });

        window.addEventListener('appinstalled', () => {
            this._deferredPrompt = null;
            this._bannerShown = true;
        });
    }

    /** Returns true if the browser can offer an install prompt. */
    get canInstall() {
        return !!this._deferredPrompt && !this._bannerShown;
    }

    /** Register a callback for when the install event becomes available. */
    onAvailable(fn) {
        this._listeners.push(fn);
        if (this._deferredPrompt) fn(); // already available
    }

    /**
     * Show the native browser install banner.
     * This must be called inside a user gesture.
     */
    async showPrompt() {
        if (!this._deferredPrompt) return false;
        this._deferredPrompt.prompt();
        const { outcome } = await this._deferredPrompt.userChoice;
        this._deferredPrompt = null;
        return outcome === 'accepted';
    }
}

export const pwaInstallManager = new PWAInstallManager();
