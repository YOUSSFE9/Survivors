import { useState, useEffect, useCallback, useMemo } from 'react';
import {
    auth, firebaseEnabled, savePlayerProfile,
    onAuthStateChanged, signInWithGoogle, handleAuthRedirect, signOut
} from '../firebase/config';
import { enterGameFullscreen } from '../utils/mobileUtils';
import DuelLobby from './DuelLobby';
import SquadLobby from './SquadLobby';
import WarLobby from './WarLobby';
import SettingsModal from './SettingsModal';
import PrizesModal from './PrizesModal';
import T from '../i18n/translations';
import './LandingPage.css';

const AD_LINK = 'https://www.profitablecpmratenetwork.com/p2ybm20z?key=8fe9acbc0946c1a99e52506c962ae649';

export default function LandingPage({ onStartGame, lang, setLang }) {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(() => !!(firebaseEnabled && auth));
    const [lobbyMode, setLobbyMode] = useState(null); // 'duel' | 'squad' | 'war' | null
    const [status, setStatus] = useState('');
    const [showPrizes, setShowPrizes] = useState(false);

    // Ad tracking states
    const [adStep, setAdStep] = useState(() => parseInt(localStorage.getItem('daht_ad_step') || '1'));
    const [adTimer, setAdTimer] = useState(() => parseInt(localStorage.getItem('daht_ad_timer') || '0'));
    const [adWaiting, setAdWaiting] = useState(() => localStorage.getItem('daht_ad_waiting') === 'true');

    const t = T[lang] || T['ar'];

    const stars = useMemo(() => {
        const seeded = (n) => {
            const v = Math.sin(n * 12.9898) * 43758.5453;
            return v - Math.floor(v);
        };
        return Array.from({ length: 120 }, (_, i) => ({
            id: i,
            x: seeded(i + 1) * 100,
            y: seeded(i + 101) * 100,
            size: seeded(i + 201) * 2.5 + 0.5,
            duration: seeded(i + 301) * 3 + 2,
            delay: seeded(i + 401) * 5,
            opacity: seeded(i + 501) * 0.5 + 0.3,
        }));
    }, []);

    // Handle mobile redirect result + watch auth state
    useEffect(() => {
        if (!firebaseEnabled || !auth) return;
        let mounted = true;
        // Handle redirect result (mobile Google auth)
        handleAuthRedirect()
            .finally(() => { if (mounted) setLoading(false); });

        const unsub = onAuthStateChanged(auth, async (u) => {
            setUser(u);
            if (mounted) setLoading(false);
            if (u) {
                await savePlayerProfile(u);
                // Save to localStorage so App.jsx can detect admin without prop drilling
                localStorage.setItem('daht_current_user', JSON.stringify({
                    uid: u.uid,
                    email: u.email,
                    displayName: u.displayName,
                    photoURL: u.photoURL,
                }));
            } else {
                localStorage.removeItem('daht_current_user');
            }
        });
        return () => {
            mounted = false;
            unsub();
        };
    }, []);

    // Ad timer effect (only ticks when page does not have focus, i.e. user is on the Ad tab)
    useEffect(() => {
        let intervalId;
        if (adWaiting && adTimer > 0) {
            let lastTick = Date.now();
            intervalId = setInterval(() => {
                const now = Date.now();
                const elapsedSecs = Math.floor((now - lastTick) / 1000);
                
                if (elapsedSecs >= 1) {
                    // Only count time if user is NOT looking at this tab
                    if (!document.hasFocus() || document.hidden) {
                        setAdTimer(prev => {
                            const next = Math.max(0, prev - elapsedSecs);
                            localStorage.setItem('daht_ad_timer', next.toString());
                            return next;
                        });
                    }
                    lastTick += elapsedSecs * 1000;
                }
            }, 500);
        } else if (adWaiting && adTimer === 0) {
            localStorage.setItem('daht_ad_timer', '0');
        }

        return () => clearInterval(intervalId);
    }, [adWaiting, adTimer]);

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
        if (user) {
            onStartGame('offline', {
                prizeUid: user.uid,
                prizeName: user.displayName,
                prizePhoto: user.photoURL
            });
        } else {
            onStartGame('offline');
        }
    };

    const handleOfflineAction = () => {
        if (adStep === 1 || adStep === 2) {
            const next = adStep === 1 ? 2 : 3;
            setAdStep(next);
            localStorage.setItem('daht_ad_step', next.toString());
            handlePlayOffline();
        } else if (adStep === 3) {
            if (!adWaiting) {
                // First click -> open ad, start wait
                window.open(AD_LINK, '_blank');
                setAdWaiting(true);
                setAdTimer(10);
                localStorage.setItem('daht_ad_waiting', 'true');
                localStorage.setItem('daht_ad_timer', '10');
            } else if (adTimer > 0) {
                // Clicked while waiting -> open ad again
                window.open(AD_LINK, '_blank');
            } else {
                // Done waiting -> play
                setAdWaiting(false);
                setAdStep(1);
                localStorage.setItem('daht_ad_waiting', 'false');
                localStorage.setItem('daht_ad_step', '1');
                handlePlayOffline();
            }
        }
    };

    const btnOfflineLabel = () => {
        if (adStep === 1 || adStep === 2) {
            return `${t.playOffline} (${adStep})`;
        }
        if (adStep === 3) {
            if (adWaiting && adTimer > 0) return t.adWait?.replace('{s}', adTimer) || `Wait ${adTimer}s...`;
            if (adWaiting && adTimer === 0) return t.adReady || 'Play Now';
            return t.adWatchBtn || 'Watch Ad to Play';
        }
        return t.playOffline;
    };

    const handlePlayOnlineWrapped = (m) => {
        if (!user) {
            setStatus(t.googleLoginRequired);
            setTimeout(() => setStatus(''), 4000);
            return;
        }
        window.open(AD_LINK, '_blank');
        handlePlayOnline(m);
    };

    const handlePlayOnline = (m) => {
        enterGameFullscreen();
        setLobbyMode(m);
    };

    const lobbyProps = {
        uid: user?.uid || 'guest_local',
        playerName: user?.displayName || `${t.survivorPrefix || 'Survivor'}_Guest`,
        avatarUrl: user?.photoURL || '',
        onMatchFound: ({ mode, roomId, mazeSeed, mazeGrid, trapPositions }) =>
            onStartGame('online', { onlineMode: mode, roomId, mazeSeed, mazeGrid, trapPositions }),
        onBack: () => setLobbyMode(null),
        t
    };

    if (lobbyMode === 'duel')  return <DuelLobby  {...lobbyProps} />;
    if (lobbyMode === 'squad') return <SquadLobby {...lobbyProps} />;
    if (lobbyMode === 'war')   return <WarLobby   {...lobbyProps} />;

    return (
        <div className="landing-page">
            {/* Settings Gear Button */}
            <SettingsModal lang={lang} onLangChange={setLang} />

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
                    <div className="title-icon" style={{ marginBottom: 10 }}>
                        <div style={{ fontSize: 72, textShadow: '0 0 20px rgba(68, 255, 170, 0.5)' }}>🛡️</div>
                    </div>
                    <h1 className="game-title" style={{ fontSize: 56, color: '#fff', textShadow: '0 0 20px rgba(255,255,255,0.4)', margin: '10px 0', fontFamily: 'system-ui, sans-serif' }}>
                        {t.gameTitle}
                    </h1>
                    <p className="game-subtitle" style={{ fontSize: 18, color: '#44ffaa', fontWeight: 'bold' }}>{t.gameSubtitle}</p>
                </div>

                {/* Google Sign-In / User Profile */}
                {firebaseEnabled && (
                    <div className="auth-section">
                        {user ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
                                {/* Prizes Button */}
                                <button
                                    onClick={() => setShowPrizes(true)}
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: 8,
                                        padding: '9px 20px', borderRadius: 12,
                                        border: '1px solid rgba(255,215,0,0.4)',
                                        background: 'linear-gradient(135deg,rgba(255,215,0,0.12),rgba(255,165,0,0.08))',
                                        color: '#ffd700', fontWeight: 800, fontSize: 14,
                                        cursor: 'pointer', width: '100%', justifyContent: 'center',
                                        boxShadow: '0 0 20px rgba(255,215,0,0.15)',
                                        animation: 'prizePulse 2.5s ease-in-out infinite',
                                    }}
                                    id="btn-prizes"
                                >
                                    🏆 {t.prizesTitle}
                                </button>
                                <div className="user-profile" style={{ width: '100%', boxSizing: 'border-box', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.08)', padding: '10px 15px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.1)' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                        {user.photoURL && (
                                            <img src={user.photoURL} alt="avatar" className="user-avatar" style={{ width: 36, height: 36, borderRadius: '50%' }} />
                                        )}
                                        <span className="user-name" style={{ color: '#fff', fontWeight: 'bold', fontSize: 13 }}>👋 {user.displayName || t.you}</span>
                                    </div>
                                    <button className="btn-signout" onClick={handleSignOut} style={{ background: 'rgba(255,68,68,0.2)', border: '1px solid rgba(255,68,68,0.5)', color: '#ff4444', padding: '6px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 'bold' }}>{t.signOut}</button>
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
                                {loading ? t.connecting : t.signInToPlay}
                            </button>
                        )}
                    </div>
                )}

                {/* Game mode buttons */}
                <div className="button-group main-modes">
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, width: '100%' }}>
                        <button
                            className="btn btn-offline"
                            onClick={handleOfflineAction}
                            id="btn-play-offline"
                            style={adWaiting && adTimer > 0 ? { filter: 'grayscale(0.5)', opacity: 0.8 } : {}}
                        >
                            <div className="btn-icon">🕹️</div>
                            <div className="btn-text">
                                <div className="btn-label">{btnOfflineLabel()}</div>
                                <div className="btn-desc">{t.surviveWaves}</div>
                            </div>
                        </button>
                        <div className="ad-message" style={{ fontSize: 11, color: '#aaa', textAlign: 'center', maxWidth: 400, lineHeight: 1.5, padding: '0 20px' }}>
                            {t.adMessage}
                        </div>
                    </div>

                    <div className="online-modes-grid">
                        <button className="btn btn-online btn-duel" onClick={() => handlePlayOnlineWrapped('duel')}>
                            <div className="btn-icon">⚔️</div>
                            <div className="btn-text">
                                <div className="btn-label">{t.duel}</div>
                                <div className="btn-desc">{t.duelSub}</div>
                            </div>
                        </button>
                        <button className="btn btn-online btn-squad" onClick={() => handlePlayOnlineWrapped('squad')}>
                            <div className="btn-icon">🛡️</div>
                            <div className="btn-text">
                                <div className="btn-label">{t.squad}</div>
                                <div className="btn-desc">{t.squadSub}</div>
                            </div>
                        </button>
                        <button className="btn btn-online btn-war" onClick={() => handlePlayOnlineWrapped('war')}>
                            <div className="btn-icon">💀</div>
                            <div className="btn-text">
                                <div className="btn-label">{t.war}</div>
                                <div className="btn-desc">{t.warSub}</div>
                            </div>
                        </button>
                    </div>
                </div>

                {/* Status */}
                <div className="status-bar">
                    {status ? (
                        <p className="status-text" style={{ color: '#ffaa33' }}>{status}</p>
                    ) : user ? (
                        <p className="status-text connected">
                            <span className="status-dot" /> {t.connectedAs} <strong>{user.displayName || t.you}</strong>
                        </p>
                    ) : (
                        <p className="status-text">
                            {firebaseEnabled ? t.signInToPlay : t.offlineOnly}
                        </p>
                    )}
                </div>
            </div>

            {/* Prizes Modal */}
            {showPrizes && (
                <PrizesModal user={user} lang={lang} onClose={() => setShowPrizes(false)} />
            )}
        </div>
    );
}
