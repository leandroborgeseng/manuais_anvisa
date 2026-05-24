import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { CheckCircle2, Loader2, Save, Settings } from "lucide-react";
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
  const updateMutation = trpc.settings.update.useMutation({
    onSuccess: () => toast.success("Configurações salvas com sucesso!"),
    onError: () => toast.error("Erro ao salvar configurações."),
  });

  const [maxFiles, setMaxFiles] = useState(100);
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
              max={1000}
              value={maxFiles}
              onChange={(e) => setMaxFiles(Number(e.target.value))}
              className="flex-1 accent-pink-500"
            />
            <span className="text-sm text-white/50 w-16 text-right">{maxFiles} arquivos</span>
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
