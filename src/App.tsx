import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GameState, ROUND_DURATION_MS, SubmittedStory, User } from "./types";
import Header from "./components/Header";
import Leaderboard from "./components/Leaderboard";
import ChatRoom from "./components/ChatRoom";
import StoryCreator from "./components/StoryCreator";
import StoryList from "./components/StoryList";
import AdminPanel from "./components/AdminPanel";
import ErrorBoundary from "./components/ErrorBoundary";
import { LogIn, UserPlus, AlertCircle, Gamepad2, Info } from "lucide-react";
import { io, Socket } from "socket.io-client";

const emptyGameState = (): GameState => ({
  users: [],
  stories: [],
  chat: [],
  guessLogs: [],
  session: { phase: "idle", sessionId: null, mysteryIds: [], totalMysteries: 0, endedAt: null, currentRound: null, roundIndex: 0, revealedStoryIds: [], participantIds: [] },
  myResults: undefined
});

async function readResponseData(response: Response): Promise<any> {
  const text = await response.text();
  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Server mengirim respons yang tidak valid.");
  }
}

function authenticationHeaders(token: string | null, json = false) {
  if (!token) throw new Error("Sesi Anda sudah berakhir. Silakan masuk kembali.");
  return json
    ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
    : { Authorization: `Bearer ${token}` };
}
export default function App() {
  // Current user session
  const [currentUser, setCurrentUser] = useState<User | null>(null);

  // Active view tab
  const [activeTab, setActiveTab] = useState<string>("guess");
  const [expandedResult, setExpandedResult] = useState<number | null>(null);

  // Game state synced via conditional polling.
  const [gameState, setGameState] = useState<GameState>(emptyGameState);

  // Polling error tracking
  const [pollError, setPollError] = useState(false);

  // Auth inputs
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(false);

  const pollIntervalRef = useRef<number | null>(null);
  const pollAbortRef = useRef<AbortController | null>(null);
  const pollInFlightRef = useRef(false);
  const activeUserIdRef = useRef<string | null>(null);
  const authTokenRef = useRef<string | null>(null);
  const etagRef = useRef<string | null>(null);
  const expiredRoundRef = useRef<string | null>(null);
  const serverOffsetRef = useRef(0);
  const [serverOffsetMs, setServerOffsetMs] = useState(0);

  // WebSocket
  const socketRef = useRef<Socket | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const fallbackPollingRef = useRef(false);

  const syncServerClock = useCallback((serverTime: number | undefined, requestStartedAt: number) => {
    if (typeof serverTime !== "number") return;
    const offset = serverTime - (requestStartedAt + Date.now()) / 2;
    serverOffsetRef.current = offset;
    setServerOffsetMs(offset);
  }, []);

  // A user id alone is not a session credential. Older stored values are discarded.
  useEffect(() => {
    const saved = localStorage.getItem("whoami_session");
    if (!saved) {
      localStorage.removeItem("whoami_user");
      return;
    }

    try {
      const parsed = JSON.parse(saved);
      if (parsed?.user?.id && typeof parsed.token === "string" && parsed.token) {
        authTokenRef.current = parsed.token;
        setCurrentUser(parsed.user);
      } else {
        localStorage.removeItem("whoami_session");
      }
    } catch {
      localStorage.removeItem("whoami_session");
    }
  }, []);

  const fetchGameState = useCallback(async (userId: string, force = false) => {
    const token = authTokenRef.current;
    if (!token || activeUserIdRef.current !== userId) return;

    if (pollInFlightRef.current) {
      if (!force) return;
      pollAbortRef.current?.abort();
    }

    const controller = new AbortController();
    pollAbortRef.current = controller;
    pollInFlightRef.current = true;

    try {
      const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
      if (etagRef.current) headers["If-None-Match"] = etagRef.current;
      const url = force ? "/api/game/state?bypassCache=true" : "/api/game/state";
      const requestStartedAt = Date.now();
      const response = await fetch(url, { headers, signal: controller.signal });
      if (activeUserIdRef.current !== userId) return;
      if (response.status === 401) {
        authTokenRef.current = null;
        etagRef.current = null;
        localStorage.removeItem("whoami_session");
        setCurrentUser(null);
        setGameState(emptyGameState());
        return;
      }
      if (response.status === 304) {
        setPollError(false);
        return;
      }
      if (!response.ok) {
        const data = await readResponseData(response);
        throw new Error(data.error || "Gagal memuat status permainan.");
      }

      const newEtag = response.headers.get("etag");
      if (newEtag) etagRef.current = newEtag;
      const data = await readResponseData(response) as GameState;
      if (activeUserIdRef.current !== userId) return;

      syncServerClock(data.serverTime, requestStartedAt);
      setGameState(data);
      setPollError(false);


      const matched = data.users.find((user) => user.id === userId);
      if (matched) {
        setCurrentUser((previous) => {
          if (!previous || previous.id !== userId) return previous;
          if (
            previous.username === matched.username &&
            previous.score === matched.score &&
            previous.solvedCount === matched.solvedCount &&
            previous.submittedCount === matched.submittedCount &&
            previous.isAdmin === matched.isAdmin &&
            previous.isReady === matched.isReady &&
            previous.isEliminated === matched.isEliminated
          ) {
            return previous;
          }
          const updated = { ...previous, ...matched };
          localStorage.setItem("whoami_session", JSON.stringify({ user: updated, token }));
          return updated;
        });
      }
    } catch (error) {
      if ((error as DOMException).name !== "AbortError") {
        console.error("Kesalahan polling game state:", error);
        setPollError(true);
      }
    } finally {
      if (pollAbortRef.current === controller) {
        pollAbortRef.current = null;
        pollInFlightRef.current = false;
      }
    }
  }, [syncServerClock]);

  // Poll quickly while an armed round is collecting load acknowledgements, then
  // return to the normal active-session interval after the shared start is scheduled.
  useEffect(() => {
    const userId = currentUser?.id;
    activeUserIdRef.current = userId ?? null;
    etagRef.current = null;

    if (!userId || !authTokenRef.current) {
      setGameState(emptyGameState());
      return;
    }

    // Only poll if WebSocket is not connected (fallback mode)
    if (wsConnected) return;
    const sessionActive = !!gameState.session.sessionId;
    const pollIntervalMs = gameState.session.phase === "armed" ? 1_500 : sessionActive ? 2_000 : 5_000;

    const stopPolling = () => {
      if (pollIntervalRef.current !== null) {
        window.clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
    const startPolling = () => {
      if (document.hidden || pollIntervalRef.current !== null) return;
      void fetchGameState(userId);
      pollIntervalRef.current = window.setInterval(() => void fetchGameState(userId), pollIntervalMs);
    };
    const handleVisibility = () => {
      if (document.hidden) stopPolling();
      else startPolling();
    };

    document.addEventListener("visibilitychange", handleVisibility);
    startPolling();

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      stopPolling();
      if (activeUserIdRef.current === userId) {
        activeUserIdRef.current = null;
        pollAbortRef.current?.abort();
        pollAbortRef.current = null;
        pollInFlightRef.current = false;
      }
    };
  }, [currentUser?.id, gameState.session.phase, fetchGameState, wsConnected]);

  // WebSocket connection — primary real-time channel
  useEffect(() => {
    const token = authTokenRef.current;
    if (!token || !currentUser) return;

    const socket = io({
      auth: { token },
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });

    socketRef.current = socket;

    socket.on("connect", () => {
      console.log("[ws] Connected");
      setWsConnected(true);
      setPollError(false);
      fallbackPollingRef.current = false;
    });

    socket.on("disconnect", (reason) => {
      console.log("[ws] Disconnected:", reason);
      setWsConnected(false);
      // If server disconnected us (not transport issue), don't fallback
      if (reason === "io server disconnect") {
        socket.connect();
      }
    });

    socket.on("state:update", (newState: GameState) => {
      setGameState(newState);

      // Sync server clock
      if (newState.serverTime) {
        const offset = newState.serverTime - Date.now();
        serverOffsetRef.current = offset;
        setServerOffsetMs(offset);
      }

      // Update current user from state
      const matched = newState.users.find((user) => user.id === currentUser?.id);
      if (matched) {
        setCurrentUser((previous) => {
          if (!previous || previous.id !== currentUser?.id) return previous;
          if (
            previous.username === matched.username &&
            previous.score === matched.score &&
            previous.solvedCount === matched.solvedCount &&
            previous.submittedCount === matched.submittedCount &&
            previous.isAdmin === matched.isAdmin &&
            previous.isReady === matched.isReady &&
            previous.isEliminated === matched.isEliminated
          ) {
            return previous;
          }
          const updated = { ...previous, ...matched };
          localStorage.setItem("whoami_session", JSON.stringify({ user: updated, token }));
          return updated;
        });
      }
    });

    socket.on("connect_error", (err) => {
      console.warn("[ws] Connection error, falling back to polling:", err.message);
      setWsConnected(false);
      fallbackPollingRef.current = true;
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
      setWsConnected(false);
    };
  }, [currentUser?.id]);

  // The server publishes an immutable startTime. Expiry is scheduled from its
  // absolute deadline using the measured server-clock offset.
  useEffect(() => {
    const round = gameState.session.phase === "playing" ? gameState.session.currentRound : null;
    const userId = currentUser?.id;
    const token = authTokenRef.current;
    if (!round || !userId || !token) return;

    const expireRound = () => {
      if (expiredRoundRef.current === round.storyId || activeUserIdRef.current !== userId) return;
      expiredRoundRef.current = round.storyId;
      void fetch("/api/game/round/expire", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` }
      }).then((response) => {
        if (response.ok && activeUserIdRef.current === userId) {
          void fetchGameState(userId, true);
        }
      }).catch((error) => console.error("Gagal menutup ronde yang berakhir:", error));
    };

    const deadline = round.startTime === null ? null : round.startTime + ROUND_DURATION_MS;
    if (deadline === null) return;
    const remainingMs = deadline - (Date.now() + serverOffsetRef.current);
    if (remainingMs <= 0) {
      expireRound();
      return;
    }

    expiredRoundRef.current = null;
    const timeout = window.setTimeout(expireRound, remainingMs + 25);
    return () => window.clearTimeout(timeout);
  }, [currentUser?.id, fetchGameState, gameState.session.currentRound?.storyId, gameState.session.currentRound?.startTime, gameState.session.phase, serverOffsetMs]);

  // Saat admin memulai ronde, semua pemain langsung melihat cerita aktif.
  useEffect(() => {
    if (gameState.session.phase === "playing" || gameState.session.phase === "armed") setActiveTab("guess");
    if (gameState.session.phase === "ended" && gameState.myResults) setActiveTab("result");
  }, [gameState.session.phase, gameState.session.currentRound?.storyId]);

  // Auth: Handle Register / Login
  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);

    if (!username.trim() || !password) {
      setAuthError("Semua kolom harus diisi.");
      return;
    }

    setAuthLoading(true);
    const url = authMode === "login" ? "/api/auth/login" : "/api/auth/register";

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password })
      });
      const data = await readResponseData(response);
      if (!response.ok) throw new Error(data.error || "Terjadi kesalahan sistem.");
      if (!data.user?.id || typeof data.token !== "string" || !data.token) {
        throw new Error("Server tidak mengembalikan sesi yang valid.");
      }

      authTokenRef.current = data.token;
      localStorage.setItem("whoami_session", JSON.stringify({ user: data.user, token: data.token }));
      setCurrentUser(data.user);
      setUsername("");
      setPassword("");
      setActiveTab("guess");
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Gagal menghubungkan ke server.");
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = useCallback(() => {
    const token = authTokenRef.current;
    if (token) {
      void fetch("/api/auth/logout", { method: "POST", headers: authenticationHeaders(token) });
    }
    authTokenRef.current = null;
    socketRef.current?.disconnect();
    socketRef.current = null;
    setWsConnected(false);
    etagRef.current = null;
    localStorage.removeItem("whoami_session");
    localStorage.removeItem("whoami_user");
    setCurrentUser(null);
    setActiveTab("guess");
  }, []);

  const handleStorySubmit = useCallback(async (templateId: string, blanks: string[], answer: string) => {
    if (!currentUser) return;
    const response = await fetch("/api/game/story", {
      method: "POST",
      headers: authenticationHeaders(authTokenRef.current, true),
      body: JSON.stringify({ templateId, blanks, answer })
    });
    const data = await readResponseData(response) as GameState;
    if (!response.ok) throw new Error((data as any).error || "Gagal mempublikasikan cerita.");
    setGameState(data);


  }, [currentUser]);

  const handleStoryUpdate = useCallback(async (storyId: string, blanks: string[]) => {
    if (!currentUser) return;
    const response = await fetch(`/api/game/story/${storyId}`, {
      method: "PUT",
      headers: authenticationHeaders(authTokenRef.current, true),
      body: JSON.stringify({ blanks })
    });
    const data = await readResponseData(response) as GameState;
    if (!response.ok) throw new Error((data as any).error || "Gagal mengubah cerita.");
    setGameState(data);


  }, [currentUser]);

  const handleGuessStory = useCallback(async (storyId: string, guessText: string) => {
    if (!currentUser) throw new Error("Silakan masuk terlebih dahulu.");
    const response = await fetch("/api/game/guess", {
      method: "POST",
      headers: authenticationHeaders(authTokenRef.current, true),
      body: JSON.stringify({ storyId, guessText })
    });
    const data = await readResponseData(response);
    if (!response.ok) throw new Error(data.error || "Gagal mengirim tebakan.");
    if (data.gameState) {
      setGameState(data.gameState);
    }
    return { isCorrect: data.isCorrect, answer: data.answer };
  }, [currentUser]);

  const handleRoundReady = useCallback(async () => {
    if (!currentUser) return;
    const requestStartedAt = Date.now();
    const response = await fetch("/api/game/round/ready", {
      method: "POST",
      headers: authenticationHeaders(authTokenRef.current)
    });
    const data = await readResponseData(response) as GameState;
    if (response.ok && data) {
      syncServerClock(data.serverTime, requestStartedAt);
      setGameState(data);
    }
  }, [currentUser, syncServerClock]);

  const handleLobbyReady = useCallback(async () => {
    if (!currentUser) return;
    const response = await fetch("/api/game/lobby/ready", {
      method: "POST",
      headers: authenticationHeaders(authTokenRef.current)
    });
    const data = await readResponseData(response) as GameState;
    if (!response.ok) throw new Error((data as any).error || "Gagal mengubah status siap.");
    setGameState(data);


  }, [currentUser]);

  const handleSendMessage = useCallback(async (text: string) => {
    if (!currentUser) return;
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: authenticationHeaders(authTokenRef.current, true),
      body: JSON.stringify({ text })
    });
    const data = await readResponseData(response) as GameState;
    if (!response.ok) throw new Error((data as any).error || "Gagal mengirim pesan chat.");
    setGameState(data);


  }, [currentUser]);

  const handleResetGame = useCallback(async () => {
    if (!currentUser?.isAdmin) return;
    const response = await fetch("/api/admin/reset", {
      method: "POST",
      headers: authenticationHeaders(authTokenRef.current)
    });
    const data = await readResponseData(response) as GameState;
    if (!response.ok) throw new Error((data as any).error || "Gagal mereset game.");
    setGameState(data);


  }, [currentUser]);

  const handleRestartSession = useCallback(async () => {
    if (!currentUser?.isAdmin) return;
    const response = await fetch("/api/admin/session/restart", {
      method: "POST",
      headers: authenticationHeaders(authTokenRef.current)
    });
    const data = await readResponseData(response) as GameState;
    if (!response.ok) throw new Error((data as any).error || "Gagal me-restart sesi.");
    setGameState(data);


  }, [currentUser]);

  const handleStartSession = useCallback(async () => {
    if (!currentUser?.isAdmin) return;
    const response = await fetch("/api/admin/session/start", {
      method: "POST",
      headers: authenticationHeaders(authTokenRef.current)
    });
    const data = await readResponseData(response) as GameState;
    if (!response.ok) throw new Error((data as any).error || "Gagal memulai sesi.");
    setGameState(data);


  }, [currentUser]);

  const handleEndSession = useCallback(async () => {
    if (!currentUser?.isAdmin) return;
    const response = await fetch("/api/admin/session/end", {
      method: "POST",
      headers: authenticationHeaders(authTokenRef.current)
    });
    const data = await readResponseData(response) as GameState;
    if (!response.ok) throw new Error((data as any).error || "Gagal mengakhiri sesi.");
    setGameState(data);


  }, [currentUser]);

  const handleStartRound = useCallback(async () => {
    if (!currentUser?.isAdmin) return;
    const response = await fetch("/api/admin/round/start", {
      method: "POST",
      headers: authenticationHeaders(authTokenRef.current)
    });
    const data = await readResponseData(response) as GameState;
    if (!response.ok) throw new Error((data as any).error || "Gagal memulai ronde.");
    setGameState(data);


  }, [currentUser]);

  const handleEndRound = useCallback(async () => {
    if (!currentUser?.isAdmin) return;
    const response = await fetch("/api/admin/round/end", {
      method: "POST",
      headers: authenticationHeaders(authTokenRef.current)
    });
    const data = await readResponseData(response) as GameState;
    if (!response.ok) throw new Error((data as any).error || "Gagal mengakhiri ronde.");
    setGameState(data);


  }, [currentUser]);

  const currentUserStories = useMemo(() => {
    if (!currentUser) return [];
    return gameState.stories.filter(s => s.userId === currentUser.id);
  }, [gameState.stories, currentUser]);

  const userStoryCount = useMemo(() => currentUserStories.length, [currentUserStories]);
  const userTemplateIds = useMemo(() => currentUserStories.map(s => s.templateId), [currentUserStories]);
  const userStories = useMemo(() => currentUserStories as SubmittedStory[], [currentUserStories]);

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-[#211b15] flex flex-col font-sans antialiased text-slate-200 selection:bg-pink-500 selection:text-white relative">

      {/* Top Header Navigation */}
      <Header
        currentUser={currentUser}
        onLogout={handleLogout}
      />

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-3 sm:px-6 lg:px-8 py-4 sm:py-8 pb-20 sm:pb-24 relative z-10">
        {pollError && (
          <div className="bg-rose-950/40 border border-rose-500/20 text-rose-300 px-4 py-3 rounded-2xl mb-6 text-xs font-semibold flex items-center gap-2 animate-pulse" role="alert">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 animate-spin" style={{ animationDuration: '3s' }} />
            <span>Koneksi ke server terganggu. Sedang mencoba menghubungkan kembali...</span>
          </div>
        )}
        {!currentUser ? (
          /* AUTHENTICATION SCREEN */
          <div className="max-w-md mx-auto my-6 sm:my-12 animate-fadeIn relative">
            {/* Decorative background orbs */}
            <div className="absolute -top-20 -left-20 w-64 h-64 bg-pink-500/8 rounded-full blur-3xl pointer-events-none" />
            <div className="absolute -bottom-20 -right-20 w-64 h-64 bg-amber-500/8 rounded-full blur-3xl pointer-events-none" />

            <div className="text-center mb-8 relative">
              <div className="inline-flex bg-gradient-to-tr from-pink-500 via-purple-600 to-indigo-600 p-3 sm:p-5 rounded-3xl shadow-xl shadow-pink-500/15 text-white mb-4 animate-float">
                <Gamepad2 className="w-8 h-8 sm:w-10 sm:h-10 text-yellow-300" />
              </div>
              <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight bg-gradient-to-r from-pink-400 via-amber-300 to-cyan-400 bg-clip-text text-transparent">
                Siapa Aku? (Who Am I)
              </h2>
              <p className="text-sm text-slate-400 mt-2 max-w-sm mx-auto leading-relaxed">
                Tulis cerita rahasiamu. Saat admin memulai game, pemain lain membaca petunjuk lalu memilih nama depanmu.
              </p>
            </div>

            {/* Auth Card */}
            <div className="bg-[#2b241c]/80 backdrop-blur-xl rounded-3xl border border-slate-800/80 p-5 sm:p-8 shadow-2xl relative overflow-hidden glass">
              <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-pink-500 via-purple-600 to-amber-500"></div>
              <div className="absolute top-0 left-0 right-0 h-32 bg-gradient-to-b from-pink-500/5 to-transparent pointer-events-none" />

              {/* Tabs register vs login */}
              <div className="flex border-b border-slate-800 mb-6 pb-2">
                <button
                  id="tab-login-mode"
                  onClick={() => {
                    setAuthMode("login");
                    setAuthError(null);
                  }}
                  className={`flex-1 pb-3 text-center text-sm font-bold transition-all border-b-2 ${
                    authMode === "login"
                      ? "border-pink-500 text-pink-400"
                      : "border-transparent text-slate-500 hover:text-slate-300"
                  }`}
                >
                  Masuk Akun
                </button>
                <button
                  id="tab-register-mode"
                  onClick={() => {
                    setAuthMode("register");
                    setAuthError(null);
                  }}
                  className={`flex-1 pb-3 text-center text-sm font-bold transition-all border-b-2 ${
                    authMode === "register"
                      ? "border-pink-500 text-pink-400"
                      : "border-transparent text-slate-500 hover:text-slate-300"
                  }`}
                >
                  Daftar Baru
                </button>
              </div>

              {authError && (
                <div className="mb-4 bg-rose-950/50 border border-rose-900/50 text-rose-200 p-3 rounded-xl flex items-start gap-2 text-xs">
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  <span>{authError}</span>
                </div>
              )}

              {/* Form */}
              <form onSubmit={handleAuthSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold uppercase text-slate-400 tracking-wide mb-1">
                    Nama Depan
                  </label>
                  <input
                    id="auth-username"
                    type="text"
                    required
                    placeholder="Contoh: Budi"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="w-full text-sm bg-slate-900/60 border border-slate-800 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-pink-500 focus:bg-slate-900 transition-all"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase text-slate-400 tracking-wide mb-1">
                    Password
                  </label>
                  <input
                    id="auth-password"
                    type="password"
                    required
                    placeholder="Kata sandi rahasia..."
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full text-sm bg-slate-900/60 border border-slate-800 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-pink-500 focus:bg-slate-900 transition-all"
                  />
                </div>

                <button
                  id="auth-submit-btn"
                  type="submit"
                  disabled={authLoading}
                  className="w-full mt-6 bg-gradient-to-r from-pink-500 via-purple-600 to-indigo-600 hover:from-pink-600 hover:via-purple-700 hover:to-indigo-700 text-white font-bold py-3 px-4 rounded-xl transition-all duration-200 shadow-lg shadow-pink-500/15 hover:shadow-pink-500/25 hover:scale-[1.02] active:scale-[0.98] flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:hover:scale-100"
                >
                  {authMode === "login" ? (
                    <>
                      <LogIn className="w-4 h-4" /> {authLoading ? "Masuk..." : "Masuk"}
                    </>
                  ) : (
                    <>
                      <UserPlus className="w-4 h-4" /> {authLoading ? "Mendaftar..." : "Daftar Akun"}
                    </>
                  )}
                </button>
              </form>

              {/* Informational Tip */}
              <div className="mt-6 pt-6 border-t border-slate-850 flex items-start gap-2.5 text-xs text-slate-400">
                <Info className="w-4 h-4 text-pink-400 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-slate-200">Masuk dengan akun yang terdaftar</p>
                  <p className="mt-1">Hubungi penyelenggara permainan jika Anda memerlukan akses administrator.</p>
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* GAME DASHBOARD (LOGGED IN) */
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 animate-fadeIn">
            
            {/* Left Content Area (Tebak Cerita or Buat Cerita) */}
            {(activeTab !== "guess" || gameState.session.phase === "playing" || gameState.session.phase === "armed" || gameState.session.lastRevealed) && (
              <div className="lg:col-span-8 space-y-6">

              {/* Active Tab Component */}
              {activeTab === "guess" && (
                <div className="space-y-4">
                  <div className="flex flex-col gap-1">
                    <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
                      <span className="text-gradient-warm">Mulai Tebak Cerita</span>
                    </h2>
                    <p className="text-sm text-slate-400">Baca cerita aktif, lalu pilih nama depan pemain melalui autocomplete.</p>
                  </div>
                  <StoryList
                    stories={gameState.stories}
                    currentUser={currentUser}
                    users={gameState.users}
                    session={gameState.session}
                    onGuessStory={handleGuessStory}
                    onLobbyReady={handleLobbyReady}
                    onRoundReady={handleRoundReady}
                    serverOffsetMs={serverOffsetMs}
                  />
                </div>
              )}

              {activeTab === "create" && (
                <StoryCreator
                  currentUser={currentUser}
                  onSubmitStory={handleStorySubmit}
                  onUpdateStory={handleStoryUpdate}
                  userStoryCount={userStoryCount}
                  userTemplateIds={userTemplateIds}
                  userStories={userStories}
                />
              )}

              {activeTab === "result" && gameState.myResults && (
                <div className="bg-[#2b241c]/80 backdrop-blur-md border border-amber-500/20 rounded-2xl p-4 sm:p-6 shadow-xl animate-fadeIn relative overflow-hidden">
                  <div className="absolute top-0 left-0 right-0 h-24 bg-gradient-to-b from-amber-500/5 to-transparent pointer-events-none" />
                  {/* Header */}
                  <div className="flex items-center gap-3 mb-5">
                    <span className="text-3xl">🏆</span>
                    <div>
                      <h2 className="text-lg sm:text-xl font-bold text-white">Hasil Sesi</h2>
                      <p className="text-xs text-slate-400">{gameState.myResults.length} misteri dijawab</p>
                    </div>
                  </div>

                  {/* Summary cards */}
                  <div className="grid grid-cols-3 gap-3 mb-5">
                    <div className="bg-emerald-950/30 border border-emerald-500/20 rounded-xl p-3 text-center">
                      <p className="text-2xl font-extrabold text-emerald-400">{gameState.myResults.filter((r: any) => r.isCorrect).length}</p>
                      <p className="text-[10px] text-emerald-300 font-bold uppercase">Benar</p>
                    </div>
                    <div className="bg-red-950/30 border border-red-500/20 rounded-xl p-3 text-center">
                      <p className="text-2xl font-extrabold text-red-400">{gameState.myResults.filter((r: any) => !r.isCorrect).length}</p>
                      <p className="text-[10px] text-red-300 font-bold uppercase">Salah</p>
                    </div>
                    <div className="bg-amber-950/30 border border-amber-500/20 rounded-xl p-3 text-center">
                      <p className="text-2xl font-extrabold text-amber-400">{gameState.myResults.reduce((total, result) => total + result.awardedPoints, 0)}</p>
                      <p className="text-[10px] text-amber-300 font-bold uppercase">Poin</p>
                    </div>
                  </div>

                  {/* Result list */}
                  <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
                    {gameState.myResults.map((r, i) => (
                      <article
                        key={r.storyId}
                        className={`w-full border rounded-xl p-3 text-left sm:p-4 text-sm ${r.isCorrect ? 'border-emerald-500/30 bg-emerald-950/20' : 'border-red-500/20 bg-red-950/10'}`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1.5">
                              <span className="text-[10px] font-bold text-slate-500 font-mono bg-slate-800/50 px-1.5 py-0.5 rounded">#{i + 1}</span>
                              <span className={`text-[10px] font-bold ${r.isCorrect ? 'text-emerald-400' : 'text-red-400'}`}>{r.isCorrect ? `+${r.awardedPoints} poin` : '0 poin'}</span>
                            </div>
                            <button
                              type="button"
                              onClick={() => setExpandedResult(expandedResult === i ? null : i)}
                              aria-expanded={expandedResult === i}
                              className="w-full text-left"
                            >
                              <p className={`text-slate-300 italic text-xs leading-relaxed mb-2 ${expandedResult === i ? 'whitespace-pre-wrap' : 'truncate'}`}>"{r.storyPreview}"</p>
                              <span className="text-[10px] font-bold text-amber-400">{expandedResult === i ? 'Tutup cerita' : 'Lihat cerita lengkap'}</span>
                            </button>
                            <div className="flex flex-col sm:flex-row sm:flex-wrap gap-1 sm:gap-x-4 text-xs font-mono">
                              <span className="text-slate-400">Jawaban: <span className="text-emerald-400 font-bold">{r.correctAnswer}</span></span>
                              <span className="text-slate-400">Tebakanmu: <span className={r.isCorrect ? 'text-emerald-400 font-bold' : 'text-red-400 font-bold'}>{r.playerGuess || '—'}</span></span>
                            </div>
                          </div>
                          <span className={`shrink-0 w-8 h-8 flex items-center justify-center rounded-full text-sm font-bold ${r.isCorrect ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
                            {r.isCorrect ? '✓' : '✗'}
                          </span>
                        </div>
                      </article>
                    ))}
                  </div>
                </div>
              )}

              {activeTab === "admin" && currentUser.isAdmin && (
                <AdminPanel
                  currentUser={currentUser}
                  users={gameState.users}
                  stories={gameState.stories}
                  session={gameState.session}
                  onResetGame={handleResetGame}
                  onRestartSession={handleRestartSession}
                  authToken={authTokenRef.current ?? ""}
                  onStartSession={handleStartSession}
                  onEndSession={handleEndSession}
                  onStartRound={handleStartRound}
                  onEndRound={handleEndRound}
                  serverOffsetMs={serverOffsetMs}
                />
              )}
              </div>
            )}

            {/* Right Sidebar Area (Leaderboard and Chat) */}
            <div className={`${activeTab === "guess" && gameState.session.phase !== "playing" ? "lg:col-span-12" : "lg:col-span-4"} space-y-6`}>
              {/* Leaderboard Card */}
              <Leaderboard
                users={gameState.users}
                currentUserId={currentUser.id}
              />

              {/* Chat Room Card */}
              <ChatRoom
                chat={gameState.chat}
                currentUser={currentUser}
                onSendMessage={handleSendMessage}
              />
            </div>

          </div>
        )}
      </main>

      {/* Footer — hidden on mobile where bottom bar is sufficient */}
      <footer className="hidden sm:block bg-[#080214]/90 border-t border-slate-900/60 py-6 mt-12 text-center text-xs text-slate-500 font-mono relative z-10">
        <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-slate-800/30 to-transparent" />
        <p>Game Siapa Aku Multiplayer © {new Date().getFullYear()}</p>
        <p className="mt-1 text-[10px] text-pink-500/40">Bangun dengan React 19, Express, & Tailwind CSS v4</p>
      </footer>

      {/* Fixed Bottom Navigation Bar */}
      {currentUser && (
        <div className="fixed bottom-0 left-0 right-0 z-50 bg-[#1a1510]/95 backdrop-blur-xl border-t border-slate-800/60 safe-area-bottom">
          <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-pink-500/20 to-transparent" />
          <div className="max-w-7xl mx-auto flex items-stretch justify-around px-2 py-1.5">
            <button
              id="bar-tab-guess"
              onClick={() => setActiveTab("guess")}
              className={`flex flex-col items-center justify-center gap-0.5 flex-1 py-2 rounded-xl transition-all duration-200 ${
                activeTab === "guess"
                  ? "text-pink-400 bg-pink-500/10"
                  : "text-slate-500 hover:text-slate-300"
              }`}
            >
              <span className={`text-xl leading-none transition-transform duration-200 ${activeTab === "guess" ? "scale-110" : ""}`}>🕵️‍♂️</span>
              <span className="text-[10px] font-bold">Tebak</span>
              {activeTab === "guess" && <span className="w-5 h-0.5 rounded-full bg-pink-400 mt-0.5" />}
            </button>

            {(!gameState.session.sessionId || gameState.session.phase === "ended" || currentUser?.isAdmin) && (
              <button
                id="bar-tab-create"
                onClick={() => setActiveTab("create")}
                className={`flex flex-col items-center justify-center gap-0.5 flex-1 py-2 rounded-xl transition-all duration-200 ${
                  activeTab === "create"
                    ? "text-purple-400 bg-purple-500/10"
                    : "text-slate-500 hover:text-slate-300"
                }`}
              >
                <span className={`text-xl leading-none transition-transform duration-200 ${activeTab === "create" ? "scale-110" : ""}`}>📝</span>
                <span className="text-[10px] font-bold">Buat</span>
                {activeTab === "create" && <span className="w-5 h-0.5 rounded-full bg-purple-400 mt-0.5" />}
              </button>
            )}

            {gameState.session.phase === "ended" && gameState.myResults && (
              <button
                id="bar-tab-result"
                onClick={() => setActiveTab("result")}
                className={`flex flex-col items-center justify-center gap-0.5 flex-1 py-2 rounded-xl transition-all duration-200 ${
                  activeTab === "result"
                    ? "text-amber-400 bg-amber-500/10"
                    : "text-slate-500 hover:text-slate-300"
                }`}
              >
                <span className={`text-xl leading-none transition-transform duration-200 ${activeTab === "result" ? "scale-110" : ""}`}>🏆</span>
                <span className="text-[10px] font-bold">Hasil</span>
                {activeTab === "result" && <span className="w-5 h-0.5 rounded-full bg-amber-400 mt-0.5" />}
              </button>
            )}

            {currentUser.isAdmin && (
              <button
                id="bar-tab-admin"
                onClick={() => setActiveTab("admin")}
                className={`flex flex-col items-center justify-center gap-0.5 flex-1 py-2 rounded-xl transition-all duration-200 ${
                  activeTab === "admin"
                    ? "text-red-400 bg-red-500/10"
                    : "text-slate-500 hover:text-slate-300"
                }`}
              >
                <span className={`text-xl leading-none transition-transform duration-200 ${activeTab === "admin" ? "scale-110" : ""}`}>🛡️</span>
                <span className="text-[10px] font-bold">Admin</span>
                {activeTab === "admin" && <span className="w-5 h-0.5 rounded-full bg-red-400 mt-0.5" />}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
    </ErrorBoundary>
  );
}
