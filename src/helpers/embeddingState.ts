import { promises as fs } from "fs";
import path from "path";

type EmbeddingState = Record<string, string>;

const stateDirectory = path.resolve(process.cwd(), "data");
const stateFilePath = path.join(stateDirectory, "embedding-state.json");

async function ensureStateFile(): Promise<void> {
  try {
    await fs.mkdir(stateDirectory, { recursive: true });
    await fs.access(stateFilePath);
  } catch (error: any) {
    if (error?.code === "ENOENT") {
      await fs.writeFile(stateFilePath, JSON.stringify({}, null, 2), "utf8");
      return;
    }
    if (error?.code !== "EEXIST") {
      throw error;
    }
  }
}

async function readState(): Promise<EmbeddingState> {
  await ensureStateFile();
  const raw = await fs.readFile(stateFilePath, "utf8");
  try {
    const parsed = JSON.parse(raw) as EmbeddingState;
    return parsed;
  } catch (error) {
    await fs.writeFile(stateFilePath, JSON.stringify({}, null, 2), "utf8");
    return {};
  }
}

async function writeState(state: EmbeddingState): Promise<void> {
  await ensureStateFile();
  await fs.writeFile(stateFilePath, JSON.stringify(state, null, 2), "utf8");
}

export async function getLastEmbeddedSha(repo: string): Promise<string | undefined> {
  const state = await readState();
  return state[repo];
}

export async function setLastEmbeddedSha(repo: string, sha: string): Promise<void> {
  const state = await readState();
  state[repo] = sha;
  await writeState(state);
}

export async function clearLastEmbeddedSha(repo: string): Promise<void> {
  const state = await readState();
  if (state[repo]) {
    delete state[repo];
    await writeState(state);
  }
}

