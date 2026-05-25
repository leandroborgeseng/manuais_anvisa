import { useEffect, useRef, useState } from "react";

export interface EquipamentoInfo {
  processo?: string;
  numeroRegistro?: string;
  nomeProduto?: string;
  nomeTecnico?: string;
  situacao?: string;
  razaoSocial?: string;
  cnpjEmpresa?: string;
  riscoDescricao?: string;
  vencimentoDescricao?: string;
  dataInicioVigencia?: string;
  dataVencimento?: string;
  dataCancelamento?: string;
  tipoAnexo?: string;
}

export interface DownloadItem {
  id: number;
  filename: string;
  url: string;
  status: "aguardando" | "baixando" | "enviando para B2" | "concluído" | "erro";
  progress: number;
  sizeBytes: number;
  errorMessage?: string;
  b2Key?: string;
  equipamento?: EquipamentoInfo;
}

export interface DashboardStats {
  status: "idle" | "running" | "paused" | "stopped" | "completed" | "error";
  executionId: number | null;
  totalFound: number;
  totalCompleted: number;
  totalErrors: number;
  percentComplete: number;
  currentSpeed: number;
  b2SpaceUsed: number;
  downloads: DownloadItem[];
}

const DEFAULT_STATS: DashboardStats = {
  status: "idle",
  executionId: null,
  totalFound: 0,
  totalCompleted: 0,
  totalErrors: 0,
  percentComplete: 0,
  currentSpeed: 0,
  b2SpaceUsed: 0,
  downloads: [],
};

export function useSSE() {
  const [stats, setStats] = useState<DashboardStats>(DEFAULT_STATS);
  const [connected, setConnected] = useState(false);
  const esRef = useRef<EventSource | null>(null);
  const retryRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    let active = true;

    const connect = () => {
      if (!active) return;
      const es = new EventSource("/api/sse/updates");
      esRef.current = es;

      es.onopen = () => {
        if (active) setConnected(true);
      };

      es.onmessage = (e) => {
        if (!active) return;
        try {
          const data = JSON.parse(e.data) as DashboardStats;
          setStats(data);
        } catch {
          // ignore parse errors
        }
      };

      es.onerror = () => {
        es.close();
        if (active) {
          setConnected(false);
          retryRef.current = setTimeout(connect, 3000);
        }
      };
    };

    connect();

    return () => {
      active = false;
      esRef.current?.close();
      if (retryRef.current) clearTimeout(retryRef.current);
    };
  }, []);

  return { stats, connected };
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export function formatSpeed(bytesPerSec: number): string {
  return `${formatBytes(bytesPerSec)}/s`;
}
