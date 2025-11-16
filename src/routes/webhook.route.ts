import express from "express";
import { verifyWebhook } from "../middlware/verifyWebhook.js";
import webhookController from '../controllers/webhook.controller.js'

const router = express.Router();

router.post("/req", verifyWebhook, webhookController.handlePullRequest);

export default router;