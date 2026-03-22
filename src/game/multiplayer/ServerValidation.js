/**
 * ServerValidation — Calls Firebase Cloud Functions for server-side validation.
 * Validates coin transactions and key collection to prevent cheating.
 */

const FUNCTIONS_BASE_URL = import.meta.env.VITE_FIREBASE_FUNCTIONS_URL || '';

export class ServerValidation {
    constructor(uid) {
        this.uid = uid;
    }

    async validateCoinTransaction(amount, reason) {
        if (!FUNCTIONS_BASE_URL) {
            // Offline mode — trust client
            return { success: true, newBalance: null };
        }

        try {
            const response = await fetch(`${FUNCTIONS_BASE_URL}/validateCoins`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    uid: this.uid,
                    amount,
                    reason, // 'player_kill' | 'ai_kill_10' | 'death'
                }),
            });
            return await response.json();
        } catch (e) {
            console.warn('Server validation failed, using client-side:', e);
            return { success: true, newBalance: null };
        }
    }

    async validateKeyCollection(keyId, roomId) {
        if (!FUNCTIONS_BASE_URL) {
            return { success: true };
        }

        try {
            const response = await fetch(`${FUNCTIONS_BASE_URL}/validateKey`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    uid: this.uid,
                    keyId,
                    roomId,
                }),
            });
            return await response.json();
        } catch (e) {
            console.warn('Key validation failed, using client-side:', e);
            return { success: true };
        }
    }
}

/*
 * ============================================================
 * Cloud Function stubs (deploy to Firebase Cloud Functions):
 * ============================================================
 *
 * // functions/index.js
 *
 * const functions = require('firebase-functions');
 * const admin = require('firebase-admin');
 * admin.initializeApp();
 *
 * exports.validateCoins = functions.https.onRequest(async (req, res) => {
 *   const { uid, amount, reason } = req.body;
 *
 *   // Validate reason
 *   const validReasons = {
 *     'player_kill': 1,
 *     'ai_kill_10': 1,
 *     'death': -10,
 *   };
 *
 *   if (!validReasons[reason] || validReasons[reason] !== amount) {
 *     return res.status(400).json({ success: false, error: 'Invalid transaction' });
 *   }
 *
 *   const userRef = admin.firestore().doc(`users/${uid}`);
 *   const doc = await userRef.get();
 *   let coins = doc.exists ? doc.data().coins || 0 : 0;
 *   coins = Math.max(0, coins + amount);
 *
 *   await userRef.set({ coins }, { merge: true });
 *   return res.json({ success: true, newBalance: coins });
 * });
 *
 * exports.validateKey = functions.https.onRequest(async (req, res) => {
 *   const { uid, keyId, roomId } = req.body;
 *   const keyRef = admin.database().ref(`rooms/${roomId}/keys/${keyId}`);
 *   const snap = await keyRef.get();
 *
 *   if (snap.exists() && snap.val().collectedBy) {
 *     return res.status(400).json({ success: false, error: 'Key already collected' });
 *   }
 *
 *   await keyRef.set({ collectedBy: uid, ts: Date.now() });
 *   return res.json({ success: true });
 * });
 */
