import React, { useState, useEffect } from "react";
import { User, SubmittedStory, Session } from "../types";
import { Shield, Users, RefreshCw, Layers, ShieldAlert, Calendar, Play, Square, Pencil, Trash2, Save, X, MonitorUp } from "lucide-react";

interface AdminPanelProps {
  currentUser: User | null;
  users: User[];
  session: Session;
  onResetGame: () => Promise<void>;
  onStartRound: () => Promise<void>;
  onEndRound: () => Promise<void>;
}

export default function AdminPanel({ currentUser, users, session, onResetGame, onStartRound, onEndRound }: AdminPanelProps) {
  const [stories, setStories] = useState<SubmittedStory[]>([]);
  const [loading, setLoading] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editPassword, setEditPassword] = useState("");
  const [userSaving, setUserSaving] = useState(false);
  const [presenter, setPresenter] = useState(false);

  const fetchAdminStories = () => {
    setLoading(true);
    fetch("/api/admin/stories", {
      headers: {
        "x-user-id": currentUser?.id || ""
      }
    })
      .then((res) => {
        if (!res.ok) throw new Error("Akses ditolak atau kesalahan server");
        return res.json();
      })
      .then((data) => setStories(data))
      .catch((err) => console.error(err))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (currentUser?.isAdmin) {
      fetchAdminStories();
    }
  }, [currentUser]);

  const handleReset = async () => {
    try {
      setLoading(true);
      await onResetGame();
      setConfirmReset(false);
      setMessage("Game state berhasil direset total oleh Admin!");
      fetchAdminStories();
      setTimeout(() => setMessage(null), 5000);
    } catch (err: any) {
      alert(err.message || "Gagal mereset permainan.");
    } finally {
      setLoading(false);
    }
  };

  const handleStartSession = async () => {
    setSessionLoading(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/session/start", {
        method: "POST",
        headers: { "x-user-id": currentUser?.id || "" }
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setMessage(`🎮 Game dimulai! Cerita pertama tampil selama 30 detik.`);
      fetchAdminStories();
    } catch (err: any) {
      setMessage("❌ " + err.message);
    } finally {
      setSessionLoading(false);
      setTimeout(() => setMessage(null), 5000);
    }
  };

  const handleEndSession = async () => {
    setSessionLoading(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/session/end", {
        method: "POST",
        headers: { "x-user-id": currentUser?.id || "" }
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setMessage("🏁 Sesi diakhiri! Pemain bisa melihat hasil.");
      fetchAdminStories();
    } catch (err: any) {
      setMessage("❌ " + err.message);
    } finally {
      setSessionLoading(false);
      setTimeout(() => setMessage(null), 5000);
    }
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString("id-ID", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });
  };

  const refreshAll = () => {
    fetchAdminStories();
    window.location.reload();
  };

  const saveUser = async (userId: string) => {
    setUserSaving(true);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-user-id": currentUser?.id || "" },
        body: JSON.stringify({ username: editName, password: editPassword })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setEditingUserId(null);
      setEditPassword("");
      setMessage("Pemain berhasil diperbarui.");
      refreshAll();
    } catch (err: any) { setMessage(`❌ ${err.message}`); }
    finally { setUserSaving(false); }
  };

  const deleteUser = async (user: User) => {
    if (!window.confirm(`Hapus ${user.username} beserta cerita, chat, dan hasilnya?`)) return;
    setUserSaving(true);
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, { method: "DELETE", headers: { "x-user-id": currentUser?.id || "" } });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setMessage(`${user.username} dihapus.`);
      refreshAll();
    } catch (err: any) { setMessage(`❌ ${err.message}`); }
    finally { setUserSaving(false); }
  };

  const togglePresenter = async () => {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
    else await document.exitFullscreen();
    setPresenter(!presenter);
  };

  if (!currentUser?.isAdmin) {
    return (
      <div className="bg-[#2b241c]/80 backdrop-blur-md border border-red-500/30 text-rose-200 rounded-2xl p-8 text-center max-w-lg mx-auto my-12 shadow-2xl animate-fadeIn">
        <ShieldAlert className="w-12 h-12 text-red-400 mx-auto mb-4 animate-bounce" />
        <h3 className="text-xl font-bold text-white">Akses Ditolak</h3>
        <p className="text-sm mt-2 text-slate-400 leading-relaxed">Anda tidak memiliki hak akses administrator untuk melihat halaman ini.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Title */}
      <div className="bg-gradient-to-r from-red-500/10 via-purple-600/10 to-pink-500/10 border border-red-500/20 p-5 rounded-2xl flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="bg-red-500/20 text-red-400 border border-red-500/30 p-2.5 rounded-xl shadow-md">
            <Shield className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white uppercase tracking-wider">Panel Administrator</h2>
            <p className="text-xs text-red-400 font-bold font-mono">Status: Kontrol Penuh Aktif</p>
          </div>
        </div>
        <button
          id="refresh-admin-btn"
          onClick={fetchAdminStories}
          disabled={loading}
          className="bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 text-xs font-bold px-3 py-2.5 rounded-xl flex items-center gap-1.5 transition-all cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin text-pink-400" : ""}`} /> Segarkan
        </button>
        <button onClick={togglePresenter} className="bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold px-3 py-2.5 rounded-xl flex items-center gap-1.5">
          <MonitorUp className="w-3.5 h-3.5" /> {presenter ? "Keluar Presenter" : "Mode Presenter"}
        </button>
      </div>

      {message && (
        <div className="bg-emerald-950/40 border border-emerald-500/30 text-emerald-300 p-4 rounded-xl text-sm font-bold text-center animate-fadeIn">
          {message}
        </div>
      )}

      {/* Session Control */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-[#2b241c]/80 backdrop-blur-md border border-slate-800 p-5 rounded-2xl shadow-xl flex items-center justify-between">
          <div>
            <span className="block text-xs font-bold text-slate-400 uppercase font-mono">Status Sesi</span>
            <span className="text-3xl font-extrabold text-white mt-1 block">
              {session.phase === "playing" ? "🎮 Bermain" : session.phase === "ended" ? "🏁 Selesai" : "⏸️ Idle"}
            </span>
            {session.phase === "playing" && (
              <span className="text-xs text-slate-400 mt-1 block">
                {session.mysteryIds.length} misteri · ID: {session.sessionId?.slice(0, 8)}…
              </span>
            )}
          </div>
          <div className="bg-pink-500/10 text-pink-400 border border-pink-500/20 p-3 rounded-xl">
            <Layers className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-[#2b241c]/80 backdrop-blur-md border border-slate-800 p-5 rounded-2xl shadow-xl flex items-center justify-between">
          {session.phase === "playing" ? (
            <div className="w-full">
              <h3 className="text-sm font-bold text-white uppercase tracking-wide">Ronde {session.currentRound ? session.currentRound.roundIndex + 1 : "?"} / {session.totalMysteries}</h3>
              <p className="text-xs text-slate-400 mt-1">
                {session.currentRound && session.currentRound.remainingMs > 0
                  ? `⏱️ ${Math.ceil(session.currentRound.remainingMs / 1000)} detik tersisa`
                  : "Pemain sedang menebak. Akhiri ronde untuk melanjutkan."}
              </p>
              <div className="flex gap-2 mt-3">
                <button
                  id="end-round-btn"
                  onClick={onEndRound}
                  disabled={sessionLoading}
                  className="bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs px-4 py-2.5 rounded-xl transition-all shadow-md cursor-pointer disabled:opacity-50"
                >
                  <Square className="w-3.5 h-3.5 inline mr-1" />
                  {sessionLoading ? "..." : "Akhiri Ronde"}
                </button>
                <button
                  id="end-session-btn"
                  onClick={handleEndSession}
                  disabled={sessionLoading}
                  className="bg-red-600 hover:bg-red-700 text-white font-bold text-xs px-4 py-2.5 rounded-xl transition-all shadow-md cursor-pointer disabled:opacity-50"
                >
                  <Square className="w-3.5 h-3.5 inline mr-1" />
                  {sessionLoading ? "..." : "Akhiri Sesi"}
                </button>
              </div>
            </div>
          ) : session.phase === "idle" ? (
            <div className="w-full">
              {session.sessionId ? (
                <>
                  <h3 className="text-sm font-bold text-white uppercase tracking-wide">Mulai Ronde</h3>
                  <p className="text-xs text-slate-400 mt-1">
                    Ronde {session.roundIndex + 1} / {session.totalMysteries}. Pemain mendapat 30 detik.
                  </p>
                  <div className="mt-3 flex gap-2">
                    <button
                      id="start-round-btn"
                      onClick={onStartRound}
                      disabled={sessionLoading || session.roundIndex >= session.mysteryIds.length}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs px-4 py-2.5 rounded-xl transition-all shadow-md cursor-pointer disabled:opacity-50"
                    >
                      <Play className="w-3.5 h-3.5 inline mr-1" />
                      {sessionLoading ? "..." : "Mulai Ronde"}
                    </button>
                    <button
                      id="end-session-btn"
                      onClick={handleEndSession}
                      disabled={sessionLoading}
                      className="bg-red-600 hover:bg-red-700 text-white font-bold text-xs px-4 py-2.5 rounded-xl transition-all shadow-md cursor-pointer disabled:opacity-50"
                    >
                      <Square className="w-3.5 h-3.5 inline mr-1" />
                      Akhiri Sesi
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <h3 className="text-sm font-bold text-white uppercase tracking-wide">Mulai Game</h3>
                  <p className="text-xs text-slate-400 mt-1">Satu klik langsung menampilkan cerita pertama ke semua pemain.</p>
                  <button
                    id="start-session-btn"
                    onClick={handleStartSession}
                    disabled={sessionLoading}
                    className="mt-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs px-4 py-2.5 rounded-xl transition-all shadow-md cursor-pointer disabled:opacity-50"
                  >
                    <Play className="w-3.5 h-3.5 inline mr-1" />
                    {sessionLoading ? "Memproses..." : "Mulai Game"}
                  </button>
                </>
              )}
            </div>
          ) : (
            <div className="w-full">
              <h3 className="text-sm font-bold text-white uppercase tracking-wide">Sesi Selesai</h3>
              <p className="text-xs text-slate-400 mt-1">Pemain bisa melihat hasil tebakan mereka. Mulai sesi baru kapan saja.</p>
              <button
                id="start-session-btn"
                onClick={handleStartSession}
                disabled={sessionLoading}
                className="mt-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs px-4 py-2.5 rounded-xl transition-all shadow-md cursor-pointer disabled:opacity-50"
              >
                <Play className="w-3.5 h-3.5 inline mr-1" />
                {sessionLoading ? "Memproses..." : "Mulai Sesi Baru"}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Player Submission Status */}
      <div className="bg-[#2b241c]/80 backdrop-blur-md border border-slate-800 p-5 rounded-2xl shadow-xl">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div>
            <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider font-mono flex items-center gap-2"><Users className="w-4 h-4 text-cyan-400" /> Kelola Pemain</h3>
            <p className="text-xs text-slate-500 mt-1">Ubah nama depan/password. Hapus ikut menghapus data milik pemain.</p>
          </div>
        </div>
        <div className="space-y-2">
          {users.filter(u => !u.isAdmin).map(user => editingUserId === user.id ? (
            <div key={user.id} className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2 rounded-xl border border-cyan-500/30 bg-cyan-950/10 p-3">
              <input value={editName} onChange={e => setEditName(e.target.value)} placeholder="Nama depan" className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />
              <input value={editPassword} onChange={e => setEditPassword(e.target.value)} placeholder="Password baru (opsional)" type="password" className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />
              <div className="flex gap-2"><button onClick={() => saveUser(user.id)} disabled={userSaving} className="p-2 rounded-lg bg-emerald-600 text-white"><Save className="w-4 h-4" /></button><button onClick={() => setEditingUserId(null)} className="p-2 rounded-lg bg-slate-800 text-slate-300"><X className="w-4 h-4" /></button></div>
            </div>
          ) : (
            <div key={user.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/30 px-3 py-2.5">
              <div><p className="text-sm font-bold text-white">{user.username}</p><p className="text-[11px] text-slate-500">{user.score} poin · {user.submittedCount} cerita{session.sessionId && user.isEliminated ? " · Gugur" : ""}</p></div>
              <div className="flex gap-2"><button onClick={() => { setEditingUserId(user.id); setEditName(user.username); setEditPassword(""); }} className="p-2 rounded-lg text-cyan-300 hover:bg-cyan-500/10" aria-label={`Edit ${user.username}`}><Pencil className="w-4 h-4" /></button><button onClick={() => deleteUser(user)} disabled={userSaving} className="p-2 rounded-lg text-rose-300 hover:bg-rose-500/10 disabled:opacity-50" aria-label={`Hapus ${user.username}`}><Trash2 className="w-4 h-4" /></button></div>
            </div>
          ))}
          {users.every(u => u.isAdmin) && <p className="text-xs text-slate-500">Belum ada pemain.</p>}
        </div>
      </div>

      {/* Player Submission Status */}
      <div className="bg-[#2b241c]/80 backdrop-blur-md border border-slate-800 p-5 rounded-2xl shadow-xl">
        <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-3 font-mono flex items-center gap-2">
          <Users className="w-4 h-4 text-pink-400" /> Status Cerita Pemain
        </h3>
        <div className="flex flex-wrap gap-3">
          {users.filter(u => !u.isAdmin).map(u => {
            const count = stories.filter(s => s.userId === u.id).length;
            return (
              <div key={u.id} className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-bold border ${
                count >= 2
                  ? "bg-emerald-950/30 border-emerald-800/40 text-emerald-300"
                  : "bg-amber-950/30 border-amber-800/40 text-amber-300"
              }`}>
                <span>{u.username}</span>
                <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                  count >= 2 ? "bg-emerald-500/20" : "bg-amber-500/20"
                }`}>{count}/2</span>
              </div>
            );
          })}
          {users.filter(u => !u.isAdmin).length === 0 && (
            <p className="text-xs text-slate-500">Belum ada pemain non-admin.</p>
          )}
        </div>
      </div>

      {/* Admin Quick Stats and Reset Controls */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Stat 1 */}
        <div className="bg-[#2b241c]/80 backdrop-blur-md border border-slate-800 p-5 rounded-2xl shadow-xl flex items-center justify-between">
          <div>
            <span className="block text-xs font-bold text-slate-400 uppercase font-mono">Cerita Aktif</span>
            <span className="text-3xl font-extrabold text-white mt-1 block">{stories.length}</span>
          </div>
          <div className="bg-pink-500/10 text-pink-400 border border-pink-500/20 p-3 rounded-xl">
            <Layers className="w-6 h-6" />
          </div>
        </div>

        {/* Reset Game Card */}
        <div className="bg-[#2b241c]/80 backdrop-blur-md border border-red-500/20 p-5 rounded-2xl shadow-xl md:col-span-2 flex flex-col justify-between">
          <div>
            <h3 className="text-sm font-bold text-white uppercase tracking-wide">Reset Total Data Game</h3>
            <p className="text-xs text-slate-400 mt-1 leading-relaxed">
              Menghapus semua cerita teka-teki, membersihkan log tebakan, mengosongkan obrolan chat, dan mengembalikan seluruh skor pemain ke 0.
            </p>
          </div>

          <div className="mt-4 flex items-center gap-3">
            {!confirmReset ? (
              <button
                id="trigger-reset-btn"
                onClick={() => setConfirmReset(true)}
                className="bg-red-600 hover:bg-red-750 text-white font-bold text-xs px-4 py-2.5 rounded-xl transition-all shadow-md cursor-pointer"
              >
                Reset Semua Data Game
              </button>
            ) : (
              <div className="flex items-center gap-2 bg-red-950/20 border border-red-900/30 p-2 rounded-xl">
                <span className="text-xs font-bold text-red-400 px-2">Yakin hapus semua?</span>
                <button
                  id="confirm-reset-btn"
                  onClick={handleReset}
                  className="bg-red-600 hover:bg-red-750 text-white font-bold text-xs px-3 py-1.5 rounded-lg transition-all cursor-pointer"
                >
                  Ya, Reset!
                </button>
                <button
                  id="cancel-reset-btn"
                  onClick={() => setConfirmReset(false)}
                  className="bg-slate-900 hover:bg-slate-800 text-slate-300 font-bold text-xs px-3 py-1.5 rounded-lg transition-all cursor-pointer"
                >
                  Batal
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Stories list with Answers */}
      <div className="bg-[#2b241c]/80 backdrop-blur-md rounded-2xl border border-slate-800 p-5 shadow-xl">
        <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-4 font-mono">
          Semua Cerita Aktif
        </h3>

        <div className="space-y-4">
          {stories.map((story) => (
            <div
              key={story.id}
              className="border border-slate-850 rounded-xl p-4 hover:bg-slate-900/40 transition-colors"
            >
              <div className="flex items-center justify-between gap-2 border-b border-slate-850 pb-2 mb-3">
                <div className="flex items-center gap-1.5 text-xs text-slate-400 font-semibold">
                  <span>Kreator: </span>
                  <span className="text-pink-300 font-bold">{story.username}</span>
                  <span className="text-slate-600 font-mono">({story.userId})</span>
                </div>
                <div className="flex items-center gap-2 text-[10px] text-slate-500 font-mono">
                  <Calendar className="w-3 h-3 text-slate-600" />
                  {formatDate(story.createdAt)}
                </div>
              </div>

              <div className="text-slate-300 text-xs italic mb-3 leading-relaxed">
                "{story.parts.map((part, idx) => (
                  <React.Fragment key={idx}>
                    <span>{part}</span>
                    {idx < story.blanks.length && (
                      <span className="bg-[#1a150f] text-pink-300 font-extrabold px-1 rounded border border-slate-800 font-sans mx-0.5">
                        {story.blanks[idx]}
                      </span>
                    )}
                  </React.Fragment>
                ))}"
              </div>
            </div>
          ))}

          {stories.length === 0 && (
            <div className="text-center py-8 text-sm text-slate-500">
              Belum ada cerita misteri yang dipublikasikan.
            </div>
          )}
        </div>
      </div>

      <div className="bg-[#2b241c]/80 backdrop-blur-md rounded-2xl border border-slate-800 p-5 shadow-xl">
        <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-4 font-mono">Riwayat Ronde</h3>
        <div className="space-y-2 max-h-72 overflow-y-auto">
          {session.revealedStoryIds.map((storyId, index) => {
            const story = stories.find(item => item.id === storyId);
            return <div key={storyId} className="flex items-center justify-between rounded-xl bg-slate-950/30 border border-slate-800 px-3 py-2.5 text-xs"><span className="text-slate-400">Ronde {index + 1}</span><span className="font-bold text-white">{story?.username || "Pemain dihapus"}</span><span className="text-emerald-300">{story?.answer || "—"}</span></div>;
          })}
          {session.revealedStoryIds.length === 0 && <p className="text-xs text-slate-500">Belum ada ronde selesai.</p>}
        </div>
      </div>
    </div>
  );
}
