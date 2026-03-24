import React, { useState, useCallback, useRef } from 'react';
import { network } from '../game/multiplayer/NetworkManager';

type SquadFlow = 'none' | 'create_red' | 'create_blue' | 'join';
interface PEntry { name: string; team: string; sessionId: string; avatarUrl?: string }

interface Props {
    uid: string;
    playerName: string;
    avatarUrl?: string;
    onMatchFound: (info: { mode: string; roomId: string; mazeSeed?: number; mazeGrid?: any[]; trapPositions?: any[] }) => void;
    onBack: () => void;
}

export default function SquadLobby({ uid, playerName, avatarUrl = '', onBack, onMatchFound }: Props) {
    const [squadFlow, setSquadFlow] = useState<SquadFlow>('none');
    const [joinCode, setJoinCode] = useState('');
    const [status, setStatus] = useState('');
    const [busy, setBusy] = useState(false);
    const [waiting, setWaiting] = useState(false);
    const [players, setPlayers] = useState<PEntry[]>([]);
    const [countdown, setCountdown] = useState<number | null>(null);
    const [isHost, setIsHost] = useState(false);
    const [roomRef, setRoomRef] = useState<any>(null);
    const [redCode, setRedCode] = useState('');
    const [blueCode, setBlueCode] = useState('');

    const listenRoom = useCallback((room: any) => {
        setRoomRef(room);
        room.onMessage('lobby_players', (list: PEntry[]) => setPlayers(list));
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
        room.onMessage('game_started', (data: any) => {
            network.gameStartedData = data;
            onMatchFound({ mode: 'squad', roomId: room.id, mazeSeed: data?.seed || 0, mazeGrid: data?.grid, trapPositions: data?.trapPositions });
        });
    }, [onMatchFound]);

    const handleConnect = async (flow: SquadFlow) => {
        if (busy) return;
        setBusy(true);
        setStatus('جارِ الاتصال...');
        try {
            network.connect();
            if (flow === 'create_red' || flow === 'create_blue') {
                const team = flow === 'create_red' ? 'red' : 'blue';
                const { room } = await network.createPrivateRoom('squad', { uid, name: playerName, avatarUrl, reqTeam: team });
                setWaiting(true); setBusy(false);
                listenRoom(room);
            } else if (flow === 'join') {
                const full = joinCode.trim();
                if (!full) { setStatus('⚠️ أدخل رمز الغرفة'); setBusy(false); return; }
                let baseId = full, reqTeam = '';
                if (full.endsWith('-R')) { baseId = full.slice(0, -2); reqTeam = 'red'; }
                else if (full.endsWith('-B')) { baseId = full.slice(0, -2); reqTeam = 'blue'; }
                const room = await network.joinOrCreate('squad', { uid, name: playerName, avatarUrl, roomCode: baseId, reqTeam });
                setWaiting(true); setBusy(false);
                listenRoom(room);
            }
        } catch (e) {
            console.error('[SquadLobby]', e);
            setStatus('❌ فشل الاتصال');
            setBusy(false);
        }
    };

    const handleLeave = async () => {
        await network.leave();
        setWaiting(false); setPlayers([]); setCountdown(null);
        setRedCode(''); setBlueCode(''); setStatus(''); setSquadFlow('none'); setBusy(false);
    };

    if (waiting) {
        const redPlayers = players.filter(p => p.team === 'red');
        const bluePlayers = players.filter(p => p.team === 'blue');
        return (
            <div style={S.overlay}>
                <div style={S.card}>
                    <div style={S.header}>
                        <div style={{ fontSize: 36 }}>🛡️</div>
                        <h2 style={{ margin: '8px 0 4px', fontSize: 20 }}>وضع الفرق أونلاين</h2>
                        <p style={S.sub}>{status}</p>
                    </div>
                    {(redCode || blueCode) && (
                        <div style={{ display: 'flex', gap: 10, marginBottom: 18, flexWrap: 'wrap' }}>
                            {redCode && <CodeBox label="🔴 الفريق الأحمر" code={redCode} color="#ff4455" />}
                            {blueCode && <CodeBox label="🔵 الفريق الأزرق" code={blueCode} color="#4488ff" />}
                        </div>
                    )}
                    <div style={S.playerSection}>
                        <div style={S.sectionTitle}>اللاعبون ({players.length})</div>
                        <div style={{ display: 'flex', gap: 14 }}>
                            <TeamColumn title="🔴 الأحمر" players={redPlayers} color="#ff4455" myName={playerName} isHost={isHost} room={roomRef} />
                            <TeamColumn title="🔵 الأزرق" players={bluePlayers} color="#4488ff" myName={playerName} isHost={isHost} room={roomRef} />
                        </div>
                    </div>
                    {isHost && countdown == null && (
                        <div style={S.hostMsg}>
                            <div style={{ color: '#44ffaa', fontSize: 12, marginBottom: 10 }}>👑 أنت صاحب الغرفة</div>
                            <button style={{ ...S.btn, background: '#22aa66', width: '100%' }} onClick={() => roomRef?.send('host_start')}>🚀 ابدأ المباراة</button>
                        </div>
                    )}
                    <button style={{ ...S.btn, background: '#222', width: '100%', marginTop: 10 }} onClick={handleLeave}>← مغادرة / رجوع</button>
                    <div style={{ color: '#ff4444', fontSize: 13, textAlign: 'center', marginTop: 12, fontWeight: 'bold' }}>
                        ⚠️ هذا الوضع غير مكتمل لأنه مازال قيد التطوير. مسابقات الجوائز متاحة في وضع الأوفلاين فقط.
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div style={S.overlay}>
            <div style={S.card}>
                <div style={S.header}>
                    <h1 style={{ margin: 0, fontSize: 24 }}>🛡️ وضع الفرق</h1>
                    <p style={S.sub}>فريقك ضد الفريق المنافس (4 ضد 4)</p>
                </div>
                {squadFlow === 'none' && (
                    <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
                        <button style={{ ...S.btn, background: '#6b0a0a', flex: 1 }} onClick={() => { setSquadFlow('create_red'); handleConnect('create_red'); }}>🔴 إنشاء (أحمر)</button>
                        <button style={{ ...S.btn, background: '#0a1a6b', flex: 1 }} onClick={() => { setSquadFlow('create_blue'); handleConnect('create_blue'); }}>🔵 إنشاء (أزرق)</button>
                        <button style={{ ...S.btn, background: '#1a4a1a', flex: 1 }} onClick={() => setSquadFlow('join')}>🔗 انضم</button>
                    </div>
                )}
                {squadFlow === 'join' && (
                    <div style={{ marginBottom: 14 }}>
                        <input style={S.input} placeholder="أدخل رمز الفريق (-R أو -B)..." value={joinCode} onChange={e => setJoinCode(e.target.value)} maxLength={30} autoFocus />
                    </div>
                )}
                <div style={S.btnRow}>
                    <button style={{ ...S.btn, background: '#333', flex: 1 }} onClick={onBack}>← رجوع</button>
                    {squadFlow === 'join' && (
                        <button style={{ ...S.btn, background: '#4488ff', flex: 2 }} onClick={() => handleConnect('join')} disabled={busy}>🚀 انضم</button>
                    )}
                </div>
                <div style={{ color: '#ff4444', fontSize: 13, textAlign: 'center', marginTop: 16, fontWeight: 'bold' }}>
                    ⚠️ هذا الوضع غير مكتمل لأنه مازال قيد التطوير. مسابقات الجوائز متاحة في وضع الأوفلاين فقط.
                </div>
            </div>
        </div>
    );
}

const S: any = {
    overlay: { position:'fixed', inset:0, background:'radial-gradient(ellipse at center,#0a0e27 0%,#000 100%)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:9999, direction:'rtl' },
    card: { background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.10)', borderRadius:20, padding:'28px 24px', width:'100%', maxWidth:540, color:'#fff', backdropFilter:'blur(12px)', maxHeight:'90vh', overflowY:'auto' },
    header: { textAlign:'center', marginBottom:20 },
    sub: { margin:'4px 0 0', color:'rgba(255,255,255,0.5)', fontSize:13 },
    input: { width:'100%', padding:'10px 14px', background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.15)', borderRadius:10, color:'#fff', textAlign:'center', outline:'none' },
    btnRow: { display:'flex', gap:10, marginTop:10 },
    btn: { padding:'11px 18px', borderRadius:10, border:'none', color:'#fff', fontWeight:700, cursor:'pointer' },
    playerSection: { background:'rgba(255,255,255,0.03)', borderRadius:12, padding:'14px', marginBottom:14, border:'1px solid rgba(255,255,255,0.06)' },
    sectionTitle: { fontWeight:700, fontSize:13, marginBottom:10, color:'rgba(255,255,255,0.55)' },
    hostMsg: { background: 'rgba(68,255,170,0.06)', border: '1px solid rgba(68,255,170,0.2)', borderRadius: 12, padding: '12px 16px', textAlign: 'center' }
};

function CodeBox({ label, code, color }: any) {
    const [copied, setCopied] = useState(false);
    return (
        <div style={{ flex: 1, background: `${color}12`, border: `1px solid ${color}44`, borderRadius: 12, padding: '14px', textAlign: 'center', minWidth: 130 }}>
            <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, marginBottom: 6 }}>{label}</div>
            <div style={{ color, fontFamily: 'monospace', fontSize: 13, fontWeight: 700 }}>{code}</div>
            <button onClick={() => { navigator.clipboard.writeText(code); setCopied(true); setTimeout(()=>setCopied(false), 2000); }}
                style={{ marginTop: 8, padding: '4px 12px', borderRadius: 6, border: 'none', background: color + '33', color: '#fff', fontSize: 11, cursor: 'pointer' }}>
                {copied ? '✅ تم' : '📋 نسخ'}
            </button>
        </div>
    );
}

function TeamColumn({ title, players, color, myName, isHost, room }: any) {
    return (
        <div style={{ flex: 1 }}>
            <div style={{ color, fontWeight:700, fontSize:13, marginBottom:8 }}>{title} ({players.length})</div>
            {players.length === 0
                ? <div style={{ color:'rgba(255,255,255,0.2)', fontSize:12, padding:8 }}>في انتظار لاعبين...</div>
                : players.map((p: any) => (
                    <div key={p.sessionId} style={{ display:'flex', alignItems:'center', gap:8, padding:'6px 10px', borderRadius:8, marginBottom:4, background: p.name === myName ? 'rgba(68,255,170,0.1)' : 'rgba(255,255,255,0.03)' }}>
                        <span style={{ fontSize:15 }}>{p.name === myName ? '👤' : '🎮'}</span>
                        <span style={{ flex:1, fontSize:13, color: p.name === myName ? '#44ffaa' : '#cdd' }}>{p.name}</span>
                        {isHost && p.name !== myName && (
                            <>
                                <button onClick={() => room?.send('move_team', { targetId: p.sessionId })} style={{ padding:'2px 7px', borderRadius:5, border:'none', background:'rgba(100,150,255,0.2)', color:'#88aaff', fontSize:11, cursor:'pointer' }}>🔄</button>
                                <button onClick={() => room?.send('kick_player', { targetId: p.sessionId })} style={{ padding:'2px 7px', borderRadius:5, border:'none', background:'rgba(255,60,60,0.2)', color:'#ff6666', fontSize:11, cursor:'pointer' }}>❌</button>
                            </>
                        )}
                    </div>
                ))
            }
        </div>
    );
}
