/**
 * SettingsModal — Gear button with player ID display and language selector.
 */
import { useState, useEffect } from 'react';
import T, { LANGUAGES, getSavedLang, saveLang } from '../i18n/translations';

// Generate or retrieve a persistent player ID
function getPlayerId() {
    let id = localStorage.getItem('daht_player_id');
    if (!id) {
        id = 'PLR-' + Math.random().toString(36).substring(2, 8).toUpperCase();
        localStorage.setItem('daht_player_id', id);
    }
    return id;
}

export default function SettingsModal({ onLangChange }) {
    const [open, setOpen] = useState(false);
    const [lang, setLang] = useState(getSavedLang());
    const [playerId] = useState(getPlayerId);
    const [copied, setCopied] = useState(false);

    const t = T[lang] || T['ar'];

    const handleLang = (code) => {
        setLang(code);
        saveLang(code);
        if (onLangChange) onLangChange(code);
    };

    const copyId = () => {
        navigator.clipboard.writeText(playerId).catch(() => {});
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <>
            {/* Gear Button */}
            <button
                onClick={() => setOpen(true)}
                style={S.gearBtn}
                title={t.settings}
                id="btn-settings"
            >
                ⚙️
            </button>

            {/* Modal Backdrop */}
            {open && (
                <div style={S.backdrop} onClick={() => setOpen(false)}>
                    <div style={S.modal} onClick={e => e.stopPropagation()}>
                        <div style={S.header}>
                            <span style={S.title}>⚙️ {t.settings}</span>
                            <button style={S.closeBtn} onClick={() => setOpen(false)}>{t.close} ✕</button>
                        </div>

                        {/* Player ID */}
                        <div style={S.section}>
                            <div style={S.label}>{t.playerId}</div>
                            <div style={S.idRow}>
                                <code style={S.idCode}>{playerId}</code>
                                <button style={S.copyBtn} onClick={copyId}>
                                    {copied ? `✅ ${t.copied}` : `📋 ${t.copy}`}
                                </button>
                            </div>
                        </div>

                        {/* Language */}
                        <div style={S.section}>
                            <div style={S.label}>{t.language}</div>
                            <div style={S.langGrid}>
                                {LANGUAGES.map(l => (
                                    <button
                                        key={l.code}
                                        style={{
                                            ...S.langBtn,
                                            background: lang === l.code ? 'rgba(68,255,170,0.15)' : 'rgba(255,255,255,0.04)',
                                            border: lang === l.code ? '1px solid rgba(68,255,170,0.5)' : '1px solid rgba(255,255,255,0.1)',
                                            color: lang === l.code ? '#44ffaa' : '#ccd',
                                        }}
                                        onClick={() => handleLang(l.code)}
                                    >
                                        <span style={{ fontSize: 20 }}>{l.flag}</span>
                                        <span style={{ fontSize: 12, marginTop: 4 }}>{l.label}</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}

const S = {
    gearBtn: {
        position: 'fixed', top: 16, right: 16,
        width: 44, height: 44, borderRadius: '50%',
        background: 'rgba(255,255,255,0.08)',
        border: '1px solid rgba(255,255,255,0.15)',
        color: '#fff', fontSize: 20, cursor: 'pointer',
        zIndex: 10000, display: 'flex', alignItems: 'center',
        justifyContent: 'center', transition: 'all 0.2s',
        backdropFilter: 'blur(8px)',
    },
    backdrop: {
        position: 'fixed', inset: 0, zIndex: 10001,
        background: 'rgba(0,0,0,0.7)', display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        backdropFilter: 'blur(4px)',
    },
    modal: {
        background: '#0d1128',
        border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: 20, padding: '28px 24px',
        width: '100%', maxWidth: 440, color: '#fff',
        boxShadow: '0 0 60px rgba(0,150,255,0.15)',
        fontFamily: "'Outfit', sans-serif",
    },
    header: {
        display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', marginBottom: 24,
    },
    title: { fontSize: 18, fontWeight: 700 },
    closeBtn: {
        background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)',
        color: '#aaa', borderRadius: 8, padding: '5px 12px',
        fontSize: 12, cursor: 'pointer',
    },
    section: { marginBottom: 24 },
    label: {
        fontSize: 12, color: 'rgba(255,255,255,0.45)',
        textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10,
    },
    idRow: { display: 'flex', gap: 10, alignItems: 'center' },
    idCode: {
        flex: 1, background: 'rgba(255,255,255,0.06)',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 8, padding: '8px 14px', fontSize: 15,
        letterSpacing: 2, color: '#44ffaa', fontFamily: 'monospace',
    },
    copyBtn: {
        padding: '8px 14px', borderRadius: 8,
        background: 'rgba(68,255,170,0.12)',
        border: '1px solid rgba(68,255,170,0.25)',
        color: '#44ffaa', fontSize: 12, cursor: 'pointer', fontWeight: 600,
        whiteSpace: 'nowrap',
    },
    langGrid: {
        display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10,
    },
    langBtn: {
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        padding: '10px 8px', borderRadius: 10, cursor: 'pointer',
        transition: 'all 0.15s', fontFamily: "'Outfit', sans-serif",
    },
};
