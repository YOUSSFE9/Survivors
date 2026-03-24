import { initializeApp } from 'firebase/app';
import {
    getAuth,
    signInAnonymously, onAuthStateChanged,
    GoogleAuthProvider,
    signInWithPopup, signInWithRedirect, getRedirectResult,
    signOut, browserLocalPersistence, setPersistence
} from 'firebase/auth';
import { getFirestore, doc, getDoc, setDoc, updateDoc, increment, serverTimestamp } from 'firebase/firestore';

const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
    measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID
};

let app, auth, firestore;
let firebaseEnabled = false;

try {
    if (import.meta.env.VITE_FIREBASE_API_KEY) {
        app = initializeApp(firebaseConfig);
        auth = getAuth(app);
        firestore = getFirestore(app);
        // Force persistent session (survives tab close)
        setPersistence(auth, browserLocalPersistence).catch(() => {});
        firebaseEnabled = true;
    }
} catch (e) {
    console.warn('Firebase init failed. Offline only.', e);
}

// Detect mobile
export function isMobile() {
    return /Android|iPhone|iPad|iPod|Opera Mini|IEMobile|WPDesktop/i.test(navigator.userAgent);
}

const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

/**
 * Sign in with Google — tries popup first (works on desktop & many mobiles).
 * If popup fails (blocked by mobile browser), falls back to redirect.
 */
export async function signInWithGoogle() {
    if (!auth) return null;
    try {
        // Try popup first — works on desktop and many mobile browsers
        const result = await signInWithPopup(auth, googleProvider);
        return result;
    } catch (e) {
        console.warn('Popup failed, trying redirect...', e.code);
        // Fallback to redirect (mobile browsers that block popups)
        try {
            await signInWithRedirect(auth, googleProvider);
        } catch (redirectErr) {
            console.error('Redirect also failed:', redirectErr);
        }
        return null;
    }
}

/**
 * Handle redirect result after mobile auth. Call on app start.
 */
export async function handleAuthRedirect() {
    if (!auth) return null;
    try {
        const result = await getRedirectResult(auth);
        if (result?.user) {
            await savePlayerProfile(result.user);
        }
        return result;
    } catch (e) {
        console.warn('Redirect auth error:', e);
        return null;
    }
}

/**
 * Save or update player profile in Firestore.
 */
export async function savePlayerProfile(user) {
    if (!firebaseEnabled || !user || !firestore) return;
    try {
        const ref = doc(firestore, 'players', user.uid);
        const snap = await getDoc(ref);
        if (!snap.exists()) {
            await setDoc(ref, {
                uid: user.uid,
                displayName: user.displayName || 'Survivor',
                photoURL: user.photoURL || '',
                level: 1, xp: 0, kills: 0, wins: 0,
                createdAt: serverTimestamp(),
                lastSeen: serverTimestamp(),
            });
        } else {
            await updateDoc(ref, { lastSeen: serverTimestamp() });
        }
    } catch (e) {
        console.warn('Firestore write error:', e);
    }
}

export { app, auth, firestore, firebaseEnabled, googleProvider };
export { signInAnonymously, onAuthStateChanged, signInWithPopup, signOut, doc, getDoc, setDoc, updateDoc, increment, serverTimestamp };
export { getFirestore };

// ═══════════════════════════════════════════
//  PRIZES ECONOMY — Gold Coins + Leaderboards
// ═══════════════════════════════════════════
import { collection, getDocs, query, orderBy, limit, writeBatch, where } from 'firebase/firestore';
export { collection, getDocs, query, orderBy, limit, writeBatch, where };

/** Returns today's UTC date string: "2026-03-24" */
export function getDailyKey() {
    return new Date().toISOString().slice(0, 10);
}

/** Get or initialise a player's daily stats doc */
export async function getDailyStats(uid, displayName, photoURL) {
    if (!firebaseEnabled || !firestore || !uid) return null;
    const day = getDailyKey();
    const ref = doc(firestore, 'daily_stats', `${uid}_${day}`);
    try {
        const snap = await getDoc(ref);
        if (!snap.exists()) {
            const fresh = { uid, displayName: displayName || 'Survivor', photoURL: photoURL || '', day, monsterKills: 0, portalsOpened: 0, keysCollected: 0 };
            await setDoc(ref, fresh);
            return fresh;
        }
        return snap.data();
    } catch (e) { console.warn('[Prizes] getDailyStats error', e); return null; }
}

/** Increment a daily stat field and check if player earns gold */
export async function incrementDailyStat(uid, field, amount = 1) {
    if (!firebaseEnabled || !firestore || !uid) return;
    const day = getDailyKey();
    const ref = doc(firestore, 'daily_stats', `${uid}_${day}`);
    try {
        await updateDoc(ref, { [field]: increment(amount) });
    } catch {
        // Doc may not exist yet — create it first
        await getDailyStats(uid, '', '');
        await updateDoc(ref, { [field]: increment(amount) });
    }
}

/** Add gold coins to a player's permanent balance */
export async function addGoldCoins(uid, amount) {
    if (!firebaseEnabled || !firestore || !uid || amount <= 0) return;
    const ref = doc(firestore, 'players', uid);
    try {
        await updateDoc(ref, { goldCoins: increment(amount), [`goldHistory.${getDailyKey()}`]: increment(amount) });
    } catch (e) { console.warn('[Prizes] addGoldCoins error', e); }
}

/** Fetch leaderboard data for today */
export async function fetchLeaderboard(rankType) {
    if (!firebaseEnabled || !firestore) return [];
    const day = getDailyKey();
    // rankType: 'monsterKills' | 'portalsOpened'
    const secondary = rankType === 'portalsOpened' ? 'keysCollected' : null;
    try {
        const q = query(
            collection(firestore, 'daily_stats'),
            where('day', '==', day),
            orderBy(rankType, 'desc'),
            ...(secondary ? [orderBy(secondary, 'desc')] : []),
            limit(20)
        );
        const snap = await getDocs(q);
        return snap.docs.map((d, i) => ({ rank: i + 1, ...d.data() }));
    } catch (e) {
        console.warn('[Prizes] fetchLeaderboard error', e);
        return [];
    }
}

/** Get a player's total gold coin balance */
export async function getGoldBalance(uid) {
    if (!firebaseEnabled || !firestore || !uid) return 0;
    try {
        const snap = await getDoc(doc(firestore, 'players', uid));
        return snap.data()?.goldCoins || 0;
    } catch { return 0; }
}

/** Award gold to the daily top killer/survivor (called from server or post-game) */
export async function awardDailyWinner(uid, coinsAmount, reason) {
    if (!uid) return;
    await addGoldCoins(uid, coinsAmount);
    // Log the award
    if (firebaseEnabled && firestore) {
        const day = getDailyKey();
        const ref = doc(firestore, 'daily_awards', `${uid}_${day}_${reason}`);
        await setDoc(ref, { uid, day, reason, coins: coinsAmount, awardedAt: serverTimestamp() }, { merge: true });
    }
}
