import type { Request, Response } from "express";
import { createApp } from "../server";

let appPromise: Promise<(req: Request, res: Response) => void> | undefined;

export default async function handler(req: Request, res: Response) {
  try {
    // Static import makes @vercel/node bundle this dependency. Dynamic import
    // produced an unresolved /var/task/server path at runtime.
    appPromise ??= createApp();
    const app = await appPromise;
    app(req, res);
  } catch (error) {
    console.error("[api-init]", error);
    appPromise = undefined;
    res.status(500).json({ error: "API gagal diinisialisasi." });
  }
}