import React, { useState, useEffect, memo, useMemo, useCallback, useRef } from "react";
import { SubmittedStory, User, Session } from "../types";
import { CheckCircle2, Send, HelpCircle, Calendar, Filter, User as UserIcon, Sparkles, Timer, Loader2 } from "lucide-react";

const ROUND_SECONDS = 30;

const formatDate = (timestamp: number) => {
  const d = new Date(timestamp);
  return d.toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  });
};

interface StoryListProps {
  stories: SubmittedStory[];
  currentUser: User | null;
  users: User[];
  session: Session;
  onGuessStory: (storyId: string, guessText: string) => Promise<{ isCorrect: boolean; answer?: string }>;
  onLobbyReady: () => Promise<void>;
  onRoundReady: () => Promise<void>;
}

const StoryList = memo(function StoryList({ stories, currentUser, users, session, onGuessStory, onLobbyReady, onRoundReady }: StoryListProps) {
  const [guesses, setGuesses] = useState<{ [storyId: string]: string }>({});
  const [feedback, setFeedback] = useState<{ [storyId: string]: { isCorrect: boolean; message: string } }>({});
  const [submitting, setSubmitting] = useState<{ [storyId: string]: boolean }>({});
  const [filterType, setFilterType] = useState<"playable" | "solved" | "mine" | "all">("playable");
  const [countdown, setCountdown] = useState(ROUND_SECONDS);
  const [readyLoading, setReadyLoading] = useState(false);
  const [lobbyError, setLobbyError] = useState<string | null>(null);

  // Candidate usernames for the autocomplete, including the guesser.
  const candidateUsernames = useMemo(() => {
    return users
      .map((u) => u.username.trim().split(/\s+/)[0])
      .filter((name, index, names) => names.indexOf(name) === index);
  }, [users]);

  const getSuggestions = useCallback((query: string): string[] => {
    const q = query.trim().toLowerCase();
    const matched = q
      ? candidateUsernames.filter((n) => n.toLowerCase().startsWith(q))
      : candidateUsernames;
    return matched.slice(0, 5);
  }, [candidateUsernames]);

  // Countdown timer: snap to server's authoritative remainingMs on each poll,
  // then tick down locally. All players see the same countdown.
  useEffect(() => {
    if (session.phase !== "playing" || !session.currentRound) return;
    setCountdown(Math.ceil(session.currentRound.remainingMs / 1_000));
    const interval = window.setInterval(() => {
      setCountdown(prev => Math.max(0, prev - 1));
    }, 1_000);
    return () => window.clearInterval(interval);
  }, [session.phase, session.currentRound?.storyId, session.currentRound?.remainingMs]);

  // When a round is "armed" (waiting for everyone to load), ack once so the
  // server can start the synchronized 30s countdown for all players at once.
  const ackedRef = useRef(false);
  useEffect(() => {
    if (session.phase !== "armed" || !session.currentRound) {
      ackedRef.current = false;
      return;
    }
    if (currentUser?.isAdmin || ackedRef.current) return;
    ackedRef.current = true;
    void onRoundReady();
  }, [session.phase, session.currentRound?.storyId, currentUser?.isAdmin, onRoundReady]);

  useEffect(() => {
    if (session.phase !== "playing" || !session.currentRound) return;
    document.title = `⏱️ Ronde ${session.currentRound.roundIndex + 1} — Siapa Aku?`;
    if ("Notification" in window && Notification.permission === "granted") {
      const n = new Notification(`Ronde ${session.currentRound.roundIndex + 1} dimulai`, { body: "Cerita baru sudah tampil. Pilih satu jawaban sebelum waktu habis." });
      const t = setTimeout(() => n.close(), 5000);
      return () => {
        clearTimeout(t);
        n.close();
      };
    }
    return () => { document.title = "Siapa Aku? - Multiplayer Detective Game"; };
  }, [session.phase, session.currentRound?.storyId]);

  const handlePickSuggestion = (storyId: string, name: string) => {
    setGuesses((prev) => ({ ...prev, [storyId]: name }));
  };

  const handleGuessSubmit = async (e: React.FormEvent, storyId: string) => {
    e.preventDefault();
    const guessText = guesses[storyId] || "";
    if (!guessText.trim() || !currentUser) return;

    setSubmitting((prev) => ({ ...prev, [storyId]: true }));
    setFeedback((prev) => {
      const next = { ...prev };
      delete next[storyId];
      return next;
    });

    try {
      const res = await onGuessStory(storyId, guessText);
      if (res.isCorrect) {
        setFeedback((prev) => ({
          ...prev,
          [storyId]: { isCorrect: true, message: "🎯 HEBAT! Tebakan Anda benar!" }
        }));
        setGuesses((prev) => ({ ...prev, [storyId]: "" }));
      } else {
        setFeedback((prev) => ({
          ...prev,
          [storyId]: { isCorrect: false, message: `❌ Salah! "${guessText.trim()}" kurang tepat.` }
        }));
      }
    } catch (err: any) {
      setFeedback((prev) => ({
        ...prev,
        [storyId]: { isCorrect: false, message: err.message || "Gagal mengirim tebakan." }
      }));
    } finally {
      setSubmitting((prev) => ({ ...prev, [storyId]: false }));
    }
  };

  const toggleReady = async () => {
    setReadyLoading(true);
    setLobbyError(null);
    try {
      if ("Notification" in window && Notification.permission === "default") await Notification.requestPermission();
      await onLobbyReady();
    } catch (error) {
      setLobbyError(error instanceof Error ? error.message : "Gagal mengubah status siap.");
    } finally {
      setReadyLoading(false);
    }
  };

  const handleGuessChange = (storyId: string, val: string) => {
    setGuesses((prev) => ({ ...prev, [storyId]: val }));
    if (feedback[storyId]) {
      setFeedback((prev) => {
        const copy = { ...prev };
        delete copy[storyId];
        return copy;
      });
    }
  };

  // Filtering logic + session scope
  const visibleStories = useMemo(() => {
    return session.phase === "playing" && session.currentRound
      ? stories.filter(s => s.id === session.currentRound!.storyId)
      : session.lastRevealed
      ? stories.filter(s => s.id === session.lastRevealed!.storyId)
      : stories;
  }, [stories, session.phase, session.currentRound?.storyId, session.lastRevealed?.storyId]);

  const filteredStories = useMemo(() => {
    return visibleStories.filter((story) => {
      const isMine = story.userId === currentUser?.id;
      const isSolvedByMe = story.isSolvedBy.includes(currentUser?.id || "");

      // During a live round, always render its selected mystery—even for its owner.
      if (session.phase === "playing" || session.lastRevealed?.storyId === story.id) return true;

      if (filterType === "playable") {
        // Stories from others that I have not solved yet
        return !isMine && !isSolvedByMe;
      }
      if (filterType === "solved") {
        // Stories solved by me
        return isSolvedByMe;
      }
      if (filterType === "mine") {
        // Stories created by me
        return isMine;
      }
      return true; // "all"
    });
  }, [visibleStories, currentUser?.id, filterType, session.phase, session.lastRevealed?.storyId]);

  // Lobby keeps submitted stories private until the admin starts the game.
  if (session.phase === "idle" && !session.sessionId) {
    const canToggleReady = !currentUser?.isAdmin && (currentUser?.submittedCount ?? 0) >= 2;
    return (
      <div className="min-h-[360px] rounded-2xl border border-cyan-500/20 bg-cyan-950/10 p-5">
        <p className="text-sm font-bold text-white">Menunggu permainan dimulai</p>
        <p className="mt-1 text-xs text-slate-400">Cerita misteri akan tampil saat admin memulai permainan.</p>
        {canToggleReady && (
          <button
            type="button"
            onClick={toggleReady}
            disabled={readyLoading}
            className={`mt-4 rounded-xl px-4 py-2.5 text-xs font-bold transition-colors disabled:opacity-50 ${
              currentUser?.isReady
                ? "border border-emerald-500/30 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25"
                : "bg-cyan-600 text-white hover:bg-cyan-500"
            }`}
          >
            {readyLoading ? "Memproses..." : currentUser?.isReady ? "Batalkan status siap" : "Saya siap bermain"}
          </button>
        )}
        {!currentUser?.isAdmin && !canToggleReady && (
          <p className="mt-3 text-xs font-semibold text-amber-300">Lengkapi 2 cerita untuk menyatakan siap.</p>
        )}
        {lobbyError && <p className="mt-3 text-xs font-semibold text-rose-300">{lobbyError}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Filters hanya berguna di luar ronde */}
      {session.phase !== "playing" && !session.lastRevealed && <div className="bg-[#2b241c]/80 backdrop-blur-md p-4 rounded-2xl border border-slate-800/80 shadow-xl flex flex-col md:flex-row items-center justify-between gap-4 animate-fadeIn relative overflow-hidden">
        <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-pink-500/20 to-transparent" />
        <div className="flex items-center gap-2">
          <div className="bg-pink-500/10 p-1.5 rounded-lg border border-pink-500/20">
            <Filter className="w-3.5 h-3.5 text-pink-400" />
          </div>
          <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Filter Cerita:</span>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            id="filter-playable-btn"
            onClick={() => setFilterType("playable")}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all duration-200 border cursor-pointer ${
              filterType === "playable"
                ? "bg-pink-500 border-pink-500 text-white shadow-md shadow-pink-500/20"
                : "bg-slate-900/60 border-slate-800 text-slate-400 hover:text-white hover:border-slate-700"
            }`}
          >
            🕵️‍♂️ Belum Ditebak ({stories.filter(s => s.userId !== currentUser?.id && !s.isSolvedBy.includes(currentUser?.id || "")).length})
          </button>
          <button
            id="filter-solved-btn"
            onClick={() => setFilterType("solved")}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all duration-200 border cursor-pointer ${
              filterType === "solved"
                ? "bg-emerald-500/20 border-emerald-500/30 text-emerald-400 shadow-md shadow-emerald-500/10"
                : "bg-slate-900/60 border-slate-800 text-slate-400 hover:text-white hover:border-slate-700"
            }`}
          >
            🎯 Berhasil Ditebak ({stories.filter(s => s.isSolvedBy.includes(currentUser?.id || "")).length})
          </button>
          <button
            id="filter-mine-btn"
            onClick={() => setFilterType("mine")}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all duration-200 border cursor-pointer ${
              filterType === "mine"
                ? "bg-amber-500/20 border-amber-500/30 text-amber-300 shadow-md shadow-amber-500/10"
                : "bg-slate-900/60 border-slate-800 text-slate-400 hover:text-white hover:border-slate-700"
            }`}
          >
            📝 Buatan Saya ({stories.filter(s => s.userId === currentUser?.id).length})
          </button>
          <button
            id="filter-all-btn"
            onClick={() => setFilterType("all")}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all duration-200 border cursor-pointer ${
              filterType === "all"
                ? "bg-indigo-500/20 border-indigo-500/30 text-indigo-300 shadow-md shadow-indigo-500/10"
                : "bg-slate-900/60 border-slate-800 text-slate-400 hover:text-white hover:border-slate-700"
            }`}
          >
            Semua ({stories.length})
          </button>
        </div>
      </div>}

      {/* Armed banner: waiting for everyone to load before the synchronized countdown starts */}
      {session.phase === "armed" && session.currentRound && (
        <div className="bg-gradient-to-r from-amber-500/10 via-amber-600/10 to-yellow-500/10 border border-amber-500/30 p-4 rounded-2xl flex items-center justify-between animate-glowPulse relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-r from-amber-500/5 to-transparent pointer-events-none" />
          <div className="flex items-center gap-3">
            <Loader2 className="w-5 h-5 text-amber-400 animate-spin" />
            <span className="text-sm font-bold text-white">
              Ronde {session.currentRound.roundIndex + 1} / {session.totalMysteries}
            </span>
          </div>
          <span className="text-sm font-bold text-amber-300">Menunggu pemain lain…</span>
        </div>
      )}

      {/* Countdown banner for active round */}
      {session.phase === "playing" && session.currentRound && session.currentRound.startTime !== null && (
        <div className="bg-gradient-to-r from-pink-500/10 via-purple-600/10 to-indigo-500/10 border border-pink-500/20 p-4 rounded-2xl flex items-center justify-between animate-glowPulse relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-r from-pink-500/5 to-transparent pointer-events-none" />
          <div className="flex items-center gap-3">
            <Timer className="w-5 h-5 text-pink-400" />
            <span className="text-sm font-bold text-white">
              Ronde {session.currentRound.roundIndex + 1} / {session.totalMysteries}
            </span>
          </div>
          <span className={`text-2xl font-extrabold ${countdown <= 5 ? "text-red-400" : "text-pink-300"}`}>
            {countdown}s
          </span>
        </div>
      )}

      {session.phase === "playing" && currentUser?.isEliminated && (
        <div className="rounded-2xl border border-rose-500/30 bg-rose-950/30 p-4 text-sm font-semibold text-rose-200">
          Anda gugur pada sesi ini karena belum mengumpulkan 2 cerita sebelum game dimulai.
        </div>
      )}

      {/* Stories Grid */}
      <div className="grid grid-cols-1 gap-6">
        {filteredStories.map((story) => {
          // Active mystery owner IDs are intentionally withheld; the server rejects self-guesses.
          const isRoundResult = session.phase === "idle" && session.lastRevealed?.storyId === story.id;
          const isMine = session.phase !== "playing" && story.userId === currentUser?.id;
          const isSolvedByMe = story.isSolvedBy.includes(currentUser?.id || "");
          const isStorySolvedByOther = story.isSolvedBy.length > 0;

          return (
            <div
              key={story.id}
              className={`bg-[#2b241c]/80 backdrop-blur-md rounded-2xl border transition-all shadow-xl flex flex-col justify-between overflow-hidden relative animate-fadeIn ${
                isMine
                  ? "border-amber-500/30 hover:border-amber-500/50 shadow-amber-500/5"
                  : isSolvedByMe
                  ? "border-emerald-500/30 hover:border-emerald-500/50 bg-[#2b241c]/95 shadow-emerald-500/5"
                  : "border-slate-800/80 hover:border-slate-700/80 hover:shadow-pink-500/5"
              }`}
            >
              {/* Badges and meta */}
              <div className="flex flex-wrap items-center justify-between gap-2 p-4 bg-[#241d15]/60 border-b border-slate-800/80 text-xs">
                <div className="flex min-w-0 items-center gap-1.5 font-semibold text-slate-300">
                  <UserIcon className="w-3.5 h-3.5 text-pink-400" />
                  <span>{session.phase === "playing" ? "Tebak pemilik cerita" : "Kreator:"}</span>
                  {session.phase !== "playing" && <span className="break-mobile text-white font-bold">{story.username}</span>}
                  {isMine && (
                    <span className="bg-amber-500/20 border border-amber-500/30 text-amber-300 text-[9px] font-extrabold px-1.5 py-0.5 rounded uppercase">
                      Saya
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-slate-400 font-mono text-[11px]">
                  <span className="flex items-center gap-1">
                    <Calendar className="w-3.5 h-3.5 text-slate-500" />
                    {formatDate(story.createdAt)}
                  </span>
                  <span className="bg-pink-500/10 border border-pink-500/20 text-pink-400 px-2 py-0.5 rounded-md font-bold">
                    {story.isSolvedBy.length} Pemecah
                  </span>
                </div>
              </div>

              {/* Story Content Area */}
              <div className="p-5 flex-1">
                <div className="text-slate-100 leading-relaxed text-sm md:text-base italic">
                  "{story.parts.map((part, idx) => (
                    <React.Fragment key={idx}>
                      <span>{part}</span>
                      {idx < story.blanks.length && (
                        <span className="inline-block bg-[#1a150f] text-pink-300 font-extrabold px-1.5 py-0.5 mx-1 rounded border border-slate-800 text-xs not-italic">
                          {story.blanks[idx]}
                        </span>
                      )}
                    </React.Fragment>
                  ))}"
                </div>
              </div>

              {/* Action Area (Guessing or solved answer display) */}
              <div className="p-4 bg-[#221b14]/40 border-t border-slate-800/60">
                {isRoundResult ? (
                  <div className="rounded-xl border border-emerald-500/20 bg-emerald-950/20 p-3 text-sm font-semibold text-emerald-200">
                    Jawaban: <span className="font-extrabold text-emerald-300">{session.lastRevealed!.answer}</span>
                  </div>
                ) : isSolvedByMe ? (
                  <div className="bg-emerald-500/5 border border-emerald-500/15 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-sm">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                      <div>
                        <span className="text-emerald-300 font-bold block">Tebakan Berhasil Dipecahkan!</span>
                        <span className="text-xs text-slate-400">Poin dihitung dari sisa detik ronde.</span>
                      </div>
                    </div>
                    <span className="font-extrabold text-emerald-300 bg-emerald-500/15 border border-emerald-500/20 px-4 py-1.5 rounded-xl text-center">
                      Jawaban: "{story.answer}"
                    </span>
                  </div>
                ) : isMine ? (
                  <div className="rounded-xl border border-amber-500/20 bg-amber-950/20 p-3 text-sm font-semibold text-amber-200">
                    Ini cerita Anda. Tunggu pemain lain menebaknya.
                  </div>
                ) : currentUser?.isEliminated ? (
                  <div className="rounded-xl border border-rose-500/20 bg-rose-950/20 p-3 text-sm font-semibold text-rose-200">
                    Status gugur — tidak dapat menebak pada sesi ini.
                  </div>
                ) : (
                  <div className="space-y-3">
                    <form onSubmit={(e) => handleGuessSubmit(e, story.id)} className="flex flex-col gap-2 sm:flex-row">
                      <div className="relative flex-1">
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                          <HelpCircle className="w-4 h-4 text-pink-400" />
                        </div>
                        <input
                          id={`guess-input-${story.id}`}
                          type="text"
                          autoComplete="off"
                          placeholder="Pilih satu jawaban nama depan..."
                          disabled={submitting[story.id]}
                          value={guesses[story.id] || ""}
                          onChange={(e) => handleGuessChange(story.id, e.target.value)}
                          className="w-full text-sm bg-[#1a150f]/80 border border-slate-800 rounded-xl pl-9 pr-3 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-pink-500"
                        />
                      </div>
                      <button
                        id={`guess-submit-btn-${story.id}`}
                        type="submit"
                        disabled={submitting[story.id] || !(guesses[story.id] || "").trim()}
                        className="bg-gradient-to-r from-pink-500 to-purple-600 hover:from-pink-600 hover:to-purple-700 disabled:from-slate-800 disabled:to-slate-800 disabled:cursor-not-allowed text-white font-bold text-sm px-5 py-2.5 rounded-xl transition-all shadow-md cursor-pointer shrink-0 flex items-center justify-center gap-1"
                      >
                        Tebak <Send className="w-3.5 h-3.5" />
                      </button>
                    </form>
                    {(guesses[story.id] || "").trim() && getSuggestions(guesses[story.id] || "").length > 0 && (
                      <div className="rounded-xl border border-slate-800 bg-slate-950/30 p-3">
                        <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">Saran nama</p>
                        <div className="flex gap-2 overflow-x-auto pb-1 [-webkit-overflow-scrolling:touch]">
                          {getSuggestions(guesses[story.id] || "").map((name) => (
                            <button
                              key={name}
                              type="button"
                              onClick={() => handlePickSuggestion(story.id, name)}
                              className={`shrink-0 rounded-lg border px-3 py-2 text-sm font-bold transition-colors ${guesses[story.id] === name ? "border-pink-400 bg-pink-500 text-white" : "border-slate-700 bg-slate-900 text-slate-200 active:bg-pink-500/20"}`}
                            >
                              {name}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Feedback messages */}
                    {feedback[story.id] && (
                      <div
                        className={`text-xs p-2.5 rounded-xl font-semibold border ${
                          feedback[story.id].isCorrect
                            ? "bg-emerald-950/40 text-emerald-300 border border-emerald-500/30"
                            : "bg-rose-950/40 text-rose-300 border-rose-500/30"
                        } animate-fadeIn`}
                      >
                        {feedback[story.id].message}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {filteredStories.length === 0 && (
          <div className="bg-[#2b241c]/80 backdrop-blur-md rounded-2xl border border-slate-800/80 p-12 text-center shadow-xl relative overflow-hidden animate-fadeIn">
            <div className="absolute inset-0 bg-gradient-to-b from-pink-500/5 to-transparent pointer-events-none" />
            <div className="mx-auto flex items-center justify-center h-14 w-14 rounded-2xl bg-gradient-to-br from-pink-500/15 to-purple-500/10 text-pink-400 mb-4 border border-pink-500/20 relative">
              <Sparkles className="h-7 w-7" />
            </div>
            <h3 className="text-base font-bold text-white mb-2 relative">Tidak ada cerita misteri</h3>
            <p className="text-slate-400 text-xs max-w-sm mx-auto leading-relaxed relative">
              {filterType === "playable"
                ? "Hebat! Anda sudah menebak atau menyelesaikan semua cerita yang tersedia, atau belum ada cerita dari pemain lain."
                : filterType === "solved"
                ? "Anda belum berhasil memecahkan satu cerita pun. Mulailah menebak cerita lain!"
                : filterType === "mine"
                ? "Anda belum memublikasikan cerita misteri apapun. Ayo buat sekarang dengan menu di atas!"
                : "Papan permainan masih kosong saat ini."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
});

export default StoryList;
