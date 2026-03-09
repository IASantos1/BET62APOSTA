import { useEffect, useState, useRef } from 'react'
import { useApp } from '@/react-app/contexts/AppContext'
import { Chart, LineController, LineElement, PointElement, LinearScale, Title, CategoryScale, Tooltip, Legend } from 'chart.js'
import { apiFetch } from '@/react-app/utils/api'
Chart.register(LineController, LineElement, PointElement, LinearScale, Title, CategoryScale, Tooltip, Legend)

type UsersMetrics = { users: number; bets: number }
type OddsMetrics = { events: number; imported_odds: number }
type ApiUsageItem = { provider: string; endpoint: string; count: number }
type ApiUsage = { date: string; total: number; details: ApiUsageItem[] }

export default function MetricsPage() {
  const { darkMode, isOperator, addNotification } = useApp()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [users, setUsers] = useState<UsersMetrics | null>(null)
  const [odds, setOdds] = useState<OddsMetrics | null>(null)
  const [apiUsage, setApiUsage] = useState<ApiUsage | null>(null)
  const [selectedProvider, setSelectedProvider] = useState<string>('all')
  const [ts, setTs] = useState<number>(0)
  const [histLabels, setHistLabels] = useState<string[]>([])
  const [histUsers, setHistUsers] = useState<number[]>([])
  const [histBets, setHistBets] = useState<number[]>([])
  const [histEvents, setHistEvents] = useState<number[]>([])
  const [histImported, setHistImported] = useState<number[]>([])
  const usersChartRef = useRef<any>(null)
  const oddsChartRef = useRef<any>(null)
  const usersCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const oddsCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const loadInflightRef = useRef<boolean>(false)
  const loadAbortRef = useRef<AbortController | null>(null)

  const load = async () => {
    if (loadInflightRef.current) { return }
    loadInflightRef.current = true
    setLoading(true)
    setError(null)
    try {
      try { if (loadAbortRef.current) loadAbortRef.current.abort() } catch { void 0 }
      const ctrl = new AbortController()
      loadAbortRef.current = ctrl
      const opts: RequestInit = { credentials: 'same-origin', cache: 'no-store', signal: ctrl.signal }
      const [ju, jo, ja] = await Promise.all([
        apiFetch<UsersMetrics>('/api/metrics/users', opts),
        apiFetch<OddsMetrics>('/api/metrics/odds', opts),
        apiFetch<ApiUsage>('/api/metrics/api-usage', opts)
      ])
      
      setUsers({ users: Number((ju as any)?.users || 0), bets: Number((ju as any)?.bets || 0) })
      setOdds({ events: Number((jo as any)?.events || 0), imported_odds: Number((jo as any)?.imported_odds || 0) })
      setApiUsage(ja as ApiUsage)
      setTs(Date.now())
      const label = new Date().toLocaleTimeString('pt-PT')
      setHistLabels((prev) => [...prev.slice(-59), label])
      setHistUsers((prev) => [...prev.slice(-59), Number((ju as any)?.users || 0)])
      setHistBets((prev) => [...prev.slice(-59), Number((ju as any)?.bets || 0)])
      setHistEvents((prev) => [...prev.slice(-59), Number((jo as any)?.events || 0)])
      setHistImported((prev) => [...prev.slice(-59), Number((jo as any)?.imported_odds || 0)])
    } catch (e: any) {
      const msg = String(e?.message || '')
      if (/Abort|ERR_ABORTED|ERR_CANCELED/i.test(msg)) {
        /* no-op on aborted */
      } else if (e.status === 401) { 
        setError('Sessão expirada'); setUsers(null); setOdds(null); 
      } else if (e.status === 403) {
        setError('Sem permissão (operador requerido)'); setUsers(null); setOdds(null);
      } else {
        setError(msg || 'Erro')
      }
    } finally { setLoading(false); loadInflightRef.current = false }
  }

  useEffect(() => {
    load()
    const iv = setInterval(() => { load() }, 5000)
    return () => { clearInterval(iv) }
  }, [])

  const fmt = (n: number) => new Intl.NumberFormat('pt-PT').format(Number(n || 0))

  const runCron = async () => {
    setLoading(true)
    try {
      const j = await apiFetch<any>('/api/cron/run', { method: 'POST', cache: 'no-store' });
      const msg = `Cron OK · eventos ${Number(j?.events||0)} · odds ${Number(j?.imported_odds||0)} · apostas ${Number(j?.bets||0)}`
      addNotification({ type: 'success', message: msg })
      await load()
    } catch (e: any) {
      addNotification({ type: 'error', message: String(e?.message || 'Erro ao executar cron') })
    } finally { setLoading(false) }
  }

  const providerLabel = (p: string) => {
    return p
  }

  const providerOptions = Array.from(new Set((apiUsage?.details || []).map((d) => d.provider)))
  const filteredDetails = (apiUsage?.details || []).filter((d) => selectedProvider === 'all' ? true : d.provider === selectedProvider)

  useEffect(() => {
    const canvas = usersCanvasRef.current
    const ctx = canvas ? canvas.getContext('2d') : null
    if (!ctx) return
    if (!usersChartRef.current) {
      usersChartRef.current = new Chart(ctx, {
        type: 'line',
        data: {
          labels: histLabels,
          datasets: [
            { label: 'Utilizadores', data: histUsers, borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,0.2)', tension: 0.3 },
            { label: 'Apostas', data: histBets, borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.2)', tension: 0.3 }
          ]
        },
        options: {
          responsive: false,
          maintainAspectRatio: false,
          plugins: { legend: { display: true } },
          scales: { y: { beginAtZero: true } }
        }
      })
    } else {
      const chart = usersChartRef.current
      chart.data.labels = histLabels
      chart.data.datasets[0].data = histUsers
      chart.data.datasets[1].data = histBets
      chart.update()
    }
  }, [histLabels, histUsers, histBets])

  useEffect(() => {
    const canvas = oddsCanvasRef.current
    const ctx = canvas ? canvas.getContext('2d') : null
    if (!ctx) return
    if (!oddsChartRef.current) {
      oddsChartRef.current = new Chart(ctx, {
        type: 'line',
        data: {
          labels: histLabels,
          datasets: [
            { label: 'Eventos', data: histEvents, borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,0.2)', tension: 0.3 },
            { label: 'Odds importadas', data: histImported, borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.2)', tension: 0.3 }
          ]
        },
        options: {
          responsive: false,
          maintainAspectRatio: false,
          plugins: { legend: { display: true } },
          scales: { y: { beginAtZero: true } }
        }
      })
    } else {
      const chart = oddsChartRef.current
      chart.data.labels = histLabels
      chart.data.datasets[0].data = histEvents
      chart.data.datasets[1].data = histImported
      chart.update()
    }
  }, [histLabels, histEvents, histImported])

  useEffect(() => {
    return () => {
      try {
        const chart = usersChartRef.current
        if (chart && typeof chart.destroy === 'function') chart.destroy()
        usersChartRef.current = null
      } catch { void 0 }
      try {
        const chart = oddsChartRef.current
        if (chart && typeof chart.destroy === 'function') chart.destroy()
        oddsChartRef.current = null
      } catch { void 0 }
      try { if (loadAbortRef.current) { loadAbortRef.current.abort(); loadAbortRef.current = null } } catch { void 0 }
    }
  }, [])

  return (
    <div className="max-w-5xl mx-auto px-4 py-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className={`text-2xl font-bold ${darkMode ? 'text-white' : 'text-gray-900'}`}>Métricas</h2>
        <div className="flex gap-2">
          <button onClick={() => load()} className={`px-3 py-2 rounded-md text-sm font-semibold ${darkMode ? 'bg-gray-800 text-white' : 'bg-gray-200 text-gray-900'}`}>Atualizar</button>
          <button onClick={() => runCron()} className={`px-3 py-2 rounded-md text-sm font-semibold ${darkMode ? 'bg-red-700 text-white' : 'bg-red-600 text-white'}`}>Executar cron</button>
        </div>
      </div>
      {!isOperator && (
        <div className={`mb-3 p-3 rounded ${darkMode ? 'bg-yellow-900 text-yellow-100' : 'bg-yellow-100 text-yellow-800'}`}>
          Precisa ser operador para ver métricas.
        </div>
      )}
      {error && (
        <div className={`mb-3 p-3 rounded ${darkMode ? 'bg-red-900 text-red-100' : 'bg-red-100 text-red-800'}`}>{error}</div>
      )}
      <div className={`grid grid-cols-1 md:grid-cols-2 gap-4`}>
        <div className={`p-4 rounded ${darkMode ? 'bg-gray-800 text-white border border-gray-700' : 'bg-white text-gray-900 border border-gray-200'}`}>
          <div className="text-sm">Utilizadores</div>
          <div className="text-3xl font-bold">{fmt(Number((users as any)?.users || 0))}</div>
        </div>
        <div className={`p-4 rounded ${darkMode ? 'bg-gray-800 text-white border border-gray-700' : 'bg-white text-gray-900 border border-gray-200'}`}>
          <div className="text-sm">Apostas</div>
          <div className="text-3xl font-bold">{fmt(Number((users as any)?.bets || 0))}</div>
        </div>
        <div className={`p-4 rounded ${darkMode ? 'bg-gray-800 text-white border border-gray-700' : 'bg-white text-gray-900 border border-gray-200'}`}>
          <div className="text-sm">Eventos</div>
          <div className="text-3xl font-bold">{fmt(Number((odds as any)?.events || 0))}</div>
        </div>
        <div className={`p-4 rounded ${darkMode ? 'bg-gray-800 text-white border border-gray-700' : 'bg-white text-gray-900 border border-gray-200'}`}>
          <div className="text-sm">Odds importadas</div>
          <div className="text-3xl font-bold">{fmt(Number((odds as any)?.imported_odds || 0))}</div>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
        <div className={`p-4 rounded ${darkMode ? 'bg-gray-800 text-white border border-gray-700' : 'bg-white text-gray-900 border border-gray-200'}`}>
          <div className="text-sm mb-2">Histórico: Utilizadores e Apostas</div>
          <canvas id="usersChart" ref={usersCanvasRef} height={160} />
        </div>
        <div className={`p-4 rounded ${darkMode ? 'bg-gray-800 text-white border border-gray-700' : 'bg-white text-gray-900 border border-gray-200'}`}>
          <div className="text-sm mb-2">Histórico: Eventos e Odds importadas</div>
          <canvas id="oddsChart" ref={oddsCanvasRef} height={160} />
        </div>
      </div>

      <div className={`mt-6 p-4 rounded ${darkMode ? 'bg-gray-800 text-white border border-gray-700' : 'bg-white text-gray-900 border border-gray-200'}`}>
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-3">
          <div>
            <div className="text-lg font-bold">Consumo de APIs (Hoje: {apiUsage?.date})</div>
            <div className="text-sm">Total de chamadas: <span className="font-bold text-xl">{fmt(apiUsage?.total || 0)}</span></div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs uppercase tracking-wide">Provider</span>
            <select
              value={selectedProvider}
              onChange={(e) => setSelectedProvider(e.target.value)}
              className={`px-2 py-1 rounded border text-sm ${darkMode ? 'bg-gray-900 border-gray-600 text-gray-100' : 'bg-white border-gray-300 text-gray-900'}`}
            >
              <option value="all">Todos</option>
              {providerOptions.map((p) => (
                <option key={p} value={p}>{providerLabel(p)}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className={`text-xs uppercase ${darkMode ? 'bg-gray-700 text-gray-400' : 'bg-gray-100 text-gray-700'}`}>
              <tr>
                <th className="px-4 py-2">Provider</th>
                <th className="px-4 py-2">Endpoint</th>
                <th className="px-4 py-2 text-right">Chamadas</th>
              </tr>
            </thead>
            <tbody>
              {filteredDetails.map((item, idx) => (
                <tr key={idx} className={`border-b ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}>
                  <td className="px-4 py-2 font-medium">{providerLabel(item.provider)}</td>
                  <td className="px-4 py-2">{item.endpoint}</td>
                  <td className="px-4 py-2 text-right">{fmt(item.count)}</td>
                </tr>
              ))}
              {(!apiUsage?.details || apiUsage.details.length === 0) && (
                <tr>
                  <td colSpan={3} className="px-4 py-2 text-center text-gray-500">Sem dados de consumo hoje.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className={`mt-4 text-xs ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>{ts ? `Última atualização: ${new Date(ts).toLocaleTimeString('pt-PT')}` : ''} {loading ? '(a atualizar...)' : ''}</div>
    </div>
  )
}
