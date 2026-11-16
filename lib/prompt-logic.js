// Pure prompt-selection helpers (issue #10).

export function hashString(value) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

// YYYY-MM-DD in the user's local time zone (toISOString() would use UTC).
export function localDayKey(dateValue = new Date()) {
  const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function countEntriesOnDay(entries, dayKey) {
  return entries.reduce((count, entry) => (localDayKey(entry.date) === dayKey ? count + 1 : count), 0);
}

// Least-used topic among `topics` over the recent entries; ties are broken
// deterministically by `tieSeed` so the wildcard does not always land on the
// first topic in declaration order.
export function chooseLeastUsedTopic(entries, topics, tieSeed = "") {
  const usage = new Map(topics.map((topic) => [topic, 0]));
  entries.forEach((entry) => {
    if (usage.has(entry.topic)) usage.set(entry.topic, usage.get(entry.topic) + 1);
  });

  const min = Math.min(...usage.values());
  const candidates = topics.filter((topic) => usage.get(topic) === min);
  return candidates[mixHash(hashString(`wildcard-${tieSeed}`)) % candidates.length];
}

// Murmur3 finalizer: spreads hashString's nearly-linear output so that ids
// differing only in a trailing digit get unrelated scores.
export function mixHash(value) {
  let h = value | 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

// Ranks prompts by a per-prompt hash of the seed, skips recently used ones and
// returns the one at `offset` (the "Try another prompt" counter), so each try
// moves to a different prompt. Ranking each prompt independently keeps the
// choice stable when unrelated history changes (e.g. deleting an old memory).
export function pickRankedPrompt(pool, seed, recentPromptIds = new Set(), offset = 0) {
  if (!pool.length) return null;
  const ranked = [...pool].sort((a, b) => {
    const scoreA = mixHash(hashString(`${seed}::${a.id}`));
    const scoreB = mixHash(hashString(`${seed}::${b.id}`));
    return scoreA - scoreB || a.id.localeCompare(b.id);
  });
  const fresh = ranked.filter((prompt) => !recentPromptIds.has(prompt.id));
  const candidates = fresh.length ? fresh : ranked;
  const index = ((Math.trunc(offset) % candidates.length) + candidates.length) % candidates.length;
  return candidates[index];
}

export function customPromptId(text) {
  return `custom-${(hashString(text.trim()) >>> 0).toString(36)}`;
}
