import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getDatabase, ref, set, onValue, onDisconnect, remove, get, update, push, serverTimestamp } from 'firebase/database';
import { getFirestore, doc, getDoc, setDoc, updateDoc, increment } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'demo-key',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'demo.firebaseapp.com',
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL || 'https://demo-default-rtdb.firebaseio.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'demo-project',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || 'demo.appspot.com',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '0',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '0',
};

let app, auth, db, firestore;
let firebaseEnabled = false;

try {
  if (import.meta.env.VITE_FIREBASE_API_KEY) {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getDatabase(app);
    firestore = getFirestore(app);
    firebaseEnabled = true;
  }
} catch (e) {
  console.warn('Firebase initialization failed. Running in offline mode only.', e);
}

export { app, auth, db, firestore, firebaseEnabled };
export {
  signInAnonymously, onAuthStateChanged,
  ref, set, onValue, onDisconnect, remove, get, update, push, serverTimestamp,
  doc, getDoc, setDoc, updateDoc, increment
};
