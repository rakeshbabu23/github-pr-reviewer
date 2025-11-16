

import { promises as fs } from "fs";
import path from "path";

export type RepoInfo = {
  installationId: number;
  owner: string;
  repo: string;
  repoSlug: string;
  installationAccount?: string;
  lastAction?: string;
  lastEventAt?: string;
};

type RepoInfoState = Record<string, RepoInfo>;

const stateDirectory = path.resolve(process.cwd(), "data");
const repoInfoFilePath = path.join(stateDirectory, "repositories.json");

async function ensureRepoInfoFile(): Promise<void> {
  try {
    await fs.mkdir(stateDirectory, { recursive: true });
    await fs.access(repoInfoFilePath);
  } catch (error: any) {
    if (error?.code === "ENOENT") {
      await fs.writeFile(repoInfoFilePath, JSON.stringify({}, null, 2), "utf8");
      return;
    }
    if (error?.code !== "EEXIST") {
      throw error;
    }
  }
}

async function readRepoInfoState(): Promise<RepoInfoState> {
  await ensureRepoInfoFile();
  const raw = await fs.readFile(repoInfoFilePath, "utf8");
  try {
    return JSON.parse(raw) as RepoInfoState;
  } catch (error) {
    await fs.writeFile(repoInfoFilePath, JSON.stringify({}, null, 2), "utf8");
    return {};
  }
}

async function writeRepoInfoState(state: RepoInfoState): Promise<void> {
  await ensureRepoInfoFile();
  await fs.writeFile(repoInfoFilePath, JSON.stringify(state, null, 2), "utf8");
}

export const storeRepoInfo = async (data: RepoInfo): Promise<void> => {
  try {
    const state = await readRepoInfoState();
    state[data.repoSlug] = {
      ...state[data.repoSlug],
      ...data,
      lastEventAt: data.lastEventAt ?? new Date().toISOString(),
    };
    await writeRepoInfoState(state);
  } catch (error) {
    throw error;
  }
};

export const listStoredRepos = async (): Promise<RepoInfo[]> => {
  const state = await readRepoInfoState();
  return Object.values(state);
};