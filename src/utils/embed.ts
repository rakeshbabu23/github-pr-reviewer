import OpenAI from "openai";
import pLimit from "p-limit";
import type { Chunk } from "./chunker.js";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
const limit = pLimit(5); 
export async function getEmbedding(text: string) {
  const res = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text
  });
  return res.data?.[0]?.embedding || null;
}

export async function embedChunks(chunks: Chunk[]) {
  const uniqueChunks = Array.from(
    chunks.reduce<Map<string, Chunk>>((acc, chunk) => {
      if (!acc.has(chunk.id)) acc.set(chunk.id, chunk);
      return acc;
    }, new Map()).values()
  );

  if (!uniqueChunks.length) {
    return [];
  }

  const tasks = uniqueChunks.map(chunk =>
    limit(async () => {
      const vector = await getEmbedding(chunk.content);
      if (!vector) return null;
      return { id: chunk.id, values: vector, metadata: chunk.metadata };
    })
  );

  const results = await Promise.all(tasks);
  return results.filter(Boolean);
}
