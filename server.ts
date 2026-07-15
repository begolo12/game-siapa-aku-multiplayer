import express from "express";
import path from "path";
import fs from "fs";
import "dotenv/config";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomBytes, randomInt, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { Pool, PoolClient } from "pg";
import { User, SubmittedStory, ChatMessage, GuessLog, StoryTemplate, GamePhase, PlayerAnswer, Session } from "./src/types";

// Standard preset templates — semua bertema proyek konstruksi & perusahaan
const PRESET_TEMPLATES: StoryTemplate[] = [
  {
    id: "temp-1",
    title: "Tentang Diriku",
    templateText: "Aku adalah seseorang yang dikenal ........., tetapi aku juga punya sifat buruk, yaitu......\nSaat senggang, waktuku habiskan untuk ...........dan.............\nAku juga punya kebiasaan unik, yaitu .........setiap kali..............\nSoal lingkungan, aku paling suka berada dalam situasi yang..............\ntetapi aku akan langsung merasa risih atau tidak nyaman jika berada dalam situasi yang.........\n\nNAMA :",
    parts: [
      "Aku adalah seseorang yang dikenal ",
      ", tetapi aku juga punya sifat buruk, yaitu ",
      ".\nSaat senggang, waktuku habiskan untuk ",
      " dan ",
      ".\nAku juga punya kebiasaan unik, yaitu ",
      " setiap kali ",
      ".\nSoal lingkungan, aku paling suka berada dalam situasi yang ",
      ".\ntetapi aku akan langsung merasa risih atau tidak nyaman jika berada dalam situasi yang ",
      ".\n\nNAMA :"
    ],
    placeholders: [
      "Julukan / sapaan (misal: si rajin)",
      "Sifat buruk (misal: ceroboh)",
      "Kegiatan senggang 1 (misal: ngopi)",
      "Kegiatan senggang 2 (misal: scroll HP)",
      "Kebiasaan unik (misal: ngomong sendiri)",
      "Kapan kebiasaan itu muncul (misal: lagi sendirian)",
      "Situasi nyaman (misal: di keramaian)",
      "Situasi risih (misal: diminta presentasi)"
    ]
  },
  {
    id: "temp-2",
    title: "Tentang Perilakuku",
    templateText: "Dalam hubungan interpersonal, aku sangat senang berhadapan dengan orang yang perilakunya .............\nSebaliknya, aku paling malas atau ilfeel jika melihat orang yang perilakunya.........\nUntuk urusan perut, aku sangat menyukai.............\ntetapi aku akan langsung menghindari jika disajikan.........karena............\n\nNAMA :",
    parts: [
      "Dalam hubungan interpersonal, aku sangat senang berhadapan dengan orang yang perilakunya ",
      ".\nSebaliknya, aku paling malas atau ilfeel jika melihat orang yang perilakunya ",
      ".\nUntuk urusan perut, aku sangat menyukai ",
      ".\ntetapi aku akan langsung menghindari jika disajikan ",
      " karena ",
      ".\n\nNAMA :"
    ],
    placeholders: [
      "Perilaku yang disukai (misal: jujur)",
      "Perilaku yang tidak disukai (misal: bohong)",
      "Makanan favorit (misal: rendang)",
      "Makanan yang dihindari (misal: petai)",
      "Alasan menghindari (misal: baunya tidak enak)"
    ]
  }
];

const DB_FILE = path.join(process.cwd(), "data-store.json");
const INITIAL_ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";
const ROUND_DURATION_MS = 30_000;
const DATABASE_URL = process.env.DATABASE_URL;
const pool = DATABASE_URL
  ? new Pool({
      connectionString: DATABASE_URL,
      // Vercel can scale to many instances; one client per instance prevents connection exhaustion.
      max: process.env.VERCEL ? 3 : 15,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      allowExitOnIdle: true,
    })
  : null;

if (pool) {
  pool.on("error", (err) => {
    console.error("Unexpected error on idle PostgreSQL client", err);
  });
}

// Caching variables for high performance
let cachedDbState: DBState | null = null;
let cachedUpdatedAt = 0; // ms timestamp
let lastDbCheckTime = 0; // ms timestamp
const CACHE_TTL_MS = 1000; // 1 second TTL
let lastLocalUpdate = Date.now(); // local fallback timestamp

let roundTimeoutTimer: NodeJS.Timeout | null = null;

const scrypt = promisify(scryptCallback);
const requestDatabase = new AsyncLocalStorage<{ client: PoolClient; mutationCommitted?: boolean }>();

/** Catches unhandled rejections from async Express route handlers and forwards them to the error middleware. */
function asyncHandler(fn: (req: express.Request, res: express.Response, next: express.NextFunction) => Promise<any>) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

function hashSessionToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const derived = await scrypt(password, salt, 64) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}

async function passwordMatches(password: string, passwordHash: string) {
  const [salt, encodedHash] = passwordHash.split(":");
  if (!salt || !encodedHash) return false;
  const expected = Buffer.from(encodedHash, "hex");
  const actual = await scrypt(password, salt, 64) as Buffer;
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

const firstName = (value: string) => value.trim().split(/\s+/)[0];

// Local state
interface DBState {
  users: (User & { passwordHash?: string; password?: string })[];
  stories: SubmittedStory[];
  chat: ChatMessage[];
  guessLogs: GuessLog[];
  session: Session;
  /** Per-player guesses for ended session results */
  playerResults: PlayerAnswer[];
  adminSessionExpiresAt?: number;
  authTokens?: { tokenHash: string; userId: string; expiresAt: number }[];
}
let dbState: DBState = {
  users: [
    {
      id: "admin-uid",
      username: "admin",
      password: INITIAL_ADMIN_PASSWORD,
      score: 100,
      solvedCount: 5,
      submittedCount: 2,
      isAdmin: true
    }
  ],
  stories: [],
  chat: [
    {
      id: "init-msg-1",
      userId: "admin-uid",
      username: "Admin-System",
      text: "Selamat datang di Game Siapa Aku Multiplayer! Silakan daftar akun Anda atau masuk jika sudah punya.",
      isAdmin: true,
      timestamp: Date.now()
    }
  ],
  guessLogs: [],
  session: { phase: "idle", sessionId: null, mysteryIds: [], totalMysteries: 0, endedAt: null, currentRound: null, roundIndex: 0, revealedStoryIds: [] },
  playerResults: []
};

function normalizeDB() {
  if (!dbState) { dbState = { users: [], stories: [], chat: [], guessLogs: [], session: { phase: "idle", sessionId: null, mysteryIds: [], totalMysteries: 0, endedAt: null, currentRound: null, roundIndex: 0, revealedStoryIds: [] }, playerResults: [] }; }
  if (!dbState.users) dbState.users = [];
  if (!dbState.stories) dbState.stories = [];
  if (!dbState.chat) dbState.chat = [];
  if (!dbState.guessLogs) dbState.guessLogs = [];
  if (!dbState.playerResults) dbState.playerResults = [];
  if (!dbState.session) dbState.session = { phase: "idle", sessionId: null, mysteryIds: [], totalMysteries: 0, endedAt: null, currentRound: null, roundIndex: 0, revealedStoryIds: [] };
  if (!dbState.session.revealedStoryIds) dbState.session.revealedStoryIds = [];
  dbState.authTokens = (dbState.authTokens || []).filter(token => token.expiresAt > Date.now());
  if (dbState.session.lastRevealed === undefined) dbState.session.lastRevealed = undefined;
  dbState.users.forEach(user => {
    if (user.isReady === undefined) user.isReady = false;
    if (user.isEliminated === undefined) user.isEliminated = false;
  });
  dbState.stories.forEach(story => {
    const template = PRESET_TEMPLATES.find(item => item.id === story.templateId);
    if (template) story.parts = template.parts;
  });

  const hasAdmin = dbState.users.some(u => u.username === "admin");
  if (!hasAdmin) {
    dbState.users.push({
      id: "admin-uid", username: "admin", password: INITIAL_ADMIN_PASSWORD, score: 100,
      solvedCount: 5, submittedCount: 2, isAdmin: true
    });
  } else {
    const adminObj = dbState.users.find(u => u.username === "admin")!;
    adminObj.isAdmin = true;
    if (!adminObj.password && !adminObj.passwordHash) adminObj.password = INITIAL_ADMIN_PASSWORD;
  }
}

async function migrateLegacyPasswords() {
  for (const user of dbState.users) {
    if (user.password && !user.passwordHash) {
      user.passwordHash = await hashPassword(user.password);
      delete user.password;
    }
  }
}

// Load fallback database from file when DATABASE_URL is unavailable.
async function loadFileDB() {
  try {
    try {
      await fs.promises.access(DB_FILE);
      const data = await fs.promises.readFile(DB_FILE, "utf-8");
      const parsed = JSON.parse(data);
      if (parsed) {
        // Merge or replace safely
        dbState = {
          users: parsed.users || dbState.users,
          stories: parsed.stories || dbState.stories,
          chat: parsed.chat || dbState.chat,
          guessLogs: parsed.guessLogs || dbState.guessLogs,
          session: parsed.session || dbState.session,
          playerResults: parsed.playerResults || dbState.playerResults,
          adminSessionExpiresAt: parsed.adminSessionExpiresAt,
          authTokens: parsed.authTokens || []
        };
        normalizeDB();
        await saveFileDB();
      }
    } catch {
      normalizeDB();
      await saveFileDB();
    }
  } catch (error) {
    console.error("Error loading database file, keeping in-memory state:", error);
  }
}

// Save database to file
async function saveFileDB() {
  try {
    const dir = path.dirname(DB_FILE);
    try {
      await fs.promises.access(dir);
    } catch {
      await fs.promises.mkdir(dir, { recursive: true });
    }
    // Write compact JSON (no pretty-print spaces) to save CPU and space
    await fs.promises.writeFile(DB_FILE, JSON.stringify(dbState), "utf-8");
  } catch (error) {
    console.error("Error saving database file:", error);
  }
}

async function initDatabase() {
  if (process.env.VERCEL && !process.env.ADMIN_PASSWORD) {
    throw new Error("ADMIN_PASSWORD is required for Vercel deployments.");
  }
  if (!pool) {
    if (process.env.VERCEL) {
      throw new Error("DATABASE_URL is required for Vercel deployments; the file fallback is single-process only.");
    }
    await loadFileDB();
    await migrateLegacyPasswords();
    await saveFileDB();
    lastLocalUpdate = Date.now();
    console.warn("DATABASE_URL tidak tersedia; memakai data-store.json.");
    return;
  }
  await pool.query(`CREATE TABLE IF NOT EXISTS app_state (id BOOLEAN PRIMARY KEY DEFAULT TRUE, state JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), CONSTRAINT one_state CHECK (id))`);
  await pool.query(`INSERT INTO app_state (id, state) VALUES (TRUE, $1::jsonb) ON CONFLICT (id) DO NOTHING`, [JSON.stringify(dbState)]);
  const result = await pool.query<{ state: DBState; updated_at: string }>("SELECT state, updated_at FROM app_state WHERE id = TRUE");
  dbState = result.rows[0].state;
  const storedState = JSON.stringify(dbState);
  normalizeDB();
  await migrateLegacyPasswords();
  if (JSON.stringify(dbState) !== storedState) {
    const updateRes = await pool.query<{ updated_at: string }>(`UPDATE app_state SET state = $1::jsonb, updated_at = NOW() WHERE id = TRUE RETURNING updated_at`, [JSON.stringify(dbState)]);
    cachedUpdatedAt = new Date(updateRes.rows[0].updated_at).getTime();
  } else {
    cachedUpdatedAt = new Date(result.rows[0].updated_at).getTime();
  }
  cachedDbState = dbState;
  lastDbCheckTime = Date.now();
  console.info("PostgreSQL Neon terhubung.");
}

/** Persists the request's serialized state before its response is committed. */
async function persistState() {
  const context = requestDatabase.getStore();
  if (context) {
    context.mutationCommitted = true;
  }
  if (!pool) {
    await saveFileDB();
    lastLocalUpdate = Date.now();
    return;
  }
  const result = await (context?.client || pool).query(
    `UPDATE app_state SET state = $1::jsonb, updated_at = NOW() WHERE id = TRUE RETURNING updated_at`,
    [JSON.stringify(dbState)]
  );
  if (result.rows[0]) {
    cachedDbState = dbState;
    cachedUpdatedAt = new Date(result.rows[0].updated_at).getTime();
    lastDbCheckTime = Date.now();
  }
}

async function saveDB() {
  try {
    await persistState();
  } catch (error) {
    console.error("[saveDB] Failed to persist state:", error);
    throw error;
  }
}

let isSavingState = false;
let needsSaveState = false;

function triggerBackgroundSave() {
  if (isSavingState || !needsSaveState) return;
  isSavingState = true;
  needsSaveState = false;
  
  persistState()
    .then(() => {
      isSavingState = false;
      triggerBackgroundSave();
    })
    .catch((err) => {
      isSavingState = false;
      console.error("[saveDBBackground] Error persisting state in background:", err);
      // Retry in 2 seconds
      setTimeout(triggerBackgroundSave, 2000);
    });
}

function saveDBBackground() {
  needsSaveState = true;
  triggerBackgroundSave();
}

async function getStateForRead(bypassCache = false): Promise<{ state: DBState; updatedAt: number }> {
  if (!pool) {
    return { state: dbState, updatedAt: lastLocalUpdate };
  }
  const now = Date.now();
  if (!bypassCache && cachedDbState && (now - lastDbCheckTime < CACHE_TTL_MS)) {
    return { state: cachedDbState, updatedAt: cachedUpdatedAt };
  }
  try {
    if (!bypassCache && cachedDbState) {
      // Fast query: only select updated_at
      const metaResult = await pool.query<{ updated_at: string }>("SELECT updated_at FROM app_state WHERE id = TRUE");
      if (metaResult.rows[0]) {
        const dbUpdatedAt = new Date(metaResult.rows[0].updated_at).getTime();
        if (dbUpdatedAt === cachedUpdatedAt) {
          lastDbCheckTime = now;
          return { state: cachedDbState, updatedAt: cachedUpdatedAt };
        }
      }
    }
    // Fetch full state if bypassCache is true, cache is empty, or updated_at has changed
    const result = await pool.query<{ state: DBState; updated_at: string }>(
      "SELECT state, updated_at FROM app_state WHERE id = TRUE"
    );
    if (!result.rows[0]) throw new Error("app_state is missing");
    cachedDbState = result.rows[0].state;
    cachedUpdatedAt = new Date(result.rows[0].updated_at).getTime();
    lastDbCheckTime = now;
    return { state: cachedDbState, updatedAt: cachedUpdatedAt };
  } catch (error) {
    console.error("Error reading state, falling back to cache if available:", error);
    if (cachedDbState) {
      return { state: cachedDbState, updatedAt: cachedUpdatedAt };
    }
    throw error;
  }
}

export async function createApp() {
  await initDatabase();
  const app = express();

  app.use(express.json({ limit: "32kb" }));

  // Limit API calls only; Vite module requests must never receive API throttling.
  const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
  app.use("/api", (req, res, next) => {
    const ip = (req.headers['x-forwarded-for'] as string || '').split(',')[0].trim() || req.ip || req.socket.remoteAddress || "unknown";
    const now = Date.now();
    const limit = req.method === "GET" ? 15 : 5; // 15 req/sec for GET, 5 req/sec for mutations
    const windowMs = 1000;
    
    // Periodically prune old IPs to prevent memory leaks
    if (rateLimitMap.size > 1000) {
      for (const [key, value] of rateLimitMap.entries()) {
        if (now > value.resetAt) rateLimitMap.delete(key);
      }
    }
    
    let rateData = rateLimitMap.get(ip);
    if (!rateData || now > rateData.resetAt) {
      rateData = { count: 1, resetAt: now + windowMs };
      rateLimitMap.set(ip, rateData);
    } else {
      rateData.count++;
    }
    
    if (rateData.count > limit) {
      return res.status(429).json({ error: "Terlalu banyak permintaan. Silakan coba beberapa saat lagi." });
    }
    next();
  });

  // The file fallback has no database row lock; serialize every mutation in this process.
  let fileMutationTail = Promise.resolve();
  if (!pool) {
    app.use("/api", asyncHandler(async (req, res, next) => {
      if (req.method === "GET") return next();
      const previousMutation = fileMutationTail.catch(() => undefined);
      let releaseMutation: (() => void) | undefined;
      fileMutationTail = previousMutation.then(() => new Promise<void>(resolve => {
        releaseMutation = resolve;
      }));
      await previousMutation;
      let released = false;
      const release = () => {
        if (!released) {
          released = true;
          releaseMutation?.();
        }
      };
      res.once("finish", release);
      res.once("close", release);
      next();
    }));
  }

  const loadReadState = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (req.method !== "GET" || !pool) return next();
    try {
      let bypassCache = req.query.bypassCache === "true";
      if (bypassCache) {
        // Authenticate the request to make sure it's a valid player before allowing cache bypass
        const currentUser = getRequestUser(req, dbState);
        if (!currentUser) {
          bypassCache = false;
        }
      }
      const { state, updatedAt } = await getStateForRead(bypassCache);
      res.locals.state = state;
      res.locals.stateUpdatedAt = updatedAt;
      normalizeState(res.locals.state);
      next();
    } catch (error) {
      next(error);
    }
  };
  if (pool) {
    app.use("/api/game/state", loadReadState);
    app.use("/api/admin/stories", loadReadState);
    app.use("/api/session/results", loadReadState);

    app.use("/api", async (req, res, next) => {
      if (req.method === "GET" || req.path === "/chat" || req.originalUrl === "/api/chat") return next();
      const client = await pool.connect();
      let settled = false;
      let originalStateBackup = "";
      const finalize = async (commit: boolean) => {
        if (settled) return;
        settled = true;
        try {
          if (commit) {
            await client.query("COMMIT");
          } else {
            await client.query("ROLLBACK");
            if (originalStateBackup) {
              dbState = JSON.parse(originalStateBackup);
            }
          }
        } finally {
          client.release();
        }
      };
      try {
        await client.query("BEGIN");
        const result = await client.query<{ state: DBState }>("SELECT state FROM app_state WHERE id = TRUE FOR UPDATE");
        if (!result.rows[0]) throw new Error("app_state is missing");
        dbState = result.rows[0].state;
        originalStateBackup = JSON.stringify(dbState);
        normalizeDB();

        const originalEnd = res.end.bind(res);
        res.end = ((...args: Parameters<express.Response["end"]>) => {
          const isSuccess = res.statusCode < 400;
          void finalize(isSuccess).then(() => originalEnd(...args)).catch(next);
          return res;
        }) as express.Response["end"];
        res.once("close", () => {
          if (!settled) {
            const context = requestDatabase.getStore();
            const commitOnClose = context?.mutationCommitted === true;
            void finalize(commitOnClose);
          }
        });
        requestDatabase.run({ client }, () => next());
      } catch (error) {
        await finalize(false);
        next(error);
      }
    });
  }

  const normalizeState = (state: DBState) => {
    const previousState = dbState;
    dbState = state;
    try {
      normalizeDB();
    } finally {
      dbState = previousState;
    }
  };

  const getSafeGameState = (currentUser: User | null, state = dbState) => {
    const usersSafe = state.users.map(({ password: _, passwordHash: __, ...user }) => user);
    const activeStoryId = state.session.currentRound?.storyId;
    const storiesSafe = state.stories.map(story => {
      const canSeeAnswer = currentUser && (
        currentUser.isAdmin ||
        currentUser.id === story.userId ||
        story.isSolvedBy.includes(currentUser.id) ||
        state.session.revealedStoryIds.includes(story.id)
      );
      if (canSeeAnswer) return story;
      const { answer, userId, ...storySafe } = story;
      const isActiveMystery = activeStoryId === story.id;
      return isActiveMystery ? { ...storySafe, username: "Pemain Misterius" } : storySafe;
    });
    const safeSession = roundSafeSession(state.session);
    return {
      users: usersSafe,
      stories: storiesSafe,
      chat: state.chat,
      guessLogs: state.guessLogs.map(log => log.storyId === activeStoryId ? { ...log, targetUsername: "Pemain Misterius" } : log),
      session: safeSession,
      myResults: safeSession.phase === "ended" && currentUser
        ? state.playerResults.filter(result => result.userId === currentUser.id)
        : undefined,
      serverTime: Date.now()
    };
  };

  // Authentication uses a server-issued opaque bearer token; never trust a client-supplied user id.
  const getRequestUser = (req: express.Request, state = dbState): (User & { passwordHash?: string; password?: string }) | null => {
    const authorization = req.get("authorization");
    if (!authorization?.startsWith("Bearer ")) return null;
    const tokenHash = createHash("sha256").update(authorization.slice(7)).digest("hex");
    const session = state.authTokens?.find(item => item.tokenHash === tokenHash && item.expiresAt > Date.now());
    return session ? state.users.find(user => user.id === session.userId) || null : null;
  };

  // ------------------------- API Routes -------------------------

  // Health check
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Get templates
  app.get("/api/templates", (req, res) => {
    res.json(PRESET_TEMPLATES);
  });

  // Authentication: Register
  app.post("/api/auth/register", asyncHandler(async (req, res) => {
    const { username, password } = req.body;
    if (typeof username !== "string" || typeof password !== "string" || !username.trim() || !password) {
      return res.status(400).json({ error: "Username dan Password harus diisi." });
    }
    const trimmedUsername = firstName(username);
    if (trimmedUsername.length < 3 || trimmedUsername.length > 32 || password.length < 4 || password.length > 128) {
      return res.status(400).json({ error: "Nama depan 3–32 karakter dan password 4–128 karakter diperlukan." });
    }
    if (dbState.users.some(user => user.username.toLowerCase() === trimmedUsername.toLowerCase())) {
      return res.status(400).json({ error: "Username sudah terdaftar. Gunakan nama lain." });
    }

    const newUser: User & { passwordHash: string } = {
      id: `u-${randomUUID()}`,
      username: trimmedUsername,
      passwordHash: await hashPassword(password),
      score: 0,
      solvedCount: 0,
      submittedCount: 0,
      isAdmin: false
    };
    const token = randomBytes(32).toString("base64url");
    dbState.users.push(newUser);
    dbState.authTokens = (dbState.authTokens || []).filter(item => item.expiresAt > Date.now());
    dbState.authTokens.push({
      tokenHash: hashSessionToken(token),
      userId: newUser.id,
      expiresAt: Date.now() + 12 * 60 * 60 * 1_000
    });
    await saveDB();
    const { passwordHash: _, ...userSafe } = newUser;
    res.json({ user: userSafe, token });
  }));

  // Authentication: Login
  app.post("/api/auth/login", asyncHandler(async (req, res) => {
    const { username, password } = req.body;
    if (typeof username !== "string" || typeof password !== "string" || !username.trim() || !password) {
      return res.status(400).json({ error: "Username dan Password harus diisi." });
    }
    const targetUser = dbState.users.find(user => user.username.toLowerCase() === firstName(username).toLowerCase());
    if (!targetUser?.passwordHash || !(await passwordMatches(password, targetUser.passwordHash))) {
      return res.status(401).json({ error: "Username atau password salah." });
    }
    dbState.authTokens = (dbState.authTokens || []).filter(item => item.expiresAt > Date.now());
    if (targetUser.isAdmin && dbState.authTokens.some(item => item.userId === targetUser.id)) {
      return res.status(409).json({ error: "Admin sedang login di perangkat lain." });
    }
    const token = randomBytes(32).toString("base64url");
    dbState.authTokens.push({
      tokenHash: hashSessionToken(token),
      userId: targetUser.id,
      expiresAt: Date.now() + 12 * 60 * 60 * 1_000
    });
    await saveDB();
    const { passwordHash: _, ...userSafe } = targetUser;
    res.json({ user: userSafe, token });
  }));

  app.post("/api/auth/logout", asyncHandler(async (req, res) => {
    const authorization = req.get("authorization");
    if (!authorization?.startsWith("Bearer ")) return res.status(401).json({ error: "Harap login." });
    const tokenHash = hashSessionToken(authorization.slice(7));
    const currentUser = getRequestUser(req);
    if (!currentUser) return res.status(401).json({ error: "Sesi tidak valid atau telah berakhir." });
    dbState.authTokens = (dbState.authTokens || []).filter(item => item.tokenHash !== tokenHash);
    await saveDB();
    res.json({ success: true });
  }));

  // GET polling is served from an independent PostgreSQL snapshot and never mutates global state.
  app.get("/api/game/state", (req, res) => {
    const state = (res.locals.state as DBState | undefined) || dbState;
    const updatedAt = (res.locals.stateUpdatedAt as number | undefined) || lastLocalUpdate;
    const currentUser = getRequestUser(req, state);

    // Compute a fast ETag using updatedAt and currentUser ID
    const etagBase = `${updatedAt}-${currentUser ? currentUser.id : "guest"}`;
    const etag = `"${createHash("sha256").update(etagBase).digest("base64url")}"`;
    res.set("ETag", etag);
    res.set("Cache-Control", "no-store");
    if (req.headers["if-none-match"] === etag) return res.status(304).end();

    const body = getSafeGameState(currentUser, state);
    res.json(body);
  });

  // Add a story (Wizard 1 + Wizard 2 Submit)
  app.post("/api/game/story", asyncHandler(async (req, res) => {
    const currentUser = getRequestUser(req);
    if (!currentUser) {
      return res.status(401).json({ error: "Gagal memproses. Anda harus masuk terlebih dahulu." });
    }

    const { templateId, blanks, answer } = req.body;

    // Block story creation during active session (except admin)
    if (dbState.session.sessionId && dbState.session.phase !== "ended" && !currentUser.isAdmin) {
      return res.status(403).json({ error: "Sesi sedang berlangsung. Tidak bisa membuat cerita baru sekarang." });
    }

    // Each player can submit exactly 2 stories
    const existingCount = dbState.stories.filter(s => s.userId === currentUser.id).length;
    if (existingCount >= 2) {
      return res.status(400).json({ error: "Kamu sudah membuat 2 cerita. Maksimal 2 cerita per pemain." });
    }

    if (typeof templateId !== "string" || !Array.isArray(blanks) || blanks.some(blank => typeof blank !== "string") || typeof answer !== "string") {
      return res.status(400).json({ error: "Template, isian cerita, dan jawaban harus valid." });
    }
    const template = PRESET_TEMPLATES.find(item => item.id === templateId);
    if (!template) {
      return res.status(400).json({ error: "Template cerita tidak valid." });
    }
    if (blanks.length !== template.placeholders.length) {
      return res.status(400).json({ error: `Jumlah kolom isian cerita harus tepat ${template.placeholders.length} kosong.` });
    }
    if (blanks.some(blank => !blank.trim() || blank.length > 500)) {
      return res.status(400).json({ error: `Semua ${template.placeholders.length} kolom cerita wajib diisi dan maksimal 500 karakter.` });
    }

    const trimmedAnswer = firstName(currentUser.username);
    if (trimmedAnswer.length < 1) {
      return res.status(400).json({ error: "Jawaban (Nama / Karakter) tidak boleh kosong." });
    }

    // Create the submitted story
    const newStory: SubmittedStory = {
      id: `story-${randomUUID()}`,
      userId: currentUser.id,
      username: currentUser.username,
      templateId: templateId,
      parts: template.parts,
      blanks: blanks.map(b => b.trim()),
      answer: trimmedAnswer,
      isSolvedBy: [],
      createdAt: Date.now()
    };

    dbState.stories.push(newStory);

    // Update user's submitted count
    const userInDb = dbState.users.find(u => u.id === currentUser.id);
    if (userInDb) {
      userInDb.submittedCount = (userInDb.submittedCount || 0) + 1;
    }

    // System announcement in chat
    const systemAnnouncement: ChatMessage = {
      id: `ann-${randomUUID()}`,
      userId: "system",
      username: "System",
      text: `🎉 ${currentUser.username} baru saja memublikasikan cerita misteri baru! Siapa dia sebenarnya? Coba tebak!`,
      isAdmin: true,
      timestamp: Date.now()
    };
    dbState.chat.push(systemAnnouncement);

    await saveDB();
    res.json(getSafeGameState(currentUser));
  }));

  // Player: edit own story before the admin starts the session.
  app.put("/api/game/story/:storyId", asyncHandler(async (req, res) => {
    const currentUser = getRequestUser(req);
    if (!currentUser) return res.status(401).json({ error: "Harap login." });
    if (dbState.session.phase === "playing") return res.status(403).json({ error: "Cerita tidak dapat diubah saat game berjalan." });

    const story = dbState.stories.find(item => item.id === req.params.storyId && item.userId === currentUser.id);
    if (!story) return res.status(404).json({ error: "Cerita tidak ditemukan." });
    const { blanks } = req.body;
    const template = PRESET_TEMPLATES.find(item => item.id === story.templateId);
    if (!template || !Array.isArray(blanks) || blanks.length !== template.placeholders.length || blanks.some(blank => !blank?.trim())) {
      return res.status(400).json({ error: "Semua kolom cerita harus diisi lengkap." });
    }
    story.blanks = blanks.map(blank => blank.trim());
    await saveDB();
    res.json(getSafeGameState(currentUser));
  }));

  // Post a guess
  app.post("/api/game/guess", asyncHandler(async (req, res) => {
    const currentUser = getRequestUser(req);
    if (!currentUser) {
      return res.status(401).json({ error: "Harap login untuk menebak." });
    }
    const { storyId, guessText } = req.body;
    if (typeof storyId !== "string" || typeof guessText !== "string" || !guessText.trim() || guessText.length > 64) {
      return res.status(400).json({ error: "Tebakan harus berisi 1–64 karakter." });
    }

    const story = dbState.stories.find(s => s.id === storyId);
    if (!story) {
      return res.status(404).json({ error: "Cerita tidak ditemukan." });
    }

    // Session enforcement (round-based)
    if (dbState.session.sessionId) {
      if (dbState.session.phase !== "playing" || !dbState.session.currentRound) {
        return res.status(403).json({ error: "Tidak ada ronde aktif. Tunggu ronde berikutnya." });
      }
      // Only the current round's story can be guessed
      if (dbState.session.currentRound.storyId !== storyId) {
        return res.status(403).json({ error: "Cerita ini tidak aktif di ronde ini." });
      }
      // Time limit check
      const elapsed = Date.now() - dbState.session.currentRound.startTime;
      if (elapsed >= ROUND_DURATION_MS) {
        return res.status(408).json({ error: "Waktu habis! Ronde sudah berakhir." });
      }
    } else {
      return res.status(403).json({ error: "Tidak ada sesi aktif. Tidak bisa menebak sekarang." });
    }

    if (story.userId === currentUser.id) {
      return res.status(403).json({ error: "Anda tidak dapat menebak cerita sendiri." });
    }
    if (!story.guessedBy) story.guessedBy = [];
    if (story.guessedBy.includes(currentUser.id)) {
      return res.status(400).json({ error: "Anda sudah memakai satu kesempatan pada ronde ini." });
    }

    const normalizedGuess = firstName(guessText).toLowerCase();
    const normalizedAnswer = firstName(story.answer).toLowerCase();

    // Check guess
    const isCorrect = normalizedGuess === normalizedAnswer;

    // Create Guess Log
    const log: GuessLog = {
      id: `guess-${randomUUID()}`,
      userId: currentUser.id,
      username: currentUser.username,
      storyId: storyId,
      targetUsername: story.username,
      guessText: guessText.trim(),
      isCorrect,
      timestamp: Date.now()
    };

    dbState.guessLogs.unshift(log); // newest first
    if (dbState.guessLogs.length > 500) {
      dbState.guessLogs = dbState.guessLogs.slice(0, 500);
    }

    const awardedPoints = isCorrect
      ? Math.max(1, Math.ceil((ROUND_DURATION_MS - (Date.now() - dbState.session.currentRound!.startTime)) / 1_000))
      : 0;
    log.awardedPoints = awardedPoints;
    dbState.playerResults.push({
      userId: currentUser.id,
      storyId: story.id,
      correctAnswer: story.answer,
      playerGuess: log.guessText,
      storyPreview: story.parts.map((part, index) => part + (story.blanks[index] || "")).join(""),
      isCorrect,
      awardedPoints
    });

    // Record the guess attempt to prevent duplicate guesses
    if (!story.guessedBy.includes(currentUser.id)) {
      story.guessedBy.push(currentUser.id);
    }

    if (isCorrect) {
      // Add user to solved list
      story.isSolvedBy.push(currentUser.id);

      // Add points (4 per correct guess in session)
      const guesser = dbState.users.find(u => u.id === currentUser.id);
      if (guesser) {
        guesser.score = (guesser.score || 0) + awardedPoints;
        guesser.solvedCount = (guesser.solvedCount || 0) + 1;
      }

      // System notification in chat
      const correctAnnouncement: ChatMessage = {
        id: `ann-${randomUUID()}`,
        userId: "system",
        username: "System-Berhasil",
        text: `🎯 Tebakan JITU! ${currentUser.username} menjawab benar dan mendapat +${awardedPoints} poin!`,
        isAdmin: true,
        timestamp: Date.now()
      };
      dbState.chat.push(correctAnnouncement);
    } else {
      // Wrong guess system notification in chat - let's make it friendly
      const wrongAnnouncement: ChatMessage = {
        id: `ann-${randomUUID()}`,
        userId: "system",
        username: "System-Tebak",
        text: `❌ Oh tidak! ${currentUser.username} menebak "${guessText.trim()}", tapi salah! Coba lagi!`,
        isAdmin: true,
        timestamp: Date.now()
      };
      dbState.chat.push(wrongAnnouncement);
    }

    // Keep chat within limit
    if (dbState.chat.length > 500) {
      dbState.chat = dbState.chat.slice(dbState.chat.length - 500);
    }

    await saveDB();
    const body = getSafeGameState(currentUser);
    res.json({ isCorrect, answer: isCorrect ? story.answer : undefined, gameState: body });
  }));

  // Player: mark lobby readiness. A ready player has completed two stories.
  app.post("/api/game/lobby/ready", asyncHandler(async (req, res) => {
    const currentUser = getRequestUser(req);
    if (!currentUser || currentUser.isAdmin) return res.status(403).json({ error: "Hanya pemain yang dapat mengubah status siap." });
    if (dbState.session.sessionId && dbState.session.phase !== "ended") return res.status(409).json({ error: "Game sudah berjalan." });
    const storyCount = dbState.stories.filter(story => story.userId === currentUser.id).length;
    if (storyCount < 2) return res.status(400).json({ error: `Lengkapi 2 cerita dulu (${storyCount}/2).` });
    currentUser.isReady = !currentUser.isReady;
    await saveDB();
    res.json(getSafeGameState(currentUser));
  }));

  // Post chat message
  app.post("/api/chat", asyncHandler(async (req, res) => {
    const currentUser = getRequestUser(req);
    if (!currentUser) {
      return res.status(401).json({ error: "Anda harus masuk terlebih dahulu untuk mengirim obrolan." });
    }

    const { text } = req.body;
    if (typeof text !== "string" || !text.trim() || text.length > 1_000) {
      return res.status(400).json({ error: "Pesan wajib diisi dan maksimal 1000 karakter." });
    }

    const newMessage: ChatMessage = {
      id: `msg-${randomUUID()}`,
      userId: currentUser.id,
      username: currentUser.username,
      text: text.trim(),
      isAdmin: currentUser.isAdmin,
      timestamp: Date.now()
    };

    dbState.chat.push(newMessage);
    if (dbState.chat.length > 200) {
      dbState.chat = dbState.chat.slice(dbState.chat.length - 200);
    }
    
    saveDBBackground();
    
    const body = getSafeGameState(currentUser);
    res.json(body);
  }));

  // Admin Route: Get full stories list (including answers)
  app.get("/api/admin/stories", (req, res) => {
    const state = (res.locals.state as DBState | undefined) || dbState;
    const currentUser = getRequestUser(req, state);
    if (!currentUser?.isAdmin) {
      return res.status(403).json({ error: "Akses ditolak. Rute ini hanya untuk Admin." });
    }
    res.json(state.stories);
  });

  // Admin: edit a player. Locked while a game is running so answers stay consistent.
  app.patch("/api/admin/users/:userId", asyncHandler(async (req, res) => {
    const currentUser = getRequestUser(req);
    if (!currentUser?.isAdmin) return res.status(403).json({ error: "Akses ditolak." });
    if (dbState.session.phase === "playing") {
      return res.status(409).json({ error: "Akhiri ronde sebelum mengubah pemain." });
    }

    const user = dbState.users.find(u => u.id === req.params.userId);
    if (!user || user.isAdmin) return res.status(404).json({ error: "Pemain tidak ditemukan atau tidak dapat diubah." });

    const username = typeof req.body.username === "string" ? firstName(req.body.username) : "";
    const password = typeof req.body.password === "string" ? req.body.password.trim() : "";
    if (username.length < 3 || username.length > 32) return res.status(400).json({ error: "Nama depan harus 3–32 karakter." });
    if (password && (password.length < 4 || password.length > 128)) return res.status(400).json({ error: "Password baru harus 4–128 karakter." });
    if (dbState.users.some(u => u.id !== user.id && u.username.toLowerCase() === username.toLowerCase())) {
      return res.status(400).json({ error: "Nama depan sudah digunakan pemain lain." });
    }

    const previousName = user.username;
    user.username = username;
    if (password) user.passwordHash = await hashPassword(password);
    dbState.stories.filter(s => s.userId === user.id).forEach(s => { s.username = username; s.answer = username; });
    dbState.chat.filter(m => m.userId === user.id).forEach(m => { m.username = username; });
    dbState.guessLogs.forEach(log => {
      if (log.userId === user.id) log.username = username;
      if (log.targetUsername === previousName) log.targetUsername = username;
    });
    await saveDB();
    const { password: _, passwordHash: __, ...safeUser } = user;
    res.json({ user: safeUser });
  }));

  // Admin: delete a player and every record owned by that player.
  app.delete("/api/admin/users/:userId", asyncHandler(async (req, res) => {
    const currentUser = getRequestUser(req);
    if (!currentUser?.isAdmin) return res.status(403).json({ error: "Akses ditolak." });
    if (dbState.session.sessionId && dbState.session.phase !== "ended") {
      return res.status(409).json({ error: "Akhiri game sebelum menghapus pemain." });
    }
    const user = dbState.users.find(u => u.id === req.params.userId);
    if (!user || user.isAdmin) return res.status(404).json({ error: "Pemain tidak ditemukan atau tidak dapat dihapus." });

    const storyIds = dbState.stories.filter(s => s.userId === user.id).map(s => s.id);
    dbState.users = dbState.users.filter(u => u.id !== user.id);
    dbState.stories = dbState.stories.filter(s => s.userId !== user.id);
    dbState.chat = dbState.chat.filter(m => m.userId !== user.id);
    dbState.guessLogs = dbState.guessLogs.filter(log => log.userId !== user.id && !storyIds.includes(log.storyId));
    dbState.playerResults = dbState.playerResults.filter(result => result.userId !== user.id && !storyIds.includes(result.storyId));
    dbState.authTokens = (dbState.authTokens || []).filter(token => token.userId !== user.id);
    await saveDB();
    res.json({ success: true });
  }));

  // Admin Route: Reset game
  app.post("/api/admin/reset", asyncHandler(async (req, res) => {
    const currentUser = getRequestUser(req);
    if (!currentUser || !currentUser.isAdmin) {
      return res.status(403).json({ error: "Akses ditolak. Rute ini hanya untuk Admin." });
    }

    // Keep admin, delete all non-admin users
    dbState.users = dbState.users.filter(u => u.isAdmin);

    // Clear everything
    dbState.stories = [];
    dbState.guessLogs = [];
    dbState.session = { phase: "idle", sessionId: null, mysteryIds: [], totalMysteries: 0, endedAt: null, currentRound: null, roundIndex: 0, revealedStoryIds: [] };
    dbState.playerResults = [];
    dbState.chat = [];
    dbState.users.forEach(user => { user.isReady = false; });
    dbState.authTokens = (dbState.authTokens || []).filter(token => dbState.users.some(user => user.id === token.userId));
    
    if (roundTimeoutTimer) {
      clearTimeout(roundTimeoutTimer);
      roundTimeoutTimer = null;
    }
    await saveDB();
    res.json(getSafeGameState(currentUser));
  }));

  // Admin Route: Restart session (keeps users and stories, resets scores/guesses/chat)
  app.post("/api/admin/session/restart", asyncHandler(async (req, res) => {
    const currentUser = getRequestUser(req);
    if (!currentUser || !currentUser.isAdmin) {
      return res.status(403).json({ error: "Akses ditolak. Rute ini hanya untuk Admin." });
    }

    // Reset user scores, solvedCounts, and ready statuses
    dbState.users.forEach(user => {
      user.score = 0;
      user.solvedCount = 0;
      user.isReady = false;
      user.submittedCount = dbState.stories.filter(s => s.userId === user.id).length;
    });

    // Reset stories guess data
    dbState.stories.forEach(story => {
      story.isSolvedBy = [];
      story.guessedBy = [];
    });

    // Clear session status, logs, chat, and results
    dbState.guessLogs = [];
    dbState.session = { phase: "idle", sessionId: null, mysteryIds: [], totalMysteries: 0, endedAt: null, currentRound: null, roundIndex: 0, revealedStoryIds: [] };
    dbState.playerResults = [];
    dbState.chat = [];
    
    if (roundTimeoutTimer) {
      clearTimeout(roundTimeoutTimer);
      roundTimeoutTimer = null;
    }
    
    await saveDB();
    res.json(getSafeGameState(currentUser));
  }));

  // ---------- Session endpoints ----------

  // Admin: Start game session (picks up to 25 random stories)
  app.post("/api/admin/session/start", asyncHandler(async (req, res) => {
    const currentUser = getRequestUser(req);
    if (!currentUser || !currentUser.isAdmin) {
      return res.status(403).json({ error: "Akses ditolak." });
    }

    const allStories = [...dbState.stories];
    if (allStories.length === 0) {
      return res.status(400).json({ error: "Belum ada cerita dari pemain. Minta pemain membuat cerita dulu." });
    }

    const players = dbState.users.filter(user => !user.isAdmin);
    players.forEach(user => { user.isEliminated = false; });

    // Fisher–Yates avoids the biased comparator shuffle and only copies the selected candidates.
    const shuffled = [...allStories];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const swapIndex = randomInt(index + 1);
      [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
    }
    const selected = shuffled.slice(0, Math.min(25, shuffled.length));

    dbState.session = {
      phase: "playing",
      sessionId: `sess-${randomUUID()}`,
      mysteryIds: selected.map(s => s.id),
      totalMysteries: selected.length,
      endedAt: null,
      currentRound: {
        storyId: selected[0].id,
        startTime: Date.now(),
        remainingMs: ROUND_DURATION_MS,
        roundIndex: 0
      },
      roundIndex: 0,
      revealedStoryIds: []
    };
    dbState.users.forEach(user => { if (!user.isAdmin) user.isReady = false; });

    // A new session starts a new scoreboard and answer history.
    dbState.playerResults = [];
    dbState.guessLogs = [];
    dbState.users.forEach(user => {
      user.score = 0;
      user.solvedCount = 0;
    });

    // System announcement
    dbState.chat.push({
      id: `ann-${randomUUID()}`,
      userId: "system",
      username: "System",
      text: "🎮 GAME DIMULAI! Cerita pertama sudah tampil. Tebak nama depannya dalam 30 detik!",
      isAdmin: true,
      timestamp: Date.now()
    });

    scheduleServerRoundExpiry();
    await saveDB();
    res.json(getSafeGameState(currentUser));
  }));

  // Admin: End session
  app.post("/api/admin/session/end", asyncHandler(async (req, res) => {
    const currentUser = getRequestUser(req);
    if (!currentUser?.isAdmin) {
      return res.status(403).json({ error: "Akses ditolak." });
    }
    if (dbState.session.phase === "idle" && !dbState.session.sessionId) {
      return res.status(400).json({ error: "Tidak ada sesi aktif." });
    }
    await endSession();
    res.json(getSafeGameState(currentUser));
  }));

  // Player: Get my results (also available through game/state.myResults)
  app.get("/api/session/results", (req, res) => {
    const state = (res.locals.state as DBState | undefined) || dbState;
    const currentUser = getRequestUser(req, state);
    if (!currentUser) return res.status(401).json({ error: "Harap login." });
    const myResults = state.playerResults.filter(result => result.userId === currentUser.id);
    res.json({ results: myResults, session: state.session });
  });

  async function endSession() {
    if (dbState.session.currentRound) await endRound();
    dbState.session.phase = "ended";
    dbState.session.endedAt = Date.now();
    dbState.session.currentRound = null;
    
    if (roundTimeoutTimer) {
      clearTimeout(roundTimeoutTimer);
      roundTimeoutTimer = null;
    }
    await saveDB();
  }

  // Modified reset endpoint — also clears session
  // (Replace the existing reset block) — see below

  // ---------- Round endpoints ----------

  // Admin: Start a round
  app.post("/api/admin/round/start", asyncHandler(async (req, res) => {
    const currentUser = getRequestUser(req);
    if (!currentUser || !currentUser.isAdmin) {
      return res.status(403).json({ error: "Akses ditolak." });
    }
    if (!dbState.session.sessionId || dbState.session.phase === "ended") {
      return res.status(400).json({ error: "Tidak ada sesi aktif." });
    }
    if (dbState.session.phase === "playing") {
      return res.status(400).json({ error: "Ronde sudah berjalan. Akhiri dulu." });
    }

    const remaining = dbState.session.mysteryIds.slice(dbState.session.roundIndex);
    if (remaining.length === 0) {
      return res.status(400).json({ error: "Semua misteri sudah dimainkan." });
    }

    const storyId = remaining[0];
    dbState.session.currentRound = {
      storyId,
      startTime: Date.now(),
      remainingMs: ROUND_DURATION_MS,
      roundIndex: dbState.session.roundIndex
    };
    dbState.session.phase = "playing";
    dbState.session.lastRevealed = undefined; // clear previous reveal

    dbState.chat.push({
      id: `ann-${randomUUID()}`,
      userId: "system",
      username: "System",
      text: `⏳ RONDE ${dbState.session.roundIndex + 1}/${dbState.session.totalMysteries} DIMULAI! Tebak siapa karakter ini dalam 30 detik!`,
      isAdmin: true,
      timestamp: Date.now()
    });

    scheduleServerRoundExpiry();
    await saveDB();
    res.json(getSafeGameState(currentUser));
  }));

  // Admin: End current round (before timer expires)
  app.post("/api/admin/round/end", asyncHandler(async (req, res) => {
    const currentUser = getRequestUser(req);
    if (!currentUser || !currentUser.isAdmin) {
      return res.status(403).json({ error: "Akses ditolak." });
    }
    if (dbState.session.phase !== "playing" || !dbState.session.currentRound) {
      return res.status(400).json({ error: "Tidak ada ronde aktif." });
    }

    await endRound();
    res.json(getSafeGameState(currentUser));
  }));
  // Any authenticated player may finalize an elapsed round; server time remains authoritative.
  app.post("/api/game/round/expire", asyncHandler(async (req, res) => {
    const currentUser = getRequestUser(req);
    if (!currentUser) return res.status(401).json({ error: "Harap login." });
    const round = dbState.session.currentRound;
    if (dbState.session.phase !== "playing" || !round) {
      return res.json(getSafeGameState(currentUser));
    }
    if (Date.now() - round.startTime < ROUND_DURATION_MS) {
      return res.json(getSafeGameState(currentUser));
    }
    await endRound();
    res.json(getSafeGameState(currentUser));
  }));


  /** Closes the current round, advances roundIndex, reveals answer in chat */
  async function endRound() {
    const round = dbState.session.currentRound;
    if (!round) return;

    if (roundTimeoutTimer) {
      clearTimeout(roundTimeoutTimer);
      roundTimeoutTimer = null;
    }

    dbState.session.phase = "idle";
    dbState.session.roundIndex += 1;
    dbState.session.currentRound = null;

    const story = dbState.stories.find(s => s.id === round.storyId);
    if (story) {
      const storyPreview = story.parts.map((part, index) => part + (story.blanks[index] || "")).join("");
      dbState.users.filter(user => !user.isAdmin && user.id !== story.userId).forEach(user => {
        if (!dbState.playerResults.some(result => result.userId === user.id && result.storyId === story.id)) {
          dbState.playerResults.push({
            userId: user.id,
            storyId: story.id,
            correctAnswer: story.answer,
            storyPreview,
            isCorrect: false,
            awardedPoints: 0
          });
        }
      });
      // Reveal the answer to everyone
      dbState.session.revealedStoryIds.push(story.id);
      dbState.session.lastRevealed = {
        storyId: story.id,
        answer: story.answer,
        storyPreview: story.parts[0] + (story.blanks[0] || "") + "…"
      };

      dbState.chat.push({
        id: `ann-${randomUUID()}`,
        userId: "system",
        username: "System",
        text: `🔔 Ronde ${round.roundIndex + 1} selesai! Jawaban: "${story.answer}". Persiapan ronde berikutnya...`,
        isAdmin: true,
        timestamp: Date.now()
      });
    }

    if (dbState.session.roundIndex >= dbState.session.mysteryIds.length) {
      dbState.session.phase = "ended";
      dbState.session.endedAt = Date.now();
    }
    
    // Trim arrays to prevent memory leaks
    if (dbState.chat.length > 500) {
      dbState.chat = dbState.chat.slice(dbState.chat.length - 500);
    }
    if (dbState.playerResults.length > 2000) {
      dbState.playerResults = dbState.playerResults.slice(dbState.playerResults.length - 2000);
    }
    
    await saveDB();
  }

  /** Returns session with fresh remainingMs computed from stored startTime. */
  function roundSafeSession(session?: Session) {
    const src = session ?? dbState.session;
    const s = { ...src, currentRound: src.currentRound ? { ...src.currentRound } : null };
    if (s.currentRound) {
      const elapsed = Date.now() - s.currentRound.startTime;
      s.currentRound.remainingMs = Math.max(0, ROUND_DURATION_MS - elapsed);
    }
    return s;
  }

  function scheduleServerRoundExpiry() {
    if (roundTimeoutTimer) clearTimeout(roundTimeoutTimer);
    
    roundTimeoutTimer = setTimeout(async () => {
      try {
        if (pool) {
          const client = await pool.connect();
          try {
            await client.query("BEGIN");
            const result = await client.query<{ state: DBState }>("SELECT state FROM app_state WHERE id = TRUE FOR UPDATE");
            if (result.rows[0]) {
              dbState = result.rows[0].state;
              normalizeDB();
              if (dbState.session.phase === "playing" && dbState.session.currentRound) {
                const elapsed = Date.now() - dbState.session.currentRound.startTime;
                if (elapsed >= ROUND_DURATION_MS) {
                  await endRound();
                }
              }
            }
            await client.query("COMMIT");
          } catch (err) {
            await client.query("ROLLBACK");
            console.error("[server-round-expiry-error]", err);
          } finally {
            client.release();
          }
        } else {
          // Local mode fallback
          if (dbState.session.phase === "playing" && dbState.session.currentRound) {
            const elapsed = Date.now() - dbState.session.currentRound.startTime;
            if (elapsed >= ROUND_DURATION_MS) {
              await endRound();
            }
          }
        }
      } catch (error) {
        console.error("Error ending round automatically on server:", error);
      }
    }, ROUND_DURATION_MS + 2000);
  }

  // Background auth tokens cleanup check every 10 minutes
  setInterval(async () => {
    try {
      const now = Date.now();
      if (pool) {
        const { state } = await getStateForRead(true);
        const activeTokens = (state.authTokens || []).filter(t => t.expiresAt > now);
        if (activeTokens.length !== (state.authTokens || []).length) {
          const client = await pool.connect();
          try {
            await client.query("BEGIN");
            const result = await client.query<{ state: DBState }>("SELECT state FROM app_state WHERE id = TRUE FOR UPDATE");
            if (result.rows[0]) {
              const currentDbState = result.rows[0].state;
              const originalLength = (currentDbState.authTokens || []).length;
              currentDbState.authTokens = (currentDbState.authTokens || []).filter(t => t.expiresAt > now);
              if (currentDbState.authTokens.length !== originalLength) {
                await client.query(
                  `UPDATE app_state SET state = $1::jsonb, updated_at = NOW() WHERE id = TRUE`,
                  [JSON.stringify(currentDbState)]
                );
                dbState = currentDbState;
                cachedDbState = currentDbState;
                lastLocalUpdate = Date.now();
              }
            }
            await client.query("COMMIT");
          } catch (err) {
            await client.query("ROLLBACK");
            console.error("Error during background token cleanup:", err);
          } finally {
            client.release();
          }
        }
      } else {
        const originalLength = (dbState.authTokens || []).length;
        dbState.authTokens = (dbState.authTokens || []).filter(t => t.expiresAt > now);
        if (dbState.authTokens.length !== originalLength) {
          await saveFileDB();
          lastLocalUpdate = Date.now();
        }
      }
    } catch (error) {
      console.error("Error in authTokens background cleanup:", error);
    }
  }, 10 * 60 * 1000);

  // ------------------------- Global Error Handler -------------------------
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error("[express-error]", err);
    // Do not leak internal details to the client.
    const message = process.env.NODE_ENV === "development" ? (err?.message || "Internal server error.") : "Internal server error.";
    if (!res.headersSent) {
      res.status(err?.statusCode || err?.status || 500).json({ error: message });
    }
  });

  // ------------------------- Vite setup -------------------------

  // Vercel menyajikan frontend statis sendiri; Function hanya membutuhkan API.
  if (process.env.VERCEL) return app;

  // Vite hanya dimuat pada server pengembangan lokal.
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  return app;
}

if (!process.env.VERCEL) {
  createApp().then(app => {
    const PORT = process.env.PORT ? Number(process.env.PORT) : 3001;
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  }).catch(error => {
    console.error("Server gagal dimulai:", error);
    process.exit(1);
  });
}
