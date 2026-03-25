import React, { useState, useEffect, useCallback } from 'react';
import {
  fetchLeaderboard,
  getGoldBalance,
  getDailyStats,
  submitWithdrawalRequest,
  COINS_PER_USD,
  MIN_WITHDRAW_COINS,
} from '../firebase/config';
import AdminPanel from './AdminPanel';
import T from '../i18n/translations';

interface LeaderEntry {
  rank: number;
  uid: string;
  displayName: string;
  photoURL?: string;
  monsterKills: number;
  portalsOpened: number;
  keysCollected: number;
}

interface Props {
  user: any;
  lang: string;
  onClose: () => void;
}

function msUntilMidnightUTC(): number {
  const now = new Date();
  const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return tomorrow.getTime() - now.getTime();
}

function formatCountdown(ms: number) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function getFlagEmoji(countryCode: string) {
  if (!countryCode || countryCode === 'UN' || countryCode.length !== 2) return '🏳️';
  const codePoints = countryCode
    .toUpperCase()
    .split('')
    .map(char => 127397 + char.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
}

export default function PrizesModal({ user, lang, onClose }: Props) {
  const t: any = (T as any)[lang] || T['ar'];
  const [tab, setTab] = useState<'killers' | 'survivors' | 'wallet'>('killers');
  const [killersBoard, setKillersBoard] = useState<LeaderEntry[]>([]);
  const [survivorsBoard, setSurvivorsBoard] = useState<LeaderEntry[]>([]);
  const [goldBalance, setGoldBalance] = useState(0);
  const [myStats, setMyStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [countdown, setCountdown] = useState(msUntilMidnightUTC());
  const [withdrawSent, setWithdrawSent] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);

  // Countdown every second
  useEffect(() => {
    const timer = setInterval(() => setCountdown(msUntilMidnightUTC()), 1000);
    return () => clearInterval(timer);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      let stats = null;
      if (user) {
        stats = await getDailyStats(user.uid, user.displayName, user.photoURL);
        setMyStats(stats);
      }
      
      const [kb, sb, bal] = await Promise.all([
        fetchLeaderboard('monsterKills'),
        fetchLeaderboard('portalsOpened'),
        user ? getGoldBalance(user.uid) : Promise.resolve(0),
      ]);
      setKillersBoard(kb as LeaderEntry[]);
      setSurvivorsBoard(sb as LeaderEntry[]);
      setGoldBalance(bal);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { load(); }, [load]);

  const myRankKillers = killersBoard.findIndex(e => e.uid === user?.uid) + 1;
  const myRankSurvivors = survivorsBoard.findIndex(e => e.uid === user?.uid) + 1;

  return (
    <div style={S.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={S.modal}>
        {/* Header */}
        <div style={S.header}>
          <div style={S.headerLeft}>
            <span style={S.trophy}>🏆</span>
            <div>
              <h2 style={S.title}>{t.prizesTitle}</h2>
              <p style={S.subtitle}>{t.pzDailySub}</p>
            </div>
          </div>
          <div style={{ ...S.headerRight, flexDirection: 'row', alignItems: 'center' }}>
            {user?.email === 'deathrace5j@gmail.com' && (
              <button
                onClick={() => setShowAdmin(true)}
                style={{
                  padding: '6px 14px', borderRadius: 12, border: '1px solid rgba(68,136,255,0.4)',
                  background: 'rgba(68,136,255,0.1)', color: '#88aaff', fontWeight: 800, fontSize: 13, cursor: 'pointer'
                }}
              >
                {t.pzAdminPanel}
              </button>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
              <div style={S.goldBadge}>
                <span style={{ fontSize: 18 }}>🪙</span>
                <span style={S.goldNum}>{goldBalance}</span>
                <span style={S.goldLabel}>{t.pzCoin}</span>
              </div>
              <div style={S.countdownBox}>
                <span style={S.countdownLabel}>{t.pzResetIn}</span>
                <span style={S.countdownVal}>{formatCountdown(countdown)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div style={S.tabs}>
          {([
            { key: 'killers',   icon: '💀', label: t.pzTabKillers },
            { key: 'survivors', icon: '🚪', label: t.pzTabSurvivors },
            { key: 'wallet',    icon: '💰', label: t.pzTabWallet },
          ] as const).map(tabData => (
            <button
              key={tabData.key}
              style={{ ...S.tab, ...(tab === tabData.key ? S.tabActive : {}) }}
              onClick={() => setTab(tabData.key)}
            >
              {tabData.icon} {tabData.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div style={S.content}>
          {loading ? (
            <div style={S.loading}>⟳ {t.connecting}</div>
          ) : tab === 'killers' ? (
            <KillersTab
              board={killersBoard}
              myUid={user?.uid}
              myRank={myRankKillers}
              myKills={myStats?.monsterKills || 0}
              t={t}
            />
          ) : tab === 'survivors' ? (
            <SurvivorsTab
              board={survivorsBoard}
              myUid={user?.uid}
              myRank={myRankSurvivors}
              myPortals={myStats?.portalsOpened || 0}
              myKeys={myStats?.keysCollected || 0}
              t={t}
            />
          ) : (
            <WalletTab
              goldBalance={goldBalance}
              setGoldBalance={setGoldBalance}
              withdrawSent={withdrawSent}
              setWithdrawSent={setWithdrawSent}
              user={user}
              t={t}
            />
          )}
        </div>

        <button style={S.closeBtn} onClick={onClose}>✕ {t.close}</button>
      </div>

      {/* Admin Panel Modal */}
      {showAdmin && (
        <AdminPanel user={user} t={t} onClose={() => setShowAdmin(false)} />
      )}
    </div>
  );
}

/* ─────── Killers Tab ─────── */
function KillersTab({ board, myUid, myRank, myKills, t }: any) {
  return (
    <div>
      <div style={S.prizeInfo}>
        <div style={S.prizeCard}>
          <div style={{ fontSize: 28 }}>🏆</div>
          <div style={{ fontWeight: 700, fontSize: 13, color: 'rgba(255,255,255,0.9)', marginTop: 8, lineHeight: 1.5 }}>
            {t.pzKillerRules}
          </div>
          <div style={{ fontWeight: 900, fontSize: 13, color: '#ffd700', marginTop: 8 }}>
            {t.pzKillerPrize}
          </div>
        </div>
        <div style={S.myStatBox}>
          <div style={S.myStatNum}>{myKills}</div>
          <div style={S.myStatLabel}>{t.pzMonstersKilled}</div>
          {myRank > 0 && <div style={{ fontSize: 12, color: '#ffd700', marginTop: 4 }}>{t.pzRank}{myRank}</div>}
        </div>
      </div>
      <div style={S.boardHeader}>
        <span>#</span><span>{t.pzCountry} | {t.pzPlayerName}</span><span>{t.pzKillsScore}</span>
      </div>
      {board.length === 0 ? (
        <div style={S.empty}>{t.pzEmpty}</div>
      ) : (
        <>
          {board.map((e: any) => (
            <div key={e.uid} style={{ ...S.boardRow, ...(e.uid === myUid ? S.myRow : {}) }}>
              <span style={S.boardRank}>{rankIcon(e.rank)}</span>
              <div style={S.playerCell}>
                <span style={{ fontSize: 16 }}>{getFlagEmoji(e.country)}</span>
                {e.photoURL ? <img src={e.photoURL} style={S.avatar} alt="" /> : <div style={S.avatarFallback}>{(e.displayName||'?')[0]}</div>}
                <span style={{ fontSize: 13 }}>{e.displayName} {e.uid === myUid ? `(${t.you})` : ''}</span>
              </div>
              <span style={S.scoreCell}>💀 {e.monsterKills}</span>
            </div>
          ))}
          {/* Show current user at bottom if not in top list */}
          {myRank > board.length && (
            <div style={{ ...S.boardRow, ...S.myRow, marginTop: 10, borderStyle: 'dashed' }}>
              <span style={S.boardRank}>#{myRank}</span>
              <div style={S.playerCell}>
                <span style={{ fontSize: 16 }}>{getFlagEmoji(localStorage.getItem('daht_player_country') || '')}</span>
                <span style={{ fontSize: 13 }}>{t.hudPlayerYou}</span>
              </div>
              <span style={S.scoreCell}>💀 {myKills}</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ─────── Survivors Tab ─────── */
function SurvivorsTab({ board, myUid, myRank, myPortals, myKeys, t }: any) {
  const [showInfo, setShowInfo] = useState(false);
  return (
    <div>
      <div style={S.prizeInfo}>
        <div style={S.prizeCard}>
          <div style={{ fontSize: 28 }}>🚪</div>
          <div style={{ fontWeight: 700, fontSize: 13, color: 'rgba(255,255,255,0.9)', marginTop: 8, lineHeight: 1.5 }}>
            {t.pzSurvivorRules}
          </div>
          <div style={{ fontWeight: 900, fontSize: 13, color: '#44ffaa', marginTop: 8 }}>
            {t.pzSurvivorPrize}
          </div>
          <div style={{ fontWeight: 700, fontSize: 11, color: '#ffd700', marginTop: 4 }}>
            {t.pzSurvivorExtraPrize}
          </div>
          <button onClick={() => setShowInfo(v => !v)} style={S.infoBtn}>
            {showInfo ? `▲ ${t.pzHide}` : `ℹ️ ${t.pzHowItWorks}`}
          </button>
        </div>
        <div style={S.myStatBox}>
          <div style={{ ...S.myStatNum, color: '#44ffaa' }}>{myPortals}</div>
          <div style={S.myStatLabel}>{t.pzPortalsOpened}</div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>🔑 {myKeys} {t.pzKeys}</div>
          {myRank > 0 && <div style={{ fontSize: 12, color: '#44ffaa', marginTop: 4 }}>{t.pzRank}{myRank}</div>}
        </div>
      </div>
      {showInfo && (
        <div style={S.infoBox}>
          <p>📌 <strong>{t.pzHowToOpen}</strong></p>
          <p>{t.pzHowToOpenDesc}</p>
          <p>⏰ {t.pzResetNote}</p>
        </div>
      )}

      <div style={S.boardHeader}>
        <span>#</span><span>{t.pzCountry} | {t.pzPlayerName}</span><span>{t.pzPortalsKeys}</span>
      </div>
      {board.length === 0 ? (
        <div style={S.empty}>{t.pzEmpty}</div>
      ) : (
        <>
          {board.map((e: any) => (
            <div key={e.uid} style={{ ...S.boardRow, ...(e.uid === myUid ? S.myRow : {}) }}>
              <span style={S.boardRank}>{rankIcon(e.rank)}</span>
              <div style={S.playerCell}>
                <span style={{ fontSize: 16 }}>{getFlagEmoji(e.country)}</span>
                {e.photoURL ? <img src={e.photoURL} style={S.avatar} alt="" /> : <div style={S.avatarFallback}>{(e.displayName||'?')[0]}</div>}
                <span style={{ fontSize: 13 }}>{e.displayName} {e.uid === myUid ? `(${t.you})` : ''}</span>
              </div>
              <span style={S.scoreCell}>🚪 {e.portalsOpened} · 🔑 {e.keysCollected}</span>
            </div>
          ))}
          {/* Show current user at bottom if not in top list */}
          {myRank > board.length && (
            <div style={{ ...S.boardRow, ...S.myRow, marginTop: 10, borderStyle: 'dashed' }}>
              <span style={S.boardRank}>#{myRank}</span>
              <div style={S.playerCell}>
                <span style={{ fontSize: 16 }}>{getFlagEmoji(localStorage.getItem('daht_player_country') || '')}</span>
                <span style={{ fontSize: 13 }}>{t.hudPlayerYou}</span>
              </div>
              <span style={S.scoreCell}>🚪 {myPortals} · 🔑 {myKeys}</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ─────── Wallet Tab ─────── */
const METHODS = [
  'PayPal', 'P2P Transfer', 'Western Union', 'Wise (TransferWise)', 'Binance Pay'
];

function WalletTab({ goldBalance, setGoldBalance, withdrawSent, setWithdrawSent, user, t }: any) {
  const RATE = COINS_PER_USD;
  const MIN_WITHDRAW = MIN_WITHDRAW_COINS;
  const usd = (goldBalance / RATE).toFixed(2);
  const [withdrawAmount, setWithdrawAmount] = useState(String(MIN_WITHDRAW));
  const withdrawCoins = Math.floor(Number(withdrawAmount || 0));
  const canWithdraw = Number.isFinite(withdrawCoins) &&
    withdrawCoins >= MIN_WITHDRAW &&
    withdrawCoins <= goldBalance;
  const withdrawUsd = Number.isFinite(withdrawCoins) ? (withdrawCoins / RATE).toFixed(2) : '0.00';

  const [name, setName] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [email, setEmail] = useState(user?.email || '');
  const [method, setMethod] = useState('');
  const [showMethods, setShowMethods] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const isRtl = t?.dir === 'rtl';
  const rateText = `Exchange Rate: ${RATE} coins = $1`;
  const minWithdrawText = `Minimum withdrawal: ${MIN_WITHDRAW} coins.`;

  const handleWithdraw = async () => {
    if (!name || !whatsapp || !email || !method) return setError(`Warning: ${t.pzFillAll}`);
    if (!Number.isFinite(withdrawCoins) || withdrawCoins < MIN_WITHDRAW) {
      return setError(`Warning: minimum withdrawal is ${MIN_WITHDRAW} coins`);
    }
    if (withdrawCoins > goldBalance) {
      return setError('Warning: insufficient balance for this amount');
    }

    setError('');
    setSubmitting(true);
    const result = await submitWithdrawalRequest({
      uid: user?.uid,
      displayName: user?.displayName || t.survivorPrefix,
      name: name.trim(),
      whatsapp: whatsapp.trim(),
      email: email.trim(),
      method,
      goldAmount: withdrawCoins,
    });
    setSubmitting(false);
    if (result?.ok) {
      setWithdrawSent(true);
      setGoldBalance((prev: number) => Math.max(0, prev - withdrawCoins));
      setWithdrawAmount(String(MIN_WITHDRAW));
    } else {
      setError(`Warning: ${t.pzSubmitError}${result?.error || ''}`);
    }
  };

  return (
    <div style={{ direction: isRtl ? 'rtl' : 'ltr' }}>
      {/* Balance */}
      <div style={S.walletHeader}>
        <div style={{ fontSize: 52 }}>🪙</div>
        <div>
          <div style={{ fontSize: 36, fontWeight: 900, color: '#ffd700' }}>{goldBalance}</div>
          <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>{t.pzGoldBalance} <strong style={{ color: '#44ffaa' }}>${usd}</strong></div>
        </div>
      </div>

      {/* How to earn */}
      <div style={S.earnSection}>
        <div style={S.earnTitle}>{t.pzHowToEarn}</div>
        <div style={S.earnRow}><span>💀</span><span>{t.pzEarnKill}</span></div>
        <div style={S.earnRow}><span>🚪</span><span>{t.pzEarnPortal}</span></div>
        <div style={S.rateNote}><b style={{ color: '#ffd700' }}>{rateText}</b></div>
      </div>

      {/* Withdraw */}
      {withdrawSent ? (
        <div style={S.successBox}>
          {t.pzWithdrawSuccess}
        </div>
      ) : (
        <div style={S.withdrawSection}>
          <div style={S.earnTitle}>{t.pzWithdrawTitle}</div>
          <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginBottom: 14 }}>{minWithdrawText}</p>

          {/* Name */}
          <div style={S.fieldGroup}>
            <label style={S.fieldLabel}>{t.pzFullName}</label>
            <input
              style={S.inputField}
              placeholder={t.pzFullNamePlaceholder}
              value={name}
              onChange={e => setName(e.target.value)}
            />
          </div>

          {/* WhatsApp */}
          <div style={S.fieldGroup}>
            <label style={S.fieldLabel}>{t.pzWhatsapp}</label>
            <input
              style={S.inputField}
              type="tel"
              placeholder={t.pzWhatsappPlaceholder}
              value={whatsapp}
              onChange={e => setWhatsapp(e.target.value)}
              dir="ltr"
            />
          </div>

          {/* Email */}
          <div style={S.fieldGroup}>
            <label style={S.fieldLabel}>{t.pzEmail}</label>
            <input
              style={S.inputField}
              type="email"
              placeholder="example@gmail.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              dir="ltr"
            />
          </div>

          {/* Amount */}
          <div style={S.fieldGroup}>
            <label style={S.fieldLabel}>{isRtl ? '💰 مبلغ السحب (عملات)' : '💰 Withdraw amount (coins)'}</label>
            <input
              style={S.inputField}
              type="number"
              min={MIN_WITHDRAW}
              step={1}
              value={withdrawAmount}
              onChange={e => setWithdrawAmount(e.target.value)}
              dir="ltr"
            />
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginTop: 5 }}>
              {isRtl ? `القيمة التقريبية: $${withdrawUsd}` : `Estimated value: $${withdrawUsd}`}
            </div>
          </div>

          {/* Method */}
          <div style={S.fieldGroup}>
            <label style={S.fieldLabel}>{t.pzMethod}</label>
            <button
              style={{ ...S.inputField, textAlign: 'right' as const, cursor: 'pointer', background: method ? 'rgba(255,215,0,0.08)' : 'rgba(255,215,0,0.08)', border: method ? '1px solid rgba(255,215,0,0.4)' : '1px solid rgba(255,255,255,0.12)' }}
              onClick={() => setShowMethods(v => !v)}
            >
              {method || t.pzSelectMethod}
            </button>
            {showMethods && (
              <div style={S.methodDropdown}>
                {METHODS.map(m => (
                  <button key={m} style={S.methodOption} onClick={() => { setMethod(m); setShowMethods(false); }}>
                    {m}
                  </button>
                ))}
              </div>
            )}
          </div>

          {error && <div style={{ color: '#ffaaaa', fontSize: 13, marginBottom: 12, fontWeight: 700 }}>{error}</div>}

          <button
            style={{
              ...S.withdrawBtn,
              opacity: (canWithdraw && !submitting) ? 1 : 0.5
            }}
            onClick={canWithdraw && !submitting ? handleWithdraw : undefined}
            disabled={!canWithdraw || submitting}
          >
            {submitting
              ? `⏳ ${t.pzSubmitting}`
              : !canWithdraw
                ? t.pzWithdrawNeed?.replace('{n}', (Math.max(0, MIN_WITHDRAW - withdrawCoins)).toString())
                : `📤 ${t.pzSubmitRequest}`}
          </button>
        </div>
      )}
    </div>
  );
}

/* ─────── Helpers ─────── */
function rankIcon(rank: number) {
  if (rank === 1) return '🥇';
  if (rank === 2) return '🥈';
  if (rank === 3) return '🥉';
  return `#${rank}`;
}

/* ─────── Styles ─────── */
const S: any = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.82)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000, backdropFilter: 'blur(6px)' },
  modal: { background: 'linear-gradient(145deg,#0d1128,#1a2040)', border: '1px solid rgba(255,215,0,0.2)', borderRadius: 24, padding: '28px 24px', width: '100%', maxWidth: 600, maxHeight: '90vh', overflowY: 'auto', color: '#fff', direction: 'rtl', boxShadow: '0 0 60px rgba(255,215,0,0.1)' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 },
  headerLeft: { display: 'flex', alignItems: 'center', gap: 12 },
  headerRight: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 },
  trophy: { fontSize: 36 },
  title: { margin: 0, fontSize: 22, fontWeight: 900, background: 'linear-gradient(90deg,#ffd700,#ffaa00)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' },
  subtitle: { margin: '2px 0 0', fontSize: 12, color: 'rgba(255,255,255,0.45)' },
  goldBadge: { display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(255,215,0,0.12)', border: '1px solid rgba(255,215,0,0.3)', borderRadius: 12, padding: '6px 14px' },
  goldNum: { fontSize: 22, fontWeight: 900, color: '#ffd700' },
  goldLabel: { fontSize: 11, color: 'rgba(255,255,255,0.5)' },
  countdownBox: { textAlign: 'right' as const },
  countdownLabel: { display: 'block', fontSize: 10, color: 'rgba(255,255,255,0.35)' },
  countdownVal: { fontSize: 16, fontWeight: 700, color: '#ff6655', fontFamily: 'monospace' },
  tabs: { display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' as const },
  tab: { flex: 1, padding: '9px 10px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.55)', cursor: 'pointer', fontWeight: 700, fontSize: 13, transition: 'all .2s', minWidth: 100, whiteSpace: 'nowrap' as const },
  tabActive: { background: 'rgba(255,215,0,0.12)', border: '1px solid rgba(255,215,0,0.4)', color: '#ffd700' },
  content: { minHeight: 200 },
  loading: { textAlign: 'center' as const, color: 'rgba(255,255,255,0.4)', padding: 40, fontSize: 18 },
  prizeInfo: { display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' as const },
  prizeCard: { flex: 1, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 14, padding: '14px 16px', minWidth: 160 },
  myStatBox: { background: 'rgba(255,215,0,0.06)', border: '1px solid rgba(255,215,0,0.2)', borderRadius: 14, padding: '14px 20px', textAlign: 'center' as const, minWidth: 120 },
  myStatNum: { fontSize: 36, fontWeight: 900, color: '#ffd700' },
  myStatLabel: { fontSize: 12, color: 'rgba(255,255,255,0.45)', marginTop: 2 },
  boardHeader: { display: 'grid', gridTemplateColumns: '40px 1fr auto', gap: 8, padding: '6px 10px', fontSize: 11, color: 'rgba(255,255,255,0.35)', borderBottom: '1px solid rgba(255,255,255,0.06)', marginBottom: 6 },
  boardRow: { display: 'grid', gridTemplateColumns: '40px 1fr auto', gap: 8, padding: '8px 10px', borderRadius: 10, marginBottom: 4, alignItems: 'center', background: 'rgba(255,255,255,0.02)', transition: 'background .2s' },
  myRow: { background: 'rgba(255,215,0,0.06)', border: '1px solid rgba(255,215,0,0.15)' },
  boardRank: { fontSize: 16, textAlign: 'center' as const },
  playerCell: { display: 'flex', alignItems: 'center', gap: 8 },
  scoreCell: { fontSize: 13, fontWeight: 700, color: '#ffd700', whiteSpace: 'nowrap' as const },
  avatar: { width: 28, height: 28, borderRadius: '50%', objectFit: 'cover' as const },
  avatarFallback: { width: 28, height: 28, borderRadius: '50%', background: 'linear-gradient(135deg,#4455ff,#aa44ff)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 13 },
  empty: { textAlign: 'center' as const, color: 'rgba(255,255,255,0.3)', padding: '30px 0', fontSize: 14 },
  closeBtn: { display: 'block', width: '100%', marginTop: 20, padding: '11px 0', borderRadius: 12, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.55)', cursor: 'pointer', fontWeight: 700, fontSize: 14 },
  infoBtn: { marginTop: 8, padding: '4px 10px', borderRadius: 6, border: 'none', background: 'rgba(68,255,170,0.12)', color: '#44ffaa', cursor: 'pointer', fontSize: 12 },
  infoBox: { background: 'rgba(68,255,170,0.06)', border: '1px solid rgba(68,255,170,0.15)', borderRadius: 12, padding: '12px 16px', marginBottom: 14, fontSize: 13, lineHeight: 1.7 },
  progressBg: { height: 10, background: 'rgba(255,255,255,0.06)', borderRadius: 99, overflow: 'hidden' },
  progressFill: { height: '100%', background: 'linear-gradient(90deg,#44ffaa,#00dd88)', borderRadius: 99, transition: 'width 0.8s ease' },
  walletHeader: { display: 'flex', alignItems: 'center', gap: 20, justifyContent: 'center', padding: '20px 0', marginBottom: 20, background: 'rgba(255,215,0,0.05)', borderRadius: 16, border: '1px solid rgba(255,215,0,0.15)' },
  earnSection: { background: 'rgba(255,255,255,0.03)', borderRadius: 14, padding: 16, marginBottom: 20, border: '1px solid rgba(255,255,255,0.07)' },
  earnTitle: { fontWeight: 800, fontSize: 14, color: '#ffd700', marginBottom: 10 },
  earnRow: { display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', fontSize: 13, borderBottom: '1px solid rgba(255,255,255,0.05)' },
  rateNote: { marginTop: 10, fontSize: 12, color: 'rgba(255,255,255,0.4)', textAlign: 'center' as const },
  withdrawSection: { background: 'rgba(255,255,255,0.03)', borderRadius: 14, padding: 16, border: '1px solid rgba(255,255,255,0.07)' },
  textarea: { width: '100%', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 10, color: '#fff', padding: '10px 12px', fontSize: 13, outline: 'none', resize: 'vertical' as const, boxSizing: 'border-box' as const, direction: 'rtl' },
  withdrawBtn: { display: 'block', width: '100%', marginTop: 12, padding: '12px 0', borderRadius: 12, border: 'none', background: 'linear-gradient(90deg,#ffd700,#ffaa00)', color: '#000', fontWeight: 900, fontSize: 15 },
  successBox: { background: 'rgba(68,255,170,0.1)', border: '1px solid rgba(68,255,170,0.3)', borderRadius: 14, padding: 20, textAlign: 'center' as const, color: '#44ffaa', fontSize: 14, fontWeight: 700 },
  fieldGroup: { marginBottom: 12, position: 'relative' as const },
  fieldLabel: { display: 'block', fontSize: 12, color: 'rgba(255,255,255,0.55)', fontWeight: 700, marginBottom: 5 },
  inputField: { width: '100%', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, color: '#fff', padding: '10px 14px', fontSize: 13, outline: 'none', boxSizing: 'border-box' as const, fontFamily: 'Outfit,sans-serif', transition: 'border .2s' },
  methodDropdown: { position: 'absolute' as const, top: '100%', left: 0, right: 0, background: '#12162a', border: '1px solid rgba(255,215,0,0.3)', borderRadius: 10, marginTop: 4, overflow: 'hidden', zIndex: 10, boxShadow: '0 10px 30px rgba(0,0,0,0.5)' },
  methodOption: { display: 'block', width: '100%', background: 'transparent', border: 'none', borderBottom: '1px solid rgba(255,255,255,0.06)', color: '#eee', padding: '12px 14px', textAlign: 'right' as const, cursor: 'pointer', fontSize: 13, fontFamily: 'Outfit,sans-serif', transition: 'background .15s' },
};




