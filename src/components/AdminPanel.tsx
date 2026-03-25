import React, { useState, useEffect } from 'react';
import { fetchWithdrawalRequests, updateWithdrawalStatus, deleteWithdrawalRequest } from '../firebase/config';

const ADMIN_EMAIL = 'deathrace5j@gmail.com';

interface Props {
  user: any;
  t: any;
  onClose: () => void;
}

function LayerBadge({ layer, t }: { layer: any, t: any }) {
  const ok = layer.ok;
  const suspicious = layer.suspicious;

  let icon, color;
  if (ok === true && !suspicious) { icon = '✅'; color = '#44ffaa'; }
  else if (ok === false || suspicious) { icon = '❌'; color = '#ff4444'; }
  else { icon = '⚪'; color = '#aaaaaa'; }

  let detail = '';
  if (layer.ip && layer.ip !== '?') detail += ` IP: ${layer.ip}`;
  if (layer.country && layer.country !== '?') detail += ` | ${layer.country}`;
  if (layer.city) detail += ` / ${layer.city}`;
  if (layer.timezone) detail += ` | tz: ${layer.timezone}`;
  if (layer.org) detail += ` | ${layer.org}`;
  if (layer.vpn) detail += ' | VPN';
  if (layer.proxy) detail += ' | PROXY';
  if (layer.tor) detail += ' | TOR';
  if (layer.error) detail += ` (${layer.error})`;
  if (layer.suspicious) detail += ` ⚠️ ${t.adminSuspicious?.replace?.('🟡 ', '') || 'Suspicious'}`;

  return (
    <div style={L.layerRow}>
      <span style={{ color, fontSize: 16, minWidth: 22 }}>{icon}</span>
      <span style={{ fontWeight: 700, color: '#ccddff', minWidth: 180, fontSize: 12 }}>{layer.name}</span>
      <span style={{ color: '#99aacc', fontSize: 11, flex: 1 }}>{detail || '—'}</span>
    </div>
  );
}

function RequestCard({ req, onStatusChange, onCopy, onDelete, t }: { req: any; onStatusChange: (id: string, s: string) => void; onCopy: (txt: string) => void; onDelete: (id: string) => void; t: any }) {
  const [open, setOpen] = useState(false);
  const layers: any[] = req.locationLayers || [];
  const suspiciousCount = layers.filter(l => l.ok === false || l.suspicious).length;
  const risk = suspiciousCount >= 2 ? 'high' : suspiciousCount === 1 ? 'medium' : 'low';
  const riskColor = risk === 'high' ? '#ff4444' : risk === 'medium' ? '#ffaa00' : '#44ffaa';

  const statusColor = req.status === 'approved' ? '#44ffaa' : req.status === 'rejected' ? '#ff4444' : '#ffaa00';
  const date = req.createdAt?.toDate?.()?.toLocaleString() ?? '—';

  return (
    <div style={L.card}>
      {/* Header */}
      <div style={L.cardHeader}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 800, fontSize: 15, color: '#fff' }}>{req.name}</div>
          <div style={{ fontSize: 12, color: '#aaa', marginTop: 2 }}>{req.displayName} · {date}</div>
        </div>
        <div style={{ textAlign: 'right' as const }}>
          <div style={{ fontSize: 22, fontWeight: 900, color: '#ffd700' }}>{req.goldAmount} 🪙</div>
          <div style={{ fontSize: 12, color: '#aaa' }}>{req.method}</div>
        </div>
      </div>

      {/* Contact row */}
      <div style={L.contactRow}>
        <div style={{ display: 'flex', gap: 8 }}>
          {req.whatsapp && (
            <a href={`https://wa.me/${req.whatsapp.replace(/[^0-9]/g, '')}`} target="_blank" rel="noopener noreferrer" style={L.contactBtn}>
              {t.pzWhatsapp || 'WhatsApp'}
            </a>
          )}
          {req.email && (
            <a href={`mailto:${req.email}`} style={{ ...L.contactBtn, background: 'rgba(66,133,244,0.2)', borderColor: '#4285F4' }}>
              {t.pzEmail || 'Email'}
            </a>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, marginRight: (t.dir === 'rtl' ? '0' : 'auto'), marginLeft: (t.dir === 'rtl' ? 'auto' : '0') }}>
          <button style={L.copyBtn} onClick={() => onCopy(req.email)} title={t.adminCopyEmail}>
            📋
          </button>
          <button style={L.copyBtn} onClick={() => onCopy(req.whatsapp)} title={t.adminCopyPhone}>
            📋
          </button>
        </div>
      </div>

      {/* Risk + status */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', margin: '8px 0' }}>
        <span style={{ fontSize: 12, padding: '3px 10px', borderRadius: 20, background: `${riskColor}22`, color: riskColor, fontWeight: 700 }}>
          {risk === 'high' ? t.adminHighRisk : risk === 'medium' ? t.adminSuspicious : t.adminSafe} ({suspiciousCount}/{layers.length})
        </span>
        <span style={{ fontSize: 12, padding: '3px 10px', borderRadius: 20, background: `${statusColor}22`, color: statusColor, fontWeight: 700 }}>
          {req.status === 'approved' ? t.adminApprovedTitle : req.status === 'rejected' ? t.adminRejectedTitle : t.adminPending}
        </span>
        <button style={L.toggleBtn} onClick={() => setOpen(o => !o)}>
          {open ? t.adminHideDetails : t.adminViewLayers}
        </button>
      </div>

      {/* Location layers */}
      {open && (
        <div style={L.layersBox}>
          <div style={{ fontWeight: 700, fontSize: 12, color: '#ffd700', marginBottom: 6 }}>{t.adminVerificationLayers}</div>
          {layers.length === 0
            ? <div style={{ color: '#666', fontSize: 12 }}>{t.adminNoData}</div>
            : layers.map((l, i) => <LayerBadge key={i} layer={l} t={t} />)
          }
          {req.userAgent && (
            <div style={{ fontSize: 10, color: '#556', marginTop: 6, wordBreak: 'break-all' as const }}>
              UA: {req.userAgent}
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        {req.status === 'pending' && (
          <>
            <button style={L.approveBtn} onClick={() => onStatusChange(req.id, 'approved')}>{t.adminApproveBtn}</button>
            <button style={L.rejectBtn} onClick={() => onStatusChange(req.id, 'rejected')}>{t.adminRejectBtn}</button>
          </>
        )}
        <button style={L.deleteBtn} onClick={() => onDelete(req.id)}>{t.adminDeleteBtn}</button>
      </div>
    </div>
  );
}

export default function AdminPanel({ user, t, onClose }: Props) {
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all');

  useEffect(() => {
    if (user?.email !== ADMIN_EMAIL) return;
    fetchWithdrawalRequests().then(r => { setRequests(r); setLoading(false); });
  }, [user]);

  const handleStatusChange = async (id: string, status: string) => {
    await updateWithdrawalStatus(id, status);
    setRequests(prev => prev.map(r => r.id === id ? { ...r, status } : r));
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm(t.adminConfirmDelete)) return;
    await deleteWithdrawalRequest(id);
    setRequests(prev => prev.filter(r => r.id !== id));
  };

  const handleCopy = async (text: string) => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement("textarea");
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      const m = document.createElement('div');
      m.innerText = t.copied || 'Copied!';
      m.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);background:#44ffaa;color:#000;padding:8px 20px;border-radius:20px;z-index:99999;font-weight:900;';
      document.body.appendChild(m);
      setTimeout(() => m.remove(), 2500);
    } catch (e) { console.error('Copy failed', e); }
  };

  if (user?.email !== ADMIN_EMAIL) {
    return (
      <div style={L.overlay} onClick={onClose}>
        <div style={L.modal}>
          <div style={{ textAlign: 'center', color: '#ff4444', fontSize: 18 }}>{t.adminUnauthorized}</div>
        </div>
      </div>
    );
  }

  const filtered = requests.filter(r => filter === 'all' || r.status === filter);
  const pendingCount = requests.filter(r => r.status === 'pending').length;

  return (
    <div style={{ ...L.overlay, direction: t.dir }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={L.modal}>
        {/* Header */}
        <div style={L.header}>
          <div>
            <div style={L.title}>{t.adminTitle}</div>
            <div style={{ fontSize: 12, color: '#aaa', marginTop: 2 }}>
              {requests.length} {t.adminReqsCount} · {pendingCount} {t.adminPendingText}
            </div>
          </div>
          <button style={L.closeBtn} onClick={onClose}>✕</button>
        </div>

        {/* Filter tabs */}
        <div style={{ display: 'flex', gap: 8, margin: '14px 0', flexWrap: 'wrap' as const }}>
          {(['all', 'pending', 'approved', 'rejected'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)} style={{
              ...L.filterBtn,
              ...(filter === f ? L.filterBtnActive : {})
            }}>
              {f === 'all' ? t.adminAll : f === 'pending' ? t.adminPending : f === 'approved' ? t.adminApprovedTitle : t.adminRejectedTitle}
            </button>
          ))}
        </div>

        {/* Content */}
        <div style={{ overflowY: 'auto' as const, maxHeight: 'calc(85vh - 160px)' }}>
          {loading ? (
            <div style={{ textAlign: 'center', color: '#aaa', padding: 40 }}>{t.adminLoading}</div>
          ) : filtered.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#555', padding: 40 }}>{t.adminNoRequests}</div>
          ) : (
            filtered.map(req => (
              <RequestCard key={req.id} req={req} onStatusChange={handleStatusChange} onCopy={handleCopy} onDelete={handleDelete} t={t} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

const L: any = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.88)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 20000, backdropFilter: 'blur(8px)' },
  modal: { background: 'linear-gradient(145deg,#080d1e,#121830)', border: '1px solid rgba(100,150,255,0.2)', borderRadius: 20, padding: '24px 20px', width: '100%', maxWidth: 700, maxHeight: '90vh', color: '#fff', direction: 'rtl', boxShadow: '0 0 80px rgba(68,136,255,0.15)', display: 'flex', flexDirection: 'column' as const },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' },
  title: { fontSize: 22, fontWeight: 900, background: 'linear-gradient(90deg,#4488ff,#88ccff)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' },
  closeBtn: { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, color: '#aaa', padding: '6px 14px', cursor: 'pointer', fontSize: 16 },
  filterBtn: { padding: '6px 14px', borderRadius: 20, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', fontSize: 12, fontWeight: 700, transition: 'all .2s' },
  filterBtnActive: { background: 'rgba(68,136,255,0.2)', border: '1px solid rgba(68,136,255,0.5)', color: '#88aaff' },
  card: { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, padding: '14px 16px', marginBottom: 12, transition: 'border .2s' },
  cardHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 },
  contactRow: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' as const, marginBottom: 4 },
  contactBtn: { padding: '5px 14px', borderRadius: 20, background: 'rgba(37,211,102,0.15)', border: '1px solid rgba(37,211,102,0.4)', color: '#25d366', fontSize: 12, fontWeight: 700, textDecoration: 'none', cursor: 'pointer' },
  layersBox: { background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10, padding: '10px 12px', marginTop: 6 },
  layerRow: { display: 'flex', gap: 8, alignItems: 'flex-start', padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' },
  toggleBtn: { marginRight: 'auto' as const, padding: '3px 12px', borderRadius: 20, border: '1px solid rgba(255,255,255,0.1)', background: 'transparent', color: '#aaa', cursor: 'pointer', fontSize: 11 },
  approveBtn: { flex: 1, padding: '8px 0', borderRadius: 10, border: 'none', background: 'rgba(68,255,170,0.15)', color: '#44ffaa', fontWeight: 700, cursor: 'pointer', fontSize: 13 },
  rejectBtn: { flex: 1, padding: '8px 0', borderRadius: 10, border: 'none', background: 'rgba(255,68,68,0.15)', color: '#ff6666', fontWeight: 700, cursor: 'pointer', fontSize: 13 },
  deleteBtn: { padding: '8px 16px', borderRadius: 10, border: 'none', background: 'rgba(255,100,100,0.1)', color: '#ffaaaa', fontWeight: 700, cursor: 'pointer', fontSize: 13 },
  copyBtn: { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '4px 8px', color: '#aaa', fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }
};
