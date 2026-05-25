import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { useSSE } from "@/hooks/useSSE";
import { Calendar, FileText, Hash, Loader2, Search, Shield } from "lucide-react";
import { useMemo, useState } from "react";

function formatDate(value?: Date | string | null) {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-BR");
}

type EquipamentoRow = NonNullable<
  ReturnType<typeof trpc.equipamentos.list.useQuery>["data"]
>[number];

type EquipamentoGroup = EquipamentoRow & {
  arquivos: Array<{ id: number; nomeArquivo?: string | null; tipoAnexo?: string | null; pdfUrl?: string | null }>;
};

function groupEquipamentos(items: EquipamentoRow[]): EquipamentoGroup[] {
  const map = new Map<string, EquipamentoGroup>();

  for (const eq of items) {
    const key = `${eq.processo}:${eq.executionId ?? "all"}`;
    const existing = map.get(key);
    const arquivo = {
      id: eq.id,
      nomeArquivo: eq.nomeArquivo,
      tipoAnexo: eq.tipoAnexo,
      pdfUrl: eq.pdfUrl,
    };

    if (!existing) {
      map.set(key, { ...eq, arquivos: eq.nomeArquivo ? [arquivo] : [] });
      continue;
    }

    if (eq.nomeArquivo && !existing.arquivos.some((a) => a.nomeArquivo === eq.nomeArquivo)) {
      existing.arquivos.push(arquivo);
    }
  }

  return Array.from(map.values());
}

export default function Equipamentos() {
  const { stats } = useSSE();
  const [search, setSearch] = useState("");
  const { data, isLoading } = trpc.equipamentos.list.useQuery(
    {
      executionId: stats.status === "running" ? stats.executionId ?? undefined : undefined,
      limit: 500,
    },
    {
      refetchInterval: stats.status === "running" ? 3000 : false,
    }
  );

  const grouped = useMemo(() => groupEquipamentos(data ?? []), [data]);

  const filtered = grouped.filter((eq) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      eq.nomeProduto?.toLowerCase().includes(q) ||
      eq.numeroRegistro?.toLowerCase().includes(q) ||
      eq.processo?.includes(q) ||
      eq.razaoSocial?.toLowerCase().includes(q) ||
      eq.nomeTecnico?.toLowerCase().includes(q) ||
      eq.arquivos.some((a) => a.nomeArquivo?.toLowerCase().includes(q))
    );
  });

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="font-display font-bold text-3xl text-white tracking-tight">
          Equipamentos <span className="text-gradient-pink-violet">ANVISA</span>
        </h1>
        <p className="text-white/40 mt-1 text-sm">
          Registro, validade, empresa e todos os arquivos PDF vinculados a cada equipamento
        </p>
      </div>

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
          Carregando equipamentos...
        </div>
      ) : filtered.length === 0 ? (
        <div className="glass-card p-12 text-center text-white/30">
          <FileText size={40} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">Nenhum equipamento registrado ainda</p>
          <p className="text-xs mt-1 opacity-60">Inicie um download para coletar metadados da ANVISA</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {filtered.map((eq) => (
            <div key={`${eq.processo}-${eq.executionId ?? eq.id}`} className="glass-card p-5 space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-white font-semibold text-lg">{eq.nomeProduto ?? "—"}</h2>
                  <p className="text-white/40 text-sm">{eq.nomeTecnico}</p>
                </div>
                <div className="flex items-center gap-2">
                  {eq.arquivos.length > 1 && (
                    <span className="px-3 py-1 rounded-full text-xs font-semibold bg-pink-500/20 text-pink-200">
                      {eq.arquivos.length} arquivos
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
                <MetaItem icon={<Calendar size={14} />} label="Validade" value={eq.vencimentoDescricao} />
                <MetaItem icon={<Calendar size={14} />} label="Início vigência" value={formatDate(eq.dataInicioVigencia)} />
                <MetaItem icon={<Calendar size={14} />} label="Vencimento" value={formatDate(eq.dataVencimento)} />
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
                        <span className="text-xs text-white/80 font-mono truncate" title={arquivo.nomeArquivo ?? undefined}>
                          {arquivo.nomeArquivo}
                        </span>
                        {arquivo.tipoAnexo && (
                          <span className="text-xs text-white/35 shrink-0">{arquivo.tipoAnexo}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
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
