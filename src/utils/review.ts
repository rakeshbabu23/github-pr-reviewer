import { GoogleGenAI } from "@google/genai";
import pLimit from "p-limit";
import type { Chunk } from "./chunker.js";
import { getEmbedding } from "./embed.js";
import { codeIndex } from "../lib/pinecone.js";

const ai = new GoogleGenAI({});
const limit = pLimit(5);

export interface ReviewFile {
  path: string;
  chunks: Chunk[];
}

interface ReviewContextMatch {
  id: string;
  score: number;
  metadata: Record<string, any>;
}

interface EnrichedChunk {
  chunk: Chunk;
  matches: ReviewContextMatch[];
}

interface ReviewRequest {
  repoSlug: string;
  prNumber: number;
  headSha: string;
  baseSha: string;
  files: ReviewFile[];
}

async function retrieveContext(
  repoSlug: string,
  chunks: Chunk[]
): Promise<EnrichedChunk[]> {
  const enriched: EnrichedChunk[] = [];

  const results = await Promise.all(
    chunks.map(chunk =>
      limit(async () => {
        const embedding = await getEmbedding(chunk.content);
        if (!embedding) {
          return { chunk, matches: [] };
        }

        const response = await codeIndex.query({
          topK: 5,
          vector: embedding,
          filter: { repo: { $eq: repoSlug } },
        });

        const matches: ReviewContextMatch[] = (response.matches ?? []).map(match => ({
          id: match.id ?? "",
          score: match.score ?? 0,
          metadata: match.metadata ?? {},
        }));

        return { chunk, matches };
      })
    )
  );

  for (const result of results) {
    if (result) {
      enriched.push(result);
    }
  }

  return enriched;
}

function buildPrompt(request: ReviewRequest, enriched: EnrichedChunk[]): string {
  const header = [
    "You are a meticulous senior code reviewer.",
    "Task: Identify issues, regressions, gaps in documentation/tests, or risky changes.",
    "Context: Compare the PR chunks with retrieved base-branch embeddings. Mention references when useful.",
    "",
    `Repository: ${request.repoSlug}`,
    `PR Number: ${request.prNumber}`,
    `Head SHA (PR): ${request.headSha}`,
    `Base SHA: ${request.baseSha}`,
    "",
  ].join("\n");

  const sections = enriched.map((entry, idx) => {
    const filename = entry.chunk.metadata.path ?? "unknown";
    const chunkHeader = `---\nFile: ${filename} | Chunk ${idx}`;
    const chunkContent = `PR Chunk:\n${entry.chunk.content}`;

    const contextParts =
      entry.matches.length > 0
        ? entry.matches
            .map(match => {
              const metaRepo = match.metadata.repo ?? "unknown-repo";
              const metaPath = match.metadata.path ?? "unknown-path";
              const metaSha = match.metadata.sha ?? "unknown-sha";
              return `Context (score ${match.score.toFixed(3)}): ${metaRepo} ${metaPath} @ ${metaSha}`;
            })
            .join("\n")
        : "Context: No relevant base embeddings found.";

    return [chunkHeader, chunkContent, contextParts].join("\n");
  });

  const instructions = [
    "",
    "For each issue you find, respond with concise bullet points:",
    "- What is the concern?",
    "- Which file/chunk or code snippet does it refer to?",
    "- Suggested fix or follow-up.",
    "",
    "If you have no concerns, clearly state that the PR looks good.",
  ].join("\n");

  return [header, ...sections, instructions].join("\n");
}

export async function generateReview(request: ReviewRequest): Promise<string> {
  const allChunks = request.files.flatMap(file => file.chunks);
  if (!allChunks.length) {
    return "No PR code chunks were available for review.";
  }

  const enriched = await retrieveContext(request.repoSlug, allChunks);
  const prompt = buildPrompt(request, enriched);

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        temperature: 0.2,
      },
    });

    return response.text ?? "Automated review was unable to generate comments.";
  } catch (error: any) {
    return "Automated review failed to run.";
  }
}

