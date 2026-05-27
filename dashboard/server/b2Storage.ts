/**
 * Estatísticas do bucket via API nativa B2 (b2_authorize_account + b2_list_file_names).
 * Mais confiável que S3 compatível quando B2_S3_REGION não está configurada.
 */

export interface B2BucketStats {
  configured: boolean;
  ok: boolean;
  totalBytes: number;
  fileCount: number;
  prefix: string;
  bucketName: string;
  scannedAt: Date;
  error?: string;
}

let cache: { stats: B2BucketStats; expiresAt: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

function trimEnv(value: string | undefined): string | undefined {
  const v = value?.trim();
  return v || undefined;
}

function basicAuthHeader(keyId: string, appKey: string): string {
  return `Basic ${Buffer.from(`${keyId}:${appKey}`).toString("base64")}`;
}

interface B2AuthorizeResponse {
  accountId: string;
  apiUrl: string;
  authorizationToken: string;
  allowed?: {
    bucketId?: string;
    bucketName?: string;
    namePrefix?: string | null;
  };
}

interface B2Bucket {
  bucketId: string;
  bucketName: string;
}

interface B2ListFilesResponse {
  files: Array<{ fileName: string; contentLength: number }>;
  nextFileName: string | null;
}

async function b2Authorize(keyId: string, appKey: string): Promise<B2AuthorizeResponse> {
  const res = await fetch("https://api.backblazeb2.com/b2api/v2/b2_authorize_account", {
    headers: { Authorization: basicAuthHeader(keyId, appKey) },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `Falha ao autorizar B2 (${res.status}): ${body.slice(0, 200) || res.statusText}`
    );
  }
  return (await res.json()) as B2AuthorizeResponse;
}

async function b2ListBuckets(
  apiUrl: string,
  authToken: string,
  accountId: string
): Promise<B2Bucket[]> {
  const res = await fetch(`${apiUrl}/b2api/v2/b2_list_buckets`, {
    method: "POST",
    headers: {
      Authorization: authToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ accountId }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Falha ao listar buckets (${res.status}): ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as { buckets: B2Bucket[] };
  return data.buckets ?? [];
}

async function resolveBucketId(
  auth: B2AuthorizeResponse,
  bucketName: string
): Promise<string> {
  if (auth.allowed?.bucketId) {
    if (!auth.allowed.bucketName || auth.allowed.bucketName === bucketName) {
      return auth.allowed.bucketId;
    }
    throw new Error(
      `A chave B2 só tem acesso ao bucket "${auth.allowed.bucketName}", mas o sistema está configurado para "${bucketName}".`
    );
  }

  const buckets = await b2ListBuckets(auth.apiUrl, auth.authorizationToken, auth.accountId);
  const match = buckets.find((b) => b.bucketName === bucketName);
  if (!match) {
    throw new Error(
      `Bucket "${bucketName}" não encontrado. Buckets disponíveis: ${buckets.map((b) => b.bucketName).join(", ") || "(nenhum)"}`
    );
  }
  return match.bucketId;
}

/** Escolhe o bucket correto: chave restrita → env → settings → primeiro disponível. */
export async function resolveB2BucketName(preferred?: string): Promise<{
  bucketName: string;
  availableBuckets: string[];
  source: "key" | "env" | "settings" | "fallback";
}> {
  const keyId = trimEnv(process.env.B2_APPLICATION_KEY_ID);
  const appKey = trimEnv(process.env.B2_APPLICATION_KEY);
  const envName = trimEnv(process.env.B2_BUCKET_NAME);
  const preferredName = trimEnv(preferred);

  if (!keyId || !appKey) {
    const fallback = envName ?? preferredName ?? "";
    return { bucketName: fallback, availableBuckets: [], source: "env" };
  }

  const auth = await b2Authorize(keyId, appKey);

  if (auth.allowed?.bucketName) {
    return {
      bucketName: auth.allowed.bucketName,
      availableBuckets: [auth.allowed.bucketName],
      source: "key",
    };
  }

  const buckets = await b2ListBuckets(auth.apiUrl, auth.authorizationToken, auth.accountId);
  const names = buckets.map((b) => b.bucketName);

  const tryOrder: Array<{ name: string; source: "env" | "settings" }> = [];
  if (envName) tryOrder.push({ name: envName, source: "env" });
  if (preferredName && preferredName !== envName) {
    tryOrder.push({ name: preferredName, source: "settings" });
  }

  for (const { name, source } of tryOrder) {
    if (names.includes(name)) {
      return { bucketName: name, availableBuckets: names, source };
    }
  }

  if (names[0]) {
    return { bucketName: names[0], availableBuckets: names, source: "fallback" };
  }

  return {
    bucketName: preferredName ?? envName ?? "",
    availableBuckets: names,
    source: "fallback",
  };
}

async function b2ListAllFiles(
  apiUrl: string,
  authToken: string,
  bucketId: string,
  prefix: string
): Promise<{ totalBytes: number; fileCount: number }> {
  let totalBytes = 0;
  let fileCount = 0;
  let startFileName: string | undefined;

  for (;;) {
    const body: Record<string, unknown> = {
      bucketId,
      prefix,
      maxFileCount: 1000,
    };
    if (startFileName) body.startFileName = startFileName;

    const res = await fetch(`${apiUrl}/b2api/v2/b2_list_file_names`, {
      method: "POST",
      headers: {
        Authorization: authToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Falha ao listar arquivos (${res.status}): ${text.slice(0, 200)}`);
    }

    const data = (await res.json()) as B2ListFilesResponse;
    for (const file of data.files ?? []) {
      fileCount += 1;
      totalBytes += file.contentLength ?? 0;
    }

    if (!data.nextFileName) break;
    startFileName = data.nextFileName;
  }

  return { totalBytes, fileCount };
}

export async function getB2BucketStats(
  preferredBucket?: string,
  prefix = "manuais/"
): Promise<B2BucketStats> {
  const { bucketName } = await resolveB2BucketName(preferredBucket);
  const now = Date.now();
  if (cache && cache.expiresAt > now && cache.stats.bucketName === bucketName && cache.stats.ok) {
    return cache.stats;
  }

  const keyId = trimEnv(process.env.B2_APPLICATION_KEY_ID);
  const appKey = trimEnv(process.env.B2_APPLICATION_KEY);

  if (!keyId || !appKey || !bucketName) {
    return {
      configured: false,
      ok: false,
      totalBytes: 0,
      fileCount: 0,
      prefix,
      bucketName: bucketName || "",
      scannedAt: new Date(),
      error: !bucketName ? "Nome do bucket não configurado." : undefined,
    };
  }

  try {
    const auth = await b2Authorize(keyId, appKey);
    const bucketId = await resolveBucketId(auth, bucketName);
    const { totalBytes, fileCount } = await b2ListAllFiles(
      auth.apiUrl,
      auth.authorizationToken,
      bucketId,
      prefix
    );

    const stats: B2BucketStats = {
      configured: true,
      ok: true,
      totalBytes,
      fileCount,
      prefix,
      bucketName,
      scannedAt: new Date(),
    };

    cache = { stats, expiresAt: now + CACHE_TTL_MS };
    return stats;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[B2 Storage] Falha ao listar bucket:", message);

    const hint =
      message.includes("not valid") || message.includes("unauthorized")
        ? " Verifique B2_APPLICATION_KEY_ID e B2_APPLICATION_KEY no Railway."
        : "";

    return {
      configured: true,
      ok: false,
      totalBytes: 0,
      fileCount: 0,
      prefix,
      bucketName,
      scannedAt: new Date(),
      error: message + hint,
    };
  }
}

export function clearB2StorageCache() {
  cache = null;
}
