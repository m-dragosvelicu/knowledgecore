import { QdrantClient } from "@qdrant/js-client-rest";

const url = process.env.QDRANT_URL;
if (!url) {
  throw new Error("QDRANT_URL is not set");
}

const apiKey = process.env.QDRANT_API_KEY;

declare global {
  // eslint-disable-next-line no-var
  var __qdrant: QdrantClient | undefined;
}

export const qdrant: QdrantClient =
  globalThis.__qdrant ??
  new QdrantClient({
    url,
    ...(apiKey ? { apiKey } : {}),
  });

if (process.env.NODE_ENV !== "production") {
  globalThis.__qdrant = qdrant;
}

export type QdrantDistance = "Cosine" | "Euclid" | "Dot" | "Manhattan";

export async function ensureCollection(
  name: string,
  vectorSize: number,
  distance: QdrantDistance = "Cosine",
): Promise<void> {
  try {
    await qdrant.getCollection(name);
    return;
  } catch {
    await qdrant.createCollection(name, {
      vectors: { size: vectorSize, distance },
    });
  }
}
