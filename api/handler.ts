import type { Request, Response } from "express";
import { createApp } from "../server.js";

let appPromise: Promise<(req: Request, res: Response) => void> | undefined;

export default async function handler(req: Request, res: Response) {
  try {
    // The explicit emitted extension lets Node resolve the bundled server module.
    appPromise ??= createApp();
    const app = await appPromise;
    app(req, res);
  } catch (error) {
    console.error("[api-init]", error);
    appPromise = undefined;
    res.status(500).json({ error: "API gagal diinisialisasi." });
  }
}