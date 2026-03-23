/**
 * OnlineLobby — Full lobby UI for all 3 online modes.
 * - Duel: Random (15s → bot) + Friend Challenge (room code, auto-start)
 * - Squad: Red/Blue teams with codes, host controls
 * - War: 20-slot roster, gradual fill, auto-start
 *
 * IMPORTANT: Bots are invisible to players — no [BOT] tags, no isBot indicators in UI.
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { network } from '../game/multiplayer/NetworkManager';

const MODES = [
    { id: 'war',   emoji: '💀', label: 'حرب',    sub: '20 لاعباً',   desc: 'الجميع ضد الجميع — الناجي الأخير يفوز', color: '#ff8833', maxPlayers: 20 },
    { id: 'squad', emoji: '🛡️', label: 'فرقة',   sub: 'حتى 4 × 4',  desc: 'فريقك ضد الفريق المنافس',               color: '#4488ff', maxPlayers: 8  },
    { id: 'duel',  emoji: '⚔️', label: 'مبارزة', sub: '1 ضد 1',     desc: 'قتال مباشر بينك وبين خصم واحد',         color: '#ff4455', maxPlayers: 2  },
] as const;

type ModeId = 'war' | 'squad' | 'duel';
type DuelFlow = 'none' | 'random' | 'create' | 'join';
type SquadFlow = 'none' | 'create_red' | 'create_blue' | 'join';
interface PlayerEntry { name: string; team: string; sessionId: string; isBot?: boolean }

interface Props {
    uid: string;
    playerName: string;
    onMatchFound: (info: { mode: string; roomId: string }) => void;
    onBack: () => void;
}

export default function OnlineLobby({ uid, playerName, onBack, onMatchFound }: Props) {
    const [mode, setMode] = useState<ModeId>('war');
    const [duelFlow, setDuelFlow] = useState<DuelFlow>('none');
    const [squadFlow, setSquadFlow] = useState<SquadFlow>('none');
    const [joinCode, setJoinCode] = useState('');
    const [status, setStatus] = useState('');
    const [busy, setBusy] = useState(false);

    const [waiting, setWaiting] = useState(false);
    const [players, setPlayers] = useState<PlayerEntry[]>([]);
    const [countdown, setCountdown] = useState<number | null>(null);
    const [isHost, setIsHost] = useState(false);
    const [roomRef, setRoomRef] = useState<any>(null);

    const [redCode, setRedCode] = useState('');
    const [blueCode, setBlueCode] = useState('');
    const [roomCode, setRoomCode] = useState('');

    const [searchTimer, setSearchTimer] = useState<number | null>(null);
    const timerRef = useRef<any>(null);

    const selectedMode = MODES.find(m => m.id === mode)!;

    /* ── Room listeners ── */
    const listenRoom = useCallback((room: any, m: ModeId) => {
        setRoomRef(room);

        room.onMessage('lobby_players', (list: PlayerEntry[]) => setPlayers(list));

        room.onMessage('war_roster', ({ players: r }: any) => {
            setPlayers(r);
        });

        room.onMessage('squad_codes', ({ redCode: rc, blueCode: bc }: any) => {
            if (rc) setRedCode(rc);
            if (bc) setBlueCode(bc);
        });

        room.onMessage('host_status', ({ isHost: h }: any) => setIsHost(h));
        room.onMessage('new_host', ({ hostId }: any) => setIsHost(room.sessionId === hostId));

        room.onMessage('countdown', ({ seconds }: any) => {
            setCountdown(seconds);
            setStatus(`🔥 تبدأ خلال ${seconds}...`);
        });

        room.onMessage('war_fill_started', () => {
            setStatus('⚡ يتم ملء القائمة...');
        });

        room.onMessage('game_started', () => {
            if (timerRef.current) clearInterval(timerRef.current);
            onMatchFound({ mode: m, roomId: room.id });
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

            /* DUEL — Random matchmaking */
            if (mode === 'duel' && dFlow === 'random') {
                const room = await network.joinOrCreate('duel', { uid, name: playerName });
                setRoomCode('');
                setRedCode(''); setBlueCode('');
                setStatus('🔍 جارِ البحث عن خصم...');
                setWaiting(true); setBusy(false);
                listenRoom(room, 'duel');
                // 15-second search timer UI
                let t = 15;
                setSearchTimer(t);
                timerRef.current = setInterval(() => {
                    t--;
                    setSearchTimer(t);
                    if (t <= 0) {
                        clearInterval(timerRef.current);
                        setSearchTimer(null);
                        setStatus('🔍 تم العثور على خصم!');
                    }
                }, 1000);
                return;
            }

            /* DUEL — Create private room (friend challenge) */
            if (mode === 'duel' && dFlow === 'create') {
                const { room, roomId: rid } = await network.createPrivateRoom('duel', { uid, name: playerName });
                setRoomCode(rid);
                setRedCode(''); setBlueCode('');
                setStatus('انتظار صديقك...');
                setWaiting(true); setBusy(false);
                listenRoom(room, 'duel');
                return;
            }

            /* DUEL — Join by code */
            if (mode === 'duel' && dFlow === 'join') {
                const code = joinCode.trim();
                if (!code) { setStatus('⚠️ أدخل رمز الغرفة'); setBusy(false); return; }
                const room = await network.joinOrCreate('duel', { uid, name: playerName, roomCode: code });
                setStatus('تم الانضمام!');
                setWaiting(true); setBusy(false);
                listenRoom(room, 'duel');
                return;
            }

            /* SQUAD — Create Red */
            if (mode === 'squad' && sFlow === 'create_red') {
                const { room } = await network.createPrivateRoom('squad', { uid, name: playerName, reqTeam: 'red' });
                setStatus('انتظار اللاعبين...');
                setWaiting(true); setBusy(false);
                listenRoom(room, 'squad');
                return;
            }

            /* SQUAD — Create Blue */
            if (mode === 'squad' && sFlow === 'create_blue') {
                const { room } = await network.createPrivateRoom('squad', { uid, name: playerName, reqTeam: 'blue' });
                setStatus('انتظار اللاعبين...');
                setWaiting(true); setBusy(false);
                listenRoom(room, 'squad');
                return;
            }

            /* SQUAD — Join by code */
            if (mode === 'squad' && sFlow === 'join') {
                const fullCode = joinCode.trim();
                if (!fullCode) { setStatus('⚠️ أدخل رمز الغرفة'); setBusy(false); return; }
                let baseId = fullCode, reqTeam = '';
                if (fullCode.endsWith('-R')) { baseId = fullCode.slice(0, -2); reqTeam = 'red'; }
                if (fullCode.endsWith('-B')) { baseId = fullCode.slice(0, -2); reqTeam = 'blue'; }
                const room = await network.joinOrCreate('squad', { uid, name: playerName, roomCode: baseId, reqTeam });
                setStatus('انضممت!');
                setWaiting(true); setBusy(false);
                listenRoom(room, 'squad');
                return;
            }

            /* WAR */
            if (mode === 'war') {
                const room = await network.joinOrCreate('war', { uid, name: playerName });
                setStatus('في انتظار اللاعبين...');
                setWaiting(true); setBusy(false);
                listenRoom(room, 'war');
                return;
            }
        } catch (e: any) {
            console.error('[OnlineLobby] connect error:', e);
            setStatus('❌ فشل الاتصال — تأكد من اتصالك بالإنترنت');
            setBusy(false);
        }
    };

    const handleLeave = async () => {
        if (timerRef.current) clearInterval(timerRef.current);
        await network.leave();
        setWaiting(false); setPlayers([]); setCountdown(null); setSearchTimer(null);
        setRedCode(''); setBlueCode(''); setRoomCode('');
        setStatus(''); setDuelFlow('none'); setSquadFlow('none'); setBusy(false);
    };

    const cdColor = countdown != null ? (countdown <= 3 ? '#ff4455' : '#44ffaa') : '#44ffaa';

    /* ════════════════════════════════════
       WAITING ROOM
    ════════════════════════════════════ */
    if (waiting) {
        const redPlayers  = players.filter(p => p.team === 'red');
        const bluePlayers = players.filter(p => p.team === 'blue');
        const isDuelFriend = mode === 'duel' && roomCode;

        return (
            <div style={S.overlay}>
                <div style={{ ...S.card, maxWidth: mode === 'war' ? 660 : 540 }}>
                    {/* Header */}
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

                    {/* Duel random search timer */}
                    {mode === 'duel' && searchTimer != null && (
                        <div style={{ textAlign: 'center', marginBottom: 16 }}>
                            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginBottom: 6 }}>جارِ البحث عن خصم</div>
                            <div style={{ background: 'rgba(255,255,255,0.06)', borderRadius: 10, height: 6, overflow: 'hidden' }}>
                                <div style={{
                                    height: '100%', borderRadius: 10,
                                    background: searchTimer > 7 ? '#44ffaa' : searchTimer > 3 ? '#ffaa33' : '#ff4455',
                                    width: `${(searchTimer / 15) * 100}%`,
                                    transition: 'width 1s linear, background 0.3s',
                                }} />
                            </div>
                            <div style={{ marginTop: 6, fontSize: 20, fontWeight: 700, color: searchTimer > 7 ? '#44ffaa' : '#ff4455' }}>
                                {searchTimer}s
                            </div>
                        </div>
                    )}

                    {/* Room code (duel friend only — NOT team codes) */}
                    {isDuelFriend && (
                        <div style={{ marginBottom: 18 }}>
                            <CodeBox label="🔗 رمز الغرفة — شاركه مع صديقك" code={roomCode} color="#44ffaa" />
                        </div>
                    )}

                    {/* Squad team codes */}
                    {mode === 'squad' && (redCode || blueCode) && (
                        <div style={{ display: 'flex', gap: 10, marginBottom: 18, flexWrap: 'wrap' }}>
                            <CodeBox label="🔴 رمز الفريق الأحمر" code={redCode} color="#ff4455" />
                            <CodeBox label="🔵 رمز الفريق الأزرق" code={blueCode} color="#4488ff" />
                        </div>
                    )}

                    {/* WAR — 20-slot roster */}
                    {mode === 'war' && (
                        <div style={S.playerSection}>
                            <div style={{ ...S.sectionTitle, display: 'flex', justifyContent: 'space-between' }}>
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
                                            transition: 'all 0.3s',
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

                    {/* SQUAD — Team columns */}
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

                    {/* DUEL — Player list */}
                    {mode === 'duel' && players.length > 0 && (
                        <div style={S.playerSection}>
                            <div style={S.sectionTitle}>اللاعبون ({players.length}/2)</div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                {players.map(p => (
                                    <PlayerRow key={p.sessionId} player={p} myName={playerName} />
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Host Controls (squad only — duel auto-starts, war auto-fills) */}
                    {isHost && countdown == null && mode === 'squad' && (
                        <div style={{ background: 'rgba(68,255,170,0.06)', border: '1px solid rgba(68,255,170,0.2)', borderRadius: 12, padding: '12px 16px', marginBottom: 12, textAlign: 'center' }}>
                            <div style={{ color: '#44ffaa', fontSize: 12, marginBottom: 10 }}>👑 أنت صاحب الغرفة</div>
                            <button style={{ ...S.btn, background: '#22aa66', width: '100%', fontSize: 15 }}
                                onClick={() => roomRef?.send('host_start')}>
                                🚀 ابدأ المباراة الآن
                            </button>
                        </div>
                    )}

                    <button style={{ ...S.btn, background: '#333', marginTop: 6, width: '100%' }} onClick={handleLeave}>
                        ← مغادرة الغرفة
                    </button>
                </div>
            </div>
        );
    }

    /* ════════════════════════════════════
       MODE SELECTION SCREEN
    ════════════════════════════════════ */
    return (
        <div style={S.overlay}>
            <div style={S.card}>
                <div style={S.header}>
                    <h1 style={S.title}>🌐 اللعب أونلاين</h1>
                    <p style={S.sub}>مرحباً <strong>{playerName}</strong> — اختر وضع اللعب</p>
                </div>

                {/* Mode cards */}
                <div style={S.modeRow}>
                    {MODES.map(m => (
                        <div key={m.id} style={{
                            ...S.modeCard,
                            border: `2px solid ${mode === m.id ? m.color : 'rgba(255,255,255,0.08)'}`,
                            background: mode === m.id ? `${m.color}22` : 'rgba(255,255,255,0.03)',
                            cursor: busy ? 'not-allowed' : 'pointer',
                            transform: mode === m.id ? 'scale(1.03)' : 'scale(1)',
                        }} onClick={() => {
                            if (!busy) { setMode(m.id as ModeId); setDuelFlow('none'); setSquadFlow('none'); setStatus(''); }
                        }}>
                            <div style={{ fontSize: 32 }}>{m.emoji}</div>
                            <div style={{ color: m.color, fontWeight: 700, fontSize: 16, marginTop: 6 }}>{m.label}</div>
                            <div style={S.modeSub}>{m.sub}</div>
                            <div style={S.modeDesc}>{m.desc}</div>
                        </div>
                    ))}
                </div>

                {/* ── DUEL sub-options ── */}
                {mode === 'duel' && duelFlow === 'none' && (
                    <div style={{ marginBottom: 16 }}>
                        <div style={{ display: 'flex', gap: 10 }}>
                            <button style={{ ...S.btn, background: '#8b1a2a', flex: 1 }}
                                onClick={() => { setDuelFlow('random'); handleConnect('random'); }}>
                                <div>🎲 عشوائي</div>
                                <div style={{ fontSize: 10, opacity: 0.6, fontWeight: 400, marginTop: 2 }}>ابحث عن خصم</div>
                            </button>
                            <button style={{ ...S.btn, background: '#1a3a5a', flex: 1 }}
                                onClick={() => setDuelFlow('create')}>
                                <div>👥 تحدي صديق</div>
                                <div style={{ fontSize: 10, opacity: 0.6, fontWeight: 400, marginTop: 2 }}>أنشئ أو انضم</div>
                            </button>
                        </div>
                    </div>
                )}

                {/* DUEL — Friend sub-options */}
                {mode === 'duel' && duelFlow === 'create' && (
                    <div style={{ marginBottom: 14, display: 'flex', gap: 10 }}>
                        <button style={{ ...S.btn, background: '#1a5a2a', flex: 1 }}
                            onClick={() => handleConnect('create')}>
                            ➕ إنشاء غرفة
                        </button>
                        <button style={{ ...S.btn, background: '#1a2a5a', flex: 1 }}
                            onClick={() => setDuelFlow('join')}>
                            🔗 إدخال رمز
                        </button>
                    </div>
                )}

                {/* DUEL — Join input */}
                {mode === 'duel' && duelFlow === 'join' && (
                    <div style={{ marginBottom: 14 }}>
                        <input style={S.input} placeholder="أدخل رمز الغرفة..."
                            value={joinCode} onChange={e => setJoinCode(e.target.value)}
                            maxLength={30} autoFocus />
                    </div>
                )}

                {/* ── SQUAD sub-options ── */}
                {mode === 'squad' && squadFlow === 'none' && (
                    <div style={{ marginBottom: 16 }}>
                        <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12, textAlign: 'center', marginBottom: 10 }}>
                            اختر فريقك — كل فريق يحصل على رمز خاص
                        </div>
                        <div style={{ display: 'flex', gap: 10 }}>
                            <button style={{ ...S.btn, background: '#6b0a0a', flex: 1 }}
                                onClick={() => { setSquadFlow('create_red'); handleConnect(undefined, 'create_red'); }}>
                                🔴 إنشاء (أحمر)
                            </button>
                            <button style={{ ...S.btn, background: '#0a1f6b', flex: 1 }}
                                onClick={() => { setSquadFlow('create_blue'); handleConnect(undefined, 'create_blue'); }}>
                                🔵 إنشاء (أزرق)
                            </button>
                            <button style={{ ...S.btn, background: '#1a4a1a', flex: 1 }}
                                onClick={() => setSquadFlow('join')}>
                                🔗 انضم برمز
                            </button>
                        </div>
                    </div>
                )}

                {/* SQUAD — Join input */}
                {mode === 'squad' && squadFlow === 'join' && (
                    <div style={{ marginBottom: 14 }}>
                        <input style={S.input} placeholder="أدخل رمز الفريق (ينتهي بـ -R أو -B)..."
                            value={joinCode} onChange={e => setJoinCode(e.target.value)}
                            maxLength={30} autoFocus />
                    </div>
                )}

                {/* Status */}
                {status && (
                    <div style={{ textAlign: 'center', marginBottom: 12, fontSize: 13, color: status.startsWith('❌') ? '#ff6666' : 'rgba(255,255,255,0.5)' }}>
                        {busy && <span style={{ marginLeft: 6 }}>⟳</span>} {status}
                    </div>
                )}

                {/* Action buttons */}
                <div style={S.btnRow}>
                    <button style={{ ...S.btn, background: '#333', flex: 1 }} onClick={onBack} disabled={busy}>
                        ← رجوع
                    </button>

                    {mode === 'war' && (
                        <button style={{ ...S.btn, background: busy ? '#555' : '#ff8833', flex: 2, fontSize: 15 }}
                            onClick={() => handleConnect()} disabled={busy}>
                            {busy ? '⟳...' : '💀 ادخل الحرب'}
                        </button>
                    )}

                    {mode === 'duel' && duelFlow === 'join' && (
                        <button style={{ ...S.btn, background: busy ? '#555' : '#ff4455', flex: 2, fontSize: 15 }}
                            onClick={() => handleConnect('join')} disabled={busy}>
                            {busy ? '⟳...' : '🚀 انضم'}
                        </button>
                    )}

                    {mode === 'squad' && squadFlow === 'join' && (
                        <button style={{ ...S.btn, background: busy ? '#555' : '#4488ff', flex: 2, fontSize: 15 }}
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
        <div style={{ flex: 1, background: `${color}12`, border: `1px solid ${color}44`, borderRadius: 12, padding: '14px 14px', textAlign: 'center', minWidth: 140 }}>
            <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 11, marginBottom: 6 }}>{label}</div>
            <div style={{ color, fontFamily: 'monospace', fontSize: 14, fontWeight: 700, letterSpacing: 1, wordBreak: 'break-all' }}>{code}</div>
            <button onClick={() => { navigator.clipboard.writeText(code).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
                style={{ marginTop: 8, padding: '5px 14px', borderRadius: 6, border: 'none', background: color + '33', color: '#fff', fontSize: 11, cursor: 'pointer' }}>
                {copied ? '✅ تم النسخ' : '📋 نسخ الرمز'}
            </button>
        </div>
    );
}

function TeamColumn({ title, players, color, myName, isHost, room }: any) {
    return (
        <div style={{ flex: 1 }}>
            <div style={{ color, fontWeight: 700, fontSize: 13, marginBottom: 8 }}>{title} ({players.length})</div>
            {players.length === 0
                ? <div style={{ color: 'rgba(255,255,255,0.2)', fontSize: 12, padding: 8 }}>في انتظار لاعبين...</div>
                : players.map((p: PlayerEntry) => <PlayerRow key={p.sessionId} player={p} myName={myName} isHost={isHost} room={room} showTeamSwitch />)
            }
        </div>
    );
}

function PlayerRow({ player, myName, isHost, room, showTeamSwitch }: any) {
    const isMe = player.name === myName;
    const canControl = isHost && !isMe;
    return (
        <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '6px 10px', borderRadius: 8, marginBottom: 4,
            background: isMe ? 'rgba(68,255,170,0.10)' : 'rgba(255,255,255,0.03)',
            border: isMe ? '1px solid rgba(68,255,170,0.25)' : '1px solid transparent',
        }}>
            <span style={{ fontSize: 15 }}>{isMe ? '👤' : '🎮'}</span>
            <span style={{ flex: 1, fontSize: 13, color: isMe ? '#44ffaa' : '#cdd' }}>{player.name}</span>
            {isMe && <span style={{ fontSize: 10, color: '#44ffaa' }}>أنت</span>}
            {canControl && showTeamSwitch && (
                <button onClick={() => room?.send('move_team', { targetId: player.sessionId })}
                    style={{ padding: '2px 7px', borderRadius: 5, border: 'none', background: 'rgba(100,150,255,0.2)', color: '#88aaff', fontSize: 11, cursor: 'pointer' }}>🔄</button>
            )}
            {canControl && (
                <button onClick={() => room?.send('kick_player', { targetId: player.sessionId })}
                    style={{ padding: '2px 7px', borderRadius: 5, border: 'none', background: 'rgba(255,60,60,0.2)', color: '#ff6666', fontSize: 11, cursor: 'pointer' }}>❌</button>
            )}
        </div>
    );
}

/* ─── Styles ─── */
const S: Record<string, React.CSSProperties> = {
    overlay: {
        position: 'fixed', inset: 0,
        background: 'radial-gradient(ellipse at center, #0a0e27 0%, #000 100%)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 9999, fontFamily: "'Outfit', sans-serif", direction: 'rtl',
    },
    card: {
        background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.10)',
        borderRadius: 20, padding: '28px 24px',
        width: '100%', maxWidth: 540, color: '#fff',
        backdropFilter: 'blur(12px)', boxShadow: '0 0 60px rgba(0,150,255,0.12)',
        maxHeight: '90vh', overflowY: 'auto',
    },
    header: { textAlign: 'center' as const, marginBottom: 20 },
    title: { margin: 0, fontSize: 24, fontWeight: 700 },
    sub: { margin: '4px 0 0', color: 'rgba(255,255,255,0.5)', fontSize: 13 },
    modeRow: { display: 'flex', gap: 10, marginBottom: 18 },
    modeCard: { flex: 1, borderRadius: 14, padding: '14px 8px', textAlign: 'center' as const, transition: 'all 0.2s' },
    modeSub: { color: '#aab', fontSize: 12, margin: '4px 0 2px' },
    modeDesc: { color: 'rgba(255,255,255,0.3)', fontSize: 10, lineHeight: 1.4 },
    input: {
        width: '100%', padding: '10px 14px',
        background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)',
        borderRadius: 10, color: '#fff', fontSize: 15, outline: 'none',
        boxSizing: 'border-box' as const, textAlign: 'center' as const, letterSpacing: 2,
        fontFamily: "'Outfit', monospace",
    },
    btnRow: { display: 'flex', gap: 10, marginTop: 4 },
    btn: {
        padding: '11px 18px', borderRadius: 10, border: 'none',
        color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer',
        fontFamily: "'Outfit', sans-serif", transition: 'opacity 0.2s',
    },
    playerSection: {
        background: 'rgba(255,255,255,0.03)', borderRadius: 12,
        padding: '14px 14px', marginBottom: 14,
        border: '1px solid rgba(255,255,255,0.06)',
    },
    sectionTitle: { fontWeight: 700, fontSize: 13, marginBottom: 10, color: 'rgba(255,255,255,0.55)' },
};
