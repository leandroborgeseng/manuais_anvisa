import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { formatBytes } from "@/hooks/useSSE";
import { CheckCircle2, HardDrive, Loader2, RefreshCw, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

function FieldGroup({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="glass-card p-5 space-y-3">
      <div>
        <label className="text-sm font-semibold text-white">{label}</label>
        {description && <p className="text-xs text-white/40 mt-0.5">{description}</p>}
      </div>
      {children}
    </div>
  );
}

export default function SettingsPage() {
  const { data: settings, isLoading } = trpc.settings.get.useQuery();
  const {
    data: storageStats,
    isLoading: storageLoading,
    refetch: refetchStorage,
    isFetching: storageFetching,
  } = trpc.storage.stats.useQuery(undefined, { refetchInterval: 60_000, retry: 1 });
  const updateMutation = trpc.settings.update.useMutation({
    onSuccess: () => toast.success("Configurações salvas com sucesso!"),
    onError: () => toast.error("Erro ao salvar configurações."),
  });

  const [maxFiles, setMaxFiles] = useState(10000);
  const [maxWorkers, setMaxWorkers] = useState(4);
  const [cronExpression, setCronExpression] = useState("0 2 1 * *");
  const [b2BucketName, setB2BucketName] = useState("anvisa-manuais");

  useEffect(() => {
    if (settings) {
      setMaxFiles(settings.maxFiles);
      setMaxWorkers(settings.maxWorkers);
      setCronExpression(settings.cronExpression);
      setB2BucketName(settings.b2BucketName);
    }
  }, [settings]);

  const handleSave = () => {
    updateMutation.mutate({ maxFiles, maxWorkers, cronExpression, b2BucketName });
  };

  // Cron expression presets
  const cronPresets = [
    { label: "Todo dia 1º do mês", value: "0 2 1 * *" },
    { label: "Toda semana (Domingo)", value: "0 2 * * 0" },
    { label: "Todo dia (2h)", value: "0 2 * * *" },
    { label: "A cada 12 horas", value: "0 */12 * * *" },
  ];

  if (isLoading) {
    return (
      <div className="p-8 flex items-center justify-center h-64">
        <Loader2 size={24} className="animate-spin text-pink-400" />
      </div>
    );
  }

  return (
    <div className="p-8 space-y-6 max-w-2xl">
      {/* Header */}
      <div>
        <h1 className="font-display font-bold text-3xl text-white tracking-tight">
          <span className="text-gradient-pink-violet">Configurações</span>
        </h1>
        <p className="text-white/40 mt-1 text-sm">
          Parâmetros do processo de download e agendamento
        </p>
      </div>

      {/* Download settings */}
      <div className="space-y-4">
        <h2 className="text-xs text-white/30 uppercase tracking-widest font-semibold">
          Parâmetros de Download
        </h2>

        <FieldGroup
          label="Máximo de Arquivos (MAX_FILES)"
          description="Número máximo de manuais a baixar por execução"
        >
          <div className="flex items-center gap-4">
            <input
              type="number"
              min={1}
              max={10000}
              value={maxFiles}
              onChange={(e) => setMaxFiles(Number(e.target.value))}
              className="glass-card px-4 py-2.5 text-sm text-white w-32 outline-none border-white/10 focus:border-pink-500/50 transition-colors"
            />
            <input
              type="range"
              min={1}
              max={10000}
              value={Math.min(maxFiles, 10000)}
              onChange={(e) => setMaxFiles(Number(e.target.value))}
              className="flex-1 accent-pink-500"
            />
            <span className="text-sm text-white/50 w-20 text-right">{maxFiles.toLocaleString()} arquivos</span>
          </div>
          <div className="flex flex-wrap gap-2 mt-2">
            {[100, 500, 1000, 5000, 10000].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setMaxFiles(n)}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-medium transition-all",
                  maxFiles === n
                    ? "bg-pink-500/30 text-pink-300 border border-pink-500/40"
                    : "bg-white/5 text-white/40 hover:bg-white/10 hover:text-white/70"
                )}
              >
                {n.toLocaleString()}
              </button>
            ))}
          </div>
        </FieldGroup>

        <FieldGroup
          label="Workers Paralelos"
          description="Número de downloads simultâneos (mais workers = mais velocidade, mais consumo de rede)"
        >
          <div className="flex items-center gap-4">
            <input
              type="number"
              min={1}
              max={32}
              value={maxWorkers}
              onChange={(e) => setMaxWorkers(Number(e.target.value))}
              className="glass-card px-4 py-2.5 text-sm text-white w-20 outline-none border-white/10 focus:border-pink-500/50 transition-colors"
            />
            <div className="flex gap-2">
              {[1, 2, 4, 8, 16].map((n) => (
                <button
                  key={n}
                  onClick={() => setMaxWorkers(n)}
                  className={cn(
                    "w-10 h-10 rounded-lg text-sm font-semibold transition-all",
                    maxWorkers === n
                      ? "bg-gradient-to-br from-blue-600 to-indigo-600 text-white shadow-lg"
                      : "bg-white/5 text-white/50 hover:bg-white/10"
                  )}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        </FieldGroup>
      </div>

      {/* Storage settings */}
      <div className="space-y-4">
        <h2 className="text-xs text-white/30 uppercase tracking-widest font-semibold">
          Armazenamento Backblaze B2
        </h2>

        <FieldGroup
          label="Nome do Bucket B2"
          description="Nome do bucket no Backblaze B2 onde os manuais serão armazenados"
        >
          <input
            type="text"
            value={b2BucketName}
            onChange={(e) => setB2BucketName(e.target.value)}
            placeholder="anvisa-manuais"
            className="glass-card px-4 py-2.5 text-sm text-white w-full outline-none border-white/10 focus:border-pink-500/50 transition-colors"
          />
        </FieldGroup>

        <FieldGroup
          label="Uso de Armazenamento"
          description="Espaço ocupado no bucket Backblaze B2 (compatível com API S3)"
        >
          {storageLoading ? (
            <div className="flex items-center gap-2 text-white/40 text-sm">
              <Loader2 size={14} className="animate-spin" />
              Consultando bucket…
            </div>
          ) : storageStats ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <HardDrive size={20} className="text-blue-400 shrink-0" />
                  <div>
                    <div className="font-display font-bold text-2xl text-white">
                      {formatBytes(storageStats.b2?.totalBytes || storageStats.db?.totalBytes || 0)}
                    </div>
                    <div className="text-xs text-white/40 mt-0.5">
                      {(storageStats.b2?.fileCount || storageStats.db?.fileCount || 0).toLocaleString()} arquivo(s)
                      {storageStats.b2?.configured
                        ? " no bucket"
                        : " registrados no banco"}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => refetchStorage()}
                  disabled={storageFetching}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-white/50 bg-white/5 hover:bg-white/10 transition-colors disabled:opacity-50"
                >
                  <RefreshCw size={12} className={storageFetching ? "animate-spin" : ""} />
                  Atualizar
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="glass-card p-3 bg-white/5">
                  <div className="text-white/40">Bucket B2</div>
                  <div className="text-white font-semibold mt-1">
                    {storageStats.b2?.configured
                      ? formatBytes(storageStats.b2.totalBytes)
                      : "Não configurado"}
                  </div>
                  <div className="text-white/30 mt-0.5">{storageStats.bucketName}</div>
                </div>
                <div className="glass-card p-3 bg-white/5">
                  <div className="text-white/40">Registros concluídos</div>
                  <div className="text-white font-semibold mt-1">
                    {formatBytes(storageStats.db?.totalBytes ?? 0)}
                  </div>
                  <div className="text-white/30 mt-0.5">
                    {(storageStats.db?.fileCount ?? 0).toLocaleString()} download(s)
                  </div>
                </div>
              </div>
              {storageStats.b2?.error && (
                <p className="text-xs text-yellow-400/80">
                  Não foi possível listar o bucket: {storageStats.b2.error}. Verifique B2_S3_REGION
                  (padrão us-west-004).
                </p>
              )}
            </div>
          ) : null}
        </FieldGroup>
      </div>

      {/* Scheduling */}
      <div className="space-y-4">
        <h2 className="text-xs text-white/30 uppercase tracking-widest font-semibold">
          Agendamento (Cron)
        </h2>

        <FieldGroup
          label="Expressão Cron"
          description="Define quando o processo será executado automaticamente no Railway"
        >
          <input
            type="text"
            value={cronExpression}
            onChange={(e) => setCronExpression(e.target.value)}
            placeholder="0 2 1 * *"
            className="glass-card px-4 py-2.5 text-sm text-white font-mono w-full outline-none border-white/10 focus:border-pink-500/50 transition-colors"
          />
          <div className="flex flex-wrap gap-2 mt-2">
            {cronPresets.map((preset) => (
              <button
                key={preset.value}
                onClick={() => setCronExpression(preset.value)}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-medium transition-all",
                  cronExpression === preset.value
                    ? "bg-blue-500/30 text-blue-300 border border-blue-500/40"
                    : "bg-white/5 text-white/40 hover:bg-white/10 hover:text-white/70"
                )}
              >
                {preset.label}
                <span className="ml-1.5 font-mono opacity-60">{preset.value}</span>
              </button>
            ))}
          </div>
          <div className="glass-card p-3 mt-2 bg-white/5">
            <p className="text-xs text-white/40 font-mono">
              <span className="text-white/60">Formato:</span> minuto hora dia-do-mês mês dia-da-semana
            </p>
            <p className="text-xs text-white/30 mt-1">
              Exemplo: <span className="font-mono text-violet-300">0 2 1 * *</span> = Todo dia 1º do mês às 02:00
            </p>
          </div>
        </FieldGroup>
      </div>

      {/* Save button */}
      <div className="flex items-center gap-4 pt-2">
        <button
          onClick={handleSave}
          disabled={updateMutation.isPending}
          className={cn(
            "flex items-center gap-2 px-8 py-3 rounded-xl font-semibold text-sm transition-all duration-200",
            "bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg",
            "hover:from-blue-500 hover:to-indigo-500 hover:shadow-blue-500/30 hover:shadow-xl",
            "disabled:opacity-50 disabled:cursor-not-allowed"
          )}
        >
          {updateMutation.isPending ? (
            <Loader2 size={16} className="animate-spin" />
          ) : updateMutation.isSuccess ? (
            <CheckCircle2 size={16} />
          ) : (
            <Save size={16} />
          )}
          Salvar Configurações
        </button>
        {updateMutation.isSuccess && (
          <span className="text-sm text-emerald-400 flex items-center gap-1.5">
            <CheckCircle2 size={14} />
            Salvo!
          </span>
        )}
      </div>
    </div>
  );
}
