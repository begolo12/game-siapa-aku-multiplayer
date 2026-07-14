import type { Request, Response } from "express";
import { createApp } from "../server";

let appPromise = createApp();

export default async function handler(req: Request, res: Response) {
  const app = await appPromise;
  app(req, res);
}