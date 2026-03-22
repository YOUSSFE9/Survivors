/**
 * EconomySystem — Manages in-game coin economy.
 * Kill player = +1 coin, Kill 10 AI = +1 coin, Death = -10 coins (min 0).
 */
import { firestore, firebaseEnabled, doc, getDoc, setDoc, updateDoc, increment } from '../../firebase/config';

export class EconomySystem {
    constructor() {
        this.coins = 0;
        this.aiKillCount = 0;
        this.uid = null;
    }

    setUser(uid) {
        this.uid = uid;
    }

    async loadCoins() {
        if (!firebaseEnabled || !this.uid) return this.coins;
        try {
            const docRef = doc(firestore, 'users', this.uid);
            const snap = await getDoc(docRef);
            if (snap.exists()) {
                this.coins = snap.data().coins || 0;
            } else {
                await setDoc(docRef, { coins: 0 });
                this.coins = 0;
            }
        } catch (e) {
            console.warn('Failed to load coins:', e);
        }
        return this.coins;
    }

    async addCoins(amount) {
        this.coins = Math.max(0, this.coins + amount);
        if (firebaseEnabled && this.uid) {
            try {
                const docRef = doc(firestore, 'users', this.uid);
                await updateDoc(docRef, { coins: increment(amount) });
            } catch (e) {
                console.warn('Failed to update coins:', e);
            }
        }
        return this.coins;
    }

    onPlayerKill() {
        return this.addCoins(1);
    }

    onAIKill() {
        this.aiKillCount++;
        if (this.aiKillCount >= 10) {
            this.aiKillCount = 0;
            return this.addCoins(1);
        }
        return Promise.resolve(this.coins);
    }

    onDeath() {
        return this.addCoins(-10);
    }

    getCoins() {
        return this.coins;
    }

    getAIKillProgress() {
        return this.aiKillCount;
    }
}
