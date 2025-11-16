import { Worker, QueueEvents } from "bullmq";
import { processPullRequest } from "../services/webhook.service.js";
import {
  PR_QUEUE_NAME,
  getQueueOptions,
  type PullRequestJobData,
} from "../queues/prQueue.js";
import { fileURLToPath } from "url";
import path from "path";

export function startPullRequestWorker(): Worker<PullRequestJobData> {
  const queueOptions = getQueueOptions();

  const worker = new Worker<PullRequestJobData>(
    PR_QUEUE_NAME,
    async job => {
      await processPullRequest(job.data.payload);
    },
    queueOptions
  );

  const events = new QueueEvents(PR_QUEUE_NAME, getQueueOptions());

  events.on("failed", ({ jobId, failedReason }) => {
    // failure handling placeholder
  });

  events.on("completed", ({ jobId }) => {
    // completion handling placeholder
  });

  worker.on("error", () => {
    // worker error handling placeholder
  });

  return worker;
}

function isExecutedDirectly(): boolean {
  const modulePath = fileURLToPath(import.meta.url);
  const executedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
  return modulePath === executedPath;
}

if (isExecutedDirectly()) {
  startPullRequestWorker().on("ready", () => {
    // worker ready
  });
}

