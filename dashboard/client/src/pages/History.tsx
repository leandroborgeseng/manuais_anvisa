import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileJson,
  Loader2,
  XCircle,
} from "lucide-react";

type ExecutionStatus = "running" | "paused" | "stopped" | "completed" | "error";

const statusConfig: Record<ExecutionStatus, { label: string; cls: string; icon: React.ReactNode }> = {
  running:   { label: "Executando",  cls: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30", icon: <Loader2 size={12} className="animate-spin" /> },
  paused:    { label: "Pausado",     cls: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",   icon: <Clock size={12} /> },
  stopped:   { label: "Parado",      cls: "bg-red-500/20 text-red-300 border-red-500/30",            icon: <XCircle size={12} /> },
  completed: { label: "Concluído",   cls: "bg-blue-500/20 text-blue-300 border-blue-500/30",         icon: <CheckCircle2 size={12} /> },
  error:     { label: "Erro",        cls: "bg-red-500/20 text-red-300 border-red-500/30",            icon: <AlertCircle size={12} /> },
};

function formatDuration(start: Date, end?: Date | null): string {
  const ms = (end ? new Date(end) : new Date()).getTime() - new Date(start).getTime();
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ${secs % 60}s`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ${mins % 60}m`;
}

export default function History() {
  const { data: executions = [], isLoading } = trpc.history.list.useQuery({ limit: 50 });

  return (
    <div className="p-8 space-y-6">
      {/* Header */}
      <div>
        <h1 className="font-display font-bold text-3xl text-white tracking-tight">
          Histórico de <span className="text-gradient-pink-violet">Execuções</span>
        </h1>
        <p className="text-white/40 mt-1 text-sm">
          Registro de todas as execuções anteriores do processo de download
        </p>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex items-center justify-center h-32">
          <Loader2 size={24} className="animate-spin text-pink-400" />
        </div>
      ) : executions.length === 0 ? (
        <div className="glass-card p-12 flex flex-col items-center justify-center text-white/30">
          <Clock size={40} className="mb-3 opacity-30" />
          <p className="text-sm font-medium">Nenhuma execução registrada</p>
          <p className="text-xs mt-1 opacity-60">As execuções aparecerão aqui após iniciar o processo</p>
        </div>
      ) : (
        <div className="space-y-3">
          {executions.map((exec) => {
            const cfg = statusConfig[exec.status as ExecutionStatus] ?? statusConfig.stopped;
            const successRate =
              exec.totalFound > 0
                ? Math.round((exec.totalCompleted / exec.totalFound) * 100)
                : 0;

            return (
              <div
                key={exec.id}
                className="glass-card p-5 flex flex-col gap-4 transition-all hover:border-white/20"
              >
                {/* Row header */}
                <div className="flex items-center gap-4 flex-wrap">
                  {/* Execution ID */}
                  <span className="font-mono text-xs text-white/30">#{exec.id}</span>

                  {/* Status */}
                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border",
                      cfg.cls
                    )}
                  >
                    {cfg.icon}
                    {cfg.label}
                  </span>

                  {/* Date */}
                  <span className="text-sm text-white/60">
                    {new Date(exec.startedAt).toLocaleString("pt-BR", {
                      day: "2-digit",
                      month: "2-digit",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>

                  {/* Duration */}
                  <span className="text-xs text-white/30 flex items-center gap-1">
                    <Clock size={11} />
                    {formatDuration(exec.startedAt, exec.finishedAt)}
                  </span>

                  {/* Manifest link */}
                  {exec.manifestUrl && (
                    <a
                      href={exec.manifestUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-auto flex items-center gap-1.5 text-xs text-violet-400 hover:text-violet-300 transition-colors"
                    >
                      <FileJson size={13} />
                      Manifesto JSON
                      <ExternalLink size={11} />
                    </a>
                  )}
                </div>

                {/* Stats row */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="glass-card p-3 text-center bg-white/5">
                    <div className="font-display font-bold text-xl text-white">{exec.totalFound}</div>
                    <div className="text-xs text-white/40 mt-0.5">Total Encontrado</div>
                  </div>
                  <div className="glass-card p-3 text-center bg-emerald-500/10">
                    <div className="font-display font-bold text-xl text-emerald-300">{exec.totalCompleted}</div>
                    <div className="text-xs text-emerald-400/60 mt-0.5">Baixados</div>
                  </div>
                  <div className={cn("glass-card p-3 text-center", exec.totalErrors > 0 ? "bg-red-500/10" : "bg-white/5")}>
                    <div className={cn("font-display font-bold text-xl", exec.totalErrors > 0 ? "text-red-300" : "text-white/50")}>
                      {exec.totalErrors}
                    </div>
                    <div className="text-xs text-white/40 mt-0.5">Erros</div>
                  </div>
                  <div className="glass-card p-3 text-center bg-white/5">
                    <div className="font-display font-bold text-xl text-white">{successRate}%</div>
                    <div className="text-xs text-white/40 mt-0.5">Taxa de Sucesso</div>
                  </div>
                </div>

                {/* Progress bar */}
                {exec.totalFound > 0 && (
                  <div className="relative h-1.5 bg-white/10 rounded-full overflow-hidden">
                    <div
                      className="absolute inset-y-0 left-0 rounded-full"
                      style={{
                        width: `${successRate}%`,
                        background: "linear-gradient(90deg, oklch(0.65 0.28 350), oklch(0.55 0.30 290))",
                      }}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
