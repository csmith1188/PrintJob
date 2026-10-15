const { all, get, run } = require("./db");

function nowIso() {
  return new Date().toISOString();
}

async function listQueuedJobs() {
  const rows = await all(
    "SELECT * FROM jobs WHERE status IN ('queued', 'started') ORDER BY created_at ASC, id ASC"
  );
  return rows.map((job) => {
    let filaments = [];
    try {
      const parsed = JSON.parse(job.filaments_json || "[]");
      if (Array.isArray(parsed)) filaments = parsed;
    } catch {
      filaments = [];
    }
    return { ...job, filaments };
  });
}

async function listTopModels(limit = 10) {
  return all(
    `SELECT
       model_id,
       title,
       cover_url,
       makerworld_url,
       COUNT(*) AS purchase_count
     FROM jobs
     WHERE status != 'refunded'
       AND makerworld_url IS NOT NULL
       AND makerworld_url != ''
     GROUP BY makerworld_url
     ORDER BY purchase_count DESC, title ASC
     LIMIT ?`,
    [limit]
  );
}

async function insertJob(job) {
  const result = await run(
    `INSERT INTO jobs (
      user_id, user_name, user_email, model_id, instance_id, title, cover_url, profile_title,
      makerworld_url, grams, colors, seconds, filaments_json, amount, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?)`,
    [
      job.userId,
      job.userName,
      job.userEmail || null,
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

async function startJob(id) {
  const result = await run(
    "UPDATE jobs SET status = 'started' WHERE id = ? AND status = 'queued'",
    [id]
  );
  return result.changes > 0;
}

async function completeJob(id, title, coverUrl, modelId) {
  const finished = nowIso();
  const result = await run(
    "UPDATE jobs SET status = 'completed', finished_at = ? WHERE id = ? AND status IN ('queued', 'started')",
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
  const result = await run(
    "UPDATE jobs SET status = 'refunded', finished_at = ? WHERE id = ? AND status IN ('queued', 'started')",
    [nowIso(), id]
  );
  return result.changes > 0;
}

async function getAnalyticsTotals() {
  const spentRow = await get(
    `SELECT COALESCE(SUM(amount), 0) AS total
     FROM transfers
     WHERE direction = 'pay' AND success = 1`
  );
  const refundedRow = await get(
    `SELECT COALESCE(SUM(amount), 0) AS total
     FROM transfers
     WHERE direction = 'refund' AND success = 1`
  );
  const spent = Number(spentRow?.total) || 0;
  const refunded = Number(refundedRow?.total) || 0;
  return {
    spent,
    refunded,
    net: spent - refunded,
  };
}

async function listRepeatBuyers() {
  return all(
    `SELECT
       user_id,
       MAX(user_name) AS user_name,
       MAX(user_email) AS user_email,
       COUNT(*) AS purchase_count,
       COALESCE(SUM(amount), 0) AS total_spent
     FROM jobs
     WHERE status != 'refunded'
     GROUP BY user_id
     HAVING COUNT(*) >= 2
     ORDER BY purchase_count DESC, total_spent DESC`
  );
}

async function listJobsForUsers(userIds) {
  if (!userIds.length) return [];
  const placeholders = userIds.map(() => "?").join(", ");
  return all(
    `SELECT
       id, user_id, title, profile_title, amount, status, created_at, makerworld_url
     FROM jobs
     WHERE user_id IN (${placeholders})
     ORDER BY created_at DESC, id DESC`,
    userIds
  );
}

async function listTopProfilesForUsers(userIds) {
  if (!userIds.length) return [];
  const placeholders = userIds.map(() => "?").join(", ");
  return all(
    `SELECT
       user_id,
       instance_id,
       makerworld_url,
       MAX(profile_title) AS profile_title,
       MAX(title) AS title,
       MAX(cover_url) AS cover_url,
       COUNT(*) AS purchase_count
     FROM jobs
     WHERE status != 'refunded'
       AND user_id IN (${placeholders})
       AND (
         instance_id IS NOT NULL
         OR (makerworld_url IS NOT NULL AND makerworld_url != '')
       )
     GROUP BY
       user_id,
       CASE
         WHEN instance_id IS NOT NULL THEN 'i:' || instance_id
         ELSE 'u:' || makerworld_url
       END
     ORDER BY purchase_count DESC, title ASC`,
    userIds
  );
}

async function getAnalytics() {
  const totals = await getAnalyticsTotals();
  const buyers = await listRepeatBuyers();
  const userIds = buyers.map((b) => b.user_id);
  const [jobs, profiles] = await Promise.all([
    listJobsForUsers(userIds),
    listTopProfilesForUsers(userIds),
  ]);

  const jobsByUser = new Map();
  for (const job of jobs) {
    const list = jobsByUser.get(job.user_id) || [];
    list.push(job);
    jobsByUser.set(job.user_id, list);
  }

  const profilesByUser = new Map();
  for (const profile of profiles) {
    const list = profilesByUser.get(profile.user_id) || [];
    list.push(profile);
    profilesByUser.set(profile.user_id, list);
  }

  return {
    totals,
    repeatBuyers: buyers.map((buyer) => ({
      ...buyer,
      purchase_count: Number(buyer.purchase_count) || 0,
      total_spent: Number(buyer.total_spent) || 0,
      jobs: jobsByUser.get(buyer.user_id) || [],
      profiles: profilesByUser.get(buyer.user_id) || [],
    })),
  };
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
  startJob,
  completeJob,
  refundJob,
  getAnalyticsTotals,
  listRepeatBuyers,
  getAnalytics,
  slugify,
  validHex,
};
