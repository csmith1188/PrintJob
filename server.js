const path = require("path");
const dotenv = require("dotenv");
const { ENV_PATH, readProjectEnv } = require("./lib/env");

function projectEnv() {
  return readProjectEnv();
}

dotenv.config({
  path: ENV_PATH,
  override: true,
});
const express = require("express");
const jwt = require("jsonwebtoken");
const session = require("express-session");
const SQLiteStore = require("connect-sqlite3")(session);

const { parseMakerWorldUrl } = require("./lib/parseUrl");
const {
  fetchDesign,
  instanceFilaments,
  collectPrinterNames,
  nozzleDiameter,
  designPictures,
  designSummaryText,
  makerworldModelUrl,
} = require("./lib/makerworld");
const { loadA1Rules, pickPrintableInstance } = require("./lib/a1");
const {
  loadPricing,
  syncPricingSettings,
  quotePrint,
  loadFilamentCatalog,
} = require("./lib/pricing");
const { isNsfw } = require("./lib/nsfw");
const { searchA1Printable } = require("./lib/searchA1");
const { connectFormbar, payPool, refundFromPool } = require("./lib/formbar");
const {
  listQueuedJobs,
  listTopModels,
  insertJob,
  insertTransfer,
  getJob,
  completeJob,
  refundJob,
  slugify,
  validHex,
} = require("./lib/store");
const { all, get, run } = require("./lib/db");

const app = express();
const fileEnv = projectEnv();
const PORT = fileEnv.PORT || process.env.PORT || 3000;
const AUTH_URL = String(
  fileEnv.AUTH_URL || "https://formbar.yorktechapps.com"
)
  .replace(/\/oauth\/?$/, "")
  .replace(/\/$/, "");
const THIS_URL = String(fileEnv.THIS_URL || `http://localhost:${PORT}`).replace(
  /\/$/,
  ""
);
const SESSION_SECRET = fileEnv.SESSION_SECRET || process.env.SESSION_SECRET || "change-me";
const API_KEY = fileEnv.API_KEY || "";
const POOL_ID = Number(fileEnv.POOL_ID || 59);
const POOL_PIN = fileEnv.POOL_PIN || "";
const ADMIN_USER_IDS = String(fileEnv.ADMIN_USER_IDS || "1")
  .split(",")
  .map((id) => Number(String(id).trim()))
  .filter((id) => Number.isFinite(id));
const POOL_OWNER_ID = Number(fileEnv.POOL_OWNER_ID || ADMIN_USER_IDS[0] || 1);

const formbarSocket = connectFormbar(AUTH_URL, API_KEY);

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.urlencoded({ extended: true }));
app.use(
  express.static(path.join(__dirname, "public"), {
    etag: false,
    lastModified: false,
    setHeaders(res) {
      res.setHeader("Cache-Control", "no-store");
    },
  })
);
app.use(
  session({
    store: new SQLiteStore({ db: "app.db", dir: "./db" }),
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
  })
);

function isAdmin(req) {
  return ADMIN_USER_IDS.includes(Number(req.session.userId));
}

function requireAuth(req, res, next) {
  if (req.session.user) return next();
  res.redirect("/login");
}

function requireAdmin(req, res, next) {
  if (req.session.user && isAdmin(req)) return next();
  res.status(403).send("Admin only.");
}

async function layout(req, extra = {}) {
  const [queue, topModels, pricing] = await Promise.all([
    listQueuedJobs(),
    listTopModels(10),
    loadPricing(),
  ]);
  return {
    user: req.session.user || null,
    userId: req.session.userId || null,
    isAdmin: isAdmin(req),
    queue,
    topModels,
    url: "",
    error: extra.error || null,
    notice: extra.notice || null,
    result: extra.result || null,
    ...extra,
    pricing,
    poolId: extra.poolId != null ? extra.poolId : POOL_ID,
  };
}

async function buildQuote(url) {
  const { modelId, instanceId } = parseMakerWorldUrl(url);
  const design = await fetchDesign(modelId);
  if (isNsfw(design)) {
    const err = new Error(
      "This MakerWorld model is marked NSFW and cannot be quoted or queued."
    );
    err.status = 400;
    throw err;
  }
  const rules = await loadA1Rules();
  const { instance, a1 } = pickPrintableInstance(design, instanceId, rules);
  const filaments = instance ? instanceFilaments(instance) : [];
  const printers = instance ? collectPrinterNames(instance) : [];
  const rates = await loadPricing();
  const catalog = await loadFilamentCatalog();
  let quote = null;
  if (a1.printable) {
    quote = quotePrint(
      {
        grams: Number(instance.weight),
        colors: a1.colors,
        seconds: Number(instance.prediction),
        slots: filaments.map((f) => ({
          grams: Number(f.usedG) || 0,
          pricePerGram: rates.digipogsPerGram,
          material: f.type,
          color: f.color,
        })),
      },
      rates
    );
  }
  return {
    design,
    instance,
    filaments,
    catalog,
    printers,
    nozzle: instance ? nozzleDiameter(instance) : null,
    a1,
    quote,
    rates,
    makerworldUrl: instance
      ? `https://makerworld.com/en/models/${design.id}#profileId-${instance.id}`
      : makerworldModelUrl(design),
  };
}

function resolveSlots(filaments, picks, catalog, rates) {
  const byId = new Map(catalog.map((c) => [String(c.id), c]));
  return filaments.map((f, i) => {
    const pick = picks[i] == null ? "default" : String(picks[i]);
    if (pick === "default" || !pick) {
      return {
        grams: Number(f.usedG) || 0,
        pricePerGram: rates.digipogsPerGram,
        material: f.type,
        color: f.color,
        name: "Default",
      };
    }
    const item = byId.get(pick);
    if (!item) {
      throw new Error("Unknown filament selection.");
    }
    return {
      grams: Number(f.usedG) || 0,
      pricePerGram: item.pricePerGram,
      material: item.material,
      color: item.color,
      name: item.name,
      catalogId: item.id,
    };
  });
}

function formbarUserIdFromToken(tokenData) {
  const raw =
    tokenData.id ??
    tokenData.userId ??
    tokenData.userID ??
    tokenData.sub;
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function quotePageResult(built, quote) {
  return {
    title: built.design.title,
    coverUrl: built.instance.cover || built.design.coverUrl,
    profileTitle: built.instance.title,
    makerworldUrl: built.makerworldUrl,
    filaments: built.filaments,
    catalog: built.catalog,
    printers: built.printers,
    nozzle: built.nozzle,
    a1: built.a1,
    quote,
    modelId: built.design.id,
    instanceId: built.instance.id,
  };
}

function explainTransferError(message) {
  return String(message || "Payment failed.");
}

app.get("/login", (req, res) => {
  if (req.query.token) {
    const tokenData = jwt.decode(req.query.token);
    const userId = tokenData && formbarUserIdFromToken(tokenData);
    if (!tokenData || userId == null) {
      return res.status(400).send("Invalid Formbar token.");
    }
    req.session.token = tokenData;
    req.session.user = tokenData.displayName;
    req.session.userId = userId;
    return res.redirect("/");
  }
  const redirectURL = encodeURIComponent(`${THIS_URL}/login`);
  const oauth = `${AUTH_URL}/oauth?redirectURL=${redirectURL}`;
  res.redirect(oauth);
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/"));
});

app.get("/", async (req, res) => {
  try {
    res.render("index", await layout(req));
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.get("/search", async (req, res) => {
  const q = String(req.query.q || "").trim();
  const page = Math.max(1, Number(req.query.page) || 1);
  let hits = [];
  let error = null;
  let hasPrev = false;
  let hasNext = false;
  try {
    const rules = await loadA1Rules();
    const found = await searchA1Printable(q, page, rules);
    hits = found.hits;
    hasPrev = found.hasPrev;
    hasNext = found.hasNext;
  } catch (err) {
    error = err.message || "Could not search MakerWorld.";
  }
  res.render(
    "search",
    await layout(req, {
      q,
      page,
      hits,
      error,
      hasPrev,
      hasNext,
    })
  );
});

app.get("/api/models/:id", async (req, res) => {
  const modelId = Number(req.params.id);
  if (!Number.isInteger(modelId) || modelId <= 0) {
    return res.status(400).json({ error: "Invalid model id." });
  }
  try {
    const design = await fetchDesign(modelId);
    if (isNsfw(design)) {
      return res.status(400).json({
        error: "This MakerWorld model is marked NSFW and cannot be quoted.",
      });
    }
    res.json({
      id: design.id,
      title: design.title,
      creator: (design.designCreator && design.designCreator.name) || "",
      summary: designSummaryText(design),
      pictures: designPictures(design),
      makerworldUrl: makerworldModelUrl(design),
    });
  } catch (err) {
    res.status(err.status || 400).json({
      error: err.message || "Could not load that model.",
    });
  }
});

app.post("/quote", async (req, res) => {
  const url = String(req.body.url || "").trim();
  try {
    const built = await buildQuote(url);
    res.render(
      "index",
      await layout(req, {
        url,
        result: quotePageResult(built, built.quote),
      })
    );
  } catch (err) {
    res.status(err.status || 400).render(
      "index",
      await layout(req, {
        url,
        error: err.message || "Could not quote that URL.",
      })
    );
  }
});

app.post("/queue", requireAuth, async (req, res) => {
  const url = String(req.body.url || "").trim();
  const pin = req.body.pin;
  let pageResult = null;
  try {
    const built = await buildQuote(url);
    if (!built.a1.printable || !built.quote) {
      throw new Error("This print cannot be queued for an A1.");
    }
    const picks = built.filaments.map((_, i) => req.body[`slot_${i}`]);
    const slots = resolveSlots(
      built.filaments,
      picks,
      built.catalog,
      built.rates
    );
    const quote = quotePrint(
      {
        grams: Number(built.instance.weight),
        colors: built.a1.colors,
        seconds: Number(built.instance.prediction),
        slots,
      },
      built.rates
    );
    pageResult = quotePageResult(built, quote);
    const amount = quote.amountInt;
    const token = req.session.token || {};
    const senderId =
      formbarUserIdFromToken(token) || req.session.userId;
    const transfer = await payPool(formbarSocket, {
      userId: senderId,
      poolId: POOL_ID,
      amount,
      pin,
      reason: `A1 print: ${built.design.title}`,
    });

    if (!transfer.success) {
      await insertTransfer({
        jobId: null,
        direction: "pay",
        fromType: "user",
        fromId: senderId,
        toType: "pool",
        toId: POOL_ID,
        amount,
        success: false,
        message: transfer.message,
      });
      throw new Error(
        explainTransferError(transfer.message)
      );
    }

    const jobId = await insertJob({
      userId: senderId,
      userName: req.session.user,
      modelId: built.design.id,
      instanceId: built.instance.id,
      title: built.design.title,
      coverUrl: built.instance.cover || built.design.coverUrl,
      profileTitle: built.instance.title,
      makerworldUrl: built.makerworldUrl,
      grams: quote.grams,
      colors: quote.colors,
      seconds: quote.seconds,
      filamentsJson: JSON.stringify(slots),
      amount,
    });
    await insertTransfer({
      jobId,
      direction: "pay",
      fromType: "user",
      fromId: senderId,
      toType: "pool",
      toId: POOL_ID,
      amount,
      success: true,
      message: transfer.message,
    });

    res.render(
      "index",
      await layout(req, {
        url,
        notice: `Paid ${amount} digipogs and added to the queue.`,
      })
    );
  } catch (err) {
    res.status(400).render(
      "index",
      await layout(req, {
        url,
        result: pageResult,
        error: err.message || "Could not add that print to the queue.",
      })
    );
  }
});

app.post("/queue/:id/complete", requireAuth, requireAdmin, async (req, res) => {
  const job = await getJob(req.params.id);
  if (!job || job.status !== "queued") {
    return res.status(400).send("Job is not in the queue.");
  }
  await completeJob(job.id, job.title, job.cover_url, job.model_id);
  res.redirect("/");
});

app.post("/queue/:id/refund", requireAuth, requireAdmin, async (req, res) => {
  const job = await getJob(req.params.id);
  if (!job || job.status !== "queued") {
    return res.status(400).send("Job is not in the queue.");
  }
  if (!POOL_PIN) {
    return res.status(500).send("POOL_PIN is not configured.");
  }
  const transfer = await refundFromPool(formbarSocket, {
    userId: job.user_id,
    ownerId: POOL_OWNER_ID,
    amount: job.amount,
    pin: POOL_PIN,
    reason: `Refund A1 print #${job.id}: ${job.title}`,
  });
  await insertTransfer({
    jobId: job.id,
    direction: "refund",
    fromType: "user",
    fromId: POOL_OWNER_ID,
    toType: "user",
    toId: job.user_id,
    amount: job.amount,
    success: transfer.success,
    message: transfer.message,
  });
  if (!transfer.success) {
    return res.status(400).send(transfer.message || "Refund transfer failed.");
  }
  await refundJob(job.id);
  res.redirect("/");
});

app.get("/admin/colors", requireAuth, requireAdmin, async (req, res) => {
  const filaments = await all(
    "SELECT * FROM filaments ORDER BY material, name"
  );
  res.render("admin-colors", {
    user: req.session.user,
    isAdmin: true,
    filaments,
    error: req.query.error || null,
    notice: req.query.notice || null,
  });
});

app.post("/admin/colors", requireAuth, requireAdmin, async (req, res) => {
  try {
    const material = String(req.body.material || "").trim();
    const name = String(req.body.name || "").trim();
    const color = String(req.body.color || "").trim();
    const price = Number(req.body.price_per_gram);
    if (!material || !name) throw new Error("Material and name are required.");
    if (!validHex(color)) throw new Error("Color must be #RGB or #RRGGBB.");
    if (!Number.isFinite(price) || price < 0) {
      throw new Error("Price per gram must be zero or more.");
    }
    let slug = slugify(material, name);
    const existing = await get("SELECT id FROM filaments WHERE slug = ?", [
      slug,
    ]);
    if (existing) slug = `${slug}-${Date.now()}`;
    await run(
      "INSERT INTO filaments (slug, material, name, color, price_per_gram) VALUES (?, ?, ?, ?, ?)",
      [slug, material, name, color, price]
    );
    res.redirect("/admin/colors?notice=Added");
  } catch (err) {
    res.redirect(
      `/admin/colors?error=${encodeURIComponent(err.message)}`
    );
  }
});

app.post("/admin/colors/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const material = String(req.body.material || "").trim();
    const name = String(req.body.name || "").trim();
    const color = String(req.body.color || "").trim();
    const price = Number(req.body.price_per_gram);
    if (!material || !name) throw new Error("Material and name are required.");
    if (!validHex(color)) throw new Error("Color must be #RGB or #RRGGBB.");
    if (!Number.isFinite(price) || price < 0) {
      throw new Error("Price per gram must be zero or more.");
    }
    const result = await run(
      "UPDATE filaments SET material = ?, name = ?, color = ?, price_per_gram = ? WHERE id = ?",
      [material, name, color, price, req.params.id]
    );
    if (!result.changes) throw new Error("Color not found.");
    res.redirect("/admin/colors?notice=Saved");
  } catch (err) {
    res.redirect(
      `/admin/colors?error=${encodeURIComponent(err.message)}`
    );
  }
});

app.post(
  "/admin/colors/:id/delete",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    await run("DELETE FROM filaments WHERE id = ?", [req.params.id]);
    res.redirect("/admin/colors?notice=Deleted");
  }
);

app.get("/api/pricing", async (_req, res) => {
  res.json(await loadPricing());
});

app.listen(PORT, async () => {
  await syncPricingSettings();
  const rates = await loadPricing();
  console.log(`A1 quote site listening on http://localhost:${PORT}`);
  console.log(
    `Pricing from .env: color extra ${rates.colorMultiplierPerExtra}×, time ${rates.timeMultiplierPerBlock}× per ${rates.timeBlockHours}h`
  );
});
