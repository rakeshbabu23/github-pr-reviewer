import pLimit from "p-limit";
import { githubApp } from "../lib/githubApp.js";
import { extractAllImports } from "../utils/fileExtractor.js";
import { chunkFileContent } from "../utils/chunker.js";
import type { Chunk } from "../utils/chunker.js";
import { embedChunks } from "../utils/embed.js";
import {
  upsertEmbeddings,
  getExistingVectorIds,
  deleteEmbeddingsByRepoAndSha,
} from "../lib/pinecone.js";
import { getLastEmbeddedSha, setLastEmbeddedSha } from "../helpers/embeddingState.js";
import { generateReview, type ReviewFile } from "../utils/review.js";

export interface ExtractedFile {
  fileName: string;
  content: string;
}

export interface PullRequestWebhookPayload {
  action?: string;
  installation?: {
    id?: number;
    account?: { login?: string | null } | null;
  };
  repository?: {
    name?: string;
    owner?: { login?: string };
    full_name?: string;
  };
  pull_request?: {
    number?: number;
    merged?: boolean;
    merge_commit_sha?: string | null;
    head?: { sha?: string };
    base?: { sha?: string; ref?: string };
  };
}

const PR_EMBED_ACTIONS = new Set(["opened", "synchronize", "reopened", "ready_for_review"]);

const collectUniqueChunks = (chunks: Chunk[]): Chunk[] => {
  return Array.from(
    chunks.reduce<Map<string, Chunk>>((acc, chunk) => {
      if (!acc.has(chunk.id)) acc.set(chunk.id, chunk);
      return acc;
    }, new Map()).values()
  );
};

const embedChunksIfMissing = async (chunks: Chunk[]): Promise<number> => {
  const uniqueChunks = collectUniqueChunks(chunks);
  if (!uniqueChunks.length) return 0;

  const existingIds = await getExistingVectorIds(uniqueChunks.map(chunk => chunk.id));
  const pending = uniqueChunks.filter(chunk => !existingIds.has(chunk.id));

  if (!pending.length) {
    return 0;
  }

  const embeddings = await embedChunks(pending);
  if (!embeddings.length) {
    return 0;
  }
  await upsertEmbeddings(embeddings);
  return embeddings.length;
};

const fetchFilesAtRef = async (
  octokit: any,
  owner: string,
  repo: string,
  files: Array<{ filename?: string | null; status?: string | null }>,
  ref: string,
  limit: ReturnType<typeof pLimit>
): Promise<ExtractedFile[]> => {
  const extractedFilesAndContents: ExtractedFile[] = (
    await Promise.all(
      files.map(file =>
        limit(async () => {
          if (!file.filename || file.status === "removed") {
            return null;
          }
          try {
            const res = await octokit.request("GET /repos/{owner}/{repo}/contents/{path}", {
              owner,
              repo,
              path: file.filename,
              ref,
            });
            const data = res.data;
            if (!Array.isArray(data) && data.type === "file" && data.content) {
              const content = Buffer.from(data.content, "base64").toString("utf8");
              return { fileName: file.filename, content };
            }
            
            return null;
          } catch (err: any) {
            if (err?.status === 404) {
              return null;
            }
            return null;
          }
        })
      )
    )
  ).filter(Boolean) as ExtractedFile[];

  return extractedFilesAndContents;
};

const processPullRequestForBase = async ({
  payload,
  octokit,
  owner,
  repo,
  repoSlug,
  prNumber,
  baseSha,
  headSha,
}: {
  payload: PullRequestWebhookPayload;
  octokit: any;
  owner: string;
  repo: string;
  repoSlug: string;
  prNumber: number;
  baseSha: string;
  headSha: string;
}): Promise<void> => {
  const limit = pLimit(5);

  const files = await octokit.request("GET /repos/{owner}/{repo}/pulls/{pull_number}/files", {
    owner,
    repo,
    pull_number: prNumber,
  });

  const prFiles = await fetchFilesAtRef(octokit, owner, repo, files.data, headSha, limit);
  const processedPaths = new Set(prFiles.map(file => file.fileName));

  const imports = prFiles.length ? extractAllImports(prFiles) : [];

  const { data } = await octokit.request("GET /repos/{owner}/{repo}/git/trees/{tree_sha}", {
    owner,
    repo,
    tree_sha: baseSha,
    recursive: "1",
  });
  
  const importedFilesBlobs = data.tree.filter((i: { type: string }) => i.type === "blob");
  const blobMap = new Map<string, { path: string; sha: string }>();
  importedFilesBlobs.forEach((i: any) => blobMap.set(i.path, { path: i.path, sha: i.sha }));
  
  const dependencyFiles = new Map<string, { path: string; sha: string }>();

  imports.forEach((imp) => {
    const normalizedImport = imp.to.replace(/\\/g, "/");
    const candidates = new Set<string>([normalizedImport]);
    const hasExtension = /\.[^/]+$/.test(normalizedImport);
    if (!hasExtension) {
      [".js", ".ts", ".jsx", ".tsx"].forEach(ext => candidates.add(`${normalizedImport}${ext}`));
      ["/index.js", "/index.ts", "/index.jsx", "/index.tsx"].forEach(indexPath =>
        candidates.add(`${normalizedImport}${indexPath}`)
      );
    }

    candidates.forEach(candidate => {
      const fileInfo = blobMap.get(candidate);
      if (fileInfo && !processedPaths.has(fileInfo.path)) {
        dependencyFiles.set(fileInfo.path, fileInfo);
      }
    });
  });

  const contentRequiredFiles = Array.from(dependencyFiles.values());

  const BATCH_SIZE = 10;
  const results: Array<{ path: string; content: string }> = [];
  let dependencyEmbeddings = 0;

  for (let i = 0; i < contentRequiredFiles.length; i += BATCH_SIZE) {
    const batch = contentRequiredFiles.slice(i, i + BATCH_SIZE);

    const batchResults = await Promise.all(
      batch.map(file =>
        limit(async () => {
          try {
            const res = await octokit.request(
              "GET /repos/{owner}/{repo}/git/blobs/{file_sha}",
              { owner, repo, file_sha: file.sha }
            );
            const content = Buffer.from(res.data.content, "base64").toString("utf8");

            const chunks = chunkFileContent(repo, file.path, content, file.sha);
            const inserted = await embedChunksIfMissing(chunks);
            dependencyEmbeddings += inserted;
            return { path: file.path, content };
          } catch (err: any) {
            return null;
          }
        })
      )
    );

    const filtered = batchResults.filter(
      (item): item is { path: string; content: string } => Boolean(item)
    );
    results.push(...filtered);
  }

  

  const headReviewFiles: ReviewFile[] = prFiles.map(file => ({
    path: file.fileName,
    chunks: chunkFileContent(repo, file.fileName, file.content, headSha),
  }));

  const reviewBody = await generateReview({
    repoSlug,
    prNumber,
    headSha,
    baseSha,
    files: headReviewFiles,
  });

  await octokit.request("POST /repos/{owner}/{repo}/issues/{issue_number}/comments", {
    owner,
    repo,
    issue_number: prNumber,
    body: reviewBody,
  });

  await setLastEmbeddedSha(repoSlug, baseSha);

  // await octokit.request("POST /repos/{owner}/{repo}/issues/{issue_number}/comments", {
  //   owner,
  //   repo,
  //   issue_number: prNumber,
  //   body: "👋 Review bot online. PR processed against base branch embeddings.",
  // });
};

const handleMergedPullRequest = async ({
  payload,
  octokit,
  owner,
  repo,
  repoSlug,
  prNumber,
}: {
  payload: PullRequestWebhookPayload;
  octokit: any;
  owner: string;
  repo: string;
  repoSlug: string;
  prNumber: number;
}): Promise<void> => {
  const mergeSha = payload.pull_request?.merge_commit_sha;
  if (!mergeSha) {
    console.warn("⚠️ Merge event missing merge_commit_sha; skipping Pinecone update.");
    return;
  }

  const existingSha = await getLastEmbeddedSha(repoSlug);
  if (existingSha && existingSha !== mergeSha) {
    await deleteEmbeddingsByRepoAndSha(repoSlug, existingSha);
  }

  const limit = pLimit(5);
  const files = await octokit.request("GET /repos/{owner}/{repo}/pulls/{pull_number}/files", {
    owner,
    repo,
    pull_number: prNumber,
  });

  const mergedFiles = await fetchFilesAtRef(octokit, owner, repo, files.data, mergeSha, limit);
  const mergedChunks = mergedFiles.flatMap(file =>
    chunkFileContent(repo, file.fileName, file.content, mergeSha)
  );
  const inserted = await embedChunksIfMissing(mergedChunks);
  

  await setLastEmbeddedSha(repoSlug, mergeSha);
};

export const processPullRequest = async (payload: PullRequestWebhookPayload): Promise<void> => {
  try {
    const action = payload.action;
    const installationId = Number(payload.installation?.id);
    const owner = payload.repository?.owner?.login;
    const repo = payload.repository?.name;
    const prNumber = Number(payload.pull_request?.number);
    const headSha = payload.pull_request?.head?.sha;
    const baseSha = payload.pull_request?.base?.sha;
    const repoSlug = owner && repo ? `${owner}/${repo}` : undefined;

    if (!installationId || !owner || !repo || !prNumber || !repoSlug || !action) {
      throw new Error("Missing required pull request payload fields");
    }

    const octokit = await githubApp.getInstallationOctokit(installationId);

    if (action === "closed") {
      if (payload.pull_request?.merged) {
        await handleMergedPullRequest({ payload, octokit, owner, repo, repoSlug, prNumber });
      } else {
      
      }
      return;
    }

    if (!PR_EMBED_ACTIONS.has(action)) {
      
      return;
    }

    if (!headSha || !baseSha) {
      throw new Error("Missing head/base SHAs for pull request event");
    }

    await processPullRequestForBase({
      payload,
      octokit,
      owner,
      repo,
      repoSlug,
      prNumber,
      baseSha,
      headSha,
    });

    
  } catch (error) {
    
    throw error;
  }
};

export default { processPullRequest };
