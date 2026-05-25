import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { DashboardStats, formatBytes, formatSpeed, useSSE } from "@/hooks/useSSE";
import {
  AlertCircle,
  CheckCircle2,
  Download,
  HardDrive,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  Square,
  TrendingUp,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";

interface MetricCardProps {
  label: string;
  value: string;
  sub?: string;
  icon: React.ReactNode;
  glowClass?: string;
  valueClass?: string;
}

function MetricCard({ label, value, sub, icon, glowClass, valueClass }: MetricCardProps) {
  return (
    <div className={cn("glass-card p-5 flex flex-col gap-3 transition-all duration-300 hover:scale-[1.02]", glowClass)}>
      <div className="flex items-center justify-between">
        <span className="text-xs text-white/40 uppercase tracking-widest font-medium">{label}</span>
        <div className="text-white/30">{icon}</div>
      </div>
      <div>
        <div className={cn("font-display font-bold text-2xl text-white leading-none", valueClass)}>{value}</div>
        {sub && <div className="text-xs text-white/40 mt-1">{sub}</div>}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: DashboardStats["status"] }) {
  const map: Record<string, { label: string; cls: string; dot: string }> = {
    idle:      { label: "Aguardando",  cls: "bg-white/10 text-white/50",           dot: "bg-white/40" },
    running:   { label: "Executando",  cls: "bg-emerald-500/20 text-emerald-300",  dot: "bg-emerald-400 animate-pulse" },
    paused:    { label: "Pausado",     cls: "bg-yellow-500/20 text-yellow-300",    dot: "bg-yellow-400" },
    stopped:   { label: "Parado",      cls: "bg-red-500/20 text-red-300",          dot: "bg-red-400" },
    completed: { label: "Concluído",   cls: "bg-blue-500/20 text-blue-300",        dot: "bg-blue-400" },
    error:     { label: "Erro",        cls: "bg-red-500/20 text-red-300",          dot: "bg-red-400" },
  };
  const s = map[status] ?? map.idle;
  return (
    <span className={cn("inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold", s.cls)}>
      <span className={cn("w-2 h-2 rounded-full", s.dot)} />
      {s.label}
    </span>
  );
}

export default function Dashboard() {
  const { stats, connected } = useSSE();

  const startMutation = trpc.process.start.useMutation({
    onSuccess: (r) => toast[r.success ? "success" : "error"](r.message),
    onError: () => toast.error("Falha ao iniciar o processo."),
  });
  const pauseMutation = trpc.process.pause.useMutation({
    onSuccess: (r) => toast[r.success ? "success" : "error"](r.message),
  });
  const resumeMutation = trpc.process.resume.useMutation({
    onSuccess: (r) => toast[r.success ? "success" : "error"](r.message),
  });
  const stopMutation = trpc.process.stop.useMutation({
    onSuccess: (r) => toast[r.success ? "success" : "error"](r.message),
  });

  const isRunning = stats.status === "running";
  const isPaused = stats.status === "paused";
  const isActive = isRunning || isPaused;
  const isIdle = stats.status === "idle" || stats.status === "stopped" || stats.status === "completed" || stats.status === "error";

  // Pie chart data
  const pieData = [
    { name: "Concluídos", value: stats.totalCompleted, color: "oklch(0.65 0.20 145)" },
    { name: "Erros", value: stats.totalErrors, color: "oklch(0.60 0.25 25)" },
    {
      name: "Pendentes",
      value: Math.max(0, stats.totalFound - stats.totalCompleted - stats.totalErrors),
      color: "oklch(0.25 0.08 255)",
    },
  ].filter((d) => d.value > 0);

  const hasData = stats.totalFound > 0;

  return (
    <div className="p-8 space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-display font-bold text-4xl text-white leading-tight tracking-tight">
            <span className="text-gradient-pink-violet">ANVISA</span> Dashboard
          </h1>
          <p className="text-white/40 mt-1 text-sm tracking-wide">
            Monitoramento de downloads de manuais de equipamentos médicos
          </p>
        </div>
        <div className="flex items-center gap-3">
          <StatusBadge status={stats.status} />
          {stats.executionId && (
            <span className="text-xs text-white/30 font-mono">#{stats.executionId}</span>
          )}
        </div>
      </div>

      {/* Metric cards */}
      <div className="grid grid-cols-2 xl:grid-cols-5 gap-4">
        <MetricCard
          label="Total Encontrado"
          value={stats.totalFound.toLocaleString()}
          icon={<Download size={16} />}
          glowClass="glow-violet"
          valueClass="text-gradient-pink-violet"
        />
        <MetricCard
          label="Concluídos"
          value={stats.totalCompleted.toLocaleString()}
          sub={`${stats.percentComplete}% do total`}
          icon={<CheckCircle2 size={16} />}
          glowClass="glow-green"
        />
        <MetricCard
          label="Erros"
          value={stats.totalErrors.toLocaleString()}
          icon={<AlertCircle size={16} />}
          glowClass={stats.totalErrors > 0 ? "glow-pink" : ""}
          valueClass={stats.totalErrors > 0 ? "text-red-400" : ""}
        />
        <MetricCard
          label="Velocidade"
          value={isRunning ? formatSpeed(stats.currentSpeed) : "—"}
          icon={<Zap size={16} />}
          glowClass="glow-orange"
          valueClass="text-gradient-orange-pink"
        />
        <MetricCard
          label="Espaço no B2"
          value={formatBytes(stats.b2SpaceUsed)}
          icon={<HardDrive size={16} />}
          glowClass="glow-blue"
        />
      </div>

      {/* Progress + Pie chart */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Progress bar */}
        <div className="xl:col-span-2 glass-card p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-display font-semibold text-white text-lg flex items-center gap-2">
              <TrendingUp size={18} className="text-pink-400" />
              Progresso Geral
            </h2>
            <span className="font-display font-bold text-3xl text-gradient-pink-violet">
              {stats.percentComplete}%
            </span>
          </div>

          {/* Main progress bar */}
          <div className="relative h-4 bg-white/10 rounded-full overflow-hidden">
            <div
              className="absolute inset-y-0 left-0 rounded-full transition-all duration-700 ease-out"
              style={{
                width: `${stats.percentComplete}%`,
background: "linear-gradient(90deg, oklch(0.60 0.28 240), oklch(0.45 0.30 270))",
                    boxShadow: "0 0 20px oklch(0.60 0.28 240 / 0.6)",
              }}
            />
            {isRunning && (
              <div
                className="absolute inset-y-0 left-0 rounded-full opacity-50"
                style={{
                  width: `${stats.percentComplete}%`,
                  background: "linear-gradient(90deg, transparent, white 50%, transparent)",
                  animation: "shimmer 1.5s ease-in-out infinite",
                }}
              />
            )}
          </div>

          {/* Sub-progress bars */}
          <div className="grid grid-cols-3 gap-3 mt-2">
            {[
              { label: "Concluídos", count: stats.totalCompleted, color: "oklch(0.65 0.20 145)", bg: "bg-emerald-500/20 text-emerald-300" },
              { label: "Erros", count: stats.totalErrors, color: "oklch(0.60 0.25 25)", bg: "bg-red-500/20 text-red-300" },
              {
                label: "Pendentes",
                count: Math.max(0, stats.totalFound - stats.totalCompleted - stats.totalErrors),
                color: "oklch(0.40 0.10 270)",
                bg: "bg-white/10 text-white/50",
              },
            ].map((s) => (
              <div key={s.label} className={cn("rounded-lg px-3 py-2 text-center", s.bg)}>
                <div className="font-display font-bold text-xl">{s.count}</div>
                <div className="text-xs opacity-70 mt-0.5">{s.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Pie chart */}
        <div className="glass-card p-6 flex flex-col items-center justify-center">
          <h2 className="font-display font-semibold text-white text-base mb-4 self-start">Distribuição</h2>
          {hasData ? (
            <ResponsiveContainer width="100%" height={160}>
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={45}
                  outerRadius={70}
                  paddingAngle={3}
                  dataKey="value"
                >
                  {pieData.map((entry, index) => (
                    <Cell key={index} fill={entry.color} stroke="transparent" />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    background: "oklch(0.12 0.03 270 / 0.95)",
                    border: "1px solid oklch(0.35 0.08 270 / 0.3)",
                    borderRadius: "8px",
                    color: "white",
                    fontSize: "12px",
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex flex-col items-center justify-center h-40 text-white/30">
              <Download size={32} className="mb-2 opacity-30" />
              <p className="text-sm">Nenhum dado ainda</p>
            </div>
          )}
          <div className="flex flex-col gap-1.5 w-full mt-2">
            {[
              { label: "Concluídos", color: "bg-emerald-500" },
              { label: "Erros", color: "bg-red-500" },
              { label: "Pendentes", color: "bg-white/20" },
            ].map((l) => (
              <div key={l.label} className="flex items-center gap-2 text-xs text-white/50">
                <span className={cn("w-2.5 h-2.5 rounded-full", l.color)} />
                {l.label}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Global controls */}
      <div className="glass-card p-6">
        <h2 className="font-display font-semibold text-white text-lg mb-5">Controles Globais</h2>
        <div className="flex flex-wrap gap-3">
          {/* Iniciar */}
          <button
            onClick={() => startMutation.mutate()}
            disabled={!isIdle || startMutation.isPending}
            className={cn(
              "flex items-center gap-2 px-6 py-3 rounded-xl font-semibold text-sm transition-all duration-200",
"bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg",
            "hover:from-blue-500 hover:to-indigo-500 hover:shadow-blue-500/30 hover:shadow-xl",
              "disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:shadow-none"
            )}
          >
            {startMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
            Iniciar
          </button>

          {/* Pausar */}
          <button
            onClick={() => pauseMutation.mutate()}
            disabled={!isRunning || pauseMutation.isPending}
            className={cn(
              "flex items-center gap-2 px-6 py-3 rounded-xl font-semibold text-sm transition-all duration-200",
              "bg-yellow-500/20 text-yellow-300 border border-yellow-500/30",
              "hover:bg-yellow-500/30 hover:border-yellow-400/50",
              "disabled:opacity-40 disabled:cursor-not-allowed"
            )}
          >
            {pauseMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Pause size={16} />}
            Pausar
          </button>

          {/* Retomar */}
          <button
            onClick={() => resumeMutation.mutate()}
            disabled={!isPaused || resumeMutation.isPending}
            className={cn(
              "flex items-center gap-2 px-6 py-3 rounded-xl font-semibold text-sm transition-all duration-200",
              "bg-blue-500/20 text-blue-300 border border-blue-500/30",
              "hover:bg-blue-500/30 hover:border-blue-400/50",
              "disabled:opacity-40 disabled:cursor-not-allowed"
            )}
          >
            {resumeMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <RotateCcw size={16} />}
            Retomar
          </button>

          {/* Parar */}
          <button
            onClick={() => stopMutation.mutate()}
            disabled={!isActive || stopMutation.isPending}
            className={cn(
              "flex items-center gap-2 px-6 py-3 rounded-xl font-semibold text-sm transition-all duration-200",
              "bg-red-500/20 text-red-300 border border-red-500/30",
              "hover:bg-red-500/30 hover:border-red-400/50",
              "disabled:opacity-40 disabled:cursor-not-allowed"
            )}
          >
            {stopMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Square size={16} />}
            Parar
          </button>
        </div>

        {/* Status info */}
        {isRunning && (
          <p className="mt-4 text-sm text-white/40 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            Processo em execução — baixando e enviando para Backblaze B2
          </p>
        )}
        {isPaused && (
          <p className="mt-4 text-sm text-yellow-400/70 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-yellow-400" />
            Processo pausado — clique em Retomar para continuar
          </p>
        )}
      </div>
    </div>
  );
}
