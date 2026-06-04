const state = {
  mode: "pair",
  lut: null,
  lutSize: 33,
  previewSource: null,
  previewAfter: null,
  showingAfter: false,
  cubeText: "",
};

const els = {
  pairModeBtn: document.getElementById("pairModeBtn"),
  lookModeBtn: document.getElementById("lookModeBtn"),
  pairPanel: document.getElementById("pairPanel"),
  lookPanel: document.getElementById("lookPanel"),
  beforeFiles: document.getElementById("beforeFiles"),
  afterFiles: document.getElementById("afterFiles"),
  lookFiles: document.getElementById("lookFiles"),
  lutSize: document.getElementById("lutSize"),
  strength: document.getElementById("strength"),
  smoothness: document.getElementById("smoothness"),
  strengthValue: document.getElementById("strengthValue"),
  smoothnessValue: document.getElementById("smoothnessValue"),
  generateBtn: document.getElementById("generateBtn"),
  downloadBtn: document.getElementById("downloadBtn"),
  swapPreviewBtn: document.getElementById("swapPreviewBtn"),
  statusDot: document.getElementById("statusDot"),
  statusText: document.getElementById("statusText"),
  sourceCanvas: document.getElementById("sourceCanvas"),
  resultCanvas: document.getElementById("resultCanvas"),
  metricImages: document.getElementById("metricImages"),
  metricSamples: document.getElementById("metricSamples"),
  metricDelta: document.getElementById("metricDelta"),
  metricMode: document.getElementById("metricMode"),
};

for (const button of [els.pairModeBtn, els.lookModeBtn]) {
  button.addEventListener("click", () => setMode(button.dataset.mode));
}

els.strength.addEventListener("input", () => {
  els.strengthValue.textContent = `${els.strength.value}%`;
  if (state.lut) renderPreview();
});

els.smoothness.addEventListener("input", () => {
  els.smoothnessValue.textContent = els.smoothness.value;
});

els.generateBtn.addEventListener("click", () => generate());
els.downloadBtn.addEventListener("click", () => downloadCube());
els.swapPreviewBtn.addEventListener("click", () => {
  state.showingAfter = !state.showingAfter;
  drawImageToCanvas(state.showingAfter ? state.previewAfter : state.previewSource, els.sourceCanvas);
});

drawEmptyCanvas(els.sourceCanvas, "入力画像");
drawEmptyCanvas(els.resultCanvas, "生成後プレビュー");

function setMode(mode) {
  state.mode = mode;
  els.pairModeBtn.classList.toggle("is-active", mode === "pair");
  els.lookModeBtn.classList.toggle("is-active", mode === "look");
  els.pairPanel.classList.toggle("is-active", mode === "pair");
  els.lookPanel.classList.toggle("is-active", mode === "look");
  resetResult();
  setStatus("画像を追加してください", "idle");
}

async function generate() {
  resetResult();
  state.lutSize = Number(els.lutSize.value);
  const strength = Number(els.strength.value) / 100;
  const smoothness = Number(els.smoothness.value);

  try {
    setBusy(true);
    setStatus("画像を読み込んでいます", "idle");

    if (state.mode === "pair") {
      const beforeFiles = [...els.beforeFiles.files];
      const afterFiles = [...els.afterFiles.files];
      if (!beforeFiles.length || !afterFiles.length) {
        throw new Error("before画像とafter画像の両方を選んでください。");
      }

      const pairCount = Math.min(beforeFiles.length, afterFiles.length);
      const pairs = [];
      for (let i = 0; i < pairCount; i += 1) {
        const before = await loadImageBitmap(beforeFiles[i]);
        const after = await loadImageBitmap(afterFiles[i]);
        pairs.push({ before, after });
      }

      setStatus("before/afterの色差分を解析しています", "idle");
      const result = buildLutFromPairs(pairs, state.lutSize, strength, smoothness);
      state.lut = result.lut;
      state.previewSource = pairs[0].before;
      state.previewAfter = pairs[0].after;
      updateMetrics(pairCount, result.samples, result.averageDelta, "差分解析");
    } else {
      const lookFiles = [...els.lookFiles.files];
      if (!lookFiles.length) {
        throw new Error("after画像を選んでください。");
      }

      const images = [];
      for (const file of lookFiles) images.push(await loadImageBitmap(file));

      setStatus("after画像の色傾向を推定しています", "idle");
      const result = buildLutFromLook(images, state.lutSize, strength);
      state.lut = result.lut;
      state.previewSource = images[0];
      state.previewAfter = null;
      updateMetrics(images.length, result.samples, result.averageDelta, "ルック推定");
    }

    state.cubeText = exportCube(state.lut, state.lutSize, `lut-lab-${state.mode}`);
    els.downloadBtn.disabled = false;
    els.swapPreviewBtn.disabled = !(state.mode === "pair" && state.previewAfter);
    state.showingAfter = false;
    renderPreview();
    setStatus("LUTを生成しました", "ready");
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    setBusy(false);
  }
}

function resetResult() {
  state.lut = null;
  state.cubeText = "";
  els.downloadBtn.disabled = true;
  els.swapPreviewBtn.disabled = true;
  updateMetrics(0, 0, null, "-");
}

function setBusy(isBusy) {
  els.generateBtn.disabled = isBusy;
  els.generateBtn.textContent = isBusy ? "解析中..." : "LUTを生成";
}

function setStatus(text, type) {
  els.statusText.textContent = text;
  els.statusDot.classList.toggle("ready", type === "ready");
  els.statusDot.classList.toggle("error", type === "error");
}

function updateMetrics(images, samples, delta, mode) {
  els.metricImages.textContent = String(images);
  els.metricSamples.textContent = samples.toLocaleString("ja-JP");
  els.metricDelta.textContent = delta == null ? "-" : delta.toFixed(3);
  els.metricMode.textContent = mode;
}

async function loadImageBitmap(file) {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  return bitmap;
}

function buildLutFromPairs(pairs, size, strength, smoothness) {
  const total = size * size * size;
  const sums = Array.from({ length: total }, () => [0, 0, 0, 0]);
  let samples = 0;
  let deltaSum = 0;

  for (const pair of pairs) {
    const beforeData = imageToPixels(pair.before, 360);
    const afterData = imageToPixels(pair.after, 360, beforeData.width, beforeData.height);
    const step = Math.max(1, Math.floor(Math.sqrt((beforeData.width * beforeData.height) / 28000)));

    for (let y = 0; y < beforeData.height; y += step) {
      for (let x = 0; x < beforeData.width; x += step) {
        const idx = (y * beforeData.width + x) * 4;
        const alpha = beforeData.data[idx + 3];
        if (alpha < 245) continue;

        const r = beforeData.data[idx] / 255;
        const g = beforeData.data[idx + 1] / 255;
        const b = beforeData.data[idx + 2] / 255;
        const ar = afterData.data[idx] / 255;
        const ag = afterData.data[idx + 1] / 255;
        const ab = afterData.data[idx + 2] / 255;
        const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        if ((luma < 0.015 && ar < 0.015 && ag < 0.015 && ab < 0.015) || luma > 0.99) continue;

        const ri = quantize(r, size);
        const gi = quantize(g, size);
        const bi = quantize(b, size);
        const lutIdx = lutIndex(ri, gi, bi, size);
        sums[lutIdx][0] += (ar - r) * strength;
        sums[lutIdx][1] += (ag - g) * strength;
        sums[lutIdx][2] += (ab - b) * strength;
        sums[lutIdx][3] += 1;
        deltaSum += Math.hypot(ar - r, ag - g, ab - b);
        samples += 1;
      }
    }
  }

  const deltas = sums.map((sum) => {
    if (!sum[3]) return null;
    return [sum[0] / sum[3], sum[1] / sum[3], sum[2] / sum[3]];
  });

  fillMissingDeltas(deltas, size);
  for (let i = 0; i < smoothness; i += 1) smoothDeltas(deltas, size);

  const lut = new Float32Array(total * 3);
  forEachNode(size, (r, g, b, idx) => {
    const base = [r / (size - 1), g / (size - 1), b / (size - 1)];
    const delta = deltas[idx] || [0, 0, 0];
    lut[idx * 3] = clamp01(base[0] + delta[0]);
    lut[idx * 3 + 1] = clamp01(base[1] + delta[1]);
    lut[idx * 3 + 2] = clamp01(base[2] + delta[2]);
  });

  return { lut, samples, averageDelta: samples ? deltaSum / samples : 0 };
}

function buildLutFromLook(images, size, strength) {
  const stats = {
    count: 0,
    mean: [0, 0, 0],
    shadow: [0, 0, 0, 0],
    mid: [0, 0, 0, 0],
    high: [0, 0, 0, 0],
    sat: 0,
    luma: [],
  };

  for (const image of images) {
    const pixels = imageToPixels(image, 420);
    const step = Math.max(1, Math.floor(Math.sqrt((pixels.width * pixels.height) / 36000)));
    for (let y = 0; y < pixels.height; y += step) {
      for (let x = 0; x < pixels.width; x += step) {
        const idx = (y * pixels.width + x) * 4;
        if (pixels.data[idx + 3] < 245) continue;
        const rgb = [pixels.data[idx] / 255, pixels.data[idx + 1] / 255, pixels.data[idx + 2] / 255];
        const luma = getLuma(rgb);
        const saturation = Math.max(...rgb) - Math.min(...rgb);
        stats.mean[0] += rgb[0];
        stats.mean[1] += rgb[1];
        stats.mean[2] += rgb[2];
        stats.sat += saturation;
        stats.luma.push(luma);
        stats.count += 1;

        const bucket = luma < 0.32 ? stats.shadow : luma > 0.68 ? stats.high : stats.mid;
        bucket[0] += rgb[0];
        bucket[1] += rgb[1];
        bucket[2] += rgb[2];
        bucket[3] += 1;
      }
    }
  }

  if (!stats.count) throw new Error("画像から有効なピクセルを読み取れませんでした。");

  stats.mean = stats.mean.map((v) => v / stats.count);
  stats.sat /= stats.count;
  const shadowTint = normalizedTint(stats.shadow);
  const midTint = normalizedTint(stats.mid);
  const highTint = normalizedTint(stats.high);
  const sortedLuma = stats.luma.sort((a, b) => a - b);
  const p10 = percentile(sortedLuma, 0.1);
  const p90 = percentile(sortedLuma, 0.9);
  const contrast = clamp((p90 - p10 - 0.48) * 1.6, -0.28, 0.34);
  const satBoost = clamp((stats.sat - 0.2) * 0.55, -0.13, 0.2);
  const meanTint = normalizedTint([...stats.mean, 1]);

  const lut = new Float32Array(size * size * size * 3);
  let deltaSum = 0;
  forEachNode(size, (r, g, b, idx) => {
    const input = [r / (size - 1), g / (size - 1), b / (size - 1)];
    let out = applyContrast(input, contrast * strength);
    out = applySaturation(out, 1 + satBoost * strength);
    const luma = getLuma(out);
    const toneTint = mix3(
      mix3(shadowTint, midTint, smoothstep(0.18, 0.58, luma)),
      highTint,
      smoothstep(0.55, 0.92, luma),
    );
    const tint = mix3(meanTint, toneTint, 0.72);
    const tintAmount = (0.07 + Math.abs(contrast) * 0.08) * strength;
    out = [
      clamp01(out[0] + tint[0] * tintAmount),
      clamp01(out[1] + tint[1] * tintAmount),
      clamp01(out[2] + tint[2] * tintAmount),
    ];
    lut[idx * 3] = out[0];
    lut[idx * 3 + 1] = out[1];
    lut[idx * 3 + 2] = out[2];
    deltaSum += Math.hypot(out[0] - input[0], out[1] - input[1], out[2] - input[2]);
  });

  return {
    lut,
    samples: stats.count,
    averageDelta: deltaSum / (size * size * size),
  };
}

function imageToPixels(image, maxSide, targetWidth, targetHeight) {
  const scale = targetWidth ? 1 : Math.min(1, maxSide / Math.max(image.width, image.height));
  const width = targetWidth || Math.max(1, Math.round(image.width * scale));
  const height = targetHeight || Math.max(1, Math.round(image.height * scale));
  const canvas = createWorkCanvas(width, height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(image, 0, 0, width, height);
  return {
    width,
    height,
    data: ctx.getImageData(0, 0, width, height).data,
  };
}

function createWorkCanvas(width, height) {
  if (typeof OffscreenCanvas !== "undefined") {
    return new OffscreenCanvas(width, height);
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function renderPreview() {
  if (!state.previewSource || !state.lut) return;
  drawImageToCanvas(state.previewSource, els.sourceCanvas);
  applyLutToCanvas(state.previewSource, els.resultCanvas, state.lut, state.lutSize);
}

function drawImageToCanvas(image, canvas) {
  if (!image) return;
  const ctx = canvas.getContext("2d");
  const { width, height } = fitSize(image.width, image.height, 960, 640);
  canvas.width = width;
  canvas.height = height;
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(image, 0, 0, width, height);
}

function applyLutToCanvas(image, canvas, lut, size) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const { width, height } = fitSize(image.width, image.height, 960, 640);
  canvas.width = width;
  canvas.height = height;
  ctx.drawImage(image, 0, 0, width, height);
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const rgb = sampleLut(data[i] / 255, data[i + 1] / 255, data[i + 2] / 255, lut, size);
    data[i] = Math.round(rgb[0] * 255);
    data[i + 1] = Math.round(rgb[1] * 255);
    data[i + 2] = Math.round(rgb[2] * 255);
  }
  ctx.putImageData(imageData, 0, 0);
}

function drawEmptyCanvas(canvas, label) {
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#f1f3ef";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#69726d";
  ctx.font = "700 28px system-ui";
  ctx.textAlign = "center";
  ctx.fillText(label, canvas.width / 2, canvas.height / 2);
}

function exportCube(lut, size, title) {
  const lines = [
    `TITLE "${title}"`,
    "DOMAIN_MIN 0.0 0.0 0.0",
    "DOMAIN_MAX 1.0 1.0 1.0",
    `LUT_3D_SIZE ${size}`,
  ];

  for (let b = 0; b < size; b += 1) {
    for (let g = 0; g < size; g += 1) {
      for (let r = 0; r < size; r += 1) {
        const idx = lutIndex(r, g, b, size) * 3;
        lines.push(`${fmt(lut[idx])} ${fmt(lut[idx + 1])} ${fmt(lut[idx + 2])}`);
      }
    }
  }

  return `${lines.join("\n")}\n`;
}

function downloadCube() {
  const blob = new Blob([state.cubeText], { type: "text/plain" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `lut-lab-${state.mode}-${state.lutSize}.cube`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function fillMissingDeltas(deltas, size) {
  const global = [0, 0, 0];
  let known = 0;
  for (const delta of deltas) {
    if (!delta) continue;
    global[0] += delta[0];
    global[1] += delta[1];
    global[2] += delta[2];
    known += 1;
  }
  const fallback = known ? global.map((v) => v / known) : [0, 0, 0];
  forEachNode(size, (r, g, b, idx) => {
    if (deltas[idx]) return;
    const nearest = findNearestDelta(deltas, size, r, g, b, 4);
    deltas[idx] = nearest || fallback;
  });
}

function findNearestDelta(deltas, size, r, g, b, radius) {
  let best = null;
  let bestDistance = Infinity;
  for (let dz = -radius; dz <= radius; dz += 1) {
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        const nr = r + dx;
        const ng = g + dy;
        const nb = b + dz;
        if (nr < 0 || ng < 0 || nb < 0 || nr >= size || ng >= size || nb >= size) continue;
        const delta = deltas[lutIndex(nr, ng, nb, size)];
        if (!delta) continue;
        const distance = dx * dx + dy * dy + dz * dz;
        if (distance < bestDistance) {
          bestDistance = distance;
          best = delta;
        }
      }
    }
  }
  return best ? [...best] : null;
}

function smoothDeltas(deltas, size) {
  const copy = deltas.map((d) => [...d]);
  forEachNode(size, (r, g, b, idx) => {
    const acc = [copy[idx][0] * 2, copy[idx][1] * 2, copy[idx][2] * 2];
    let weight = 2;
    for (const [dr, dg, db] of [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1],
    ]) {
      const nr = r + dr;
      const ng = g + dg;
      const nb = b + db;
      if (nr < 0 || ng < 0 || nb < 0 || nr >= size || ng >= size || nb >= size) continue;
      const delta = copy[lutIndex(nr, ng, nb, size)];
      acc[0] += delta[0];
      acc[1] += delta[1];
      acc[2] += delta[2];
      weight += 1;
    }
    deltas[idx] = [acc[0] / weight, acc[1] / weight, acc[2] / weight];
  });
}

function sampleLut(r, g, b, lut, size) {
  const rf = r * (size - 1);
  const gf = g * (size - 1);
  const bf = b * (size - 1);
  const r0 = Math.floor(rf);
  const g0 = Math.floor(gf);
  const b0 = Math.floor(bf);
  const r1 = Math.min(size - 1, r0 + 1);
  const g1 = Math.min(size - 1, g0 + 1);
  const b1 = Math.min(size - 1, b0 + 1);
  const tr = rf - r0;
  const tg = gf - g0;
  const tb = bf - b0;
  const c000 = lutColor(lut, size, r0, g0, b0);
  const c100 = lutColor(lut, size, r1, g0, b0);
  const c010 = lutColor(lut, size, r0, g1, b0);
  const c110 = lutColor(lut, size, r1, g1, b0);
  const c001 = lutColor(lut, size, r0, g0, b1);
  const c101 = lutColor(lut, size, r1, g0, b1);
  const c011 = lutColor(lut, size, r0, g1, b1);
  const c111 = lutColor(lut, size, r1, g1, b1);
  const c00 = mix3(c000, c100, tr);
  const c10 = mix3(c010, c110, tr);
  const c01 = mix3(c001, c101, tr);
  const c11 = mix3(c011, c111, tr);
  return mix3(mix3(c00, c10, tg), mix3(c01, c11, tg), tb);
}

function lutColor(lut, size, r, g, b) {
  const idx = lutIndex(r, g, b, size) * 3;
  return [lut[idx], lut[idx + 1], lut[idx + 2]];
}

function forEachNode(size, callback) {
  for (let b = 0; b < size; b += 1) {
    for (let g = 0; g < size; g += 1) {
      for (let r = 0; r < size; r += 1) {
        callback(r, g, b, lutIndex(r, g, b, size));
      }
    }
  }
}

function lutIndex(r, g, b, size) {
  return b * size * size + g * size + r;
}

function quantize(value, size) {
  return Math.max(0, Math.min(size - 1, Math.round(value * (size - 1))));
}

function fitSize(width, height, maxWidth, maxHeight) {
  const scale = Math.min(maxWidth / width, maxHeight / height, 1);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function normalizedTint(bucket) {
  const count = bucket[3] || 1;
  const rgb = [bucket[0] / count, bucket[1] / count, bucket[2] / count];
  const avg = (rgb[0] + rgb[1] + rgb[2]) / 3;
  return [rgb[0] - avg, rgb[1] - avg, rgb[2] - avg];
}

function applyContrast(rgb, amount) {
  const pivot = 0.5;
  return rgb.map((v) => clamp01(pivot + (v - pivot) * (1 + amount)));
}

function applySaturation(rgb, amount) {
  const luma = getLuma(rgb);
  return rgb.map((v) => clamp01(luma + (v - luma) * amount));
}

function getLuma(rgb) {
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

function percentile(sorted, p) {
  const index = Math.max(0, Math.min(sorted.length - 1, Math.floor(sorted.length * p)));
  return sorted[index] || 0;
}

function smoothstep(edge0, edge1, value) {
  const x = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return x * x * (3 - 2 * x);
}

function mix3(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function clamp01(value) {
  return clamp(value, 0, 1);
}

function fmt(value) {
  return value.toFixed(6);
}
