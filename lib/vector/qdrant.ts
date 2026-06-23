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

// checkCompatibility is off: the npm client floats ahead of the pinned local
// server (v1.12.4) and the REST surface we use is stable across that gap; the
// check otherwise only emits a noisy startup warning.
export const qdrant: QdrantClient =
  globalThis.__qdrant ??
  new QdrantClient({
    url,
    checkCompatibility: false,
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
