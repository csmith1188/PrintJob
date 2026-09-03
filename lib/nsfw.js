function isNsfw(design) {
  if (!design || typeof design !== "object") return false;
  const flags = [design.nsfw, design.nsfwFlag, design.isNsfw, design.NSFW];
  return flags.some((value) => {
    if (value === true) return true;
    if (typeof value === "number" && value !== 0) return true;
    if (typeof value === "string") {
      const s = value.trim().toLowerCase();
      return s === "true" || s === "1" || s === "yes";
    }
    return false;
  });
}

module.exports = { isNsfw };
