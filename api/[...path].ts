import type { Request, Response } from "express";

let appPromise: Promise<(req: Request, res: Response) => void> | undefined;

export default async function handler(req: Request, res: Response) {
  try {
    // Import source so @vercel/node traces it into this function. The static
    // builder's dist/ output is not available when the function is built.
    appPromise ??= import("../server").then(({ createApp }) => createApp());
    const app = await appPromise;
    app(req, res);
  } catch (error) {
    console.error("[api-init]", error);
    appPromise = undefined;
    res.status(500).json({ error: "API gagal diinisialisasi." });
  }
}