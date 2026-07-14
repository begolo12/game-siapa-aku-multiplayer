import React, { useState, useRef, useEffect } from "react";
import { SubmittedStory, User, Session } from "../types";
import { CheckCircle2, Send, HelpCircle, Lock, Calendar, Filter, User as UserIcon, Sparkles, Timer } from "lucide-react";

const ROUND_SECONDS = 30;

interface StoryListProps {
  stories: SubmittedStory[];
  currentUser: User | null;
  users: User[];
  session: Session;
  onGuessStory: (storyId: string, guessText: string) => Promise<{ isCorrect: boolean; answer?: string }>;
  onLobbyReady: () => Promise<void>;
}

export default function StoryList({ stories, currentUser, users, session, onGuessStory, onLobbyReady }: StoryListProps) {
  const [guesses, setGuesses] = useState<{ [storyId: string]: string }>({});
  const [feedback, setFeedback] = useState<{ [storyId: string]: { isCorrect: boolean; message: string } }>({});
  const [submitting, setSubmitting] = useState<{ [storyId: string]: boolean }>({});
  const [filterType, setFilterType] = useState<"playable" | "solved" | "mine" | "all">("playable");
  const [openFor, setOpenFor] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(ROUND_SECONDS);
  const [readyLoading, setReadyLoading] = useState(false);
  const blurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pickedSuggestionRef = useRef(false);

  // Candidate usernames for the autocomplete (exclude the guesser)
  const candidateUsernames = users
    .filter((u) => u.id !== currentUser?.id)
    .map((u) => u.username.trim().split(/\s+/)[0])
    .filter((name, index, names) => names.indexOf(name) === index);

  const getSuggestions = (query: string): string[] => {
    const q = query.trim().toLowerCase();
    const matched = q
      ? candidateUsernames.filter((n) => n.toLowerCase().startsWith(q))
      : candidateUsernames;
    return matched.slice(0, 5);
  };

  // Countdown timer for round
  useEffect(() => {
    if (session.phase !== "playing" || !session.currentRound) return;
    setCountdown(Math.ceil(session.currentRound.remainingMs / 1000));

    const interval = setInterval(() => {
      setCountdown((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, [session.phase, session.currentRound?.storyId, session.currentRound?.remainingMs]);

  useEffect(() => {
    if (session.phase !== "playing" || !session.currentRound) return;
    document.title = `⏱️ Ronde ${session.currentRound.roundIndex + 1} — Siapa Aku?`;
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification(`Ronde ${session.currentRound.roundIndex + 1} dimulai`, { body: "Cerita baru sudah tampil. Pilih satu jawaban sebelum waktu habis." });
    }
    return () => { document.title = "Siapa Aku? - Multiplayer Detective Game"; };
  }, [session.phase, session.currentRound?.storyId]);

  const handleFocus = (storyId: string) => {
    if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
    setOpenFor(storyId);
  };

  const handleBlur = () => {
    if (pickedSuggestionRef.current) {
      pickedSuggestionRef.current = false;
      return;
    }
    blurTimerRef.current = setTimeout(() => setOpenFor(null), 200);
  };

  const handlePickSuggestion = (storyId: string, name: string) => {
    pickedSuggestionRef.current = true;
    setGuesses((prev) => ({ ...prev, [storyId]: name }));
    setOpenFor(null);
  };

  const handleGuessSubmit = async (e: React.FormEvent, storyId: string) => {
    e.preventDefault();
    const guessText = guesses[storyId] || "";
    if (!guessText.trim() || !currentUser) return;

    setSubmitting((prev) => ({ ...prev, [storyId]: true }));
    if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
    setOpenFor(null);
    pickedSuggestionRef.current = false;
    setFeedback((prev) => ({ ...prev, [storyId]: null as any }));

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
    try {
      if ("Notification" in window && Notification.permission === "default") await Notification.requestPermission();
      await onLobbyReady();
    } catch (err: any) { setFeedback({ lobby: { isCorrect: false, message: err.message } }); } finally { setReadyLoading(false); }
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

  const formatDate = (timestamp: number) => {
    const d = new Date(timestamp);
    return d.toLocaleDateString("id-ID", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit"
    });
  };

  // Filtering logic + session scope
  const visibleStories = session.phase === "playing" && session.currentRound
    ? stories.filter(s => s.id === session.currentRound!.storyId)
    : stories;

  const filteredStories = visibleStories.filter((story) => {
    const isMine = story.userId === currentUser?.id;
    const isSolvedByMe = story.isSolvedBy.includes(currentUser?.id || "");

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

  return (
    <div className="space-y-6">
      {session.phase === "idle" && !session.sessionId && (
        <div className="rounded-2xl border border-cyan-500/20 bg-cyan-950/10 p-5 flex flex-col sm:flex-row gap-4 sm:items-center sm:justify-between">
          <div><p className="text-sm font-bold text-white">Lobby permainan</p><p className="text-xs text-slate-400 mt-1">Buat 2 cerita, lalu tekan siap. Admin memulai game saat semua pemain siap.</p></div>
          {!currentUser?.isAdmin && <button onClick={toggleReady} disabled={readyLoading || currentUser?.isReady} className={`rounded-xl px-4 py-2.5 text-sm font-bold ${currentUser?.isReady ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30" : "bg-cyan-600 hover:bg-cyan-500 text-white"}`}>{currentUser?.isReady ? "✓ Siap bermain" : readyLoading ? "Memproses..." : "Saya siap"}</button>}
          {currentUser?.isAdmin && <span className="text-sm font-bold text-cyan-300">{users.filter(user => !user.isAdmin && user.isReady).length}/{users.filter(user => !user.isAdmin).length} siap</span>}
        </div>
      )}
      {/* Filters hanya berguna di luar ronde */}
      {session.phase !== "playing" && <div className="bg-[#2b241c]/80 backdrop-blur-md p-4 rounded-2xl border border-slate-800/80 shadow-xl flex flex-col md:flex-row items-center justify-between gap-4 animate-fadeIn relative overflow-hidden">
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

      {/* Reveal card after round ends */}
      {session.phase === "idle" && session.lastRevealed && (
        <div className="bg-gradient-to-r from-emerald-500/10 via-teal-600/10 to-cyan-500/10 border border-emerald-500/30 p-5 rounded-2xl animate-slideUp relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-r from-emerald-500/5 to-transparent pointer-events-none" />
          <div className="flex items-center gap-2 mb-3 relative">
            <div className="bg-emerald-500/15 p-1.5 rounded-lg border border-emerald-500/25">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            </div>
            <span className="text-sm font-bold text-emerald-300 uppercase tracking-wider">Jawaban Terungkap!</span>
          </div>
          <p className="text-slate-300 italic text-xs leading-relaxed mb-3 relative">"{session.lastRevealed.storyPreview}"</p>
          <div className="flex items-center gap-2 relative">
            <span className="text-xs text-slate-400 font-mono">Jawaban:</span>
            <span className="text-sm font-extrabold text-emerald-300 bg-emerald-500/15 border border-emerald-500/25 px-3 py-1 rounded-lg">
              {session.lastRevealed.answer}
            </span>
          </div>
        </div>
      )}

      {/* Countdown banner for active round */}
      {session.phase === "playing" && session.currentRound && (
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

      {/* Stories Grid */}
      <div className="grid grid-cols-1 gap-6">
        {filteredStories.map((story) => {
          const isMine = story.userId === currentUser?.id;
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
                <div className="flex items-center gap-1.5 font-semibold text-slate-300">
                  <UserIcon className="w-3.5 h-3.5 text-pink-400" />
                  <span>{session.phase === "playing" ? "Tebak pemilik cerita" : "Kreator:"}</span>
                  {session.phase !== "playing" && <span className="text-white font-bold">{story.username}</span>}
                  {isMine && (
                    <span className="bg-amber-500/20 border border-amber-500/30 text-amber-300 text-[9px] font-extrabold px-1.5 py-0.5 rounded uppercase">
                      Saya
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-3 text-slate-400 font-mono text-[11px]">
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
                {isMine ? (
                  <div className="bg-amber-500/5 border border-amber-500/15 rounded-xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-sm">
                    <span className="text-amber-300 font-semibold flex items-center gap-1.5">
                      <Lock className="w-4 h-4" /> Ini adalah cerita yang Anda buat.
                    </span>
                    <span className="font-bold text-amber-300 bg-amber-500/15 border border-amber-500/20 px-3 py-1 rounded-lg">
                      Jawaban Anda: "{story.answer}"
                    </span>
                  </div>
                ) : isSolvedByMe ? (
                  <div className="bg-emerald-500/5 border border-emerald-500/15 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-sm">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                      <div>
                        <span className="text-emerald-300 font-bold block">Tebakan Berhasil Dipecahkan!</span>
                        <span className="text-xs text-slate-400">Anda mendapatkan +4 poin dari tantangan ini.</span>
                      </div>
                    </div>
                    <span className="font-extrabold text-emerald-300 bg-emerald-500/15 border border-emerald-500/20 px-4 py-1.5 rounded-xl text-center">
                      Jawaban: "{story.answer}"
                    </span>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <form onSubmit={(e) => handleGuessSubmit(e, story.id)} className="flex gap-2">
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
                          onChange={(e) => {
                            handleGuessChange(story.id, e.target.value);
                            setOpenFor(story.id);
                          }}
                          onFocus={() => handleFocus(story.id)}
                          onBlur={handleBlur}
                          className="w-full text-sm bg-[#1a150f]/80 border border-slate-800 rounded-xl pl-9 pr-3 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-pink-500"
                        />
                        {openFor === story.id && getSuggestions(guesses[story.id] || "").length > 0 && (
                          <ul className="absolute z-20 mt-1 w-full bg-[#2b241c] border border-slate-800 rounded-xl shadow-xl overflow-hidden animate-fadeIn">
                            {getSuggestions(guesses[story.id] || "").map((name) => (
                              <li key={name}>
                                <button
                                  type="button"
                                  onMouseDown={(e) => {
                                    e.preventDefault();
                                    handlePickSuggestion(story.id, name);
                                  }}
                                  className="w-full text-left px-3 py-2 text-sm text-slate-200 hover:bg-pink-500/10 hover:text-pink-300 transition-colors"
                                >
                                  {name}
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                      <button
                        id={`guess-submit-btn-${story.id}`}
                        type="submit"
                        disabled={submitting[story.id] || !(guesses[story.id] || "").trim()}
                        className="bg-gradient-to-r from-pink-500 to-purple-600 hover:from-pink-600 hover:to-purple-700 disabled:from-slate-800 disabled:to-slate-800 disabled:cursor-not-allowed text-white font-bold text-sm px-5 py-2.5 rounded-xl transition-all shadow-md cursor-pointer shrink-0 flex items-center gap-1"
                      >
                        Tebak <Send className="w-3.5 h-3.5" />
                      </button>
                    </form>

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
}
