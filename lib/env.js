const path = require("path");
const fs = require("fs");
const dotenv = require("dotenv");

const ENV_PATH = path.join(__dirname, "..", ".env");

function readProjectEnv() {
  try {
    const text = fs
      .readFileSync(ENV_PATH)
      .toString("utf8")
      .replace(/^\uFEFF/, "")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n");
    return dotenv.parse(text);
  } catch {
    return {};
  }
}

function envNumber(env, key, fallback) {
  const raw = env[key];
  if (raw == null || String(raw).trim() === "") return fallback;
  const n = Number(String(raw).replace(/^\uFEFF/, "").trim());
  return Number.isFinite(n) ? n : fallback;
}

module.exports = { ENV_PATH, readProjectEnv, envNumber };
