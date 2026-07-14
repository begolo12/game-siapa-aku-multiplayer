type ExpressApp = (req: unknown, res: unknown) => void;

let appPromise: Promise<ExpressApp> | undefined;

export default async function handler(req: any, res: any) {
  try {
    // Keep the function entrypoint dependency-free: server module errors become JSON.
    appPromise ??= import("../server.ts").then(({ createApp }) => createApp());
    const app = await appPromise;
    app(req, res);
  } catch (error) {
    console.error("[api-init]", error);
    appPromise = undefined;
    res.status(500).json({ error: "API gagal diinisialisasi." });
  }
}