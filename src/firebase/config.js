import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  signInAnonymously, 
  onAuthStateChanged, 
  GoogleAuthProvider, 
  signInWithPopup,
  signOut
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
    firebaseEnabled = true;
  }
} catch (e) {
  console.warn('Firebase initialization failed. Running in offline mode only.', e);
}

// Google Auth Provider
const googleProvider = new GoogleAuthProvider();

/**
 * Save/Update player data in Firestore
 */
async function savePlayerProfile(user) {
  if (!firebaseEnabled || !user) return;
  const userRef = doc(firestore, 'players', user.uid);
  const snap = await getDoc(userRef);
  
  if (!snap.exists()) {
    await setDoc(userRef, {
      uid: user.uid,
      displayName: user.displayName || 'Survivor',
      photoURL: user.photoURL || '',
      level: 1,
      xp: 0,
      kills: 0,
      wins: 0,
      createdAt: serverTimestamp(),
      lastSeen: serverTimestamp()
    });
  } else {
    await updateDoc(userRef, {
      lastSeen: serverTimestamp()
    });
  }
}

export { app, auth, firestore, firebaseEnabled, googleProvider, savePlayerProfile };
export {
  signInAnonymously, onAuthStateChanged, signInWithPopup, signOut,
  doc, getDoc, setDoc, updateDoc, increment, serverTimestamp
};
