const MODEL_ID_RE = /\/models\/(\d+)/i;
const PROFILE_ID_RE = /profileId[-=](\d+)/i;

function parseMakerWorldUrl(raw) {
  if (!raw || typeof raw !== "string") {
    throw new Error("Paste a MakerWorld model URL.");
  }

  let candidate = raw.trim();
  if (!candidate) {
    throw new Error("Paste a MakerWorld model URL.");
  }
  if (!candidate.includes("://")) {
    candidate = "https://" + candidate;
  }

  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error("That does not look like a valid URL.");
  }

  const host = (parsed.hostname || "").toLowerCase();
  if (host !== "makerworld.com" && !host.endsWith(".makerworld.com")) {
    throw new Error("URL must be from makerworld.com.");
  }

  const modelMatch = MODEL_ID_RE.exec(parsed.pathname);
  if (!modelMatch) {
    throw new Error("URL must include a /models/{id} path.");
  }

  const modelId = Number(modelMatch[1]);
  let instanceId = null;
  const fragment = parsed.hash || "";
  const profileMatch = PROFILE_ID_RE.exec(fragment);
  if (profileMatch) {
    instanceId = Number(profileMatch[1]);
  }

  return { modelId, instanceId };
}

module.exports = { parseMakerWorldUrl };
