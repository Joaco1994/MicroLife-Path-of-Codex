import React, { useEffect, useRef, useState } from "react";

// MicroLife‑lite v5.16
// ✔ Restaura TODO lo previo (comida, wander, rally, nido, reproducción feral, combate, guardianes, barras reforzadas)
// ✔ Añade mecánica completa: Guerrero 6★ → Cocoon (20s, pulso, puede ser destruido) → Behemoth (HP alto, tentáculos, asedio a nidos 1 hp/s, no se inmoviliza en combate)
// ✔ Feromonas: nube por facción anclada al cluster más cercano a su nido
// ✔ Caps por nivel de nido: warriors = level+1; guardians = floor(level/2)
// ✔ FIX: define pickRallyPointFarFromNests y fallback seguro

/******** Utilidades base ********/
class RNG {
  constructor(seed = 123456789) { this.state = seed >>> 0; }
  next() { let x = this.state; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; this.state = x >>> 0; return this.state / 2 ** 32; }
  range(min, max) { return min + (max - min) * this.next(); }
}

function useAnimationFrame(callback, running) {
  const cbRef = useRef(callback);
  useEffect(() => { cbRef.current = callback; });
  useEffect(() => {
    let rafId; function loop() { cbRef.current(); rafId = requestAnimationFrame(loop); }
    if (running) rafId = requestAnimationFrame(loop);
    return () => rafId && cancelAnimationFrame(rafId);
  }, [running]);
}

const W = 900, H = 520;
const TREE = { x: W/2, y: H/2, r: 50 };
const CELL = 36;
const MIN_NEST_DIST = 80;   // más aire entre nidos

// SIN UPKEEP ni hambre
// Hardcaps por nido:
const CAP_WORKERS   = 10;
const CAP_WARRIORS  = 5;
const CAP_GUARDIANS = 3;


function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function cellOf(x, y) { return { cx: Math.floor(x / CELL), cy: Math.floor(y / CELL) }; }
function dist(a, b) { const dx=a.x-b.x, dy=a.y-b.y; return Math.hypot(dx, dy); }

function easeOutBack(t) { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t-1, 3) + c1 * Math.pow(t-1, 2); }
function startMitosis(baby, originX, originY, theta, now, dist=20, dur=0.8){
  baby.mitosis = { t0: now, dur, x0: originX, y0: originY, theta, dist };
  baby.x = originX; baby.y = originY;
}

const FACTIONS = [
  { id: 0, name: "Azul", color: "hsl(210 80% 60%)" },
  { id: 1, name: "Rojo", color: "hsl(0 80% 60%)" },
  { id: 2, name: "Verde", color: "hsl(140 70% 52%)" },
  { id: 3, name: "Amarillo", color: "hsl(48 90% 55%)" },
];

function spawnFoodEverywhere(rng, count) {
  const foods = [];
  for (let i = 0; i < count; i++) {
    let x = rng.range(10, W-10), y = rng.range(10, H-10);
    const d = Math.hypot(x - TREE.x, y - TREE.y);
    if (d < TREE.r + 8) {
      const ang = rng.range(0, Math.PI*2); const rad = TREE.r + 12 + rng.range(0, 120);
      x = clamp(TREE.x + Math.cos(ang)*rad, 10, W-10); y = clamp(TREE.y + Math.sin(ang)*rad, 10, H-10);
    }
    foods.push({ id: crypto.randomUUID(), x, y });
  }
  return foods;
}
function spawnFoodClusters(
  rng,
  clusters = 12,        // cantidad de “arrozales”
  perCluster = 22,      // puntos por cluster
  radius = 42           // radio aprox de cada cluster
){
  const foods = [];
  const centers = [];
  for (let i = 0; i < clusters; i++) {
    // centro alejado del árbol
    let cx = rng.range(20, W-20), cy = rng.range(20, H-20);
    const d = Math.hypot(cx - TREE.x, cy - TREE.y);
    if (d < TREE.r + 100) {
      const ang = rng.range(0, Math.PI*2); const rad = TREE.r + 120 + rng.range(0, 160);
      cx = clamp(TREE.x + Math.cos(ang)*rad, 20, W-20);
      cy = clamp(TREE.y + Math.sin(ang)*rad, 20, H-20);
    }
    centers.push({cx, cy});
  }
  for (const {cx, cy} of centers) {
    for (let k = 0; k < perCluster; k++) {
      const ang = rng.range(0, Math.PI*2);
      // más densidad hacia el centro (r^2 para bias)
      const r = Math.sqrt(Math.random()) * radius;
      const x = clamp(cx + Math.cos(ang)*r + (Math.random()-0.5)*4, 10, W-10);
      const y = clamp(cy + Math.sin(ang)*r + (Math.random()-0.5)*4, 10, H-10);
      // evita superponer al árbol
      const dT = Math.hypot(x - TREE.x, y - TREE.y);
      if (dT < TREE.r + 8) continue;
      foods.push({ id: crypto.randomUUID(), x, y });
    }
  }
  return foods;
}
// === Hotspots de comida (muestras rápidas) ===
function computeFoodHotspotList(food, radius = 60, samples = 60) {
  if (!food.length) return [];
  const R2 = radius * radius;

  // si hay menos puntos que 'samples', usamos todos
  const picks = [];
  for (let i = 0; i < Math.min(samples, food.length); i++) {
    const idx = Math.floor(Math.random() * food.length);
    picks.push(food[idx]);
  }

  // evaluar densidad alrededor de cada pick y quedarnos con top 3
  const scored = [];
  for (const p of picks) {
    let count = 0, sx = 0, sy = 0;
    for (const f of food) {
      const d2 = (f.x - p.x) ** 2 + (f.y - p.y) ** 2;
      if (d2 <= R2) { count++; sx += f.x; sy += f.y; }
    }
    if (count > 0) {
      const cx = sx / count, cy = sy / count; // centroide local
      scored.push({ x: cx, y: cy, count });
    }
  }
  scored.sort((a, b) => b.count - a.count);
  return scored.slice(0, 3); // devolvemos los 3 mejores
}
// === Clustering determinístico de comida (centroides por cercanía) ===
function computeFoodClusters(food, radius = 60, minPoints = 8) {
  const clusters = [];
  const r2 = radius * radius;
  for (const f of food) {
    let best = null, bestD2 = Infinity;
    for (const c of clusters) {
      const d2 = (f.x - c.x) ** 2 + (f.y - c.y) ** 2;
      if (d2 < bestD2 && d2 <= r2) { bestD2 = d2; best = c; }
    }
    if (best) {
      // actualizar centroide incremental
      best.count += 1;
      const k = best.count;
      best.x = best.x + (f.x - best.x) / k;
      best.y = best.y + (f.y - best.y) / k;
    } else {
      clusters.push({ x: f.x, y: f.y, count: 1 });
    }
  }
  // filtrar clusters pobres
  return clusters.filter(c => c.count >= minPoints);
}

// ¿Sigue “vivo” el cluster donde está la nube?
function clusterAliveAtPos(food, cx, cy, radius = 60, minPoints = 8) {
  const r2 = radius * radius;
  let count = 0;
  for (const f of food) {
    const d2 = (f.x - cx) ** 2 + (f.y - cy) ** 2;
    if (d2 <= r2) count++;
    if (count >= minPoints) return true;
  }
  return false;
}

function resolveNestPlacement(x, y, existingNests) {
  let px = x, py = y;
  for (let iter = 0; iter < 6; iter++) {
    let moved = false;
    for (const n of existingNests) {
      const dx = px - n.x, dy = py - n.y; const d = Math.hypot(dx, dy) || 0;
      if (d < MIN_NEST_DIST) {
        const need = MIN_NEST_DIST - d; const nx = (d === 0 ? Math.cos(iter*1.23) : dx / d); const ny = (d === 0 ? Math.sin(iter*1.23) : dy / d);
        px += nx * (need + 0.5); py += ny * (need + 0.5); moved = true;
      }
    }
    if (!moved) break; px = clamp(px, 16, W - 16); py = clamp(py, 16, H - 16);
  }
  return { x: px, y: py };
}

function spawnCritter(rng, faction = null, x, y, role = "worker") {
  const f = faction ?? Math.floor(rng.range(0, FACTIONS.length));
  const isWarrior  = role === "warrior";
  const isGuardian = role === "guardian";
  const isCocoon   = role === "cocoon";
  const isBehemoth = role === "behemoth";
      return {
    id: crypto.randomUUID(), role,
    x: x ?? rng.range(50, W-50), y: y ?? rng.range(50, H-50), vx: 0, vy: 0,
    faction: f, color: FACTIONS[f].color,
    radius:
      isBehemoth ? 14 :
      isGuardian ? 10 :
      isWarrior  ?  9 :
      (role === "queen")   ? 12 :
      (role === "qguard")  ? 10 : 7,
    carried: 0,
    carryMax: (isWarrior||isGuardian||isCocoon||isBehemoth || role==="queen" || role==="qguard") ? 0 : 2,
    target: null, feralFood: 0, visionCells: 1, idleTime: 0,
    mitosis: null,
    // wander
    wanderTheta: Math.random()*Math.PI*2, wanderUntil: 0, nextLevyAt: 0,
    // combate
    hp:
      isCocoon ? 36 :
      isBehemoth ? 120 :
      isGuardian ? 18 :
      isWarrior ? 12 :
      (role==="queen") ? 24 :
      (role==="qguard") ? 24 : 10,
    maxHp:
      isCocoon ? 36 :
      isBehemoth ? 120 :
      isGuardian ? 18 :
      isWarrior ? 12 :
      (role==="queen") ? 24 :
      (role==="qguard") ? 24 : 10,
    dps:
      isBehemoth ? 0  :
      isGuardian ? 1.5 :
      isWarrior ? 2 :
      (role==="queen") ? 3.5 :
      (role==="qguard") ? 2.6 :
      1,
    armor:   isGuardian ? 0.35 : (role==="qguard" ? 0.15 : 0),
    entangledUntil: 0, combatCooldownUntil: 0, entangledWith: null,
    // estrellas (guerrero) – dejamos como estaba, pero ya no hay hambre/upkeep
    stars: 0, bonusApplied: 0,
    // patrulla guardián
    patrolAngle: Math.random()*Math.PI*2, patrolRadius: 26,
    // evolución cocoon
    evolveUntil: 0, hatchedFrom: null, cocoonT0: 0,

    // Reina y guardias
    qlvl: 0,                  // nivel de la Reina por kills
    orbitAroundId: null,      // para qguard (id de la Reina)
    orbitAngle: Math.random()*Math.PI*2, // ángulo inicial de órbita
  };


}

function findFoodInGrid(c, foods, radiusCells) {
  const { cx, cy } = cellOf(c.x, c.y);
  let best=null, bestD2=Infinity;
  for (const f of foods) {
    const { cx:fx, cy:fy } = cellOf(f.x, f.y);
    if (Math.abs(fx-cx) <= radiusCells && Math.abs(fy-cy) <= radiusCells) {
      const d2=(f.x-c.x)**2+(f.y-c.y)**2; if (d2 < bestD2) { bestD2=d2; best=f; }
    }
  }
  return best;
}

function findNearestEnemyWorkerOrBehemoth(c, crits){
  let best=null, bestD2=Infinity;
  for (const o of crits){
    if (o.id===c.id) continue; if (o.faction===c.faction) continue;
    if (!(o.role==="worker" || o.role==="behemoth")) continue;
    const d2=(o.x-c.x)**2+(o.y-c.y)**2; if (d2<bestD2){bestD2=d2;best=o;}
  }
  return best;
}
function findNearestEnemyWarrior(c, crits, maxDist=70){
  let best=null, bestD2=Infinity, R2=maxDist*maxDist;
  for(const o of crits){
    if (o.faction===c.faction) continue;
    if (o.role!=='warrior') continue;
    const d2=(o.x-c.x)**2+(o.y-c.y)**2;
    if (d2<R2 && d2<bestD2){bestD2=d2; best=o;}
  }
  return best;
}

function countByRoleForNest(crits, nestId, role){
  let cnt=0;
  for(const u of crits){
    if (u.homeNestId===nestId && u.role===role) cnt++;
  }
  return cnt;
}

function assignHomeIfNearNest(unit, nests){
  // Si el unit está cerca de su nido de facción y aún no tiene homeNestId,
  // lo asignamos (esto ayuda a contar caps por nido)
  if (unit.homeNestId) return;
  const myNest = nests.find(n=> n.faction===unit.faction && ( (unit.x-n.x)**2 + (unit.y-n.y)**2 <= 26*26 ));
  if (myNest) unit.homeNestId = myNest.id;
}

function spawnQueenWithGuards(rng, nest, now){
  // Reina
  const q = spawnCritter(rng, nest.faction, nest.x+6, nest.y+6, 'queen');
  q.homeNestId = nest.id;
  // Guardias de la reina
  const g1 = spawnCritter(rng, nest.faction, nest.x-8, nest.y, 'qguard');
  const g2 = spawnCritter(rng, nest.faction, nest.x, nest.y-8, 'qguard');
  g1.homeNestId = nest.id; g2.homeNestId = nest.id;
  g1.orbitAroundId = q.id; g2.orbitAroundId = q.id;
  g1.orbitAngle = Math.random()*Math.PI*2; g2.orbitAngle = g1.orbitAngle + Math.PI;
  // efecto de nacimiento (mitosis suave)
  startMitosis(q, nest.x, nest.y, Math.random()*Math.PI*2, now, 18, 0.6);
  startMitosis(g1, nest.x, nest.y, Math.random()*Math.PI*2, now, 16, 0.5);
  startMitosis(g2, nest.x, nest.y, Math.random()*Math.PI*2, now, 16, 0.5);
  return [q,g1,g2];
}


function pickRallyPoint(rng) {
  for (let tries=0; tries<20; tries++) {
    const x = rng.range(40, W-40), y = rng.range(40, H-40);
    if (Math.hypot(x - TREE.x, y - TREE.y) > TREE.r + 160) return { x, y };
  }
  return { x: W - 60, y: H - 60 };
}

// NEW: rally lejos de nidos ya existentes
function pickRallyPointFarFromNests(rng, nests, samples = 40) {
  let best = { x: W - 60, y: H - 60 }, bestScore = -1;
  for (let i = 0; i < samples; i++) {
    const cand = { x: rng.range(40, W - 40), y: rng.range(40, H - 40) };
    // evitar árbol
    if (Math.hypot(cand.x - TREE.x, cand.y - TREE.y) <= TREE.r + 140) continue;
    // maximizar distancia mínima a cualquier nido existente
    let minD = Infinity;
    for (const n of nests) {
      const d = Math.hypot(cand.x - n.x, cand.y - n.y);
      if (d < minD) minD = d;
    }
    if (minD > bestScore) { bestScore = minD; best = cand; }
  }
  return best;
}

function pickWanderTarget(c, now, scarcityFactor=1) {
  const jitter = (Math.random()-0.5) * 0.4; c.wanderTheta += jitter;
  const doLevy = now >= (c.nextLevyAt||0);
  const baseMin = doLevy ? 220 : 90, baseMax = doLevy ? 360 : 160;
  const d = (baseMin + Math.random()*(baseMax-baseMin)) * scarcityFactor;
  const tx = clamp(c.x + Math.cos(c.wanderTheta)*d, 8, W-8);
  const ty = clamp(c.y + Math.sin(c.wanderTheta)*d, 8, H-8);
  if (doLevy) c.nextLevyAt = now + (6 + Math.random()*4);
  c.wanderUntil = now + (1.4 + Math.random()*1.1);
  return { x: tx, y: ty };
}

/********* Componente principal *********/
export default function MicroLifeLite(){
  const [rng] = useState(()=>new RNG(Math.floor(Math.random()*1e9)));
  const [critters,setCritters] = useState(()=>{
    const arr=[]; for(let f=0;f<FACTIONS.length;f++) for(let i=0;i<2;i++) arr.push(spawnCritter(rng,f)); return arr;
  });
  const [food,setFood] = useState(()=>spawnFoodClusters(rng, 12, 22, 42));
  const [running,setRunning] = useState(true);
  const [nests,setNests] = useState([]); // {id,faction,x,y,food,cumFood,level,hp,nextSpawnAt}
  const [rallies,setRallies] = useState({});

  const canvasRef = useRef(null);
  const simTimeRef = useRef(0);

  const crittersRef = useRef(critters); useEffect(()=>{ crittersRef.current=critters; },[critters]);
  const foodRef = useRef(food); useEffect(()=>{ foodRef.current=food; },[food]);
  const nestsRef = useRef(nests); useEffect(()=>{ nestsRef.current=nests; },[nests]);
  const ralliesRef = useRef(rallies); useEffect(()=>{ ralliesRef.current=rallies; },[rallies]);
  const respawnsRef = useRef([]); // items: {x:number, y:number, at:number}
  const pheromonesRef = useRef({}); // { [factionId]: {x,y,r} }
  const pherTickRef = useRef(0);    // temporizador de refresco


  useAnimationFrame(()=>{
    const ctx=canvasRef.current?.getContext("2d"); if(!ctx) return;
    const dt=1/60; simTimeRef.current+=dt; const now=simTimeRef.current;
    let pendingFood = []; // acumulamos comida a sumar este frame

    // algo de comida nueva para que no se paralice el mapa
    if (Math.random() < 0.02) pendingFood.push(...spawnFoodEverywhere(rng, 1));

    // procesar respawns locales ya vencidos (rebrote)
    {
      const due = [];
      const keep = [];
      for (const r of respawnsRef.current) {
        if (now >= r.at) due.push(r); else keep.push(r);
      }
      respawnsRef.current = keep;
      if (due.length) {
        const spawned = due.map(r => {
          const ang = Math.random()*Math.PI*2;
          const rad = Math.random()*10; // jitter leve
          const x = clamp(r.x + Math.cos(ang)*rad, 10, W-10);
          const y = clamp(r.y + Math.sin(ang)*rad, 10, H-10);
          return { id: crypto.randomUUID(), x, y };
        });
        if (spawned.length) pendingFood.push(...spawned); // <-- usar buffer, NO setFood acá
      }
    }

    let newFood = foodRef.current.map(f=>({...f}));
    if (pendingFood.length) newFood = newFood.concat(pendingFood);
    let newCrits = crittersRef.current.map(c=>({...c}));
    let newNests = nestsRef.current.map(n=>({...n}));
    let ralliesNow = {...ralliesRef.current};

    // === Feromonas: actualizar hotspot cada ~2s (por facción, cluster más cercano a su nido) ===
    // === Feromonas: actualizar hotspot cada ~2s (por facción, cluster más cercano a su nido, estable) ===
pherTickRef.current += dt;
if (pherTickRef.current >= 2) {
  pherTickRef.current = 0;
  // 1) clusters determinísticos del mapa actual
  const clusters = computeFoodClusters(newFood, 60, 8);
  const maxNestDist = 260; // opcional: ignorar clusters muy lejos del nido

  // 2) reconstruimos clouds por facción SOLO si tiene nido
  const clouds = {};
  for (const f of FACTIONS) {
    const myNest = newNests.find(n => n.faction === f.id);
    if (!myNest) continue;

    const existing = (pheromonesRef.current || {})[f.id];

    // Si ya tenía nube y sigue "viva", la conservamos
    if (existing && clusterAliveAtPos(newFood, existing.x, existing.y, 60, 8)) {
      clouds[f.id] = existing;
      continue;
    }

    // Elegir el cluster válido MÁS CERCANO AL NIDO
    let pick = null, bestD2 = Infinity;
    for (const c of clusters) {
      const d2 = (c.x - myNest.x) ** 2 + (c.y - myNest.y) ** 2;
      const d = Math.sqrt(d2);
      if (d > maxNestDist) continue; // opcional: descartar lejos
      if (d2 < bestD2) { bestD2 = d2; pick = c; }
    }

    if (pick) {
      clouds[f.id] = { x: pick.x, y: pick.y, r: 60 };
    } else {
      // Si no hay cluster válido cerca, no seteamos nube esta vez.
      // (los workers usarán wander hasta que aparezca comida)
    }
  }

  pheromonesRef.current = clouds;
}



    const toAdd=[];

    // ⭐ mejoras/regeneración de guerreros (como antes)
    for (const c of newCrits){
      if (c.role!=="warrior") continue;
      if ((c.stars||0) >= 1 && !c.hungry) c.hp = Math.min(c.maxHp, c.hp + 0.1*dt);
      while (c.stars > (c.bonusApplied||0)) {
        const level = (c.bonusApplied||0)+1;
        if (level===2) { c.dps += 0.25; c.maxHp += 5; c.hp += 5; }
        else if (level>=3) { c.dps += 0.11; c.maxHp += 2.5; c.hp += 2.5; }
        c.bonusApplied = level;
      }
    }

    // Rally auto si >=5 workers y sin nido ni rally
    {
      const counts = new Map();
      for (const c of newCrits) if (c.role==='worker') counts.set(c.faction, (counts.get(c.faction)||0)+1);
      for (const f of FACTIONS) {
        const hasNest = newNests.some(n => n.faction === f.id);
        const hasRally = !!ralliesNow[f.id];
        if (!hasNest && !hasRally && (counts.get(f.id)||0) >= 5) {
  const p = (typeof pickRallyPointFarFromNests === 'function')
    ? pickRallyPointFarFromNests(rng, newNests, 60)
    : pickRallyPoint(rng);
  ralliesNow[f.id] = { ...p, active: true };
}
      }
    }

    // Combate y entablado (behemoth/cocoon NO se inmovilizan)
    for (let i=0;i<newCrits.length;i++){
      const a=newCrits[i];
      for (let j=i+1;j<newCrits.length;j++){
        const b=newCrits[j]; if (a.faction===b.faction) continue;
        const rsum = (a.radius||7)+(b.radius||7);
        const dx=a.x-b.x, dy=a.y-b.y; if (dx*dx+dy*dy > rsum*rsum) continue;
        let dmgAB = (b.dps||1) * dt * (1 - (a.armor||0));
        let dmgBA = (a.dps||1) * dt * (1 - (b.armor||0));



        // bonus: guardian pega 1.25× a behemoth
        if (b.role === 'guardian' && a.role === 'behemoth') dmgAB *= 1.25;
        if (a.role === 'guardian' && b.role === 'behemoth') dmgBA *= 1.25;

        a.hp = Math.max(0, a.hp - dmgAB);
        b.hp = Math.max(0, b.hp - dmgBA);

        const canLockA = (a.role==='warrior' || a.role==='guardian');
        const canLockB = (b.role==='warrior' || b.role==='guardian');
        const noLockRoles = (role)=> (role==='behemoth' || role==='cocoon');
        if (canLockA && canLockB && !noLockRoles(a.role) && !noLockRoles(b.role)) {
          a.entangledUntil = Infinity; b.entangledUntil = Infinity; a.entangledWith=b.id; b.entangledWith=a.id;
        } else if (now >= a.combatCooldownUntil && now >= b.combatCooldownUntil) {
          if (a.entangledUntil < now) a.entangledUntil = now + 3;
          if (b.entangledUntil < now) b.entangledUntil = now + 3;
        }
      }
    }

    // Muertos → estrellas para guerreros (si matan a workers)
    const deadIds = new Set(newCrits.filter(c => (c.hp ?? 1) <= 0).map(c=>c.id));
    for (const victim of newCrits){
      if (!deadIds.has(victim.id)) continue; if (victim.role !== 'worker') continue;
      let killer=null, bestD2=Infinity;
      for (const o of newCrits){
        if (o.role !== 'warrior') continue; if (o.faction === victim.faction) continue;
        const rsum=(o.radius||9)+(victim.radius||7); const d2=(o.x-victim.x)**2+(o.y-victim.y)**2;
        if (d2 <= rsum*rsum && d2 < bestD2){ bestD2=d2; killer=o; }
      }
      if (killer) killer.stars = (killer.stars||0)+1;
    }
    // Reina gana "niveles" según tipo de víctima
for (const victim of newCrits){
  if (!deadIds.has(victim.id)) continue;
  // buscar killer cercano
  let killer=null, bestD2=Infinity;
  for (const o of newCrits){
    if (o.faction===victim.faction) continue;
    const rsum=(o.radius||8)+(victim.radius||8);
    const d2=(o.x-victim.x)**2+(o.y-victim.y)**2;
    if (d2 <= rsum*rsum && d2 < bestD2){ bestD2=d2; killer=o; }
  }
  if (killer && killer.role==='queen'){
    const w =
      (victim.role==='worker')   ? 1 :
      (victim.role==='warrior')  ? 2 :
      (victim.role==='guardian') ? 2 :
      (victim.role==='behemoth') ? 5 : 0;
    killer.qlvl = (killer.qlvl||0) + w;
  }
}


    // limpiar entablado vencido / por muerte + cooldown
    for (const c of newCrits){
      if (c.entangledWith && deadIds.has(c.entangledWith)) { c.entangledWith=null; c.entangledUntil=0; }
      if (c.entangledUntil>0 && c.entangledUntil!==Infinity && now >= c.entangledUntil) {
        c.entangledUntil = 0; c.combatCooldownUntil = Math.max(c.combatCooldownUntil, now + 1);
      }
    }

    // eliminar muertos
    newCrits = newCrits.filter(c => (c.hp ?? 1) > 0);

    // cancelar rally si bajan de 5 workers vivos
    {
      const counts = new Map();
      for (const c of newCrits) if (c.role==='worker') counts.set(c.faction, (counts.get(c.faction)||0)+1);
      for (const f of FACTIONS) {
        if (ralliesNow[f.id] && (counts.get(f.id)||0) < 5) {
          delete ralliesNow[f.id];
          for (const c of newCrits) if (c.faction===f.id && c.target && c.target.type==='rally') c.target = null;
        }
      }
    }

    // MOVIMIENTO
    for (const c of newCrits) {
      // inmóvil si está entablado aún
      if (c.entangledUntil && (c.entangledUntil===Infinity || now < c.entangledUntil)) {
        if (c.role==='behemoth') {/* excepción: behemoth sigue moviéndose */} else continue;
      }

      if (c.mitosis) {
        const { t0, dur, x0, y0, theta, dist:md } = c.mitosis; const age = now - t0;
        if (age < dur) { const p = clamp(age/dur,0,1); const e = easeOutBack(p); c.x = x0 + Math.cos(theta) * md * e; c.y = y0 + Math.sin(theta) * md * e; continue; }
        else c.mitosis = null;
      }

      const rally = ralliesNow[c.faction];
      const homeNest = newNests.find(n => n.faction === c.faction);

      if (c.role==='warrior') {
        if ((c.stars||0) >= 6 && homeNest) {
          c.target = { type:'evolve', x: homeNest.x+12, y: homeNest.y+12 };
        } else {
          const prey = findNearestEnemyWorkerOrBehemoth(c, newCrits);
          if (prey) c.target = { type:'hunt', x: prey.x, y: prey.y, preyId: prey.id };
          else { const wt = pickWanderTarget(c, now, 1); c.target = { type:'wander', x: wt.x, y: wt.y }; }
        }
      } else if (c.role==='queen') {
  // si no tiene objetivo, elige uno “con propósito” (aleatorio pero lejano)
  if (!c.target || c.target.type!=='expand'){
    const ang = Math.random()*Math.PI*2;
    const d   = 180 + Math.random()*140;
    const tx  = clamp(c.x + Math.cos(ang)*d, 20, W-20);
    const ty  = clamp(c.y + Math.sin(ang)*d, 20, H-20);
    c.target = { type:'expand', x:tx, y:ty };
  }
  // velocidad lenta
  // (dejá el cálculo de spd global; si querés extra-lento podés multiplicar aquí)
  // c.x/c.y se actualizan abajo como todos
} else if (c.role==='qguard') {
  // orbitar alrededor de la Reina asignada
  const queen = newCrits.find(u=>u.id===c.orbitAroundId);
  if (queen){
    c.orbitAngle += 0.03;
    const R = 16;
    const tx = queen.x + Math.cos(c.orbitAngle)*R;
    const ty = queen.y + Math.sin(c.orbitAngle)*R;
    c.target = { type:'orbit', x: tx, y: ty };
  } else {
    // si perdió a la Reina, patrulla cerca del nido
    const homeNest = newNests.find(n=>n.id===c.homeNestId);
    if (homeNest){
      c.patrolAngle = (c.patrolAngle||0) + 0.02;
      const px=homeNest.x+Math.cos(c.patrolAngle)*22;
      const py=homeNest.y+Math.sin(c.patrolAngle)*22;
      c.target = { type:'patrol', x:px, y:py };
    } else {
      const wt = pickWanderTarget(c, now, 0.9);
      c.target = { type:'wander', x: wt.x, y: wt.y };
    }
  }
} else if (c.role==='guardian') {
        if (homeNest){
          // 1) Primero, buscar BEHEMOTH cerca del nido (prioridad absoluta)
          let targetB=null, bestD2B=Infinity; const aggroRBehe=140;
          for (const o of newCrits){
            if (o.faction===c.faction) continue;
            if (o.role!=='behemoth') continue;
            const d2=(o.x-homeNest.x)**2+(o.y-homeNest.y)**2;
            if (d2<bestD2B && d2<=aggroRBehe*aggroRBehe){ bestD2B=d2; targetB=o; }
          }
          if (targetB){
            c.target={type:'defend', x: targetB.x, y: targetB.y, preyId: targetB.id};
          } else {
            // 2) Si no hay behemoth, comportamiento actual: buscar WARRIORS
            let targetW=null, bestD2=Infinity; const aggroR=110;
            for (const o of newCrits){ if (o.faction===c.faction) continue; if (o.role!=='warrior') continue;
              const d2=(o.x-homeNest.x)**2+(o.y-homeNest.y)**2; if (d2<bestD2 && d2<=aggroR*aggroR){ bestD2=d2; targetW=o; }
            }
            if (targetW) c.target={type:'defend', x: targetW.x, y: targetW.y, preyId: targetW.id};
            else { c.patrolAngle += 0.015; const px=homeNest.x+Math.cos(c.patrolAngle)*(c.patrolRadius||26); const py=homeNest.y+Math.sin(c.patrolAngle)*(c.patrolRadius||26); c.target={type:'patrol', x:px, y:py}; }
          }
        } else { const wt = pickWanderTarget(c, now, 0.6); c.target={type:'wander', x:wt.x, y:wt.y}; }
      }
      else if (c.role==='behemoth') {
        // Prioridad: si ve una Reina enemiga, la persigue
let qTarget=null, bestQ=Infinity;
for (const o of newCrits){
  if (o.faction===c.faction) continue;
  if (o.role!=='queen') continue;
  const d2=(o.x-c.x)**2+(o.y-c.y)**2;
  if (d2<bestQ){ bestQ=d2; qTarget=o; }
}
if (qTarget){
  c.target = { type:'huntQueen', x:qTarget.x, y:qTarget.y, preyId:qTarget.id };
} else {
  // (dejá lo que ya tenías: buscar nido enemigo más cercano o wander)
}
        let bestNest=null, bestD2=Infinity; for (const n of newNests){ if (n.faction===c.faction) continue; const d2=(n.x-c.x)**2+(n.y-c.y)**2; if (d2<bestD2){bestD2=d2;bestNest=n;} }
        if (bestNest) c.target={type:'siege', x:bestNest.x, y:bestNest.y, nestId:bestNest.id}; else { const wt = pickWanderTarget(c, now, 0.6); c.target={type:'wander', x:wt.x, y:wt.y}; }
      } else if (c.role==='cocoon') {
        c.target = null; // inmóvil
            } else if (rally && rally.active) {
        c.target = { type: 'rally', x: rally.x, y: rally.y };
      } else if (c.carryMax > 0 && c.carried >= c.carryMax && homeNest) {
        c.target = { type: 'nest', x: homeNest.x, y: homeNest.y }; c.idleTime = 0; c.visionCells = 1;
      } else {
        // 👇 NUEVO: primero evaluamos amenaza (guerrero enemigo) y huimos
        const threat = findNearestEnemyWarrior(c, newCrits, 70);
        if (threat){
          const dx = c.x - threat.x, dy = c.y - threat.y;
          const L = Math.hypot(dx,dy)||1;
          const fleeDist = 60;
          const fx = clamp(c.x + (dx/L)*fleeDist, 8, W-8);
          const fy = clamp(c.y + (dy/L)*fleeDist, 8, H-8);
          c.target = { type:'flee', x: fx, y: fy };
        } else {
          // 🧠 SIN AMENAZA: se mantiene tu lógica tal cual (food → feromonas → wander)
          const seen = findFoodInGrid(c, newFood, c.visionCells);
          if (seen) {
            c.target = { type:'food', id:seen.id, x:seen.x, y:seen.y };
            c.idleTime=0; c.visionCells=1;
          } else {
            // 🔵 Si hay nube de feromonas de mi facción, voy hacia ella; si no, wander original
            const cloud = pheromonesRef.current?.[c.faction];
            if (cloud) {
              const jitter = 6; // que no se apilen
              const jx = (Math.random()-0.5)*jitter;
              const jy = (Math.random()-0.5)*jitter;
              c.target = { type:'pher', x: clamp(cloud.x + jx, 8, W-8), y: clamp(cloud.y + jy, 8, H-8) };
              // expandir visión con el tiempo igualmente
              c.idleTime += (1/60);
              if (c.idleTime >= 0.75) { c.idleTime=0; c.visionCells=Math.min(c.visionCells+1,10); }
            } else {
              c.idleTime += (1/60);
              if (c.idleTime >= 0.75) { c.idleTime=0; c.visionCells=Math.min(c.visionCells+1,10); }
              const scarcity = Math.max(0.8, 1.4 - newFood.length/250);
              const wt = pickWanderTarget(c, now, scarcity);
              c.target = { type:'wander', x: wt.x, y: wt.y };
            }
          }
        }
      }


      // integrar velocidad por rol
const baseSpeed = (c.role==='behemoth') ? 0.6 : (c.role==='guardian') ? 1.0 : 1.05;
const rallyBoost = (rally && rally.active && c.role==='worker') ? 1.35 : 1;
const spd = baseSpeed * rallyBoost;


      const tx = c.target?.x ?? c.x, ty = c.target?.y ?? c.y; const dx = tx - c.x, dy = ty - c.y; const L = Math.hypot(dx,dy)||1;
      let nx=c.x + (dx/L)*spd, ny=c.y + (dy/L)*spd;

      // evitar el árbol
      const dxT = nx - TREE.x, dyT = ny - TREE.y; const dT = Math.hypot(dxT, dyT);
      if (dT < TREE.r + c.radius) { const nxn = dxT / (dT || 1), nyn = dyT / (dT || 1); nx = TREE.x + (TREE.r + c.radius) * nxn; ny = TREE.y + (TREE.r + c.radius) * nyn; }
      c.x = clamp(nx, 6, W-6); c.y = clamp(ny, 6, H-6);
      // Si es Reina y llegó al destino de expansión, funda nido
if (c.role==='queen' && c.target && c.target.type==='expand'){
  const dx = c.target.x - c.x, dy = c.target.y - c.y;
  if (Math.hypot(dx,dy) < 6){
    const pos = resolveNestPlacement(c.x, c.y, newNests);
    newNests.push({
      id: crypto.randomUUID(),
      faction: c.faction,
      x: pos.x, y: pos.y,
      food: 0, cumFood: 0, level: 0, hp: 60,
      nextSpawnAt: now + 10
    });
    // Asignar la Reina al nuevo nido
    c.homeNestId = newNests[newNests.length-1].id;
    // Elegir siguiente objetivo de expansión (opcional)
    c.target = null;
  }
}

    }

    // Evolución: guerrero 6★ → cocoon en nido; cocoon → behemoth
    {
      const removeIds = new Set();
      for (const c of newCrits) {
        if (c.role==='warrior' && (c.stars||0) >= 6) {
          const myNest = newNests.find(n=>n.faction===c.faction);
          if (myNest && ((c.x-myNest.x)**2 + (c.y-myNest.y)**2) <= (c.radius+16)**2){
            const coc = spawnCritter(rng, c.faction, myNest.x+12, myNest.y+12, 'cocoon');
            coc.cocoonT0 = now; coc.evolveUntil = now + 20; coc.hatchedFrom = c.id;
            toAdd.push(coc); removeIds.add(c.id);
          }
        } else if (c.role==='cocoon') {
          if (now >= (c.evolveUntil||0)){
            const b = spawnCritter(rng, c.faction, c.x, c.y, 'behemoth');
            const th = Math.random()*Math.PI*2; startMitosis(b, c.x, c.y, th, now, 14, 0.6);
            toAdd.push(b); removeIds.add(c.id);
          }
        }
      }
      if (removeIds.size){ newCrits = newCrits.filter(x=>!removeIds.has(x.id)); }
    }

    // Recolectar/entregar comida (guerreros/guardianes/cocoons/behemoths NO recolectan)
    for (const c of newCrits) {
      if (c.role!=='worker') continue;
      const rally = ralliesNow[c.faction]; const homeNest = newNests.find(n => n.faction === c.faction);
      if (rally && rally.active) continue;

      if (homeNest && c.carried>0 && (c.x-homeNest.x)**2+(c.y-homeNest.y)**2 <= (c.radius+10)**2){
        homeNest.food=(homeNest.food||0)+c.carried;
        const prevCum = homeNest.cumFood||0; homeNest.cumFood = prevCum + c.carried;
        const prevLvl = Math.floor(prevCum/20); const newLvl = Math.floor((homeNest.cumFood)/20);
        if (newLvl>prevLvl){
          // Cap por nivel del nido: warriors = level+1; guardians = floor(level/2)
          // contamos los actuales asignados a este nido
          let curWar = newCrits.filter(u=>u.role==='warrior' && u.homeNestId===homeNest.id).length;
          let curGua = newCrits.filter(u=>u.role==='guardian' && u.homeNestId===homeNest.id).length;

          for(let i=prevLvl;i<newLvl;i++){
            // al subir cada nivel, aparece 1 guardián, pero respetando cap tras el NUEVO nivel
            const lvlAfter = i+1;
            const capG = Math.floor(lvlAfter/2);
            if (curGua < capG){
              const g=spawnCritter(rng, homeNest.faction, homeNest.x, homeNest.y, 'guardian');
              g.homeNestId = homeNest.id;
              const th=Math.random()*Math.PI*2; startMitosis(g, homeNest.x, homeNest.y, th, now, 16, 0.5);
              toAdd.push(g); curGua++;
            }
          }
          homeNest.level = newLvl;
        }
        c.carried=0; c.target=null; continue;
      }

      // recoger comida
      for (let k=0;k<newFood.length;k++){
        const f=newFood[k]; if ((c.x-f.x)**2+(c.y-f.y)**2 <= (c.radius+3)**2){
          c.carried=(c.carried||0)+1; c.feralFood=(c.feralFood||0)+1; newFood.splice(k,1); k--;
          // rebrota en 8–16s cerca del mismo lugar
          respawnsRef.current.push({
            x: f.x, y: f.y,
            at: now + (8 + Math.random()*8)
          });
          const factionHasNest=newNests.some(n=>n.faction===c.faction); const factionInRally=!!ralliesNow[c.faction];
          if(!factionHasNest && !factionInRally && c.feralFood>=5){
            c.feralFood-=5; const baby=spawnCritter(rng,c.faction,c.x,c.y,'worker');
            const theta=Math.atan2((c.vy||0.0001),(c.vx||0.0001)) + (Math.random()*0.8 - 0.4);
            startMitosis(baby,c.x,c.y,theta,now,22,0.8);
            c.x=clamp(c.x-Math.cos(theta)*9,10,W-10); c.y=clamp(c.y-Math.sin(theta)*9,10,H-10);
            toAdd.push(baby);
          }
          break;
        }
      }
    }

    // Fusión: 5 workers al rally → nido con vida
    for (const f of FACTIONS){
      const rally=ralliesNow[f.id]; if(!rally||!rally.active) continue;
      const totalWorkers=newCrits.filter(c=>c.faction===f.id&&c.role==='worker').length; if(totalWorkers<5) continue;
      const near = newCrits.filter(c=>c.faction===f.id&&c.role==='worker'&&dist(c,rally)<26).sort((a,b)=>dist(a,rally)-dist(b,rally));
      if(near.length>=5){
        const consumeIds=new Set(near.slice(0,5).map(c=>c.id)); newCrits=newCrits.filter(c=>!consumeIds.has(c.id));
        const pos = resolveNestPlacement(rally.x, rally.y, newNests);
        newNests.push({id:crypto.randomUUID(),faction:f.id,x:pos.x,y:pos.y,food:0,cumFood:0,level:0,hp:60,nextSpawnAt:now+10});
        delete ralliesNow[f.id];
      }
    }

    // Producción de nidos: 1 worker/10s y guerreros por cada 10 de FOOD disponible
    for (const n of newNests){
  // 1) worker pasivo cada 10s pero respetando CAP_WORKERS
  const curWorkers = newCrits.filter(u=>u.role==='worker' && u.homeNestId===n.id).length;
  if(now>=(n.nextSpawnAt??0)){
    n.nextSpawnAt=(n.nextSpawnAt??now)+10;
    if (curWorkers < CAP_WORKERS){
      const baby=spawnCritter(rng,n.faction,n.x,n.y,'worker');
      baby.homeNestId = n.id;
      const thetaN=Math.random()*Math.PI*2; startMitosis(baby,n.x,n.y,thetaN,now,18,0.6);
      toAdd.push(baby);
    }
  }

  // 2) warriors por cada 10 de FOOD (disponible), respetando CAP_WARRIORS
  let curW = countByRoleForNest(newCrits, n.id, 'warrior');
  while ((n.food||0) >= 10){
    if (curW >= CAP_WARRIORS) break;
    n.food -= 10;
    const w=spawnCritter(rng,n.faction,n.x,n.y,'warrior');
    w.homeNestId = n.id;
    const th=Math.random()*Math.PI*2; startMitosis(w,n.x,n.y,th,now,20,0.5);
    toAdd.push(w); curW++;
  }

  // 3) guardians por CUMULATIVE FOOD (20/40/60), hasta CAP_GUARDIANS
  n.guardiansSpawned = n.guardiansSpawned||0;
  const desiredByCum = Math.min(CAP_GUARDIANS, Math.floor((n.cumFood||0) / 20));
  while (n.guardiansSpawned < desiredByCum){
    const g=spawnCritter(rng,n.faction,n.x,n.y,'guardian');
    g.homeNestId = n.id;
    const th=Math.random()*Math.PI*2; startMitosis(g,n.x,n.y,th,now,16,0.5);
    toAdd.push(g);
    n.guardiansSpawned++;
  }

  // 4) Reina al alcanzar 150 cumFood (una sola vez)
  if (!n.queenSpawned && (n.cumFood||0) >= 150){
    const spawned = spawnQueenWithGuards(rng, n, now);
    for (const u of spawned) toAdd.push(u);
    n.queenSpawned = true;
  }
}


    // Daño de asedio del behemoth a nidos enemigos (1 HP/s)
    for (const c of newCrits){ if (c.role!=='behemoth') continue;
      for (const n of newNests){ if (n.faction===c.faction) continue;
        const rsum = (c.radius||14) + 12; if ((c.x-n.x)**2 + (c.y-n.y)**2 <= rsum*rsum){ n.hp = (n.hp??60) - 1*dt; }
      }
    }
    newNests = newNests.filter(n => (n.hp??60) > 0);

    if(toAdd.length) newCrits=newCrits.concat(toAdd);

    // Volcar estado
    setCritters(newCrits); setFood(newFood); setNests(newNests); setRallies(ralliesNow);

    // === DRAW ===
    ctx.clearRect(0,0,W,H); ctx.fillStyle="#0b1220"; ctx.fillRect(0,0,W,H);

    // Árbol
    ctx.beginPath(); ctx.arc(TREE.x,TREE.y,TREE.r,0,Math.PI*2); ctx.fillStyle="#22543d"; ctx.fill();

    // Nidos (color facción + anillo + HP bar + contador de food)
    for(const n of newNests){
      ctx.beginPath(); ctx.arc(n.x,n.y,12,0,Math.PI*2); ctx.fillStyle=FACTIONS[n.faction].color; ctx.fill();
      ctx.beginPath(); ctx.arc(n.x,n.y,16,0,Math.PI*2); ctx.strokeStyle=FACTIONS[n.faction].color; ctx.lineWidth=2; ctx.stroke();
      // HP bar del nido (60)
      const bw=30, bh=4, bx=n.x-bw/2, by=n.y+18;
      ctx.fillStyle="#1f2937"; ctx.fillRect(bx,by,bw,bh);
      ctx.fillStyle="#f87171"; ctx.fillRect(bx,by,bw*((n.hp??60)/60),bh);
      ctx.strokeStyle="rgba(255,255,255,0.25)"; ctx.lineWidth=1; ctx.strokeRect(bx,by,bw,bh);
      // food disponible
      ctx.fillStyle='rgba(255,255,255,0.7)'; ctx.font='10px sans-serif'; ctx.fillText(String(n.food||0), n.x-3, n.y+3);
    }

    // Rallies
    for(const fidStr in ralliesNow){ const r=ralliesNow[fidStr]; if(!r||!r.active) continue;
      ctx.beginPath(); ctx.arc(r.x,r.y,6,0,Math.PI*2); ctx.fillStyle="#60a5fa"; ctx.fill();
      ctx.beginPath(); ctx.arc(r.x,r.y,18,0,Math.PI*2); ctx.strokeStyle="#60a5fa"; ctx.setLineDash([4,4]); ctx.stroke(); ctx.setLineDash([]);
    }

    // Feromonas (nubecitas por facción)
    {
      const clouds = pheromonesRef.current || {};
      for (const key in clouds) {
        const cloud = clouds[key]; if (!cloud) continue;
        const fid = Number(key);
        ctx.beginPath();
        ctx.arc(cloud.x, cloud.y, 26, 0, Math.PI*2);
        ctx.fillStyle = FACTIONS[fid].color;
        ctx.globalAlpha = 0.12; ctx.fill(); ctx.globalAlpha = 1;

        ctx.beginPath();
        ctx.arc(cloud.x, cloud.y, 26, 0, Math.PI*2);
        ctx.setLineDash([6,6]);
        ctx.strokeStyle = FACTIONS[fid].color;
        ctx.lineWidth = 1; ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // Comida
    for(const f of newFood){ ctx.beginPath(); ctx.arc(f.x, f.y, 3, 0, Math.PI*2); ctx.fillStyle="#a7f3d0"; ctx.fill(); }

    // Critters
    for(const c of newCrits){
      // cordón mitosis
      if(c.mitosis){ const {x0,y0}=c.mitosis; ctx.beginPath(); ctx.moveTo(x0,y0); ctx.lineTo(c.x,c.y); ctx.strokeStyle=c.color; ctx.globalAlpha=0.35; ctx.stroke(); ctx.globalAlpha=1; }

      if(c.role==="warrior"){
        // cuerpo + pinches
        ctx.beginPath(); ctx.arc(c.x,c.y,c.radius,0,Math.PI*2); ctx.fillStyle=c.color; ctx.globalAlpha = clamp((c.hp||0)/(c.maxHp||12),0.2,1); ctx.fill(); ctx.globalAlpha=1;
        for(let k=0;k<8;k++){ const ang=(Math.PI*2*k)/8; const r1=c.radius+1, r2=c.radius+6; ctx.beginPath(); ctx.moveTo(c.x+Math.cos(ang)*r1,c.y+Math.sin(ang)*r1); ctx.lineTo(c.x+Math.cos(ang)*r2,c.y+Math.sin(ang)*r2); ctx.strokeStyle=c.color; ctx.lineWidth=1; ctx.stroke(); }
        if((c.stars||0)>0){ ctx.fillStyle='#fbbf24'; ctx.font='10px sans-serif'; ctx.fillText('✶'+String(c.stars), c.x-6, c.y-c.radius-10); }
      } else if (c.role==="guardian"){
        // cuerpo guardián + anillo de armadura
        ctx.beginPath(); ctx.arc(c.x,c.y,c.radius,0,Math.PI*2); ctx.fillStyle=c.color; ctx.globalAlpha = clamp((c.hp||0)/(c.maxHp||18),0.2,1); ctx.fill(); ctx.globalAlpha=1;
        ctx.beginPath(); ctx.arc(c.x,c.y,c.radius+2,0,Math.PI*2); ctx.strokeStyle="#9ca3af"; ctx.lineWidth=1.5; ctx.stroke();
      } else if (c.role==="queen"){
  // cuerpo
  ctx.beginPath(); ctx.arc(c.x,c.y,c.radius,0,Math.PI*2);
  ctx.fillStyle=c.color; ctx.globalAlpha = clamp((c.hp||0)/(c.maxHp||24),0.2,1); ctx.fill(); ctx.globalAlpha=1;
  // “corona” simple
  ctx.beginPath();
  ctx.moveTo(c.x-6, c.y-c.radius-2);
  ctx.lineTo(c.x-3, c.y-c.radius-7);
  ctx.lineTo(c.x,   c.y-c.radius-2);
  ctx.lineTo(c.x+3, c.y-c.radius-7);
  ctx.lineTo(c.x+6, c.y-c.radius-2);
  ctx.strokeStyle="#fbbf24"; ctx.lineWidth=1.5; ctx.stroke();
  // aura leve
  ctx.beginPath(); ctx.arc(c.x,c.y,c.radius+4,0,Math.PI*2);
  ctx.strokeStyle="rgba(251,191,36,0.4)"; ctx.setLineDash([3,3]); ctx.stroke(); ctx.setLineDash([]);
} else if (c.role==="qguard"){
  ctx.beginPath(); ctx.arc(c.x,c.y,c.radius,0,Math.PI*2);
  ctx.fillStyle=c.color; ctx.globalAlpha = clamp((c.hp||0)/(c.maxHp||24),0.2,1); ctx.fill(); ctx.globalAlpha=1;
  // anillo
  ctx.beginPath(); ctx.arc(c.x,c.y,c.radius+2,0,Math.PI*2);
  ctx.strokeStyle="rgba(255,255,255,0.35)"; ctx.lineWidth=1; ctx.stroke();
} else if (c.role==="cocoon"){
        // Cocoon: pulso que acelera
        const tLeft = Math.max(0, (c.evolveUntil||0) - now); const total = 20;
        const prog = clamp(1 - tLeft / Math.max(0.0001,total), 0, 1);
        const freq = 0.5 + 1.5*prog; const amp = 3 + 2*prog;
        const r = (c.radius||11) + Math.sin(now*2*Math.PI*freq)*amp;
        ctx.beginPath(); ctx.arc(c.x,c.y, clamp(r, 8, 18), 0, Math.PI*2); ctx.fillStyle=c.color; ctx.globalAlpha=0.85; ctx.fill(); ctx.globalAlpha=1;
        ctx.beginPath(); ctx.arc(c.x,c.y,(c.radius||11)+3,0,Math.PI*2); ctx.strokeStyle="#f59e0b"; ctx.setLineDash([3,3]); ctx.stroke(); ctx.setLineDash([]);
      } else if (c.role==="behemoth"){
        // Behemoth: tentáculos
        ctx.beginPath(); ctx.arc(c.x,c.y,c.radius,0,Math.PI*2); ctx.fillStyle=c.color; ctx.globalAlpha = clamp((c.hp||0)/(c.maxHp||120),0.2,1); ctx.fill(); ctx.globalAlpha=1;
        const arms = 6; const baseR = c.radius+2;
        for(let k=0;k<arms;k++){
          const ang = (Math.PI*2*k)/arms + Math.sin(now*0.8 + k)*0.2;
          const len = 10 + 4*Math.sin(now*1.1 + k);
          const ex = c.x + Math.cos(ang)*(baseR+len); const ey = c.y + Math.sin(ang)*(baseR+len);
          ctx.beginPath(); ctx.moveTo(c.x + Math.cos(ang)*baseR, c.y + Math.sin(ang)*baseR); ctx.lineTo(ex, ey);
          ctx.strokeStyle = c.color; ctx.lineWidth=2; ctx.stroke();
        }
      } else {
        // worker
        const alpha=clamp((c.hp??c.maxHp)/(c.maxHp||10),0.2,1); ctx.globalAlpha=alpha; ctx.beginPath(); ctx.arc(c.x,c.y,c.radius,0,Math.PI*2); ctx.fillStyle=c.color; ctx.fill(); ctx.globalAlpha=1;
      }

      // barra de vida + reforzado (solo guerreros con vida extra)
      const bw=16, bh=3, bx=c.x-bw/2, by=c.y-c.radius-6;
      ctx.fillStyle="#1f2937"; ctx.fillRect(bx,by,bw,bh);
      ctx.fillStyle="#10b981"; ctx.fillRect(bx,by,bw*((c.hp||0)/(c.maxHp||10)),bh);
         ctx.strokeStyle = "rgba(255,255,255,0.25)";
      ctx.lineWidth = 1;
      ctx.strokeRect(bx, by, bw, bh);
    } // ← cierra el for (const c of newCrits)
  }, running); // ← cierra useAnimationFrame con el segundo parámetro

  // === JSX: devolvemos el canvas centrado ===
  return (
    <div style={{ display: "grid", placeItems: "center", height: "100vh", background: "#0b1220" }}>
      <canvas ref={canvasRef} width={W} height={H} />
    </div>
  );
} // ← cierra function MicroLifeLite
