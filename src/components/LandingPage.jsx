import { useState, useEffect, useCallback } from 'react';
import {
    auth, firebaseEnabled, savePlayerProfile,
    onAuthStateChanged, signInWithGoogle, handleAuthRedirect, signOut
} from '../firebase/config';
import { enterGameFullscreen } from '../utils/mobileUtils';
import OnlineLobby from './OnlineLobby';
import SettingsModal from './SettingsModal';
import T, { getSavedLang } from '../i18n/translations';
import './LandingPage.css';

export default function LandingPage({ onStartGame }) {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true); // start true to handle redirect
    const [stars, setStars] = useState([]);
    const [showLobby, setShowLobby] = useState(false);
    const [lang, setLang] = useState(getSavedLang());
    const [status, setStatus] = useState('');

    const t = T[lang] || T['ar'];

    // Generate starfield
    useEffect(() => {
        const s = [];
        for (let i = 0; i < 120; i++) {
            s.push({
                id: i,
                x: Math.random() * 100,
                y: Math.random() * 100,
                size: Math.random() * 2.5 + 0.5,
                duration: Math.random() * 3 + 2,
                delay: Math.random() * 5,
                opacity: Math.random() * 0.5 + 0.3,
            });
        }
        setStars(s);
    }, []);

    // Handle mobile redirect result + watch auth state
    useEffect(() => {
        if (!firebaseEnabled || !auth) {
            setLoading(false);
            return;
        }
        // Handle redirect result first (mobile Google auth)
        handleAuthRedirect().finally(() => setLoading(false));
        const unsub = onAuthStateChanged(auth, async (u) => {
            setUser(u);
            if (u) await savePlayerProfile(u);
        });
        return () => unsub();
    }, []);

    const handleGoogleSignIn = useCallback(async () => {
        if (!firebaseEnabled || !auth) return;
        setLoading(true);
        try {
            await signInWithGoogle(); // auto popup/redirect by device
        } catch (e) {
            console.error('Sign-in failed:', e);
        }
        setLoading(false);
    }, []);

    const handleSignOut = useCallback(async () => {
        if (!auth) return;
        await signOut(auth);
    }, []);

    const handlePlayOffline = () => {
        enterGameFullscreen();
        onStartGame('offline');
    };

    const handlePlayOnline = () => {
        if (!user) {
            setStatus('⚠️ يجب تسجيل الدخول بحساب Google للعب أونلاين');
            setTimeout(() => setStatus(''), 4000);
            return;
        }
        enterGameFullscreen();
        setShowLobby(true);
    };

    if (showLobby) {
        return (
            <OnlineLobby
                uid={user?.uid || `guest_${Date.now()}`}
                playerName={user?.displayName || `Player_${Math.floor(Math.random() * 9999)}`}
                avatarUrl={user?.photoURL || ''}
                onMatchFound={({ mode, roomId }) => onStartGame('online', { onlineMode: mode, roomId })}
                onBack={() => setShowLobby(false)}
            />
        );
    }

    return (
        <div className="landing-page">
            {/* Settings Gear Button */}
            <SettingsModal onLangChange={setLang} />

            {/* Animated starfield */}
            <div className="starfield">
                {stars.map((star) => (
                    <div
                        key={star.id}
                        className="star"
                        style={{
                            left: `${star.x}%`,
                            top: `${star.y}%`,
                            width: `${star.size}px`,
                            height: `${star.size}px`,
                            animationDuration: `${star.duration}s`,
                            animationDelay: `${star.delay}s`,
                            opacity: star.opacity,
                        }}
                    />
                ))}
            </div>

            {/* Floating particles */}
            <div className="particles">
                {[...Array(6)].map((_, i) => (
                    <div key={i} className="particle" style={{
                        left: `${15 + i * 14}%`,
                        animationDelay: `${i * 0.8}s`,
                    }} />
                ))}
            </div>

            {/* Content */}
            <div className="landing-content">
                {/* Logo / Title */}
                <div className="title-section">
                    <div className="title-icon">
                        <div className="station-ring ring-outer" />
                        <div className="station-ring ring-inner" />
                        <div className="station-core" />
                    </div>
                    <h1 className="game-title">
                        <span className="title-space">SPACE</span>
                        <span className="title-station">STATION</span>
                        <span className="title-maze">MAZE</span>
                    </h1>
                    <p className="game-subtitle">Top-Down Survival Shooter</p>
                </div>

                {/* Google Sign-In / User Profile */}
                {firebaseEnabled && (
                    <div className="auth-section">
                        {user ? (
                            <div className="user-profile">
                                {user.photoURL && (
                                    <img src={user.photoURL} alt="avatar" className="user-avatar" />
                                )}
                                <div className="user-info">
                                    <span className="user-name">👋 {user.displayName || 'Survivor'}</span>
                                    <button className="btn-signout" onClick={handleSignOut}>Sign Out</button>
                                </div>
                            </div>
                        ) : (
                            <button
                                className="btn-google"
                                onClick={handleGoogleSignIn}
                                disabled={loading}
                                id="btn-google-signin"
                            >
                                <svg width="18" height="18" viewBox="0 0 48 48" style={{ flexShrink: 0 }}>
                                    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                                    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                                    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                                    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
                                </svg>
                                {loading ? 'Connecting...' : 'Sign in with Google'}
                            </button>
                        )}
                    </div>
                )}

                {/* Game mode buttons */}
                <div className="button-group">
                    <button
                        className="btn btn-offline"
                        onClick={handlePlayOffline}
                        id="btn-play-offline"
                    >
                        <span className="btn-icon">🎮</span>
                        <span className="btn-text">
                            <span className="btn-label">{t.playOffline}</span>
                            <span className="btn-desc">{t.surviveWaves}</span>
                        </span>
                    </button>

                    <button
                        className="btn btn-online"
                        onClick={handlePlayOnline}
                        disabled={loading}
                        id="btn-play-online"
                    >
                        <span className="btn-icon">🌐</span>
                        <span className="btn-text">
                            <span className="btn-label">{loading ? t.connecting : t.playOnline}</span>
                            <span className="btn-desc">{t.pvpDesc}</span>
                        </span>
                    </button>
                </div>

                {/* Status */}
                <div className="status-bar">
                    {status ? (
                        <p className="status-text" style={{ color: '#ffaa33' }}>{status}</p>
                    ) : user ? (
                        <p className="status-text connected">
                            <span className="status-dot" /> Connected as <strong>{user.displayName || 'Survivor'}</strong>
                        </p>
                    ) : (
                        <p className="status-text">
                            {firebaseEnabled ? 'Sign in with Google to play online' : 'Offline mode only'}
                        </p>
                    )}
                </div>

                {/* Info cards */}
                <div className="info-cards">
                    <div className="info-card">
                        <span className="card-icon">🔑</span>
                        <span className="card-text">{t.collectKeys}</span>
                    </div>
                    <div className="info-card">
                        <span className="card-icon">⚔️</span>
                        <span className="card-text">{t.weapons}</span>
                    </div>
                    <div className="info-card">
                        <span className="card-icon">👾</span>
                        <span className="card-text">{t.enemies}</span>
                    </div>
                </div>

                {/* Controls hint */}
                <div className="controls-hint">
                    <span>WASD</span> {t.move}&nbsp;|&nbsp;
                    <span>Mouse</span> {t.aim}&nbsp;|&nbsp;
                    <span>Click</span> {t.shoot}&nbsp;|&nbsp;
                    <span>1/2</span> {t.switchWeapon}
                </div>
            </div>
        </div>
    );
}
