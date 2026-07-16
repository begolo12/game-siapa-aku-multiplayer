import React from "react";

/** Reusable skeleton loader for content placeholders. */
export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-xl bg-slate-800/50 ${className}`}
      aria-hidden="true"
    />
  );
}

/** Story card skeleton — shown while game state loads. */
export function StoryCardSkeleton() {
  return (
    <div className="bg-[#2b241c]/80 backdrop-blur-md rounded-2xl border border-slate-800 p-6 space-y-4">
      <div className="flex items-center justify-between">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-6 w-20 rounded-full" />
      </div>
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-3/4" />
      <div className="flex gap-3 pt-2">
        <Skeleton className="h-10 flex-1 rounded-xl" />
        <Skeleton className="h-10 w-24 rounded-xl" />
      </div>
    </div>
  );
}

/** Leaderboard skeleton — shown while users load. */
export function LeaderboardSkeleton() {
  return (
    <div className="bg-[#2b241c]/80 backdrop-blur-md rounded-2xl border border-slate-800/80 p-5 space-y-3">
      <div className="flex items-center gap-2 mb-4">
        <Skeleton className="h-8 w-8 rounded-lg" />
        <Skeleton className="h-4 w-24" />
      </div>
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="h-8 w-8 rounded-full" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-4 w-12" />
        </div>
      ))}
    </div>
  );
}

/** Chat skeleton — shown while chat loads. */
export function ChatSkeleton() {
  return (
    <div className="bg-[#2b241c]/80 backdrop-blur-md rounded-2xl border border-slate-800/80 p-5 space-y-3">
      <Skeleton className="h-4 w-20 mb-4" />
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="flex items-start gap-2">
          <Skeleton className="h-6 w-6 rounded-full shrink-0" />
          <div className="space-y-1 flex-1">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-3 w-full" />
          </div>
        </div>
      ))}
    </div>
  );
}
