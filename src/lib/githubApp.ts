import "dotenv/config";
import { App } from "@octokit/app";

const appId = process.env.GITHUB_APP_ID;
const privateKey = process.env.GITHUB_PRIVATE_KEY;

if (!appId || !privateKey) {
  throw new Error("GITHUB_APP_ID and GITHUB_PRIVATE_KEY environment variables are required");
}

export const githubApp = new App({
  appId,
  privateKey,
});


