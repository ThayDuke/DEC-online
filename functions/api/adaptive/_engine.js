// Cloudflare Pages Functions - Adaptive Realtime IRT Engine

import * as bankA from "./_bank_A.js";
import * as bankB from "./_bank_B.js";
import * as bankC from "./_bank_C.js";

const BANKS = {
  A: bankA,
  B: bankB,
  C: bankC
};

function getBank(level) {
  const key = String(level || "A").toUpperCase();
  return BANKS[key] || BANKS.A;
}

const CEFR_BANDS = [
  [-2.33, "A1-"],
  [-1.65, "A1"],
  [-0.98, "A2"],
  [-0.30, "A3"],
  [0.18, "B1"],
  [0.66, "B2"],
  [1.15, "B3"],
  [1.63, "B4"],
  [1.97, "C1"],
  [2.32, "C2"],
  [2.66, "C3"]
];

function abilityToLevel(theta) {
  for (const [limit, code] of CEFR_BANDS) {
    if (theta < limit) return code;
  }
  return "C4";
}

function getPreferredZone(level, ability) {
  if (level === "B") {
    if (ability >= 1.10) return "practice";
    if (ability >= 0.98) return "structure";
    return "core";
  }
  if (level === "C") {
    if (ability >= 2.50) return "practice";
    if (ability >= 2.38) return "structure";
    return "core";
  }
  if (ability >= -1.25) return "practice";
  if (ability >= -1.40) return "structure";
  return "core";
}

export function maskItem(item, level = "A") {
  if (!item) return null;
  return {
    item_id: item.id,
    question_text: item.q,
    options: item.opts,
    topic: item.top,
    topic_label: item.label,
    zone: item.zone,
    level: item.level || level || "A"
  };
}

export function startSession(params = {}) {
  const maxQ = Math.max(10, Math.min(30, Number(params.max_questions) || 20));
  const minQ = Math.max(8, Math.min(15, Number(params.min_questions) || 12));
  const targetSE = Math.max(0.2, Math.min(0.5, Number(params.target_se) || 0.33));

  const reqLevel = String(params.level || "A").toUpperCase();
  const sessionLevel = (reqLevel === "B" || reqLevel === "C") ? reqLevel : "A";

  let defaultStart = -1.50;
  if (sessionLevel === "B") defaultStart = 0.80;
  else if (sessionLevel === "C") defaultStart = 2.30;
  const startAbility = Number.isFinite(params.start_ability) ? Number(params.start_ability) : defaultStart;

  const bank = getBank(sessionLevel);

  const session = {
    session_id: "cf_" + Date.now().toString(36) + "_" + Math.random().toString(36).substring(2, 8),
    student_id: String(params.student_id || "Học viên"),
    level: sessionLevel,
    purpose: String(params.purpose || "placement"),
    ability: startAbility,
    se: 0.95,
    min_questions: minQ,
    max_questions: maxQ,
    target_se: targetSE,
    answered_count: 0,
    correct_count: 0,
    current_item_id: null,
    served_ids: [],
    topic_counts: {},
    recent_topics: [],
    answers_log: [],
    exp: Date.now() + 7200 * 1000
  };

  // Start with a randomized core item
  const corePool = (bank.ITEMS_BY_ZONE && bank.ITEMS_BY_ZONE.core && bank.ITEMS_BY_ZONE.core.length)
    ? bank.ITEMS_BY_ZONE.core
    : bank.ALL_ITEMS;
  const randomIndex = Math.floor(Math.random() * corePool.length);
  const firstItem = corePool[randomIndex];

  session.current_item_id = firstItem.id;
  session.served_ids.push(firstItem.id);
  session.topic_counts[firstItem.top] = 1;
  session.recent_topics.push(firstItem.top);

  return {
    session,
    first_item: maskItem(firstItem, sessionLevel)
  };
}

export function processAnswer(session, itemId, selectedIndex, responseTimeSec = 0) {
  if (!session || !session.current_item_id) {
    throw new Error("Invalid session state");
  }
  if (session.current_item_id !== itemId) {
    throw new Error("Mismatched question item for session");
  }

  const bank = getBank(session.level);
  const item = bank.ITEMS_BY_ID[itemId];
  if (!item) {
    throw new Error("Question not found in bank");
  }

  const isCorrect = Number(selectedIndex) === item.ans;
  session.answered_count += 1;
  if (isCorrect) session.correct_count += 1;

  // IRT CAT estimation update
  const gap = item.diff - session.ability;
  const stepBase = Math.max(0.12, Math.min(0.35, session.se * 0.35));
  let nextAbility = isCorrect
    ? session.ability + stepBase * (gap >= 0 ? 1.15 : 0.75)
    : session.ability - stepBase * (gap <= 0 ? 1.15 : 0.75);
  nextAbility = Math.max(-3, Math.min(3, Number(nextAbility.toFixed(3))));

  // Dynamic SE convergence
  const history = session.answers_log.map(a => Boolean(a.is_correct));
  const fullHistory = [...history, isCorrect];
  let decayFactor = 0.93;
  if (fullHistory.length >= 3) {
    const last3 = fullHistory.slice(-3);
    const allSame = (last3[0] === last3[1]) && (last3[1] === last3[2]);
    const isFluctuating = (last3[0] !== last3[1]) && (last3[1] !== last3[2]);
    if (allSame) decayFactor = 0.88;
    else if (isFluctuating) decayFactor = 0.98;
    else decayFactor = 0.935;
  } else if (fullHistory.length >= 2) {
    decayFactor = (fullHistory[0] !== fullHistory[1]) ? 0.96 : 0.92;
  }
  const nextSE = Math.max(0.2, Number((session.se * decayFactor).toFixed(3)));

  session.ability = nextAbility;
  session.se = nextSE;

  session.answers_log.push({
    step_number: session.answered_count,
    item_id: item.id,
    topic: item.top,
    topic_label: item.label,
    zone: item.zone,
    is_correct: isCorrect,
    selected_index: selectedIndex,
    correct_option_index: item.ans,
    correct_option_text: item.opts[item.ans],
    difficulty: item.diff,
    response_time_sec: Number(responseTimeSec) || 0
  });

  // Stopping rule: hit max questions OR reached targeted precision after min questions
  const reachedMax = session.answered_count >= session.max_questions;
  const reachedSE = session.answered_count >= session.min_questions && session.se <= session.target_se;
  const stopFlag = reachedMax || reachedSE;

  if (stopFlag) {
    session.current_item_id = null;
    const finalResult = generateResultPayload(session, reachedMax);
    return {
      session,
      is_correct: isCorrect,
      correct_option_index: item.ans,
      correct_option_text: item.opts[item.ans],
      questions_answered: session.answered_count,
      correct_count: session.correct_count,
      stop_flag: true,
      result: finalResult
    };
  }

  // Pick next question with topic quota, recent topic penalty, and tier mapping
  const nextItem = pickNextQuestion(session);
  if (!nextItem) {
    // If no candidate, finish test gracefully
    session.current_item_id = null;
    const finalResult = generateResultPayload(session, true);
    return {
      session,
      is_correct: isCorrect,
      correct_option_index: item.ans,
      correct_option_text: item.opts[item.ans],
      questions_answered: session.answered_count,
      correct_count: session.correct_count,
      stop_flag: true,
      result: finalResult
    };
  }

  session.current_item_id = nextItem.id;
  session.served_ids.push(nextItem.id);
  session.topic_counts[nextItem.top] = (session.topic_counts[nextItem.top] || 0) + 1;
  session.recent_topics.push(nextItem.top);
  if (session.recent_topics.length > 5) {
    session.recent_topics.shift();
  }

  return {
    session,
    is_correct: isCorrect,
    correct_option_index: item.ans,
    correct_option_text: item.opts[item.ans],
    questions_answered: session.answered_count,
    correct_count: session.correct_count,
    stop_flag: false,
    next_item: maskItem(nextItem, session.level)
  };
}

function pickNextQuestion(session) {
  const bank = getBank(session.level);
  const preferredZone = getPreferredZone(session.level, session.ability);

  const servedSet = new Set(session.served_ids);
  let pool = (bank.ITEMS_BY_ZONE[preferredZone] || []).filter(it => !servedSet.has(it.id));
  if (pool.length < 10) {
    // Fallback to all unserved items in bank
    pool = bank.ALL_ITEMS.filter(it => !servedSet.has(it.id));
  }
  if (!pool.length) return null;

  const maxItemsPerTopic = 2; // Strict 2 items per topic cap
  let eligible = pool.filter(it => (session.topic_counts[it.top] || 0) < maxItemsPerTopic);
  if (!eligible.length) {
    eligible = pool.filter(it => (session.topic_counts[it.top] || 0) < 3);
  }
  if (!eligible.length) {
    eligible = pool;
  }

  const recent = session.recent_topics || [];
  let bestItem = eligible[0];
  let bestScore = Infinity;

  for (let i = 0; i < eligible.length; i++) {
    const it = eligible[i];
    let score = Math.abs(it.diff - session.ability);

    // Topic count penalty
    const count = session.topic_counts[it.top] || 0;
    score *= (1.0 + count * 2.0);

    // Recent topics penalty
    if (recent.length >= 1 && it.top === recent[recent.length - 1]) {
      score *= 4.0;
    } else if (recent.length >= 2 && it.top === recent[recent.length - 2]) {
      score *= 2.0;
    }

    // Tie-break jitter
    score += Math.random() * 0.05;

    if (score < bestScore) {
      bestScore = score;
      bestItem = it;
    }
  }

  return bestItem;
}

export function generateResultPayload(session, isMaxCount = false) {
  const finalLevel = abilityToLevel(session.ability);

  // Group topic stats
  const topicMap = new Map();
  for (const log of session.answers_log) {
    const key = log.topic || "general";
    if (!topicMap.has(key)) {
      topicMap.set(key, {
        topic_key: key,
        topic_label: log.topic_label || key,
        total: 0,
        correct: 0,
        wrong: 0
      });
    }
    const stat = topicMap.get(key);
    stat.total += 1;
    if (log.is_correct) stat.correct += 1;
    else stat.wrong += 1;
  }

  const topicSummary = Array.from(topicMap.values());
  const weakTopics = topicSummary
    .filter(t => t.wrong >= 1 || (t.total > 0 && t.correct / t.total < 0.6))
    .sort((a, b) => b.wrong - a.wrong);

  return {
    ok: true,
    session_id: session.session_id,
    student_name: session.student_id,
    level: session.level,
    final_ability: session.ability,
    final_se: session.se,
    final_level: finalLevel,
    recommended_level: finalLevel,
    questions_answered: session.answered_count,
    correct_count: session.correct_count,
    total_questions: session.answered_count,
    finish_reason_label: isMaxCount
      ? "Đạt giới hạn tối đa số câu hỏi"
      : "Đã đạt độ tin cậy chuẩn hóa (SE <= 0.33)",
    diagnostic: {
      topic_summary: topicSummary
    },
    topic_summary: topicSummary,
    weak_topics: weakTopics,
    review_topics: weakTopics
  };
}
