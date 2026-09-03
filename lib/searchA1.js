const { searchDesigns, fetchDesign } = require("./makerworld");
const { designHasA1Print } = require("./a1");
const { isNsfw } = require("./nsfw");

const SEARCH_PAGE_SIZE = 24;
const SEARCH_BATCH = 40;
const MAX_SCAN = 200;
const CACHE_TTL_MS = 10 * 60 * 1000;
const FETCH_CONCURRENCY = 6;

const cache = new Map();

async function mapPool(items, concurrency, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      out[index] = await fn(items[index], index);
    }
  }
  const n = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: n }, worker));
  return out;
}

function cardFromHit(hit) {
  return {
    id: hit.id,
    title: hit.title,
    slug: hit.slug || "",
    cover: hit.cover || "",
    creator: (hit.designCreator && hit.designCreator.name) || "",
    printCount: hit.printCount || 0,
  };
}

function getCache(q) {
  const key = String(q || "").trim().toLowerCase();
  const existing = cache.get(key);
  if (existing && Date.now() - existing.updatedAt < CACHE_TTL_MS) {
    return existing;
  }
  const fresh = {
    hits: [],
    apiOffset: 0,
    apiTotal: 0,
    exhausted: false,
    updatedAt: Date.now(),
  };
  cache.set(key, fresh);
  return fresh;
}

async function ensurePrintableHits(q, needed, rules) {
  const state = getCache(q);
  while (!state.exhausted && state.hits.length < needed) {
    if (state.apiOffset >= MAX_SCAN) {
      state.exhausted = true;
      break;
    }
    if (state.apiTotal && state.apiOffset >= state.apiTotal) {
      state.exhausted = true;
      break;
    }
    const limit = Math.min(SEARCH_BATCH, MAX_SCAN - state.apiOffset);
    const found = await searchDesigns(q, {
      limit,
      offset: state.apiOffset,
    });
    state.apiTotal = Number(found.total) || 0;
    state.apiOffset += found.hits.length;
    state.updatedAt = Date.now();
    if (!found.hits.length) {
      state.exhausted = true;
      break;
    }
    const candidates = found.hits.filter((hit) => !isNsfw(hit));
    const checked = await mapPool(candidates, FETCH_CONCURRENCY, async (hit) => {
      try {
        const design = await fetchDesign(hit.id);
        if (isNsfw(design)) return null;
        if (!designHasA1Print(design, rules)) return null;
        return cardFromHit(hit);
      } catch {
        return null;
      }
    });
    for (const card of checked) {
      if (card) state.hits.push(card);
    }
    if (state.apiTotal && state.apiOffset >= state.apiTotal) {
      state.exhausted = true;
    }
  }
  return state;
}

async function searchA1Printable(q, page, rules) {
  const safePage = Math.max(1, Number(page) || 1);
  const start = (safePage - 1) * SEARCH_PAGE_SIZE;
  const needed = start + SEARCH_PAGE_SIZE + 1;
  const state = await ensurePrintableHits(q, needed, rules);
  const hits = state.hits.slice(start, start + SEARCH_PAGE_SIZE);
  const hasNext =
    state.hits.length > start + SEARCH_PAGE_SIZE ||
    (!state.exhausted && hits.length === SEARCH_PAGE_SIZE);
  return {
    hits,
    page: safePage,
    hasPrev: safePage > 1,
    hasNext,
    scannedOut: state.exhausted && state.hits.length <= start,
  };
}

module.exports = {
  SEARCH_PAGE_SIZE,
  searchA1Printable,
};
