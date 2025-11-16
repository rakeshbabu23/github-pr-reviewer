import { Queue, type JobsOptions, type QueueOptions } from "bullmq";
import type { PullRequestWebhookPayload } from "../services/webhook.service.js";

export const PR_QUEUE_NAME = "pull-request-processing";

function createConnectionOptions(): QueueOptions["connection"] {
  if (process.env.REDIS_URL) {
    return { url: process.env.REDIS_URL };
  }

  const host = process.env.REDIS_HOST ?? "127.0.0.1";
  const port = Number(process.env.REDIS_PORT ?? 6379);
  const password = process.env.REDIS_PASSWORD;
  const useTls = process.env.REDIS_TLS === "true";

  return {
    host,
    port,
    ...(password ? { password } : {}),
    ...(useTls ? { tls: {} } : {}),
  };
}

const queueOptions: QueueOptions = {
  connection: createConnectionOptions(),
};

export interface PullRequestJobData {
  payload: PullRequestWebhookPayload;
}

export const prProcessingQueue = new Queue<PullRequestJobData>(
  PR_QUEUE_NAME,
  queueOptions
);

export async function enqueuePullRequestJob(
  payload: PullRequestWebhookPayload,
  jobOptions?: JobsOptions
): Promise<void> {
  await prProcessingQueue.add(
    "process-pr",
    { payload },
    {
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: 100,
      removeOnFail: false,
      ...jobOptions,
    }
  );
}

export function getQueueOptions(): QueueOptions {
  return {
    connection: createConnectionOptions(),
  };
}

