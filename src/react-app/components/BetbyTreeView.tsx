import { useMemo, useState } from "react";
import {
  BetbyEvent,
  BetbyKind,
  BetbyTournamentBranch,
  formatKickoff,
  sportLabel,
  teamNames,
} from "../services/betby.client";
import { useBetbyMeta, useBetbyTree } from "../hooks/useBetby";
import { useNavigate } from "react-router-dom";
import {
  ChevronDown,
  ChevronRight,
  Trophy,
  Flame,
  CircleDot,
  Target,
  Dices,
  Clock,
  RefreshCw,
  AlertTriangle,
  Loader2,
} from "lucide-react";

interface BetbyTreeViewProps {
  kind: BetbyKind;
  treeId?: string | number;
}

export function BetbyTreeView({ kind, treeId }: BetbyTreeViewProps) {
  const tree = useBetbyTree(kind, treeId);
  const meta = useBetbyMeta(kind);
  const [openSport, setOpenSport] = useState<number | null>(null);
  const [openCategory, setOpenCategory] = useState<string | null>(null);
  const navigate = useNavigate();

  const loading = tree.isLoading || meta.isFetching;
  const error = tree.error || meta.error;

  const isLive = kind === "live";

  const epochText = useMemo(() => {
    const t = tree.data?.generated || meta.data?.generated;
    if (!t) return null;
    const d = new Date(t);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
  }, [tree.data, meta.data]);

  return (
    <div className="w-full max-w-[1400px] mx-auto px-3 sm:px-6 py-6">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3 mb-5">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-2xl sm:text-3xl font-black tracking-tight">
              {isLive ? (
                <span className="inline-flex items-center gap-2">
                  <span className="relative flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
                  </span>
                  <span className="bg-gradient-to-r from-red-500 via-orange-500 to-yellow-500 bg-clip-text text-transparent">
                    Ao Vivo
                  </span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-2">
                  <Clock className="w-6 h-6 text-sky-500" />
                  <span className="bg-gradient-to-r from-sky-500 via-indigo-500 to-purple-500 bg-clip-text text-transparent">
                    Pré-Jogo
                  </span>
                </span>
              )}
            </h2>
            {loading && <Loader2 className="w-5 h-5 text-sky-500 animate-spin" />}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs sm:text-sm text-gray-500 dark:text-gray-400">
            <span className="inline-flex items-center gap-1">
              <Target className="w-4 h-4" />
              {tree.totalSports ?? 0} esportes
            </span>
            <span className="inline-flex items-center gap-1">
              <Trophy className="w-4 h-4" />
              {tree.totalTournaments ?? 0} ligas
            </span>
            <span className="inline-flex items-center gap-1">
              <Dices className="w-4 h-4" />
              {tree.totalEvents ?? 0} eventos
            </span>
            {epochText && (
              <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
                <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
                Atualizado às {epochText}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              tree.refetch();
              meta.refetch();
            }}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg bg-sky-600 hover:bg-sky-700 active:bg-sky-800 disabled:opacity-60 disabled:cursor-not-allowed text-white px-4 py-2 text-sm font-semibold shadow-md transition"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            Atualizar
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-5 rounded-xl border border-red-300 dark:border-red-900 bg-red-50 dark:bg-red-950/30 text-red-800 dark:text-red-300 p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold">Erro ao carregar BetBY v4 {kind}</div>
            <div className="text-sm opacity-90 mt-1">{(error as Error).message}</div>
            <div className="text-xs opacity-80 mt-2">
              Verifique se o <code className="px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-900/60">jwt-service</code> está rodando em :8787.
              Roda <code className="px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-900/60">node betby-demo/jwt-service.mjs</code>.
            </div>
          </div>
        </div>
      )}

      {tree.isLoading && !tree.data && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 animate-pulse"
            >
              <div className="h-5 w-2/3 bg-gray-200 dark:bg-gray-800 rounded mb-3" />
              <div className="space-y-2">
                <div className="h-4 w-full bg-gray-100 dark:bg-gray-800 rounded" />
                <div className="h-4 w-5/6 bg-gray-100 dark:bg-gray-800 rounded" />
                <div className="h-4 w-3/4 bg-gray-100 dark:bg-gray-800 rounded" />
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-4">
        {tree.branches.map((branch) => {
          const sId = branch.sport.id;
          const isSportOpen = openSport === null || openSport === sId;
          return (
            <section
              key={sId}
              className="rounded-2xl overflow-hidden border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm"
            >
              <button
                onClick={() => setOpenSport(isSportOpen && openSport !== null ? null : sId)}
                className="w-full text-left p-4 flex items-center gap-3 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition"
              >
                <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-sky-500 to-indigo-600 flex items-center justify-center text-white shadow-md">
                  {branch.sport.id === 1 ? (
                    <CircleDot className="w-6 h-6" />
                  ) : (
                    <Trophy className="w-5 h-5" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-lg font-bold">{sportLabel(branch.sport)}</h3>
                    {branch.sport.popular && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300">
                        <Flame className="w-3 h-3" /> Popular
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    {branch.categoryCount} países/regiões · {branch.tournamentCount} ligas ·{" "}
                    <b className="text-sky-600 dark:text-sky-400">{branch.eventCount} jogos</b>
                  </div>
                </div>
                <div className="text-gray-400">
                  {isSportOpen ? (
                    <ChevronDown className="w-6 h-6" />
                  ) : (
                    <ChevronRight className="w-6 h-6" />
                  )}
                </div>
              </button>

              {isSportOpen && (
                <div className="border-t border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-950/30 divide-y divide-gray-200 dark:divide-gray-800">
                  {branch.categories.map((cat) => {
                    const cKey = `${sId}-${cat.category.id}`;
                    const catOpen = openCategory === null || openCategory === cKey;
                    return (
                      <div key={cat.category.id}>
                        <button
                          onClick={() =>
                            setOpenCategory(catOpen && openCategory !== null ? null : cKey)
                          }
                          className="w-full text-left px-4 sm:px-6 py-3 flex items-center gap-2 hover:bg-white dark:hover:bg-gray-900/60 transition"
                        >
                          <span className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 w-8">
                            {cat.category.country_code ||
                              (cat.category.country || cat.category.name || "")
                                .slice(0, 2)
                                .toUpperCase()}
                          </span>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-semibold">
                              {cat.category.country ? (
                                <>
                                  <span className="text-gray-600 dark:text-gray-300">
                                    {cat.category.country}
                                  </span>
                                  <span className="text-gray-400 dark:text-gray-500 mx-1">·</span>
                                  <span>{cat.category.name || "Todas"}</span>
                                </>
                              ) : (
                                cat.category.name || "Sem categoria"
                              )}
                            </div>
                            <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                              {cat.tournaments.length} ligas ·{" "}
                              {cat.tournaments.reduce(
                                (sum, t) => sum + t.events.length,
                                0
                              )}{" "}
                              jogos
                            </div>
                          </div>
                          <span className="text-gray-400">
                            {catOpen ? (
                              <ChevronDown className="w-5 h-5" />
                            ) : (
                              <ChevronRight className="w-5 h-5" />
                            )}
                          </span>
                        </button>

                        {catOpen && (
                          <div className="pb-2">
                            {cat.tournaments.map((t) => (
                              <TournamentBlock
                                key={t.tournament.id}
                                tournament={t}
                                isLive={isLive}
                                onOpenEvent={(ev) =>
                                  navigate(
                                    `/betby/event/${ev.id}?sportId=${ev.sport_id}&live=${
                                      isLive ? 1 : 0
                                    }`
                                  )
                                }
                              />
                            ))}
                            {cat.tournaments.length === 0 && (
                              <div className="px-6 py-3 text-xs text-gray-500 dark:text-gray-400">
                                Nenhuma liga.
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {branch.categories.length === 0 && (
                    <div className="px-6 py-3 text-xs text-gray-500 dark:text-gray-400">
                      Sem categorias com eventos.
                    </div>
                  )}
                </div>
              )}
            </section>
          );
        })}

        {!tree.isLoading &&
          tree.branches.length === 0 &&
          !error &&
          (tree.totalEvents ?? 0) === 0 && (
            <div className="rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 bg-white/60 dark:bg-gray-900/40 p-10 text-center">
              <div className="mx-auto w-16 h-16 rounded-2xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-3">
                <Flame className="w-8 h-8 text-gray-400" />
              </div>
              <div className="font-bold text-gray-700 dark:text-gray-200 mb-1">
                Sem eventos {isLive ? "ao vivo" : "pré-jogo"} agora
              </div>
              <div className="text-sm text-gray-500 dark:text-gray-400">
                Clique em <b>Atualizar</b> ou tente outra modalidade.
              </div>
            </div>
          )}
      </div>
    </div>
  );
}

function TournamentBlock({
  tournament,
  isLive,
  onOpenEvent,
}: {
  tournament: BetbyTournamentBranch;
  isLive: boolean;
  onOpenEvent: (ev: BetbyEvent) => void;
}) {
  if (tournament.events.length === 0) return null;
  return (
    <div className="px-3 sm:px-6 pt-3">
      <div className="flex items-center gap-2 px-1 mb-2">
        <Trophy className="w-4 h-4 text-amber-500" />
        <span className="text-sm font-bold">
          {tournament.tournament.name || `Liga ${tournament.tournament.id}`}
        </span>
        <span className="text-[11px] text-gray-500 dark:text-gray-400 ml-auto">
          {tournament.events.length} jogo(s)
        </span>
        {tournament.tournament.popular && (
          <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300">
            TOP
          </span>
        )}
      </div>

      <div className="space-y-2">
        {tournament.events.map((ev) => {
          const { home, away } = teamNames(ev);
          const mainMarket =
            ev.markets?.[0] ??
            (ev.market_count
              ? { name: "1X2", outcomes: Array.from({ length: 3 }, () => ({ price: 0 })) }
              : undefined);
          const outcomes = mainMarket?.outcomes ?? [];
          return (
            <article
              key={ev.id}
              onClick={() => onOpenEvent(ev)}
              className="group rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3 sm:p-4 hover:shadow-md hover:border-sky-300 dark:hover:border-sky-700 transition cursor-pointer"
            >
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 w-20 text-center">
                  {isLive ? (
                    <div className="text-red-600 dark:text-red-400 font-extrabold text-xs uppercase tracking-wider">
                      <span className="inline-block w-2 h-2 rounded-full bg-red-500 animate-pulse mr-1 align-middle" />
                      {ev.live_time ||
                        (ev.clock?.minute ? `${ev.clock.minute}'` : "AO VIVO")}
                    </div>
                  ) : (
                    <div className="text-xs font-semibold text-gray-500 dark:text-gray-400">
                      <Clock className="w-3.5 h-3.5 inline mr-1 -mt-0.5" />
                      {formatKickoff(ev.kickoff ?? ev.start_ts)}
                    </div>
                  )}
                  {ev.score || ev.home_score !== undefined ? (
                    <div className="mt-1 text-2xl font-black text-gray-900 dark:text-white tabular-nums">
                      {ev.home_score ?? (ev.score ? String(ev.score).split(/[:\-x]/)[0] : "?")}
                      <span className="text-gray-400 mx-0.5">—</span>
                      {ev.away_score ?? (ev.score ? String(ev.score).split(/[:\-x]/)[1] : "?")}
                    </div>
                  ) : (
                    <div className="mt-1 text-lg font-black text-sky-600 dark:text-sky-400">
                      VS
                    </div>
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
                      <span className="truncate">{home || "Casa"}</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-300">
                      <span className="truncate">{away || "Fora"}</span>
                    </div>
                  </div>

                  {outcomes.length > 0 && (
                    <div className="mt-3 grid grid-cols-3 gap-2 max-w-md">
                      {outcomes.slice(0, 3).map((o, idx) => (
                        <button
                          key={idx}
                          onClick={(e) => e.stopPropagation()}
                          className="rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50 hover:bg-sky-50 dark:hover:bg-sky-900/30 hover:border-sky-400 dark:hover:border-sky-600 px-2 py-1.5 transition text-xs sm:text-sm"
                        >
                          <div className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400 font-bold">
                            {o.name || (idx === 0 ? "1" : idx === 1 ? "X" : "2")}
                          </div>
                          <div className="font-black text-sky-700 dark:text-sky-300 tabular-nums">
                            {o.price ? o.price.toFixed(2) : "—"}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="hidden sm:flex flex-col items-end justify-between self-stretch">
                  <div className="text-[10px] uppercase font-bold tracking-wider text-gray-500 dark:text-gray-400">
                    {ev.market_count ?? ev.markets?.length ?? 0} mercados
                  </div>
                  <div className="text-xs text-sky-600 dark:text-sky-400 group-hover:translate-x-0.5 transition font-semibold inline-flex items-center gap-1">
                    Ver detalhes <ChevronRight className="w-4 h-4" />
                  </div>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
