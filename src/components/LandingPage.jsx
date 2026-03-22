import { useState, useEffect, useCallback } from 'react';
import {
    auth, firebaseEnabled,
    signInAnonymously, onAuthStateChanged
} from '../firebase/config';
import { enterGameFullscreen } from '../utils/mobileUtils';
import OnlineLobby from './OnlineLobby';
import './LandingPage.css';

/**
 * LandingPage — Premium dark sci-fi themed landing with animated starfield.
 */
export default function LandingPage({ onStartGame }) {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(false);
    const [stars, setStars] = useState([]);
    const [showLobby, setShowLobby] = useState(false);

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

    // Auto sign-in anonymously
    useEffect(() => {
        if (!firebaseEnabled || !auth) return;
        const unsub = onAuthStateChanged(auth, (u) => {
            setUser(u);
        });
        return () => unsub();
    }, []);

    const handleSignIn = useCallback(async () => {
        if (!firebaseEnabled || !auth) {
            // Start offline directly
            onStartGame('offline');
            return;
        }
        setLoading(true);
        try {
            await signInAnonymously(auth);
        } catch (e) {
            console.error('Auth error:', e);
        }
        setLoading(false);
    }, [onStartGame]);

    const handlePlayOffline = () => {
        enterGameFullscreen(); // removes browser bars + locks landscape
        onStartGame('offline');
    };

    const handlePlayOnline = () => {
        enterGameFullscreen();
        // Show lobby directly — no need to wait for Firebase sign-in
        setShowLobby(true);
    };

    if (showLobby) {
        return (
            <OnlineLobby
                uid={user?.uid || `guest_${Date.now()}`}
                playerName={`Player_${Math.floor(Math.random() * 9999)}`}
                onMatchFound={({ mode, roomId }) => onStartGame('online', { onlineMode: mode, roomId })}
                onBack={() => setShowLobby(false)}
            />
        );
    }

    return (
        <div className="landing-page">
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

                {/* Game mode buttons */}
                <div className="button-group">
                    <button
                        className="btn btn-offline"
                        onClick={handlePlayOffline}
                        id="btn-play-offline"
                    >
                        <span className="btn-icon">🎮</span>
                        <span className="btn-text">
                            <span className="btn-label">PLAY OFFLINE</span>
                            <span className="btn-desc">Survive the waves</span>
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
                            <span className="btn-label">{loading ? 'CONNECTING...' : 'PLAY ONLINE'}</span>
                            <span className="btn-desc">PvPvE • Up to 20 players</span>
                        </span>
                    </button>
                </div>

                {/* Status */}
                <div className="status-bar">
                    {user ? (
                        <p className="status-text connected">
                            <span className="status-dot" /> Connected as Guest
                        </p>
                    ) : (
                        <p className="status-text">
                            {firebaseEnabled ? 'Sign in to play online' : 'Offline mode only'}
                        </p>
                    )}
                </div>

                {/* Info cards */}
                <div className="info-cards">
                    <div className="info-card">
                        <span className="card-icon">🔑</span>
                        <span className="card-text">Collect 10 keys to open the portal</span>
                    </div>
                    <div className="info-card">
                        <span className="card-icon">⚔️</span>
                        <span className="card-text">M4 Rifle & Bazooka weapons</span>
                    </div>
                    <div className="info-card">
                        <span className="card-icon">👾</span>
                        <span className="card-text">Zombies, Monsters & Ghosts</span>
                    </div>
                </div>

                {/* Controls hint */}
                <div className="controls-hint">
                    <span>WASD</span> Move &nbsp;|&nbsp;
                    <span>Mouse</span> Aim &nbsp;|&nbsp;
                    <span>Click</span> Shoot &nbsp;|&nbsp;
                    <span>1/2</span> Switch Weapon
                </div>
            </div>
        </div>
    );
}
