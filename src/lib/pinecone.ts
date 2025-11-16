import { Pinecone } from "@pinecone-database/pinecone";
import pLimit from "p-limit";

const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
export const codeIndex = pc.index("repo-code-embeddings");
const limit = pLimit(3); 

export async function upsertEmbeddings(vectors: any[]) {
  if (!vectors.length) return;

  const batchSize = 100;
  const batches = [];
  for (let i = 0; i < vectors.length; i += batchSize) {
    batches.push(vectors.slice(i, i + batchSize));
  }

  await Promise.all(
    batches.map(batch =>
      limit(async () => {
        await codeIndex.upsert(batch);
      })
    )
  );
  
}

export async function deleteEmbeddingsByPrefix(prefix: string) {
  await codeIndex.deleteMany({ filter: { repo: { $eq: prefix } } });
}

export async function deleteEmbeddingsByRepoAndSha(repo: string, sha: string) {
  if (!repo || !sha) return;
  await codeIndex.deleteMany({
    filter: {
      $and: [{ repo: { $eq: repo } }, { sha: { $eq: sha } }],
    },
  });
}

export async function getExistingVectorIds(ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();

  const batchSize = 100;
  const batches: string[][] = [];
  for (let i = 0; i < ids.length; i += batchSize) {
    batches.push(ids.slice(i, i + batchSize));
  }

  const responses = await Promise.all(
    batches.map(batch =>
      limit(async () => {
        return codeIndex.fetch(batch);
      })
    )
  );

  const existing = new Set<string>();
  responses.forEach(response => {
    const records = response.records ?? {};
    for (const id of Object.keys(records)) {
      existing.add(id);
    }
  });

  return existing;
}
