const { all, get, run } = require("./db");

function nowIso() {
  return new Date().toISOString();
}

async function listQueuedJobs() {
  return all(
    "SELECT * FROM jobs WHERE status = 'queued' ORDER BY created_at ASC, id ASC"
  );
}

async function listTopModels(limit = 10) {
  return all(
    "SELECT model_id, title, cover_url, print_count FROM model_prints ORDER BY print_count DESC, title ASC LIMIT ?",
    [limit]
  );
}

async function insertJob(job) {
  const result = await run(
    `INSERT INTO jobs (
      user_id, user_name, model_id, instance_id, title, cover_url, profile_title,
      makerworld_url, grams, colors, seconds, filaments_json, amount, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?)`,
    [
      job.userId,
      job.userName,
      job.modelId,
      job.instanceId,
      job.title,
      job.coverUrl,
      job.profileTitle,
      job.makerworldUrl,
      job.grams,
      job.colors,
      job.seconds,
      job.filamentsJson,
      job.amount,
      nowIso(),
    ]
  );
  return result.lastID;
}

async function insertTransfer(row) {
  await run(
    `INSERT INTO transfers (
      job_id, direction, from_type, from_id, to_type, to_id, amount, success, message, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.jobId,
      row.direction,
      row.fromType,
      row.fromId,
      row.toType,
      row.toId,
      row.amount,
      row.success ? 1 : 0,
      row.message || "",
      nowIso(),
    ]
  );
}

async function getJob(id) {
  return get("SELECT * FROM jobs WHERE id = ?", [id]);
}

async function completeJob(id, title, coverUrl, modelId) {
  const finished = nowIso();
  const result = await run(
    "UPDATE jobs SET status = 'completed', finished_at = ? WHERE id = ? AND status = 'queued'",
    [finished, id]
  );
  if (!result.changes) return false;
  const existing = await get(
    "SELECT model_id FROM model_prints WHERE model_id = ?",
    [modelId]
  );
  if (existing) {
    await run(
      "UPDATE model_prints SET print_count = print_count + 1, title = ?, cover_url = ? WHERE model_id = ?",
      [title, coverUrl, modelId]
    );
  } else {
    await run(
      "INSERT INTO model_prints (model_id, title, cover_url, print_count) VALUES (?, ?, ?, 1)",
      [modelId, title, coverUrl]
    );
  }
  return true;
}

async function refundJob(id) {
  await run(
    "UPDATE jobs SET status = 'refunded', finished_at = ? WHERE id = ? AND status = 'queued'",
    [nowIso(), id]
  );
}

function slugify(material, name) {
  return `${material}-${name}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

function validHex(color) {
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(String(color || "").trim());
}

module.exports = {
  listQueuedJobs,
  listTopModels,
  insertJob,
  insertTransfer,
  getJob,
  completeJob,
  refundJob,
  slugify,
  validHex,
};
