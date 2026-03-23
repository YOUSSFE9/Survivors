import { initializeApp } from 'firebase/app';
import {
    getAuth,
    signInAnonymously, onAuthStateChanged,
    GoogleAuthProvider,
    signInWithPopup, signInWithRedirect, getRedirectResult,
    signOut, browserLocalPersistence, setPersistence
} from 'firebase/auth';
import { getFirestore, doc, getDoc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';

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
 * Sign in with Google — uses redirect on mobile, popup on desktop.
 */
export async function signInWithGoogle() {
    if (!auth) return null;
    if (isMobile()) {
        await signInWithRedirect(auth, googleProvider);
        return null; // Page will reload, result handled in getRedirectResult
    }
    return await signInWithPopup(auth, googleProvider);
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
export { signInAnonymously, onAuthStateChanged, signInWithPopup, signOut, doc, getDoc };
