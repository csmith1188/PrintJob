const { all } = require("./db");
const {
  pickInstance,
  instanceFilaments,
  collectPrinterNames,
} = require("./makerworld");

const MAX_COLORS = 4;

function normalizeMaterial(type) {
  const raw = String(type || "").toUpperCase().trim();
  if (!raw) return "";
  if (raw.includes("TPU")) return "TPU";
  if (raw.includes("PETG")) return "PETG";
  if (raw.includes("PLA")) return "PLA";
  return raw.replace(/\s+/g, " ");
}

function colorCount(instance, filaments) {
  if (instance.materialColorCnt != null) {
    return Number(instance.materialColorCnt);
  }
  const colors = new Set(
    filaments.map((f) => String(f.color || "").toLowerCase())
  );
  return colors.size || filaments.length || Number(instance.materialCnt) || 0;
}

async function loadA1Rules() {
  const printers = await all("SELECT name FROM printer_family");
  const materials = await all("SELECT name FROM allowed_materials");
  return {
    printerFamily: new Set(printers.map((p) => p.name)),
    allowedMaterials: new Set(
      materials.map((m) => String(m.name).toUpperCase())
    ),
  };
}

function isEngineeringMaterial(type, allowedMaterials) {
  const n = normalizeMaterial(type);
  if (allowedMaterials.has(n)) return false;
  if (/ABS|ASA|PC\b|PA\b|NYLON|CF|CARBON|PPA|PPS/.test(n)) return true;
  return n.length > 0 && !allowedMaterials.has(n);
}

function assessA1(instance, filaments, printers, rules) {
  const printerFamily = rules.printerFamily;
  const allowedMaterials = rules.allowedMaterials;
  const reasons = [];
  const weight = Number(instance.weight);
  const seconds = Number(instance.prediction);

  if (!Number.isFinite(weight) || weight <= 0) {
    reasons.push("MakerWorld did not publish a filament weight for this profile.");
  }
  if (!Number.isFinite(seconds) || seconds <= 0) {
    reasons.push("MakerWorld did not publish a print time for this profile.");
  }

  const colors = colorCount(instance, filaments);
  if (colors > MAX_COLORS) {
    reasons.push(
      `This profile uses ${colors} colors. The A1 AMS Lite supports at most ${MAX_COLORS}.`
    );
  }

  const types = [...new Set(filaments.map((f) => f.type).filter(Boolean))];
  const badTypes = types.filter((t) =>
    isEngineeringMaterial(t, allowedMaterials)
  );
  if (badTypes.length) {
    reasons.push(
      `Material ${badTypes.join(", ")} is not a good fit for an open-frame A1 (use PLA, PETG, or TPU).`
    );
  }

  const familyHit = printers.some((name) => printerFamily.has(name));
  const a1Listed = printers.some((name) => name === "A1");

  if (!familyHit) {
    const listed = printers.length ? printers.join(", ") : "none listed";
    reasons.push(
      `This profile is not listed for an A1-sized Bambu printer (A1 / P1 / X1 family). Listed: ${listed}.`
    );
  }

  const printable = reasons.length === 0;
  let warning = null;
  if (printable && !a1Listed && familyHit) {
    const others = printers.filter((n) => n !== "A1").join(", ");
    warning = `Listed for ${others}, not A1. Same bed size; slice for A1 before printing.`;
  }

  return {
    printable,
    a1Listed,
    warning,
    reasons,
    colors,
    printers,
  };
}

function assessDesignInstance(instance, rules) {
  return assessA1(
    instance,
    instanceFilaments(instance),
    collectPrinterNames(instance),
    rules
  );
}

function designHasA1Print(design, rules) {
  const instances = Array.isArray(design.instances) ? design.instances : [];
  return instances.some((instance) =>
    assessDesignInstance(instance, rules).printable
  );
}

function pickPrintableInstance(design, instanceId, rules) {
  const instances = Array.isArray(design.instances) ? design.instances : [];
  if (instanceId != null) {
    const match = instances.find(
      (inst) => Number(inst.id) === Number(instanceId)
    );
    if (match) {
      return { instance: match, a1: assessDesignInstance(match, rules) };
    }
  }
  const preferred = instances.length ? pickInstance(design, instanceId) : null;
  const ordered = preferred
    ? [preferred, ...instances.filter((inst) => inst !== preferred)]
    : instances;
  for (const instance of ordered) {
    const a1 = assessDesignInstance(instance, rules);
    if (a1.printable) return { instance, a1 };
  }
  const instance = preferred || instances[0];
  return {
    instance,
    a1: instance
      ? assessDesignInstance(instance, rules)
      : {
          printable: false,
          reasons: ["This model has no print profiles."],
          colors: 0,
          printers: [],
        },
  };
}

module.exports = {
  MAX_COLORS,
  assessA1,
  colorCount,
  normalizeMaterial,
  loadA1Rules,
  designHasA1Print,
  pickPrintableInstance,
};
