import React, { useState, useCallback } from 'react';
import { network } from '../game/multiplayer/NetworkManager';

interface PEntry { name: string; team: string; sessionId: string; avatarUrl?: string }

interface Props {
    uid: string;
    playerName: string;
    avatarUrl?: string;
    onMatchFound: (info: { mode: string; roomId: string; mazeSeed?: number; mazeGrid?: any[]; trapPositions?: any[] }) => void;
    onBack: () => void;
}

export default function WarLobby({ uid, playerName, avatarUrl = '', onBack, onMatchFound }: Props) {
    const [status, setStatus] = useState('');
    const [busy, setBusy] = useState(false);
    const [waiting, setWaiting] = useState(false);
    const [players, setPlayers] = useState<PEntry[]>([]);
    const [countdown, setCountdown] = useState<number | null>(null);

    const listenRoom = useCallback((room: any) => {
        room.onMessage('war_roster', ({ players: r }: any) => setPlayers(r));
        room.onMessage('countdown', ({ seconds }: any) => {
            setCountdown(seconds);
            setStatus(`🔥 تبدأ خلال ${seconds}...`);
        });
        room.onMessage('war_fill_started', () => setStatus('⚡ يتم ملء القائمة...'));
        room.onMessage('game_started', (data: any) => {
            network.gameStartedData = data;
            onMatchFound({ mode: 'war', roomId: room.id, mazeSeed: data?.seed || 0, mazeGrid: data?.grid, trapPositions: data?.trapPositions });
        });
    }, [onMatchFound]);

    const handleConnect = async () => {
        if (busy) return;
        setBusy(true);
        setStatus('جارِ الاتصال...');
        try {
            network.connect();
            const room = await network.joinOrCreate('war', { uid, name: playerName, avatarUrl });
            setWaiting(true); setBusy(false);
            listenRoom(room);
        } catch (e) {
            console.error('[WarLobby]', e);
            setStatus('❌ فشل الاتصال');
            setBusy(false);
        }
    };

    const handleLeave = async () => {
        await network.leave();
        setWaiting(false); setPlayers([]); setCountdown(null);
        setStatus(''); setBusy(false);
    };

    if (waiting) {
        return (
            <div style={S.overlay}>
                <div style={{ ...S.card, maxWidth: 660 }}>
                    <div style={S.header}>
                        <div style={{ fontSize: 36 }}>
                            {countdown != null ? <span style={S.cdText}>{countdown}</span> : '💀'}
                        </div>
                        <h2 style={{ margin: '8px 0 4px', fontSize: 20 }}>وضع البقاء (War)</h2>
                        <p style={S.sub}>{status}</p>
                    </div>
                    <div style={S.playerSection}>
                        <div style={{ ...S.sectionTitle, display: 'flex', justifyContent: 'space-between' }}>
                            <span>قائمة المحاربين</span>
                            <span style={{ color: '#ffaa33' }}>{players.length} / 20</span>
                        </div>
                        <div style={S.rosterGrid}>
                            {Array.from({ length: 20 }).map((_, i) => {
                                const p = players[i];
                                return (
                                    <div key={i} style={{
                                        ...S.slot,
                                        background: p ? 'rgba(68,255,170,0.06)' : 'rgba(255,255,255,0.02)',
                                        border: `1px solid ${p ? 'rgba(68,255,170,0.15)' : 'rgba(255,255,255,0.04)'}`
                                    }}>
                                        <span style={{ fontSize: 14, opacity: p ? 1 : 0.2 }}>{p ? '👤' : (i+1)}</span>
                                        <span style={{ fontSize: 12, color: p ? '#cde' : 'rgba(255,255,255,0.12)' }}>{p ? p.name : '— فارغ —'}</span>
                                        {p?.name === playerName && <span style={S.youTag}>أنت</span>}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                    <button style={{ ...S.btn, background: '#222', width: '100%', marginTop: 16 }} onClick={handleLeave}>← مغادرة / رجوع</button>
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
                    <h1 style={{ margin: 0, fontSize: 24 }}>💀 وضع البقاء (War)</h1>
                    <p style={S.sub}>الجميع ضد الجميع — الناجي الأخير يفوز (حتى 20 لاعباً)</p>
                </div>
                <div style={{ textAlign: 'center', margin: '20px 0' }}>
                    {status && <div style={{ color: 'rgba(255,255,255,0.6)', marginBottom: 10 }}>{status}</div>}
                    <button style={{ ...S.btn, background: '#ff8833', width: '100%', fontSize: 16 }} onClick={handleConnect} disabled={busy}>
                        {busy ? '⟳ جارِ الدخول...' : '💀 ادخل المعركة الآن'}
                    </button>
                </div>
                <button style={{ ...S.btn, background: '#333', width: '100%' }} onClick={onBack}>← رجوع</button>
            </div>
        </div>
    );
}

const S: any = {
    overlay: { position:'fixed', inset:0, background:'radial-gradient(ellipse at center,#0a0e27 0%,#000 100%)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:9999, direction:'rtl' },
    card: { background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.10)', borderRadius:20, padding:'28px 24px', width:'100%', maxWidth:540, color:'#fff', backdropFilter:'blur(12px)', maxHeight:'90vh', overflowY:'auto' },
    header: { textAlign:'center', marginBottom:20 },
    sub: { margin:'4px 0 0', color:'rgba(255,255,255,0.5)', fontSize:13 },
    cdText: { color: '#ff4455', fontWeight: 900, fontSize: 52 },
    btn: { padding:'11px 18px', borderRadius:10, border:'none', color:'#fff', fontWeight:700, cursor:'pointer' },
    playerSection: { background:'rgba(255,255,255,0.03)', borderRadius:12, padding:'14px', marginBottom:14, border:'1px solid rgba(255,255,255,0.06)' },
    sectionTitle: { fontWeight:700, fontSize:13, marginBottom:10, color:'rgba(255,255,255,0.55)' },
    rosterGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 },
    slot: { display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px', borderRadius: 8, transition: 'all 0.4s' },
    youTag: { fontSize: 10, color: '#44ffaa', marginRight: 'auto' }
};
