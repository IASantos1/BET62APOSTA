import React, { useEffect, useMemo, useState } from 'react';
import { useApp } from '@/react-app/contexts/AppContext';
import { apiFetch } from '@/react-app/utils/api';
import { TwoFactor } from '@/react-app/components/TwoFactorSetup';
import { useNavigate } from 'react-router-dom';
import {
  Shield, AlertTriangle, Check, History, Banknote, CreditCard,
  User, FileText, HelpCircle, Settings,
  Lock, ChevronRight, Bell, Eye, BadgeCheck,
  ClipboardList, ShieldAlert, ArrowLeft,
  MessageCircle, Gift, Info, Phone, Cookie, UserCheck,
  Percent,
} from 'lucide-react';

interface WalletEntry { currency: string; balance: number }
interface Transaction { id: string; type: string; status: string; amount: number; currency: string; created_at: string; metadata?: string }
interface UserNotificationEntry { id: string; kind: string; title: string; body: string; cta_label?: string; cta_target?: string; is_read: boolean; created_at: string }
interface ReferralInviteEntry { id: string; email: string; status: string; reward_amount: number; created_at: string }
interface ReferralSummary { code: string; reward_eur: number; link: string; invited_count: number; rewarded_count: number; total_reward_eur: number; invites: ReferralInviteEntry[] }

// ── Theme helpers ──────────────────────────────────────────────────
const t = {
  bg:        (dark: boolean) => dark ? 'bg-[#0e1621]'  : 'bg-[#f2f3f5]',
  card:      (dark: boolean) => dark ? 'bg-[#151e2d] border border-white/8' : 'bg-white border border-gray-100',
  heading:   (dark: boolean) => dark ? 'text-white'     : 'text-gray-900',
  sub:       (dark: boolean) => dark ? 'text-gray-400'  : 'text-gray-500',
  label:     (dark: boolean) => dark ? 'text-gray-500'  : 'text-gray-400',
  divider:   (dark: boolean) => dark ? 'divide-white/6' : 'divide-gray-100',
  border:    (dark: boolean) => dark ? 'border-white/8' : 'border-gray-100',
  input:     (dark: boolean) => dark
    ? 'bg-white/5 border-white/10 text-white placeholder:text-gray-600 focus:border-red-500/50'
    : 'bg-gray-50 border-gray-200 text-gray-900 placeholder:text-gray-400 focus:border-red-400',
  selectBg:  (dark: boolean) => dark ? 'bg-[#151e2d] border-white/10 text-white' : 'bg-white border-gray-200 text-gray-900',
};

// ── Status pill ────────────────────────────────────────────────────
function TxStatusPill({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    COMPLETED:           { label: 'Pago',        cls: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/20' },
    PAID:                { label: 'Pago',        cls: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/20' },
    PENDING:             { label: 'Processando', cls: 'bg-amber-500/15  text-amber-500  border-amber-500/20' },
    REQUESTED:           { label: 'Agendado',    cls: 'bg-amber-500/15  text-amber-500  border-amber-500/20' },
    AUTHORIZED:          { label: 'Autorizado',  cls: 'bg-blue-500/15   text-blue-500   border-blue-500/20' },
    FAILED:              { label: 'Falhou',      cls: 'bg-red-500/15    text-red-500    border-red-500/20' },
    REJECTED:            { label: 'Rejeitado',   cls: 'bg-red-500/15    text-red-500    border-red-500/20' },
    IBAN_PENDING_REVIEW: { label: 'IBAN análise',cls: 'bg-purple-500/15 text-purple-500 border-purple-500/20' },
  };
  const { label, cls } = map[status] ?? { label: status, cls: 'bg-gray-500/15 text-gray-500 border-gray-300/20' };
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${cls}`}>
      {label}
    </span>
  );
}

// ── Toggle switch ──────────────────────────────────────────────────
function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${checked ? 'bg-red-600' : 'bg-gray-300'}`}
    >
      <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-6' : 'translate-x-1'}`} />
    </button>
  );
}

// ── Main component ─────────────────────────────────────────────────
const ProfilePage: React.FC = () => {
  const { darkMode, toggleDarkMode, autoTheme, setAutoTheme, addNotification, user, signOut, selfExclude, selfExcludeUntil, setSelfExclude } = useApp();
  const navigate = useNavigate();
  const [wallets, setWallets] = useState<WalletEntry[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [profile, setProfile] = useState<any | null>(null);
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false);
  const [show2faSetup, setShow2faSetup] = useState(false);
  const [selectedItem, setSelectedItem] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get('tab');
    if (tab) setSelectedItem(tab);
  }, []);

  const [documents, setDocuments] = useState<any[]>([]);
  const kycStatus = user?.kyc_status || 'unverified';
  const [cookieAnalytics, setCookieAnalytics] = useState<boolean>(() => { try { return JSON.parse(localStorage.getItem('cookie_analytics') || 'true'); } catch { return true; } });
  const [cookieMarketing, setCookieMarketing] = useState<boolean>(() => { try { return JSON.parse(localStorage.getItem('cookie_marketing') || 'false'); } catch { return false; } });
  const [cookieFunctional, setCookieFunctional] = useState<boolean>(() => { try { return JSON.parse(localStorage.getItem('cookie_functional') || 'true'); } catch { return true; } });
  const [limitDeposit, setLimitDeposit] = useState<number>(() => { try { return Number(localStorage.getItem('limit_deposit') || '0'); } catch { return 0; } });
  const [limitBet, setLimitBet] = useState<number>(() => { try { return Number(localStorage.getItem('limit_bet') || '0'); } catch { return 0; } });
  const [excludeDuration, setExcludeDuration] = useState<'24h'|'7d'|'30d'|'6m'|'indef'>('indef');
  const [excludeConfirmOpen, setExcludeConfirmOpen] = useState(false);
  const [history, setHistory] = useState<{ action: string; until?: string; created_at: string }[]>([]);
  const [supportMessages, setSupportMessages] = useState<{ sender: string; content: string; created_at: string }[]>([]);
  const [supportText, setSupportText] = useState('');
  const [supportLoading, setSupportLoading] = useState(false);
  const [activePaymentTab, setActivePaymentTab] = useState<'withdrawals'|'security'>('withdrawals');
  const [withdrawAmount, setWithdrawAmount] = useState<number>(10);
  const [hasIban, setHasIban] = useState<boolean | null>(null);
  const [savedIban, setSavedIban] = useState<string>('');
  const [savedHolder, setSavedHolder] = useState<string>('');
  const [newIban, setNewIban] = useState('');
  const [holderName, setHolderName] = useState('');
  const [withdrawLoading, setWithdrawLoading] = useState(false);
  const [userNotifications, setUserNotifications] = useState<UserNotificationEntry[]>([]);
  const [notificationsUnread, setNotificationsUnread] = useState(0);
  const [referral, setReferral] = useState<ReferralSummary | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteLoading, setInviteLoading] = useState(false);

  const fetchUserNotifications = async (markRead = false) => {
    if (!user) { setUserNotifications([]); setNotificationsUnread(0); return; }
    const data = await apiFetch<{ unread: number; notifications: UserNotificationEntry[] }>('/api/users/notifications', { cache: 'no-store' });
    const next = Array.isArray(data.notifications) ? data.notifications : [];
    setUserNotifications(next);
    setNotificationsUnread(Number(data.unread || 0));
    if (markRead && Number(data.unread || 0) > 0) {
      await apiFetch('/api/users/notifications/read-all', { method: 'POST' }).catch(() => null);
      setNotificationsUnread(0);
      setUserNotifications(next.map((item) => ({ ...item, is_read: true })));
    }
  };

  const fetchReferral = async () => {
    if (!user) { setReferral(null); return; }
    const data = await apiFetch<ReferralSummary>('/api/users/referral', { cache: 'no-store' });
    setReferral(data);
  };

  useEffect(() => {
    if (selectedItem === 'Métodos de Pagamento' && activePaymentTab === 'withdrawals' && user) {
      if (hasIban === null) {
        apiFetch('/api/users/iban')
          .then((data: any) => {
            if (data.has_iban) { setHasIban(true); setSavedIban(data.iban_masked); setSavedHolder(data.holder_name); }
            else setHasIban(false);
          })
          .catch(() => setHasIban(false));
      }
    }
  }, [selectedItem, activePaymentTab, user]);

  const handleWithdraw = async (e: React.FormEvent) => {
    e.preventDefault();
    if (withdrawAmount < 20) return addNotification({ type: 'error', message: 'Mínimo €20' });
    if (!hasIban && (!newIban || !holderName)) return addNotification({ type: 'error', message: 'Preencha o IBAN e Titular' });
    setWithdrawLoading(true);
    try {
      const payload: any = { amount: withdrawAmount };
      if (!hasIban) { payload.iban = newIban; payload.holder_name = holderName; }
      const data = await apiFetch('/api/withdrawals', { method: 'POST', body: JSON.stringify(payload) }) as { iban?: string; message?: string };
      addNotification({ type: 'success', message: data.message || 'Levantamento solicitado com sucesso!' });
      if (!hasIban) { setHasIban(true); setSavedIban(data.iban || newIban); setSavedHolder(holderName); }
    } catch (err: any) {
      addNotification({ type: 'error', message: err.message || 'Erro ao solicitar levantamento' });
    } finally { setWithdrawLoading(false); }
  };

  const handleSaveIban = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newIban || !holderName) return addNotification({ type: 'error', message: 'Preencha todos os campos' });
    setWithdrawLoading(true);
    try {
      const data = await apiFetch('/api/users/iban', { method: 'POST', body: JSON.stringify({ iban: newIban, holder_name: holderName }) }) as any;
      addNotification({ type: 'success', message: 'IBAN guardado com sucesso' });
      setHasIban(true); setSavedIban(data.iban); setSavedHolder(holderName);
    } catch (err: any) {
      addNotification({ type: 'error', message: err.message || 'Erro ao guardar IBAN' });
    } finally { setWithdrawLoading(false); }
  };

  useEffect(() => {
    const ac = new AbortController();
    const loadHistory = async () => {
      if (!user) { setHistory([]); return; }
      try {
        const j = await apiFetch<{ action: string; until?: string; created_at: string }[]>('/api/users/self-exclude/history', { signal: ac.signal });
        if (j) setHistory(Array.isArray(j) ? j : []);
      } catch (err: any) {
        const msg = String(err?.message || '');
        if (/Abort|ERR_ABORTED|ERR_CANCELED/i.test(msg)) return;
      }
    };
    loadHistory();
    return () => { ac.abort('dev-strict'); };
  }, [user, selfExclude]);

  const initials = useMemo(() => {
    const name = (user && (user as any).username) ? String((user as any).username) : 'U';
    return name.split(' ').map((n: string) => n[0]).slice(0, 2).join('').toUpperCase();
  }, [user]);

  useEffect(() => {
    const ac = new AbortController();
    const loadData = async () => {
      if (!user) return;
      try {
        const [wb, tx, tfa, pf, ud, nt, rf] = await Promise.all([
          apiFetch<WalletEntry[]>('/api/wallet/balances', { signal: ac.signal }).catch(() => null),
          apiFetch<Transaction[]>('/api/wallet/transactions', { signal: ac.signal }).catch(() => null),
          apiFetch<{ enabled?: boolean }>('/api/auth/2fa/status', { signal: ac.signal }).catch(() => null),
          apiFetch<any>('/api/users/profile', { signal: ac.signal }).catch(() => null),
          apiFetch<any[]>('/api/users/documents', { signal: ac.signal }).catch(() => null),
          apiFetch<{ unread: number; notifications: UserNotificationEntry[] }>('/api/users/notifications', { signal: ac.signal }).catch(() => null),
          apiFetch<ReferralSummary>('/api/users/referral', { signal: ac.signal }).catch(() => null),
        ]);
        if (wb) setWallets(wb);
        if (tx) setTransactions(tx);
        if (tfa) setTwoFactorEnabled(Boolean(tfa.enabled));
        if (pf) setProfile(pf);
        if (ud) setDocuments(Array.isArray(ud) ? ud : []);
        if (nt) {
          setUserNotifications(Array.isArray(nt.notifications) ? nt.notifications : []);
          setNotificationsUnread(Number(nt.unread || 0));
        }
        if (rf) setReferral(rf);
      } catch (err: any) {
        const msg = String(err?.message || '');
        if (/Abort|ERR_ABORTED|ERR_CANCELED/i.test(msg)) return;
        setWallets([]); setTransactions([]); setTwoFactorEnabled(false); setProfile(null); setDocuments([]); setUserNotifications([]); setNotificationsUnread(0); setReferral(null);
      }
    };
    loadData();
    return () => { ac.abort('dev-strict'); };
  }, [user]);

  const latestDocByType = (type: string) => {
    const list = documents.filter((d: any) => String(d.type) === type).sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    return list[0] || null;
  };

  const uploadSingleDoc = async (
    type: 'identity_front' | 'identity_back' | 'passport' | 'selfie' | 'proof_of_address' | 'iban_proof' | 'id_card' | 'bank_statement',
    file: File,
  ) => {
    try {
      const res = await fetch(`/api/users/documents/upload?type=${encodeURIComponent(type)}&filename=${encodeURIComponent(file.name)}`, {
        method: 'POST',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        credentials: 'same-origin',
        body: file,
      });
      if (res.ok) {
        const d = await apiFetch<any[]>('/api/users/documents', { cache: 'no-store' }).catch(() => []);
        setDocuments(Array.isArray(d) ? d : []);
        addNotification({ type: 'success', message: 'Documento enviado' });
      } else {
        const err = await res.json().catch(() => null) as any;
        addNotification({ type: 'error', message: (err?.error as string) || 'Falha ao enviar documento' });
      }
    } catch {
      addNotification({ type: 'error', message: 'Erro ao enviar ficheiro' });
    }
  };

  const saveCookies = () => {
    try {
      localStorage.setItem('cookie_analytics', JSON.stringify(cookieAnalytics));
      localStorage.setItem('cookie_marketing', JSON.stringify(cookieMarketing));
      localStorage.setItem('cookie_functional', JSON.stringify(cookieFunctional));
      addNotification({ type: 'success', message: 'Definições guardadas' });
    } catch { addNotification({ type: 'error', message: 'Falha ao guardar' }); }
  };

  const saveLimits = () => {
    try {
      localStorage.setItem('limit_deposit', String(limitDeposit));
      localStorage.setItem('limit_bet', String(limitBet));
      addNotification({ type: 'success', message: 'Limites guardados' });
    } catch { addNotification({ type: 'error', message: 'Falha ao guardar' }); }
  };

  const fetchSupportMessages = async () => {
    try {
      const r = await fetch('/api/support/chat/messages', { credentials: 'same-origin' });
      if (r.ok) { const j = await r.json() as { sender: string; content: string; created_at: string }[]; setSupportMessages(Array.isArray(j) ? j : []); }
    } catch { void 0; }
  };

  const sendSupportMessage = async () => {
    const content = supportText.trim();
    if (!content) return;
    setSupportLoading(true);
    try {
      const r = await fetch('/api/support/chat/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ content }),
      });
      if (!r.ok) throw new Error('Falha ao enviar mensagem');
      setSupportText('');
      await fetchSupportMessages();
      addNotification({ type: 'success', message: 'Mensagem enviada ao suporte' });
    } catch (err: any) {
      addNotification({ type: 'error', message: err?.message || 'Falha ao enviar mensagem ao suporte' });
    } finally {
      setSupportLoading(false);
    }
  };

  const handleNotificationClick = async (item: UserNotificationEntry) => {
    if (!item.is_read) {
      await apiFetch(`/api/users/notifications/${encodeURIComponent(item.id)}/read`, { method: 'POST' }).catch(() => null);
      setUserNotifications((prev) => prev.map((entry) => entry.id === item.id ? { ...entry, is_read: true } : entry));
      setNotificationsUnread((prev) => Math.max(0, prev - 1));
    }
    if (item.cta_target) navigate(item.cta_target);
  };

  const handleInviteFriend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim()) {
      addNotification({ type: 'error', message: 'Indique o email do amigo' });
      return;
    }
    setInviteLoading(true);
    try {
      const data = await apiFetch<{ reward_eur?: number; status?: string }>('/api/users/referral/invite', {
        method: 'POST',
        body: JSON.stringify({ email: inviteEmail.trim(), name: inviteName.trim() }),
      });
      addNotification({
        type: 'success',
        message: data?.status === 'rewarded'
          ? 'Convite validado. Foram creditados 5€ em freebets.'
          : 'Convite enviado com sucesso.',
      });
      setInviteEmail('');
      setInviteName('');
      await Promise.all([fetchReferral(), fetchUserNotifications()]);
    } catch (err: any) {
      addNotification({ type: 'error', message: err?.message || 'Falha ao enviar convite' });
    } finally {
      setInviteLoading(false);
    }
  };

  const copyText = async (value: string, successMessage: string) => {
    try {
      await navigator.clipboard.writeText(value);
      addNotification({ type: 'success', message: successMessage });
    } catch {
      addNotification({ type: 'error', message: 'Não foi possível copiar agora' });
    }
  };

  useEffect(() => {
    let timer: any = null;
    if (selectedItem === 'Preciso de ajuda' && user) {
      fetchSupportMessages();
      timer = setInterval(fetchSupportMessages, 10000);
    }
    return () => { if (timer) clearInterval(timer); };
  }, [selectedItem, user]);

  useEffect(() => {
    if (selectedItem === 'Novidades' || selectedItem === 'Notificações') {
      void fetchUserNotifications(true);
    }
    if (selectedItem === 'Convida um amigo') {
      void fetchReferral();
    }
  }, [selectedItem]);

  const balance = wallets.find(w => w.currency === 'EUR')?.balance ?? 0;
  const fullName =
    String(
      profile?.full_name ||
      [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') ||
      (user as any)?.username ||
      'Utilizador'
    ).trim() || 'Utilizador';
  const email = String(profile?.email || (user as any)?.email || '').trim();
  const completionChecks = [
    Boolean(fullName && fullName !== 'Utilizador'),
    Boolean(email),
    Boolean(profile?.phone),
    Boolean(profile?.birth_date),
    kycStatus === 'verified',
  ];
  const completionPercent = Math.round((completionChecks.filter(Boolean).length / completionChecks.length) * 100);
  const accountStatusLabel = selfExclude ? 'Restrições Ativas' : 'Conta operacional';
  const accountStatusDescription = selfExclude
    ? `Autoexclusão ativa${selfExcludeUntil ? ` até ${new Date(selfExcludeUntil).toLocaleDateString('pt-PT')}` : ''}.`
    : 'Sem bloqueios manuais ativos neste momento.';
  const heroBadges = [
    {
      key: 'kyc',
      label: kycStatus === 'verified' ? 'KYC Verificado' : 'KYC Pendente',
      className: kycStatus === 'verified'
        ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/25'
        : 'bg-amber-500/15 text-amber-300 border border-amber-500/25',
    },
    {
      key: 'theme',
      label: darkMode ? 'Modo Escuro' : 'Modo Claro',
      className: 'bg-white/10 text-white border border-white/10',
    },
    {
      key: 'status',
      label: selfExclude ? 'Autoexclusão' : 'Conta Ativa',
      className: selfExclude
        ? 'bg-red-500/15 text-red-300 border border-red-500/25'
        : 'bg-teal-500/15 text-teal-300 border border-teal-500/25',
    },
  ];
  const quickActions = [
    { label: 'A minha conta', icon: User, action: () => setSelectedItem('A minha conta'), accent: 'bg-blue-500/15 text-blue-300' },
    { label: 'Pagamentos', icon: CreditCard, action: () => setSelectedItem('Métodos de Pagamento'), accent: 'bg-emerald-500/15 text-emerald-300' },
    { label: 'Documentos', icon: FileText, action: () => setSelectedItem('Documentos'), accent: 'bg-amber-500/15 text-amber-300' },
    { label: 'Novidades', icon: Bell, action: () => setSelectedItem('Novidades'), accent: 'bg-violet-500/15 text-violet-300' },
    { label: 'Ajuda', icon: MessageCircle, action: () => setSelectedItem('Preciso de ajuda'), accent: 'bg-pink-500/15 text-pink-300' },
    { label: 'Limites', icon: ShieldAlert, action: () => setSelectedItem('Definir os meus limites'), accent: 'bg-orange-500/15 text-orange-300' },
  ];

  const DocBadge = ({ type }: { type: string }) => {
    const doc = latestDocByType(type);
    if (!doc) return <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 border border-gray-200">Não enviado</span>;
    if (doc.status === 'verified') return <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 border border-emerald-500/20">✓ Aprovado</span>;
    if (doc.status === 'rejected') return <span className="text-[11px] px-2 py-0.5 rounded-full bg-red-500/15 text-red-500 border border-red-500/20">✕ Rejeitado</span>;
    return <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-600 border border-amber-500/20">⏳ Em análise</span>;
  };

  // ── Card wrapper (mode-aware) ──────────────────────────────────────
  const Card = ({ title, children, className = '' }: { title?: string; children: React.ReactNode; className?: string }) => (
    <div className={`rounded-2xl ${t.card(darkMode)} ${className}`}>
      {title && (
        <div className={`px-5 py-4 border-b ${t.border(darkMode)}`}>
          <h2 className={`text-[15px] font-semibold ${t.heading(darkMode)}`}>{title}</h2>
        </div>
      )}
      <div className="p-5">{children}</div>
    </div>
  );

  const InfoRow = ({ label, value }: { label: string; value: React.ReactNode }) => (
    <div className={`flex items-center justify-between py-2.5 border-b last:border-0 ${t.border(darkMode)}`}>
      <span className={`text-[13px] ${t.sub(darkMode)}`}>{label}</span>
      <span className={`text-[13px] font-medium text-right max-w-[55%] truncate ${t.heading(darkMode)}`}>{value ?? '—'}</span>
    </div>
  );

  const InputField = (props: React.InputHTMLAttributes<HTMLInputElement> & { label?: string }) => {
    const { label, className = '', ...rest } = props;
    return (
      <div className="space-y-1.5">
        {label && <label className={`block text-[12px] font-medium ${t.label(darkMode)}`}>{label}</label>}
        <input
          {...rest}
          className={`w-full rounded-xl border px-4 py-2.5 text-[14px] focus:outline-none transition ${t.input(darkMode)} ${className}`}
        />
      </div>
    );
  };

  // ── Confirm dialog for self-exclusion ─────────────────────────────
  const ExcludeConfirmDialog = () => (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setExcludeConfirmOpen(false)} />
      <div className={`relative rounded-2xl p-6 w-full max-w-sm shadow-2xl ${t.card(darkMode)}`}>
        <h3 className={`text-[17px] font-bold mb-2 ${t.heading(darkMode)}`}>Confirmar autoexclusão</h3>
        <p className={`text-[13px] mb-5 ${t.sub(darkMode)}`}>Tens a certeza? Não poderás depositar nem apostar durante o período selecionado.</p>
        <div className="flex gap-3">
          <button onClick={() => setExcludeConfirmOpen(false)} className={`flex-1 py-2.5 rounded-xl text-[13px] font-semibold border ${t.border(darkMode)} ${t.heading(darkMode)} hover:opacity-70 transition`}>
            Cancelar
          </button>
          <button
            onClick={() => {
              const durationMap: Record<string, number | null> = { '24h': 1, '7d': 7, '30d': 30, '6m': 180, 'indef': 0 };
              const days = durationMap[excludeDuration];
              const until = days ? new Date(Date.now() + days * 86400000).toISOString() : null;
              setSelfExclude(true, until);
              setExcludeConfirmOpen(false);
            }}
            className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-[13px] font-bold transition"
          >
            Confirmar
          </button>
        </div>
      </div>
    </div>
  );

  // ── 2FA setup overlay ─────────────────────────────────────────────
  const TwoFactorOverlay = () => (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setShow2faSetup(false)} />
      <div className={`relative rounded-2xl p-6 w-full max-w-sm shadow-2xl ${darkMode ? 'bg-[#151e2d]' : 'bg-white'}`}>
        <button onClick={() => setShow2faSetup(false)} className={`absolute top-4 right-4 ${t.sub(darkMode)} hover:opacity-70`}>✕</button>
        <TwoFactor
          mode="setup"
          onSuccess={() => {
            setTwoFactorEnabled(true);
            setShow2faSetup(false);
          }}
          onCancel={() => setShow2faSetup(false)}
        />
      </div>
    </div>
  );

  // ── Content panel header (back button) ────────────────────────────
  const ContentHeader = ({ title }: { title: string }) => (
    <div className="px-4 pt-4">
      <div className={`max-w-3xl mx-auto rounded-[28px] overflow-hidden ${t.card(darkMode)}`}>
        <div className="relative px-5 py-5">
          <div className="absolute inset-0 opacity-20 pointer-events-none">
            <div className="absolute top-0 right-0 w-40 h-40 rounded-full bg-red-500 blur-3xl -translate-y-1/2 translate-x-1/3"></div>
            <div className="absolute bottom-0 left-0 w-32 h-32 rounded-full bg-blue-500 blur-3xl translate-y-1/2 -translate-x-1/3"></div>
          </div>
          <div className="relative flex items-center gap-3">
            <button
              onClick={() => setSelectedItem(null)}
              className={`flex items-center justify-center w-10 h-10 rounded-2xl transition hover:opacity-80 ${darkMode ? 'bg-white/10 text-white border border-white/10' : 'bg-gray-100 text-gray-700 border border-gray-200'}`}
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div className="min-w-0">
              <p className={`text-[11px] uppercase tracking-[0.18em] mb-1 ${t.label(darkMode)}`}>Centro de Perfil</p>
              <h2 className={`text-[18px] font-bold truncate ${t.heading(darkMode)}`}>{title}</h2>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  // ── Menu row component ─────────────────────────────────────────────
  const MenuItem = ({
    icon: Icon,
    label,
    onClick,
    badge,
    badgeColor = 'bg-gray-900 text-white',
    isLast = false,
  }: {
    icon: React.ElementType;
    label: string;
    onClick: () => void;
    badge?: React.ReactNode;
    badgeColor?: string;
    isLast?: boolean;
  }) => (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3.5 px-4 py-3.5 text-left transition hover:opacity-70 ${!isLast ? `border-b ${t.border(darkMode)}` : ''}`}
    >
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${darkMode ? 'bg-white/8' : 'bg-gray-100'}`}>
        <Icon className={`w-4.5 h-4.5 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`} style={{ width: 18, height: 18 }} />
      </div>
      <span className={`flex-1 text-[15px] font-medium ${t.heading(darkMode)}`}>{label}</span>
      {badge && (
        <span className={`text-[12px] font-bold px-2.5 py-1 rounded-full ${badgeColor}`}>{badge}</span>
      )}
      <ChevronRight className={`w-4 h-4 shrink-0 ${t.sub(darkMode)}`} />
    </button>
  );

  // ── Section title ──────────────────────────────────────────────────
  const SectionTitle = ({ children }: { children: React.ReactNode }) => (
    <h3 className={`text-[17px] font-bold mb-2 px-1 ${t.heading(darkMode)}`}>{children}</h3>
  );

  // ── Main menu view ─────────────────────────────────────────────────
  const renderMenu = () => (
    <div className="max-w-3xl mx-auto px-4 pb-12 pt-4">
      <div className={`relative overflow-hidden rounded-[28px] p-5 mb-6 shadow-sm ${darkMode ? 'bg-gradient-to-br from-[#0f1726] via-[#121d2d] to-[#18253a] border border-white/5 shadow-black/20' : 'bg-white border border-gray-200'}`}>
        <div className={`absolute inset-x-0 top-0 h-32 ${darkMode ? 'bg-gradient-to-r from-red-500/20 via-transparent to-cyan-500/20' : 'bg-gradient-to-r from-red-100 via-white to-amber-50'}`}></div>
        <div className="relative grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div>
            <div className="flex items-start gap-4">
              <div className="relative shrink-0">
                <div className={`relative flex h-24 w-24 items-center justify-center overflow-hidden rounded-[30px] shadow-lg ${
                  darkMode ? 'bg-gradient-to-br from-slate-700 via-slate-800 to-black' : 'bg-gradient-to-br from-[#f6f7fb] via-white to-[#eef2f7] border border-gray-200'
                }`}>
                  <div className={`absolute -left-3 top-6 flex h-10 w-10 items-center justify-center rounded-full text-lg shadow ${darkMode ? 'bg-amber-400 text-slate-900' : 'bg-amber-300 text-amber-900'}`}>€</div>
                  <div className={`absolute -right-2 top-12 flex h-8 w-8 items-center justify-center rounded-full text-sm shadow ${darkMode ? 'bg-yellow-300 text-slate-900' : 'bg-yellow-200 text-yellow-900'}`}>€</div>
                  <div className={`absolute left-4 top-4 flex h-14 w-14 items-center justify-center rounded-2xl text-xl font-black ${
                    darkMode ? 'bg-gradient-to-br from-red-500 to-rose-700 text-white' : 'bg-gradient-to-br from-red-500 to-rose-600 text-white'
                  }`}>
                    {initials}
                  </div>
                </div>
                {kycStatus === 'verified' && (
                  <div className={`absolute -bottom-1 -right-1 w-8 h-8 rounded-full bg-emerald-500 flex items-center justify-center ${darkMode ? 'border-2 border-[#101826]' : 'border-2 border-white'}`}>
                    <BadgeCheck className="w-4 h-4 text-white" />
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${darkMode ? 'bg-white/10 text-red-200 border border-white/10' : 'bg-red-50 text-red-600 border border-red-100'}`}>
                    <UserCheck className="w-3.5 h-3.5" />
                    Centro de Perfil
                  </span>
                  {heroBadges.map((badge) => (
                    <span
                      key={badge.key}
                      className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-[11px] font-medium ${
                        darkMode
                          ? badge.className
                          : badge.key === 'kyc'
                            ? (kycStatus === 'verified' ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' : 'bg-amber-50 text-amber-600 border border-amber-100')
                            : badge.key === 'status'
                              ? (selfExclude ? 'bg-red-50 text-red-600 border border-red-100' : 'bg-teal-50 text-teal-600 border border-teal-100')
                              : 'bg-gray-50 text-gray-600 border border-gray-200'
                      }`}
                    >
                      {badge.label}
                    </span>
                  ))}
                </div>
                <h1 className={`text-[30px] sm:text-[32px] leading-tight font-black ${darkMode ? 'text-white' : 'text-gray-950'}`}>{fullName}</h1>
                {email && <p className={`text-[14px] mt-1 break-all ${darkMode ? 'text-gray-300' : 'text-gray-500'}`}>{email}</p>}
                <p className={`text-[13px] mt-3 max-w-2xl ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                  Gere conta, pagamentos, documentos, segurança e preferências num painel único mais limpo.
                </p>
              </div>
            </div>

            <div className={`mt-5 rounded-[28px] p-5 ${darkMode ? 'border border-white/10 bg-white/5' : 'border border-gray-200 bg-[#fbfbfc]'}`}>
              <div className="grid gap-5 lg:grid-cols-[1fr_auto]">
                <div>
                  <p className={`text-[13px] font-semibold ${darkMode ? 'text-gray-300' : 'text-gray-500'}`}>Saldo disponível</p>
                  <p className={`mt-1 text-[44px] font-black leading-none ${darkMode ? 'text-white' : 'text-gray-950'}`}>
                    {balance.toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €
                  </p>
                  <div className={`mt-5 space-y-2 text-[15px] font-black ${darkMode ? 'text-white' : 'text-gray-950'}`}>
                    <div className="flex items-center justify-between gap-4">
                      <span className="inline-flex items-center gap-2"><span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] text-white">F</span> FREEBETS</span>
                      <span>{Number(profile?.free_bet_balance || 0).toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €</span>
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <span className="inline-flex items-center gap-2"><span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-purple-600 text-[10px] text-white">C</span> BÓNUS DE CASINO</span>
                      <span>0,00 €</span>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col justify-end gap-3">
                  <button
                    onClick={() => navigate('/withdraw')}
                    className={`min-w-[180px] rounded-2xl px-6 py-3 text-[16px] font-black transition ${darkMode ? 'bg-slate-950 text-white hover:bg-black' : 'bg-slate-950 text-white hover:bg-slate-800'}`}
                  >
                    Levantar
                  </button>
                  <button
                    onClick={() => navigate('/deposit')}
                    className="min-w-[180px] rounded-2xl bg-red-600 px-6 py-3 text-[16px] font-black text-white transition hover:bg-red-700"
                  >
                    Depositar
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className={`rounded-[28px] p-5 flex flex-col justify-between ${darkMode ? 'border border-white/10 bg-white/6' : 'border border-gray-200 bg-[#fbfbfc]'}`}>
            <div>
              <div className="flex items-center justify-between mb-3">
                <p className={`text-[14px] font-semibold ${darkMode ? 'text-white' : 'text-gray-900'}`}>Conclusão do Perfil</p>
                <span className={`text-[12px] font-semibold ${darkMode ? 'text-red-200' : 'text-red-500'}`}>{completionPercent}%</span>
              </div>
              <div className={`h-2 rounded-full overflow-hidden mb-4 ${darkMode ? 'bg-white/10' : 'bg-gray-200'}`}>
                <div
                  className="h-full rounded-full bg-gradient-to-r from-red-500 to-orange-400 transition-all duration-500"
                  style={{ width: `${completionPercent}%` }}
                ></div>
              </div>
              <div className="space-y-2">
                {[
                  { label: 'Nome completo', done: Boolean(fullName && fullName !== 'Utilizador') },
                  { label: 'Email', done: Boolean(email) },
                  { label: 'Telefone', done: Boolean(profile?.phone) },
                  { label: 'Nascimento', done: Boolean(profile?.birth_date) },
                  { label: 'KYC', done: kycStatus === 'verified' },
                ].map((item) => (
                  <div key={item.label} className="flex items-center justify-between text-[13px]">
                    <span className={darkMode ? 'text-gray-300' : 'text-gray-600'}>{item.label}</span>
                    <span className={`inline-flex items-center gap-1 ${item.done ? 'text-emerald-500' : darkMode ? 'text-gray-400' : 'text-gray-400'}`}>
                      {item.done ? <Check className="w-3.5 h-3.5" /> : <History className="w-3.5 h-3.5" />}
                      {item.done ? 'Completo' : 'Pendente'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div className={`mt-5 rounded-2xl p-4 ${darkMode ? 'border border-white/10 bg-black/15' : 'border border-gray-200 bg-white'}`}>
              <p className="text-[11px] uppercase tracking-[0.18em] text-gray-400 mb-1">Estado da Conta</p>
              <p className={darkMode ? 'text-white font-semibold mb-1' : 'text-gray-900 font-semibold mb-1'}>{accountStatusLabel}</p>
              <p className={`text-[12px] ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>{accountStatusDescription}</p>
            </div>
          </div>
        </div>
      </div>

      <div className={`rounded-[28px] p-5 mb-6 ${t.card(darkMode)}`}>
        <div className="flex items-center justify-between gap-3 mb-4">
          <h2 className={`text-[15px] font-bold ${t.heading(darkMode)}`}>Ações rápidas</h2>
          <span className={`text-[12px] ${t.sub(darkMode)}`}>Acessos principais da conta</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {quickActions.map(({ label, icon: Icon, action, accent }) => (
            <button
              key={label}
              onClick={action}
              className={`rounded-2xl border p-4 text-left transition hover:opacity-85 ${darkMode ? 'border-white/8 bg-white/[0.03]' : 'border-gray-100 bg-gray-50/80'}`}
            >
              <div className={`w-10 h-10 rounded-2xl flex items-center justify-center mb-3 ${accent}`}>
                <Icon className="w-5 h-5" />
              </div>
              <p className={`text-[14px] font-semibold ${t.heading(darkMode)}`}>{label}</p>
              <p className={`text-[12px] mt-1 ${t.sub(darkMode)}`}>Abrir secção</p>
            </button>
          ))}
        </div>
      </div>

      {/* Section: Agora */}
      <div className="mb-6">
        <SectionTitle>Agora</SectionTitle>
        <div className={`rounded-[24px] overflow-hidden ${t.card(darkMode)}`}>
          <MenuItem icon={Bell} label="Novidades" onClick={() => setSelectedItem('Novidades')} badge={notificationsUnread > 0 ? String(notificationsUnread) : undefined} badgeColor="bg-gray-900 text-white" />
          <MenuItem icon={Percent} label="Código promocional" onClick={() => setSelectedItem('Código promocional')} />
          <MenuItem icon={Gift} label="Convida um amigo" onClick={() => setSelectedItem('Convida um amigo')}
            badge={<span className="flex items-center gap-1"><span className="w-3.5 h-3.5 rounded-full bg-red-600 inline-flex items-center justify-center text-[8px] font-bold text-white">F</span> 5 €</span>}
            badgeColor="bg-gray-900 text-white"
            isLast
          />
        </div>
      </div>

      {/* Section: Gerir conta */}
      <div className="mb-6">
        <SectionTitle>Gerir conta</SectionTitle>
        <div className={`rounded-[24px] overflow-hidden ${t.card(darkMode)}`}>
          <MenuItem icon={User} label="A minha conta" onClick={() => setSelectedItem('A minha conta')} />
          <MenuItem icon={CreditCard} label="Métodos de pagamento" onClick={() => setSelectedItem('Métodos de Pagamento')} />
          <MenuItem icon={MessageCircle} label="Mensagens" onClick={() => setSelectedItem('Preciso de ajuda')} />
          <MenuItem icon={FileText} label="Documentos" onClick={() => setSelectedItem('Documentos')} />
          <MenuItem icon={Lock} label="Acesso e segurança" onClick={() => setSelectedItem('A minha conta')} />
          <MenuItem icon={Bell} label="Notificações" onClick={() => setSelectedItem('Notificações')} badge={notificationsUnread > 0 ? String(notificationsUnread) : undefined} badgeColor="bg-red-600 text-white" />
          <MenuItem icon={Settings} label="Opções" onClick={() => setSelectedItem('Opções')} isLast />
        </div>
      </div>

      {/* Section: Jogo Responsável */}
      <div className="mb-6">
        <SectionTitle>Jogo Responsável</SectionTitle>
        <div className={`rounded-[24px] overflow-hidden ${t.card(darkMode)}`}>
          <MenuItem icon={Phone} label="Definir os meus limites" onClick={() => setSelectedItem('Definir os meus limites')} />
          <MenuItem icon={ShieldAlert} label="Autoexclusão" onClick={() => setSelectedItem('Autoexclusão')} />
          <MenuItem icon={Info} label="Informação" onClick={() => setSelectedItem('Informação')} isLast />
        </div>
      </div>

      {/* Section: Ajuda e informação legal */}
      <div className="mb-8">
        <SectionTitle>Ajuda e informação legal</SectionTitle>
        <div className={`rounded-[24px] overflow-hidden ${t.card(darkMode)}`}>
          <MenuItem icon={HelpCircle} label="Precisas de ajuda?" onClick={() => setSelectedItem('Preciso de ajuda')} />
          <MenuItem icon={ClipboardList} label="Termos e condições gerais" onClick={() => setSelectedItem('Termos e condições gerais')} />
          <MenuItem icon={Shield} label="Política de privacidade e cookies" onClick={() => setSelectedItem('Políticas e privacidade')} />
          <MenuItem icon={Cookie} label="Definições de cookies" onClick={() => setSelectedItem('Definições de cookies')} isLast />
        </div>
      </div>

      {/* Sair */}
      <div className="text-center pb-4">
        <button
          onClick={signOut}
          className="text-red-600 text-[17px] font-bold hover:text-red-700 transition"
        >
          Sair
        </button>
      </div>
    </div>
  );

  // ── Content sections ───────────────────────────────────────────────
  const renderContent = () => {
    // ── INFORMAÇÃO ─────────────────────────────────────────────────
    if (selectedItem === 'Informação') return (
      <div className="p-4 space-y-4 max-w-lg mx-auto">
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: 'Saldo EUR', value: `€${balance.toFixed(2)}`, color: 'text-emerald-500' },
            { label: '2FA', value: twoFactorEnabled ? 'Ativo' : 'Inativo', color: twoFactorEnabled ? 'text-emerald-500' : 'text-amber-500' },
            { label: 'KYC', value: kycStatus === 'verified' ? 'Verificado' : 'Pendente', color: kycStatus === 'verified' ? 'text-emerald-500' : 'text-amber-500' },
            { label: 'Autoexclusão', value: selfExclude ? 'Ativa' : 'Inativa', color: selfExclude ? 'text-red-500' : t.sub(darkMode) },
          ].map(s => (
            <div key={s.label} className={`rounded-2xl p-4 ${t.card(darkMode)}`}>
              <p className={`text-[11px] uppercase tracking-wider mb-1 ${t.label(darkMode)}`}>{s.label}</p>
              <p className={`text-[16px] font-bold ${s.color}`}>{s.value}</p>
            </div>
          ))}
        </div>
        <Card title="Resumo da conta">
          <InfoRow label="Utilizador" value={(user as any)?.username || '—'} />
          <InfoRow label="E-mail" value={profile?.email || '—'} />
          <InfoRow label="Limite depósito" value={`€${limitDeposit.toFixed(2)}`} />
          <InfoRow label="Limite aposta" value={`€${limitBet.toFixed(2)}`} />
          <InfoRow label="Membro desde" value={profile?.created_at ? new Date(profile.created_at).toLocaleDateString('pt-PT') : '—'} />
        </Card>
        <Card title="Verificação de documentos">
          {[
            { label: 'Documento de Identificação', type: 'id_card' },
            { label: 'Comprovativo de IBAN', type: 'iban_proof' },
            { label: 'Extrato Bancário', type: 'bank_statement' },
          ].map(d => (
            <div key={d.type} className={`flex items-center justify-between py-2.5 border-b last:border-0 ${t.border(darkMode)}`}>
              <span className={`text-[13px] ${t.sub(darkMode)}`}>{d.label}</span>
              <DocBadge type={d.type} />
            </div>
          ))}
          <button onClick={() => setSelectedItem('Documentos')} className="mt-3 text-[12px] text-red-500 hover:text-red-400 transition">
            Gerir documentos →
          </button>
        </Card>
        <Card title="Transações recentes">
          {transactions.length === 0 ? (
            <p className={`text-[13px] py-4 text-center ${t.sub(darkMode)}`}>Sem transações</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className={`border-b ${t.border(darkMode)}`}>
                    {['Data', 'Tipo', 'Estado', 'Valor'].map((h) => (
                      <th key={h} className={`py-2 font-medium text-left last:text-right ${t.label(darkMode)}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...transactions].sort((a,b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(0, 5).map(tx => (
                    <tr key={tx.id} className={`border-b last:border-0 ${t.border(darkMode)}`}>
                      <td className={`py-2.5 ${t.sub(darkMode)}`}>{new Date(tx.created_at).toLocaleDateString('pt-PT')}</td>
                      <td className={`py-2.5 ${t.heading(darkMode)}`}>{tx.type === 'DEPOSIT' ? 'Depósito' : tx.type === 'WITHDRAWAL' ? 'Levantamento' : tx.type}</td>
                      <td className="py-2.5"><TxStatusPill status={tx.status} /></td>
                      <td className={`py-2.5 text-right font-mono ${t.heading(darkMode)}`}>{tx.amount >= 0 ? '+' : ''}€{Math.abs(tx.amount).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <button onClick={() => setSelectedItem('Operações')} className="mt-3 text-[12px] text-red-500 hover:text-red-400 transition">
            Ver todas →
          </button>
        </Card>
      </div>
    );

    // ── A MINHA CONTA ──────────────────────────────────────────────
    if (selectedItem === 'A minha conta') return (
      <div className="p-4 space-y-4 max-w-lg mx-auto">
        <Card title="Identidade">
          <InfoRow label="Género" value={profile?.gender} />
          <InfoRow label="Apelido(s)" value={profile?.last_name} />
          <InfoRow label="Nome(s)" value={profile?.first_name} />
          <InfoRow label="Data de nascimento" value={profile?.birth_date} />
        </Card>
        <Card title="Contactos">
          <InfoRow label="E-mail" value={profile?.email} />
          <InfoRow label="Telemóvel" value={profile?.phone} />
        </Card>
        <Card title="Morada">
          <InfoRow label="Morada" value={profile?.address} />
          <InfoRow label="Cidade" value={profile?.city} />
        </Card>
        <Card title="Conta">
          <InfoRow label="Utilizador" value={(user as any)?.username} />
          <InfoRow label="ID" value={(user as any)?.id} />
          <InfoRow label="Criada em" value={profile?.created_at ? new Date(profile.created_at).toLocaleString('pt-PT') : undefined} />
          <InfoRow label="Termos aceites" value={profile?.terms_accepted_at ? new Date(profile.terms_accepted_at).toLocaleDateString('pt-PT') : 'Não validado'} />
        </Card>
        <Card title="Autenticação de dois fatores (2FA)">
          <div className="flex items-center justify-between">
            <div>
              <p className={`text-[14px] font-medium ${t.heading(darkMode)}`}>2FA {twoFactorEnabled ? 'ativo' : 'inativo'}</p>
              <p className={`text-[12px] mt-0.5 ${t.sub(darkMode)}`}>Protege a tua conta com uma camada extra de segurança</p>
            </div>
            {twoFactorEnabled ? (
              <span className="flex items-center gap-1.5 text-emerald-500 text-[13px] font-semibold">
                <BadgeCheck className="w-4 h-4" /> Ativo
              </span>
            ) : (
              <button onClick={() => setShow2faSetup(true)} className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-[13px] font-semibold transition">
                Ativar 2FA
              </button>
            )}
          </div>
        </Card>
      </div>
    );

    // ── MÉTODOS DE PAGAMENTO ───────────────────────────────────────
    if (selectedItem === 'Métodos de Pagamento') return (
      <div className="p-4 space-y-4 max-w-lg mx-auto">
        <div className="flex gap-2">
          {(['withdrawals', 'security'] as const).map(tab => (
            <button key={tab} onClick={() => setActivePaymentTab(tab)}
              className={`px-5 py-2.5 rounded-xl text-[13px] font-semibold transition ${activePaymentTab === tab ? 'bg-red-600 text-white' : `${t.card(darkMode)} ${t.sub(darkMode)}`}`}>
              {tab === 'withdrawals' ? 'Levantamentos' : 'Segurança'}
            </button>
          ))}
        </div>
        {activePaymentTab === 'withdrawals' && (
          <div className="space-y-4">
            <Card>
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl bg-blue-500/15 flex items-center justify-center shrink-0">
                  <Banknote className="w-4 h-4 text-blue-500" />
                </div>
                <div>
                  <p className={`text-[13px] font-semibold mb-2 ${t.heading(darkMode)}`}>Regras de levantamento</p>
                  <ul className={`space-y-1 text-[12px] ${t.sub(darkMode)}`}>
                    <li>• &lt; €10 — rejeitado automaticamente</li>
                    <li>• €10 – €300 — processamento automático</li>
                    <li>• &gt; €300 — agendado 24h (verificação manual)</li>
                  </ul>
                </div>
              </div>
            </Card>
            {kycStatus !== 'verified' && (
              <Card>
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-xl bg-amber-500/15 flex items-center justify-center shrink-0">
                    <AlertTriangle className="w-4 h-4 text-amber-500" />
                  </div>
                  <div>
                    <p className={`text-[13px] font-semibold mb-1 ${t.heading(darkMode)}`}>Verificação necessária</p>
                    <p className={`text-[12px] mb-3 ${t.sub(darkMode)}`}>O primeiro levantamento requer verificação de identidade e IBAN.</p>
                    <button onClick={() => setSelectedItem('Documentos')} className="text-[12px] text-red-500 hover:text-red-400">
                      Ir para Documentos →
                    </button>
                  </div>
                </div>
              </Card>
            )}
            {kycStatus === 'verified' && (
              <Card title="Solicitar levantamento">
                {hasIban ? (
                  <div className="space-y-4">
                    <div className={`flex items-center justify-between p-4 rounded-xl border ${t.border(darkMode)} ${darkMode ? 'bg-white/3' : 'bg-gray-50'}`}>
                      <div>
                        <p className={`text-[11px] uppercase tracking-wide mb-1 ${t.label(darkMode)}`}>Conta de destino</p>
                        <p className={`font-mono text-[14px] font-bold ${t.heading(darkMode)}`}>{savedIban}</p>
                        <p className={`text-[12px] mt-0.5 ${t.sub(darkMode)}`}>{savedHolder}</p>
                      </div>
                      <div className="w-8 h-8 rounded-full bg-emerald-500/15 flex items-center justify-center">
                        <Check className="w-4 h-4 text-emerald-500" />
                      </div>
                    </div>
                    <InputField label="Valor a levantar (€)" type="number" value={withdrawAmount} onChange={e => setWithdrawAmount(Number(e.target.value))} min={20} />
                    <button onClick={handleWithdraw} disabled={withdrawLoading} className="w-full py-3 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-bold text-[14px] transition">
                      {withdrawLoading ? 'A processar...' : 'Confirmar levantamento'}
                    </button>
                  </div>
                ) : (
                  <form onSubmit={handleSaveIban} className="space-y-4">
                    <InputField label="IBAN (PT50...)" value={newIban} onChange={e => setNewIban(e.target.value.toUpperCase())} placeholder="PT50 0000 0000 0000 0000 0000 0" />
                    <InputField label="Nome do titular" value={holderName} onChange={e => setHolderName(e.target.value)} placeholder="Nome completo" />
                    <button type="submit" disabled={withdrawLoading} className="w-full py-3 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-bold text-[14px] transition">
                      {withdrawLoading ? 'A guardar...' : 'Guardar IBAN'}
                    </button>
                  </form>
                )}
              </Card>
            )}
          </div>
        )}
        {activePaymentTab === 'security' && (
          <div className="space-y-4">
            <Card>
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl bg-emerald-500/15 flex items-center justify-center shrink-0">
                  <Shield className="w-4 h-4 text-emerald-500" />
                </div>
                <div>
                  <p className={`text-[13px] font-semibold mb-1 ${t.heading(darkMode)}`}>Pagamentos seguros</p>
                  <p className={`text-[12px] ${t.sub(darkMode)}`}>Todas as transações são processadas por entidades autorizadas (PayPal, Revolut).</p>
                </div>
              </div>
            </Card>
          </div>
        )}
      </div>
    );

    if (selectedItem === 'Novidades' || selectedItem === 'Notificações') return (
      <div className="p-4 space-y-4 max-w-lg mx-auto">
        <Card title={selectedItem === 'Novidades' ? 'Novidades e atualizações' : 'Notificações'}>
          {userNotifications.length === 0 ? (
            <p className={`text-[13px] py-6 text-center ${t.sub(darkMode)}`}>Sem novidades de momento.</p>
          ) : (
            <div className="space-y-3">
              {userNotifications.map((item) => (
                <button
                  key={item.id}
                  onClick={() => handleNotificationClick(item)}
                  className={`w-full rounded-2xl border p-4 text-left transition hover:opacity-85 ${item.is_read ? '' : 'ring-1 ring-red-500/30'} ${darkMode ? 'border-white/10 bg-white/[0.03]' : 'border-gray-200 bg-gray-50'}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className={`text-[14px] font-bold ${t.heading(darkMode)}`}>{item.title}</p>
                      <p className={`mt-1 text-[12px] ${t.sub(darkMode)}`}>{item.body}</p>
                      <p className={`mt-2 text-[11px] ${t.label(darkMode)}`}>{new Date(item.created_at).toLocaleString('pt-PT')}</p>
                    </div>
                    {!item.is_read && <span className="mt-1 inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />}
                  </div>
                  {item.cta_label && (
                    <div className="mt-3 text-[12px] font-semibold text-red-500">{item.cta_label} →</div>
                  )}
                </button>
              ))}
            </div>
          )}
        </Card>
      </div>
    );

    if (selectedItem === 'Código promocional') return (
      <div className="p-4 space-y-4 max-w-lg mx-auto">
        <Card title="Código promocional">
          <div className="space-y-4">
            <div className={`rounded-2xl border p-4 ${darkMode ? 'border-white/10 bg-white/[0.03]' : 'border-gray-200 bg-gray-50'}`}>
              <p className={`text-[14px] font-semibold ${t.heading(darkMode)}`}>Campanhas ativas</p>
              <p className={`mt-1 text-[12px] ${t.sub(darkMode)}`}>
                As promoções e códigos ativos ficam centralizados aqui. Quando existir uma campanha nova, ela também aparece em Novidades.
              </p>
            </div>
            <button
              onClick={() => navigate('/promotions')}
              className="w-full py-3 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold text-[14px] transition"
            >
              Ver promoções disponíveis
            </button>
          </div>
        </Card>
      </div>
    );

    if (selectedItem === 'Convida um amigo') return (
      <div className="p-4 space-y-4 max-w-lg mx-auto">
        <Card title="Convida um amigo">
          <div className="space-y-4">
            <div className={`rounded-2xl border p-4 ${darkMode ? 'border-white/10 bg-white/[0.03]' : 'border-gray-200 bg-gray-50'}`}>
              <p className={`text-[12px] uppercase tracking-[0.18em] ${t.label(darkMode)}`}>Oferta ativa</p>
              <p className={`mt-2 text-[18px] font-black ${t.heading(darkMode)}`}>Ganha 5€ em freebets por cada amigo válido</p>
              <p className={`mt-1 text-[12px] ${t.sub(darkMode)}`}>Partilhe o código abaixo. Quando o amigo se registar com ele, o sistema credita as freebets.</p>
            </div>

            <div className={`rounded-2xl border p-4 ${darkMode ? 'border-white/10 bg-black/15' : 'border-gray-200 bg-white'}`}>
              <p className={`text-[11px] uppercase tracking-[0.18em] mb-2 ${t.label(darkMode)}`}>Código pessoal</p>
              <div className="flex items-center gap-2">
                <div className={`flex-1 rounded-xl border px-4 py-3 font-black tracking-[0.2em] ${darkMode ? 'border-white/10 bg-white/[0.03] text-white' : 'border-gray-200 bg-gray-50 text-gray-900'}`}>
                  {referral?.code || 'BET62'}
                </div>
                <button onClick={() => copyText(referral?.code || 'BET62', 'Código copiado')} className="px-4 py-3 rounded-xl bg-red-600 hover:bg-red-700 text-white text-[13px] font-bold transition">
                  Copiar
                </button>
              </div>
              <button onClick={() => copyText(referral?.link || 'https://bet62.com/register', 'Link copiado')} className={`mt-3 w-full py-3 rounded-xl text-[13px] font-semibold transition ${darkMode ? 'bg-white/8 text-white hover:bg-white/12' : 'bg-gray-100 text-gray-800 hover:bg-gray-200'}`}>
                Copiar link do convite
              </button>
            </div>

            <div className="grid grid-cols-3 gap-3">
              {[
                { label: 'Convidados', value: referral?.invited_count ?? 0 },
                { label: 'Validados', value: referral?.rewarded_count ?? 0 },
                { label: 'Freebets', value: `${Number(referral?.total_reward_eur || 0).toFixed(2)} €` },
              ].map((item) => (
                <div key={item.label} className={`rounded-2xl p-4 ${t.card(darkMode)}`}>
                  <p className={`text-[11px] uppercase tracking-wide ${t.label(darkMode)}`}>{item.label}</p>
                  <p className={`mt-2 text-[18px] font-black ${t.heading(darkMode)}`}>{item.value}</p>
                </div>
              ))}
            </div>

            <form onSubmit={handleInviteFriend} className="space-y-3">
              <InputField label="Nome do amigo" value={inviteName} onChange={(e) => setInviteName(e.target.value)} placeholder="Opcional" />
              <InputField label="Email do amigo" type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="amigo@email.pt" />
              <button type="submit" disabled={inviteLoading} className="w-full py-3 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-bold text-[14px] transition">
                {inviteLoading ? 'A enviar convite...' : 'Enviar convite'}
              </button>
            </form>
          </div>
        </Card>

        <Card title="Convites registados">
          {referral?.invites?.length ? (
            <div className="space-y-3">
              {referral.invites.map((item) => (
                <div key={item.id} className={`rounded-2xl border p-4 ${darkMode ? 'border-white/10 bg-white/[0.03]' : 'border-gray-200 bg-gray-50'}`}>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className={`text-[14px] font-semibold ${t.heading(darkMode)}`}>{item.email}</p>
                      <p className={`text-[12px] ${t.sub(darkMode)}`}>{new Date(item.created_at).toLocaleString('pt-PT')}</p>
                    </div>
                    <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${item.status === 'rewarded' ? 'bg-emerald-500/15 text-emerald-500' : 'bg-amber-500/15 text-amber-500'}`}>
                      {item.status === 'rewarded' ? `+${item.reward_amount.toFixed(2)}€` : 'Pendente'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className={`text-[13px] py-6 text-center ${t.sub(darkMode)}`}>Ainda não existem convites registados.</p>
          )}
        </Card>
      </div>
    );

    // ── OPERAÇÕES ──────────────────────────────────────────────────
    if (selectedItem === 'Operações') return (
      <div className="p-4 max-w-lg mx-auto">
        <Card title="Histórico de operações">
          {transactions.length === 0 ? (
            <p className={`text-[13px] py-8 text-center ${t.sub(darkMode)}`}>Sem transações registadas</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className={`border-b ${t.border(darkMode)}`}>
                    {['Data', 'Tipo', 'Estado', 'Valor'].map(h => (
                      <th key={h} className={`py-3 font-medium text-left last:text-right ${t.label(darkMode)}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {transactions.map(tx => (
                    <tr key={tx.id} className={`border-b last:border-0 ${t.border(darkMode)}`}>
                      <td className={`py-3 ${t.sub(darkMode)}`}>{new Date(tx.created_at).toLocaleString('pt-PT')}</td>
                      <td className={`py-3 ${t.heading(darkMode)}`}>{tx.type === 'DEPOSIT' ? 'Depósito' : tx.type === 'WITHDRAWAL' ? 'Levantamento' : tx.type}</td>
                      <td className="py-3"><TxStatusPill status={tx.status} /></td>
                      <td className={`py-3 text-right font-mono ${t.heading(darkMode)}`}>
                        {tx.amount >= 0 ? '+' : ''}€{Math.abs(tx.amount).toFixed(2)}
                        <span className={`text-[11px] ml-1 ${t.label(darkMode)}`}>{tx.currency}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    );

    // ── DOCUMENTOS ─────────────────────────────────────────────────
    if (selectedItem === 'Documentos') return (
      <div className="p-4 space-y-4 max-w-lg mx-auto">
        <div className={`flex items-center gap-4 p-5 rounded-2xl border ${kycStatus === 'verified' ? 'bg-emerald-500/8 border-emerald-500/20' : 'bg-blue-500/8 border-blue-500/20'}`}>
          <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${kycStatus === 'verified' ? 'bg-emerald-500/15' : 'bg-blue-500/15'}`}>
            {kycStatus === 'verified' ? <BadgeCheck className="w-6 h-6 text-emerald-500" /> : <FileText className="w-6 h-6 text-blue-500" />}
          </div>
          <div>
            <p className={`text-[14px] font-bold ${t.heading(darkMode)}`}>{kycStatus === 'verified' ? 'Conta verificada' : 'Verificação pendente'}</p>
            <p className={`text-[12px] mt-0.5 ${t.sub(darkMode)}`}>
              {kycStatus === 'verified' ? 'Levantamentos disponíveis.' : 'A verificação pode demorar até 24 horas.'}
            </p>
          </div>
        </div>
        {[
          { type: 'id_card', title: 'Documento de identificação', desc: 'Cartão de Cidadão ou Passaporte válido e legível.' },
          { type: 'identity_front', title: 'Frente do documento', desc: 'Imagem nítida da frente do documento oficial.' },
          { type: 'identity_back', title: 'Verso do documento', desc: 'Imagem nítida do verso do documento oficial.' },
          { type: 'selfie', title: 'Selfie de validação', desc: 'Selfie atual e nítida para confirmar identidade.' },
          { type: 'proof_of_address', title: 'Comprovativo de morada', desc: 'Fatura ou documento recente com a sua morada.' },
          { type: 'iban_proof', title: 'Comprovativo de IBAN', desc: 'Documento oficial do banco com o seu nome e IBAN.' },
          { type: 'bank_statement', title: 'Extrato bancário', desc: 'Documento recente (máx. 3 meses) com nome e IBAN.' },
        ].map(d => (
          <Card key={d.type}>
            <div className="flex items-start justify-between mb-4">
              <div>
                <p className={`text-[14px] font-semibold ${t.heading(darkMode)}`}>{d.title}</p>
                <p className={`text-[12px] mt-0.5 ${t.sub(darkMode)}`}>{d.desc}</p>
              </div>
              <DocBadge type={d.type} />
            </div>
            <label className="flex items-center gap-3 cursor-pointer group">
              <div className={`flex-1 rounded-xl border border-dashed px-4 py-3 transition ${darkMode ? 'border-white/15 bg-white/3 group-hover:bg-white/5' : 'border-gray-300 bg-gray-50 group-hover:bg-gray-100'}`}>
                <p className={`text-[12px] ${t.sub(darkMode)}`}>Clique para selecionar imagem ou ficheiro <span className={t.label(darkMode)}>· JPG, PNG, PDF (máx. 8 MB)</span></p>
              </div>
              <input type="file" accept=".jpg,.jpeg,.png,.pdf" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) uploadSingleDoc(d.type as any, f); }} />
            </label>
          </Card>
        ))}
      </div>
    );

    // ── OPÇÕES ─────────────────────────────────────────────────────
    if (selectedItem === 'Opções') return (
      <div className="p-4 max-w-lg mx-auto">
        <Card title="Aparência">
          <div className="space-y-5">
            <div className="flex items-center justify-between">
              <div>
                <p className={`text-[14px] font-medium ${t.heading(darkMode)}`}>Tema automático</p>
                <p className={`text-[12px] mt-0.5 ${t.sub(darkMode)}`}>Segue o tema do sistema operativo</p>
              </div>
              <Toggle checked={autoTheme} onChange={setAutoTheme} />
            </div>
            <div className={`flex items-center justify-between ${autoTheme ? 'opacity-40 pointer-events-none' : ''}`}>
              <div>
                <p className={`text-[14px] font-medium ${t.heading(darkMode)}`}>Modo escuro</p>
                <p className={`text-[12px] mt-0.5 ${t.sub(darkMode)}`}>Ativar interface em modo noturno</p>
              </div>
              <Toggle checked={darkMode} onChange={() => toggleDarkMode()} />
            </div>
          </div>
        </Card>
      </div>
    );

    // ── JOGOS RESPONSÁVEIS ─────────────────────────────────────────
    if (selectedItem === 'Jogos responsáveis') return (
      <div className="p-4 space-y-3 max-w-lg mx-auto">
        {[
          { icon: Lock, title: 'Limites de depósito e aposta', desc: 'Define valores máximos para controlar os teus gastos.', action: () => setSelectedItem('Definir os meus limites') },
          { icon: Eye, title: 'Autoexclusão', desc: 'Pausa a tua conta por um período definido.', action: () => setSelectedItem('Autoexclusão') },
          { icon: Shield, title: '2FA', desc: 'Protege o acesso à conta.', action: () => setSelectedItem('A minha conta') },
        ].map(({ icon: Icon, title, desc, action }) => (
          <button key={title} onClick={action} className={`w-full flex items-center gap-4 p-4 rounded-2xl border transition text-left ${t.card(darkMode)} hover:opacity-70`}>
            <div className="w-10 h-10 rounded-xl bg-red-600/15 flex items-center justify-center shrink-0">
              <Icon className="w-5 h-5 text-red-500" />
            </div>
            <div className="flex-1 min-w-0">
              <p className={`text-[13px] font-semibold ${t.heading(darkMode)}`}>{title}</p>
              <p className={`text-[12px] ${t.sub(darkMode)}`}>{desc}</p>
            </div>
            <ChevronRight className={`w-4 h-4 shrink-0 ${t.sub(darkMode)}`} />
          </button>
        ))}
      </div>
    );

    // ── DEFINIR LIMITES ────────────────────────────────────────────
    if (selectedItem === 'Definir os meus limites') return (
      <div className="p-4 space-y-4 max-w-lg mx-auto">
        {selfExclude && (
          <div className="flex items-start gap-3 p-4 rounded-2xl bg-red-500/10 border border-red-500/20">
            <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
            <p className="text-[13px] text-red-500">Não é possível alterar limites durante o período de autoexclusão.</p>
          </div>
        )}
        <Card title="Limites financeiros">
          <div className={`space-y-4 ${selfExclude ? 'opacity-40 pointer-events-none' : ''}`}>
            <InputField label="Limite de depósito (€)" type="number" min="0" value={limitDeposit} onChange={e => setLimitDeposit(Number(e.target.value))} disabled={selfExclude} />
            <InputField label="Limite de aposta (€)" type="number" min="0" value={limitBet} onChange={e => setLimitBet(Number(e.target.value))} disabled={selfExclude} />
            <button onClick={saveLimits} disabled={selfExclude} className="w-full py-3 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-bold text-[14px] transition">
              Guardar limites
            </button>
          </div>
        </Card>
      </div>
    );

    // ── AUTOEXCLUSÃO ───────────────────────────────────────────────
    if (selectedItem === 'Autoexclusão') return (
      <div className="p-4 space-y-4 max-w-lg mx-auto">
        <Card title="Estado da autoexclusão">
          {selfExclude ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-4 rounded-2xl bg-red-500/10 border border-red-500/20">
                <div className="w-10 h-10 rounded-xl bg-red-500/15 flex items-center justify-center shrink-0">
                  <ShieldAlert className="w-5 h-5 text-red-500" />
                </div>
                <div>
                  <p className="text-[14px] font-bold text-red-500">Autoexclusão ativa</p>
                  <p className={`text-[12px] mt-0.5 ${t.sub(darkMode)}`}>
                    {selfExcludeUntil ? `Até ${new Date(selfExcludeUntil).toLocaleString('pt-PT')}` : 'Permanente'}
                  </p>
                </div>
              </div>
              <button onClick={() => setSelfExclude(false, null)} className={`w-full py-3 rounded-xl text-[13px] font-semibold transition border ${t.border(darkMode)} ${t.heading(darkMode)}`}>
                Desativar autoexclusão
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <p className={`text-[13px] ${t.sub(darkMode)}`}>Suspende temporariamente o acesso à tua conta. Não poderás depositar, apostar ou alterar limites durante este período.</p>
              <div>
                <label className={`block text-[12px] font-medium mb-1.5 ${t.label(darkMode)}`}>Duração</label>
                <select value={excludeDuration} onChange={e => setExcludeDuration(e.target.value as any)}
                  className={`w-full rounded-xl border px-4 py-2.5 text-[14px] focus:outline-none transition ${t.selectBg(darkMode)}`}>
                  <option value="24h">24 horas</option>
                  <option value="7d">7 dias</option>
                  <option value="30d">30 dias</option>
                  <option value="6m">6 meses</option>
                  <option value="indef">Permanente</option>
                </select>
              </div>
              <button onClick={() => setExcludeConfirmOpen(true)} className="w-full py-3 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold text-[14px] transition">
                Ativar autoexclusão
              </button>
            </div>
          )}
        </Card>
        {history.length > 0 && (
          <Card title="Histórico">
            {history.map((h, i) => (
              <div key={i} className={`flex items-center justify-between py-2.5 border-b last:border-0 ${t.border(darkMode)}`}>
                <span className={`text-[13px] ${t.sub(darkMode)}`}>{h.action === 'activate' ? 'Ativada' : 'Desativada'}</span>
                <span className={`text-[12px] ${t.label(darkMode)}`}>{new Date(h.created_at).toLocaleString('pt-PT')}</span>
              </div>
            ))}
          </Card>
        )}
      </div>
    );

    // ── SUPORTE ────────────────────────────────────────────────────
    if (selectedItem === 'Preciso de ajuda') return (
      <div className="p-4 space-y-4 max-w-lg mx-auto">
        <div className={`flex items-center gap-4 p-5 rounded-2xl ${t.card(darkMode)}`}>
          <div className="w-10 h-10 rounded-xl bg-red-600/15 flex items-center justify-center shrink-0">
            <HelpCircle className="w-5 h-5 text-red-500" />
          </div>
          <div>
            <p className={`text-[14px] font-semibold ${t.heading(darkMode)}`}>Atendimento ao cliente</p>
            <a href="mailto:atendimentoaoclientebet62@gmail.com" className="text-[12px] text-red-500 hover:text-red-400 transition">
              atendimentoaoclientebet62@gmail.com
            </a>
          </div>
        </div>
        <Card title="Chat de suporte">
          <div className={`h-64 overflow-y-auto rounded-xl p-3 mb-3 space-y-2 ${darkMode ? 'bg-black/20' : 'bg-gray-50'}`}>
            {supportMessages.length === 0 ? (
              <p className={`text-[13px] text-center py-8 ${t.sub(darkMode)}`}>Sem mensagens. Escreve-nos abaixo.</p>
            ) : supportMessages.map((m, idx) => (
              <div key={idx} className={`flex ${m.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[75%] px-3 py-2 rounded-2xl text-[13px] ${m.sender === 'user' ? 'bg-red-600 text-white' : darkMode ? 'bg-white/8 text-white' : 'bg-white text-gray-800 shadow-sm'}`}>
                  <p>{m.content}</p>
                  <p className="text-[10px] mt-1 opacity-60">{new Date(m.created_at).toLocaleTimeString('pt-PT')}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <input type="text" value={supportText} onChange={e => setSupportText(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && sendSupportMessage()}
              placeholder="Escreve a tua mensagem..."
              className={`flex-1 rounded-xl border px-4 py-2.5 text-[14px] focus:outline-none transition ${t.input(darkMode)}`}
            />
            <button onClick={sendSupportMessage} disabled={supportLoading || !supportText.trim()}
              className="px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-semibold text-[13px] transition">
              Enviar
            </button>
          </div>
        </Card>
      </div>
    );

    // ── TERMOS ─────────────────────────────────────────────────────
    if (selectedItem === 'Termos e condições gerais') return (
      <div className="p-4 max-w-lg mx-auto">
        <Card title="Termos e condições gerais">
          <div className="space-y-5 text-[13px]">
            {[
              { n: '1', title: 'Regras de utilização', items: ['A plataforma é destinada exclusivamente a utilizadores maiores de 18 anos.', 'Cada conta é pessoal, individual e intransmissível.', 'É proibida a utilização de bots, scripts ou automações.', 'As odds podem ser ajustadas; quando necessário, será solicitada confirmação do utilizador.', 'Reservamo-nos o direito de suspender ou encerrar contas em caso de conduta indevida.'] },
              { n: '2', title: 'Jogo responsável', items: ['Disponibilizamos ferramentas de limites, notificações e autoexclusão.', 'A autoexclusão impede depósitos, apostas e criação de novos boletins.'] },
              { n: '3', title: 'Depósitos e levantamentos', items: ['Depósito mínimo: €10 | Máximo por operação: €20.000.', 'O levantamento mínimo é de €20.', 'Todos os levantamentos requerem IBAN válido e verificação da identidade.'] },
              { n: '4', title: 'Suporte e reclamações', items: ['Contacto: atendimentoaoclientebet62@gmail.com', 'Todas as reclamações serão analisadas caso a caso.'] },
            ].map(sec => (
              <div key={sec.n}>
                <p className={`font-semibold mb-2 ${t.heading(darkMode)}`}>{sec.n}. {sec.title}</p>
                <ul className={`space-y-1.5 pl-4 ${t.sub(darkMode)}`}>
                  {sec.items.map((item, i) => <li key={i} className="before:content-['•'] before:mr-2 before:text-gray-400">{item}</li>)}
                </ul>
              </div>
            ))}
            <p className={`text-[11px] pt-2 border-t ${t.border(darkMode)} ${t.label(darkMode)}`}>
              Última atualização: 05-01-2026 · Aceite em: {profile?.terms_accepted_at ? new Date(profile.terms_accepted_at).toLocaleDateString('pt-PT') : 'não validado'}
            </p>
          </div>
        </Card>
      </div>
    );

    // ── POLÍTICA DE PRIVACIDADE ────────────────────────────────────
    if (selectedItem === 'Políticas e privacidade') return (
      <div className="p-4 max-w-lg mx-auto">
        <Card title="Política de privacidade e cookies">
          <div className="space-y-5 text-[13px]">
            {[
              { title: 'Introdução', text: 'A presente Política de Privacidade descreve como os dados pessoais dos utilizadores são recolhidos, utilizados e protegidos. O tratamento é efetuado em conformidade com o RGPD (UE 2016/679).' },
              { title: 'Dados recolhidos', text: 'Nome e apelido, e-mail, telemóvel, IBAN, documentos de identificação (KYC), endereço IP e histórico de atividade.' },
              { title: 'Finalidade', text: 'Gestão de conta, processamento de transações, verificação de identidade, cumprimento legal e comunicação.' },
              { title: 'Partilha de dados', text: 'Dados partilhados apenas com prestadores de pagamento e entidades legais quando exigido. Nunca vendemos dados pessoais.' },
              { title: 'Direitos do utilizador', text: 'Acesso, correção, eliminação, limitação, oposição ao tratamento e portabilidade dos dados nos termos do RGPD.' },
              { title: 'Contacto', text: 'Para questões de privacidade: atendimentoaoclientebet62@gmail.com' },
            ].map(sec => (
              <div key={sec.title}>
                <p className={`font-semibold mb-1.5 ${t.heading(darkMode)}`}>{sec.title}</p>
                <p className={`leading-relaxed ${t.sub(darkMode)}`}>{sec.text}</p>
              </div>
            ))}
          </div>
        </Card>
      </div>
    );

    // ── DEFINIÇÕES DE COOKIES ──────────────────────────────────────
    if (selectedItem === 'Definições de cookies') return (
      <div className="p-4 max-w-lg mx-auto">
        <Card title="Definições de cookies">
          <div className="space-y-1">
            {[
              { key: 'essential', label: 'Essenciais', desc: 'Autenticação, segurança e operações básicas. Obrigatórios.', fixed: true },
              { key: 'functional', label: 'Funcionais', desc: 'Guardam preferências do utilizador.', value: cookieFunctional, onChange: setCookieFunctional },
              { key: 'analytics', label: 'Analíticos', desc: 'Ajudam a melhorar o desempenho da plataforma.', value: cookieAnalytics, onChange: setCookieAnalytics },
              { key: 'marketing', label: 'Marketing', desc: 'Publicidade relevante e personalizada.', value: cookieMarketing, onChange: setCookieMarketing },
            ].map(c => (
              <div key={c.key} className={`flex items-center justify-between py-4 border-b last:border-0 ${t.border(darkMode)}`}>
                <div>
                  <p className={`text-[13px] font-semibold ${t.heading(darkMode)}`}>{c.label}</p>
                  <p className={`text-[12px] mt-0.5 ${t.sub(darkMode)}`}>{c.desc}</p>
                </div>
                {(c as any).fixed ? (
                  <span className="text-[11px] px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-500 font-semibold">Sempre ativo</span>
                ) : (
                  <Toggle checked={(c as any).value} onChange={(c as any).onChange} />
                )}
              </div>
            ))}
            <button onClick={saveCookies} className="mt-4 w-full py-3 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold text-[14px] transition">
              Guardar preferências
            </button>
          </div>
        </Card>
      </div>
    );

    return null;
  };

  const contentTitles: Record<string, string> = {
    'Informação': 'Informação',
    'A minha conta': 'A minha conta',
    'Métodos de Pagamento': 'Métodos de pagamento',
    'Novidades': 'Novidades',
    'Notificações': 'Notificações',
    'Código promocional': 'Código promocional',
    'Convida um amigo': 'Convida um amigo',
    'Operações': 'Operações',
    'Documentos': 'Documentos',
    'Opções': 'Opções',
    'Jogos responsáveis': 'Jogo responsável',
    'Definir os meus limites': 'Definir os meus limites',
    'Autoexclusão': 'Autoexclusão',
    'Preciso de ajuda': 'Ajuda',
    'Termos e condições gerais': 'Termos e condições',
    'Políticas e privacidade': 'Política de privacidade',
    'Definições de cookies': 'Definições de cookies',
  };

  // ── RENDER ─────────────────────────────────────────────────────────
  return (
    <div className={`min-h-screen ${t.bg(darkMode)}`}>

      {/* Overlays */}
      {excludeConfirmOpen && <ExcludeConfirmDialog />}
      {show2faSetup && <TwoFactorOverlay />}

      {/* Self-exclusion banner */}
      {selfExclude && (
        <div className="bg-red-600 px-4 py-3">
          <div className="max-w-lg mx-auto flex items-center gap-3">
            <AlertTriangle className="w-4 h-4 text-white shrink-0" />
            <p className="text-[13px] text-white font-medium">
              Conta em autoexclusão {selfExcludeUntil ? `até ${new Date(selfExcludeUntil).toLocaleString('pt-PT')}` : '(permanente)'}.
            </p>
          </div>
        </div>
      )}

      {/* Content view */}
      {selectedItem ? (
        <div>
          <ContentHeader title={contentTitles[selectedItem] || selectedItem} />
          <div className="pb-12">
            {renderContent()}
          </div>
        </div>
      ) : (
        renderMenu()
      )}
    </div>
  );
};

export default ProfilePage;
