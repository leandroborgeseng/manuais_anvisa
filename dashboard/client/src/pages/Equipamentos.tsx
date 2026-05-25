import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { formatBytes, useSSE } from "@/hooks/useSSE";
import {
  Calendar,
  Database,
  FileText,
  HardDrive,
  Hash,
  Loader2,
  Search,
  Shield,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

function formatDate(value?: Date | string | null) {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-BR");
}

function formatNumber(n: number) {
  return n.toLocaleString("pt-BR");
}

type EquipamentoRow = {
  id: number;
  executionId: number | null;
  processo: string;
  numeroRegistro: string | null;
  nomeProduto: string | null;
  nomeTecnico: string | null;
  situacao: string | null;
  razaoSocial: string | null;
  riscoDescricao: string | null;
  vencimentoDescricao: string | null;
  dataInicioVigencia: Date | null;
  dataVencimento: Date | null;
  tipoAnexo: string | null;
  nomeArquivo: string | null;
  pdfUrl: string | null;
  createdAt: Date;
};

type ArquivoInfo = {
  id: number;
  nomeArquivo?: string | null;
  tipoAnexo?: string | null;
  pdfUrl?: string | null;
  executionId?: number | null;
};

type EquipamentoGroup = EquipamentoRow & {
  arquivos: ArquivoInfo[];
};

function groupByProcesso(items: EquipamentoRow[]): EquipamentoGroup[] {
  const map = new Map<string, EquipamentoGroup>();

  for (const eq of items) {
    const existing = map.get(eq.processo);
    const arquivo: ArquivoInfo = {
      id: eq.id,
      nomeArquivo: eq.nomeArquivo,
      tipoAnexo: eq.tipoAnexo,
      pdfUrl: eq.pdfUrl,
      executionId: eq.executionId,
    };

    if (!existing) {
      map.set(eq.processo, {
        ...eq,
        arquivos: eq.nomeArquivo ? [arquivo] : [],
      });
      continue;
    }

    if (
      eq.nomeArquivo &&
      !existing.arquivos.some(
        (a) => a.nomeArquivo === eq.nomeArquivo && a.pdfUrl === eq.pdfUrl
      )
    ) {
      existing.arquivos.push(arquivo);
    }
  }

  return Array.from(map.values());
}

type ScopeFilter = "todos" | "lote";

export default function Equipamentos() {
  const { stats } = useSSE();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [scope, setScope] = useState<ScopeFilter>("todos");
  const [offset, setOffset] = useState(0);
  const pageSize = 100;

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    setOffset(0);
  }, [debouncedSearch, scope]);

  const executionId =
    scope === "lote" && stats.executionId ? stats.executionId : undefined;

  const { data: globalStats, refetch: refetchStats } = trpc.equipamentos.stats.useQuery(
    { executionId: stats.executionId ?? undefined },
    { refetchInterval: stats.status === "running" ? 5000 : 30000 }
  );

  const { data, isLoading, isFetching } = trpc.equipamentos.list.useQuery(
    {
      executionId,
      search: debouncedSearch || undefined,
      limit: pageSize,
      offset,
    },
    { refetchInterval: stats.status === "running" ? 5000 : false }
  );

  const grouped = useMemo(() => groupByProcesso(data?.items ?? []), [data?.items]);
  const totalRows = data?.total ?? 0;
  const hasMore = offset + pageSize < totalRows;

  const faltam =
    globalStats && globalStats.catalogTotal > globalStats.equipamentosUnicos
      ? globalStats.catalogTotal - globalStats.equipamentosUnicos
      : 0;

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="font-display font-bold text-3xl text-white tracking-tight">
          Equipamentos <span className="text-gradient-pink-violet">ANVISA</span>
        </h1>
        <p className="text-white/40 mt-1 text-sm">
          Histórico completo de equipamentos e manuais baixados — todos os lotes
        </p>
      </div>

      {/* Estatísticas globais */}
      {globalStats && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
            <StatCard
              icon={<Database size={16} />}
              label="Equipamentos únicos"
              value={formatNumber(globalStats.equipamentosUnicos)}
              sub={`de ~${formatNumber(globalStats.catalogTotal)} no catálogo`}
            />
            <StatCard
              icon={<FileText size={16} />}
              label="Arquivos PDF"
              value={formatNumber(globalStats.totalArquivos)}
              sub={`${formatNumber(globalStats.totalExecucoes)} execuções`}
            />
            <StatCard
              icon={<HardDrive size={16} />}
              label="Volume baixado"
              value={formatBytes(globalStats.totalBytes)}
              sub="soma de downloads concluídos"
            />
            <StatCard
              icon={<Database size={16} />}
              label="Faltam (catálogo)"
              value={formatNumber(faltam)}
              sub={`${globalStats.percentCatalog.toFixed(2)}% coberto`}
            />
          </div>

          {/* Barra de progresso catálogo */}
          <div className="glass-card p-5 space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-white/60">Progresso no catálogo ANVISA</span>
              <span className="text-white font-semibold">
                {formatNumber(globalStats.equipamentosUnicos)} /{" "}
                {formatNumber(globalStats.catalogTotal)}
              </span>
            </div>
            <div className="relative h-3 bg-white/10 rounded-full overflow-hidden">
              <div
                className="absolute inset-y-0 left-0 rounded-full transition-all duration-700"
                style={{
                  width: `${Math.min(globalStats.percentCatalog, 100)}%`,
                  background:
                    "linear-gradient(90deg, oklch(0.60 0.28 240), oklch(0.45 0.30 270))",
                }}
              />
            </div>
            {stats.status === "running" && globalStats.loteAtualArquivos > 0 && (
              <p className="text-xs text-white/40">
                Lote atual #{stats.executionId}: {formatNumber(globalStats.loteAtualEquipamentos)}{" "}
                equipamentos, {formatNumber(globalStats.loteAtualArquivos)} arquivos
              </p>
            )}
          </div>
        </div>
      )}

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="text"
          placeholder="Buscar por produto, registro, processo ou empresa..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="glass-card px-4 py-2.5 text-sm text-white placeholder-white/30 outline-none border-white/10 focus:border-pink-500/50 transition-colors flex-1 min-w-[240px] max-w-lg"
        />
        <div className="flex rounded-lg overflow-hidden border border-white/10">
          <ScopeButton active={scope === "todos"} onClick={() => setScope("todos")}>
            Todos os lotes
          </ScopeButton>
          <ScopeButton
            active={scope === "lote"}
            onClick={() => setScope("lote")}
            disabled={!stats.executionId}
          >
            Lote atual
          </ScopeButton>
        </div>
        <button
          type="button"
          onClick={() => void refetchStats()}
          className="text-xs text-white/40 hover:text-white/70 px-3 py-2"
        >
          Atualizar
        </button>
      </div>

      {/* Lista */}
      {isLoading ? (
        <div className="flex items-center gap-2 text-white/40">
          <Loader2 className="animate-spin" size={18} />
          Carregando equipamentos...
        </div>
      ) : grouped.length === 0 ? (
        <div className="glass-card p-12 text-center text-white/30">
          <FileText size={40} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">Nenhum equipamento encontrado</p>
          {scope === "lote" && (
            <p className="text-xs mt-1 opacity-60">
              Troque para &quot;Todos os lotes&quot; para ver o histórico completo
            </p>
          )}
        </div>
      ) : (
        <>
          <p className="text-xs text-white/30">
            Exibindo {formatNumber(grouped.length)} equipamentos nesta página (
            {formatNumber(totalRows)} registros no total)
          </p>
          <div className="grid gap-3">
            {grouped.map((eq) => (
              <div key={eq.processo} className="glass-card p-5 space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-white font-semibold text-lg">{eq.nomeProduto ?? "—"}</h2>
                    <p className="text-white/40 text-sm">{eq.nomeTecnico}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {eq.arquivos.length > 0 && (
                      <span className="px-3 py-1 rounded-full text-xs font-semibold bg-pink-500/20 text-pink-200">
                        {eq.arquivos.length} arquivo{eq.arquivos.length !== 1 ? "s" : ""}
                      </span>
                    )}
                    <span
                      className={cn(
                        "px-3 py-1 rounded-full text-xs font-semibold",
                        eq.situacao?.toLowerCase().includes("vig")
                          ? "bg-emerald-500/20 text-emerald-300"
                          : "bg-white/10 text-white/60"
                      )}
                    >
                      {eq.situacao ?? "—"}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 text-sm">
                  <MetaItem icon={<Hash size={14} />} label="Registro" value={eq.numeroRegistro} />
                  <MetaItem icon={<Hash size={14} />} label="Processo" value={eq.processo} />
                  <MetaItem icon={<Shield size={14} />} label="Risco" value={eq.riscoDescricao} />
                  <MetaItem
                    icon={<Calendar size={14} />}
                    label="Validade"
                    value={eq.vencimentoDescricao}
                  />
                  <MetaItem
                    icon={<Calendar size={14} />}
                    label="Início vigência"
                    value={formatDate(eq.dataInicioVigencia)}
                  />
                  <MetaItem
                    icon={<Calendar size={14} />}
                    label="Vencimento"
                    value={formatDate(eq.dataVencimento)}
                  />
                  <MetaItem icon={<Search size={14} />} label="Empresa" value={eq.razaoSocial} />
                </div>

                {eq.arquivos.length > 0 && (
                  <div className="space-y-2 pt-1">
                    <p className="text-xs text-white/40 uppercase tracking-wide">Arquivos PDF</p>
                    <ul className="space-y-1.5">
                      {eq.arquivos.map((arquivo) => (
                        <li
                          key={arquivo.id}
                          className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 bg-white/5 rounded-lg px-3 py-2"
                        >
                          <span
                            className="text-xs text-white/80 font-mono truncate"
                            title={arquivo.nomeArquivo ?? undefined}
                          >
                            {arquivo.nomeArquivo}
                          </span>
                          <div className="flex items-center gap-2 shrink-0">
                            {arquivo.executionId && (
                              <span className="text-xs text-white/25 font-mono">
                                lote #{arquivo.executionId}
                              </span>
                            )}
                            {arquivo.tipoAnexo && (
                              <span className="text-xs text-white/35">{arquivo.tipoAnexo}</span>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ))}
          </div>

          {(offset > 0 || hasMore) && (
            <div className="flex items-center justify-center gap-3 pt-2">
              <button
                type="button"
                disabled={offset === 0 || isFetching}
                onClick={() => setOffset((o) => Math.max(0, o - pageSize))}
                className="px-4 py-2 text-sm rounded-lg bg-white/5 text-white/70 hover:bg-white/10 disabled:opacity-30"
              >
                Anterior
              </button>
              <span className="text-xs text-white/40">
                {formatNumber(offset + 1)}–{formatNumber(Math.min(offset + pageSize, totalRows))}{" "}
                de {formatNumber(totalRows)}
              </span>
              <button
                type="button"
                disabled={!hasMore || isFetching}
                onClick={() => setOffset((o) => o + pageSize)}
                className="px-4 py-2 text-sm rounded-lg bg-white/5 text-white/70 hover:bg-white/10 disabled:opacity-30"
              >
                {isFetching ? "Carregando..." : "Próxima"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="glass-card p-4 space-y-2">
      <div className="flex items-center gap-2 text-white/40 text-xs uppercase tracking-wide">
        {icon}
        {label}
      </div>
      <div className="font-display font-bold text-xl text-white">{value}</div>
      {sub && <div className="text-xs text-white/35">{sub}</div>}
    </div>
  );
}

function ScopeButton({
  active,
  onClick,
  disabled,
  children,
}: {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "px-4 py-2.5 text-sm transition-colors",
        active ? "bg-pink-500/20 text-pink-200" : "text-white/50 hover:text-white/80",
        disabled && "opacity-40 cursor-not-allowed"
      )}
    >
      {children}
    </button>
  );
}

function MetaItem({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value?: string | null;
}) {
  return (
    <div className="bg-white/5 rounded-lg px-3 py-2">
      <div className="flex items-center gap-1.5 text-white/40 text-xs mb-1">
        {icon}
        {label}
      </div>
      <div className="text-white/90 truncate" title={value ?? undefined}>
        {value || "—"}
      </div>
    </div>
  );
}
