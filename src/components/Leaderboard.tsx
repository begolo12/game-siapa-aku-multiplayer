import React from "react";
import { User } from "../types";
import { Trophy, Medal, Award, CheckCircle2, FileText, Star } from "lucide-react";

interface LeaderboardProps {
  users: User[];
  currentUserId?: string;
}

export default function Leaderboard({ users, currentUserId }: LeaderboardProps) {
  // Sort users by score descending
  const sortedUsers = [...users].sort((a, b) => b.score - a.score);

  return (
    <div className="bg-[#2b241c]/80 backdrop-blur-md rounded-2xl border border-slate-800/80 p-5 shadow-xl relative overflow-hidden">
      <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-amber-500/20 to-transparent" />
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="bg-amber-500/10 p-1.5 rounded-lg border border-amber-500/20">
            <Trophy className="w-4 h-4 text-amber-400" />
          </div>
          <h2 className="text-sm font-bold text-white uppercase tracking-wider">Papan Skor</h2>
        </div>
        <span className="text-[11px] font-mono bg-pink-500/10 text-pink-400 border border-pink-500/20 px-2 py-0.5 rounded-md font-semibold">
          {users.length} Pemain
        </span>
      </div>

      <div className="space-y-2 max-h-[350px] overflow-y-auto pr-1">
        {sortedUsers.map((user, index) => {
          const rank = index + 1;
          const isMe = user.id === currentUserId;

          // Render rank icon
          let rankBadge = null;
          if (rank === 1) {
            rankBadge = <Medal className="w-5 h-5 text-yellow-400 fill-yellow-400/20" />;
          } else if (rank === 2) {
            rankBadge = <Medal className="w-5 h-5 text-slate-300 fill-slate-300/20" />;
          } else if (rank === 3) {
            rankBadge = <Medal className="w-5 h-5 text-amber-600 fill-amber-600/20" />;
          } else {
            rankBadge = <span className="text-xs font-bold text-slate-500 w-5 text-center font-mono">{rank}</span>;
          }

          return (
            <div
              key={user.id}
              className={`flex items-center justify-between p-3 rounded-xl border transition-all duration-200 ${
                isMe
                  ? "bg-pink-500/10 border-pink-500/30 shadow-md shadow-pink-500/5"
                  : "bg-[#281f17]/60 border-slate-800/80 hover:border-slate-700 hover:bg-[#281f17]/80"
              }`}
            >
              <div className="flex items-center space-x-3">
                <div className="flex items-center justify-center w-6 h-6">
                  {rankBadge}
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className={`text-sm font-semibold ${isMe ? "text-pink-300" : "text-slate-200"}`}>
                      {user.username}
                    </span>
                    {isMe && (
                      <span className="text-[9px] font-bold bg-pink-500 text-white px-1.5 py-0.5 rounded-full font-sans uppercase">
                        Anda
                      </span>
                    )}
                    {user.isAdmin && (
                      <span className="text-[9px] font-bold bg-red-500/20 text-red-400 border border-red-500/30 px-1.5 py-0.5 rounded-md font-sans uppercase">
                        Admin
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-0.5 text-[11px] text-slate-400">
                    <span className="flex items-center gap-0.5" title="Cerita dibuat">
                      <FileText className="w-3 h-3 text-pink-400" /> {user.submittedCount || 0}
                    </span>
                    <span className="flex items-center gap-0.5" title="Tebakan benar">
                      <CheckCircle2 className="w-3 h-3 text-emerald-400" /> {user.solvedCount || 0}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-1">
                <Star className={`w-3.5 h-3.5 ${rank <= 3 ? "text-amber-400 fill-amber-400/20" : "text-slate-500"}`} />
                <span className="text-sm font-extrabold text-white font-mono">
                  {user.score}
                </span>
              </div>
            </div>
          );
        })}

        {sortedUsers.length === 0 && (
          <div className="text-center py-6 text-sm text-slate-500">
            Belum ada pemain aktif.
          </div>
        )}
      </div>
    </div>
  );
}
