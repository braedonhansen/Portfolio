const SIZE = 4;
const CELL_COUNT = SIZE ** 3;
const STARTING_TILES = 2;
const VIEW_ORDER = ["front", "right", "back", "left", "top", "bottom"];
const TILE_COLORS = {
  2: ["#fff6df", "#efddb6", "#50361b"],
  4: ["#ffe9c5", "#f1cb8a", "#583615"],
  8: ["#ffd4aa", "#ff9b63", "#58240f"],
  16: ["#ffc19f", "#ff7e59", "#5c1816"],
  32: ["#ffb9b5", "#f05f5a", "#591b22"],
  64: ["#ffc9d8", "#d75479", "#4b1530"],
  128: ["#d6ffe8", "#46d7b1", "#0b4237"],
  256: ["#d2f6ff", "#45abd4", "#10384d"],
  512: ["#dee6ff", "#5f79f0", "#1d2358"],
  1024: ["#efe0ff", "#9f63f4", "#2c1759"],
  2048: ["#fff6b8", "#f4ba3a", "#4a2f08"],
};

const VIEW_CONFIGS = buildViewConfigs({
  front: {
    label: "Front",
    nearLabel: "Front face",
    farLabel: "Back face",
    flow: "front to back",
  },
  right: {
    label: "Right",
    yawTurns: 1,
    nearLabel: "Right face",
    farLabel: "Left face",
    flow: "right to left",
  },
  back: {
    label: "Back",
    yawTurns: 2,
    nearLabel: "Back face",
    farLabel: "Front face",
    flow: "back to front",
  },
  left: {
    label: "Left",
    yawTurns: 3,
    nearLabel: "Left face",
    farLabel: "Right face",
    flow: "left to right",
  },
  top: {
    label: "Top",
    pitchTurns: 1,
    nearLabel: "Top slice",
    farLabel: "Bottom slice",
    flow: "top to bottom",
  },
  bottom: {
    label: "Bottom",
    pitchTurns: -1,
    nearLabel: "Bottom slice",
    farLabel: "Top slice",
    flow: "bottom to top",
  },
});

const state = {
  board: Array(CELL_COUNT).fill(0),
  score: 0,
  best: readBestScore(),
  view: "front",
  activeLayer: 0,
  gameOver: false,
  hasWon: false,
  moveCount: 0,
  statusText:
    "Use arrows or WASD in the visible plane. Q pulls toward you and E pushes away.",
  freshTiles: new Set(),
};

const scoreEl = document.querySelector("[data-score]");
const bestEl = document.querySelector("[data-best]");
const viewTitleEl = document.querySelector("[data-view-title]");
const sliceCaptionEl = document.querySelector("[data-slice-caption]");
const statusEl = document.querySelector("[data-status]");
const nearLabelEl = document.querySelector("[data-near-label]");
const farLabelEl = document.querySelector("[data-far-label]");
const sceneEl = document.querySelector("[data-scene]");
const layerRailEl = document.querySelector("[data-layer-rail]");

const cellElements = [];
const layerButtons = [];
let freshTileTimerId = 0;

init();

function init() {
  buildScene();
  buildLayerRail();
  bindEvents();
  startNewGame();
}

function buildScene() {
  for (let index = 0; index < CELL_COUNT; index += 1) {
    const slot = document.createElement("div");
    slot.className = "cell-slot";
    slot.innerHTML = `
      <div class="tile-card" data-filled="false">
        <span class="tile-value"></span>
      </div>
    `;

    const tile = slot.querySelector(".tile-card");
    const tileValue = slot.querySelector(".tile-value");

    sceneEl.append(slot);
    cellElements.push({ slot, tile, tileValue });
  }
}

function buildLayerRail() {
  for (let layer = 0; layer < SIZE; layer += 1) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "layer-step";
    button.dataset.layer = String(layer);
    button.innerHTML = `<strong>${layer + 1}</strong><small>Slice</small>`;
    layerRailEl.append(button);
    layerButtons.push(button);
  }
}

function bindEvents() {
  document.querySelectorAll("[data-restart]").forEach((button) => {
    button.addEventListener("click", startNewGame);
  });

  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => {
      setView(button.dataset.view);
    });
  });

  document.querySelectorAll("[data-step-layer]").forEach((button) => {
    button.addEventListener("click", () => {
      stepLayer(Number(button.dataset.stepLayer));
    });
  });

  layerRailEl.addEventListener("click", (event) => {
    const button = event.target.closest("[data-layer]");
    if (!button) {
      return;
    }

    setActiveLayer(Number(button.dataset.layer));
  });

  document.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", () => {
      moveFromAction(button.dataset.action);
    });
  });

  sceneEl.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      stepLayer(event.deltaY > 0 ? 1 : -1);
    },
    { passive: false }
  );

  window.addEventListener("keydown", handleKeydown);
}

function handleKeydown(event) {
  const key = event.key;
  const lowerKey = key.toLowerCase();

  if (
    [
      "ArrowLeft",
      "ArrowRight",
      "ArrowUp",
      "ArrowDown",
      "[",
      "]",
      "q",
      "e",
      "w",
      "a",
      "s",
      "d",
    ].includes(key) ||
    ["q", "e", "w", "a", "s", "d", "1", "2", "3", "4", "5", "6", "r"].includes(lowerKey)
  ) {
    event.preventDefault();
  }

  if (lowerKey === "r") {
    startNewGame();
    return;
  }

  if (["1", "2", "3", "4", "5", "6"].includes(key)) {
    setView(VIEW_ORDER[Number(key) - 1]);
    return;
  }

  if (key === "[") {
    stepLayer(-1);
    return;
  }

  if (key === "]") {
    stepLayer(1);
    return;
  }

  const actionMap = {
    ArrowLeft: "left",
    ArrowRight: "right",
    ArrowUp: "up",
    ArrowDown: "down",
    a: "left",
    d: "right",
    w: "up",
    s: "down",
    q: "pull",
    e: "push",
  };

  const action = actionMap[key] || actionMap[lowerKey];

  if (action) {
    moveFromAction(action);
  }
}

function startNewGame() {
  clearTimeout(freshTileTimerId);

  state.board = Array(CELL_COUNT).fill(0);
  state.score = 0;
  state.gameOver = false;
  state.hasWon = false;
  state.moveCount = 0;
  state.activeLayer = 0;
  state.statusText =
    "Use arrows or WASD in the visible plane. Q pulls toward you and E pushes away.";
  setFreshTiles(spawnRandomTile(STARTING_TILES));
  render();
}

function moveFromAction(action) {
  if (state.gameOver) {
    state.statusText = "No moves left. Start a new game to reset the cube.";
    renderHud();
    return;
  }

  const vector = getViewRelativeVector(action, VIEW_CONFIGS[state.view]);
  const moveResult = applyMove(vector);

  if (!moveResult.moved) {
    state.statusText = "That lane is blocked from this angle. Try another direction or change views.";
    renderHud();
    return;
  }

  state.score += moveResult.scoreGained;
  state.moveCount += 1;
  if (state.score > state.best) {
    state.best = state.score;
    writeBestScore(state.best);
  }

  const spawned = spawnRandomTile(1);
  setFreshTiles(spawned);
  const hasMovesRemaining = canAnyMove();
  const justWon = !state.hasWon && state.board.some((value) => value >= 2048);

  if (justWon) {
    state.hasWon = true;
  }

  if (!hasMovesRemaining) {
    state.gameOver = true;
    state.statusText = state.hasWon
      ? "2048 reached, and that run is now locked in. Start a new game to go again."
      : "No more moves. Start a new game and try a new route through the cube.";
  } else if (justWon) {
    state.statusText = "2048 reached. Keep pushing if you want a bigger cube.";
  } else {
    state.statusText = `${
      moveResult.scoreGained ? `Merged for ${moveResult.scoreGained} points.` : "Tiles shifted."
    } Still viewing from the ${VIEW_CONFIGS[state.view].label.toLowerCase()}.`;
  }

  render();
}

function setView(viewKey) {
  if (!VIEW_CONFIGS[viewKey] || state.view === viewKey) {
    return;
  }

  state.view = viewKey;
  state.statusText = `Viewing from the ${VIEW_CONFIGS[viewKey].label.toLowerCase()}. The highlighted slice is nearest to you.`;
  render();
}

function setActiveLayer(layer) {
  const clamped = clamp(layer, 0, SIZE - 1);
  if (clamped === state.activeLayer) {
    return;
  }

  state.activeLayer = clamped;
  state.statusText = `Inspecting slice ${clamped + 1} of ${SIZE} from the ${VIEW_CONFIGS[state.view].label.toLowerCase()} view.`;
  renderHud();
  renderScene();
}

function stepLayer(step) {
  const nextLayer = (state.activeLayer + step + SIZE) % SIZE;
  setActiveLayer(nextLayer);
}

function render() {
  renderHud();
  renderScene();
}

function renderHud() {
  const view = VIEW_CONFIGS[state.view];
  scoreEl.textContent = String(state.score);
  bestEl.textContent = String(state.best);
  viewTitleEl.textContent = view.label;
  sliceCaptionEl.textContent = `Layer ${state.activeLayer + 1} / ${SIZE} | ${view.flow}`;
  nearLabelEl.textContent = view.nearLabel;
  farLabelEl.textContent = view.farLabel;
  statusEl.textContent = state.statusText;

  document.querySelectorAll("[data-view]").forEach((button) => {
    button.dataset.active = button.dataset.view === state.view ? "true" : "false";
  });

  layerButtons.forEach((button, index) => {
    button.dataset.active = index === state.activeLayer ? "true" : "false";
  });
}

function renderScene() {
  for (let index = 0; index < CELL_COUNT; index += 1) {
    const { x, y, z } = coordinatesFromIndex(index);
    const { screenX, screenY, depthIndex, scale } = projectCoordinate(x, y, z);
    const value = state.board[index];
    const element = cellElements[index];
    const isActiveLayer = depthIndex === state.activeLayer;
    const occupied = value !== 0;
    const depthTheme = getDepthTheme(depthIndex, state.activeLayer);
    const opacity = occupied
      ? isActiveLayer
        ? 1
        : 0.58 + (SIZE - 1 - depthIndex) * 0.06
      : isActiveLayer
        ? 0.56
        : 0.18 + (SIZE - 1 - depthIndex) * 0.04;

    element.slot.style.transform =
      `translate(calc(-50% + ${screenX}px), calc(-50% + ${screenY}px)) scale(${scale})`;
    element.slot.style.zIndex = String(100 + (SIZE - depthIndex) * 10 + (occupied ? 3 : 0));
    element.slot.style.opacity = opacity.toFixed(2);
    element.slot.dataset.active = isActiveLayer ? "true" : "false";
    element.slot.style.setProperty("--slot-tint", depthTheme.slotTint);
    element.slot.style.setProperty("--slot-border", depthTheme.slotBorder);
    element.slot.style.setProperty("--slot-shadow", depthTheme.slotShadow);
    element.slot.style.setProperty("--tile-tint", depthTheme.tileTint);
    element.slot.style.setProperty("--tile-border", depthTheme.tileBorder);
    element.slot.style.setProperty("--tile-glow", depthTheme.tileGlow);

    element.tile.dataset.filled = occupied ? "true" : "false";
    element.tile.dataset.fresh = state.freshTiles.has(index) ? "true" : "false";

    if (!occupied) {
      element.tile.dataset.digits = "3";
      element.tileValue.textContent = "";
      continue;
    }

    const [light, dark, ink] = getTileColors(value);
    element.tileValue.textContent = formatTileValue(value);
    element.tile.dataset.digits =
      String(value).length >= 5 ? "5" : String(value).length >= 4 ? "4" : "3";
    element.slot.style.setProperty("--tile-base-light", light);
    element.slot.style.setProperty("--tile-base-dark", dark);
    element.tile.style.boxShadow = `0 18px 34px rgba(3, 8, 16, 0.34), 0 0 22px ${
      depthTheme.tileGlow
    }, 0 0 32px ${colorToShadow(dark)}, inset 0 1px 0 rgba(255, 255, 255, 0.28)`;
    element.tileValue.style.color = ink;
  }
}

function applyMove(vector) {
  const { axis, sign } = getAxisAndSign(vector);
  const lines = buildLines(axis, sign);
  let moved = false;
  let scoreGained = 0;

  for (const line of lines) {
    const originalValues = line.map(({ x, y, z }) => getCell(x, y, z));
    const { values, gained } = collapseLine(originalValues);

    if (!arraysMatch(originalValues, values)) {
      moved = true;
    }

    scoreGained += gained;

    line.forEach(({ x, y, z }, position) => {
      setCell(x, y, z, values[position]);
    });
  }

  return { moved, scoreGained };
}

function collapseLine(values) {
  const compacted = values.filter(Boolean);
  const merged = [];
  let gained = 0;

  for (let index = 0; index < compacted.length; index += 1) {
    const current = compacted[index];
    const next = compacted[index + 1];

    if (current === next) {
      const mergedValue = current * 2;
      merged.push(mergedValue);
      gained += mergedValue;
      index += 1;
    } else {
      merged.push(current);
    }
  }

  while (merged.length < SIZE) {
    merged.push(0);
  }

  return { values: merged, gained };
}

function buildLines(axis, sign) {
  const order = sign < 0 ? [0, 1, 2, 3] : [3, 2, 1, 0];
  const lines = [];

  if (axis === "x") {
    for (let z = 0; z < SIZE; z += 1) {
      for (let y = 0; y < SIZE; y += 1) {
        lines.push(order.map((x) => ({ x, y, z })));
      }
    }
  }

  if (axis === "y") {
    for (let z = 0; z < SIZE; z += 1) {
      for (let x = 0; x < SIZE; x += 1) {
        lines.push(order.map((y) => ({ x, y, z })));
      }
    }
  }

  if (axis === "z") {
    for (let y = 0; y < SIZE; y += 1) {
      for (let x = 0; x < SIZE; x += 1) {
        lines.push(order.map((z) => ({ x, y, z })));
      }
    }
  }

  return lines;
}

function spawnRandomTile(count) {
  const empty = [];

  for (let index = 0; index < CELL_COUNT; index += 1) {
    if (state.board[index] === 0) {
      empty.push(index);
    }
  }

  const created = [];
  const spawnCount = Math.min(count, empty.length);

  for (let spawnIndex = 0; spawnIndex < spawnCount; spawnIndex += 1) {
    const pickIndex = Math.floor(Math.random() * empty.length);
    const boardIndex = empty.splice(pickIndex, 1)[0];
    state.board[boardIndex] = Math.random() < 0.9 ? 2 : 4;
    created.push(boardIndex);
  }

  return created;
}

function canAnyMove() {
  if (state.board.some((value) => value === 0)) {
    return true;
  }

  for (let z = 0; z < SIZE; z += 1) {
    for (let y = 0; y < SIZE; y += 1) {
      for (let x = 0; x < SIZE; x += 1) {
        const value = getCell(x, y, z);

        if (x + 1 < SIZE && getCell(x + 1, y, z) === value) {
          return true;
        }

        if (y + 1 < SIZE && getCell(x, y + 1, z) === value) {
          return true;
        }

        if (z + 1 < SIZE && getCell(x, y, z + 1) === value) {
          return true;
        }
      }
    }
  }

  return false;
}

function getViewRelativeVector(action, view) {
  let worldVector;

  if (action === "left") {
    worldVector = negate(view.right);
  } else if (action === "right") {
    worldVector = view.right;
  } else if (action === "up") {
    worldVector = view.up;
  } else if (action === "down") {
    worldVector = negate(view.up);
  } else if (action === "push") {
    worldVector = view.depth;
  } else {
    worldVector = negate(view.depth);
  }

  return worldVectorToBoardVector(worldVector);
}

function projectCoordinate(x, y, z) {
  const view = VIEW_CONFIGS[state.view];
  const world = {
    x: x - 1.5,
    y: 1.5 - y,
    z: z - 1.5,
  };
  const lateral = dot(world, view.right);
  const vertical = dot(world, view.up);
  const depthIndex = getDepthIndex(x, y, z, view);
  const centeredDepth = depthIndex - 1.5;

  return {
    screenX: lateral * 92 + centeredDepth * 34,
    screenY: -vertical * 92 - centeredDepth * 26,
    depthIndex,
    scale: 1.04 - depthIndex * 0.055,
  };
}

function getDepthIndex(x, y, z, view) {
  const axisValue = { x, y, z }[view.depthAxis];
  return view.reverseDepth ? SIZE - 1 - axisValue : axisValue;
}

function getAxisAndSign(vector) {
  if (vector[0] !== 0) {
    return { axis: "x", sign: Math.sign(vector[0]) };
  }

  if (vector[1] !== 0) {
    return { axis: "y", sign: Math.sign(vector[1]) };
  }

  return { axis: "z", sign: Math.sign(vector[2]) };
}

function getCell(x, y, z) {
  return state.board[indexFromCoordinates(x, y, z)];
}

function setCell(x, y, z, value) {
  state.board[indexFromCoordinates(x, y, z)] = value;
}

function indexFromCoordinates(x, y, z) {
  return z * SIZE * SIZE + y * SIZE + x;
}

function coordinatesFromIndex(index) {
  const z = Math.floor(index / (SIZE * SIZE));
  const remainder = index % (SIZE * SIZE);
  const y = Math.floor(remainder / SIZE);
  const x = remainder % SIZE;
  return { x, y, z };
}

function getTileColors(value) {
  if (TILE_COLORS[value]) {
    return TILE_COLORS[value];
  }

  const exponent = Math.log2(value);
  const hue = (exponent * 37) % 360;
  return [`hsl(${hue} 100% 85%)`, `hsl(${hue} 72% 52%)`, "#162235"];
}

function buildViewConfigs(definitions) {
  return Object.fromEntries(
    Object.entries(definitions).map(([key, definition]) => {
      const { yawTurns = 0, pitchTurns = 0, ...labels } = definition;
      const basis = rotateViewBasis(yawTurns, pitchTurns);
      const boardDepth = worldVectorToBoardVector(basis.depth);
      const { axis, sign } = getAxisAndSign(boardDepth);

      return [
        key,
        {
          ...labels,
          ...basis,
          depthAxis: axis,
          reverseDepth: sign < 0,
        },
      ];
    })
  );
}

function rotateViewBasis(yawTurns, pitchTurns) {
  return {
    right: rotateVector([1, 0, 0], yawTurns, pitchTurns),
    up: rotateVector([0, 1, 0], yawTurns, pitchTurns),
    depth: rotateVector([0, 0, 1], yawTurns, pitchTurns),
  };
}

function rotateVector(vector, yawTurns, pitchTurns) {
  let rotated = vector;

  for (let step = 0; step < normalizeQuarterTurns(yawTurns); step += 1) {
    rotated = rotateVectorAroundY(rotated);
  }

  for (let step = 0; step < normalizeQuarterTurns(pitchTurns); step += 1) {
    rotated = rotateVectorAroundX(rotated);
  }

  return rotated;
}

function rotateVectorAroundY([x, y, z]) {
  return [-z, y, x];
}

function rotateVectorAroundX([x, y, z]) {
  return [x, -z, y];
}

function normalizeQuarterTurns(turns) {
  return ((turns % 4) + 4) % 4;
}

function getDepthTheme(depthIndex, activeLayer) {
  const delta = depthIndex - activeLayer;

  if (delta === 0) {
    return {
      slotTint: "rgba(255, 255, 255, 0.1)",
      slotBorder: "rgba(255, 255, 255, 0.08)",
      slotShadow: "rgba(2, 6, 14, 0.14)",
      tileTint: "rgba(255, 255, 255, 0.03)",
      tileBorder: "rgba(255, 255, 255, 0.16)",
      tileGlow: "rgba(255, 255, 255, 0.18)",
    };
  }

  const distance = Math.abs(delta);

  if (delta < 0) {
    return {
      slotTint: `rgba(255, 190, 126, ${0.08 + distance * 0.05})`,
      slotBorder: `rgba(255, 203, 145, ${0.12 + distance * 0.05})`,
      slotShadow: `rgba(161, 93, 36, ${0.12 + distance * 0.04})`,
      tileTint: `rgba(255, 202, 143, ${0.08 + distance * 0.05})`,
      tileBorder: `rgba(255, 223, 181, ${0.18 + distance * 0.04})`,
      tileGlow: `rgba(255, 166, 94, ${0.12 + distance * 0.05})`,
    };
  }

  return {
    slotTint: `rgba(110, 199, 255, ${0.08 + distance * 0.05})`,
    slotBorder: `rgba(150, 220, 255, ${0.12 + distance * 0.05})`,
    slotShadow: `rgba(33, 78, 126, ${0.12 + distance * 0.04})`,
    tileTint: `rgba(146, 214, 255, ${0.08 + distance * 0.05})`,
    tileBorder: `rgba(193, 234, 255, ${0.18 + distance * 0.04})`,
    tileGlow: `rgba(98, 182, 255, ${0.12 + distance * 0.05})`,
  };
}

function setFreshTiles(indices) {
  clearTimeout(freshTileTimerId);
  state.freshTiles = new Set(indices);
  freshTileTimerId = window.setTimeout(() => {
    state.freshTiles.clear();
    renderScene();
  }, 320);
}

function readBestScore() {
  try {
    return Number(window.localStorage.getItem("2048x4-best")) || 0;
  } catch {
    return 0;
  }
}

function writeBestScore(score) {
  try {
    window.localStorage.setItem("2048x4-best", String(score));
  } catch {
    // Best-score persistence is optional; the game still works without storage.
  }
}

function arraysMatch(left, right) {
  return left.every((value, index) => value === right[index]);
}

function dot(point, vector) {
  return point.x * vector[0] + point.y * vector[1] + point.z * vector[2];
}

function negate(vector) {
  return vector.map((value) => value * -1);
}

function worldVectorToBoardVector(vector) {
  return [vector[0], vector[1] * -1, vector[2]];
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function formatTileValue(value) {
  return value >= 10000 ? value.toLocaleString() : String(value);
}

function colorToShadow(color) {
  if (color.startsWith("#")) {
    const normalized = color.replace("#", "");
    const bigint = Number.parseInt(normalized, 16);
    const red = (bigint >> 16) & 255;
    const green = (bigint >> 8) & 255;
    const blue = bigint & 255;
    return `rgba(${red}, ${green}, ${blue}, 0.28)`;
  }

  if (color.startsWith("hsl(")) {
    return color.replace("hsl(", "hsla(").replace(")", " / 0.28)");
  }

  return "rgba(255, 255, 255, 0.22)";
}
