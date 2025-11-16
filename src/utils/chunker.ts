import crypto from "crypto";

export interface Chunk {
  id: string;
  content: string;
  metadata: Record<string, any>;
}

export function chunkFileContent(
  repo: string,
  filePath: string,
  content: string,
  sha: string,           // add sha parameter
  chunkSize = 1500,
  overlap = 200
): Chunk[] {
  const chunks: Chunk[] = [];
  const contentHash = crypto.createHash("sha1").update(content, "utf8").digest("hex");

  for (let i = 0; i < content.length; i += chunkSize - overlap) {
    const chunkText = content.slice(i, i + chunkSize);
    const chunkHash = crypto.createHash("sha1").update(chunkText, "utf8").digest("hex");
    const chunkId = `${repo}:${filePath}:${sha}:chunk-${i}`;
    chunks.push({
      id: chunkId,
      content: chunkText,
      metadata: {
        repo,
        path: filePath,
        sha,             
        contentHash,     
        start: i,
        end: i + chunkSize,
        chunkHash,
      },
    });
  }

  return chunks;
}
