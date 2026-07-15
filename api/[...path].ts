import type { Request, Response } from "express";
import { createApp } from "../server.js";

let appPromise: Promise<(req: Request, res: Response) => void> | undefined;

export default async function handler(req: Request, res: Response) {
  try {
    // Keep the fallback entrypoint compatible with Vercel's emitted ESM files.
    appPromise ??= createApp();
    const app = await appPromise;
    app(req, res);
  } catch (error) {
    console.error("[api-init]", error);
    appPromise = undefined;
    res.status(500).json({ error: "API gagal diinisialisasi." });
  }
}