/**
 * OnlineLobby — Full-screen lobby screen before an online match.
 * Supports 3 modes: 1v1 (Duel), Squad (4v4), War (20 FFA).
 * Shows room code for Squad, auto-matchmakes for War/Duel.
 */
import React, { useState, useEffect, useRef } from 'react';
import { network } from '../game/multiplayer/NetworkManager';

const MODES = [
    {
        id: 'duel',
        label: '⚔️ مبارزة',
        sub: '1 ضد 1',
        desc: 'قتال مباشر بينك وبين خصم واحد',
        color: '#ff4455',
        maxPlayers: 2,
    },
    {
        id: 'squad',
        label: '🛡️ فرقة',
        sub: 'حتى 4 × 4',
        desc: 'فريقك الأحمر ضد الفريق الأزرق',
        color: '#4488ff',
        maxPlayers: 8,
    },
    {
        id: 'war',
        label: '💀 حرب',
        sub: '20 لاعباً',
        desc: 'الجميع ضد الجميع — الناجي الأخير يفوز',
        color: '#ff8833',
        maxPlayers: 20,
    },
];

interface Props {
    uid: string;
    playerName: string;
    onMatchFound: (roomInfo: { mode: string; roomId: string }) => void;
    onBack: () => void;
}

export default function OnlineLobby({ uid, playerName, onMatchFound, onBack }: Props) {
    const [selectedMode, setSelectedMode] = useState<string>('war');
    const [roomCode, setRoomCode] = useState('');
    const [joining, setJoining] = useState(false);
    const [status, setStatus] = useState('');
    const [generatedCode, setGeneratedCode] = useState('');
    const [createOrJoin, setCreateOrJoin] = useState<'none' | 'create' | 'join'>('none');

    const handleStart = async () => {
        if (joining) return;
        setJoining(true);
        setStatus('جارِ البحث عن خصم...');

        try {
            network.connect();

            if (selectedMode === 'squad' && createOrJoin === 'create') {
                // Create a private squad room and get the code
                const { room, roomId } = await network.createPrivateRoom({ uid, name: playerName });
                setGeneratedCode(roomId);
                setStatus('انتظار انضمام الفريق الآخر...');
                setJoining(false);
                room.onMessage('game_started', () => {
                    onMatchFound({ mode: 'squad', roomId });
                });
                return;
            }

            if (selectedMode === 'squad' && createOrJoin === 'join' && roomCode.trim()) {
                const room = await network.joinOrCreate('squad', { uid, name: playerName, roomCode: roomCode.trim() });
                room.onMessage('game_started', () => {
                    onMatchFound({ mode: 'squad', roomId: room.id });
                });
                setStatus('انتظار رسالة بدء المباراة...');
                return;
            }

            // Duel + War: just join-or-create, start when server fires 'game_started'
            const modeId = selectedMode as 'duel' | 'squad' | 'war';
            const room = await network.joinOrCreate(modeId, { uid, name: playerName });
            setStatus('وجدنا غرفة! انتظار انطلاق المباراة...');
            room.onMessage('game_started', () => {
                onMatchFound({ mode: modeId, roomId: room.id });
            });
        } catch (e: any) {
            console.error(e);
            setStatus('خطأ في الاتصال — تأكد أن السيرفر يعمل');
            setJoining(false);
        }
    };

    return (
        <div style={styles.overlay}>
            <div style={styles.card}>
                {/* Header */}
                <div style={styles.header}>
                    <h1 style={styles.title}>🌐 اللعب أونلاين</h1>
                    <p style={styles.sub}>مرحباً <strong>{playerName}</strong> — اختر وضع اللعب</p>
                </div>

                {/* Mode cards */}
                <div style={styles.modeRow}>
                    {MODES.map(m => (
                        <div
                            key={m.id}
                            style={{
                                ...styles.modeCard,
                                border: `2px solid ${selectedMode === m.id ? m.color : 'rgba(255,255,255,0.08)'}`,
                                background: selectedMode === m.id ? `${m.color}22` : 'rgba(255,255,255,0.03)',
                                cursor: joining ? 'not-allowed' : 'pointer',
                            }}
                            onClick={() => { if (!joining) { setSelectedMode(m.id); setCreateOrJoin('none'); setGeneratedCode(''); } }}
                        >
                            <div style={{ fontSize: 32 }}>{m.label.split(' ')[0]}</div>
                            <div style={{ ...styles.modeLabel, color: m.color }}>{m.label.split(' ')[1]}</div>
                            <div style={styles.modeSub}>{m.sub}</div>
                            <div style={styles.modeDesc}>{m.desc}</div>
                        </div>
                    ))}
                </div>

                {/* Squad sub-options */}
                {selectedMode === 'squad' && createOrJoin === 'none' && (
                    <div style={styles.squadOptions}>
                        <button style={{ ...styles.btn, background: '#3366cc' }} onClick={() => setCreateOrJoin('create')}>➕ إنشاء غرفة</button>
                        <button style={{ ...styles.btn, background: '#226644' }} onClick={() => setCreateOrJoin('join')}>🔗 الانضمام برمز</button>
                    </div>
                )}

                {selectedMode === 'squad' && createOrJoin === 'join' && (
                    <input
                        style={styles.input}
                        placeholder="أدخل رمز الغرفة..."
                        value={roomCode}
                        onChange={e => setRoomCode(e.target.value)}
                        maxLength={12}
                    />
                )}

                {generatedCode && (
                    <div style={styles.codeBox}>
                        📋 رمز غرفتك: <strong style={{ color: '#4ff', letterSpacing: 2 }}>{generatedCode}</strong>
                        <br/><small>أرسله لزملائك للانضمام</small>
                    </div>
                )}

                {/* Status */}
                {status && (
                    <div style={styles.status}>
                        {joining && <span style={styles.spinner}>⟳ </span>}
                        {status}
                    </div>
                )}

                {/* Action buttons */}
                <div style={styles.btnRow}>
                    <button style={{ ...styles.btn, background: '#333', flex: 1 }} onClick={onBack} disabled={joining}>
                        ← رجوع
                    </button>
                    {!(selectedMode === 'squad' && createOrJoin === 'none') && (
                        <button
                            style={{ ...styles.btn, background: joining ? '#555' : '#cc3355', flex: 2, fontSize: 16 }}
                            onClick={handleStart}
                            disabled={joining}
                        >
                            {joining ? '⟳ جارِ الاتصال...' : '🚀 ابدأ المباراة'}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}

const styles: Record<string, React.CSSProperties> = {
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
        width: '100%', maxWidth: 600, color: '#fff',
        backdropFilter: 'blur(12px)',
        boxShadow: '0 0 60px rgba(0,150,255,0.12)',
    },
    header: { textAlign: 'center', marginBottom: 24 },
    title: { margin: 0, fontSize: 26, fontWeight: 700, letterSpacing: 1 },
    sub: { margin: '6px 0 0', color: 'rgba(255,255,255,0.5)', fontSize: 14 },
    modeRow: { display: 'flex', gap: 12, marginBottom: 20 },
    modeCard: {
        flex: 1, borderRadius: 14, padding: '16px 10px',
        textAlign: 'center', transition: 'all 0.2s',
    },
    modeLabel: { fontWeight: 700, fontSize: 16, marginTop: 6 },
    modeSub: { color: '#aab', fontSize: 13, margin: '4px 0 2px' },
    modeDesc: { color: 'rgba(255,255,255,0.35)', fontSize: 11, lineHeight: 1.3 },
    squadOptions: { display: 'flex', gap: 10, marginBottom: 14 },
    input: {
        width: '100%', padding: '10px 14px', marginBottom: 14,
        background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)',
        borderRadius: 10, color: '#fff', fontSize: 16, outline: 'none', boxSizing: 'border-box',
        textAlign: 'center', letterSpacing: 2,
    },
    codeBox: {
        background: 'rgba(0,200,200,0.08)', border: '1px solid rgba(0,200,200,0.25)',
        borderRadius: 10, padding: '12px 16px', textAlign: 'center',
        marginBottom: 14, fontSize: 14, lineHeight: 1.8,
    },
    status: {
        textAlign: 'center', color: 'rgba(255,255,255,0.6)', fontSize: 13,
        marginBottom: 12, minHeight: 20,
    },
    spinner: { display: 'inline-block', animation: 'spin 1s linear infinite' },
    btnRow: { display: 'flex', gap: 10, marginTop: 4 },
    btn: {
        padding: '12px 20px', borderRadius: 10, border: 'none',
        color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer',
        fontFamily: "'Outfit', sans-serif", transition: 'opacity 0.2s',
    },
};
