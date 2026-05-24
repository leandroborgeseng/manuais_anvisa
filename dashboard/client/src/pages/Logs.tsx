import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { useSSE } from "@/hooks/useSSE";
import { Activity, AlertTriangle, Info, XCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type LogLevel = "ALL" | "INFO" | "WARNING" | "ERROR";

const levelConfig = {
  INFO: {
    icon: <Info size={13} />,
    textClass: "text-blue-300",
    bgClass: "bg-blue-500/10 border-blue-500/20",
    dotClass: "bg-blue-400",
    label: "INFO",
  },
  WARNING: {
    icon: <AlertTriangle size={13} />,
    textClass: "text-yellow-300",
    bgClass: "bg-yellow-500/10 border-yellow-500/20",
    dotClass: "bg-yellow-400",
    label: "WARNING",
  },
  ERROR: {
    icon: <XCircle size={13} />,
    textClass: "text-red-300",
    bgClass: "bg-red-500/10 border-red-500/20",
    dotClass: "bg-red-400",
    label: "ERROR",
  },
};

export default function LogsPage() {
  const { stats } = useSSE();
  const [levelFilter, setLevelFilter] = useState<LogLevel>("ALL");
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  const { data: logs = [], refetch } = trpc.logs.list.useQuery(
    {
      executionId: stats.executionId ?? undefined,
      level: levelFilter === "ALL" ? undefined : levelFilter,
      limit: 300,
    },
    {
      refetchInterval: stats.status === "running" ? 2000 : 5000,
    }
  );

  // Auto-scroll to bottom
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
    setAutoScroll(isAtBottom);
  };

  const levelButtons: { key: LogLevel; label: string; count?: number }[] = [
    { key: "ALL", label: "Todos" },
    { key: "INFO", label: "INFO" },
    { key: "WARNING", label: "WARNING" },
    { key: "ERROR", label: "ERROR" },
  ];

  return (
    <div className="p-8 space-y-6 h-screen flex flex-col">
      {/* Header */}
      <div className="flex items-start justify-between shrink-0">
        <div>
          <h1 className="font-display font-bold text-3xl text-white tracking-tight">
            Logs <span className="text-gradient-pink-violet">ao Vivo</span>
          </h1>
          <p className="text-white/40 mt-1 text-sm">
            Mensagens em tempo real do processo de download
          </p>
        </div>
        <div className="flex items-center gap-3">
          {stats.status === "running" && (
            <span className="flex items-center gap-2 text-xs text-emerald-400 bg-emerald-500/10 px-3 py-1.5 rounded-full border border-emerald-500/20">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              Ao vivo
            </span>
          )}
          <button
            onClick={() => refetch()}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs text-white/50 bg-white/5 hover:bg-white/10 transition-all"
          >
            <Activity size={13} />
            Atualizar
          </button>
        </div>
      </div>

      {/* Filter buttons */}
      <div className="flex gap-2 shrink-0">
        {levelButtons.map((btn) => (
          <button
            key={btn.key}
            onClick={() => setLevelFilter(btn.key)}
            className={cn(
              "px-4 py-2 rounded-lg text-xs font-semibold transition-all",
              levelFilter === btn.key
                ? "bg-gradient-to-r from-pink-600/80 to-violet-600/80 text-white shadow-lg"
                : "bg-white/5 text-white/50 hover:bg-white/10 hover:text-white/80"
            )}
          >
            {btn.key !== "ALL" && levelConfig[btn.key as "INFO" | "WARNING" | "ERROR"] && (
              <span className={cn("mr-1.5", levelConfig[btn.key as "INFO" | "WARNING" | "ERROR"].textClass)}>
                ●
              </span>
            )}
            {btn.label}
          </button>
        ))}
      </div>

      {/* Log terminal */}
      <div className="flex-1 glass-card overflow-hidden flex flex-col min-h-0">
        {/* Terminal header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-white/10 shrink-0">
          <div className="flex gap-1.5">
            <span className="w-3 h-3 rounded-full bg-red-500/60" />
            <span className="w-3 h-3 rounded-full bg-yellow-500/60" />
            <span className="w-3 h-3 rounded-full bg-emerald-500/60" />
          </div>
          <span className="text-xs text-white/30 font-mono ml-2">anvisa_downloader_b2.py</span>
          <span className="ml-auto text-xs text-white/30">{logs.length} entradas</span>
          {!autoScroll && (
            <button
              onClick={() => {
                setAutoScroll(true);
                if (scrollRef.current) {
                  scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
                }
              }}
              className="text-xs text-pink-400 hover:text-pink-300 transition-colors"
            >
              ↓ Ir ao final
            </button>
          )}
        </div>

        {/* Log entries */}
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto p-4 space-y-1 font-mono text-xs"
        >
          {logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-white/20">
              <Activity size={24} className="mb-2" />
              <p>Nenhum log disponível</p>
              <p className="text-xs mt-1 opacity-60">Inicie o processo para ver os logs</p>
            </div>
          ) : (
            logs.map((log) => {
              const cfg = levelConfig[log.level as keyof typeof levelConfig];
              return (
                <div
                  key={log.id}
                  className={cn(
                    "flex items-start gap-3 px-3 py-2 rounded-lg border",
                    cfg?.bgClass ?? "bg-white/5 border-white/10"
                  )}
                >
                  {/* Timestamp */}
                  <span className="text-white/25 shrink-0 pt-0.5">
                    {new Date(log.createdAt).toLocaleTimeString("pt-BR", {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    })}
                  </span>

                  {/* Level */}
                  <span className={cn("shrink-0 flex items-center gap-1 font-bold pt-0.5", cfg?.textClass)}>
                    {cfg?.icon}
                    {log.level}
                  </span>

                  {/* Message */}
                  <span className="text-white/70 break-all leading-relaxed">{log.message}</span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
