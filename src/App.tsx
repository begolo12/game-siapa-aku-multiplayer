import React, { useState, useEffect, useRef } from "react";
import { User, GameState } from "./types";
import Header from "./components/Header";
import Leaderboard from "./components/Leaderboard";
import ChatRoom from "./components/ChatRoom";
import StoryCreator from "./components/StoryCreator";
import StoryList from "./components/StoryList";
import AdminPanel from "./components/AdminPanel";
import { LogIn, UserPlus, HelpCircle, AlertCircle, ShieldCheck, Gamepad2, Info } from "lucide-react";

export default function App() {
  // Current user session
  const [currentUser, setCurrentUser] = useState<User | null>(null);

  // Active view tab
  const [activeTab, setActiveTab] = useState<string>("guess");

  // Game state synced via polling
  const [gameState, setGameState] = useState<GameState>({
    users: [],
    stories: [],
    chat: [],
    guessLogs: [],
    session: { phase: "idle", sessionId: null, mysteryIds: [], totalMysteries: 0, endedAt: null, currentRound: null, roundIndex: 0, revealedStoryIds: [] },
    myResults: undefined
  });

  // Auth Inputs
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(false);

  // Poll intervals ref
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Restore user session on mount
  useEffect(() => {
    const saved = localStorage.getItem("whoami_user");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed && parsed.id) {
          setCurrentUser(parsed);
        }
      } catch (e) {
        localStorage.removeItem("whoami_user");
      }
    }
  }, []);

  // Poll state function — skip update if data unchanged (prevents scroll-jump from unnecessary re-renders)
  const fetchGameState = async (userId: string) => {
    try {
      const res = await fetch("/api/game/state", {
        headers: {
          "x-user-id": userId
        }
      });
      if (res.ok) {
        const data = await res.json();

        // Shallow compare to skip re-render if nothing changed
        setGameState((prev) => {
          if (
            prev.session.phase === data.session.phase &&
            prev.session.roundIndex === data.session.roundIndex &&
            prev.users.length === data.users.length &&
            prev.stories.length === data.stories.length &&
            prev.chat.length === data.chat.length &&
            prev.guessLogs.length === data.guessLogs.length &&
            JSON.stringify(prev.myResults) === JSON.stringify(data.myResults)
          ) {
            return prev;
          }
          return data;
        });

        // Keep current user points updated too if they changed on server
        if (data.users) {
          const matched = data.users.find((u: User) => u.id === userId);
          if (matched) {
            setCurrentUser((prev) => {
              if (prev && prev.score !== matched.score) {
                const updated = { ...prev, ...matched };
                localStorage.setItem("whoami_user", JSON.stringify(updated));
                return updated;
              }
              return prev;
            });
          }
        }
      }
    } catch (err) {
      console.error("Kesalahan polling game state:", err);
    }
  };

  // Manage polling when user changes
  useEffect(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }

    if (currentUser) {
      // Fetch immediately
      fetchGameState(currentUser.id);
      
      // Setup interval every 2 seconds for high responsiveness
      pollIntervalRef.current = setInterval(() => {
        fetchGameState(currentUser.id);
      }, 2000);
    } else {
      setGameState({
        users: [],
        stories: [],
        chat: [],
        guessLogs: [],
        session: { phase: "idle", sessionId: null, mysteryIds: [], totalMysteries: 0, endedAt: null, currentRound: null, roundIndex: 0, revealedStoryIds: [] },
        myResults: undefined
      });
    }

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, [currentUser]);

  // Saat admin memulai ronde, semua pemain langsung melihat cerita aktif.
  useEffect(() => {
    if (gameState.session.phase === "playing") setActiveTab("guess");
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

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Terjadi kesalahan sistem.");
      }

      if (data.user) {
        setCurrentUser(data.user);
        localStorage.setItem("whoami_user", JSON.stringify(data.user));
        // Reset form
        setUsername("");
        setPassword("");
        setAuthError(null);
        setActiveTab("guess");
      }
    } catch (err: any) {
      setAuthError(err.message || "Gagal menghubungkan ke server.");
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("whoami_user");
    setCurrentUser(null);
    setActiveTab("guess");
  };

  // Game Action: Submit Story
  const handleStorySubmit = async (templateId: string, blanks: string[], answer: string) => {
    if (!currentUser) return;

    const response = await fetch("/api/game/story", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-user-id": currentUser.id
      },
      body: JSON.stringify({ templateId, blanks, answer })
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Gagal mempublikasikan cerita.");
    }

    // Refresh state immediately after submission
    fetchGameState(currentUser.id);
  };

  // Game Action: Guess Story
  const handleGuessStory = async (storyId: string, guessText: string) => {
    if (!currentUser) throw new Error("Silakan masuk terlebih dahulu.");

    const response = await fetch("/api/game/guess", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-user-id": currentUser.id
      },
      body: JSON.stringify({ storyId, guessText })
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Gagal mengirim tebakan.");
    }

    // Refresh state immediately
    fetchGameState(currentUser.id);
    return data; // returns { isCorrect, answer }
  };

  const handleLobbyReady = async () => {
    if (!currentUser) return;
    const response = await fetch("/api/game/lobby/ready", { method: "POST", headers: { "x-user-id": currentUser.id } });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Gagal mengubah status siap.");
    fetchGameState(currentUser.id);
  };

  // Game Action: Send Chat Message
  const handleSendMessage = async (text: string) => {
    if (!currentUser) return;

    const response = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-user-id": currentUser.id
      },
      body: JSON.stringify({ text })
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || "Gagal mengirim pesan chat.");
    }

    fetchGameState(currentUser.id);
  };

  // Game Action: Reset Game (Admin only)
  const handleResetGame = async () => {
    if (!currentUser?.isAdmin) return;

    const response = await fetch("/api/admin/reset", {
      method: "POST",
      headers: {
        "x-user-id": currentUser.id
      }
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || "Gagal mereset game.");
    }

    fetchGameState(currentUser.id);
  };

  // Session Action: Start Session (Admin only)
  const handleStartSession = async () => {
    if (!currentUser?.isAdmin) return;
    const res = await fetch("/api/admin/session/start", {
      method: "POST",
      headers: { "x-user-id": currentUser.id }
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || "Gagal memulai sesi.");
    }
    fetchGameState(currentUser.id);
  };

  // Session Action: End Session (Admin only)
  const handleEndSession = async () => {
    if (!currentUser?.isAdmin) return;
    const res = await fetch("/api/admin/session/end", {
      method: "POST",
      headers: { "x-user-id": currentUser.id }
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || "Gagal mengakhiri sesi.");
    }
    fetchGameState(currentUser.id);
  };

  // Round Action: Start Round (Admin only)
  const handleStartRound = async () => {
    if (!currentUser?.isAdmin) return;
    const res = await fetch("/api/admin/round/start", {
      method: "POST",
      headers: { "x-user-id": currentUser.id }
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || "Gagal memulai ronde.");
    }
    fetchGameState(currentUser.id);
  };

  // Round Action: End Round (Admin only)
  const handleEndRound = async () => {
    if (!currentUser?.isAdmin) return;
    const res = await fetch("/api/admin/round/end", {
      method: "POST",
      headers: { "x-user-id": currentUser.id }
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || "Gagal mengakhiri ronde.");
    }
    fetchGameState(currentUser.id);
  };

  return (
    <div className="min-h-screen bg-[#211b15] flex flex-col font-sans antialiased text-slate-200 selection:bg-pink-500 selection:text-white relative">

      {/* Top Header Navigation */}
      <Header
        currentUser={currentUser}
        onLogout={handleLogout}
      />

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-3 sm:px-6 lg:px-8 py-4 sm:py-8 pb-20 sm:pb-24 relative z-10">
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
                  <p className="font-semibold text-slate-200">Akun Admin Pre-Configured:</p>
                  <p className="mt-1">Username: <code className="font-mono font-bold text-pink-400">admin</code> | Sandi: <code className="font-mono font-bold text-pink-400">admin123</code></p>
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* GAME DASHBOARD (LOGGED IN) */
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 animate-fadeIn">
            
            {/* Left Content Area (Tebak Cerita or Buat Cerita) */}
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
                    stories={gameState.stories as any}
                    currentUser={currentUser}
                    users={gameState.users}
                    session={gameState.session}
                    onGuessStory={handleGuessStory}
                    onLobbyReady={handleLobbyReady}
                  />
                </div>
              )}

              {activeTab === "create" && (
                <StoryCreator
                  currentUser={currentUser}
                  onSubmitStory={handleStorySubmit}
                  userStoryCount={gameState.stories.filter(s => s.userId === currentUser.id).length}
                  userTemplateIds={gameState.stories.filter(s => s.userId === currentUser.id).map(s => s.templateId)}
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
                      <p className="text-2xl font-extrabold text-amber-400">{gameState.myResults.filter((r: any) => r.isCorrect).length * 4}</p>
                      <p className="text-[10px] text-amber-300 font-bold uppercase">Poin</p>
                    </div>
                  </div>

                  {/* Result list */}
                  <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
                    {gameState.myResults.map((r, i) => (
                      <div key={i} className={`border rounded-xl p-3 sm:p-4 text-sm transition-all ${r.isCorrect ? 'border-emerald-500/30 bg-emerald-950/20' : 'border-red-500/20 bg-red-950/10'}`}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1.5">
                              <span className="text-[10px] font-bold text-slate-500 font-mono bg-slate-800/50 px-1.5 py-0.5 rounded">#{i + 1}</span>
                              <p className="text-slate-300 italic text-xs leading-relaxed truncate">"{r.storyPreview}"</p>
                            </div>
                            <div className="flex flex-col sm:flex-row sm:flex-wrap gap-1 sm:gap-x-4 text-xs font-mono">
                              <span className="text-slate-400">Jawaban: <span className="text-emerald-400 font-bold">{r.correctAnswer}</span></span>
                              <span className="text-slate-400">Tebakanmu: <span className={r.isCorrect ? 'text-emerald-400 font-bold' : 'text-red-400 font-bold'}>{r.playerGuess || '—'}</span></span>
                            </div>
                          </div>
                          <span className={`shrink-0 w-8 h-8 flex items-center justify-center rounded-full text-sm font-bold ${r.isCorrect ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
                            {r.isCorrect ? '✓' : '✗'}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {activeTab === "admin" && currentUser.isAdmin && (
                <AdminPanel
                  currentUser={currentUser}
                  users={gameState.users}
                  session={gameState.session}
                  onResetGame={handleResetGame}
                  onStartRound={handleStartRound}
                  onEndRound={handleEndRound}
                />
              )}
            </div>

            {/* Right Sidebar Area (Leaderboard and Chat) */}
            <div className="lg:col-span-4 space-y-6">
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

            {(gameState.session.phase !== "playing" || currentUser.isAdmin) && (
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
  );
}
