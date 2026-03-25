import React, { useState, useEffect, useCallback, useRef } from 'react';
import { network } from '../game/multiplayer/NetworkManager';

type DuelFlow = 'none' | 'random' | 'create' | 'join';
interface PEntry { name: string; team: string; sessionId: string; avatarUrl?: string }

interface Props {
    uid: string;
    playerName: string;
    avatarUrl?: string;
    onMatchFound: (info: { mode: string; roomId: string; mazeSeed?: number; mazeGrid?: any[]; trapPositions?: any[] }) => void;
    onBack: () => void;
    t: any;
}

export default function DuelLobby({ uid, playerName, avatarUrl = '', onBack, onMatchFound, t }: Props) {
    const [duelFlow, setDuelFlow] = useState<DuelFlow>('none');
    const [joinCode, setJoinCode] = useState('');
    const [status, setStatus] = useState('');
    const [busy, setBusy] = useState(false);
    const [waiting, setWaiting] = useState(false);
    const [players, setPlayers] = useState<PEntry[]>([]);
    const [roomCode, setRoomCode] = useState('');
    const [searchElapsed, setSearchElapsed] = useState(0);
    const searchTimerRef = useRef<any>(null);
    const [preview, setPreview] = useState<{ players: PEntry[]; countdown: number } | null>(null);
    const [gameOver, setGameOver] = useState<{ winner: string; winnerName?: string; killerName?: string; stats?: any } | null>(null);

    const listenRoom = useCallback((room: any) => {
        room.onMessage('lobby_players', (list: PEntry[]) => setPlayers(list));
        room.onMessage('match_preview', ({ players: pp, seconds }: any) => {
            if (searchTimerRef.current) { clearInterval(searchTimerRef.current); searchTimerRef.current = null; }
            setSearchElapsed(0);
            let t = seconds || 3;
            setPreview({ players: pp, countdown: t });
            const pTimer = setInterval(() => {
                t--;
                if (t <= 0) { clearInterval(pTimer); }
                else setPreview(prev => prev ? { ...prev, countdown: t } : null);
            }, 1000);
        });
        room.onMessage('game_started', (data: any) => {
            network.gameStartedData = data;
            if (searchTimerRef.current) { clearInterval(searchTimerRef.current); searchTimerRef.current = null; }
            setPreview(null);
            onMatchFound({ mode: 'duel', roomId: room.id, mazeSeed: data?.seed || 0, mazeGrid: data?.grid, trapPositions: data?.trapPositions });
        });
        room.onMessage('game_over', (data: any) => setGameOver(data));
    }, [onMatchFound]);

    const handleConnect = async (flow: DuelFlow) => {
        if (busy) return;
        setBusy(true);
        setStatus(t.connecting);
        try {
            network.connect();
            if (flow === 'random') {
                const room = await network.joinOrCreate('duel', { uid, name: playerName, avatarUrl });
                setStatus(t.searching);
                setWaiting(true); setBusy(false);
                listenRoom(room);
                let searchSec = 0; setSearchElapsed(0);
                searchTimerRef.current = setInterval(() => {
                    searchSec++; setSearchElapsed(searchSec);
                    if (searchSec >= 15) { clearInterval(searchTimerRef.current); searchTimerRef.current = null; }
                }, 1000);
            } else if (flow === 'create') {
                const { room, roomId: rid } = await network.createPrivateRoom('duel', { uid, name: playerName, avatarUrl });
                setRoomCode(rid); setStatus(t.lbWaitFriend);
                setWaiting(true); setBusy(false);
                listenRoom(room);
            } else if (flow === 'join') {
                const code = joinCode.trim();
                if (!code) { setStatus(t.enterCodeFirst); setBusy(false); return; }
                const room = await network.joinOrCreate('duel', { uid, name: playerName, avatarUrl, roomCode: code });
                setStatus(t.joined);
                setWaiting(true); setBusy(false);
                listenRoom(room);
            }
        } catch (e) {
            console.error('[DuelLobby]', e);
            setStatus(t.connError);
            setBusy(false);
        }
    };

    const handleLeave = async () => {
        if (searchTimerRef.current) clearInterval(searchTimerRef.current);
        await network.leave();
        setWaiting(false); setPlayers([]); setSearchElapsed(0);
        setRoomCode(''); setPreview(null); setGameOver(null);
        setStatus(''); setDuelFlow('none'); setBusy(false);
    };

    if (gameOver) {
        const isWin = gameOver.winner === uid || gameOver.winner === playerName || gameOver.winner === network.sessionId;
        let myKills = 0, myDeaths = 0;
        if (gameOver.stats && network.sessionId && gameOver.stats[network.sessionId]) {
            myKills = gameOver.stats[network.sessionId].kills || 0;
            const deathDetails = gameOver.stats[network.sessionId].deathDetails || {};
            myDeaths = Object.values(deathDetails).reduce((acc: any, val: any) => acc + val, 0) as number;
        }
        return (
            <div style={S.overlay}>
                <div style={{ ...S.card, textAlign: 'center', maxWidth: 420 }}>
                    <div style={{ fontSize: 64, marginBottom: 12 }}>{isWin ? '🏆' : '💀'}</div>
                    <h2 style={{ margin: '0 0 8px', fontSize: 28, color: isWin ? '#44ffaa' : '#ff4455' }}>{isWin ? t.lbYouWin : t.lbYouLose}</h2>
                    {gameOver.stats && (
                        <div style={S.statsBox}>
                            <div style={{ display: 'flex', justifyContent: 'space-around', alignItems: 'center' }}>
                                <div>
                                    <div style={S.statsLabel}>{t.lbKillsOpponent}</div>
                                    <div style={{ fontSize: 24, color: '#44ffaa', fontWeight: 'bold' }}>{myKills} <span style={{ fontSize: 14 }}>{t.lbTimes}</span></div>
                                </div>
                                <div style={{ width: 1, height: 40, background: 'rgba(255,255,255,0.1)' }} />
                                <div>
                                    <div style={S.statsLabel}>{t.lbDeathsOpponent}</div>
                                    <div style={{ fontSize: 24, color: '#ff4455', fontWeight: 'bold' }}>{myDeaths} <span style={{ fontSize: 14 }}>{t.lbTimes}</span></div>
                                </div>
                            </div>
                        </div>
                    )}
                    <button style={{ ...S.btn, background: '#1a3a5a', width: '100%' }} onClick={onBack}>← {t.back}</button>
                </div>
            </div>
        );
    }

    if (preview) {
        const [p1, p2] = preview.players ?? [];
        return (
            <div style={S.overlay}>
                <div style={{ ...S.card, textAlign: 'center', maxWidth: 420 }}>
                    <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', marginBottom: 16 }}>{t.lbOpponentFound}</div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 20, marginBottom: 24 }}>
                        <PlayerCard name={p1?.name || playerName} avatarUrl={p1?.avatarUrl} highlight />
                        <div style={{ fontSize: 28, color: '#ff4455', fontWeight: 900 }}>⚔️</div>
                        <PlayerCard name={p2?.name || '?'} avatarUrl={p2?.avatarUrl} />
                    </div>
                    <div style={{ fontSize: 42, fontWeight: 900, color: '#ffaa33' }}>{preview.countdown}</div>
                </div>
            </div>
        );
    }

    if (waiting) {
        return (
            <div style={S.overlay}>
                <div style={S.card}>
                    <div style={S.header}>
                        <div style={{ fontSize: 36 }}>⚔️</div>
                        <h2 style={{ margin: '8px 0 4px', fontSize: 20 }}>{t.lbDuelTitle}</h2>
                        <p style={S.sub}>{status}</p>
                    </div>
                    {duelFlow === 'random' && (
                        <div style={{ textAlign: 'center', marginBottom: 18 }}>
                            <div style={{ background: 'rgba(255,255,255,0.06)', borderRadius: 10, height: 6, overflow: 'hidden' }}>
                                <div style={{ height: '100%', background: '#44ffaa', width: `${Math.min((searchElapsed/15)*100, 100)}%`, transition: 'width 1s linear' }} />
                            </div>
                            <div style={{ marginTop: 6, fontSize: 22, color: 'rgba(255,255,255,0.6)' }}>{searchElapsed} {t.seconds}</div>
                        </div>
                    )}
                    {roomCode && <CodeBox label={t.lbRoomCodeLabel} code={roomCode} color="#44ffaa" t={t} />}
                    <div style={S.playerSection}>
                        <div style={S.sectionTitle}>{t.players} ({players.length}/2)</div>
                        {players.map(p => (
                            <div key={p.sessionId} style={S.playerRow}>
                                <span>{p.name === playerName ? '👤' : '🎮'}</span>
                                <span style={{ flex: 1 }}>{p.name} {p.name === playerName && `(${t.you})`}</span>
                            </div>
                        ))}
                    </div>
                    <button style={{ ...S.btn, background: '#222', width: '100%', marginTop: 16 }} onClick={handleLeave}>{t.lbLeaveBack}</button>
                    <div style={{ color: '#ff4444', fontSize: 13, textAlign: 'center', marginTop: 12, fontWeight: 'bold' }}>
                        {t.lbWipWarning}
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div style={{ ...S.overlay, direction: t.dir || 'rtl' }}>
            <div style={S.card}>
                <div style={S.header}>
                    <h1 style={{ margin: 0, fontSize: 24 }}>⚔️ {t.lbDuelTitle}</h1>
                    <p style={S.sub}>{t.lbDuelDesc}</p>
                </div>
                {duelFlow === 'none' && (
                    <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
                        <button style={{ ...S.btn, background: '#7a1020', flex: 1 }} onClick={() => { setDuelFlow('random'); handleConnect('random'); }}>{t.lbRandom}</button>
                        <button style={{ ...S.btn, background: '#1a3a5a', flex: 1 }} onClick={() => setDuelFlow('create')}>{t.lbChallengeFriend}</button>
                    </div>
                )}
                {duelFlow === 'create' && (
                    <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
                        <button style={{ ...S.btn, background: '#1a5a2a', flex: 1 }} onClick={() => handleConnect('create')}>{t.lbCreateRoom}</button>
                        <button style={{ ...S.btn, background: '#1a2a5a', flex: 1 }} onClick={() => setDuelFlow('join')}>{t.lbJoinCode}</button>
                    </div>
                )}
                {duelFlow === 'join' && (
                    <div style={{ marginBottom: 14 }}>
                        <input style={S.input} placeholder={t.lbRoomCodePlaceholder} value={joinCode} onChange={e => setJoinCode(e.target.value)} maxLength={30} autoFocus />
                    </div>
                )}
                <div style={S.btnRow}>
                    <button style={{ ...S.btn, background: '#333', flex: 1 }} onClick={onBack}>{t.back}</button>
                    {duelFlow === 'join' && (
                        <button style={{ ...S.btn, background: '#ff4455', flex: 2 }} onClick={() => handleConnect('join')} disabled={busy}>{t.lbJoinBtn}</button>
                    )}
                </div>
                <div style={{ color: '#ff4444', fontSize: 13, textAlign: 'center', marginTop: 20, fontWeight: 'bold' }}>
                    {t.lbWipWarning}
                </div>
            </div>
        </div>
    );
}

const S: any = {
    overlay: { position:'fixed', inset:0, background:'radial-gradient(ellipse at center,#0a0e27 0%,#000 100%)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:9999 },
    card: { background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.10)', borderRadius:20, padding:'28px 24px', width:'100%', maxWidth:540, color:'#fff', backdropFilter:'blur(12px)', maxHeight:'90vh', overflowY:'auto' },
    header: { textAlign:'center', marginBottom:20 },
    sub: { margin:'4px 0 0', color:'rgba(255,255,255,0.5)', fontSize:13 },
    input: { width:'100%', padding:'10px 14px', background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.15)', borderRadius:10, color:'#fff', textAlign:'center', outline:'none' },
    btnRow: { display:'flex', gap:10, marginTop:10 },
    btn: { padding:'11px 18px', borderRadius:10, border:'none', color:'#fff', fontWeight:700, cursor:'pointer' },
    playerSection: { background:'rgba(255,255,255,0.03)', borderRadius:12, padding:'14px', marginBottom:14, border:'1px solid rgba(255,255,255,0.06)' },
    sectionTitle: { fontWeight:700, fontSize:13, marginBottom:10, color:'rgba(255,255,255,0.55)' },
    playerRow: { display:'flex', alignItems:'center', gap:8, padding:'6px 10px', borderRadius:8, background:'rgba(255,255,255,0.03)', marginBottom:4 },
    statsBox: { background: 'rgba(0,0,0,0.3)', borderRadius: 12, padding: 16, margin: '16px 0', border: '1px solid rgba(255,255,255,0.1)' },
    statsLabel: { fontSize: 13, color: 'rgba(255,255,255,0.5)', marginBottom: 4 }
};

function CodeBox({ label, code, color, t }: any) {
    const [copied, setCopied] = useState(false);
    return (
        <div style={{ background: `${color}12`, border: `1px solid ${color}44`, borderRadius: 12, padding: '14px', textAlign: 'center', marginBottom: 12 }}>
            <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, marginBottom: 6 }}>{label}</div>
            <div style={{ color, fontFamily: 'monospace', fontSize: 13, fontWeight: 700 }}>{code}</div>
            <button onClick={() => { navigator.clipboard.writeText(code); setCopied(true); setTimeout(()=>setCopied(false), 2000); }}
                style={{ marginTop: 8, padding: '4px 12px', borderRadius: 6, border: 'none', background: color + '33', color: '#fff', fontSize: 11, cursor: 'pointer' }}>
                {copied ? `✅ ${t.copied}` : `📋 ${t.copy}`}
            </button>
        </div>
    );
}

function PlayerCard({ name, avatarUrl, highlight }: any) {
    return (
        <div style={{ textAlign: 'center' }}>
            {avatarUrl
                ? <img src={avatarUrl} alt={name} style={{ width: 64, height: 64, borderRadius: '50%', border: `3px solid ${highlight ? '#44ffaa' : '#ff4455'}` }} />
                : <div style={{ width: 64, height: 64, borderRadius: '50%', border: `3px solid ${highlight ? '#44ffaa' : '#ff4455'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, background: 'rgba(255,255,255,0.08)' }}>{(name||'?')[0].toUpperCase()}</div>
            }
            <div style={{ marginTop: 8, fontSize: 13, fontWeight: 600 }}>{name}</div>
        </div>
    );
}
