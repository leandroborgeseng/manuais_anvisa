import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { DownloadItem, formatBytes, useSSE } from "@/hooks/useSSE";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Download,
  FileText,
  Loader2,
  RefreshCw,
  Upload,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

type FilterStatus = "all" | "aguardando" | "baixando" | "enviando para B2" | "concluído" | "erro";

const statusConfig: Record<
  string,
  { label: string; icon: React.ReactNode; barColor: string; textClass: string; bgClass: string }
> = {
  aguardando: {
    label: "Aguardando",
    icon: <Clock size={13} />,
    barColor: "oklch(0.50 0.05 270)",
    textClass: "text-white/50",
    bgClass: "status-aguardando",
  },
  baixando: {
    label: "Baixando",
    icon: <Download size={13} />,
    barColor: "oklch(0.65 0.22 220)",
    textClass: "text-blue-300",
    bgClass: "status-baixando",
  },
  "enviando para B2": {
    label: "Enviando para B2",
    icon: <Upload size={13} />,
    barColor: "oklch(0.72 0.22 55)",
    textClass: "text-orange-300",
    bgClass: "status-enviando",
  },
  concluído: {
    label: "Concluído",
    icon: <CheckCircle2 size={13} />,
    barColor: "oklch(0.65 0.20 145)",
    textClass: "text-emerald-300",
    bgClass: "status-concluido",
  },
  erro: {
    label: "Erro",
    icon: <AlertCircle size={13} />,
    barColor: "oklch(0.60 0.25 25)",
    textClass: "text-red-300",
    bgClass: "status-erro",
  },
};

function DownloadRow({ item }: { item: DownloadItem }) {
  const cfg = statusConfig[item.status] ?? statusConfig.aguardando;
  const retryMutation = trpc.process.retryDownload.useMutation({
    onSuccess: (r) => toast[r.success ? "success" : "error"](r.message),
    onError: () => toast.error("Falha ao reprocessar."),
  });

  const isActive = item.status === "baixando" || item.status === "enviando para B2";

  return (
    <div className="glass-card p-4 flex flex-col gap-2 transition-all duration-300 hover:border-white/20">
      {/* Row header */}
      <div className="flex items-center gap-3">
        <div className="shrink-0 text-white/20">
          <FileText size={16} />
        </div>

        {/* Filename */}
        <div className="flex-1 min-w-0">
          <p className="text-sm text-white font-medium truncate" title={item.filename}>
            {item.filename}
          </p>
          {item.b2Key && (
            <p className="text-xs text-white/30 truncate font-mono mt-0.5">{item.b2Key}</p>
          )}
        </div>

        {/* Size */}
        {item.sizeBytes > 0 && (
          <span className="text-xs text-white/30 shrink-0">{formatBytes(item.sizeBytes)}</span>
        )}

        {/* Status badge */}
        <span
          className={cn(
            "shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold",
            cfg.bgClass
          )}
        >
          {cfg.icon}
          {cfg.label}
        </span>

        {/* Retry button */}
        {item.status === "erro" && (
          <button
            onClick={() => retryMutation.mutate({ downloadId: item.id })}
            disabled={retryMutation.isPending}
            className={cn(
              "shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold",
              "bg-pink-500/20 text-pink-300 border border-pink-500/30",
              "hover:bg-pink-500/30 hover:border-pink-400/50 transition-all",
              "disabled:opacity-50 disabled:cursor-not-allowed"
            )}
          >
            {retryMutation.isPending ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <RefreshCw size={12} />
            )}
            Tentar Novamente
          </button>
        )}
      </div>

      {/* Progress bar */}
      {(isActive || item.status === "concluído") && (
        <div className="relative h-1.5 bg-white/10 rounded-full overflow-hidden ml-7">
          <div
            className={cn("absolute inset-y-0 left-0 rounded-full transition-all duration-500", isActive && "progress-active")}
            style={{
              width: `${item.progress}%`,
              background: `linear-gradient(90deg, ${cfg.barColor}, ${cfg.barColor}cc)`,
              boxShadow: `0 0 8px ${cfg.barColor}80`,
            }}
          />
        </div>
      )}

      {/* Error message */}
      {item.status === "erro" && item.errorMessage && (
        <p className="text-xs text-red-400/70 ml-7 flex items-center gap-1.5">
          <AlertCircle size={11} />
          {item.errorMessage}
        </p>
      )}
    </div>
  );
}

export default function Downloads() {
  const { stats } = useSSE();
  const [filter, setFilter] = useState<FilterStatus>("all");
  const [search, setSearch] = useState("");

  const filtered = stats.downloads.filter((d) => {
    if (filter !== "all" && d.status !== filter) return false;
    if (search && !d.filename.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const counts: Record<string, number> = {};
  for (const d of stats.downloads) {
    counts[d.status] = (counts[d.status] ?? 0) + 1;
  }

  const filterButtons: { key: FilterStatus; label: string }[] = [
    { key: "all", label: `Todos (${stats.downloads.length})` },
    { key: "aguardando", label: `Aguardando (${counts["aguardando"] ?? 0})` },
    { key: "baixando", label: `Baixando (${counts["baixando"] ?? 0})` },
    { key: "enviando para B2", label: `Enviando B2 (${counts["enviando para B2"] ?? 0})` },
    { key: "concluído", label: `Concluídos (${counts["concluído"] ?? 0})` },
    { key: "erro", label: `Erros (${counts["erro"] ?? 0})` },
  ];

  return (
    <div className="p-8 space-y-6">
      {/* Header */}
      <div>
        <h1 className="font-display font-bold text-3xl text-white tracking-tight">
          Downloads <span className="text-gradient-pink-violet">em Tempo Real</span>
        </h1>
        <p className="text-white/40 mt-1 text-sm">
          Status individual de cada manual sendo processado
        </p>
      </div>

      {/* Filters + Search */}
      <div className="flex flex-col gap-3">
        {/* Search */}
        <input
          type="text"
          placeholder="Buscar por nome do arquivo..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="glass-card px-4 py-2.5 text-sm text-white placeholder-white/30 outline-none border-white/10 focus:border-pink-500/50 transition-colors w-full max-w-md"
        />

        {/* Filter tabs */}
        <div className="flex flex-wrap gap-2">
          {filterButtons.map((btn) => (
            <button
              key={btn.key}
              onClick={() => setFilter(btn.key)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-semibold transition-all",
                filter === btn.key
                  ? "bg-gradient-to-r from-pink-600/80 to-violet-600/80 text-white shadow-lg"
                  : "bg-white/5 text-white/50 hover:bg-white/10 hover:text-white/80"
              )}
            >
              {btn.label}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <div className="glass-card p-12 flex flex-col items-center justify-center text-white/30">
          <Download size={40} className="mb-3 opacity-30" />
          <p className="text-sm font-medium">Nenhum download encontrado</p>
          <p className="text-xs mt-1 opacity-60">
            {stats.status === "idle"
              ? "Inicie o processo no Dashboard para começar"
              : "Aguardando itens..."}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((item) => (
            <DownloadRow key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}
