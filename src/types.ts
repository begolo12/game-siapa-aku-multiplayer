export interface User {
  id: string;
  username: string;
  score: number;
  solvedCount: number;
  submittedCount: number;
  isAdmin: boolean;
  isReady?: boolean;
  isEliminated?: boolean;
}

export interface StoryTemplate {
  id: string;
  title: string;
  templateText: string; // The full text showing slots
  parts: string[];       // Text parts separated by blanks
  placeholders: string[]; // Length of 8, the placeholder descriptions for the inputs
}

export interface SubmittedStory {
  id: string;
  userId: string;
  username: string;
  templateId: string;
  parts: string[];       // The original template parts
  blanks: string[];      // 8 filled values
  answer?: string;       // The secret answer (Name/Character), optional for client-side security
  isSolvedBy: string[];  // Array of user IDs who guessed it correctly
  guessedBy?: string[];  // Array of user IDs who have attempted to guess this story
  createdAt: number;
}

export interface ChatMessage {
  id: string;
  userId: string;
  username: string;
  text: string;
  isAdmin: boolean;
  timestamp: number;
}

export interface GuessLog {
  id: string;
  userId: string;
  username: string;
  storyId: string;
  targetUsername: string;
  guessText: string;
  isCorrect: boolean;
  awardedPoints?: number;
  timestamp: number;
}

export type GamePhase = "idle" | "playing" | "ended";

export const ROUND_DURATION_MS = 30_000;

export interface SessionRound {
  storyId: string;
  startTime: number;
  /** Stored duration at round creation; clients derive the live countdown from startTime. */
  remainingMs: number;
  roundIndex: number; // 0-based
}

export function getRoundRemainingMs(round: SessionRound, now = Date.now()) {
  return Math.max(0, ROUND_DURATION_MS - (now - round.startTime));
}

export interface PlayerAnswer {
  userId: string;
  storyId: string;
  correctAnswer: string;
  playerGuess?: string;
  storyPreview: string;
  isCorrect: boolean;
  awardedPoints: number;
}

export interface RevealedAnswer {
  storyId: string;
  answer: string;
  storyPreview: string;
}

export interface Session {
  phase: GamePhase;
  sessionId: string | null;
  mysteryIds: string[];       // 25 story IDs selected for this session
  totalMysteries: number;
  endedAt: number | null;
  currentRound: SessionRound | null;
  roundIndex: number; // how many rounds completed so far
  revealedStoryIds: string[]; // stories whose answers have been revealed after round end
  lastRevealed?: RevealedAnswer; // most recently revealed answer (for showing reveal card)
}

export interface GameState {
  users: User[];
  stories: SubmittedStory[];
  chat: ChatMessage[];
  guessLogs: GuessLog[];
  session: Session;
  // For players after session ends
  myResults?: PlayerAnswer[];
}
