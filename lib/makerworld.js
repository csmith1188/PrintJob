const DESIGN_API = "https://api.bambulab.com/v1/design-service/design";

const FETCH_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  Accept: "application/json,*/*",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: "https://makerworld.com/",
};

async function fetchDesign(modelId) {
  const res = await fetch(`${DESIGN_API}/${modelId}`, {
    headers: FETCH_HEADERS,
  });

  if (res.status === 404) {
    throw new Error("MakerWorld could not find that model.");
  }
  if (!res.ok) {
    throw new Error(`MakerWorld API returned HTTP ${res.status}.`);
  }

  const data = await res.json();
  if (!data || !data.id) {
    throw new Error("MakerWorld returned an unexpected response.");
  }
  return data;
}

function pickInstance(design, instanceId) {
  const instances = Array.isArray(design.instances) ? design.instances : [];
  if (instances.length === 0) {
    throw new Error("This model has no print profiles.");
  }

  if (instanceId != null) {
    const match = instances.find(
      (inst) => Number(inst.id) === Number(instanceId)
    );
    if (match) return match;
  }

  if (design.defaultInstanceId != null) {
    const def = instances.find(
      (inst) => Number(inst.id) === Number(design.defaultInstanceId)
    );
    if (def) return def;
  }

  return instances.find((inst) => inst.isDefault) || instances[0];
}

function instanceFilaments(instance) {
  const list = instance.instanceFilaments || instance.instance_filaments || [];
  return list.map((f) => ({
    type: f.type || f.filamentType || "Unknown",
    color: f.color || "#888888",
    usedG: Number(f.usedG ?? f.used_g ?? f.usedGrams ?? 0),
  }));
}

function collectPrinterNames(instance) {
  const names = new Set();
  const ext = instance.extention || instance.extension || {};
  const modelInfo = ext.modelInfo || {};
  const compatibility = modelInfo.compatibility || {};
  if (compatibility.devProductName) {
    names.add(String(compatibility.devProductName));
  }
  for (const other of modelInfo.otherCompatibility || []) {
    if (other.devProductName) names.add(String(other.devProductName));
  }
  return [...names];
}

function nozzleDiameter(instance) {
  const ext = instance.extention || instance.extension || {};
  const n = ext.modelInfo?.compatibility?.nozzleDiameter;
  return n != null ? Number(n) : null;
}

const SEARCH_API =
  "https://api.bambulab.com/v1/search-service/select/design2";

async function searchDesigns(keyword, { limit = 24, offset = 0 } = {}) {
  const params = new URLSearchParams({
    keyword: String(keyword || ""),
    limit: String(Math.min(50, Math.max(1, Number(limit) || 24))),
    offset: String(Math.max(0, Number(offset) || 0)),
  });
  const res = await fetch(`${SEARCH_API}?${params}`, {
    headers: FETCH_HEADERS,
  });
  if (!res.ok) {
    throw new Error(`MakerWorld search returned HTTP ${res.status}.`);
  }
  const data = await res.json();
  const hits = Array.isArray(data.hits) ? data.hits : [];
  return {
    total: Number(data.total) || 0,
    hits,
  };
}

function designPictures(design) {
  const urls = [];
  const seen = new Set();
  const add = (url) => {
    const s = String(url || "").trim();
    if (!s || seen.has(s)) return;
    seen.add(s);
    urls.push(s);
  };
  add(design.coverUrl || design.cover);
  add(design.coverPortrait);
  add(design.coverLandscape);
  const ext = design.designExtension || {};
  for (const pic of ext.design_pictures || []) {
    add(pic.url || pic.cover);
  }
  for (const inst of design.instances || []) {
    add(inst.cover);
  }
  return urls;
}

function designSummaryText(design) {
  const html = String(design.summary || design.summaryTranslated || "");
  return html
    .replace(/<commercialme[\s\S]*?<\/commercialme>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function makerworldModelUrl(design) {
  const id = design.id;
  const slug = design.slug ? `-${design.slug}` : "";
  const instanceId =
    design.defaultInstanceId ||
    (design.instances && design.instances[0] && design.instances[0].id);
  const hash = instanceId ? `#profileId-${instanceId}` : "";
  return `https://makerworld.com/en/models/${id}${slug}${hash}`;
}

module.exports = {
  fetchDesign,
  pickInstance,
  instanceFilaments,
  collectPrinterNames,
  nozzleDiameter,
  searchDesigns,
  designPictures,
  designSummaryText,
  makerworldModelUrl,
};
