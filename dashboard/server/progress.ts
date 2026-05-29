import { getDownloadsStorageStats, getEquipamentosStats } from "./db";
import { getB2BucketStats, resolveB2BucketName } from "./b2Storage";
import { getSettings } from "./db";

export interface OverallProgress {
  equipamentosComManual: number;
  arquivosPdf: number;
  catalogoTotal: number;
  percentCatalogo: number;
  bytesBaixados: number;
  bytesFonte: "b2" | "db";
  totalExecucoes: number;
  mediaBytesPorArquivo: number;
  mediaArquivosPorEquipamento: number;
  projecaoBytesRestantes: number;
  projecaoBytesTotal: number;
  projecaoLabel: string;
  faltamEquipamentos: number;
}

function formatTbLabel(bytes: number): string {
  const tb = bytes / 1024 ** 4;
  if (tb >= 0.01) return `~${tb.toFixed(2)} TB`;
  const gb = bytes / 1024 ** 3;
  return `~${gb.toFixed(1)} GB`;
}

export async function getOverallProgress(): Promise<OverallProgress> {
  const stats = await getEquipamentosStats();
  const dbStorage = await getDownloadsStorageStats();
  const settings = await getSettings();
  const { bucketName } = await resolveB2BucketName(settings?.b2BucketName);
  const b2 = await getB2BucketStats(bucketName);

  const bytesBaixados =
    b2.ok && b2.totalBytes > 0 ? b2.totalBytes : dbStorage.totalBytes;
  const bytesFonte: "b2" | "db" =
    b2.ok && b2.totalBytes > 0 ? "b2" : "db";

  const equipamentosComManual = stats.equipamentosUnicos;
  const arquivosPdf = stats.totalArquivos;
  const catalogoTotal = stats.catalogTotal;
  const faltamEquipamentos = Math.max(0, catalogoTotal - equipamentosComManual);

  const mediaBytesPorArquivo =
    arquivosPdf > 0 ? bytesBaixados / arquivosPdf : 3_500_000;
  const mediaArquivosPorEquipamento =
    equipamentosComManual > 0 ? arquivosPdf / equipamentosComManual : 1.5;

  const projecaoBytesRestantes =
    faltamEquipamentos * mediaArquivosPorEquipamento * mediaBytesPorArquivo;
  const projecaoBytesTotal = bytesBaixados + projecaoBytesRestantes;

  return {
    equipamentosComManual,
    arquivosPdf,
    catalogoTotal,
    percentCatalogo: stats.percentCatalog,
    bytesBaixados,
    bytesFonte,
    totalExecucoes: stats.totalExecucoes,
    mediaBytesPorArquivo,
    mediaArquivosPorEquipamento,
    projecaoBytesRestantes,
    projecaoBytesTotal,
    projecaoLabel: formatTbLabel(projecaoBytesTotal),
    faltamEquipamentos,
  };
}
