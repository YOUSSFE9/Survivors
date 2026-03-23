/**
 * OnlineLobby v5
 * - Duel Random: count-UP timer (0→15s), bot after 15s, match preview 3s then game
 * - Duel Friend: room code only, no timer, waits for 2nd real player, auto-starts
 * - Squad: red/blue team codes, host controls
 * - War: 20-slot roster, gradual fill, auto-start
 * - Online game over: show result + "Return to Menu" only (no retry)
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { network } from '../game/multiplayer/NetworkManager';

const MODES = [
    { id: 'war',   emoji: '💀', label: 'حرب',    sub: '20 لاعباً',  desc: 'الجميع ضد الجميع',               color: '#ff8833' },
    { id: 'squad', emoji: '🛡️', label: 'فرقة',   sub: 'حتى 4 × 4', desc: 'فريقك ضد الفريق المنافس',         color: '#4488ff' },
    { id: 'duel',  emoji: '⚔️', label: 'مبارزة', sub: '1 ضد 1',    desc: 'قتال مباشر بينك وبين خصم واحد',   color: '#ff4455' },
] as const;

type ModeId = 'war' | 'squad' | 'duel';
type DuelFlow = 'none' | 'random' | 'create' | 'join';
type SquadFlow = 'none' | 'create_red' | 'create_blue' | 'join';
interface PEntry { name: string; team: string; sessionId: string; avatarUrl?: string }

interface Props {
    uid: string;
    playerName: string;
    avatarUrl?: string;
    onMatchFound: (info: { mode: string; roomId: string; mazeSeed?: number }) => void;
    onBack: () => void;
}

export default function OnlineLobby({ uid, playerName, avatarUrl = '', onBack, onMatchFound }: Props) {
    const [mode, setMode] = useState<ModeId>('war');
    const [duelFlow, setDuelFlow] = useState<DuelFlow>('none');
    const [squadFlow, setSquadFlow] = useState<SquadFlow>('none');
    const [joinCode, setJoinCode] = useState('');
    const [status, setStatus] = useState('');
    const [busy, setBusy] = useState(false);

    const [waiting, setWaiting] = useState(false);
    const [players, setPlayers] = useState<PEntry[]>([]);
    const [countdown, setCountdown] = useState<number | null>(null);
    const [isHost, setIsHost] = useState(false);
    const [roomRef, setRoomRef] = useState<any>(null);

    // Codes
    const [redCode, setRedCode] = useState('');
    const [blueCode, setBlueCode] = useState('');
    const [roomCode, setRoomCode] = useState('');

    // Duel random count-up
    const [searchElapsed, setSearchElapsed] = useState(0);
    const searchTimerRef = useRef<any>(null);

    // Match preview (3s before game)
    const [preview, setPreview] = useState<{ players: PEntry[]; countdown: number } | null>(null);

    // Game over (online)
    const [gameOver, setGameOver] = useState<{ winner: string; killerName: string } | null>(null);

    const selectedMode = MODES.find(m => m.id === mode)!;

    /* ── Listen to room messages ── */
    const listenRoom = useCallback((room: any, m: ModeId) => {
        setRoomRef(room);

        room.onMessage('lobby_players', (list: PEntry[]) => setPlayers(list));
        room.onMessage('war_roster',    ({ players: r }: any) => setPlayers(r));
        room.onMessage('squad_codes',   ({ redCode: rc, blueCode: bc }: any) => {
            if (rc) setRedCode(rc);
            if (bc) setBlueCode(bc);
        });

        room.onMessage('host_status', ({ isHost: h }: any) => setIsHost(h));
        room.onMessage('new_host',    ({ hostId }: any) => setIsHost(room.sessionId === hostId));

        room.onMessage('countdown', ({ seconds }: any) => {
            setCountdown(seconds);
            setStatus(`🔥 تبدأ خلال ${seconds}...`);
        });

        room.onMessage('war_fill_started', () => setStatus('⚡ يتم ملء القائمة...'));

        // Match preview (duel random — shown 3s before game starts)
        room.onMessage('match_preview', ({ players: pp, seconds }: any) => {
            // Stop the search timer
            if (searchTimerRef.current) { clearInterval(searchTimerRef.current); searchTimerRef.current = null; }
            setSearchElapsed(0);
            // Show preview countdown
            let t = seconds || 3;
            setPreview({ players: pp, countdown: t });
            const pTimer = setInterval(() => {
                t--;
                if (t <= 0) { clearInterval(pTimer); }
                else setPreview(prev => prev ? { ...prev, countdown: t } : null);
            }, 1000);
        });

        // Game started → close preview, navigate
        room.onMessage('game_started', (data: any) => {
            network.gameStartedData = data;
            if (searchTimerRef.current) { clearInterval(searchTimerRef.current); searchTimerRef.current = null; }
            setPreview(null);
            onMatchFound({ mode: m, roomId: room.id, mazeSeed: data?.seed || 0 });
        });

        // Online game over — no retry
        room.onMessage('game_over', (data: any) => {
            setGameOver(data);
        });
    }, [onMatchFound]);

    /* ── Connect ── */
    const handleConnect = async (overrideDuel?: DuelFlow, overrideSquad?: SquadFlow) => {
        if (busy) return;
        setBusy(true);
        const dFlow = overrideDuel ?? duelFlow;
        const sFlow = overrideSquad ?? squadFlow;
        setStatus('جارِ الاتصال...');

        try {
            network.connect();

            /* DUEL — Random */
            if (mode === 'duel' && dFlow === 'random') {
                const room = await network.joinOrCreate('duel', { uid, name: playerName, avatarUrl });
                setRoomCode(''); setRedCode(''); setBlueCode('');
                setStatus('🔍 جارِ البحث عن خصم...');
                setWaiting(true); setBusy(false);
                listenRoom(room, 'duel');
                // Count-UP timer
                let t = 0;
                setSearchElapsed(0);
                searchTimerRef.current = setInterval(() => {
                    t++;
                    setSearchElapsed(t);
                    if (t >= 15) { clearInterval(searchTimerRef.current); searchTimerRef.current = null; }
                }, 1000);
                return;
            }

            /* DUEL — Create private */
            if (mode === 'duel' && dFlow === 'create') {
                const { room, roomId: rid } = await network.createPrivateRoom('duel', { uid, name: playerName, avatarUrl });
                setRoomCode(rid); setRedCode(''); setBlueCode('');
                setStatus('انتظار صديقك...');
                setWaiting(true); setBusy(false);
                listenRoom(room, 'duel');
                return;
            }

            /* DUEL — Join by code */
            if (mode === 'duel' && dFlow === 'join') {
                const code = joinCode.trim();
                if (!code) { setStatus('⚠️ أدخل رمز الغرفة'); setBusy(false); return; }
                const room = await network.joinOrCreate('duel', { uid, name: playerName, avatarUrl, roomCode: code });
                setStatus('تم الانضمام!');
                setWaiting(true); setBusy(false);
                listenRoom(room, 'duel');
                return;
            }

            /* SQUAD — Create Red */
            if (mode === 'squad' && sFlow === 'create_red') {
                const { room } = await network.createPrivateRoom('squad', { uid, name: playerName, avatarUrl, reqTeam: 'red' });
                setStatus('انتظار اللاعبين...');
                setWaiting(true); setBusy(false);
                listenRoom(room, 'squad');
                return;
            }

            /* SQUAD — Create Blue */
            if (mode === 'squad' && sFlow === 'create_blue') {
                const { room } = await network.createPrivateRoom('squad', { uid, name: playerName, avatarUrl, reqTeam: 'blue' });
                setStatus('انتظار اللاعبين...');
                setWaiting(true); setBusy(false);
                listenRoom(room, 'squad');
                return;
            }

            /* SQUAD — Join by code */
            if (mode === 'squad' && sFlow === 'join') {
                const full = joinCode.trim();
                if (!full) { setStatus('⚠️ أدخل رمز الغرفة'); setBusy(false); return; }
                let baseId = full, reqTeam = '';
                if (full.endsWith('-R')) { baseId = full.slice(0, -2); reqTeam = 'red'; }
                if (full.endsWith('-B')) { baseId = full.slice(0, -2); reqTeam = 'blue'; }
                const room = await network.joinOrCreate('squad', { uid, name: playerName, avatarUrl, roomCode: baseId, reqTeam });
                setStatus('انضممت!');
                setWaiting(true); setBusy(false);
                listenRoom(room, 'squad');
                return;
            }

            /* WAR */
            if (mode === 'war') {
                const room = await network.joinOrCreate('war', { uid, name: playerName, avatarUrl });
                setStatus('في انتظار اللاعبين...');
                setWaiting(true); setBusy(false);
                listenRoom(room, 'war');
                return;
            }
        } catch (e: any) {
            console.error('[OnlineLobby]', e);
            setStatus('❌ فشل الاتصال — تأكد من اتصالك بالإنترنت');
            setBusy(false);
        }
    };

    const handleLeave = async () => {
        if (searchTimerRef.current) clearInterval(searchTimerRef.current);
        await network.leave();
        setWaiting(false); setPlayers([]); setCountdown(null); setSearchElapsed(0);
        setRedCode(''); setBlueCode(''); setRoomCode(''); setPreview(null); setGameOver(null);
        setStatus(''); setDuelFlow('none'); setSquadFlow('none'); setBusy(false);
    };

    /* ══════════════════════════
       GAME OVER SCREEN (online)
    ══════════════════════════ */
    if (gameOver) {
        const isWin = gameOver.winner === uid || gameOver.winner === playerName;
        return (
            <div style={S.overlay}>
                <div style={{ ...S.card, textAlign: 'center' as const, maxWidth: 420 }}>
                    <div style={{ fontSize: 64, marginBottom: 12 }}>{isWin ? '🏆' : '💀'}</div>
                    <h2 style={{ margin: '0 0 8px', fontSize: 28, color: isWin ? '#44ffaa' : '#ff4455' }}>
                        {isWin ? 'فزت!' : 'خسرت!'}
                    </h2>
                    {!isWin && gameOver.killerName && (
                        <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: 14, margin: '0 0 20px' }}>
                            أقصاك <strong style={{ color: '#fff' }}>{gameOver.killerName}</strong>
                        </p>
                    )}
                    <button style={{ ...S.btn, background: '#1a3a5a', width: '100%', fontSize: 15 }}
                        onClick={onBack}>
                        ← العودة للقائمة الرئيسية
                    </button>
                </div>
            </div>
        );
    }

    /* ══════════════════════════
       MATCH PREVIEW SCREEN
    ══════════════════════════ */
    if (preview) {
        const [p1, p2] = preview.players ?? [];
        return (
            <div style={S.overlay}>
                <div style={{ ...S.card, textAlign: 'center' as const, maxWidth: 420 }}>
                    <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', marginBottom: 16 }}>تم العثور على خصم!</div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 20, marginBottom: 24 }}>
                        <PlayerCard name={p1?.name || playerName} avatarUrl={p1?.avatarUrl} highlight />
                        <div style={{ fontSize: 28, color: '#ff4455', fontWeight: 900 }}>⚔️</div>
                        <PlayerCard name={p2?.name || '?'} avatarUrl={p2?.avatarUrl} />
                    </div>
                    <div style={{ fontSize: 42, fontWeight: 900, color: '#ffaa33' }}>{preview.countdown}</div>
                    <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13, marginTop: 4 }}>تبدأ المبارزة...</div>
                </div>
            </div>
        );
    }

    /* ══════════════════════════
       WAITING ROOM
    ══════════════════════════ */
    if (waiting) {
        const redPlayers  = players.filter(p => p.team === 'red');
        const bluePlayers = players.filter(p => p.team === 'blue');
        const isDuelFriend = mode === 'duel' && !!roomCode;
        const cdColor = countdown != null ? (countdown <= 3 ? '#ff4455' : '#44ffaa') : '#44ffaa';

        return (
            <div style={S.overlay}>
                <div style={{ ...S.card, maxWidth: mode === 'war' ? 660 : 540 }}>
                    <div style={S.header}>
                        <div style={{ fontSize: 36 }}>
                            {countdown != null
                                ? <span style={{ color: cdColor, fontWeight: 900, fontSize: 52 }}>{countdown}</span>
                                : selectedMode.emoji}
                        </div>
                        <h2 style={{ margin: '8px 0 4px', fontSize: 20 }}>
                            {countdown != null ? `تبدأ خلال ${countdown}...` : `غرفة الانتظار — ${selectedMode.label}`}
                        </h2>
                        <p style={S.sub}>{status}</p>
                    </div>

                    {/* Duel random count-UP timer */}
                    {mode === 'duel' && !isDuelFriend && countdown == null && searchElapsed >= 0 && (
                        <div style={{ textAlign: 'center', marginBottom: 18 }}>
                            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginBottom: 6 }}>جارِ البحث عن خصم</div>
                            <div style={{ background: 'rgba(255,255,255,0.06)', borderRadius: 10, height: 6, overflow: 'hidden' }}>
                                <div style={{
                                    height: '100%', borderRadius: 10,
                                    background: searchElapsed < 10 ? '#44ffaa' : searchElapsed < 13 ? '#ffaa33' : '#ff4455',
                                    width: `${Math.min((searchElapsed / 15) * 100, 100)}%`,
                                    transition: 'width 1s linear, background 0.3s',
                                }} />
                            </div>
                            <div style={{ marginTop: 6, fontSize: 22, fontWeight: 700, color: 'rgba(255,255,255,0.6)' }}>
                                {searchElapsed}s
                            </div>
                        </div>
                    )}

                    {/* Duel friend: only room code */}
                    {isDuelFriend && (
                        <div style={{ marginBottom: 18 }}>
                            <CodeBox label="🔗 رمز الغرفة — شاركه مع صديقك" code={roomCode} color="#44ffaa" />
                        </div>
                    )}

                    {/* Squad team codes */}
                    {mode === 'squad' && (redCode || blueCode) && (
                        <div style={{ display: 'flex', gap: 10, marginBottom: 18, flexWrap: 'wrap' as const }}>
                            {redCode  && <CodeBox label="🔴 رمز الفريق الأحمر" code={redCode}  color="#ff4455" />}
                            {blueCode && <CodeBox label="🔵 رمز الفريق الأزرق" code={blueCode} color="#4488ff" />}
                        </div>
                    )}

                    {/* WAR roster */}
                    {mode === 'war' && (
                        <div style={S.playerSection}>
                            <div style={{ ...S.sectionTitle, display: 'flex' as const, justifyContent: 'space-between' }}>
                                <span>قائمة المحاربين</span>
                                <span style={{ color: '#ffaa33' }}>{players.length} / 20</span>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                                {Array.from({ length: 20 }).map((_, i) => {
                                    const p = players[i];
                                    return (
                                        <div key={i} style={{
                                            display: 'flex', alignItems: 'center', gap: 8,
                                            padding: '5px 10px', borderRadius: 8,
                                            background: p ? 'rgba(68,255,170,0.06)' : 'rgba(255,255,255,0.02)',
                                            border: `1px solid ${p ? 'rgba(68,255,170,0.15)' : 'rgba(255,255,255,0.04)'}`,
                                            transition: 'all 0.4s',
                                        }}>
                                            <span style={{ fontSize: 14, opacity: p ? 1 : 0.2 }}>
                                                {p ? '👤' : `${i + 1}`}
                                            </span>
                                            <span style={{ fontSize: 12, color: p ? '#cde' : 'rgba(255,255,255,0.12)' }}>
                                                {p ? p.name : '— فارغ —'}
                                            </span>
                                            {p?.name === playerName && (
                                                <span style={{ fontSize: 10, color: '#44ffaa', marginRight: 'auto' }}>أنت</span>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* SQUAD columns */}
                    {mode === 'squad' && (
                        <div style={S.playerSection}>
                            <div style={S.sectionTitle}>اللاعبون ({players.length})</div>
                            <div style={{ display: 'flex', gap: 14 }}>
                                <TeamColumn title="🔴 الفريق الأحمر" players={redPlayers} color="#ff4455"
                                    myName={playerName} isHost={isHost} room={roomRef} />
                                <TeamColumn title="🔵 الفريق الأزرق" players={bluePlayers} color="#4488ff"
                                    myName={playerName} isHost={isHost} room={roomRef} />
                            </div>
                        </div>
                    )}

                    {/* DUEL players */}
                    {mode === 'duel' && players.length > 0 && (
                        <div style={S.playerSection}>
                            <div style={S.sectionTitle}>اللاعبون ({players.length}/2)</div>
                            {players.map(p => <PlayerRow key={p.sessionId} player={p} myName={playerName} />)}
                        </div>
                    )}

                    {/* Squad host controls */}
                    {isHost && countdown == null && mode === 'squad' && (
                        <div style={{ background: 'rgba(68,255,170,0.06)', border: '1px solid rgba(68,255,170,0.2)', borderRadius: 12, padding: '12px 16px', marginBottom: 12, textAlign: 'center' as const }}>
                            <div style={{ color: '#44ffaa', fontSize: 12, marginBottom: 10 }}>👑 أنت صاحب الغرفة</div>
                            <button style={{ ...S.btn, background: '#22aa66', width: '100%', fontSize: 15 }}
                                onClick={() => roomRef?.send('host_start')}>
                                🚀 ابدأ المباراة الآن
                            </button>
                        </div>
                    )}

                    <button style={{ ...S.btn, background: '#222', marginTop: 6, width: '100%' }} onClick={handleLeave}>
                        ← مغادرة الغرفة
                    </button>
                </div>
            </div>
        );
    }

    /* ══════════════════════════
       MODE SELECTION
    ══════════════════════════ */
    return (
        <div style={S.overlay}>
            <div style={S.card}>
                <div style={S.header}>
                    <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700 }}>🌐 اللعب أونلاين</h1>
                    <p style={S.sub}>مرحباً <strong>{playerName}</strong></p>
                </div>

                <div style={S.modeRow}>
                    {MODES.map(m => (
                        <div key={m.id} style={{
                            ...S.modeCard,
                            border: `2px solid ${mode === m.id ? m.color : 'rgba(255,255,255,0.08)'}`,
                            background: mode === m.id ? `${m.color}22` : 'rgba(255,255,255,0.03)',
                            cursor: 'pointer',
                            transform: mode === m.id ? 'scale(1.03)' : 'scale(1)',
                        }} onClick={() => { if (!busy) { setMode(m.id as ModeId); setDuelFlow('none'); setSquadFlow('none'); setStatus(''); } }}>
                            <div style={{ fontSize: 32 }}>{m.emoji}</div>
                            <div style={{ color: m.color, fontWeight: 700, fontSize: 15, marginTop: 6 }}>{m.label}</div>
                            <div style={{ color: '#aab', fontSize: 11, margin: '3px 0' }}>{m.sub}</div>
                            <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 10, lineHeight: 1.4 }}>{m.desc}</div>
                        </div>
                    ))}
                </div>

                {/* DUEL sub-options */}
                {mode === 'duel' && duelFlow === 'none' && (
                    <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
                        <button style={{ ...S.btn, background: '#7a1020', flex: 1 }}
                            onClick={() => { setDuelFlow('random'); handleConnect('random'); }}>
                            <div>🎲 عشوائي</div>
                            <div style={{ fontSize: 10, opacity: 0.6, fontWeight: 400 }}>ابحث عن خصم</div>
                        </button>
                        <button style={{ ...S.btn, background: '#1a3a5a', flex: 1 }}
                            onClick={() => setDuelFlow('create')}>
                            <div>👥 تحدي صديق</div>
                            <div style={{ fontSize: 10, opacity: 0.6, fontWeight: 400 }}>أنشئ أو انضم برمز</div>
                        </button>
                    </div>
                )}

                {mode === 'duel' && duelFlow === 'create' && (
                    <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
                        <button style={{ ...S.btn, background: '#1a5a2a', flex: 1 }}
                            onClick={() => handleConnect('create')}>➕ إنشاء غرفة</button>
                        <button style={{ ...S.btn, background: '#1a2a5a', flex: 1 }}
                            onClick={() => setDuelFlow('join')}>🔗 إدخال رمز</button>
                    </div>
                )}

                {mode === 'duel' && duelFlow === 'join' && (
                    <div style={{ marginBottom: 14 }}>
                        <input style={S.input} placeholder="أدخل رمز الغرفة..."
                            value={joinCode} onChange={e => setJoinCode(e.target.value)} maxLength={30} autoFocus />
                    </div>
                )}

                {/* SQUAD sub-options */}
                {mode === 'squad' && squadFlow === 'none' && (
                    <div style={{ marginBottom: 16 }}>
                        <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12, textAlign: 'center' as const, marginBottom: 10 }}>
                            اختر فريقك
                        </div>
                        <div style={{ display: 'flex', gap: 10 }}>
                            <button style={{ ...S.btn, background: '#6b0a0a', flex: 1 }}
                                onClick={() => { setSquadFlow('create_red'); handleConnect(undefined, 'create_red'); }}>
                                🔴 إنشاء (أحمر)
                            </button>
                            <button style={{ ...S.btn, background: '#0a1a6b', flex: 1 }}
                                onClick={() => { setSquadFlow('create_blue'); handleConnect(undefined, 'create_blue'); }}>
                                🔵 إنشاء (أزرق)
                            </button>
                            <button style={{ ...S.btn, background: '#1a4a1a', flex: 1 }}
                                onClick={() => setSquadFlow('join')}>🔗 انضم</button>
                        </div>
                    </div>
                )}

                {mode === 'squad' && squadFlow === 'join' && (
                    <div style={{ marginBottom: 14 }}>
                        <input style={S.input} placeholder="أدخل رمز الفريق (-R أو -B)..."
                            value={joinCode} onChange={e => setJoinCode(e.target.value)} maxLength={30} autoFocus />
                    </div>
                )}

                {status && (
                    <div style={{ textAlign: 'center' as const, marginBottom: 12, fontSize: 13,
                        color: status.startsWith('❌') ? '#ff6666' : 'rgba(255,255,255,0.5)' }}>
                        {busy && '⟳ '}{status}
                    </div>
                )}

                <div style={S.btnRow}>
                    <button style={{ ...S.btn, background: '#333', flex: 1 }} onClick={onBack} disabled={busy}>
                        ← رجوع
                    </button>
                    {mode === 'war' && (
                        <button style={{ ...S.btn, background: busy ? '#555' : '#ff8833', flex: 2 }}
                            onClick={() => handleConnect()} disabled={busy}>
                            {busy ? '⟳...' : '💀 ادخل الحرب'}
                        </button>
                    )}
                    {mode === 'duel' && duelFlow === 'join' && (
                        <button style={{ ...S.btn, background: busy ? '#555' : '#ff4455', flex: 2 }}
                            onClick={() => handleConnect('join')} disabled={busy}>
                            {busy ? '⟳...' : '🚀 انضم'}
                        </button>
                    )}
                    {mode === 'squad' && squadFlow === 'join' && (
                        <button style={{ ...S.btn, background: busy ? '#555' : '#4488ff', flex: 2 }}
                            onClick={() => handleConnect(undefined, 'join')} disabled={busy}>
                            {busy ? '⟳...' : '🚀 انضم'}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}

/* ─── Sub-components ─── */
function CodeBox({ label, code, color }: { label: string; code: string; color: string }) {
    const [copied, setCopied] = useState(false);
    return (
        <div style={{ flex: 1, background: `${color}12`, border: `1px solid ${color}44`, borderRadius: 12, padding: '14px', textAlign: 'center' as const, minWidth: 130 }}>
            <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, marginBottom: 6 }}>{label}</div>
            <div style={{ color, fontFamily: 'monospace', fontSize: 13, fontWeight: 700, wordBreak: 'break-all' as const }}>{code}</div>
            <button onClick={() => { navigator.clipboard.writeText(code).catch(()=>{}); setCopied(true); setTimeout(()=>setCopied(false), 2000); }}
                style={{ marginTop: 8, padding: '4px 12px', borderRadius: 6, border: 'none', background: color + '33', color: '#fff', fontSize: 11, cursor: 'pointer' }}>
                {copied ? '✅ تم' : '📋 نسخ'}
            </button>
        </div>
    );
}

function PlayerCard({ name, avatarUrl, highlight }: { name: string; avatarUrl?: string; highlight?: boolean }) {
    return (
        <div style={{ textAlign: 'center' as const }}>
            {avatarUrl
                ? <img src={avatarUrl} alt={name} style={{ width: 64, height: 64, borderRadius: '50%', border: `3px solid ${highlight ? '#44ffaa' : '#ff4455'}` }} />
                : <div style={{ width: 64, height: 64, borderRadius: '50%', border: `3px solid ${highlight ? '#44ffaa' : '#ff4455'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, background: 'rgba(255,255,255,0.08)' }}>
                    {(name || '?')[0].toUpperCase()}
                  </div>
            }
            <div style={{ marginTop: 8, fontSize: 13, fontWeight: 600, color: highlight ? '#44ffaa' : '#fff' }}>{name}</div>
        </div>
    );
}

function TeamColumn({ title, players, color, myName, isHost, room }: any) {
    return (
        <div style={{ flex: 1 }}>
            <div style={{ color, fontWeight:700, fontSize:13, marginBottom:8 }}>{title} ({players.length})</div>
            {players.length === 0
                ? <div style={{ color:'rgba(255,255,255,0.2)', fontSize:12, padding:8 }}>في انتظار لاعبين...</div>
                : players.map((p: PEntry) => <PlayerRow key={p.sessionId} player={p} myName={myName} isHost={isHost} room={room} showTeamSwitch />)
            }
        </div>
    );
}

function PlayerRow({ player, myName, isHost, room, showTeamSwitch }: any) {
    const isMe = player.name === myName;
    return (
        <div style={{ display:'flex', alignItems:'center', gap:8, padding:'6px 10px', borderRadius:8, marginBottom:4,
            background: isMe ? 'rgba(68,255,170,0.10)' : 'rgba(255,255,255,0.03)',
            border: isMe ? '1px solid rgba(68,255,170,0.25)' : '1px solid transparent' }}>
            <span style={{ fontSize:15 }}>{isMe ? '👤' : '🎮'}</span>
            <span style={{ flex:1, fontSize:13, color: isMe ? '#44ffaa' : '#cdd' }}>{player.name}</span>
            {isMe && <span style={{ fontSize:10, color:'#44ffaa' }}>أنت</span>}
            {isHost && !isMe && showTeamSwitch && (
                <button onClick={() => room?.send('move_team', { targetId: player.sessionId })}
                    style={{ padding:'2px 7px', borderRadius:5, border:'none', background:'rgba(100,150,255,0.2)', color:'#88aaff', fontSize:11, cursor:'pointer' }}>🔄</button>
            )}
            {isHost && !isMe && (
                <button onClick={() => room?.send('kick_player', { targetId: player.sessionId })}
                    style={{ padding:'2px 7px', borderRadius:5, border:'none', background:'rgba(255,60,60,0.2)', color:'#ff6666', fontSize:11, cursor:'pointer' }}>❌</button>
            )}
        </div>
    );
}

const S: Record<string, React.CSSProperties> = {
    overlay: { position:'fixed', inset:0, background:'radial-gradient(ellipse at center,#0a0e27 0%,#000 100%)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:9999, fontFamily:"'Outfit',sans-serif", direction:'rtl' },
    card: { background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.10)', borderRadius:20, padding:'28px 24px', width:'100%', maxWidth:540, color:'#fff', backdropFilter:'blur(12px)', boxShadow:'0 0 60px rgba(0,150,255,0.12)', maxHeight:'90vh', overflowY:'auto' },
    header: { textAlign:'center', marginBottom:20 },
    sub: { margin:'4px 0 0', color:'rgba(255,255,255,0.5)', fontSize:13 },
    modeRow: { display:'flex', gap:10, marginBottom:18 },
    modeCard: { flex:1, borderRadius:14, padding:'14px 8px', textAlign:'center', transition:'all 0.2s' },
    input: { width:'100%', padding:'10px 14px', background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.15)', borderRadius:10, color:'#fff', fontSize:15, outline:'none', boxSizing:'border-box', textAlign:'center', letterSpacing:2, fontFamily:"'Outfit',monospace" },
    btnRow: { display:'flex', gap:10, marginTop:4 },
    btn: { padding:'11px 18px', borderRadius:10, border:'none', color:'#fff', fontWeight:700, fontSize:14, cursor:'pointer', fontFamily:"'Outfit',sans-serif", transition:'opacity 0.2s' },
    playerSection: { background:'rgba(255,255,255,0.03)', borderRadius:12, padding:'14px', marginBottom:14, border:'1px solid rgba(255,255,255,0.06)' },
    sectionTitle: { fontWeight:700, fontSize:13, marginBottom:10, color:'rgba(255,255,255,0.55)' },
};
