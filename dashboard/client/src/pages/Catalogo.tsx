import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import {
  Database,
  Loader2,
  Pause,
  Play,
  Search,
  Square,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

function formatDate(value?: Date | string | null) {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-BR");
}

export default function Catalogo() {
  const [search, setSearch] = useState("");
  const [situacao, setSituacao] = useState("");

  const { data: stats, refetch: refetchStats } = trpc.catalog.stats.useQuery(undefined, {
    refetchInterval: (q) => (q.state.data?.status === "running" ? 2000 : false),
  });

  const { data: regStats } = trpc.catalog.registrosStats.useQuery(undefined, {
    refetchInterval: stats?.status === "running" ? 5000 : false,
  });

  const { data: registros, isLoading } = trpc.catalog.list.useQuery({
    search: search || undefined,
    situacao: situacao || undefined,
    limit: 100,
    offset: 0,
  });

  const startSync = trpc.catalog.startSync.useMutation({
    onSuccess: (r) => {
      toast.success(r.message);
      void refetchStats();
    },
    onError: (e) => toast.error(e.message),
  });

  const stopSync = trpc.catalog.stopSync.useMutation({
    onSuccess: (r) => {
      toast.message(r.message);
      void refetchStats();
    },
  });

  const isRunning = stats?.status === "running";

  return (
    <div className="p-8 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display font-bold text-3xl text-white tracking-tight">
            Catálogo <span className="text-gradient-pink-violet">ANVISA</span>
          </h1>
          <p className="text-white/40 mt-1 text-sm">
            Inventário completo de registros para saúde — valor independente dos PDFs
          </p>
        </div>

        <div className="flex gap-2">
          {!isRunning ? (
            <button
              type="button"
              onClick={() => startSync.mutate({})}
              disabled={startSync.isPending}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium transition-colors disabled:opacity-50"
            >
              {startSync.isPending ? (
                <Loader2 className="animate-spin" size={16} />
              ) : (
                <Play size={16} />
              )}
              Sincronizar catálogo
            </button>
          ) : (
            <button
              type="button"
              onClick={() => stopSync.mutate()}
              disabled={stopSync.isPending}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-600/80 hover:bg-red-500 text-white text-sm font-medium transition-colors"
            >
              <Square size={16} />
              Parar
            </button>
          )}
        </div>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label="Registros no banco"
          value={String(regStats?.total ?? stats?.recordsInDb ?? 0)}
          icon={<Database size={18} className="text-blue-400" />}
        />
        <StatCard
          label="Catálogo ANVISA (total)"
          value={String(stats?.totalElements ?? "—")}
          icon={<Database size={18} className="text-violet-400" />}
        />
        <StatCard
          label="Página atual"
          value={
            stats?.totalPages
              ? `${(stats.currentPage ?? 0) + 1} / ${stats.totalPages}`
              : "—"
          }
          icon={<Pause size={18} className="text-amber-400" />}
        />
        <StatCard
          label="Progresso"
          value={`${stats?.percentComplete ?? 0}%`}
          icon={<Loader2 size={18} className={cn(isRunning && "animate-spin text-emerald-400")} />}
        />
      </div>

      {isRunning && (
        <div className="glass-card p-4">
          <div className="flex justify-between text-xs text-white/50 mb-2">
            <span>Sincronizando… termo &quot;{stats?.queryTerm}&quot;</span>
            <span>{stats?.recordsUpserted ?? 0} processados nesta execução</span>
          </div>
          <div className="h-2 bg-white/10 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-blue-500 to-violet-500 transition-all duration-500"
              style={{ width: `${stats?.percentComplete ?? 0}%` }}
            />
          </div>
        </div>
      )}

      {regStats && regStats.bySituacao.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setSituacao("")}
            className={cn(
              "px-3 py-1 rounded-full text-xs border transition-colors",
              !situacao ? "border-pink-500/50 bg-pink-500/20 text-pink-200" : "border-white/10 text-white/50"
            )}
          >
            Todos ({regStats.total})
          </button>
          {regStats.bySituacao.map((s) => (
            <button
              key={s.situacao ?? "null"}
              type="button"
              onClick={() => setSituacao(s.situacao ?? "")}
              className={cn(
                "px-3 py-1 rounded-full text-xs border transition-colors",
                situacao === (s.situacao ?? "")
                  ? "border-pink-500/50 bg-pink-500/20 text-pink-200"
                  : "border-white/10 text-white/50"
              )}
            >
              {s.situacao ?? "Sem situação"} ({s.count})
            </button>
          ))}
        </div>
      )}

      <input
        type="text"
        placeholder="Buscar por produto, registro, processo ou empresa..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="glass-card px-4 py-2.5 text-sm text-white placeholder-white/30 outline-none border-white/10 focus:border-pink-500/50 transition-colors w-full max-w-lg"
      />

      {isLoading ? (
        <div className="flex items-center gap-2 text-white/40">
          <Loader2 className="animate-spin" size={18} />
          Carregando registros...
        </div>
      ) : (registros ?? []).length === 0 ? (
        <div className="glass-card p-12 text-center text-white/30">
          <Search size={40} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">Nenhum registro no catálogo ainda</p>
          <p className="text-xs mt-1 opacity-60">
            Clique em &quot;Sincronizar catálogo&quot; para importar da ANVISA (~188 mil registros)
          </p>
        </div>
      ) : (
        <div className="grid gap-2">
          {(registros ?? []).map((r) => (
            <div key={r.id} className="glass-card p-4 grid md:grid-cols-4 gap-2 text-sm">
              <div className="md:col-span-2">
                <p className="text-white font-medium">{r.nomeProduto ?? "—"}</p>
                <p className="text-white/40 text-xs">{r.nomeTecnico}</p>
              </div>
              <div>
                <p className="text-white/40 text-xs">Registro</p>
                <p className="text-white/90">{r.numeroRegistro ?? "—"}</p>
                <p className="text-white/30 text-xs font-mono">{r.processo}</p>
              </div>
              <div>
                <p className="text-white/40 text-xs">Situação / Risco</p>
                <p className="text-white/90">{r.situacao ?? "—"}</p>
                <p className="text-white/50 text-xs">{r.riscoDescricao}</p>
              </div>
              <div className="md:col-span-4 flex flex-wrap gap-4 text-xs text-white/40 pt-1 border-t border-white/5">
                <span>Empresa: {r.razaoSocial ?? "—"}</span>
                <span>Vigência: {formatDate(r.dataInicioVigencia)}</span>
                <span>Vencimento: {formatDate(r.dataVencimento)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="glass-card p-4">
      <div className="flex items-center gap-2 text-white/40 text-xs mb-2">
        {icon}
        {label}
      </div>
      <p className="text-white text-xl font-semibold">{value}</p>
    </div>
  );
}
