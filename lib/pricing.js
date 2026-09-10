const { all, get, run } = require("./db");
const { readProjectEnv, envNumber } = require("./env");

function ratesFromEnv(env = readProjectEnv()) {
  return {
    colorMultiplierStart: envNumber(env, "COLOR_MULTIPLIER_START", 1),
    colorMultiplierPerExtra: envNumber(env, "COLOR_MULTIPLIER_PER_EXTRA", 0.1),
    timeBlockHours: envNumber(env, "TIME_BLOCK_HOURS", 4),
    timeMultiplierStart: envNumber(env, "TIME_MULTIPLIER_START", 1),
    timeMultiplierPerBlock: envNumber(env, "TIME_MULTIPLIER_PER_BLOCK", 0.1),
    plateFeePerPlate: envNumber(env, "PLATE_FEE_PER_PLATE", 1000),
  };
}

async function loadPricing() {
  const rows = await all("SELECT key, value FROM settings");
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    digipogsPerGram: Number(map.digipogs_per_gram) || 10,
    ...ratesFromEnv(),
  };
}

async function syncPricingSettings() {
  const rates = ratesFromEnv();
  const pairs = [
    ["color_multiplier_start", String(rates.colorMultiplierStart)],
    ["color_multiplier_per_extra", String(rates.colorMultiplierPerExtra)],
    ["time_block_hours", String(rates.timeBlockHours)],
    ["time_multiplier_start", String(rates.timeMultiplierStart)],
    ["time_multiplier_per_block", String(rates.timeMultiplierPerBlock)],
    ["plate_fee_per_plate", String(rates.plateFeePerPlate)],
  ];
  for (const [key, value] of pairs) {
    await run("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", [
      key,
      value,
    ]);
  }
}

function roundPogs(n) {
  return Math.round(n * 10) / 10;
}

function formatPogs(n) {
  const rounded = roundPogs(n);
  const text = Number.isInteger(rounded)
    ? String(rounded)
    : rounded.toFixed(1);
  return `${text} digipogs`;
}

function formatMultiplier(n) {
  const rounded = roundPogs(n);
  return Number.isInteger(rounded) ? `${rounded}×` : `${rounded.toFixed(1)}×`;
}

function formatPlain(n) {
  const rounded = roundPogs(n);
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function formatDuration(seconds) {
  const total = Math.round(Number(seconds) || 0);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (h <= 0) return `${m}m`;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

function normalizeColorKey(color) {
  const raw = String(color || "").trim().toLowerCase();
  if (!raw) return "";
  const hex = raw.replace(/^#/, "");
  if (/^[0-9a-f]{6}$/.test(hex)) return hex;
  if (/^[0-9a-f]{3}$/.test(hex)) {
    return hex
      .split("")
      .map((ch) => ch + ch)
      .join("");
  }
  return raw;
}

function uniqueColorCount(slots, fallback = 1) {
  const keys = new Set();
  for (const slot of slots || []) {
    const hex = normalizeColorKey(slot.color);
    if (hex) {
      keys.add(hex);
      continue;
    }
    if (slot.catalogId != null && String(slot.catalogId) !== "") {
      keys.add(`id:${slot.catalogId}`);
      continue;
    }
    const name = String(slot.name || "").trim().toLowerCase();
    const material = String(slot.material || "").trim().toLowerCase();
    if (name || material) keys.add(`name:${material}|${name}`);
  }
  if (keys.size) return keys.size;
  const n = Number(fallback);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function quotePrint({ grams, colors, seconds, slots, plates }, rates = {}) {
  rates = { ...rates, ...ratesFromEnv() };
  const hours = (Number(seconds) || 0) / 3600;
  const plateCount = Math.max(1, Math.floor(Number(plates) || 1));
  const slotList =
    Array.isArray(slots) && slots.length
      ? slots
      : [{ grams, pricePerGram: rates.digipogsPerGram }];
  const base = slotList.reduce(
    (sum, slot) => sum + Number(slot.grams) * Number(slot.pricePerGram),
    0
  );
  const colorCount = uniqueColorCount(slotList, colors);
  const extraColors = Math.max(0, colorCount - 1);
  const colorMultiplier =
    rates.colorMultiplierStart +
    rates.colorMultiplierPerExtra * extraColors;
  const timeBlocks = Math.floor(hours / rates.timeBlockHours);
  const timeMultiplier =
    rates.timeMultiplierStart + rates.timeMultiplierPerBlock * timeBlocks;
  const plateFee = plateCount * rates.plateFeePerPlate;
  const total = roundPogs(base * colorMultiplier * timeMultiplier + plateFee);

  return {
    grams,
    colors: colorCount,
    seconds,
    hours,
    plates: plateCount,
    rates,
    base,
    extraColors,
    colorMultiplier,
    timeMultiplier,
    timeBlocks,
    plateFee,
    total,
    amountInt: Math.max(1, Math.round(total)),
    formatted: {
      base: formatPogs(base),
      colorMultiplier: formatMultiplier(colorMultiplier),
      timeMultiplier: formatMultiplier(timeMultiplier),
      plateFee: formatPogs(plateFee),
      colorRule: `${formatMultiplier(rates.colorMultiplierStart)} first color + ${formatMultiplier(rates.colorMultiplierPerExtra)} each extra`,
      timeRule: `${formatPlain(rates.timeMultiplierStart)} + ${formatPlain(rates.timeMultiplierPerBlock)} per ${rates.timeBlockHours}h`,
      plateRule: `${formatPlain(rates.plateFeePerPlate)} per build plate`,
      total: formatPogs(total),
      duration: formatDuration(seconds),
    },
  };
}

async function loadFilamentCatalog() {
  const rows = await all(
    "SELECT id, slug, material, name, color, price_per_gram FROM filaments ORDER BY material, name"
  );
  return rows.map((row) => ({
    id: String(row.id),
    slug: row.slug,
    material: row.material,
    name: row.name,
    color: row.color,
    pricePerGram: Number(row.price_per_gram),
  }));
}

async function getFilamentById(id) {
  const row = await get(
    "SELECT id, slug, material, name, color, price_per_gram FROM filaments WHERE id = ?",
    [id]
  );
  if (!row) return null;
  return {
    id: String(row.id),
    slug: row.slug,
    material: row.material,
    name: row.name,
    color: row.color,
    pricePerGram: Number(row.price_per_gram),
  };
}

module.exports = {
  loadPricing,
  syncPricingSettings,
  ratesFromEnv,
  quotePrint,
  uniqueColorCount,
  formatPogs,
  formatMultiplier,
  formatDuration,
  roundPogs,
  loadFilamentCatalog,
  getFilamentById,
};
