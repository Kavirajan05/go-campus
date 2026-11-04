const canvas = document.getElementById("mapCanvas");
const roomName = document.getElementById("roomName");
const coords = document.getElementById("coords");
const clearTrailBtn = document.getElementById("clearTrailBtn");
const fromSelect = document.getElementById("fromSelect");
const toSelect = document.getElementById("toSelect");
const findPathBtn = document.getElementById("findPathBtn");
const pathList = document.getElementById("pathList");
const instructionList = document.getElementById("instructionList");
const destinationText = document.getElementById("destinationText");
const arrivalPopup = document.getElementById("arrivalPopup");
const arrivalText = document.getElementById("arrivalText");
const closeArrivalBtn = document.getElementById("closeArrivalBtn");

const ctx = canvas.getContext("2d");
const bounds = window.MAP_BOUNDS;

const DESIGN = {
  width: 1200,
  height: 500,
  paddingX: 52,
  paddingY: 34,
};

// Single corridor graph in world coordinates (meters).
const NODES = {
  cL: { x: 0.8, y: 1.0 },
  cR: { x: 19.2, y: 1.0 },
};

const EDGES = [{ id: "main-corridor", a: "cL", b: "cR" }];

const ROOMS = [
  { x: 0.0, y: 1.12, w: 6.0, h: 0.46, label: "AI&DS Lab 1" },
  { x: 6.0, y: 1.12, w: 4.0, h: 0.46, label: "HOD Room" },
  { x: 10.0, y: 1.12, w: 2.5, h: 0.46, label: "Ladies Toilet" },
  { x: 12.5, y: 1.12, w: 4.0, h: 0.46, label: "Steps" },
  { x: 16.5, y: 1.12, w: 3.5, h: 0.46, label: "Gents Toilet" },
  { x: 0.0, y: 0.22, w: 10.0, h: 0.66, label: "AI&DS Lab 3" },
  { x: 10.0, y: 0.22, w: 4.5, h: 0.66, label: "Cyber HOD" },
  { x: 14.5, y: 0.22, w: 5.5, h: 0.66, label: "Cyber Security Lab" },
];

let rawTrail = [];
const graph = buildGraph();
let refreshInFlight = false;
let lastPosition = null;
let currentPathOptions = [];
let selectedPathId = null;
let hasShownArrivalPopup = false;
let spokenMilestones = new Set();
let lastDistanceBucket = null;
let speechUnlocked = false;
let lastSpeechAt = 0;

const topIllustration = new Image();
let topIllustrationReady = false;
topIllustration.src = "/map.png";
topIllustration.onload = () => {
  topIllustrationReady = true;
  render(lastPosition);
};

function resizeCanvas() {
  const ratio = DESIGN.width / DESIGN.height;
  const availableW = canvas.parentElement.clientWidth;
  canvas.width = Math.floor(availableW);
  canvas.height = Math.floor(availableW / ratio);
}

function worldToPixel(point) {
  const usableW = canvas.width - DESIGN.paddingX * 2;
  const usableH = canvas.height - DESIGN.paddingY * 2;

  const xRatio =
    (point.x - bounds.min_x) / Math.max(bounds.max_x - bounds.min_x, 1e-6);
  const yRatio =
    (point.y - bounds.min_y) / Math.max(bounds.max_y - bounds.min_y, 1e-6);

  return {
    x: DESIGN.paddingX + xRatio * usableW,
    y: canvas.height - DESIGN.paddingY - yRatio * usableH,
  };
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function projectPointToSegment(p, a, b) {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const apx = p.x - a.x;
  const apy = p.y - a.y;
  const denom = abx * abx + aby * aby || 1e-12;
  const rawT = (apx * abx + apy * aby) / denom;
  const t = Math.max(0, Math.min(1, rawT));

  return {
    t,
    point: {
      x: a.x + t * abx,
      y: a.y + t * aby,
    },
  };
}

function buildGraph() {
  const adj = {};
  Object.keys(NODES).forEach((k) => {
    adj[k] = [];
  });

  EDGES.forEach((e) => {
    const w = distance(NODES[e.a], NODES[e.b]);
    adj[e.a].push({ to: e.b, w });
    adj[e.b].push({ to: e.a, w });
  });

  return adj;
}

function shortestPath(start, end) {
  if (start === end) return [start];

  const dist = {};
  const prev = {};
  const unvisited = new Set(Object.keys(NODES));

  Object.keys(NODES).forEach((k) => {
    dist[k] = Infinity;
    prev[k] = null;
  });
  dist[start] = 0;

  while (unvisited.size > 0) {
    let current = null;
    let best = Infinity;

    unvisited.forEach((k) => {
      if (dist[k] < best) {
        best = dist[k];
        current = k;
      }
    });

    if (!current || current === end) break;
    unvisited.delete(current);

    graph[current].forEach((edge) => {
      if (!unvisited.has(edge.to)) return;
      const alt = dist[current] + edge.w;
      if (alt < dist[edge.to]) {
        dist[edge.to] = alt;
        prev[edge.to] = current;
      }
    });
  }

  if (!Number.isFinite(dist[end])) return [start, end];

  const path = [];
  let cursor = end;
  while (cursor) {
    path.push(cursor);
    cursor = prev[cursor];
  }

  return path.reverse();
}

function nearestCorridorPoint(worldPoint) {
  let best = null;

  EDGES.forEach((edge) => {
    const a = NODES[edge.a];
    const b = NODES[edge.b];
    const projected = projectPointToSegment(worldPoint, a, b);
    const d = distance(worldPoint, projected.point);

    if (!best || d < best.d) {
      best = {
        d,
        edge,
        t: projected.t,
        point: projected.point,
      };
    }
  });

  return best;
}

function pushUnique(path, point) {
  const last = path[path.length - 1];
  if (!last || distance(last, point) > 1e-4) {
    path.push(point);
  }
}

function buildCorridorRoute(points) {
  const snaps = points
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
    .map(nearestCorridorPoint);

  if (!snaps.length) return { route: [], current: null };

  const route = [snaps[0].point];

  for (let i = 1; i < snaps.length; i += 1) {
    const prev = snaps[i - 1];
    const curr = snaps[i];

    if (prev.edge.id === curr.edge.id) {
      pushUnique(route, curr.point);
      continue;
    }

    const prevA = NODES[prev.edge.a];
    const prevB = NODES[prev.edge.b];
    const currA = NODES[curr.edge.a];
    const currB = NODES[curr.edge.b];
    const prevLen = distance(prevA, prevB);
    const currLen = distance(currA, currB);

    const options = [
      { s: prev.edge.a, e: curr.edge.a, c: prev.t * prevLen + curr.t * currLen },
      {
        s: prev.edge.a,
        e: curr.edge.b,
        c: prev.t * prevLen + (1 - curr.t) * currLen,
      },
      {
        s: prev.edge.b,
        e: curr.edge.a,
        c: (1 - prev.t) * prevLen + curr.t * currLen,
      },
      {
        s: prev.edge.b,
        e: curr.edge.b,
        c: (1 - prev.t) * prevLen + (1 - curr.t) * currLen,
      },
    ];

    let best = null;

    options.forEach((opt) => {
      const nodes = shortestPath(opt.s, opt.e);
      let graphCost = 0;
      for (let n = 1; n < nodes.length; n += 1) {
        graphCost += distance(NODES[nodes[n - 1]], NODES[nodes[n]]);
      }

      const total = opt.c + graphCost;
      if (!best || total < best.total) {
        best = { total, nodes };
      }
    });

    best.nodes.forEach((nodeId) => pushUnique(route, NODES[nodeId]));
    pushUnique(route, curr.point);
  }

  return {
    route,
    current: snaps[snaps.length - 1].point,
  };
}

function routeDistance(points) {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += distance(points[i - 1], points[i]);
  }
  return total;
}

function roomDoorPoint(room) {
  const centerX = room.x + room.w / 2;
  return {
    x: Math.max(NODES.cL.x, Math.min(NODES.cR.x, centerX)),
    y: 1.0,
  };
}

function roomCenterX(room) {
  return room.x + room.w / 2;
}

function sideForRoom(room, walkingEast) {
  const roomIsTop = room.y > 1.0;
  if (walkingEast) {
    return roomIsTop ? "left" : "right";
  }
  return roomIsTop ? "right" : "left";
}

function metersText(value) {
  return `${value.toFixed(1)} meter${value >= 1.95 ? "s" : ""}`;
}

function speakText(text, { force = false } = {}) {
  if (!("speechSynthesis" in window) || !speechUnlocked) return;

  const now = Date.now();
  if (!force && now - lastSpeechAt < 1600) return;
  if (!force && window.speechSynthesis.speaking) return;

  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = "en-US";
  utter.rate = 1;
  utter.pitch = 1;
  utter.volume = 1;
  window.speechSynthesis.speak(utter);
  lastSpeechAt = now;
}

function unlockSpeech() {
  speechUnlocked = true;
}

function buildInstructions(fromRoom, toRoom, fromDoor, toDoor) {
  if (fromRoom.label === toRoom.label) {
    return [
      `You are already at ${toRoom.label}.`,
      `No walking needed.`,
    ];
  }

  const walkingEast = toDoor.x >= fromDoor.x;
  const minX = Math.min(fromDoor.x, toDoor.x);
  const maxX = Math.max(fromDoor.x, toDoor.x);

  const landmarks = ROOMS.filter((room) => {
    if (room.label === fromRoom.label || room.label === toRoom.label) return false;
    const cx = roomCenterX(room);
    return cx > minX && cx < maxX;
  }).sort((a, b) => (walkingEast ? roomCenterX(a) - roomCenterX(b) : roomCenterX(b) - roomCenterX(a)));

  const steps = [`Start from ${fromRoom.label}.`];
  let currentX = fromDoor.x;

  landmarks.forEach((room) => {
    const cx = roomCenterX(room);
    const segment = Math.abs(cx - currentX);
    if (segment >= 0.35) {
      steps.push(`Go straight for ${metersText(segment)}.`);
    }
    steps.push(`You will see ${room.label} on your ${sideForRoom(room, walkingEast)}.`);
    currentX = cx;
  });

  const finalSegment = Math.abs(toDoor.x - currentX);
  if (finalSegment >= 0.2) {
    steps.push(`Continue straight for ${metersText(finalSegment)}.`);
  }
  steps.push(`You will reach ${toRoom.label}.`);
  return {
    steps,
    walkingEast,
    landmarks: landmarks.map((room) => ({
      id: room.label,
      label: room.label,
      x: roomCenterX(room),
    })),
  };
}

function renderInstructions(items) {
  instructionList.innerHTML = "";

  if (!items.length) {
    instructionList.classList.add("empty");
    const li = document.createElement("li");
    li.textContent = "Select a path to see step-by-step guidance.";
    instructionList.appendChild(li);
    return;
  }

  instructionList.classList.remove("empty");
  items.forEach((step) => {
    const li = document.createElement("li");
    li.textContent = step;
    instructionList.appendChild(li);
  });
}

function openArrivalPopup(message) {
  arrivalText.textContent = message;
  arrivalPopup.classList.add("show");
  arrivalPopup.setAttribute("aria-hidden", "false");
}

function closeArrivalPopup() {
  arrivalPopup.classList.remove("show");
  arrivalPopup.setAttribute("aria-hidden", "true");
}

function getSelectedRoute() {
  if (!currentPathOptions.length || !selectedPathId) return null;
  return currentPathOptions.find((p) => p.id === selectedPathId) || null;
}

function renderPathOptions() {
  pathList.innerHTML = "";

  if (!currentPathOptions.length) {
    const empty = document.createElement("div");
    empty.className = "path-empty";
    empty.textContent = "Select source and destination, then click Find path.";
    pathList.appendChild(empty);
    return;
  }

  currentPathOptions.forEach((option) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "path-item";
    if (option.id === selectedPathId) {
      btn.classList.add("active");
    }

    btn.innerHTML = `<span class="title">${option.label}</span><span class="meta">Distance: ${option.distanceMeters.toFixed(2)} m</span>`;

    btn.addEventListener("click", () => {
      selectedPathId = option.id;
      renderPathOptions();
      renderInstructions(option.instructions || []);
      destinationText.textContent = option.label;
      spokenMilestones = new Set();
      lastDistanceBucket = null;
      speakText(`Navigation selected. Destination: ${option.destinationLabel}.`, {
        force: true,
      });
      render(lastPosition);
    });

    pathList.appendChild(btn);
  });
}

function populateSelectors() {
  const roomLabels = ROOMS.map((room) => room.label);
  const options = ["Current location", ...roomLabels];

  fromSelect.innerHTML = options
    .map((label) => `<option value="${label}">${label}</option>`)
    .join("");
  toSelect.innerHTML = roomLabels
    .map((label) => `<option value="${label}">${label}</option>`)
    .join("");

  // Default: use current location as start when available
  fromSelect.selectedIndex = 0;
  if (toSelect.options.length > 0) toSelect.selectedIndex = 0;
}

function generatePathOptions() {
  const fromRoom = ROOMS.find((room) => room.label === fromSelect.value);
  const toRoom = ROOMS.find((room) => room.label === toSelect.value);

  // If 'Current location' is selected, fetch live position from backend
  let startPoint = null;
  if (fromSelect.value === "Current location") {
    try {
      // synchronous-like fetch; important to await state
      // we perform a blocking request here to ensure route uses current position
      // caller (generatePathOptions) is invoked from user interaction so await is fine
    } catch (e) {
      // fallthrough
    }
  }

  async function build() {
    if (fromSelect.value === "Current location") {
      try {
        const resp = await fetch("/state", { cache: "no-store" });
        if (resp.ok) {
          const data = await resp.json();
          const p = data.position;
          if (p && p.x !== null && p.y !== null) {
            startPoint = nearestCorridorPoint(p).point;
          } else {
            alert("Current location unknown. Wait for RSSI updates.");
            return;
          }
        }
      } catch (err) {
        alert("Unable to read current location from server.");
        return;
      }
    }

    // If both selected values are room labels (not using current location)
    if (!toRoom) {
      currentPathOptions = [];
      selectedPathId = null;
      renderPathOptions();
      renderInstructions([]);
      render(lastPosition);
      return;
    }

    let fromDoor;
    if (startPoint) {
      fromDoor = startPoint;
    } else if (fromRoom) {
      fromDoor = roomDoorPoint(fromRoom);
    } else {
      // fallback: use first room's door
      fromDoor = roomDoorPoint(ROOMS[0]);
    }

    const toDoor = roomDoorPoint(toRoom);
    const corridor = buildCorridorRoute([fromDoor, toDoor]);
    const plan = buildInstructions(fromRoom || { label: "Current location" }, toRoom, fromDoor, toDoor);

    currentPathOptions = [
      {
        id: "main",
        label: `${fromSelect.value} -> ${toRoom.label}`,
        route: corridor.route,
        distanceMeters: routeDistance(corridor.route),
        destinationPoint: toDoor,
        destinationLabel: toRoom.label,
        instructions: plan.steps,
        walkingEast: plan.walkingEast,
        landmarks: plan.landmarks,
      },
    ];
    selectedPathId = currentPathOptions[0].id;
    hasShownArrivalPopup = false;
    spokenMilestones = new Set();
    lastDistanceBucket = null;
    closeArrivalPopup();

    renderPathOptions();
    renderInstructions(currentPathOptions[0].instructions || []);
    destinationText.textContent = currentPathOptions[0].label;
    speakText(
      `Navigation started from ${fromSelect.value} to ${toRoom.label}. ${currentPathOptions[0].instructions[1] || "Proceed straight."}`,
      { force: true }
    );
    render(lastPosition);
  }

  build();
}

function handleAudioGuidance(selectedRoute, userSnap) {
  if (!selectedRoute || !userSnap) return;

  selectedRoute.landmarks.forEach((landmark) => {
    if (spokenMilestones.has(landmark.id)) return;

    const reached = selectedRoute.walkingEast
      ? userSnap.x >= landmark.x - 0.25
      : userSnap.x <= landmark.x + 0.25;

    if (reached) {
      spokenMilestones.add(landmark.id);
      speakText(`You have reached ${landmark.label}.`);
    }
  });

  const remaining = Math.abs(userSnap.x - selectedRoute.destinationPoint.x);
  if (remaining > 0.6) {
    const bucket = Math.ceil(remaining / 2);
    if (lastDistanceBucket === null || bucket < lastDistanceBucket) {
      lastDistanceBucket = bucket;
      speakText(
        `Go straight. ${remaining.toFixed(1)} meters remaining to ${selectedRoute.destinationLabel}.`
      );
    }
  }
}

function drawRoom(room) {
  const topLeft = worldToPixel({ x: room.x, y: room.y + room.h });
  const bottomRight = worldToPixel({ x: room.x + room.w, y: room.y });
  const w = bottomRight.x - topLeft.x;
  const h = bottomRight.y - topLeft.y;

  const topZone = room.y > 1.0;
  ctx.fillStyle = topZone ? "#fff8e7" : "#eefbf4";
  ctx.strokeStyle = "#9aaabd";
  ctx.lineWidth = 2.2;

  ctx.fillRect(topLeft.x, topLeft.y, w, h);
  ctx.strokeRect(topLeft.x, topLeft.y, w, h);

  ctx.fillStyle = "#111827";
  ctx.font = "800 22px Manrope";
  ctx.textAlign = "center";
  ctx.fillText(room.label, topLeft.x + w / 2, topLeft.y + h / 2 + 6);
}

function drawStaticMap() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const backGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
  backGrad.addColorStop(0, "#f3f8ff");
  backGrad.addColorStop(1, "#e8f7ef");
  ctx.fillStyle = backGrad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Upper strip uses the real static map image as reference.
  const topLeft = worldToPixel({ x: 0, y: 1.72 });
  const topRight = worldToPixel({ x: 20, y: 1.72 });
  const topBottom = worldToPixel({ x: 0, y: 1.12 });
  const topW = topRight.x - topLeft.x;
  const topH = topBottom.y - topLeft.y;

  if (topIllustrationReady) {
    // Crop the upper building band only (hide meter/arrow markings).
    const sx = 0;
    const sy = Math.floor(topIllustration.height * 0.11);
    const sw = topIllustration.width;
    const sh = Math.floor(topIllustration.height * 0.31);
    ctx.drawImage(topIllustration, sx, sy, sw, sh, topLeft.x, topLeft.y, topW, topH);
  } else {
    ctx.fillStyle = "#fff8e7";
    ctx.fillRect(topLeft.x, topLeft.y, topW, topH);
  }

  ctx.strokeStyle = "#9aaabd";
  ctx.lineWidth = 2.2;
  ctx.strokeRect(topLeft.x, topLeft.y, topW, topH);

  // Bottom strip mirrors top approach using the real static image reference.
  const bottomTop = worldToPixel({ x: 0, y: 0.88 });
  const bottomBottom = worldToPixel({ x: 0, y: 0.22 });
  const bottomW = topW;
  const bottomH = bottomBottom.y - bottomTop.y;

  if (topIllustrationReady) {
    // Crop lower building band only (hide bottom meter/arrow markings).
    const sx = 0;
    const sy = Math.floor(topIllustration.height * 0.50);
    const sw = topIllustration.width;
    const sh = Math.floor(topIllustration.height * 0.38);
    ctx.drawImage(
      topIllustration,
      sx,
      sy,
      sw,
      sh,
      topLeft.x,
      bottomTop.y,
      bottomW,
      bottomH
    );
  } else {
    ctx.fillStyle = "#eefbf4";
    ctx.fillRect(topLeft.x, bottomTop.y, bottomW, bottomH);
    ROOMS.filter((room) => room.y <= 1.0).forEach(drawRoom);
  }

  ctx.strokeStyle = "#9aaabd";
  ctx.lineWidth = 2.2;
  ctx.strokeRect(topLeft.x, bottomTop.y, bottomW, bottomH);

  // Draw single corridor base.
  ctx.strokeStyle = "#7f95af";
  ctx.lineWidth = 24;
  ctx.lineCap = "round";
  EDGES.forEach((edge) => {
    const a = worldToPixel(NODES[edge.a]);
    const b = worldToPixel(NODES[edge.b]);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  });

  // Inner lane highlight.
  ctx.strokeStyle = "#e6edf8";
  ctx.lineWidth = 12;
  EDGES.forEach((edge) => {
    const a = worldToPixel(NODES[edge.a]);
    const b = worldToPixel(NODES[edge.b]);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  });

  const corridorCenter = worldToPixel({ x: 10, y: 1.0 });
  ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(corridorCenter.x, corridorCenter.y, 18, 0, Math.PI * 2);
  ctx.stroke();
}

function drawDynamicLayer(position) {
  const selectedRoute = getSelectedRoute();
  const pathToDraw = selectedRoute ? selectedRoute.route : [];

  if (pathToDraw.length > 1) {
    ctx.beginPath();
    pathToDraw.forEach((p, i) => {
      const pix = worldToPixel(p);
      if (i === 0) ctx.moveTo(pix.x, pix.y);
      else ctx.lineTo(pix.x, pix.y);
    });
    ctx.strokeStyle = "rgba(10, 132, 255, 0.78)";
    ctx.lineWidth = 6;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke();
  }

  const snap =
    position && position.x !== null && position.y !== null
      ? nearestCorridorPoint(position).point
      : null;

  if (snap) {
    const p = worldToPixel(snap);

    ctx.beginPath();
    ctx.arc(p.x, p.y, 18, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(10, 132, 255, 0.22)";
    ctx.fill();

    ctx.beginPath();
    ctx.arc(p.x, p.y, 10, 0, Math.PI * 2);
    ctx.fillStyle = "#0a84ff";
    ctx.fill();

    ctx.beginPath();
    ctx.arc(p.x, p.y, 24, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(10, 132, 255, 0.35)";
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

function render(position) {
  lastPosition = position;
  drawStaticMap();
  drawDynamicLayer(position);
}

async function refresh() {
  if (refreshInFlight) return;
  refreshInFlight = true;

  try {
    const response = await fetch("/state", { cache: "no-store" });
    if (!response.ok) return;

    const data = await response.json();
    const p = data.position;

    rawTrail = Array.isArray(data.trail) ? data.trail : [];

    if (p && p.x !== null && p.y !== null) {
      roomName.textContent = p.room || "Unknown";
      coords.textContent = `(${p.x.toFixed(2)}, ${p.y.toFixed(2)})`;
    } else {
      roomName.textContent = "Waiting for RSSI updates...";
      coords.textContent = "-";
    }

    render(p);

    const selectedRoute = getSelectedRoute();
    if (selectedRoute && p && p.x !== null && p.y !== null) {
      const userSnap = nearestCorridorPoint(p).point;
      handleAudioGuidance(selectedRoute, userSnap);
      const remaining = distance(userSnap, selectedRoute.destinationPoint);

      if (remaining <= 0.45 && !hasShownArrivalPopup) {
        hasShownArrivalPopup = true;
        openArrivalPopup(`You have reached ${selectedRoute.destinationLabel}.`);
        speakText(`You have reached ${selectedRoute.destinationLabel}.`, {
          force: true,
        });
      }
    }
  } catch {
    roomName.textContent = "Server disconnected";
    render(null);
  } finally {
    refreshInFlight = false;
  }
}

window.addEventListener("load", () => {
  populateSelectors();
  renderPathOptions();
  renderInstructions([]);
  resizeCanvas();
  render(null);
  generatePathOptions();
  refresh();
});

window.addEventListener("resize", () => {
  resizeCanvas();
  render(null);
});

clearTrailBtn.addEventListener("click", async () => {
  await fetch("/reset", { method: "POST" });
  rawTrail = [];
   hasShownArrivalPopup = false;
   closeArrivalPopup();
  render(null);
});

findPathBtn.addEventListener("click", () => {
  unlockSpeech();
  generatePathOptions();
});

closeArrivalBtn.addEventListener("click", () => {
  closeArrivalPopup();
});

arrivalPopup.addEventListener("click", (event) => {
  if (event.target === arrivalPopup) {
    closeArrivalPopup();
  }
});

setInterval(refresh, 250);
