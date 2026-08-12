import { useEffect } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Loader2, AlertTriangle, ArrowLeft, ExternalLink } from "lucide-react";

export default function BetbyEventTrackerPage() {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const navigate = useNavigate();
  const sportId = sp.get("sportId") || "1";
  const live = sp.get("live") === "1" ? 1 : 0;
  const lang = sp.get("lang") || "en";
  const trackerUrl = `/betby/tracker?eventId=${encodeURIComponent(id!)}&sportId=${encodeURIComponent(sportId)}&lang=${encodeURIComponent(lang)}&live=${live}`;

  useEffect(() => {
    // Redirecionamento suave para o proxy jwt-service que já resolve 302 -> tracker embed
    const t = setTimeout(() => {
      try {
        window.location.href = trackerUrl;
      } catch {
        // fallback via navigate (se não for cross)
        navigate(trackerUrl, { replace: true });
      }
    }, 800);
    return () => clearTimeout(t);
  }, [trackerUrl, navigate]);

  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4 py-12">
      <div className="max-w-lg w-full text-center">
        <div className="mx-auto w-20 h-20 rounded-2xl bg-gradient-to-br from-sky-500 to-indigo-600 flex items-center justify-center mb-5 shadow-xl">
          <Loader2 className="w-10 h-10 text-white animate-spin" />
        </div>
        <h1 className="text-2xl font-black mb-2">Abrindo tracker do evento #{id}</h1>
        <p className="text-gray-500 dark:text-gray-400 text-sm mb-6">
          Redirecionando para o StatScore embed via BetBY proxy…
        </p>
        <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 text-left text-sm space-y-2 mb-6">
          <div className="flex gap-2 items-center text-xs text-gray-500 dark:text-gray-400">
            <span className="font-bold uppercase tracking-wider">Event</span>
            <code className="px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white">
              {id}
            </code>
          </div>
          <div className="flex gap-2 items-center text-xs text-gray-500 dark:text-gray-400">
            <span className="font-bold uppercase tracking-wider">Sport</span>
            <code className="px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white">
              {sportId}
            </code>
            <span className="ml-2 font-bold uppercase tracking-wider">Live</span>
            <code className="px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white">
              {live}
            </code>
          </div>
          <div className="flex gap-2 items-center text-xs text-gray-500 dark:text-gray-400 break-all">
            <span className="font-bold uppercase tracking-wider">URL</span>
            <code className="px-2 py-0.5 rounded bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300">
              {trackerUrl}
            </code>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            onClick={() => navigate(-1)}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800 px-4 py-2 text-sm font-semibold"
          >
            <ArrowLeft className="w-4 h-4" /> Voltar
          </button>
          <a
            href={trackerUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-2 rounded-lg bg-sky-600 hover:bg-sky-700 active:bg-sky-800 text-white px-4 py-2 text-sm font-semibold shadow-md"
          >
            <ExternalLink className="w-4 h-4" /> Abrir agora
          </a>
        </div>
        <div className="mt-6 rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/20 text-amber-800 dark:text-amber-300 p-4 text-left text-sm flex gap-3 items-start">
          <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold">Aviso</div>
            <div className="opacity-90 mt-0.5">
              O tracker do evento é carregado a partir do widget original da BetBY
              (Watchers / StatScore) através do nosso proxy <code>jwt-service</code> em :8787.
              Certifique-se que o serviço está rodando.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
