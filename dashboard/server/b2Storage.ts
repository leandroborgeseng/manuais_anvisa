import { ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";

export interface B2BucketStats {
  configured: boolean;
  totalBytes: number;
  fileCount: number;
  prefix: string;
  bucketName: string;
  scannedAt: Date;
  error?: string;
}

let cache: { stats: B2BucketStats; expiresAt: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

function getS3Client(region: string): S3Client | null {
  const accessKeyId = process.env.B2_APPLICATION_KEY_ID;
  const secretAccessKey = process.env.B2_APPLICATION_KEY;
  if (!accessKeyId || !secretAccessKey) return null;

  const endpoint =
    process.env.B2_S3_ENDPOINT?.replace(/\/$/, "") ??
    `https://s3.${region}.backblazeb2.com`;

  return new S3Client({
    endpoint,
    region,
    credentials: { accessKeyId, secretAccessKey },
  });
}

export async function getB2BucketStats(
  bucketName: string,
  prefix = "manuais/"
): Promise<B2BucketStats> {
  const now = Date.now();
  if (cache && cache.expiresAt > now && cache.stats.bucketName === bucketName) {
    return cache.stats;
  }

  const region = process.env.B2_S3_REGION ?? "us-west-004";
  const client = getS3Client(region);

  if (!client || !bucketName) {
    const stats: B2BucketStats = {
      configured: false,
      totalBytes: 0,
      fileCount: 0,
      prefix,
      bucketName: bucketName || "",
      scannedAt: new Date(),
    };
    return stats;
  }

  try {
    let totalBytes = 0;
    let fileCount = 0;
    let continuationToken: string | undefined;

    do {
      const response = await client.send(
        new ListObjectsV2Command({
          Bucket: bucketName,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        })
      );

      for (const obj of response.Contents ?? []) {
        fileCount += 1;
        totalBytes += obj.Size ?? 0;
      }

      continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
    } while (continuationToken);

    const stats: B2BucketStats = {
      configured: true,
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
    return {
      configured: true,
      totalBytes: 0,
      fileCount: 0,
      prefix,
      bucketName,
      scannedAt: new Date(),
      error: message,
    };
  }
}

export function clearB2StorageCache() {
  cache = null;
}
