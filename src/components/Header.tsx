import React from "react";
import { User } from "../types";
import { LogOut, Shield, Trophy, BookOpen } from "lucide-react";

interface HeaderProps {
  currentUser: User | null;
  onLogout: () => void;
}

export default function Header({ currentUser, onLogout }: HeaderProps) {
  return (
    <header className="bg-[#2b241c]/90 backdrop-blur-md border-b border-slate-900 sticky top-0 z-40">
      <div className="absolute bottom-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-pink-500/30 to-transparent" />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-14 items-center">
          {/* Logo / Title */}
          <div className="flex items-center space-x-2.5">
            <div className="bg-gradient-to-tr from-pink-500 via-purple-600 to-amber-500 p-1.5 sm:p-2 rounded-xl shadow-lg shadow-pink-500/15 text-white relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-tr from-white/10 to-transparent" />
              <BookOpen className="w-4 h-4 sm:w-5 sm:h-5 text-yellow-300 relative z-10" />
            </div>
            <div>
              <h1 className="text-base sm:text-lg font-bold tracking-tight bg-gradient-to-r from-pink-400 via-amber-300 to-cyan-400 bg-clip-text text-transparent font-extrabold">Siapa Aku?</h1>
              <p className="hidden sm:block text-[9px] text-pink-400/70 font-mono tracking-wider">Multiplayer Detective Game</p>
            </div>
          </div>

          {/* User badge only */}
          {currentUser && (
            <div className="flex items-center gap-2 bg-slate-900/80 border border-slate-800/80 px-2 sm:px-3 py-1 sm:py-1.5 rounded-xl hover:border-slate-700 transition-colors">
              <div className="flex flex-col items-end">
                <div className="flex items-center gap-1">
                  {currentUser.isAdmin && <Shield className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-red-400" />}
                  <span className="text-xs sm:text-sm font-semibold text-slate-200">{currentUser.username}</span>
                </div>
                <span className="text-[10px] sm:text-xs text-amber-400 font-bold flex items-center gap-1 font-mono">
                  <Trophy className="w-2.5 h-2.5 sm:w-3 sm:h-3 text-amber-400" /> {currentUser.score} Poin
                </span>
              </div>
              <button
                id="logout-btn"
                onClick={onLogout}
                title="Logout"
                className="p-1 sm:p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-950/40 transition-all cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
