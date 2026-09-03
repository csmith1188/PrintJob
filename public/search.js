(function () {
  const modal = document.getElementById("model-modal");
  if (!modal) return;

  const titleEl = document.getElementById("model-title");
  const creatorEl = document.getElementById("model-creator");
  const photosEl = document.getElementById("model-photos");
  const summaryEl = document.getElementById("model-summary");
  const errorEl = document.getElementById("model-error");
  const quoteBtn = document.getElementById("model-quote-btn");
  const mwLink = document.getElementById("model-mw-link");
  const closeBtn = document.getElementById("model-close");
  let quoteUrl = "";

  function showError(message) {
    errorEl.hidden = false;
    errorEl.textContent = message;
    quoteBtn.disabled = true;
  }

  function clearDetail() {
    errorEl.hidden = true;
    errorEl.textContent = "";
    photosEl.innerHTML = "";
    summaryEl.textContent = "";
    creatorEl.textContent = "";
    quoteBtn.disabled = true;
    mwLink.href = "#";
    quoteUrl = "";
  }

  async function openModel(id) {
    clearDetail();
    titleEl.textContent = "Loading…";
    quoteBtn.disabled = true;
    if (typeof modal.showModal === "function") {
      modal.showModal();
    } else {
      modal.setAttribute("open", "");
    }

    try {
      const res = await fetch("/api/models/" + encodeURIComponent(id));
      const data = await res.json();
      if (!res.ok) {
        titleEl.textContent = "Could not load model";
        showError(data.error || "Could not load that model.");
        return;
      }
      titleEl.textContent = data.title || "Model";
      creatorEl.textContent = data.creator ? "by " + data.creator : "";
      summaryEl.textContent = data.summary || "No description.";
      quoteUrl = data.makerworldUrl || "";
      quoteBtn.disabled = !quoteUrl;
      mwLink.href = quoteUrl || "#";
      (data.pictures || []).forEach(function (src) {
        const img = document.createElement("img");
        img.src = src;
        img.alt = "";
        photosEl.appendChild(img);
      });
    } catch (err) {
      titleEl.textContent = "Could not load model";
      showError("Could not load that model.");
    }
  }

  document.querySelectorAll(".search-card, .model-open").forEach(function (btn) {
    btn.addEventListener("click", function () {
      openModel(btn.getAttribute("data-id"));
    });
  });

  closeBtn.addEventListener("click", function () {
    modal.close();
  });

  quoteBtn.addEventListener("click", function () {
    if (!quoteUrl) return;
    const form = document.createElement("form");
    form.method = "post";
    form.action = "/quote";
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = "url";
    input.value = quoteUrl;
    form.appendChild(input);
    document.body.appendChild(form);
    form.submit();
  });

  modal.addEventListener("click", function (event) {
    if (event.target === modal) modal.close();
  });
})();
