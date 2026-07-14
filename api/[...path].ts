import type { Request, Response } from "express";
import { createApp } from "../server";

let appPromise = createApp();

export default async function handler(req: Request, res: Response) {
  try {
    const app = await appPromise;
    app(req, res);
  } catch (error) {
    console.error("[api-init]", error);
    res.status(500).json({ error: "API gagal diinisialisasi." });
  }
}