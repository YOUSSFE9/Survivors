import React, { useState, useEffect, useCallback } from 'react';
import { fetchLeaderboard, getGoldBalance, getDailyStats, getDailyKey, firebaseEnabled } from '../firebase/config';

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

export default function PrizesModal({ user, onClose }: Props) {
  const [tab, setTab] = useState<'killers' | 'survivors' | 'wallet'>('killers');
  const [killersBoard, setKillersBoard] = useState<LeaderEntry[]>([]);
  const [survivorsBoard, setSurvivorsBoard] = useState<LeaderEntry[]>([]);
  const [goldBalance, setGoldBalance] = useState(0);
  const [myStats, setMyStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [countdown, setCountdown] = useState(msUntilMidnightUTC());
  const [withdrawReq, setWithdrawReq] = useState('');
  const [withdrawSent, setWithdrawSent] = useState(false);

  // Countdown every second
  useEffect(() => {
    const t = setInterval(() => setCountdown(msUntilMidnightUTC()), 1000);
    return () => clearInterval(t);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [kb, sb, bal, stats] = await Promise.all([
        fetchLeaderboard('monsterKills'),
        fetchLeaderboard('portalsOpened'),
        user ? getGoldBalance(user.uid) : Promise.resolve(0),
        user ? getDailyStats(user.uid, user.displayName, user.photoURL) : Promise.resolve(null),
      ]);
      setKillersBoard(kb as LeaderEntry[]);
      setSurvivorsBoard(sb as LeaderEntry[]);
      setGoldBalance(bal);
      setMyStats(stats);
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
              <h2 style={S.title}>جوائز المحترفين</h2>
              <p style={S.subtitle}>مسابقات يومية — تصفير كل 24 ساعة</p>
            </div>
          </div>
          <div style={S.headerRight}>
            <div style={S.goldBadge}>
              <span style={{ fontSize: 18 }}>🪙</span>
              <span style={S.goldNum}>{goldBalance}</span>
              <span style={S.goldLabel}>عملة</span>
            </div>
            <div style={S.countdownBox}>
              <span style={S.countdownLabel}>تصفير خلال</span>
              <span style={S.countdownVal}>{formatCountdown(countdown)}</span>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div style={S.tabs}>
          {([
            { key: 'killers',   icon: '💀', label: 'تصنيف القتلة' },
            { key: 'survivors', icon: '🚪', label: 'تصنيف الناجين' },
            { key: 'wallet',    icon: '💰', label: 'المحفظة' },
          ] as const).map(t => (
            <button
              key={t.key}
              style={{ ...S.tab, ...(tab === t.key ? S.tabActive : {}) }}
              onClick={() => setTab(t.key)}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div style={S.content}>
          {loading ? (
            <div style={S.loading}>⟳ جارِ التحميل...</div>
          ) : tab === 'killers' ? (
            <KillersTab
              board={killersBoard}
              myUid={user?.uid}
              myRank={myRankKillers}
              myKills={myStats?.monsterKills || 0}
            />
          ) : tab === 'survivors' ? (
            <SurvivorsTab
              board={survivorsBoard}
              myUid={user?.uid}
              myRank={myRankSurvivors}
              myPortals={myStats?.portalsOpened || 0}
              myKeys={myStats?.keysCollected || 0}
            />
          ) : (
            <WalletTab
              goldBalance={goldBalance}
              withdrawReq={withdrawReq}
              setWithdrawReq={setWithdrawReq}
              withdrawSent={withdrawSent}
              setWithdrawSent={setWithdrawSent}
              user={user}
            />
          )}
        </div>

        <button style={S.closeBtn} onClick={onClose}>✕ إغلاق</button>
      </div>
    </div>
  );
}

/* ─────── Killers Tab ─────── */
function KillersTab({ board, myUid, myRank, myKills }: any) {
  return (
    <div>
      <div style={S.prizeInfo}>
        <div style={S.prizeCard}>
          <div style={{ fontSize: 28 }}>🏆</div>
          <div style={{ fontWeight: 700, fontSize: 15, color: '#ffd700' }}>الجائزة اليومية</div>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)', marginTop: 4 }}>
            أعلى قاتل للوحوش يربح <strong style={{ color: '#ffd700' }}>5 عملات ذهبية 🪙</strong>
          </div>
        </div>
        <div style={S.myStatBox}>
          <div style={S.myStatNum}>{myKills}</div>
          <div style={S.myStatLabel}>وحشاً قتلته اليوم</div>
          {myRank > 0 && <div style={{ fontSize: 12, color: '#ffd700', marginTop: 4 }}>مرتبتك #{myRank}</div>}
        </div>
      </div>
      <div style={S.boardHeader}>
        <span>#</span><span>اللاعب</span><span>الوحوش المقتولة</span>
      </div>
      {board.length === 0 ? (
        <div style={S.empty}>لا يوجد لاعبون اليوم بعد — كن أول من يلعب! 🎮</div>
      ) : board.map((e: any) => (
        <div key={e.uid} style={{ ...S.boardRow, ...(e.uid === myUid ? S.myRow : {}) }}>
          <span style={S.boardRank}>{rankIcon(e.rank)}</span>
          <div style={S.playerCell}>
            {e.photoURL ? <img src={e.photoURL} style={S.avatar} alt="" /> : <div style={S.avatarFallback}>{(e.displayName||'?')[0]}</div>}
            <span style={{ fontSize: 13 }}>{e.displayName} {e.uid === myUid ? '(أنت)' : ''}</span>
          </div>
          <span style={S.scoreCell}>💀 {e.monsterKills}</span>
        </div>
      ))}
    </div>
  );
}

/* ─────── Survivors Tab ─────── */
function SurvivorsTab({ board, myUid, myRank, myPortals, myKeys }: any) {
  const [showInfo, setShowInfo] = useState(false);
  return (
    <div>
      <div style={S.prizeInfo}>
        <div style={S.prizeCard}>
          <div style={{ fontSize: 28 }}>🚪</div>
          <div style={{ fontWeight: 700, fontSize: 15, color: '#44ffaa' }}>الجائزة اليومية</div>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)', marginTop: 4 }}>
            افتح 10 بوابات في يوم واحد → <strong style={{ color: '#44ffaa' }}>10 عملات ذهبية 🪙</strong>
          </div>
          <button onClick={() => setShowInfo(v => !v)} style={S.infoBtn}>
            {showInfo ? '▲ إخفاء' : 'ℹ️ كيف تعمل؟'}
          </button>
        </div>
        <div style={S.myStatBox}>
          <div style={{ ...S.myStatNum, color: '#44ffaa' }}>{myPortals}<span style={{ fontSize: 14, color: 'rgba(255,255,255,0.4)' }}> /10</span></div>
          <div style={S.myStatLabel}>بوابة فتحتها اليوم</div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>🔑 {myKeys} مفاتيح</div>
          {myRank > 0 && <div style={{ fontSize: 12, color: '#44ffaa', marginTop: 4 }}>مرتبتك #{myRank}</div>}
        </div>
      </div>
      {showInfo && (
        <div style={S.infoBox}>
          <p>📌 <strong>كيف تفتح بوابة؟</strong></p>
          <p>اجمع <strong>10 مفاتيح</strong> في المتاهة → ستظهر البوابة → ادخلها لتفوز وتنتقل للمستوى التالي.</p>
          <p>⏰ كل يوم يبدأ العد من صفر — المستوى والتقدم يتصفران يومياً.</p>
          <p>🏆 من يفتح <strong>10 بوابات</strong> في نفس اليوم يربح <strong>10 عملات ذهبية</strong> مباشرة!</p>
        </div>
      )}
      {/* Progress bar for 10-portals goal */}
      <div style={{ margin: '12px 0' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'rgba(255,255,255,0.5)', marginBottom: 4 }}>
          <span>تقدمك نحو جائزة اليوم</span>
          <span>{myPortals}/10 بوابات</span>
        </div>
        <div style={S.progressBg}>
          <div style={{ ...S.progressFill, width: `${Math.min(myPortals / 10 * 100, 100)}%` }} />
        </div>
      </div>

      <div style={S.boardHeader}>
        <span>#</span><span>اللاعب</span><span>البوابات / المفاتيح</span>
      </div>
      {board.length === 0 ? (
        <div style={S.empty}>لا يوجد لاعبون اليوم بعد — كن أول من يلعب! 🎮</div>
      ) : board.map((e: any) => (
        <div key={e.uid} style={{ ...S.boardRow, ...(e.uid === myUid ? S.myRow : {}) }}>
          <span style={S.boardRank}>{rankIcon(e.rank)}</span>
          <div style={S.playerCell}>
            {e.photoURL ? <img src={e.photoURL} style={S.avatar} alt="" /> : <div style={S.avatarFallback}>{(e.displayName||'?')[0]}</div>}
            <span style={{ fontSize: 13 }}>{e.displayName} {e.uid === myUid ? '(أنت)' : ''}</span>
          </div>
          <span style={S.scoreCell}>🚪 {e.portalsOpened} · 🔑 {e.keysCollected}</span>
        </div>
      ))}
    </div>
  );
}

/* ─────── Wallet Tab ─────── */
function WalletTab({ goldBalance, withdrawReq, setWithdrawReq, withdrawSent, setWithdrawSent, user }: any) {
  const RATE = 100; // 100 gold = 1$
  const usd = (goldBalance / RATE).toFixed(2);

  const handleWithdraw = () => {
    if (!withdrawReq.trim()) return;
    setWithdrawSent(true);
  };

  return (
    <div style={{ direction: 'rtl' }}>
      {/* Balance */}
      <div style={S.walletHeader}>
        <div style={{ fontSize: 52 }}>🪙</div>
        <div>
          <div style={{ fontSize: 36, fontWeight: 900, color: '#ffd700' }}>{goldBalance}</div>
          <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>عملة ذهبية ≈ <strong style={{ color: '#44ffaa' }}>${usd}</strong></div>
        </div>
      </div>

      {/* How to earn */}
      <div style={S.earnSection}>
        <div style={S.earnTitle}>كيف تجمع العملات؟</div>
        <div style={S.earnRow}><span>💀</span><span>كن أعلى قاتل للوحوش يومياً → <b>5 عملات</b></span></div>
        <div style={S.earnRow}><span>🚪</span><span>افتح 10 بوابات في يوم واحد → <b>10 عملات</b></span></div>
        <div style={S.rateNote}>سعر التحويل: <b style={{ color: '#ffd700' }}>100 عملة = 1 دولار</b></div>
      </div>

      {/* Withdraw */}
      {withdrawSent ? (
        <div style={S.successBox}>
          ✅ تم إرسال طلب السحب! سيتواصل معك الفريق خلال 48 ساعة.
        </div>
      ) : (
        <div style={S.withdrawSection}>
          <div style={S.earnTitle}>طلب سحب رصيدك</div>
          <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginBottom: 10 }}>
            الحد الأدنى للسحب: 500 عملة ({(500/RATE).toFixed(0)}$). أدخل معلومات التواصل وسيتم مراجعة طلبك يدوياً.
          </p>
          <textarea
            style={S.textarea}
            placeholder={`اسمك الكامل\nرقم WhatsApp أو البريد الإلكتروني\nطريقة الاستلام (Wise, PayPal, تحويل بنكي...)`}
            value={withdrawReq}
            onChange={e => setWithdrawReq(e.target.value)}
            rows={4}
          />
          <button
            style={{
              ...S.withdrawBtn,
              opacity: goldBalance < 500 ? 0.45 : 1,
              cursor: goldBalance < 500 ? 'not-allowed' : 'pointer'
            }}
            onClick={goldBalance >= 500 ? handleWithdraw : undefined}
          >
            {goldBalance < 500
              ? `تحتاج ${500 - goldBalance} عملة إضافية للسحب`
              : '📤 إرسال طلب السحب'}
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
};
