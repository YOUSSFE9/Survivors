import { initializeApp } from 'firebase/app';
import {
    getAuth,
    signInAnonymously, onAuthStateChanged,
    GoogleAuthProvider,
    signInWithPopup, signInWithRedirect, getRedirectResult,
    signOut, browserLocalPersistence, setPersistence
} from 'firebase/auth';
import { getFirestore, doc, getDoc, setDoc, updateDoc, increment, serverTimestamp, runTransaction } from 'firebase/firestore';

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
        
        let countryCode = 'UN';
        
        if (!snap.exists()) {
            try {
                const res = await fetch('https://api.country.is/');
                const data = await res.json();
                if (data.country) countryCode = data.country;
            } catch (e) { console.warn('Could not fetch country', e); }
            
            localStorage.setItem('daht_player_country', countryCode);

            await setDoc(ref, {
                uid: user.uid,
                displayName: user.displayName || 'Survivor',
                photoURL: user.photoURL || '',
                country: countryCode,
                level: 1, xp: 0, kills: 0, wins: 0,
                createdAt: serverTimestamp(),
                lastSeen: serverTimestamp(),
            });
        } else {
            const data = snap.data();
            countryCode = data.country || 'UN';
            
            // If old profile lacking country, try to update it once
            if (countryCode === 'UN') {
                try {
                    const res = await fetch('https://api.country.is/');
                    const ipData = await res.json();
                    if (ipData.country) {
                        countryCode = ipData.country;
                        await updateDoc(ref, { country: countryCode });
                    }
                } catch {
                    // Keep existing fallback country if IP lookup fails.
                }
            }
            
            localStorage.setItem('daht_player_country', countryCode);
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

export const COINS_PER_USD = 10;
export const MIN_WITHDRAW_COINS = 100;

/** Returns today's UTC date string: "2026-03-24" */
export function getDailyKey() {
    return new Date().toISOString().slice(0, 10);
}

/** Get or initialise a player's daily stats doc */
export async function getDailyStats(uid, displayName, photoURL) {
    if (!firebaseEnabled || !firestore || !uid) return null;
    const day = getDailyKey();
    const ref = doc(firestore, 'daily_stats', `${uid}_${day}`);
    
    // Retrieve country cached during login
    const country = localStorage.getItem('daht_player_country') || 'UN';

    try {
        const snap = await getDoc(ref);
        if (!snap.exists()) {
            const fresh = { 
                uid, 
                displayName: displayName || 'Survivor', 
                photoURL: photoURL || '', 
                country,
                day, 
                monsterKills: 0, 
                portalsOpened: 0, 
                keysCollected: 0 
            };
            await setDoc(ref, fresh);
            return fresh;
        }
        
        const data = snap.data();
        // Propagate country to old stats if missing
        if (!data.country && country !== 'UN') {
            await updateDoc(ref, { country });
        }
        
        return data;
    } catch (e) { console.warn('[Prizes] getDailyStats error', e); return null; }
}

/** Increment a daily stat field and check if player earns gold */
export async function incrementDailyStat(uid, field, amount = 1) {
    // STRICT ANTI-CHEAT: Abandon score if the user plays offline (preventing ad-dodging score farming)
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
        console.warn('Offline Detected: Discarding analytics to prevent ad evasion.');
        return;
    }
    
    if (!firebaseEnabled || !firestore || !uid) return;
    const day = getDailyKey();
    const ref = doc(firestore, 'daily_stats', `${uid}_${day}`);
    try {
        await updateDoc(ref, { [field]: increment(amount) });
    } catch {
        // Doc may not exist yet — create it first
        await getDailyStats(uid, '', '');
        try {
            await updateDoc(ref, { [field]: increment(amount) });
        } catch {
            // If this still fails, keep gameplay flow and skip stat increment.
        }
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
            limit(100)
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

// ═══════════════════════════════════════════
//  WITHDRAWAL REQUESTS — run checks at submit time only
// ═══════════════════════════════════════════

/** Collect IP / geo location layers — called ONLY when player submits withdrawal */
async function _collectLocationLayers() {
    const layers = [];

    // Layer 1: api.country.is
    try {
        const r = await fetch('https://api.country.is/');
        const d = await r.json();
        layers.push({ name: 'api.country.is', ip: d.ip || '?', country: d.country || '?', ok: !!d.country });
    } catch { layers.push({ name: 'api.country.is', ip: '?', country: '?', ok: false, error: 'failed' }); }

    // Layer 2: ipapi.co
    try {
        const r = await fetch('https://ipapi.co/json/');
        const d = await r.json();
        layers.push({ name: 'ipapi.co', ip: d.ip || '?', country: d.country_code || '?', city: d.city || '?', timezone: d.timezone || '?', org: d.org || '?', ok: !d.error });
    } catch { layers.push({ name: 'ipapi.co', ip: '?', country: '?', ok: false, error: 'failed' }); }

    // Layer 3: Browser timezone vs country consistency
    try {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        let tzCountry = '?';
        // Simple timezone→country map for common cases
        const tzMap = {
            'Africa/Casablanca': 'MA', 'Africa/Algiers': 'DZ', 'Africa/Tripoli': 'LY',
            'Africa/Cairo': 'EG', 'Asia/Riyadh': 'SA', 'Asia/Dubai': 'AE',
            'Asia/Baghdad': 'IQ', 'Asia/Kuwait': 'KW', 'Asia/Qatar': 'QA',
            'Asia/Bahrain': 'BH', 'Asia/Muscat': 'OM', 'Asia/Aden': 'YE',
            'Asia/Amman': 'JO', 'Asia/Beirut': 'LB', 'Asia/Damascus': 'SY',
            'Africa/Tunis': 'TN', 'Europe/Paris': 'FR', 'America/New_York': 'US',
            'America/Los_Angeles': 'US', 'Europe/London': 'GB', 'Asia/Istanbul': 'TR',
            'Europe/Berlin': 'DE', 'Asia/Tehran': 'IR', 'Africa/Khartoum': 'SD',
            'Africa/Mogadishu': 'SO', 'Africa/Nouakchott': 'MR',
        };
        tzCountry = tzMap[tz] || '?';
        const l1Country = layers[0]?.country || '?';
        const match = tzCountry === '?' || l1Country === '?' ? null : (tzCountry === l1Country);
        layers.push({ name: 'Timezone Check', timezone: tz, tzCountry, ipCountry: l1Country, ok: match !== false, suspicious: match === false });
    } catch { layers.push({ name: 'Timezone Check', ok: false, error: 'failed' }); }

    // Layer 4: VPN/Proxy check via vpnapi.io (free tier)
    try {
        let ip = '';
        if (layers[1] && layers[1].ip && layers[1].ip !== '?') {
            ip = layers[1].ip;
        } else if (layers[0] && layers[0].ip && layers[0].ip !== '?') {
            ip = layers[0].ip;
        }

        if (ip) {
            const r = await fetch(`https://vpnapi.io/api/${ip}?key=free`);
            const d = await r.json();
            const isVpn = d.security?.vpn || d.security?.proxy || d.security?.tor || false;
            layers.push({ 
                name: 'VPN/Proxy Check (vpnapi.io)', ip, 
                vpn: d.security?.vpn || false, 
                proxy: d.security?.proxy || false, 
                tor: d.security?.tor || false, 
                ok: !isVpn, suspicious: isVpn 
            });
        } else {
            layers.push({ name: 'VPN/Proxy Check (vpnapi.io)', ok: null, error: 'no_ip' });
        }
    } catch { layers.push({ name: 'VPN/Proxy Check (vpnapi.io)', ok: null, error: 'failed' }); }

    // Layer 5: User agent
    try {
        const ua = navigator.userAgent;
        const isBotUA = /bot|crawl|spider|headless|phantom|selenium|puppeteer/i.test(ua);
        layers.push({ name: 'User-Agent', ua, ok: !isBotUA, suspicious: isBotUA });
    } catch { layers.push({ name: 'User-Agent', ok: false }); }

    return layers;
}

/**
 * Submit a withdrawal request with location verification.
 * IP/location checks run HERE, at submission time only.
 */
export async function submitWithdrawalRequest({ uid, displayName, name, whatsapp, email, method, goldAmount }) {
    if (!firebaseEnabled || !firestore || !uid) return { ok: false, error: 'not_authenticated' };

    const amount = Math.floor(Number(goldAmount));
    if (!Number.isFinite(amount) || amount < MIN_WITHDRAW_COINS) {
        return { ok: false, error: 'amount_below_minimum' };
    }
    if (!name?.trim() || !whatsapp?.trim() || !email?.trim() || !method?.trim()) {
        return { ok: false, error: 'missing_required_fields' };
    }

    // Run location checks at request time
    const locationLayers = await _collectLocationLayers();

    const payload = {
        uid,
        displayName: (displayName || 'Survivor').trim(),
        name: name.trim(),
        whatsapp: whatsapp.trim(),
        email: email.trim(),
        method: method.trim(),
        goldAmount: amount,
        usdAmount: Number((amount / COINS_PER_USD).toFixed(2)),
        status: 'pending',
        createdAt: serverTimestamp(),
        locationLayers,
        userAgent: navigator.userAgent,
    };

    try {
        const id = `${uid}_${Date.now()}`;
        const playerRef = doc(firestore, 'players', uid);
        const requestRef = doc(firestore, 'withdrawal_requests', id);

        await runTransaction(firestore, async (tx) => {
            const playerSnap = await tx.get(playerRef);
            const currentBalance = Math.max(0, Math.floor(Number(playerSnap.data()?.goldCoins || 0)));
            if (currentBalance < amount) {
                throw new Error('insufficient_balance');
            }

            tx.set(playerRef, {
                goldCoins: currentBalance - amount,
                lastWithdrawalAt: serverTimestamp(),
            }, { merge: true });

            tx.set(requestRef, payload);
        });

        return { ok: true };
    } catch (e) {
        console.warn('submitWithdrawalRequest error', e);
        return { ok: false, error: e.message };
    }
}

/** Fetch all withdrawal requests (admin only — enforced by Firestore Rules) */
export async function fetchWithdrawalRequests() {
    if (!firebaseEnabled || !firestore) return [];
    try {
        const { collection: col, getDocs: gds, query: q, orderBy: ob } = await import('firebase/firestore');
        const snap = await gds(q(col(firestore, 'withdrawal_requests'), ob('createdAt', 'desc')));
        return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (e) {
        console.warn('fetchWithdrawalRequests error', e);
        return [];
    }
}

/** Update status of a withdrawal request (admin only) */
export async function updateWithdrawalStatus(id, status) {
    if (!firebaseEnabled || !firestore) return;
    try {
        await updateDoc(doc(firestore, 'withdrawal_requests', id), { status, reviewedAt: serverTimestamp() });
    } catch (e) { console.warn('updateWithdrawalStatus error', e); }
}

/** Delete a withdrawal request (admin only) */
export async function deleteWithdrawalRequest(id) {
    if (!firebaseEnabled || !firestore) return;
    try {
        const { deleteDoc } = await import('firebase/firestore');
        await deleteDoc(doc(firestore, 'withdrawal_requests', id));
    } catch (e) { console.warn('deleteWithdrawalRequest error', e); }
}
