/**
 * OnlineLobby — Full-featured lobby screen before an online match.
 * Features:
 *  - Mode selection: Duel (1v1), Squad (4v4 teams), War (20 FFA)
 *  - Squad has TWO separate room codes: one for each team (Red/Blue)
 *  - Live player list showing who's in the room and their team
 *  - Countdown before game starts
 *  - Connection status feedback
 */
import React, { useState, useEffect, useCallback } from 'react';
import { network } from '../game/multiplayer/NetworkManager';

/* ─────────── Mode definitions ─────────── */
const MODES = [
    {
        id: 'war',
        emoji: '💀',
        label: 'حرب',
        sub: '20 لاعباً',
        desc: 'الجميع ضد الجميع — الناجي الأخير يفوز',
        color: '#ff8833',
        maxPlayers: 20,
    },
    {
        id: 'squad',
        emoji: '🛡️',
        label: 'فرقة',
        sub: 'حتى 4 × 4',
        desc: 'فريقك ضد الفريق المنافس',
        color: '#4488ff',
        maxPlayers: 8,
    },
    {
        id: 'duel',
        emoji: '⚔️',
        label: 'مبارزة',
        sub: '1 ضد 1',
        desc: 'قتال مباشر بينك وبين خصم واحد',
        color: '#ff4455',
        maxPlayers: 2,
    },
] as const;

type ModeId = 'war' | 'squad' | 'duel';
type SquadFlow = 'none' | 'create_red' | 'create_blue' | 'join';

interface PlayerEntry { name: string; team: string; sessionId: string }

interface Props {
    uid: string;
    playerName: string;
    onMatchFound: (roomInfo: { mode: string; roomId: string }) => void;
    onBack: () => void;
}

/* ─────────── Component ─────────── */
export default function OnlineLobby({ uid, playerName, onBack, onMatchFound }: Props) {
    const [mode, setMode] = useState<ModeId>('war');
    const [squadFlow, setSquadFlow] = useState<SquadFlow>('none');
    const [joinCode, setJoinCode] = useState('');
    const [status, setStatus] = useState('');
    const [busy, setBusy] = useState(false);

    // Waiting room state
    const [waiting, setWaiting] = useState(false);
    const [redCode, setRedCode] = useState('');
    const [blueCode, setBlueCode] = useState('');
    const [singleCode, setSingleCode] = useState('');
    const [players, setPlayers] = useState<PlayerEntry[]>([]);
    const [countdown, setCountdown] = useState<number | null>(null);
    const [myTeam, setMyTeam] = useState<string>('');
    const [isHost, setIsHost] = useState(false);
    const [roomRef, setRoomRef] = useState<any>(null);

    /* ── Listen to room messages after joining ── */
    const listenRoom = useCallback((room: any, resolvedMode: ModeId) => {
        setRoomRef(room);
        // Player list updates
        room.onMessage('lobby_players', (list: PlayerEntry[]) => {
            setPlayers(list);
            const me = list.find((p: PlayerEntry) => p.sessionId === room.sessionId);
            if (me) setMyTeam(me.team);
        });
        // Host status
        room.onMessage('host_status', ({ isHost: h }: { isHost: boolean }) => {
            setIsHost(h);
        });
        room.onMessage('new_host', ({ hostId }: { hostId: string }) => {
            setIsHost(room.sessionId === hostId);
        });
        // Countdown
        room.onMessage('countdown', ({ seconds }: { seconds: number | null }) => {
            setCountdown(seconds);
            if (seconds != null) setStatus(`🔥 تبدأ المباراة خلال ${seconds} ثوانٍ...`);
            else setStatus('في انتظار اللاعبين...');
        });
        // Game started
        room.onMessage('game_started', () => {
            onMatchFound({ mode: resolvedMode, roomId: room.id });
        });
        // Kicked
        room.onMessage('error', ({ msg }: { msg: string }) => {
            setStatus(`❌ ${msg}`);
            setBusy(false);
        });
    }, [onMatchFound]);

    /* ── Main connect handler ── */
    const handleConnect = async (overrideFlow?: SquadFlow) => {
        if (busy) return;
        setBusy(true);
        const flow = overrideFlow ?? squadFlow;
        setStatus('جارِ الاتصال بالسيرفر...');

        try {
            network.connect();

            /* ── Squad: Create Red team room ── */
            if (mode === 'squad' && flow === 'create_red') {
                const { room, roomId: rid } = await network.createPrivateRoom({ uid, name: playerName });
                // The server will also provide a blue code via message; we'll use the room id as red code
                setSingleCode('');
                setRedCode(rid);
                setStatus('انتظار اللاعبين...');
                setWaiting(true);
                setBusy(false);
                room.onMessage('blue_room_code', ({ code }: { code: string }) => setBlueCode(code));
                listenRoom(room, 'squad');
                return;
            }

            /* ── Squad: Create Blue team room ── */
            if (mode === 'squad' && flow === 'create_blue') {
                const { room, roomId: rid } = await network.createPrivateRoom({ uid, name: playerName, team: 'blue' } as any);
                setSingleCode('');
                setBlueCode(rid);
                setStatus('انتظار اللاعبين...');
                setWaiting(true);
                setBusy(false);
                room.onMessage('red_room_code', ({ code }: { code: string }) => setRedCode(code));
                listenRoom(room, 'squad');
                return;
            }

            /* ── Squad: Join by code ── */
            if (mode === 'squad' && flow === 'join') {
                const fullCode = joinCode.trim().toUpperCase();
                if (!fullCode) { setStatus('⚠️ أدخل رمز الغرفة أولاً'); setBusy(false); return; }
                
                // Strip -R or -B for the actual Colyseus internal roomId
                let baseId = fullCode;
                let reqTeam = '';
                if (fullCode.endsWith('-R')) { baseId = fullCode.slice(0, -2); reqTeam = 'red'; }
                if (fullCode.endsWith('-B')) { baseId = fullCode.slice(0, -2); reqTeam = 'blue'; }

                const room = await network.joinOrCreate('squad', { uid, name: playerName, roomCode: baseId, reqTeam });
                setStatus('انضممت! انتظار بدء المباراة...');
                setWaiting(true);
                setBusy(false);
                listenRoom(room, 'squad');
                return;
            }

            /* ── Duel / War ── */
            const room = await network.joinOrCreate(mode, { uid, name: playerName });
            setSingleCode(room.id);
            setStatus(mode === 'duel' ? 'جارِ البحث عن خصم...' : 'في انتظار لاعبين آخرين...');
            setWaiting(true);
            setBusy(false);
            listenRoom(room, mode);

        } catch (e: any) {
            console.error(e);
            setStatus('❌ خطأ في الاتصال — تأكد أن السيرفر يعمل');
            setBusy(false);
        }
    };

    const handleLeave = async () => {
        await network.leave();
        setWaiting(false);
        setPlayers([]);
        setRedCode(''); setBlueCode(''); setSingleCode('');
        setCountdown(null);
        setStatus('');
        setSquadFlow('none');
        setBusy(false);
    };

    /* ── Countdown spinner color ── */
    const cdColor = countdown !== null ? (countdown <= 3 ? '#ff4455' : countdown <= 5 ? '#ffaa33' : '#44ffaa') : '#44ffaa';

    /* ────────────────────────────────────────────
       WAITING ROOM SCREEN
    ──────────────────────────────────────────── */
    if (waiting) {
        const redPlayers = players.filter(p => p.team === 'red');
        const bluePlayers = players.filter(p => p.team === 'blue');
        const noTeamPlayers = players.filter(p => p.team === 'none' || !p.team);

        return (
            <div style={S.overlay}>
                <div style={{ ...S.card, maxWidth: 640 }}>
                    {/* Header */}
                    <div style={S.header}>
                        <div style={{ fontSize: 32 }}>
                            {countdown !== null ? <span style={{ color: cdColor, fontWeight: 900, fontSize: 48 }}>{countdown}</span> : '⏳'}
                        </div>
                        <h2 style={{ margin: '8px 0 4px', fontSize: 22 }}>
                            {countdown !== null ? `تبدأ خلال ${countdown}...` : 'في انتظار اللاعبين'}
                        </h2>
                        <p style={S.statusText}>{status}</p>
                    </div>

                    {/* Room codes */}
                    {(redCode || blueCode || singleCode) && (
                        <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
                            {singleCode && (
                                <CodeBox label="رمز الغرفة" code={singleCode} color="#44ffaa" />
                            )}
                            {redCode && <CodeBox label="رمز الفريق الأحمر 🔴" code={redCode} color="#ff4455" />}
                            {blueCode && <CodeBox label="رمز الفريق الأزرق 🔵" code={blueCode} color="#4488ff" />}
                        </div>
                    )}

                    {/* Player list */}
                    {players.length > 0 && (
                        <div style={S.playerSection}>
                            <div style={S.sectionTitle}>اللاعبون ({players.length})</div>
                            {mode === 'squad' ? (
                                <div style={{ display: 'flex', gap: 16 }}>
                                    <TeamColumn title="🔴 الفريق الأحمر" players={redPlayers} color="#ff4455" myTeam={myTeam} myName={playerName} isHost={isHost} room={roomRef} />
                                    <TeamColumn title="🔵 الفريق الأزرق" players={bluePlayers} color="#4488ff" myTeam={myTeam} myName={playerName} isHost={isHost} room={roomRef} />
                                </div>
                            ) : (
                                <div style={S.playerList}>
                                    {(noTeamPlayers.length ? noTeamPlayers : players).map(p => (
                                        <PlayerRow key={p.sessionId} player={p} myName={playerName} isHost={isHost} room={roomRef} />
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {players.length === 0 && (
                        <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.3)', padding: '24px 0', fontSize: 14 }}>
                            <div style={{ fontSize: 40, marginBottom: 8 }}>🕐</div>
                            جارِ الانتظار... شارك الرمز مع أصدقائك
                        </div>
                    )}

                    {/* Host controls */}
                    {isHost && countdown === null && (
                        <div style={{ background: 'rgba(68,255,170,0.06)', border: '1px solid rgba(68,255,170,0.2)', borderRadius: 12, padding: '12px 16px', marginBottom: 12, textAlign: 'center' }}>
                            <div style={{ color: '#44ffaa', fontSize: 12, marginBottom: 10 }}>👑 أنت صاحب الغرفة</div>
                            <button
                                style={{ ...S.btn, background: '#22aa66', width: '100%', fontSize: 15 }}
                                onClick={() => roomRef?.send('host_start')}
                            >
                                🚀 ابدأ المباراة الآن
                            </button>
                        </div>
                    )}

                    <button style={{ ...S.btn, background: '#333', marginTop: 8, width: '100%' }} onClick={handleLeave}>
                        ← مغادرة الغرفة
                    </button>
                </div>
            </div>
        );
    }

    /* ────────────────────────────────────────────
       MODE SELECTION SCREEN
    ──────────────────────────────────────────── */
    const selectedMode = MODES.find(m => m.id === mode)!;

    return (
        <div style={S.overlay}>
            <div style={S.card}>
                {/* Header */}
                <div style={S.header}>
                    <h1 style={S.title}>🌐 اللعب أونلاين</h1>
                    <p style={S.sub}>مرحباً <strong>{playerName}</strong> — اختر وضع اللعب</p>
                </div>

                {/* Mode cards */}
                <div style={S.modeRow}>
                    {MODES.map(m => (
                        <div
                            key={m.id}
                            style={{
                                ...S.modeCard,
                                border: `2px solid ${mode === m.id ? m.color : 'rgba(255,255,255,0.08)'}`,
                                background: mode === m.id ? `${m.color}22` : 'rgba(255,255,255,0.03)',
                                cursor: busy ? 'not-allowed' : 'pointer',
                                transform: mode === m.id ? 'scale(1.03)' : 'scale(1)',
                            }}
                            onClick={() => { if (!busy) { setMode(m.id); setSquadFlow('none'); } }}
                        >
                            <div style={{ fontSize: 34 }}>{m.emoji}</div>
                            <div style={{ color: m.color, fontWeight: 700, fontSize: 17, marginTop: 6 }}>{m.label}</div>
                            <div style={S.modeSub}>{m.sub}</div>
                            <div style={S.modeDesc}>{m.desc}</div>
                        </div>
                    ))}
                </div>

                {/* Squad sub-options */}
                {mode === 'squad' && squadFlow === 'none' && (
                    <div style={{ marginBottom: 16 }}>
                        <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, textAlign: 'center', marginBottom: 10 }}>
                            كل فريق سيحصل على رمز خاص — شارك رمز فريقك مع زملائك فقط
                        </div>
                        <div style={{ display: 'flex', gap: 10 }}>
                            <button style={{ ...S.btn, background: '#8b1a1a', flex: 1 }} onClick={() => setSquadFlow('create_red')}>
                                🔴 أنشئ غرفة (أحمر)
                            </button>
                            <button style={{ ...S.btn, background: '#1a3a8b', flex: 1 }} onClick={() => setSquadFlow('create_blue')}>
                                🔵 أنشئ غرفة (أزرق)
                            </button>
                            <button style={{ ...S.btn, background: '#2a5a2a', flex: 1 }} onClick={() => setSquadFlow('join')}>
                                🔗 انضم برمز
                            </button>
                        </div>
                    </div>
                )}

                {/* Join code input */}
                {mode === 'squad' && squadFlow === 'join' && (
                    <div style={{ marginBottom: 14 }}>
                        <input
                            style={S.input}
                            placeholder="أدخل رمز الغرفة..."
                            value={joinCode}
                            onChange={e => setJoinCode(e.target.value.toUpperCase())}
                            maxLength={20}
                            autoFocus
                        />
                    </div>
                )}

                {/* Status */}
                {status && (
                    <div style={S.statusText}>
                        {busy && <span style={{ marginLeft: 6, display: 'inline-block', animation: 'spin 1s linear infinite' }}>⟳</span>}
                        {status}
                    </div>
                )}

                {/* Action buttons */}
                <div style={S.btnRow}>
                    <button style={{ ...S.btn, background: '#333', flex: 1 }} onClick={onBack} disabled={busy}>
                        ← رجوع
                    </button>

                    {/* Squad: only show Start button when a sub-flow is selected */}
                    {mode !== 'squad' && (
                        <button
                            style={{ ...S.btn, background: busy ? '#555' : selectedMode.color, flex: 2, fontSize: 15, opacity: busy ? 0.7 : 1 }}
                            onClick={() => handleConnect()}
                            disabled={busy}
                        >
                            {busy ? '⟳ جارِ الاتصال...' : '🚀 ابدأ المباراة'}
                        </button>
                    )}

                    {mode === 'squad' && squadFlow !== 'none' && (
                        <button
                            style={{ ...S.btn, background: busy ? '#555' : '#4488ff', flex: 2, fontSize: 15, opacity: busy ? 0.7 : 1 }}
                            onClick={() => handleConnect(squadFlow)}
                            disabled={busy}
                        >
                            {busy ? '⟳ جارِ الاتصال...' : '🚀 تأكيد'}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}

/* ─────────── Sub-components ─────────── */
function CodeBox({ label, code, color }: { label: string; code: string; color: string }) {
    const [copied, setCopied] = useState(false);
    const copy = () => {
        navigator.clipboard.writeText(code).catch(() => {});
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };
    return (
        <div style={{ flex: 1, background: `${color}15`, border: `1px solid ${color}55`, borderRadius: 12, padding: '12px 16px', textAlign: 'center', minWidth: 160 }}>
            <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, marginBottom: 4 }}>{label}</div>
            <div style={{ color, fontFamily: 'monospace', fontSize: 15, fontWeight: 700, letterSpacing: 2, wordBreak: 'break-all' }}>{code}</div>
            <button
                onClick={copy}
                style={{ marginTop: 8, padding: '4px 10px', borderRadius: 6, border: 'none', background: color + '33', color: '#fff', fontSize: 12, cursor: 'pointer' }}
            >
                {copied ? '✅ تم النسخ' : '📋 نسخ'}
            </button>
        </div>
    );
}

function TeamColumn({ title, players, color, myTeam, myName, isHost, room }: { title: string; players: PlayerEntry[]; color: string; myTeam: string; myName: string; isHost?: boolean; room?: any }) {
    return (
        <div style={{ flex: 1 }}>
            <div style={{ color, fontWeight: 700, fontSize: 13, marginBottom: 8 }}>{title} ({players.length})</div>
            {players.length === 0 ? (
                <div style={{ color: 'rgba(255,255,255,0.2)', fontSize: 12, padding: 8 }}>في انتظار لاعبين...</div>
            ) : (
                players.map(p => <PlayerRow key={p.sessionId} player={p} myName={myName} isHost={isHost} room={room} showTeamSwitch={true} />)
            )}
        </div>
    );
}

function PlayerRow({ player, myName, isHost, room, showTeamSwitch }: { player: PlayerEntry; myName: string; isHost?: boolean; room?: any; showTeamSwitch?: boolean }) {
    const isMe = player.name === myName;
    const canControl = isHost && !isMe;
    return (
        <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '6px 10px', borderRadius: 8, marginBottom: 4,
            background: isMe ? 'rgba(68,255,170,0.12)' : 'rgba(255,255,255,0.04)',
            border: isMe ? '1px solid rgba(68,255,170,0.3)' : '1px solid transparent',
        }}>
            <span style={{ fontSize: 16 }}>{isMe ? '👤' : '🎮'}</span>
            <span style={{ flex: 1, fontSize: 13, color: isMe ? '#44ffaa' : '#cdd' }}>{player.name}</span>
            {isMe && <span style={{ fontSize: 11, color: '#44ffaa', opacity: 0.7 }}>أنت</span>}
            {canControl && (
                <>
                    {showTeamSwitch && (
                        <button onClick={() => room?.send('move_team', { targetId: player.sessionId })}
                            style={{ padding: '2px 7px', borderRadius: 5, border: 'none', background: 'rgba(100,150,255,0.2)', color: '#88aaff', fontSize: 11, cursor: 'pointer' }}
                            title="نقل الفريق">
                            🔄
                        </button>
                    )}
                    <button onClick={() => room?.send('kick_player', { targetId: player.sessionId })}
                        style={{ padding: '2px 7px', borderRadius: 5, border: 'none', background: 'rgba(255,60,60,0.2)', color: '#ff6666', fontSize: 11, cursor: 'pointer' }}
                        title="طرد">
                        ❌
                    </button>
                </>
            )}
        </div>
    );
}

/* ─────────── Styles ─────────── */
const S: Record<string, React.CSSProperties> = {
    overlay: {
        position: 'fixed', inset: 0,
        background: 'radial-gradient(ellipse at center, #0a0e27 0%, #000 100%)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 9999, fontFamily: "'Outfit', sans-serif", direction: 'rtl',
    },
    card: {
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.10)',
        borderRadius: 20, padding: '32px 28px',
        width: '100%', maxWidth: 580, color: '#fff',
        backdropFilter: 'blur(12px)',
        boxShadow: '0 0 60px rgba(0,150,255,0.12)',
    },
    header: { textAlign: 'center', marginBottom: 24 },
    title: { margin: 0, fontSize: 26, fontWeight: 700 },
    sub: { margin: '6px 0 0', color: 'rgba(255,255,255,0.5)', fontSize: 14 },
    modeRow: { display: 'flex', gap: 12, marginBottom: 20 },
    modeCard: {
        flex: 1, borderRadius: 14, padding: '16px 10px',
        textAlign: 'center', transition: 'all 0.2s',
    },
    modeSub: { color: '#aab', fontSize: 13, margin: '4px 0 2px' },
    modeDesc: { color: 'rgba(255,255,255,0.35)', fontSize: 11, lineHeight: 1.4 },
    input: {
        width: '100%', padding: '10px 14px',
        background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)',
        borderRadius: 10, color: '#fff', fontSize: 16, outline: 'none',
        boxSizing: 'border-box', textAlign: 'center', letterSpacing: 2,
        fontFamily: "'Outfit', monospace",
    },
    statusText: {
        textAlign: 'center', color: 'rgba(255,255,255,0.55)', fontSize: 13,
        marginBottom: 12, minHeight: 20,
    },
    btnRow: { display: 'flex', gap: 10, marginTop: 4 },
    btn: {
        padding: '12px 20px', borderRadius: 10, border: 'none',
        color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer',
        fontFamily: "'Outfit', sans-serif", transition: 'opacity 0.2s',
    },
    playerSection: {
        background: 'rgba(255,255,255,0.03)', borderRadius: 12,
        padding: '14px 16px', marginBottom: 16,
        border: '1px solid rgba(255,255,255,0.07)',
    },
    sectionTitle: {
        fontWeight: 700, fontSize: 14, marginBottom: 12,
        color: 'rgba(255,255,255,0.6)',
    },
    playerList: { display: 'flex', flexDirection: 'column', gap: 4 },
};
