import express from "express";
import path from "path";
import fs from "fs";
import "dotenv/config";
import { Pool } from "pg";
import { createServer as createViteServer } from "vite";
import { User, SubmittedStory, ChatMessage, GuessLog, StoryTemplate, GamePhase, PlayerAnswer, Session } from "./src/types";

// Standard preset templates — semua bertema proyek konstruksi & perusahaan
const PRESET_TEMPLATES: StoryTemplate[] = [
  {
    id: "temp-1",
    title: "Tentang Diriku",
    templateText: "Aku adalah seseorang yang dikenal ........., tetapi aku juga punya sifat buruk, yaitu......\nSaat senggang, waktuku habiskan untuk ...........dan.............\nAku juga punya kebiasaan unik, yaitu .........setiap kali..............\nSoal lingkungan, aku paling suka berada dalam situasi yang..............\ntetapi aku akan langsung merasa risih atau tidak nyaman jika berada dalam situasi yang.........\n\nNAMA :",
    parts: [
      "Aku adalah seseorang yang dikenal ",
      ", tetapi aku juga punya sifat buruk, yaitu",
      ".\nSaat senggang, waktuku habiskan untuk ",
      " dan ",
      ".\nAku juga punya kebiasaan unik, yaitu ",
      " setiap kali ",
      ".\nSoal lingkungan, aku paling suka berada dalam situasi yang",
      ".\ntetapi aku akan langsung merasa risih atau tidak nyaman jika berada dalam situasi yang.\n\nNAMA :"
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
      ".\nSebaliknya, aku paling malas atau ilfeel jika melihat orang yang perilakunya",
      ".\nUntuk urusan perut, aku sangat menyukai",
      ".\ntetapi aku akan langsung menghindari jika disajikan",
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
const ROUND_DURATION_MS = 30_000;
const DATABASE_URL = process.env.DATABASE_URL;
const pool = DATABASE_URL ? new Pool({ connectionString: DATABASE_URL }) : null;

const firstName = (value: string) => value.trim().split(/\s+/)[0];

// Local state
interface DBState {
  users: (User & { password?: string })[];
  stories: SubmittedStory[];
  chat: ChatMessage[];
  guessLogs: GuessLog[];
  session: Session;
  /** Per-player guesses for ended session results */
  playerResults: PlayerAnswer[];
}

let dbState: DBState = {
  users: [
    {
      id: "admin-uid",
      username: "admin",
      password: "admin123",
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
      text: "Selamat datang di Game Siapa Aku Multiplayer! Silakan daftar akun Anda atau masuk jika sudah punya. Admin: admin / admin123.",
      isAdmin: true,
      timestamp: Date.now()
    }
  ],
  guessLogs: [],
  session: { phase: "idle", sessionId: null, mysteryIds: [], totalMysteries: 0, endedAt: null, currentRound: null, roundIndex: 0, revealedStoryIds: [] },
  playerResults: []
};

function normalizeDB() {
  if (!dbState.session.revealedStoryIds) dbState.session.revealedStoryIds = [];
  if (dbState.session.lastRevealed === undefined) dbState.session.lastRevealed = undefined;
  dbState.users.forEach(user => { if (user.isReady === undefined) user.isReady = false; });

  const hasAdmin = dbState.users.some(u => u.username === "admin");
  if (!hasAdmin) {
    dbState.users.push({
      id: "admin-uid", username: "admin", password: "admin123", score: 100,
      solvedCount: 5, submittedCount: 2, isAdmin: true
    });
  } else {
    const adminObj = dbState.users.find(u => u.username === "admin")!;
    adminObj.isAdmin = true;
    adminObj.password = adminObj.password || "admin123";
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
          playerResults: parsed.playerResults || dbState.playerResults
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
  if (!pool) {
    loadFileDB();
    console.warn("DATABASE_URL tidak tersedia; memakai data-store.json.");
    return;
  }
  await pool.query(`CREATE TABLE IF NOT EXISTS app_state (id BOOLEAN PRIMARY KEY DEFAULT TRUE, state JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), CONSTRAINT one_state CHECK (id))`);
  const result = await pool.query<{ state: DBState }>("SELECT state FROM app_state WHERE id = TRUE");
  if (result.rowCount) dbState = result.rows[0].state;
  normalizeDB();
  await saveDB();
  console.info("PostgreSQL Neon terhubung.");
}

async function saveDB() {
  if (!pool) {
    saveFileDB();
    return;
  }
  try {
    await pool.query(`INSERT INTO app_state (id, state, updated_at) VALUES (TRUE, $1::jsonb, NOW()) ON CONFLICT (id) DO UPDATE SET state = EXCLUDED.state, updated_at = NOW()`, [JSON.stringify(dbState)]);
  } catch (error) {
    console.error("Error saving database state to PostgreSQL:", error);
  }
}

export async function createApp() {
  await initDatabase();
  const app = express();

  app.use(express.json());

  // Helper middleware to authenticate from Authorization header or custom simple token (user-id)
  const getRequestUser = (req: express.Request): (User & { password?: string }) | null => {
    const userId = req.headers["x-user-id"] as string;
    if (!userId) return null;
    return dbState.users.find(u => u.id === userId) || null;
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
  app.post("/api/auth/register", (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: "Username dan Password harus diisi." });
    }

    const trimmedUsername = firstName(username);
    if (trimmedUsername.length < 3) {
      return res.status(400).json({ error: "Nama depan minimal 3 karakter." });
    }

    const existingUser = dbState.users.find(
      u => u.username.toLowerCase() === trimmedUsername.toLowerCase()
    );
    if (existingUser) {
      return res.status(400).json({ error: "Username sudah terdaftar. Gunakan nama lain." });
    }

    const newUser: User & { password?: string } = {
      id: "u-" + Math.random().toString(36).substr(2, 9),
      username: trimmedUsername,
      password: password,
      score: 0,
      solvedCount: 0,
      submittedCount: 0,
      isAdmin: false
    };

    dbState.users.push(newUser);
    saveDB();

    // Strip password in response
    const { password: _, ...userSafe } = newUser;
    res.json({ user: userSafe });
  });

  // Authentication: Login
  app.post("/api/auth/login", (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: "Username dan Password harus diisi." });
    }

    const targetUser = dbState.users.find(
      u => u.username.toLowerCase() === username.trim().toLowerCase()
    );

    if (!targetUser || targetUser.password !== password) {
      return res.status(401).json({ error: "Username atau password salah." });
    }

    const { password: _, ...userSafe } = targetUser;
    res.json({ user: userSafe });
  });

  // Get current state (polling client state)
  app.get("/api/game/state", (req, res) => {
    const currentUser = getRequestUser(req);

    // Tutup ronde otomatis saat waktu habis. Polling pemain menjadi pemicunya.
    if (
      dbState.session.phase === "playing" &&
      dbState.session.currentRound &&
      Date.now() - dbState.session.currentRound.startTime >= ROUND_DURATION_MS
    ) {
      endRound();
    }
    
    // Format users for the leaderboard sorted by score desc
    const usersSafe = dbState.users.map(({ password: _, ...u }) => u);

    // Format stories: strip answers unless the requesting user is the owner, has solved it, or it's been revealed
    const storiesSafe = dbState.stories.map(story => {
      const canSeeAnswer = currentUser && (
        currentUser.id === story.userId || 
        story.isSolvedBy.includes(currentUser.id) ||
        dbState.session.revealedStoryIds.includes(story.id)
      );
      if (canSeeAnswer) {
        return story;
      }
      // Strip answer for guessing safety
      const { answer, ...storySafe } = story;
      const isActiveMystery = dbState.session.currentRound?.storyId === story.id;
      return isActiveMystery ? { ...storySafe, username: "Pemain Misterius" } : storySafe;
    });

    res.json({
      users: usersSafe,
      stories: storiesSafe,
      chat: dbState.chat,
      guessLogs: dbState.guessLogs,
      session: roundSafeSession(),
      // After session ended, include results for the requesting player
      myResults: dbState.session.phase === "ended" && currentUser
        ? dbState.playerResults.filter(r => r.userId === currentUser.id)
        : undefined
    });
  });

  // Add a story (Wizard 1 + Wizard 2 Submit)
  app.post("/api/game/story", (req, res) => {
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

    if (!templateId || !blanks || !answer) {
      return res.status(400).json({ error: "Template, isian cerita, dan jawaban harus lengkap." });
    }

    const template = PRESET_TEMPLATES.find(t => t.id === templateId);
    if (!template) {
      return res.status(400).json({ error: "Template cerita tidak valid." });
    }

    if (!Array.isArray(blanks) || blanks.length !== template.placeholders.length) {
      return res.status(400).json({ error: `Jumlah kolom isian cerita harus tepat ${template.placeholders.length} kosong.` });
    }

    // Check if any blank is empty
    const hasEmptyBlank = blanks.some(b => !b || b.trim() === "");
    if (hasEmptyBlank) {
      return res.status(400).json({ error: `Semua ${template.placeholders.length} kolom isian cerita harus diisi.` });
    }

    const trimmedAnswer = firstName(currentUser.username);
    if (trimmedAnswer.length < 1) {
      return res.status(400).json({ error: "Jawaban (Nama / Karakter) tidak boleh kosong." });
    }

    // Create the submitted story
    const newStory: SubmittedStory = {
      id: "story-" + Math.random().toString(36).substr(2, 9),
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
      id: "ann-" + Math.random().toString(36).substr(2, 9),
      userId: "system",
      username: "System",
      text: `🎉 ${currentUser.username} baru saja memublikasikan cerita misteri baru! Siapa dia sebenarnya? Coba tebak!`,
      isAdmin: true,
      timestamp: Date.now()
    };
    dbState.chat.push(systemAnnouncement);

    saveDB();
    res.json({ success: true, storyId: newStory.id });
  });

  // Post a guess
  app.post("/api/game/guess", (req, res) => {
    const currentUser = getRequestUser(req);
    if (!currentUser) {
      return res.status(401).json({ error: "Harap login untuk menebak." });
    }

    const { storyId, guessText } = req.body;
    if (!storyId || !guessText) {
      return res.status(400).json({ error: "Menebak memerlukan id cerita dan teks tebakan." });
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
      if (elapsed > ROUND_DURATION_MS) {
        return res.status(408).json({ error: "Waktu habis! Ronde sudah berakhir." });
      }
    } else {
      return res.status(403).json({ error: "Tidak ada sesi aktif. Tidak bisa menebak sekarang." });
    }

    if (story.userId === currentUser.id) {
      return res.status(400).json({ error: "Anda tidak bisa menebak cerita buatan sendiri!" });
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
      id: "guess-" + Math.random().toString(36).substr(2, 9),
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

    const awardedPoints = isCorrect ? Math.max(1, Math.ceil((ROUND_DURATION_MS - (Date.now() - dbState.session.currentRound!.startTime)) / 3_000)) : 0;
    log.awardedPoints = awardedPoints;

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
        id: "ann-" + Math.random().toString(36).substr(2, 9),
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
        id: "ann-" + Math.random().toString(36).substr(2, 9),
        userId: "system",
        username: "System-Tebak",
        text: `❌ Oh tidak! ${currentUser.username} menebak "${guessText.trim()}" untuk cerita ${story.username}, tapi salah! Coba lagi!`,
        isAdmin: true,
        timestamp: Date.now()
      };
      dbState.chat.push(wrongAnnouncement);
    }

    // Keep chat within limit
    if (dbState.chat.length > 200) {
      dbState.chat = dbState.chat.slice(dbState.chat.length - 200);
    }

    saveDB();
    res.json({ isCorrect, answer: isCorrect ? story.answer : undefined });
  });

  // Player: mark lobby readiness. A ready player has completed two stories.
  app.post("/api/game/lobby/ready", (req, res) => {
    const currentUser = getRequestUser(req);
    if (!currentUser || currentUser.isAdmin) return res.status(403).json({ error: "Hanya pemain yang dapat mengubah status siap." });
    if (dbState.session.sessionId && dbState.session.phase !== "ended") return res.status(409).json({ error: "Game sudah berjalan." });
    const storyCount = dbState.stories.filter(story => story.userId === currentUser.id).length;
    if (storyCount < 2) return res.status(400).json({ error: `Lengkapi 2 cerita dulu (${storyCount}/2).` });
    currentUser.isReady = !currentUser.isReady;
    saveDB();
    res.json({ isReady: currentUser.isReady });
  });

  // Post chat message
  app.post("/api/chat", (req, res) => {
    const currentUser = getRequestUser(req);
    if (!currentUser) {
      return res.status(401).json({ error: "Anda harus masuk terlebih dahulu untuk mengirim obrolan." });
    }

    const { text } = req.body;
    if (!text || text.trim() === "") {
      return res.status(400).json({ error: "Pesan tidak boleh kosong." });
    }

    const newMessage: ChatMessage = {
      id: "msg-" + Math.random().toString(36).substr(2, 9),
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

    saveDB();
    res.json(newMessage);
  });

  // Admin Route: Get full stories list (including answers)
  app.get("/api/admin/stories", (req, res) => {
    const currentUser = getRequestUser(req);
    if (!currentUser || !currentUser.isAdmin) {
      return res.status(403).json({ error: "Akses ditolak. Rute ini hanya untuk Admin." });
    }
    res.json(dbState.stories);
  });

  // Admin: edit a player. Locked while a game is running so answers stay consistent.
  app.patch("/api/admin/users/:userId", (req, res) => {
    const currentUser = getRequestUser(req);
    if (!currentUser?.isAdmin) return res.status(403).json({ error: "Akses ditolak." });
    if (dbState.session.phase === "playing") {
      return res.status(409).json({ error: "Akhiri ronde sebelum mengubah pemain." });
    }

    const user = dbState.users.find(u => u.id === req.params.userId);
    if (!user || user.isAdmin) return res.status(404).json({ error: "Pemain tidak ditemukan atau tidak dapat diubah." });

    const username = typeof req.body.username === "string" ? firstName(req.body.username) : "";
    const password = typeof req.body.password === "string" ? req.body.password.trim() : "";
    if (username.length < 3) return res.status(400).json({ error: "Nama depan minimal 3 karakter." });
    if (password && password.length < 4) return res.status(400).json({ error: "Password baru minimal 4 karakter." });
    if (dbState.users.some(u => u.id !== user.id && u.username.toLowerCase() === username.toLowerCase())) {
      return res.status(400).json({ error: "Nama depan sudah digunakan pemain lain." });
    }

    const previousName = user.username;
    user.username = username;
    if (password) user.password = password;
    dbState.stories.filter(s => s.userId === user.id).forEach(s => { s.username = username; s.answer = username; });
    dbState.chat.filter(m => m.userId === user.id).forEach(m => { m.username = username; });
    dbState.guessLogs.forEach(log => {
      if (log.userId === user.id) log.username = username;
      if (log.targetUsername === previousName) log.targetUsername = username;
    });
    saveDB();
    const { password: _, ...safeUser } = user;
    res.json({ user: safeUser });
  });

  // Admin: delete a player and every record owned by that player.
  app.delete("/api/admin/users/:userId", (req, res) => {
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
    saveDB();
    res.json({ success: true });
  });

  // Admin Route: Reset game
  app.post("/api/admin/reset", (req, res) => {
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

    saveDB();
    res.json({ success: true, message: "Semua data berhasil direset (users, stories, sessions, chat)." });
  });

  // ---------- Session endpoints ----------

  // Admin: Start game session (picks up to 25 random stories)
  app.post("/api/admin/session/start", (req, res) => {
    const currentUser = getRequestUser(req);
    if (!currentUser || !currentUser.isAdmin) {
      return res.status(403).json({ error: "Akses ditolak." });
    }

    const allStories = [...dbState.stories];
    if (allStories.length === 0) {
      return res.status(400).json({ error: "Belum ada cerita dari pemain. Minta pemain membuat cerita dulu." });
    }

    const players = dbState.users.filter(user => !user.isAdmin);
    const notReady = players.filter(user => !user.isReady || dbState.stories.filter(story => story.userId === user.id).length < 2);
    if (notReady.length) return res.status(400).json({ error: `Belum siap: ${notReady.map(user => user.username).join(", ")}. Setiap pemain wajib siap dan membuat 2 cerita.` });

    // Pick up to 25 random stories (shuffle + slice)
    const shuffled = [...allStories].sort(() => Math.random() - 0.5);
    const selected = shuffled.slice(0, Math.min(25, shuffled.length));

    dbState.session = {
      phase: "playing",
      sessionId: "sess-" + Math.random().toString(36).substr(2, 9),
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

    // Reset playerResults
    dbState.playerResults = [];

    // System announcement
    dbState.chat.push({
      id: "ann-" + Math.random().toString(36).substr(2, 9),
      userId: "system",
      username: "System",
      text: `🎮 GAME DIMULAI! Cerita pertama sudah tampil. Tebak nama depannya dalam 30 detik!`,
      isAdmin: true,
      timestamp: Date.now()
    });

    saveDB();
    res.json({ success: true, session: dbState.session });
  });

  // Admin: End session
  app.post("/api/admin/session/end", (req, res) => {
    const currentUser = getRequestUser(req);
    if (!currentUser || !currentUser.isAdmin) {
      return res.status(403).json({ error: "Akses ditolak." });
    }
    if (dbState.session.phase === "idle" && !dbState.session.sessionId) {
      return res.status(400).json({ error: "Tidak ada sesi aktif." });
    }

    endSession();
    res.json({ success: true, session: dbState.session });
  });

  // Player: Get my results (also available through game/state.myResults)
  app.get("/api/session/results", (req, res) => {
    const currentUser = getRequestUser(req);
    if (!currentUser) return res.status(401).json({ error: "Harap login." });
    const myResults = dbState.playerResults.filter(r => r.userId === currentUser.id);
    res.json({ results: myResults, session: dbState.session });
  });

  function endSession() {
    dbState.session.phase = "ended";
    dbState.session.endedAt = Date.now();
    dbState.session.currentRound = null;
    dbState.session.lastRevealed = undefined;

    // Reveal ALL session stories at session end
    for (const storyId of dbState.session.mysteryIds) {
      if (!dbState.session.revealedStoryIds.includes(storyId)) {
        dbState.session.revealedStoryIds.push(storyId);
      }
    }

    // Build PlayerAnswer for every player who guessed
    const players = dbState.users.filter(u => !u.isAdmin);
    const sessionStories = dbState.stories.filter(s => dbState.session.mysteryIds.includes(s.id));

    dbState.playerResults = [];
    for (const player of players) {
      for (const story of sessionStories) {
        const guess = dbState.guessLogs.find(
          g => g.userId === player.id && g.storyId === story.id
        );
        dbState.playerResults.push({
          userId: player.id,
          storyId: story.id,
          correctAnswer: story.answer,
          playerGuess: guess?.guessText,
          storyPreview: story.parts[0] + (story.blanks[0] || "") + "…",
          isCorrect: guess?.isCorrect ?? false
        });
      }
    }

    dbState.chat.push({
      id: "ann-" + Math.random().toString(36).substr(2, 9),
      userId: "system",
      username: "System",
      text: `🏁 SESI BERAKHIR! Admin telah mengakhiri sesi. Pemain bisa melihat hasil tebakan mereka.`,
      isAdmin: true,
      timestamp: Date.now()
    });

    saveDB();
  }

  // Modified reset endpoint — also clears session
  // (Replace the existing reset block) — see below

  // ---------- Round endpoints ----------

  // Admin: Start a round
  app.post("/api/admin/round/start", (req, res) => {
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
      id: "ann-" + Math.random().toString(36).substr(2, 9),
      userId: "system",
      username: "System",
      text: `⏳ RONDE ${dbState.session.roundIndex + 1}/${dbState.session.totalMysteries} DIMULAI! Tebak siapa karakter ini dalam 15 detik!`,
      isAdmin: true,
      timestamp: Date.now()
    });

    saveDB();
    res.json({ success: true, session: roundSafeSession() });
  });

  // Admin: End current round (before timer expires)
  app.post("/api/admin/round/end", (req, res) => {
    const currentUser = getRequestUser(req);
    if (!currentUser || !currentUser.isAdmin) {
      return res.status(403).json({ error: "Akses ditolak." });
    }
    if (dbState.session.phase !== "playing" || !dbState.session.currentRound) {
      return res.status(400).json({ error: "Tidak ada ronde aktif." });
    }

    endRound();
    res.json({ success: true, session: roundSafeSession() });
  });

  /** Closes the current round, advances roundIndex, reveals answer in chat */
  function endRound() {
    const round = dbState.session.currentRound!;
    const story = dbState.stories.find(s => s.id === round.storyId);

    dbState.session.phase = "idle";
    dbState.session.roundIndex += 1;
    dbState.session.currentRound = null;

    if (story) {
      // Reveal the answer to everyone
      dbState.session.revealedStoryIds.push(story.id);
      dbState.session.lastRevealed = {
        storyId: story.id,
        answer: story.answer,
        storyPreview: story.parts[0] + (story.blanks[0] || "") + "…"
      };

      dbState.chat.push({
        id: "ann-" + Math.random().toString(36).substr(2, 9),
        userId: "system",
        username: "System",
        text: `🔔 Ronde ${round.roundIndex + 1} selesai! Jawaban: "${story.answer}". Persiapan ronde berikutnya...`,
        isAdmin: true,
        timestamp: Date.now()
      });
    }

    // If no more mysteries, auto-end session
    if (dbState.session.roundIndex >= dbState.session.mysteryIds.length) {
      endSession();
    } else {
      saveDB();
    }
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

  // ------------------------- Vite setup -------------------------

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
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
