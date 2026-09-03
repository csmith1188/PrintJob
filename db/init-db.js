const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();

const dbPath = path.join(__dirname, "app.db");
const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");

const SETTINGS = {
  digipogs_per_gram: "10",
  color_multiplier_start: "1",
  color_multiplier_per_extra: "0.1",
  time_block_hours: "4",
  time_multiplier_start: "1",
  time_multiplier_per_block: "0.1",
};

const FILAMENTS = [
  ["pla-jade-white", "PLA", "Jade White", "#FFFFFF"],
  ["pla-beige", "PLA", "Beige", "#F7E6DE"],
  ["pla-gold", "PLA", "Gold", "#E4B749"],
  ["pla-silver", "PLA", "Silver", "#A6A9AA"],
  ["pla-gray", "PLA", "Gray", "#8E9089"],
  ["pla-bronze", "PLA", "Bronze", "#847060"],
  ["pla-brown", "PLA", "Brown", "#9B5743"],
  ["pla-red", "PLA", "Red", "#C12E1F"],
  ["pla-magenta", "PLA", "Magenta", "#EC008C"],
  ["pla-orange", "PLA", "Orange", "#FF6A13"],
  ["pla-yellow", "PLA", "Yellow", "#F4EE2A"],
  ["pla-green", "PLA", "Bambu Green", "#00AE42"],
  ["pla-cyan", "PLA", "Cyan", "#0086D6"],
  ["pla-blue", "PLA", "Blue", "#0A2CA5"],
  ["pla-purple", "PLA", "Purple", "#5E43B7"],
  ["pla-black", "PLA", "Black", "#000000"],
  ["petg-white", "PETG", "White", "#FFFFFF"],
  ["petg-black", "PETG", "Black", "#000000"],
  ["tpu-white", "TPU", "White", "#FFFFFF"],
  ["tpu-black", "TPU", "Black", "#000000"],
];

const PRINTERS = [
  "A1",
  "A1 mini",
  "P1P",
  "P1S",
  "X1",
  "X1 Carbon",
  "X1E",
  "P2S",
];

const MATERIALS = ["PLA", "PETG", "TPU"];

const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  db.exec(schema, (err) => {
    if (err) {
      console.error("Schema error:", err);
      db.close();
      process.exit(1);
    }

    const insertSetting = db.prepare(
      "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)"
    );
    for (const [key, value] of Object.entries(SETTINGS)) {
      insertSetting.run(key, value);
    }
    insertSetting.finalize();

    const insertFilament = db.prepare(
      `INSERT OR IGNORE INTO filaments (slug, material, name, color, price_per_gram)
       VALUES (?, ?, ?, ?, ?)`
    );
    for (const [slug, material, name, color] of FILAMENTS) {
      insertFilament.run(slug, material, name, color, 10);
    }
    insertFilament.finalize();

    const insertPrinter = db.prepare(
      "INSERT OR IGNORE INTO printer_family (name) VALUES (?)"
    );
    for (const name of PRINTERS) insertPrinter.run(name);
    insertPrinter.finalize();

    const insertMaterial = db.prepare(
      "INSERT OR IGNORE INTO allowed_materials (name) VALUES (?)"
    );
    for (const name of MATERIALS) insertMaterial.run(name);
    insertMaterial.finalize();

    console.log("Database initialized:", dbPath);
    db.close();
  });
});
