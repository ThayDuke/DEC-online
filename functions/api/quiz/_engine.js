import * as bankA from "./_bank_A.js";
import * as bankB from "./_bank_B.js";
import * as bankC from "./_bank_C.js";

const BANKS = { A: bankA.LESSON_BANKS, B: bankB.LESSON_BANKS, C: bankC.LESSON_BANKS };
export const QUIZ_BLOCK_SIZE = 10;

function normalizeLesson(value) {
  return String(value || "").replace(/\\/g, "/").replace(/^\/+/, "");
}

function getItems(level, lesson) {
  const bank = BANKS[String(level || "A").toUpperCase()] || BANKS.A;
  return bank[normalizeLesson(lesson)] || [];
}

function randomSeed() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function seededRandom(seed) {
  let state = 2166136261;
  for (const char of String(seed)) {
    state ^= char.charCodeAt(0);
    state = Math.imul(state, 16777619);
  }
  return () => {
    state += 0x6D2B79F5;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function buildOrder(total, seed) {
  const order = Array.from({ length: total }, (_, index) => index);
  const random = seededRandom(seed);
  for (let index = order.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [order[index], order[swap]] = [order[swap], order[index]];
  }
  return order;
}

function mask(item) {
  return { id: item.id, q: item.q, a: item.a };
}

export function startSession(params = {}) {
  const level = String(params.level || "A").toUpperCase();
  const lesson = normalizeLesson(params.lesson);
  const items = getItems(level, lesson);
  if (!items.length) throw new Error("Quiz lesson not found in QBank");
  const seed = randomSeed();
  const order = buildOrder(items.length, seed);
  const blockSize = QUIZ_BLOCK_SIZE;
  const end = Math.min(blockSize, order.length);
  return {
    session: {
      v: 1,
      sid: `quiz_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      level,
      lesson,
      seed,
      offset: end,
      total: order.length,
      exp: Date.now() + 7200 * 1000
    },
    questions: order.slice(0, end).map(index => mask(items[index])),
    block_index: 0,
    total: order.length,
    has_more: end < order.length,
    block_size: blockSize
  };
}

export function nextBlock(session) {
  const items = getItems(session.level, session.lesson);
  if (!items.length) throw new Error("Quiz lesson not found in QBank");
  const order = buildOrder(items.length, session.seed);
  const start = Math.max(0, Number(session.offset) || 0);
  const end = Math.min(start + QUIZ_BLOCK_SIZE, order.length);
  const nextSession = { ...session, offset: end };
  return {
    session: nextSession,
    questions: order.slice(start, end).map(index => mask(items[index])),
    block_index: Math.floor(start / QUIZ_BLOCK_SIZE),
    total: order.length,
    has_more: end < order.length,
    block_size: QUIZ_BLOCK_SIZE
  };
}
