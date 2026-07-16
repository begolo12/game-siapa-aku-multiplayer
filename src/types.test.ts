import assert from "node:assert/strict";
import test from "node:test";
import { getRoundTiming, ROUND_DURATION_MS, SessionRound } from "./types";

const round: SessionRound = {
  storyId: "story-1",
  startTime: 10_000,
  remainingMs: ROUND_DURATION_MS,
  roundIndex: 0
};

test("round uses one absolute server timeline", () => {
  assert.deepEqual(getRoundTiming(round, 4_000), {
    state: "scheduled",
    startsInMs: 6_000,
    remainingMs: ROUND_DURATION_MS
  });
  assert.equal(getRoundTiming(round, 10_000).remainingMs, 30_000);
  assert.equal(getRoundTiming(round, 25_000).remainingMs, 15_000);
  assert.equal(getRoundTiming(round, 40_000).state, "expired");
  assert.equal(getRoundTiming(round, 40_000).remainingMs, 0);
});

test("different client clocks agree after applying server offsets", () => {
  const slowClient = getRoundTiming(round, 8_000, 7_000);
  const fastClient = getRoundTiming(round, 20_000, -5_000);
  assert.deepEqual(slowClient, fastClient);
  assert.equal(slowClient.remainingMs, 25_000);
});

test("armed and extreme timestamps remain bounded", () => {
  assert.deepEqual(getRoundTiming({ ...round, startTime: null }, 99_000), {
    state: "armed",
    startsInMs: null,
    remainingMs: ROUND_DURATION_MS
  });
  assert.equal(getRoundTiming(round, -1_000_000).remainingMs, ROUND_DURATION_MS);
  assert.equal(getRoundTiming(round, 1_000_000).remainingMs, 0);
});
