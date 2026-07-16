import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useApp } from '@/react-app/contexts/AppContext';
import { apiFetch } from '@/react-app/utils/api';
import { TwoFactor } from '@/react-app/components/TwoFactorSetup';
import {
  Shield, AlertTriangle, Check, History, Banknote, CreditCard,
  User, Wallet, FileText, HelpCircle, LogOut, Settings,
  Lock, ChevronRight, Bell, Eye, BarChart3, BadgeCheck,
  ClipboardList, CookingPot, BookOpen, Globe, ShieldAlert,
} from 'lucide-react';

interface Wallet { currency: string; balance: number }
interface Transaction { id: string; type: string; status: string; amount: number; currency: string; created_at: string; metadata?: string }

// ── Sidebar nav structure ──────────────────────────────────────────
const NAV_GROUPS = [
  {
    label: 'Conta',
    icon: User,
    items: ['Informação', 'A minha conta', 'Documentos'],
  },
  {
    label: 'Financeiro',
    icon: Wallet,
    items: ['Métodos de Pagamento', 'Operações'],
  },
  {
    label: 'Segurança',
    icon: Shield,
    items: ['Opções', 'Jogos responsáveis', 'Definir os meus limites', 'Autoexclusão'],
  },
  {
    label: 'Suporte',
    icon: HelpCircle,
    items: ['Preciso de ajuda'],
  },
  {
    label: 'Legal',
    icon: BookOpen,
    items: ['Termos e condições gerais', 'Políticas e privacidade', 'Cookies', 'Definições de cookies'],
  },
];

const ALL_ITEMS = NAV_GROUPS.flatMap(g => g.items);

const ITEM_ICONS: Record<string, React.ElementType> = {
  'Informação': BarChart3,
  'A minha conta': User,
  'Documentos': FileText,
  'Métodos de Pagamento': CreditCard,
  'Operações': History,
  'Opções': Settings,
  'Jogos responsáveis': ShieldAlert,
  'Definir os meus limites': Lock,
  'Autoexclusão': Eye,
  'Preciso de ajuda': HelpCircle,
  'Termos e condições gerais': ClipboardList,
  'Políticas e privacidade': Globe,
  'Cookies': CookingPot,
  'Definições de cookies': Bell,
};

// ── Status pill helper ─────────────────────────────────────────────
function TxStatusPill({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    COMPLETED:          { label: 'Pago',        cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20' },
    PAID:               { label: 'Pago',        cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20' },
    PENDING:            { label: 'Processando', cls: 'bg-amber-500/15  text-amber-400  border-amber-500/20'  },
    REQUESTED:          { label: 'Agendado',    cls: 'bg-amber-500/15  text-amber-400  border-amber-500/20'  },
    AUTHORIZED:         { label: 'Autorizado',  cls: 'bg-blue-500/15   text-blue-400   border-blue-500/20'   },
    FAILED:             { label: 'Falhou',      cls: 'bg-red-500/15    text-red-400    border-red-500/20'    },
    REJECTED:           { label: 'Rejeitado',   cls: 'bg-red-500/15    text-red-400    border-red-500/20'    },
    IBAN_PENDING_REVIEW:{ label: 'IBAN análise',cls: 'bg-purple-500/15 text-purple-400 border-purple-500/20' },
  };
  const { label, cls } = map[status] ?? { label: status, cls: 'bg-white/5 text-gray-400 border-white/10' };
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${cls}`}>
      {label}
    </span>
  );
}

// ── Toggle switch ──────────────────────────────────────────────────
function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${checked ? 'bg-red-600' : 'bg-white/10'}`}
    >
      <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-6' : 'translate-x-1'}`} />
    </button>
  );
}

// ── Card wrapper ───────────────────────────────────────────────────
function Card({ title, children, className = '' }: { title?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-white/8 bg-[#151e2d] ${className}`}>
      {title && (
        <div className="px-6 py-4 border-b border-white/8">
          <h2 className="text-[15px] font-semibold text-white">{title}</h2>
        </div>
      )}
      <div className="p-6">{children}</div>
    </div>
  );
}

// ── Section heading inside cards ───────────────────────────────────
function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[11px] font-bold uppercase tracking-widest text-gray-500 mb-3">{children}</h3>
  );
}

// ── Info row ───────────────────────────────────────────────────────
function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-white/5 last:border-0">
      <span className="text-[13px] text-gray-400">{label}</span>
      <span className="text-[13px] text-white font-medium text-right max-w-[55%] truncate">{value ?? '—'}</span>
    </div>
  );
}

// ── Input field ────────────────────────────────────────────────────
function Input(props: React.InputHTMLAttributes<HTMLInputElement> & { label?: string }) {
  const { label, className = '', ...rest } = props;
  return (
    <div className="space-y-1.5">
      {label && <label className="block text-[12px] font-medium text-gray-400">{label}</label>}
      <input
        {...rest}
        className={`w-full rounded-xl bg-white/5 border border-white/10 px-4 py-2.5 text-[14px] text-white placeholder:text-gray-600 focus:outline-none focus:border-red-500/50 focus:bg-white/8 transition ${className}`}
      />
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────
const ProfilePage: React.FC = () => {
  const { darkMode, toggleDarkMode, autoTheme, setAutoTheme, addNotification, user, signOut, selfExclude, selfExcludeUntil, setSelfExclude } = useApp();
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [profile, setProfile] = useState<any | null>(null);
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false);
  const [show2faSetup, setShow2faSetup] = useState(false);

  const [selectedItem, setSelectedItem] = useState<string | null>('Informação');

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
    if (withdrawAmount < 10) return addNotification({ type: 'error', message: 'Mínimo €10' });
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

  const firstName = useMemo(() => {
    const name = (user && (user as any).username) ? String((user as any).username) : '';
    return name.split(' ')[0] || name || 'Utilizador';
  }, [user]);

  const initials = useMemo(() => {
    const name = (user && (user as any).username) ? String((user as any).username) : 'U';
    return name.split(' ').map((n: string) => n[0]).slice(0, 2).join('').toUpperCase();
  }, [user]);

  useEffect(() => {
    const ac = new AbortController();
    const loadData = async () => {
      if (!user) return;
      try {
        const [wb, tx, tfa, pf, ud] = await Promise.all([
          apiFetch<Wallet[]>('/api/wallet/balances', { signal: ac.signal }).catch(() => null),
          apiFetch<Transaction[]>('/api/wallet/transactions', { signal: ac.signal }).catch(() => null),
          apiFetch<{ enabled?: boolean }>('/api/auth/2fa/status', { signal: ac.signal }).catch(() => null),
          apiFetch<any>('/api/users/profile', { signal: ac.signal }).catch(() => null),
          apiFetch<any[]>('/api/users/documents', { signal: ac.signal }).catch(() => null),
        ]);
        if (wb) setWallets(wb);
        if (tx) setTransactions(tx);
        if (tfa) setTwoFactorEnabled(Boolean(tfa.enabled));
        if (pf) setProfile(pf);
        if (ud) setDocuments(Array.isArray(ud) ? ud : []);
      } catch (err: any) {
        const msg = String(err?.message || '');
        if (/Abort|ERR_ABORTED|ERR_CANCELED/i.test(msg)) return;
        setWallets([]); setTransactions([]); setTwoFactorEnabled(false); setProfile(null); setDocuments([]);
      }
    };
    loadData();
    return () => { ac.abort('dev-strict'); };
  }, [user]);

  const fileToBase64 = (file: File) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => { const res = String(reader.result || ''); resolve(res.includes(',') ? res.split(',')[1] : res); };
    reader.onerror = () => reject(new Error('Falha ao ler ficheiro'));
    reader.readAsDataURL(file);
  });

  const latestDocByType = (type: string) => {
    const list = documents.filter((d: any) => String(d.type) === type).sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    return list[0] || null;
  };

  const uploadSingleDoc = async (type: 'iban_proof'|'id_card'|'bank_statement', file: File) => {
    try {
      const base64 = await fileToBase64(file);
      const res = await fetch('/api/users/documents', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
        body: JSON.stringify({ documents: [{ type, filename: file.name, mime_type: file.type, size: file.size, content_base64: base64 }] }),
      });
      if (res.ok) {
        const ud = await fetch('/api/users/documents', { credentials: 'same-origin' });
        if (ud.ok) { const d = await ud.json(); setDocuments(Array.isArray(d) ? d : []); }
        addNotification({ type: 'success', message: 'Documento enviado' });
      } else {
        const err = await res.json().catch(() => null) as any;
        addNotification({ type: 'error', message: (err?.error as string) || 'Falha ao enviar documento' });
      }
    } catch { addNotification({ type: 'error', message: 'Erro ao ler ficheiro' }); }
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

  useEffect(() => {
    let timer: any = null;
    if (selectedItem === 'Preciso de ajuda' && user) {
      fetchSupportMessages();
      timer = setInterval(fetchSupportMessages, 10000);
    }
    return () => { if (timer) clearInterval(timer); };
  }, [selectedItem, user]);

  const sendSupportMessage = async () => {
    const content = supportText.trim();
    if (!content) return;
    setSupportLoading(true);
    try {
      await apiFetch('/api/support/chat/messages', { method: 'POST', body: JSON.stringify({ content }) });
      setSupportText('');
      addNotification({ type: 'success', message: 'Mensagem enviada' });
      await fetchSupportMessages();
    } catch (err: any) {
      addNotification({ type: 'error', message: err?.message || 'Falha ao enviar' });
    } finally { setSupportLoading(false); }
  };

  const balance = wallets.find(w => w.currency === 'EUR')?.balance ?? 0;

  // ── Doc status badge ──────────────────────────────────────────────
  const DocBadge = ({ type }: { type: string }) => {
    const doc = latestDocByType(type);
    if (!doc) return <span className="text-[11px] px-2 py-0.5 rounded-full bg-white/8 text-gray-400 border border-white/10">Não enviado</span>;
    if (doc.status === 'verified') return <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">✓ Aprovado</span>;
    if (doc.status === 'rejected') return <span className="text-[11px] px-2 py-0.5 rounded-full bg-red-500/15 text-red-400 border border-red-500/20">✕ Rejeitado</span>;
    return <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/20">⏳ Em análise</span>;
  };

  // ── Sidebar nav item ──────────────────────────────────────────────
  const NavItem = ({ item }: { item: string }) => {
    const Icon = ITEM_ICONS[item] ?? ChevronRight;
    const active = selectedItem === item;
    return (
      <button
        onClick={() => setSelectedItem(item)}
        className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left text-[13px] transition-all ${
          active
            ? 'bg-red-600/15 text-red-400 font-semibold'
            : 'text-gray-400 hover:bg-white/5 hover:text-white'
        }`}
      >
        <Icon className="w-3.5 h-3.5 shrink-0" />
        <span className="truncate">{item}</span>
        {active && <ChevronRight className="w-3 h-3 ml-auto shrink-0 text-red-400" />}
      </button>
    );
  };

  // ── Content sections ───────────────────────────────────────────────

  const renderContent = () => {
    // ── INFORMAÇÃO (dashboard) ─────────────────────────────────────
    if (selectedItem === 'Informação') return (
      <div className="space-y-5">
        {/* Stats strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Saldo EUR', value: `€${balance.toFixed(2)}`, accent: 'text-emerald-400' },
            { label: '2FA', value: twoFactorEnabled ? 'Ativo' : 'Inativo', accent: twoFactorEnabled ? 'text-emerald-400' : 'text-amber-400' },
            { label: 'KYC', value: kycStatus === 'verified' ? 'Verificado' : 'Pendente', accent: kycStatus === 'verified' ? 'text-emerald-400' : 'text-amber-400' },
            { label: 'Autoexclusão', value: selfExclude ? 'Ativa' : 'Inativa', accent: selfExclude ? 'text-red-400' : 'text-gray-300' },
          ].map(s => (
            <div key={s.label} className="rounded-2xl border border-white/8 bg-[#151e2d] p-4">
              <div className="text-[11px] text-gray-500 uppercase tracking-wider mb-1">{s.label}</div>
              <div className={`text-[17px] font-bold ${s.accent}`}>{s.value}</div>
            </div>
          ))}
        </div>

        {/* Account summary + shortcuts */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <Card title="Resumo da conta">
            <InfoRow label="Utilizador" value={(user as any)?.username || '—'} />
            <InfoRow label="E-mail" value={profile?.email || '—'} />
            <InfoRow label="Limite depósito" value={`€${limitDeposit.toFixed(2)}`} />
            <InfoRow label="Limite aposta" value={`€${limitBet.toFixed(2)}`} />
            <InfoRow label="Membro desde" value={profile?.created_at ? new Date(profile.created_at).toLocaleDateString('pt-PT') : '—'} />
          </Card>

          <Card title="Verificação de documentos">
            <div className="space-y-3">
              {[
                { label: 'Documento de Identificação', type: 'id_card' },
                { label: 'Comprovativo de IBAN', type: 'iban_proof' },
                { label: 'Extrato Bancário', type: 'bank_statement' },
              ].map(d => (
                <div key={d.type} className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
                  <span className="text-[13px] text-gray-400">{d.label}</span>
                  <DocBadge type={d.type} />
                </div>
              ))}
              <button onClick={() => setSelectedItem('Documentos')} className="mt-2 text-[12px] text-red-400 hover:text-red-300 transition-colors">
                Gerir documentos →
              </button>
            </div>
          </Card>
        </div>

        {/* Recent transactions */}
        <Card title="Transações recentes">
          {transactions.length === 0 ? (
            <p className="text-[13px] text-gray-500 py-4 text-center">Sem transações</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-white/8">
                    <th className="text-left py-2 text-gray-500 font-medium">Data</th>
                    <th className="text-left py-2 text-gray-500 font-medium">Tipo</th>
                    <th className="text-left py-2 text-gray-500 font-medium">Estado</th>
                    <th className="text-right py-2 text-gray-500 font-medium">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {[...transactions].sort((a,b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(0, 5).map(tx => (
                    <tr key={tx.id} className="border-b border-white/5 last:border-0">
                      <td className="py-2.5 text-gray-400">{new Date(tx.created_at).toLocaleDateString('pt-PT')}</td>
                      <td className="py-2.5 text-white">{tx.type === 'DEPOSIT' ? 'Depósito' : tx.type === 'WITHDRAWAL' ? 'Levantamento' : tx.type}</td>
                      <td className="py-2.5"><TxStatusPill status={tx.status} /></td>
                      <td className="py-2.5 text-right font-mono text-white">{tx.amount >= 0 ? '+' : ''}€{Math.abs(tx.amount).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <button onClick={() => setSelectedItem('Operações')} className="mt-3 text-[12px] text-red-400 hover:text-red-300 transition-colors">
            Ver todas →
          </button>
        </Card>
      </div>
    );

    // ── A MINHA CONTA ──────────────────────────────────────────────
    if (selectedItem === 'A minha conta') return (
      <div className="space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
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
        </div>

        <Card title="Autenticação de dois fatores (2FA)">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[14px] text-white font-medium">2FA {twoFactorEnabled ? 'ativo' : 'inativo'}</p>
              <p className="text-[12px] text-gray-500 mt-0.5">Protege a tua conta com uma camada extra de segurança</p>
            </div>
            {twoFactorEnabled ? (
              <span className="flex items-center gap-1.5 text-emerald-400 text-[13px] font-semibold">
                <BadgeCheck className="w-4 h-4" /> Ativo
              </span>
            ) : (
              <button onClick={() => setShow2faSetup(true)} className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-[13px] font-semibold transition-colors">
                Ativar 2FA
              </button>
            )}
          </div>
        </Card>
      </div>
    );

    // ── MÉTODOS DE PAGAMENTO ───────────────────────────────────────
    if (selectedItem === 'Métodos de Pagamento') return (
      <div className="space-y-5">
        {/* Tab switcher */}
        <div className="flex gap-2">
          {(['withdrawals', 'security'] as const).map(t => (
            <button
              key={t}
              onClick={() => setActivePaymentTab(t)}
              className={`px-5 py-2 rounded-xl text-[13px] font-semibold transition-colors ${
                activePaymentTab === t ? 'bg-red-600 text-white' : 'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white'
              }`}
            >
              {t === 'withdrawals' ? 'Levantamentos' : 'Segurança'}
            </button>
          ))}
        </div>

        {activePaymentTab === 'withdrawals' && (
          <div className="space-y-4">
            {/* Rules */}
            <Card>
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl bg-blue-500/15 flex items-center justify-center shrink-0">
                  <Banknote className="w-4 h-4 text-blue-400" />
                </div>
                <div>
                  <p className="text-[13px] font-semibold text-white mb-2">Regras de levantamento</p>
                  <ul className="space-y-1 text-[12px] text-gray-400">
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
                    <AlertTriangle className="w-4 h-4 text-amber-400" />
                  </div>
                  <div>
                    <p className="text-[13px] font-semibold text-white mb-1">Verificação necessária</p>
                    <p className="text-[12px] text-gray-400 mb-3">O primeiro levantamento requer verificação de identidade e IBAN.</p>
                    <button onClick={() => setSelectedItem('Documentos')} className="text-[12px] text-red-400 hover:text-red-300">
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
                    <div className="flex items-center justify-between p-4 rounded-xl bg-white/5 border border-white/10">
                      <div>
                        <p className="text-[11px] text-gray-500 uppercase tracking-wide mb-1">Conta de destino</p>
                        <p className="font-mono text-[14px] text-white font-bold">{savedIban}</p>
                        <p className="text-[12px] text-gray-400 mt-0.5">{savedHolder}</p>
                      </div>
                      <div className="w-8 h-8 rounded-full bg-emerald-500/15 flex items-center justify-center">
                        <Check className="w-4 h-4 text-emerald-400" />
                      </div>
                    </div>
                    <Input
                      label="Valor a levantar (€)"
                      type="number"
                      value={withdrawAmount}
                      onChange={(e) => setWithdrawAmount(Number(e.target.value))}
                      min={10}
                    />
                    <button
                      onClick={handleWithdraw}
                      disabled={withdrawLoading}
                      className="w-full py-3 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-bold text-[14px] transition-colors"
                    >
                      {withdrawLoading ? 'A processar...' : 'Confirmar levantamento'}
                    </button>
                  </div>
                ) : (
                  <form onSubmit={handleSaveIban} className="space-y-4">
                    <Input label="IBAN (PT50...)" value={newIban} onChange={e => setNewIban(e.target.value.toUpperCase())} placeholder="PT50 0000 0000 0000 0000 0000 0" />
                    <Input label="Nome do titular" value={holderName} onChange={e => setHolderName(e.target.value)} placeholder="Nome completo" />
                    <button type="submit" disabled={withdrawLoading} className="w-full py-3 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-bold text-[14px] transition-colors">
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
                  <Shield className="w-4 h-4 text-emerald-400" />
                </div>
                <div>
                  <p className="text-[13px] font-semibold text-white mb-1">Pagamentos seguros</p>
                  <p className="text-[12px] text-gray-400">Todas as transações são processadas por entidades autorizadas (PayPal, Revolut).</p>
                </div>
              </div>
            </Card>
            <Card title="Auditoria e logs">
              <div className="space-y-3">
                {[
                  { icon: History, text: 'Data e hora de todas as operações' },
                  { icon: CreditCard, text: 'Método utilizado e identificador' },
                  { icon: Banknote, text: 'Valor exato e estado da transação' },
                ].map(({ icon: Icon, text }) => (
                  <div key={text} className="flex items-center gap-3 text-[13px] text-gray-400">
                    <div className="w-7 h-7 rounded-lg bg-white/5 flex items-center justify-center shrink-0">
                      <Icon className="w-3.5 h-3.5 text-gray-400" />
                    </div>
                    {text}
                  </div>
                ))}
              </div>
            </Card>
          </div>
        )}
      </div>
    );

    // ── OPERAÇÕES ──────────────────────────────────────────────────
    if (selectedItem === 'Operações') return (
      <Card title="Histórico de operações">
        {transactions.length === 0 ? (
          <p className="text-[13px] text-gray-500 py-8 text-center">Sem transações registadas</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-white/8">
                  <th className="text-left py-3 text-gray-500 font-medium">Data</th>
                  <th className="text-left py-3 text-gray-500 font-medium">Tipo</th>
                  <th className="text-left py-3 text-gray-500 font-medium">Estado</th>
                  <th className="text-right py-3 text-gray-500 font-medium">Valor</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map(tx => (
                  <tr key={tx.id} className="border-b border-white/5 last:border-0 hover:bg-white/2 transition-colors">
                    <td className="py-3 text-gray-400">{new Date(tx.created_at).toLocaleString('pt-PT')}</td>
                    <td className="py-3 text-white">{tx.type === 'DEPOSIT' ? 'Depósito' : tx.type === 'WITHDRAWAL' ? 'Levantamento' : tx.type}</td>
                    <td className="py-3"><TxStatusPill status={tx.status} /></td>
                    <td className="py-3 text-right font-mono text-white">{tx.amount >= 0 ? '+' : ''}€{Math.abs(tx.amount).toFixed(2)} <span className="text-gray-500 text-[11px]">{tx.currency}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    );

    // ── DOCUMENTOS ─────────────────────────────────────────────────
    if (selectedItem === 'Documentos') return (
      <div className="space-y-5">
        {/* KYC status banner */}
        <div className={`flex items-center gap-4 p-5 rounded-2xl border ${
          kycStatus === 'verified'
            ? 'bg-emerald-500/8 border-emerald-500/20'
            : 'bg-blue-500/8 border-blue-500/20'
        }`}>
          <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${kycStatus === 'verified' ? 'bg-emerald-500/15' : 'bg-blue-500/15'}`}>
            {kycStatus === 'verified' ? <BadgeCheck className="w-6 h-6 text-emerald-400" /> : <FileText className="w-6 h-6 text-blue-400" />}
          </div>
          <div>
            <p className="text-[14px] font-bold text-white">{kycStatus === 'verified' ? 'Conta verificada' : 'Verificação pendente'}</p>
            <p className="text-[12px] text-gray-400 mt-0.5">
              {kycStatus === 'verified' ? 'Levantamentos disponíveis.' : 'A verificação pode demorar até 24 horas.'}
            </p>
          </div>
        </div>

        {/* Document cards */}
        {[
          { type: 'id_card', title: 'Documento de identificação', desc: 'Cartão de Cidadão ou Passaporte válido e legível.' },
          { type: 'iban_proof', title: 'Comprovativo de IBAN', desc: 'Documento oficial do banco com o seu nome e IBAN. ✕ Multibanco não é aceite.' },
          { type: 'bank_statement', title: 'Extrato bancário', desc: 'Documento recente (máx. 3 meses) com nome e IBAN. O saldo pode ser ocultado.' },
        ].map(d => (
          <Card key={d.type}>
            <div className="flex items-start justify-between mb-4">
              <div>
                <p className="text-[14px] font-semibold text-white">{d.title}</p>
                <p className="text-[12px] text-gray-500 mt-0.5">{d.desc}</p>
              </div>
              <DocBadge type={d.type} />
            </div>
            <label className="flex items-center gap-3 cursor-pointer group">
              <div className="flex-1 rounded-xl border border-dashed border-white/15 bg-white/3 group-hover:bg-white/5 group-hover:border-white/25 transition-all px-4 py-3">
                <p className="text-[12px] text-gray-400">Clique para selecionar ficheiro <span className="text-gray-600">· JPG, PNG, PDF (máx. 5 MB)</span></p>
              </div>
              <input
                type="file"
                accept=".jpg,.jpeg,.png,.pdf"
                className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) uploadSingleDoc(d.type as any, f); }}
              />
            </label>
          </Card>
        ))}
      </div>
    );

    // ── OPÇÕES ────────────────────────────────────────────────────
    if (selectedItem === 'Opções') return (
      <Card title="Aparência">
        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[14px] text-white font-medium">Tema automático</p>
              <p className="text-[12px] text-gray-500 mt-0.5">Segue o tema do sistema operativo</p>
            </div>
            <Toggle checked={autoTheme} onChange={setAutoTheme} />
          </div>
          <div className={`flex items-center justify-between ${autoTheme ? 'opacity-40 pointer-events-none' : ''}`}>
            <div>
              <p className="text-[14px] text-white font-medium">Modo escuro</p>
              <p className="text-[12px] text-gray-500 mt-0.5">Ativar interface em modo noturno</p>
            </div>
            <Toggle checked={darkMode} onChange={() => toggleDarkMode()} />
          </div>
        </div>
      </Card>
    );

    // ── JOGOS RESPONSÁVEIS ─────────────────────────────────────────
    if (selectedItem === 'Jogos responsáveis') return (
      <Card title="Jogo responsável">
        <div className="space-y-4">
          {[
            { icon: Lock, title: 'Limites de depósito e aposta', desc: 'Define valores máximos para controlar os teus gastos.', action: () => setSelectedItem('Definir os meus limites') },
            { icon: Eye, title: 'Autoexclusão', desc: 'Pausa a tua conta por um período definido.', action: () => setSelectedItem('Autoexclusão') },
            { icon: Shield, title: '2FA', desc: 'Protege o acesso à conta.', action: () => setSelectedItem('A minha conta') },
          ].map(({ icon: Icon, title, desc, action }) => (
            <button key={title} onClick={action} className="w-full flex items-center gap-4 p-4 rounded-2xl border border-white/8 bg-white/3 hover:bg-white/6 transition-colors text-left">
              <div className="w-10 h-10 rounded-xl bg-red-600/15 flex items-center justify-center shrink-0">
                <Icon className="w-5 h-5 text-red-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-semibold text-white">{title}</p>
                <p className="text-[12px] text-gray-500">{desc}</p>
              </div>
              <ChevronRight className="w-4 h-4 text-gray-600 shrink-0" />
            </button>
          ))}
        </div>
      </Card>
    );

    // ── DEFINIR LIMITES ────────────────────────────────────────────
    if (selectedItem === 'Definir os meus limites') return (
      <div className="space-y-5">
        {selfExclude && (
          <div className="flex items-start gap-3 p-4 rounded-2xl bg-red-500/10 border border-red-500/20">
            <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <p className="text-[13px] text-red-400">Não é possível alterar limites durante o período de autoexclusão.</p>
          </div>
        )}
        <Card title="Limites financeiros">
          <div className={`space-y-4 ${selfExclude ? 'opacity-40 pointer-events-none' : ''}`}>
            <Input
              label="Limite de depósito (€)"
              type="number"
              min="0"
              value={limitDeposit}
              onChange={e => setLimitDeposit(Number(e.target.value))}
              disabled={selfExclude}
            />
            <Input
              label="Limite de aposta (€)"
              type="number"
              min="0"
              value={limitBet}
              onChange={e => setLimitBet(Number(e.target.value))}
              disabled={selfExclude}
            />
            <button onClick={saveLimits} disabled={selfExclude} className="w-full py-3 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-bold text-[14px] transition-colors">
              Guardar limites
            </button>
          </div>
        </Card>
      </div>
    );

    // ── AUTOEXCLUSÃO ───────────────────────────────────────────────
    if (selectedItem === 'Autoexclusão') return (
      <div className="space-y-5">
        <Card title="Estado da autoexclusão">
          {selfExclude ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-4 rounded-2xl bg-red-500/10 border border-red-500/20">
                <div className="w-10 h-10 rounded-xl bg-red-500/15 flex items-center justify-center shrink-0">
                  <ShieldAlert className="w-5 h-5 text-red-400" />
                </div>
                <div>
                  <p className="text-[14px] font-bold text-red-400">Autoexclusão ativa</p>
                  <p className="text-[12px] text-gray-400 mt-0.5">
                    {selfExcludeUntil ? `Até ${new Date(selfExcludeUntil).toLocaleString('pt-PT')}` : 'Permanente'}
                  </p>
                </div>
              </div>
              <button onClick={() => setSelfExclude(false, null)} className="w-full py-3 rounded-xl bg-white/8 hover:bg-white/12 text-white text-[13px] font-semibold transition-colors">
                Desativar autoexclusão
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-[13px] text-gray-400">Suspende temporariamente o acesso à tua conta. Não poderás depositar, apostar ou alterar limites durante este período.</p>
              <div>
                <label className="block text-[12px] font-medium text-gray-400 mb-1.5">Duração</label>
                <select
                  value={excludeDuration}
                  onChange={e => setExcludeDuration(e.target.value as any)}
                  className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-2.5 text-[14px] text-white focus:outline-none focus:border-red-500/50 transition"
                >
                  <option value="24h">24 horas</option>
                  <option value="7d">7 dias</option>
                  <option value="30d">30 dias</option>
                  <option value="6m">6 meses</option>
                  <option value="indef">Permanente</option>
                </select>
              </div>
              <button onClick={() => setExcludeConfirmOpen(true)} className="w-full py-3 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold text-[14px] transition-colors">
                Ativar autoexclusão
              </button>
            </div>
          )}
        </Card>

        {history.length > 0 && (
          <Card title="Histórico">
            <div className="space-y-2">
              {history.map((h, i) => (
                <div key={i} className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
                  <span className="text-[13px] text-gray-400">{h.action === 'activate' ? 'Ativada' : 'Desativada'}</span>
                  <span className="text-[12px] text-gray-500">{new Date(h.created_at).toLocaleString('pt-PT')}</span>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>
    );

    // ── SUPORTE ────────────────────────────────────────────────────
    if (selectedItem === 'Preciso de ajuda') return (
      <div className="space-y-5">
        <div className="flex items-center gap-4 p-5 rounded-2xl border border-white/8 bg-[#151e2d]">
          <div className="w-10 h-10 rounded-xl bg-red-600/15 flex items-center justify-center shrink-0">
            <HelpCircle className="w-5 h-5 text-red-400" />
          </div>
          <div>
            <p className="text-[14px] font-semibold text-white">Atendimento ao cliente</p>
            <a href="mailto:atendimentoaoclientebet62@gmail.com" className="text-[12px] text-red-400 hover:text-red-300 transition-colors">
              atendimentoaoclientebet62@gmail.com
            </a>
          </div>
        </div>
        <Card title="Chat de suporte">
          <div className="h-64 overflow-y-auto rounded-xl bg-black/20 p-3 mb-3 space-y-2">
            {supportMessages.length === 0 ? (
              <p className="text-[13px] text-gray-500 text-center py-8">Sem mensagens. Escreve-nos abaixo.</p>
            ) : supportMessages.map((m, idx) => (
              <div key={idx} className={`flex ${m.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[75%] px-3 py-2 rounded-2xl text-[13px] ${m.sender === 'user' ? 'bg-red-600 text-white' : 'bg-white/8 text-white'}`}>
                  <p>{m.content}</p>
                  <p className="text-[10px] mt-1 opacity-60">{new Date(m.created_at).toLocaleTimeString('pt-PT')}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={supportText}
              onChange={e => setSupportText(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && sendSupportMessage()}
              placeholder="Escreve a tua mensagem..."
              className="flex-1 rounded-xl bg-white/5 border border-white/10 px-4 py-2.5 text-[14px] text-white placeholder:text-gray-600 focus:outline-none focus:border-red-500/50 transition"
            />
            <button
              onClick={sendSupportMessage}
              disabled={supportLoading || !supportText.trim()}
              className="px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-semibold text-[13px] transition-colors"
            >
              Enviar
            </button>
          </div>
        </Card>
      </div>
    );

    // ── TERMOS E CONDIÇÕES ─────────────────────────────────────────
    if (selectedItem === 'Termos e condições gerais') return (
      <Card title="Termos e condições gerais">
        <div className="space-y-6 text-[13px]">
          {[
            { n: '1', title: 'Regras de utilização', items: ['A plataforma é destinada exclusivamente a utilizadores maiores de 18 anos.', 'Cada conta é pessoal, individual e intransmissível.', 'É proibida a utilização de bots, scripts, automações ou qualquer forma de manipulação.', 'As odds podem ser ajustadas; quando necessário, será solicitada confirmação do utilizador.', 'Reservamo-nos o direito de suspender ou encerrar contas em caso de conduta indevida.'] },
            { n: '2', title: 'Jogo responsável', items: ['Disponibilizamos ferramentas de limites, notificações e autoexclusão.', 'A autoexclusão impede depósitos, apostas e criação de novos boletins.', 'O cashout poderá permanecer disponível apenas em apostas elegíveis.'] },
            { n: '3', title: 'Depósitos e levantamentos', items: ['Depósito mínimo: €10 | Máximo por operação: €20.000.', 'O levantamento mínimo é de €10.', 'Todos os levantamentos requerem IBAN válido e verificação da identidade.', 'Prazo de processamento pode ser de até 24 horas.'] },
            { n: '4', title: 'Bónus e promoções', items: ['As promoções podem estar sujeitas a condições específicas, prazos e requisitos.', 'Reservamo-nos o direito de alterar ou cancelar promoções a qualquer momento.'] },
            { n: '5', title: 'Suporte e reclamações', items: ['Contacto: atendimentoaoclientebet62@gmail.com', 'Todas as reclamações serão analisadas caso a caso, com resposta por e-mail.'] },
          ].map(sec => (
            <div key={sec.n}>
              <p className="font-semibold text-white mb-2">{sec.n}. {sec.title}</p>
              <ul className="space-y-1.5 text-gray-400 pl-4">
                {sec.items.map((item, i) => <li key={i} className="before:content-['•'] before:mr-2 before:text-gray-600">{item}</li>)}
              </ul>
            </div>
          ))}
          <p className="text-[11px] text-gray-600 pt-2 border-t border-white/5">Última atualização: 05-01-2026 · Aceite em: {profile?.terms_accepted_at ? new Date(profile.terms_accepted_at).toLocaleDateString('pt-PT') : 'não validado'}</p>
        </div>
      </Card>
    );

    // ── POLÍTICA DE PRIVACIDADE ────────────────────────────────────
    if (selectedItem === 'Políticas e privacidade') return (
      <Card title="Política de privacidade">
        <div className="space-y-6 text-[13px]">
          {[
            { title: 'Introdução', text: 'A presente Política de Privacidade descreve como os dados pessoais dos utilizadores são recolhidos, utilizados e protegidos. O tratamento é efetuado em conformidade com o RGPD (UE 2016/679).' },
            { title: 'Dados recolhidos', text: 'Nome e apelido, e-mail, telemóvel, IBAN, documentos de identificação (KYC), endereço IP e histórico de atividade.' },
            { title: 'Finalidade', text: 'Gestão de conta, processamento de transações, verificação de identidade, cumprimento legal e comunicação.' },
            { title: 'Partilha de dados', text: 'Dados partilhados apenas com prestadores de pagamento e entidades legais quando exigido. Nunca vendemos dados pessoais.' },
            { title: 'Direitos do utilizador', text: 'Acesso, correção, eliminação, limitação, oposição ao tratamento e portabilidade dos dados nos termos do RGPD.' },
            { title: 'Contacto', text: 'Para questões de privacidade: atendimentoaoclientebet62@gmail.com' },
          ].map(sec => (
            <div key={sec.title}>
              <p className="font-semibold text-white mb-1.5">{sec.title}</p>
              <p className="text-gray-400 leading-relaxed">{sec.text}</p>
            </div>
          ))}
          <p className="text-[11px] text-gray-600 pt-2 border-t border-white/5">Última atualização: 05-01-2026</p>
        </div>
      </Card>
    );

    // ── COOKIES info ───────────────────────────────────────────────
    if (selectedItem === 'Cookies') return (
      <Card title="Política de cookies">
        <p className="text-[13px] text-gray-400 leading-relaxed">
          Esta plataforma utiliza cookies para garantir o funcionamento, guardar preferências e melhorar a experiência do utilizador.
          Os cookies essenciais não podem ser desativados. Os restantes podem ser geridos em <button onClick={() => setSelectedItem('Definições de cookies')} className="text-red-400 hover:text-red-300 underline-offset-2 underline">Definições de cookies</button>.
        </p>
      </Card>
    );

    // ── DEFINIÇÕES DE COOKIES ──────────────────────────────────────
    if (selectedItem === 'Definições de cookies') return (
      <Card title="Definições de cookies">
        <div className="space-y-4">
          {[
            { key: 'essential', label: 'Essenciais', desc: 'Autenticação, segurança e operações básicas. Obrigatórios.', fixed: true },
            { key: 'functional', label: 'Funcionais', desc: 'Guardam preferências do utilizador.', value: cookieFunctional, onChange: setCookieFunctional },
            { key: 'analytics', label: 'Analíticos', desc: 'Ajudam a melhorar o desempenho da plataforma.', value: cookieAnalytics, onChange: setCookieAnalytics },
            { key: 'marketing', label: 'Marketing', desc: 'Publicidade relevante e personalizada.', value: cookieMarketing, onChange: setCookieMarketing },
          ].map(c => (
            <div key={c.key} className="flex items-center justify-between py-3.5 border-b border-white/5 last:border-0">
              <div>
                <p className="text-[13px] font-semibold text-white">{c.label}</p>
                <p className="text-[12px] text-gray-500 mt-0.5">{c.desc}</p>
              </div>
              {(c as any).fixed ? (
                <span className="text-[11px] px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-400 font-semibold">Sempre ativo</span>
              ) : (
                <Toggle checked={(c as any).value} onChange={(c as any).onChange} />
              )}
            </div>
          ))}
          <button onClick={saveCookies} className="mt-2 w-full py-3 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold text-[14px] transition-colors">
            Guardar preferências
          </button>
        </div>
      </Card>
    );

    return null;
  };

  // ── RENDER ─────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#0e1621]">

      {/* Self-exclusion banner */}
      {selfExclude && (
        <div className="bg-red-600/90 backdrop-blur-sm border-b border-red-500/30 px-4 py-3">
          <div className="max-w-7xl mx-auto flex items-center gap-3">
            <AlertTriangle className="w-4 h-4 text-white shrink-0" />
            <p className="text-[13px] text-white font-medium">
              Conta em autoexclusão {selfExcludeUntil ? `até ${new Date(selfExcludeUntil).toLocaleString('pt-PT')}` : '(permanente)'}. Depósitos e apostas indisponíveis.
            </p>
          </div>
        </div>
      )}

      {/* Profile header */}
      <div className="relative overflow-hidden bg-gradient-to-br from-[#1a0a0a] via-[#1c1020] to-[#0e1621] border-b border-white/5">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(220,38,38,0.12),transparent_60%)]" />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 py-8">
          <div className="flex flex-col sm:flex-row sm:items-center gap-5">
            {/* Avatar */}
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-red-600 to-red-800 flex items-center justify-center text-white text-xl font-bold shadow-lg shadow-red-900/40 shrink-0">
              {initials}
            </div>
            {/* Info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-[22px] font-bold text-white">{firstName}</h1>
                {kycStatus === 'verified' && (
                  <span className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 font-semibold">
                    <BadgeCheck className="w-3 h-3" /> Verificado
                  </span>
                )}
                {selfExclude && (
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-red-500/15 text-red-400 border border-red-500/20 font-semibold">Autoexcluído</span>
                )}
              </div>
              <p className="text-[13px] text-gray-500 mt-0.5">{profile?.email || (user as any)?.email || ''}</p>
              {profile?.created_at && (
                <p className="text-[12px] text-gray-600 mt-0.5">Membro desde {new Date(profile.created_at).toLocaleDateString('pt-PT', { year: 'numeric', month: 'long' })}</p>
              )}
            </div>
            {/* Balance */}
            <div className="sm:text-right">
              <p className="text-[11px] text-gray-500 uppercase tracking-wider mb-0.5">Saldo disponível</p>
              <p className="text-[28px] font-bold text-white">€{balance.toFixed(2)}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Main layout */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        <div className="flex flex-col lg:flex-row gap-6">

          {/* ── Sidebar ── */}
          <aside className="lg:w-[240px] shrink-0">
            {/* Mobile select */}
            <div className="lg:hidden mb-4">
              <select
                value={selectedItem || ''}
                onChange={e => setSelectedItem(e.target.value)}
                className="w-full rounded-xl bg-[#151e2d] border border-white/10 px-4 py-2.5 text-[14px] text-white focus:outline-none focus:border-red-500/50 appearance-none"
              >
                {ALL_ITEMS.map(item => <option key={item} value={item}>{item}</option>)}
              </select>
            </div>

            {/* Desktop grouped nav */}
            <div className="hidden lg:block sticky top-4 space-y-1">
              {NAV_GROUPS.map(group => (
                <div key={group.label} className="mb-1">
                  <p className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-gray-600">{group.label}</p>
                  {group.items.map(item => <NavItem key={item} item={item} />)}
                </div>
              ))}

              <div className="pt-3 mt-2 border-t border-white/8">
                <button
                  onClick={signOut}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] text-gray-500 hover:bg-red-600/10 hover:text-red-400 transition-all"
                >
                  <LogOut className="w-3.5 h-3.5 shrink-0" />
                  Terminar sessão
                </button>
              </div>
            </div>
          </aside>

          {/* ── Content ── */}
          <main className="flex-1 min-w-0">
            {renderContent()}

            {/* Mobile logout */}
            <div className="lg:hidden mt-6">
              <button onClick={signOut} className="w-full py-3 rounded-xl bg-red-600/10 border border-red-500/20 text-red-400 font-semibold text-[14px] hover:bg-red-600/20 transition-colors">
                Terminar sessão
              </button>
            </div>
          </main>
        </div>
      </div>

      {/* ── Confirm self-exclusion modal ── */}
      {excludeConfirmOpen && createPortal(
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setExcludeConfirmOpen(false)} />
          <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[92vw] max-w-[420px] bg-[#151e2d] border border-white/10 rounded-2xl p-6 shadow-2xl">
            <div className="w-12 h-12 rounded-2xl bg-red-600/15 flex items-center justify-center mx-auto mb-4">
              <ShieldAlert className="w-6 h-6 text-red-400" />
            </div>
            <h3 className="text-[17px] font-bold text-white text-center mb-2">Confirmar autoexclusão</h3>
            <p className="text-[13px] text-gray-400 text-center mb-4">
              Duração: <span className="text-white font-semibold">{excludeDuration === 'indef' ? 'Permanente' : excludeDuration === '24h' ? '24 horas' : excludeDuration === '7d' ? '7 dias' : excludeDuration === '30d' ? '30 dias' : '6 meses'}</span>.
              Não poderás depositar, apostar ou alterar limites.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setExcludeConfirmOpen(false)} className="flex-1 py-2.5 rounded-xl bg-white/8 text-white text-[13px] font-semibold hover:bg-white/12 transition-colors">
                Cancelar
              </button>
              <button
                onClick={() => {
                  const now = Date.now();
                  let untilTs: string | null = null;
                  if (excludeDuration === '24h') untilTs = new Date(now + 24*3600000).toISOString();
                  else if (excludeDuration === '7d') untilTs = new Date(now + 7*86400000).toISOString();
                  else if (excludeDuration === '30d') untilTs = new Date(now + 30*86400000).toISOString();
                  else if (excludeDuration === '6m') untilTs = new Date(now + 180*86400000).toISOString();
                  setSelfExclude(true, untilTs);
                  setExcludeConfirmOpen(false);
                }}
                className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-[13px] font-bold transition-colors"
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ── 2FA setup portal ── */}
      {show2faSetup && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <TwoFactor
            mode="setup"
            onSuccess={() => { setShow2faSetup(false); setTwoFactorEnabled(true); addNotification({ type: 'success', message: '2FA ativado com sucesso' }); }}
            onCancel={() => setShow2faSetup(false)}
          />
        </div>,
        document.body
      )}
    </div>
  );
};

export default ProfilePage;
