import type { Request, Response } from "express";
import type { PullRequestWebhookPayload } from "../services/webhook.service.js";
import { enqueuePullRequestJob } from "../queues/prQueue.js";
import { storeRepoInfo } from "../repositories/user.repository.js";

const handlePullRequest = async (req: Request, res: Response) => {
  try {
    const event = req.headers["x-github-event"];
    if (event !== "pull_request") {
      return res.status(200).send("Ignored non-PR event");
    }
    if (!req.body) {
      return res.status(200).send("No body");
    }
    if (!req.body.pull_request) {
      return res.status(400).send("Missing pull_request payload");
    }

    const payload = req.body as PullRequestWebhookPayload;
    const installationId = Number(payload.installation?.id);
    const owner = payload.repository?.owner?.login;
    const repo = payload.repository?.name;
    const repoSlug = owner && repo ? `${owner}/${repo}` : undefined;

    if (installationId && owner && repo && repoSlug) {
      const repoInfoPayload = {
        installationId,
        owner,
        repo,
        repoSlug,
        lastEventAt: new Date().toISOString(),
      };

      const installationAccount = payload.installation?.account?.login ?? undefined;
      const lastAction = payload.action ?? undefined;

      await storeRepoInfo({
        ...repoInfoPayload,
        ...(installationAccount ? { installationAccount } : {}),
        ...(lastAction ? { lastAction } : {}),
      });
    }

    await enqueuePullRequestJob(payload);
    return res.status(202).send("Queued pull request processing");
  } catch (error) {
    return res.status(500).send("Internal Server Error");
  }
};

export default { handlePullRequest };