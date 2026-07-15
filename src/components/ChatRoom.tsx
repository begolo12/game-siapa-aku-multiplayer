import React, { useState, useRef, useEffect, memo } from "react";
import { ChatMessage, User } from "../types";
import { MessageSquare, Send, Bell, Trophy, ShieldAlert, XCircle } from "lucide-react";

interface ChatRoomProps {
  chat: ChatMessage[];
  currentUser: User | null;
  onSendMessage: (text: string) => Promise<void>;
}

const formatTime = (timestamp: number) => {
  const d = new Date(timestamp);
  return d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
};

const ChatRoom = memo(function ChatRoom({ chat, currentUser, onSendMessage }: ChatRoomProps) {
  const [inputText, setInputText] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom on mount
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "auto" });
  }, []);

  // Smart scroll to bottom on new messages
  useEffect(() => {
    const container = chatContainerRef.current;
    if (!container) return;
    
    // Check if user is already near bottom (within 120px) to auto-scroll
    const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 120;
    if (isNearBottom) {
      chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [chat.length]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || isSending) return;

    setIsSending(true);
    setSendError(null);
    try {
      await onSendMessage(inputText.trim());
      setInputText("");
    } catch (error) {
      setSendError(error instanceof Error ? error.message : "Gagal mengirim pesan chat.");
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="bg-[#2b241c]/80 backdrop-blur-md rounded-2xl border border-slate-800/80 shadow-xl flex flex-col h-[350px] sm:h-[500px] relative overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-slate-800/80 bg-[#241d15]/60 rounded-t-2xl relative">
        <div className="absolute bottom-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-pink-500/15 to-transparent" />
        <div className="flex items-center gap-2">
          <div className="bg-pink-500/10 text-pink-400 p-1.5 rounded-lg border border-pink-500/20">
            <MessageSquare className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-white uppercase tracking-wider">Obrolan</h2>
            <p className="text-[11px] text-slate-400">Diskusi & tebakan langsung</p>
          </div>
        </div>
        <span className="flex h-2 w-2 relative">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
        </span>
      </div>

      {/* Messages list */}
      <div ref={chatContainerRef} className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-thin">
        {chat.map((msg) => {
          // Check if it's a special system message
          const isSystem = msg.userId === "system" || msg.username.startsWith("System");
          const isCorrectAns = msg.username === "System-Berhasil";
          const isWrongAns = msg.username === "System-Tebak";

          if (isSystem) {
            let systemBg = "bg-[#221a13] text-pink-300 border border-pink-500/20";
            let icon = <Bell className="w-3.5 h-3.5 text-pink-400 shrink-0" />;

            if (isCorrectAns) {
              systemBg = "bg-emerald-950/40 text-emerald-300 border border-emerald-500/30 font-medium";
              icon = <Trophy className="w-3.5 h-3.5 text-emerald-400 shrink-0" />;
            } else if (isWrongAns) {
              systemBg = "bg-rose-950/40 text-rose-300 border border-rose-500/30 text-xs";
              icon = <XCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />;
            }

            return (
              <div key={msg.id} className={`p-2.5 rounded-xl text-xs flex items-start gap-2 ${systemBg} shadow-sm animate-fadeIn`}>
                {icon}
                <div className="flex-1">
                  <span>{msg.text}</span>
                  <span className="block text-[9px] text-slate-500 mt-1 text-right font-mono">
                    {formatTime(msg.timestamp)}
                  </span>
                </div>
              </div>
            );
          }

          const isMe = msg.userId === currentUser?.id;

          return (
            <div
              key={msg.id}
              className={`flex flex-col max-w-[85%] ${isMe ? "ml-auto items-end" : "mr-auto items-start"}`}
            >
              {/* Sender Name */}
              {!isMe && (
                <div className="flex items-center gap-1 mb-0.5 px-1">
                  <span className="text-[11px] font-bold text-slate-300">{msg.username}</span>
                  {msg.isAdmin && (
                    <span className="text-[9px] font-extrabold bg-red-500/20 text-red-400 border border-red-500/30 px-1 rounded uppercase font-mono">
                      Admin
                    </span>
                  )}
                </div>
              )}

              {/* Message Bubble */}
              <div
                className={`p-3 rounded-2xl text-sm shadow-sm ${
                  isMe
                    ? "bg-gradient-to-tr from-pink-500 to-purple-600 text-white rounded-tr-none shadow-pink-500/10"
                    : "bg-[#241a12] text-slate-200 rounded-tl-none border border-slate-800"
                }`}
              >
                <p className="break-all whitespace-pre-wrap leading-relaxed">{msg.text}</p>
                <span
                  className={`block text-[9px] mt-1 text-right font-mono ${
                    isMe ? "text-pink-200/80" : "text-slate-500"
                  }`}
                >
                  {formatTime(msg.timestamp)}
                </span>
              </div>
            </div>
          );
        })}
        <div ref={chatEndRef} />
      </div>

      {/* Input section */}
      <form onSubmit={handleSubmit} className="p-3 border-t border-slate-800/60 bg-[#160d2e]/40 rounded-b-2xl relative">
        <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-slate-800/50 to-transparent" />
        <div className="flex gap-2">
          <input
            id="chat-input"
            type="text"
            placeholder={currentUser ? "Ketik pesan..." : "Harap login untuk mengobrol..."}
            disabled={!currentUser || isSending}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            className="flex-1 text-sm bg-[#1a150f]/80 border border-slate-800/80 rounded-xl px-3 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-pink-500/50 focus:border-pink-500/50 focus:bg-[#1a150f] disabled:bg-slate-950 disabled:cursor-not-allowed transition-all"
          />
          <button
            id="send-chat-btn"
            type="submit"
            disabled={!currentUser || !inputText.trim() || isSending}
            className="bg-gradient-to-r from-pink-500 to-purple-600 hover:from-pink-600 hover:to-purple-700 disabled:from-slate-800 disabled:to-slate-800 disabled:cursor-not-allowed text-white p-2.5 rounded-xl transition-all duration-200 shadow-md hover:shadow-pink-500/20 hover:scale-105 active:scale-95 cursor-pointer shrink-0 flex items-center justify-center"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
        {sendError && <p className="mt-2 text-xs font-semibold text-rose-300" role="alert">{sendError}</p>}
      </form>
    </div>
  );
});

export default ChatRoom;
