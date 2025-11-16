import "dotenv/config";
import express from "express";
import webhookRouter from "./routes/webhook.route.js";

const app = express();
app.use(
  express.json({
    verify: (req, res, buf, encoding) => {
      (req as any).rawBody = buf;
    },
    type: ["application/json", "text/plain"],
  })
);

app.use("/webhook", webhookRouter);

app.listen(8000, () => {});