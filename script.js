(() => {
  "use strict";

  /* ---------------- helpers: encoding ---------------- */

  const enc = new TextEncoder();
  const dec = new TextDecoder("utf-8", { fatal: true });

  // deterministic 32-bit hash of a string, used to seed the keystream PRNG
  function hashString(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  // mulberry32 PRNG — small, fast, deterministic from a seed
  function mulberry32(seed) {
    let a = seed;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function keystream(passphrase, length) {
    const rand = mulberry32(hashString(passphrase || "stega-default"));
    const out = new Uint8Array(length);
    for (let i = 0; i < length; i++) out[i] = Math.floor(rand() * 256);
    return out;
  }

  function xorBytes(bytes, passphrase) {
    if (!passphrase) return bytes;
    const ks = keystream(passphrase, bytes.length);
    const out = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) out[i] = bytes[i] ^ ks[i];
    return out;
  }

  // uint32 -> 32 bits (MSB first), bytes -> bits (MSB first per byte)
  function uint32ToBits(n) {
    const bits = new Array(32);
    for (let i = 31; i >= 0; i--) { bits[i] = n & 1; n >>>= 1; }
    return bits;
  }
  function bytesToBits(bytes) {
    const bits = [];
    for (let i = 0; i < bytes.length; i++) {
      for (let b = 7; b >= 0; b--) bits.push((bytes[i] >> b) & 1);
    }
    return bits;
  }
  function bitsToBytes(bits) {
    const bytes = new Uint8Array(bits.length / 8);
    for (let i = 0; i < bytes.length; i++) {
      let v = 0;
      for (let b = 0; b < 8; b++) v = (v << 1) | bits[i * 8 + b];
      bytes[i] = v;
    }
    return bytes;
  }
  function bitsToUint32(bits) {
    let v = 0;
    for (let i = 0; i < 32; i++) v = (v * 2) + bits[i];
    return v >>> 0;
  }

  /* ---------------- capacity ---------------- */

  function capacityBits(width, height) {
    return width * height * 3; // one bit per R,G,B channel; alpha untouched
  }
  function capacityBytes(width, height) {
    const bits = capacityBits(width, height) - 32; // reserve header
    return Math.max(0, Math.floor(bits / 8));
  }

  /* ---------------- embed / extract on ImageData ---------------- */

  function embedIntoImageData(imageData, payloadBits) {
    const data = imageData.data;
    let changed = 0;
    let bitIndex = 0;
    for (let p = 0; p < data.length && bitIndex < payloadBits.length; p += 4) {
      for (let ch = 0; ch < 3 && bitIndex < payloadBits.length; ch++) {
        const original = data[p + ch];
        const bit = payloadBits[bitIndex];
        const newVal = (original & 0xFE) | bit;
        if (newVal !== original) changed++;
        data[p + ch] = newVal;
        bitIndex++;
      }
    }
    return changed;
  }

  function extractBitsFromImageData(imageData, count) {
    const data = imageData.data;
    const bits = new Array(count);
    let bitIndex = 0;
    for (let p = 0; p < data.length && bitIndex < count; p += 4) {
      for (let ch = 0; ch < 3 && bitIndex < count; ch++) {
        bits[bitIndex] = data[p + ch] & 1;
        bitIndex++;
      }
    }
    return bits;
  }

  /* ---------------- image loading ---------------- */

  function loadImageFile(file) {
    return new Promise((resolve, reject) => {
      if (!file || !file.type.startsWith("image/")) {
        reject(new Error("Please choose an image file."));
        return;
      }
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => resolve({ img, url });
      img.onerror = () => reject(new Error("Couldn't read that image."));
      img.src = url;
    });
  }

  function drawToCanvas(canvas, img) {
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    return ctx;
  }

  function bitPlaneDataURL(canvas) {
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const src = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const out = ctx.createImageData(canvas.width, canvas.height);
    for (let i = 0; i < src.data.length; i += 4) {
      out.data[i]     = (src.data[i]     & 1) * 255;
      out.data[i + 1] = (src.data[i + 1] & 1) * 255;
      out.data[i + 2] = (src.data[i + 2] & 1) * 255;
      out.data[i + 3] = 255;
    }
    const tmp = document.createElement("canvas");
    tmp.width = canvas.width; tmp.height = canvas.height;
    tmp.getContext("2d").putImageData(out, 0, 0);
    return tmp.toDataURL("image/png");
  }

  /* ================= EMBED PANEL WIRING ================= */

  const embedDrop = document.getElementById("embed-drop");
  const embedFileInput = document.getElementById("embed-file");
  const embedCanvas = document.getElementById("embed-canvas");
  const embedDropEmpty = document.getElementById("embed-drop-empty");
  const embedDropFilled = document.getElementById("embed-drop-filled");
  const embedPreview = document.getElementById("embed-preview");
  const embedDims = document.getElementById("embed-dims");
  const embedBitToggle = document.getElementById("embed-bit-toggle");
  const embedClear = document.getElementById("embed-clear");
  const embedMessage = document.getElementById("embed-message");
  const embedPass = document.getElementById("embed-pass");
  const capacityFill = document.getElementById("capacity-fill");
  const capacityLabel = document.getElementById("capacity-label");
  const embedBtn = document.getElementById("embed-btn");
  const embedResult = document.getElementById("embed-result");
  const bitsChanged = document.getElementById("bits-changed");
  const downloadLink = document.getElementById("download-link");
  const embedError = document.getElementById("embed-error");

  let embedImgLoaded = false;
  let bitPlaneOn = false;
  let originalPreviewSrc = "";

  function showEmbedError(msg) {
    embedError.textContent = msg;
    embedError.hidden = !msg;
  }

  async function handleEmbedFile(file) {
    showEmbedError("");
    embedResult.hidden = true;
    try {
      const { img, url } = await loadImageFile(file);
      drawToCanvas(embedCanvas, img);
      originalPreviewSrc = url;
      embedPreview.src = url;
      embedDims.textContent = `${embedCanvas.width} × ${embedCanvas.height}px`;
      embedDropEmpty.hidden = true;
      embedDropFilled.hidden = false;
      embedImgLoaded = true;
      bitPlaneOn = false;
      embedBitToggle.classList.remove("active");
      embedBitToggle.textContent = "reveal bit-plane";
      updateCapacity();
      updateEmbedButton();
    } catch (err) {
      showEmbedError(err.message);
    }
  }

  function updateCapacity() {
    if (!embedImgLoaded) {
      capacityLabel.textContent = "Upload an image to see capacity";
      capacityFill.style.width = "0%";
      return;
    }
    const capBytes = capacityBytes(embedCanvas.width, embedCanvas.height);
    const used = enc.encode(embedMessage.value).length;
    const pct = capBytes > 0 ? Math.min(100, (used / capBytes) * 100) : 100;
    capacityFill.style.width = pct + "%";
    capacityFill.classList.toggle("over", used > capBytes);
    const fmt = (n) => n >= 1000 ? (n / 1000).toFixed(1) + "k" : n;
    capacityLabel.textContent =
      used > capBytes
        ? `${fmt(used)} / ${fmt(capBytes)} bytes — message is too large for this image`
        : `${fmt(used)} / ${fmt(capBytes)} bytes available`;
  }

  function updateEmbedButton() {
    const capBytes = embedImgLoaded ? capacityBytes(embedCanvas.width, embedCanvas.height) : 0;
    const used = enc.encode(embedMessage.value).length;
    embedBtn.disabled = !embedImgLoaded || used === 0 || used > capBytes;
  }

  embedDrop.addEventListener("click", () => embedFileInput.click());
  embedDrop.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); embedFileInput.click(); }
  });
  embedFileInput.addEventListener("change", (e) => {
    if (e.target.files[0]) handleEmbedFile(e.target.files[0]);
  });
  ["dragover", "dragenter"].forEach((evt) =>
    embedDrop.addEventListener(evt, (e) => { e.preventDefault(); embedDrop.classList.add("drag-over"); })
  );
  ["dragleave", "dragend", "drop"].forEach((evt) =>
    embedDrop.addEventListener(evt, (e) => { embedDrop.classList.remove("drag-over"); })
  );
  embedDrop.addEventListener("drop", (e) => {
    e.preventDefault();
    if (e.dataTransfer.files[0]) handleEmbedFile(e.dataTransfer.files[0]);
  });

  embedBitToggle.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!embedImgLoaded) return;
    bitPlaneOn = !bitPlaneOn;
    embedBitToggle.classList.toggle("active", bitPlaneOn);
    embedBitToggle.textContent = bitPlaneOn ? "show original" : "reveal bit-plane";
    embedPreview.src = bitPlaneOn ? bitPlaneDataURL(embedCanvas) : originalPreviewSrc;
  });

  embedClear.addEventListener("click", (e) => {
    e.stopPropagation();
    embedImgLoaded = false;
    embedFileInput.value = "";
    embedDropEmpty.hidden = false;
    embedDropFilled.hidden = true;
    embedResult.hidden = true;
    updateCapacity();
    updateEmbedButton();
  });

  embedMessage.addEventListener("input", () => { updateCapacity(); updateEmbedButton(); });

  embedBtn.addEventListener("click", () => {
    showEmbedError("");
    try {
      const ctx = embedCanvas.getContext("2d", { willReadFrequently: true });
      const imageData = ctx.getImageData(0, 0, embedCanvas.width, embedCanvas.height);

      const rawBytes = enc.encode(embedMessage.value);
      const cipherBytes = xorBytes(rawBytes, embedPass.value.trim());

      const headerBits = uint32ToBits(cipherBytes.length);
      const payloadBits = headerBits.concat(bytesToBits(cipherBytes));

      const totalCap = capacityBits(embedCanvas.width, embedCanvas.height);
      if (payloadBits.length > totalCap) {
        showEmbedError("Message is too large for this image.");
        return;
      }

      const changed = embedIntoImageData(imageData, payloadBits);
      ctx.putImageData(imageData, 0, 0);

      bitsChanged.textContent = `${changed.toLocaleString()} of ${payloadBits.length.toLocaleString()} embedded bits changed a pixel value — visually identical.`;
      const outUrl = embedCanvas.toDataURL("image/png");
      downloadLink.href = outUrl;
      embedResult.hidden = false;

      // refresh preview to reflect the now-modified canvas
      originalPreviewSrc = outUrl;
      if (!bitPlaneOn) embedPreview.src = outUrl;
    } catch (err) {
      showEmbedError("Something went wrong while embedding. " + err.message);
    }
  });

  /* ================= EXTRACT PANEL WIRING ================= */

  const extractDrop = document.getElementById("extract-drop");
  const extractFileInput = document.getElementById("extract-file");
  const extractCanvas = document.getElementById("extract-canvas");
  const extractDropEmpty = document.getElementById("extract-drop-empty");
  const extractDropFilled = document.getElementById("extract-drop-filled");
  const extractPreview = document.getElementById("extract-preview");
  const extractDims = document.getElementById("extract-dims");
  const extractClear = document.getElementById("extract-clear");
  const extractPass = document.getElementById("extract-pass");
  const extractBtn = document.getElementById("extract-btn");
  const revealBox = document.getElementById("reveal-box");
  const extractError = document.getElementById("extract-error");

  let extractImgLoaded = false;

  function showExtractError(msg) {
    extractError.textContent = msg;
    extractError.hidden = !msg;
  }

  async function handleExtractFile(file) {
    showExtractError("");
    revealBox.textContent = "—";
    revealBox.classList.remove("filled");
    try {
      const { img, url } = await loadImageFile(file);
      drawToCanvas(extractCanvas, img);
      extractPreview.src = url;
      extractDims.textContent = `${extractCanvas.width} × ${extractCanvas.height}px`;
      extractDropEmpty.hidden = true;
      extractDropFilled.hidden = false;
      extractImgLoaded = true;
      extractBtn.disabled = false;
    } catch (err) {
      showExtractError(err.message);
    }
  }

  extractDrop.addEventListener("click", () => extractFileInput.click());
  extractDrop.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); extractFileInput.click(); }
  });
  extractFileInput.addEventListener("change", (e) => {
    if (e.target.files[0]) handleExtractFile(e.target.files[0]);
  });
  ["dragover", "dragenter"].forEach((evt) =>
    extractDrop.addEventListener(evt, (e) => { e.preventDefault(); extractDrop.classList.add("drag-over"); })
  );
  ["dragleave", "dragend", "drop"].forEach((evt) =>
    extractDrop.addEventListener(evt, () => extractDrop.classList.remove("drag-over"))
  );
  extractDrop.addEventListener("drop", (e) => {
    e.preventDefault();
    if (e.dataTransfer.files[0]) handleExtractFile(e.dataTransfer.files[0]);
  });

  extractClear.addEventListener("click", (e) => {
    e.stopPropagation();
    extractImgLoaded = false;
    extractFileInput.value = "";
    extractDropEmpty.hidden = false;
    extractDropFilled.hidden = true;
    extractBtn.disabled = true;
    revealBox.textContent = "—";
    revealBox.classList.remove("filled");
  });

  extractBtn.addEventListener("click", () => {
    showExtractError("");
    try {
      const ctx = extractCanvas.getContext("2d", { willReadFrequently: true });
      const imageData = ctx.getImageData(0, 0, extractCanvas.width, extractCanvas.height);
      const totalCap = capacityBits(extractCanvas.width, extractCanvas.height);

      const headerBits = extractBitsFromImageData(imageData, Math.min(32, totalCap));
      const length = bitsToUint32(headerBits);

      if (length === 0 || length * 8 + 32 > totalCap || length > 5_000_000) {
        revealBox.textContent = "No hidden message found.";
        revealBox.classList.remove("filled");
        return;
      }

      const allBits = extractBitsFromImageData(imageData, 32 + length * 8);
      const msgBits = allBits.slice(32);
      const cipherBytes = bitsToBytes(msgBits);
      const rawBytes = xorBytes(cipherBytes, extractPass.value.trim());

      const text = dec.decode(rawBytes);
      revealBox.textContent = text;
      revealBox.classList.add("filled");
    } catch (err) {
      revealBox.textContent = "No hidden message found — or the passphrase is incorrect.";
      revealBox.classList.remove("filled");
    }
  });

  /* ================= MODE SWITCH ================= */

  const modeButtons = document.querySelectorAll(".mode-btn");
  const embedPanel = document.getElementById("embed-panel");
  const extractPanel = document.getElementById("extract-panel");

  modeButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      modeButtons.forEach((b) => { b.classList.remove("active"); b.setAttribute("aria-selected", "false"); });
      btn.classList.add("active");
      btn.setAttribute("aria-selected", "true");
      const mode = btn.dataset.mode;
      embedPanel.hidden = mode !== "embed";
      extractPanel.hidden = mode !== "extract";
    });
  });

  /* ================= misc ================= */

  const ghLink = document.getElementById("gh-link");
  ghLink.href = window.location.href.includes("github.io")
    ? "https://github.com/" // placeholder — update to your repo URL
    : "#";

})();
