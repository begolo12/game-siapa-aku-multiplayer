import type { Request, Response } from "express";

let appPromise: Promise<(req: Request, res: Response) => void> | undefined;

export default async function handler(req: Request, res: Response) {
  try {
    // Vercel packages files under api/ only; load the production server bundle explicitly.
    appPromise ??= import("../dist/server.cjs").then(({ createApp }) => createApp());
    const app = await appPromise;
    app(req, res);
  } catch (error) {
    console.error("[api-init]", error);
    appPromise = undefined;
    res.status(500).json({ error: "API gagal diinisialisasi." });
  }
}