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
      max: process.env.VERCEL ? 1 : 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      allowExitOnIdle: true,
    })
  : null;
const scrypt = promisify(scryptCallback);
const requestDatabase = new AsyncLocalStorage<{ client: PoolClient }>();

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
function loadFileDB() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const data = fs.readFileSync(DB_FILE, "utf-8");
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
        saveFileDB();
      }
    } else {
      normalizeDB();
      saveFileDB();
    }
  } catch (error) {
    console.error("Error loading database file, keeping in-memory state:", error);
  }
}

// Save database to file
function saveFileDB() {
  try {
    const dir = path.dirname(DB_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(DB_FILE, JSON.stringify(dbState, null, 2), "utf-8");
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
    loadFileDB();
    await migrateLegacyPasswords();
    saveFileDB();
    console.warn("DATABASE_URL tidak tersedia; memakai data-store.json.");
    return;
  }
  await pool.query(`CREATE TABLE IF NOT EXISTS app_state (id BOOLEAN PRIMARY KEY DEFAULT TRUE, state JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), CONSTRAINT one_state CHECK (id))`);
  await pool.query(`INSERT INTO app_state (id, state) VALUES (TRUE, $1::jsonb) ON CONFLICT (id) DO NOTHING`, [JSON.stringify(dbState)]);
  const result = await pool.query<{ state: DBState }>("SELECT state FROM app_state WHERE id = TRUE");
  dbState = result.rows[0].state;
  const storedState = JSON.stringify(dbState);
  normalizeDB();
  await migrateLegacyPasswords();
  if (JSON.stringify(dbState) !== storedState) {
    await pool.query(`UPDATE app_state SET state = $1::jsonb, updated_at = NOW() WHERE id = TRUE`, [JSON.stringify(dbState)]);
  }
  console.info("PostgreSQL Neon terhubung.");
}

/** Persists the request's serialized state before its response is committed. */
async function persistState() {
  if (!pool) {
    saveFileDB();
    return;
  }
  const context = requestDatabase.getStore();
  await (context?.client || pool).query(
    `UPDATE app_state SET state = $1::jsonb, updated_at = NOW() WHERE id = TRUE`,
    [JSON.stringify(dbState)]
  );
}

async function saveDB() {
  try {
    await persistState();
  } catch (error) {
    console.error("[saveDB] Failed to persist state:", error);
    throw error;
  }
}

async function saveDBNow() {
  try {
    await persistState();
  } catch (error) {
    console.error("[saveDBNow] Failed to persist state:", error);
    throw error;
  }
}

export async function createApp() {
  await initDatabase();
  const app = express();

  app.use(express.json({ limit: "32kb" }));

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
      const result = await pool.query<{ state: DBState }>("SELECT state FROM app_state WHERE id = TRUE");
      if (!result.rows[0]) throw new Error("app_state is missing");
      res.locals.state = result.rows[0].state;
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
      if (req.method === "GET") return next();
      const client = await pool.connect();
      let settled = false;
      const finalize = async (commit: boolean) => {
        if (settled) return;
        settled = true;
        try {
          await client.query(commit ? "COMMIT" : "ROLLBACK");
        } finally {
          client.release();
        }
      };
      try {
        await client.query("BEGIN");
        const result = await client.query<{ state: DBState }>("SELECT state FROM app_state WHERE id = TRUE FOR UPDATE");
        if (!result.rows[0]) throw new Error("app_state is missing");
        dbState = result.rows[0].state;
        normalizeDB();

        const originalEnd = res.end.bind(res);
        res.end = ((...args: Parameters<express.Response["end"]>) => {
          void finalize(true).then(() => originalEnd(...args)).catch(next);
          return res;
        }) as express.Response["end"];
        res.once("close", () => {
          if (!settled) void finalize(false);
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
    const currentUser = getRequestUser(req, state);
    const usersSafe = state.users.map(({ password: _, passwordHash: __, ...user }) => user);
    const storiesSafe = state.stories.map(story => {
      const canSeeAnswer = currentUser && (
        currentUser.id === story.userId ||
        story.isSolvedBy.includes(currentUser.id) ||
        state.session.revealedStoryIds.includes(story.id)
      );
      if (canSeeAnswer) return story;
      const { answer, userId, ...storySafe } = story;
      const isActiveMystery = state.session.currentRound?.storyId === story.id;
      return isActiveMystery ? { ...storySafe, username: "Pemain Misterius" } : storySafe;
    });
    // Keep this payload stable between writes so conditional polling can return 304.
    // The client derives its countdown from the immutable round start time.
    const session = state.session;
    const activeStoryId = state.session.currentRound?.storyId;
    const body = {
      users: usersSafe,
      stories: storiesSafe,
      chat: state.chat,
      guessLogs: state.guessLogs.map(log => log.storyId === activeStoryId ? { ...log, targetUsername: "Pemain Misterius" } : log),
      session,
      myResults: state.session.phase === "ended" && currentUser
        ? state.playerResults.filter(result => result.userId === currentUser.id)
        : undefined
    };
    const etag = `"${createHash("sha256").update(JSON.stringify(body)).digest("base64url")}"`;
    res.set("ETag", etag);
    res.set("Cache-Control", "no-store");
    if (req.headers["if-none-match"] === etag) return res.status(304).end();
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
    res.json({ success: true, storyId: newStory.id });
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
    res.json({ success: true });
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
        await endRound();
        return res.status(408).json({ error: "Waktu habis! Ronde sudah berakhir." });
      }
    } else {
      return res.status(403).json({ error: "Tidak ada sesi aktif. Tidak bisa menebak sekarang." });
    }

    if (story.userId === currentUser.id) {
      return res.status(403).json({ error: "Anda tidak dapat menebak cerita sendiri." });
    }
    if (dbState.guessLogs.some(log => log.userId === currentUser.id && log.storyId === storyId && dbState.session.mysteryIds.includes(log.storyId))) {
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
    if (dbState.guessLogs.length > 100) {
      dbState.guessLogs = dbState.guessLogs.slice(0, 100);
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
    if (dbState.chat.length > 200) {
      dbState.chat = dbState.chat.slice(dbState.chat.length - 200);
    }

    await saveDB();
    res.json({ isCorrect, answer: isCorrect ? story.answer : undefined });
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
    res.json({ isReady: currentUser.isReady });
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
    await saveDB();
    res.json(newMessage);
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
    await saveDBNow();
    res.json({ success: true, message: "Semua data berhasil direset (users, stories, sessions, chat)." });
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

    await saveDBNow();
    res.json({ success: true, session: dbState.session });
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
    res.json({ success: true, session: dbState.session });
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
    await saveDBNow();
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

    await saveDBNow();
    res.json({ success: true, session: roundSafeSession() });
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
    res.json({ success: true, session: roundSafeSession() });
  }));
  // Any authenticated player may finalize an elapsed round; server time remains authoritative.
  app.post("/api/game/round/expire", asyncHandler(async (req, res) => {
    if (!getRequestUser(req)) return res.status(401).json({ error: "Harap login." });
    const round = dbState.session.currentRound;
    if (dbState.session.phase !== "playing" || !round) {
      return res.status(409).json({ error: "Tidak ada ronde aktif." });
    }
    if (Date.now() - round.startTime < ROUND_DURATION_MS) {
      return res.status(409).json({ error: "Waktu ronde belum habis." });
    }
    await endRound();
    res.json({ success: true, session: roundSafeSession() });
  }));


  /** Closes the current round, advances roundIndex, reveals answer in chat */
  async function endRound() {
    const round = dbState.session.currentRound!;
    const story = dbState.stories.find(s => s.id === round.storyId);

    dbState.session.phase = "idle";
    dbState.session.roundIndex += 1;
    dbState.session.currentRound = null;

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
    if (dbState.chat.length > 200) {
      dbState.chat = dbState.chat.slice(dbState.chat.length - 200);
    }
    await saveDBNow();
  }

  /** Returns session without exposing raw startTime (uses remainingMs) */
  function roundSafeSession() {
    const s = { ...dbState.session };
    if (s.currentRound) {
      const elapsed = Date.now() - s.currentRound.startTime;
      s.currentRound = {
        ...s.currentRound,
        remainingMs: Math.max(0, ROUND_DURATION_MS - elapsed)
      };
    }
    return s;
  }

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
