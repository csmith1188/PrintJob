function roundPogs(n) {
  return Math.round(n * 10) / 10;
}

function formatPogs(n) {
  const rounded = roundPogs(n);
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
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

function uniqueColorCount(slots) {
  const keys = new Set();
  for (const slot of slots) {
    const hex = normalizeColorKey(slot.color);
    if (hex) keys.add(hex);
    else if (slot.catalogId) keys.add(`id:${slot.catalogId}`);
  }
  return Math.max(1, keys.size);
}

function selectedSlot(card) {
  const select = card.querySelector(".filament-select");
  const option = select.options[select.selectedIndex];
  const grams = Number(card.dataset.grams) || 0;
  if (!option || option.value === "default") {
    return {
      grams,
      pricePerGram: Number(card.dataset.defaultPrice),
      material: card.dataset.defaultMaterial,
      color: card.dataset.defaultColor,
    };
  }
  return {
    grams,
    pricePerGram: Number(option.dataset.price),
    material: option.dataset.material,
    color: option.dataset.color,
    catalogId: option.value,
  };
}

function updateCard(card, slot) {
  const material = card.querySelector(".filament-material");
  const swatch = card.querySelector(".filament-swatch");
  if (material) material.textContent = slot.material;
  if (swatch) swatch.style.background = slot.color;
}

function formatBaseLabel(slots) {
  const parts = slots.map(
    (slot) => `${slot.grams} g × ${slot.pricePerGram}`
  );
  return `Base (${parts.join(" + ")})`;
}

function readRates() {
  const table = document.getElementById("quote-breakdown");
  const ratesEl = document.getElementById("quote-rates");
  const fromJson = ratesEl ? JSON.parse(ratesEl.textContent) : {};
  const d = table && table.dataset ? table.dataset : {};
  return {
    colorMultiplierStart: Number(
      d.colorStart ?? fromJson.colorMultiplierStart
    ),
    colorMultiplierPerExtra: Number(
      d.colorExtra ?? fromJson.colorMultiplierPerExtra
    ),
    timeMultiplierStart: Number(d.timeStart ?? fromJson.timeMultiplierStart),
    timeMultiplierPerBlock: Number(
      d.timePerBlock ?? fromJson.timeMultiplierPerBlock
    ),
    timeBlockHours: Number(d.timeBlockHours ?? fromJson.timeBlockHours),
    plateFeePerPlate: Number(d.plateFee ?? fromJson.plateFeePerPlate),
    plates: Number(d.plates ?? fromJson.plates) || 1,
    seconds: Number(d.seconds ?? fromJson.seconds),
  };
}

function updateQuote() {
  const rates = readRates();
  if (!Number.isFinite(rates.colorMultiplierPerExtra)) return;
  const cards = [...document.querySelectorAll(".filament-card")];
  const slots = cards.map((card) => {
    const slot = selectedSlot(card);
    updateCard(card, slot);
    return slot;
  });

  const base = slots.reduce(
    (sum, slot) => sum + slot.grams * slot.pricePerGram,
    0
  );
  const colorCount = uniqueColorCount(slots);
  const extraColors = Math.max(0, colorCount - 1);
  const colorMultiplier =
    rates.colorMultiplierStart +
    rates.colorMultiplierPerExtra * extraColors;
  const hours = rates.seconds / 3600;
  const timeBlocks = Math.floor(hours / rates.timeBlockHours);
  const timeMultiplier =
    rates.timeMultiplierStart + rates.timeMultiplierPerBlock * timeBlocks;
  const plateCount = Math.max(1, Math.floor(rates.plates) || 1);
  const plateFee = plateCount * rates.plateFeePerPlate;
  const total = roundPogs(base * colorMultiplier * timeMultiplier + plateFee);
  const colorWord = colorCount === 1 ? "color" : "colors";
  const plateWord = plateCount === 1 ? "plate" : "plates";
  const colorRule = `${formatMultiplier(rates.colorMultiplierStart)} first color + ${formatMultiplier(rates.colorMultiplierPerExtra)} each extra`;
  const timeRule = `${formatPlain(rates.timeMultiplierStart)} + ${formatPlain(rates.timeMultiplierPerBlock)} per ${rates.timeBlockHours}h`;

  const baseLabel = document.getElementById("quote-base-label");
  const baseCell = document.getElementById("quote-base");
  const colorCountEl = document.getElementById("quote-color-count");
  const colorLabel = document.getElementById("quote-color-label");
  const colorCell = document.getElementById("quote-color");
  const timeLabel = document.getElementById("quote-time-label");
  const timeCell = document.getElementById("quote-time");
  const plateLabel = document.getElementById("quote-plate-label");
  const plateCell = document.getElementById("quote-plate");
  const plateCountEl = document.getElementById("quote-plate-count");
  const totalCell = document.getElementById("quote-total");
  if (baseLabel) baseLabel.textContent = formatBaseLabel(slots);
  if (baseCell) baseCell.textContent = formatPogs(base);
  if (colorCountEl) colorCountEl.textContent = String(colorCount);
  if (colorLabel) {
    colorLabel.textContent = `Color multiplier (${colorRule} · ${colorCount} ${colorWord})`;
  }
  if (colorCell) colorCell.textContent = formatMultiplier(colorMultiplier);
  if (timeLabel) {
    timeLabel.textContent = `Time multiplier (${timeRule} · ${formatDuration(rates.seconds)})`;
  }
  if (timeCell) timeCell.textContent = formatMultiplier(timeMultiplier);
  if (plateLabel) {
    plateLabel.textContent = `Build plate fee (${rates.plateFeePerPlate} × ${plateCount} ${plateWord})`;
  }
  if (plateCell) plateCell.textContent = formatPogs(plateFee);
  if (plateCountEl) plateCountEl.textContent = String(plateCount);
  if (totalCell) totalCell.textContent = formatPogs(total);
}

function bindFilamentSelects() {
  document.querySelectorAll(".filament-select").forEach((select) => {
    select.addEventListener("change", updateQuote);
    select.addEventListener("input", updateQuote);
  });
  updateQuote();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bindFilamentSelects);
} else {
  bindFilamentSelects();
}
