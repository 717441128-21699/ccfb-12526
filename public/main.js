// 自动生成的单文件 ESM（AudioWorklet 打包产物，勿手改）

const __mod0 = {};
(() => {
/**
 * 俯视图 Canvas 渲染器：世界坐标（米）↔ 屏幕像素变换、网格、房间多边形、
 * 遮挡墙、听者（含朝向锥）、声源点与移动路径、当前时间位置标记。
 * 纯绘制，不含交互状态机（交互在 EditorController）。
 */
class TopViewCanvas {
    canvas;
    ctx;
    scale = 28; // 像素/米
    offset = { x: 0, y: 0 };
    dpr = 1;
    constructor(canvas) {
        this.canvas = canvas;
        const ctx = canvas.getContext('2d');
        if (!ctx)
            throw new Error('无法获取 2D 上下文');
        this.ctx = ctx;
        this.dpr = window.devicePixelRatio || 1;
    }
    /** 以世界坐标原点为中心适配画布 */
    fitTo(project) {
        let maxX = 10;
        let maxY = 10;
        for (const r of project.rooms)
            for (const p of r.polygon) {
                maxX = Math.max(maxX, Math.abs(p.x));
                maxY = Math.max(maxY, Math.abs(p.y));
            }
        for (const s of project.sources)
            for (const k of s.keys) {
                maxX = Math.max(maxX, Math.abs(k.x));
                maxY = Math.max(maxY, Math.abs(k.y));
            }
        const w = this.canvas.clientWidth;
        const h = this.canvas.clientHeight;
        this.scale = Math.min(w, h) / ((maxX + maxY) * 1.4);
        this.offset = { x: w / 2, y: h / 2 };
    }
    worldToScreen(p) {
        // 屏幕 y 向下，世界 y 向上 → 取反
        return { x: p.x * this.scale + this.offset.x, y: -p.y * this.scale + this.offset.y };
    }
    screenToWorld(p) {
        return { x: (p.x - this.offset.x) / this.scale, y: -(p.y - this.offset.y) / this.scale };
    }
    zoom(factor, center) {
        const before = center ? this.screenToWorld(center) : { x: 0, y: 0 };
        this.scale = Math.max(6, Math.min(120, this.scale * factor));
        if (center) {
            const after = this.screenToWorld(center);
            this.offset.x += (after.x - before.x) * this.scale;
            this.offset.y -= (after.y - before.y) * this.scale;
        }
    }
    /** 屏幕像素增量平移视图 */
    panBy(dxScreen, dyScreen) {
        this.offset.x += dxScreen;
        this.offset.y += dyScreen;
    }
    get pixelPerMeter() {
        return this.scale;
    }
    resize() {
        const w = this.canvas.clientWidth;
        const h = this.canvas.clientHeight;
        this.canvas.width = Math.round(w * this.dpr);
        this.canvas.height = Math.round(h * this.dpr);
        this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    }
    draw(state) {
        const ctx = this.ctx;
        const w = this.canvas.clientWidth;
        const h = this.canvas.clientHeight;
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = '#0f1420';
        ctx.fillRect(0, 0, w, h);
        this.drawGrid(w, h);
        for (const room of state.project.rooms)
            this.drawRoom(room, state.currentRoomId === room.id);
        for (const oc of state.project.occluders)
            this.drawOccluder(oc);
        for (const s of state.project.sources)
            this.drawTrack(s, state);
        this.drawListener(state);
    }
    drawGrid(w, h) {
        const ctx = this.ctx;
        ctx.strokeStyle = '#1c2638';
        ctx.lineWidth = 1;
        const step = this.scale; // 1 米网格
        const startX = ((this.offset.x % step) + step) % step;
        const startY = ((this.offset.y % step) + step) % step;
        ctx.beginPath();
        for (let x = startX; x < w; x += step) {
            ctx.moveTo(x, 0);
            ctx.lineTo(x, h);
        }
        for (let y = startY; y < h; y += step) {
            ctx.moveTo(0, y);
            ctx.lineTo(w, y);
        }
        ctx.stroke();
        // 原点轴
        ctx.strokeStyle = '#2d3d57';
        ctx.beginPath();
        ctx.moveTo(this.offset.x, 0);
        ctx.lineTo(this.offset.x, h);
        ctx.moveTo(0, this.offset.y);
        ctx.lineTo(w, this.offset.y);
        ctx.stroke();
    }
    drawRoom(room, active) {
        if (room.polygon.length < 3)
            return;
        const ctx = this.ctx;
        ctx.beginPath();
        room.polygon.forEach((p, i) => {
            const s = this.worldToScreen(p);
            if (i === 0)
                ctx.moveTo(s.x, s.y);
            else
                ctx.lineTo(s.x, s.y);
        });
        ctx.closePath();
        ctx.fillStyle = room.kind === 'indoor' ? 'rgba(96,140,255,0.10)' : 'rgba(96,220,140,0.08)';
        ctx.fill();
        ctx.strokeStyle = active ? '#ffd166' : room.kind === 'indoor' ? '#5a82d6' : '#4fae7a';
        ctx.lineWidth = active ? 2.5 : 1.5;
        ctx.setLineDash(room.kind === 'outdoor' ? [6, 4] : []);
        ctx.stroke();
        ctx.setLineDash([]);
        const label = this.worldToScreen(room.polygon[0]);
        ctx.fillStyle = '#8aa0c0';
        ctx.font = '12px system-ui';
        ctx.fillText(`${room.name} (${room.kind === 'indoor' ? '室内' : '室外'})`, label.x + 4, label.y + 14);
    }
    drawOccluder(oc) {
        const ctx = this.ctx;
        const a = this.worldToScreen(oc.a);
        const b = this.worldToScreen(oc.b);
        ctx.strokeStyle =
            oc.material === 'heavy_wall' ? '#c0564f' : oc.material === 'wall' ? '#9a7b4f' : '#7a6a55';
        ctx.lineWidth = oc.material === 'heavy_wall' ? 6 : 4;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
    }
    drawTrack(track, state) {
        const ctx = this.ctx;
        const pts = track.keys.map((k) => this.worldToScreen(k));
        const selected = state.selectedId === track.id;
        // 路径
        if (pts.length > 1) {
            ctx.beginPath();
            pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
            ctx.strokeStyle = selected ? '#ffd166' : track.type === 'voice' ? '#6fa8ff' : '#7fd6a0';
            ctx.lineWidth = selected ? 2.5 : 1.5;
            ctx.setLineDash([4, 3]);
            ctx.stroke();
            ctx.setLineDash([]);
        }
        // 关键帧
        for (let i = 0; i < pts.length; i++) {
            const p = pts[i];
            const isCurrentKey = state.currentKeyIds.has(`${track.id}:${i}`);
            ctx.beginPath();
            ctx.arc(p.x, p.y, isCurrentKey ? 5 : 3.5, 0, Math.PI * 2);
            ctx.fillStyle = isCurrentKey ? '#ffd166' : selected ? '#ffe1a0' : '#9fb4d4';
            ctx.fill();
        }
        // 当前时间的源位置
        const cur = state.sourcePositions.get(track.id);
        if (cur) {
            const s = this.worldToScreen(cur);
            const muted = state.mutedIds.has(track.id);
            ctx.beginPath();
            ctx.arc(s.x, s.y, track.type === 'voice' ? 8 : 6, 0, Math.PI * 2);
            ctx.fillStyle = muted
                ? '#555'
                : selected
                    ? '#ffd166'
                    : track.type === 'voice'
                        ? '#4f8fe8'
                        : '#46b882';
            ctx.fill();
            ctx.strokeStyle = '#0f1420';
            ctx.lineWidth = 1.5;
            ctx.stroke();
            ctx.fillStyle = '#cfe0f5';
            ctx.font = '11px system-ui';
            ctx.fillText(track.name, s.x + 10, s.y + 3);
        }
    }
    drawListener(state) {
        const ctx = this.ctx;
        const s = this.worldToScreen(state.listener.pos);
        const yaw = ((state.listener.yaw ?? 0) * Math.PI) / 180;
        // 朝向锥（屏幕坐标 y 取反，角度也取反）
        const cone = 0.5;
        const len = 26;
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.arc(s.x, s.y, len, -yaw - cone, -yaw + cone);
        ctx.closePath();
        ctx.fillStyle = 'rgba(255,209,102,0.18)';
        ctx.fill();
        // 头部圆点 + 朝向线
        ctx.beginPath();
        ctx.arc(s.x, s.y, 9, 0, Math.PI * 2);
        ctx.fillStyle = '#ffd166';
        ctx.fill();
        ctx.strokeStyle = '#0f1420';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(s.x + Math.cos(-yaw) * 14, s.y + Math.sin(-yaw) * 14);
        ctx.strokeStyle = '#0f1420';
        ctx.lineWidth = 2.5;
        ctx.stroke();
        ctx.fillStyle = '#ffd166';
        ctx.font = 'bold 11px system-ui';
        ctx.fillText('听者', s.x + 12, s.y - 10);
    }
}

Object.assign(__mod0, { TopViewCanvas });
})();

const __mod1 = {};
(() => {
const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
const lerp = (a, b, u) => a + (b - a) * u;
/** 等功率交叉淡化曲线（余弦），u∈[0,1]，返回 [aGain, bGain]，平方和为 1 */
function equalPower(u) {
    const a = Math.cos(u * Math.PI * 0.5);
    const b = Math.sin(u * Math.PI * 0.5);
    return [a, b];
}
const dbToGain = (db) => Math.pow(10, db / 20);
const degToRad = (d) => (d * Math.PI) / 180;
const radToDeg = (r) => (r * 180) / Math.PI;
function smoothstep(edge0, edge1, x) {
    const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
}
/** 角度包装到 (-180, 180] */
function wrapDeg(a) {
    let r = ((a + 180) % 360 + 360) % 360 - 180;
    if (r === -180)
        r = 180;
    return r;
}
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
function sub(a, b) {
    return { x: a.x - b.x, y: a.y - b.y };
}
/**
 * 关键帧采样：分段线性。关键帧外按首尾值钳位（保证静止段）。
 * keys 必须按 t 升序。
 */
function sampleKeys(keys, t) {
    if (keys.length === 0)
        return { x: 0, y: 0, yaw: 0 };
    const first = keys[0];
    if (t <= first.t)
        return { x: first.x, y: first.y, yaw: first.yaw ?? 0 };
    const last = keys[keys.length - 1];
    if (t >= last.t)
        return { x: last.x, y: last.y, yaw: last.yaw ?? 0 };
    for (let i = 0; i < keys.length - 1; i++) {
        const a = keys[i];
        const b = keys[i + 1];
        if (t >= a.t && t <= b.t) {
            const u = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t);
            return {
                x: lerp(a.x, b.x, u),
                y: lerp(a.y, b.y, u),
                yaw: lerp(a.yaw ?? 0, b.yaw ?? 0, u),
            };
        }
    }
    return { x: last.x, y: last.y, yaw: last.yaw ?? 0 };
}
/**
 * 有游标的关键帧采样器：时间轴顺序访问时保持 O(1) 摊销。
 * 每个（听者/声源）采样器实例对应一条关键帧轨道，seek 后调用 reset()。
 */
class KeyframeSampler {
    keys;
    seg = 0;
    constructor(keys) {
        this.keys = keys;
    }
    reset(t) {
        this.seg = 0;
        // 二分定位到初始段，seek 后一次 O(log n)
        let lo = 0;
        let hi = this.keys.length - 1;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (this.keys[mid + 1].t <= t)
                lo = mid + 1;
            else
                hi = mid;
        }
        this.seg = Math.min(lo, Math.max(0, this.keys.length - 2));
    }
    sample(t) {
        const keys = this.keys;
        if (keys.length === 0)
            return { x: 0, y: 0, yaw: 0 };
        const first = keys[0];
        if (t <= first.t)
            return { x: first.x, y: first.y, yaw: first.yaw ?? 0 };
        const last = keys[keys.length - 1];
        if (t >= last.t)
            return { x: last.x, y: last.y, yaw: last.yaw ?? 0 };
        // 顺序推进游标（渲染中 t 单调递增，通常零次循环）
        while (this.seg < keys.length - 2 && t > keys[this.seg + 1].t)
            this.seg++;
        while (this.seg > 0 && t < keys[this.seg].t)
            this.seg--;
        const a = keys[this.seg];
        const b = keys[this.seg + 1];
        const u = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t);
        return { x: lerp(a.x, b.x, u), y: lerp(a.y, b.y, u), yaw: lerp(a.yaw ?? 0, b.yaw ?? 0, u) };
    }
}
/** 线段相交（含端点） */
function segmentsIntersect(p1, p2, p3, p4) {
    const d = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x);
    if (d === 0)
        return false;
    const u = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / d;
    const v = ((p3.x - p1.x) * (p2.y - p1.y) - (p3.y - p1.y) * (p2.x - p1.x)) / d;
    return u >= 0 && u <= 1 && v >= 0 && v <= 1;
}
/** 点到线段的最近点与距离 */
function pointSegmentDistance(p, a, b) {
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const lenSq = abx * abx + aby * aby;
    if (lenSq === 0)
        return dist(p, a);
    let u = ((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq;
    u = clamp(u, 0, 1);
    return Math.hypot(p.x - (a.x + abx * u), p.y - (a.y + aby * u));
}
/** 射线法判定点是否在多边形内 */
function pointInPolygon(p, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const pi = poly[i];
        const pj = poly[j];
        const intersect = pi.y > p.y !== pj.y > p.y &&
            p.x < ((pj.x - pi.x) * (p.y - pi.y)) / (pj.y - pi.y) + pi.x;
        if (intersect)
            inside = !inside;
    }
    return inside;
}

Object.assign(__mod1, { clamp, lerp, equalPower, dbToGain, degToRad, radToDeg, smoothstep, wrapDeg, dist, sub, sampleKeys, KeyframeSampler, segmentsIntersect, pointSegmentDistance, pointInPolygon });
})();

const __mod2 = {};
(() => {
const { sampleKeys, dist } = __mod1;
/**
 * 编辑器交互状态机。所有编辑直接作用于 project 对象（可变模型），
 * 通过 onChange 回调触发重绘与持久化；播放位置由外部 transport 驱动。
 */
class EditorController {
    project;
    canvas;
    drag = null;
    selectedId = null;
    /** 当前播放时间（秒），由 transport 更新 */
    currentTime = 0;
    onChange = () => { };
    constructor(project, canvas) {
        this.project = project;
        this.canvas = canvas;
        this.attach();
    }
    attach() {
        const el = this.canvasElement;
        el.addEventListener('pointerdown', (e) => this.onDown(e));
        el.addEventListener('pointermove', (e) => this.onMove(e));
        window.addEventListener('pointerup', () => (this.drag = null));
        el.addEventListener('wheel', (e) => {
            e.preventDefault();
            const rect = el.getBoundingClientRect();
            this.canvas.zoom(e.deltaY < 0 ? 1.12 : 0.89, {
                x: e.clientX - rect.left,
                y: e.clientY - rect.top,
            });
            this.onChange();
        }, { passive: false });
        el.addEventListener('dblclick', (e) => this.onDblClick(e));
    }
    get canvasElement() {
        return this.canvas.canvas;
    }
    eventWorld(e) {
        const rect = this.canvasElement.getBoundingClientRect();
        return this.canvas.screenToWorld({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    }
    onDown(e) {
        const w = this.eventWorld(e);
        if (e.button === 1 || e.shiftKey) {
            this.drag = { kind: 'pan', start: { x: e.clientX, y: e.clientY }, offset: { x: 0, y: 0 } };
            return;
        }
        // 优先命中听者
        const lp = sampleKeys(this.project.listenerKeys, this.currentTime);
        if (dist(w, { x: lp.x, y: lp.y }) < 0.6) {
            this.drag = { kind: 'listener' };
            return;
        }
        // 命中关键帧
        for (const tr of this.project.sources) {
            for (let i = 0; i < tr.keys.length; i++) {
                if (dist(w, tr.keys[i]) < 0.5) {
                    this.selectedId = tr.id;
                    this.drag = { kind: 'key', trackId: tr.id, index: i };
                    return;
                }
            }
        }
        // 命中声源当前位置
        for (const tr of this.project.sources) {
            const p = sampleKeys(tr.keys, this.currentTime);
            if (dist(w, { x: p.x, y: p.y }) < 0.7) {
                this.selectedId = tr.id;
                this.drag = { kind: 'source', trackId: tr.id };
                this.onChange();
                return;
            }
        }
        this.selectedId = null;
        this.onChange();
    }
    onMove(e) {
        const drag = this.drag;
        if (!drag)
            return;
        const w = this.eventWorld(e);
        switch (drag.kind) {
            case 'listener':
                this.moveListener(w, e);
                break;
            case 'source':
                this.moveSourceCurrent(drag.trackId, w);
                break;
            case 'key': {
                const tr = this.project.sources.find((t) => t.id === drag.trackId);
                if (!tr)
                    break;
                const k = tr.keys[drag.index];
                k.x = w.x;
                k.y = w.y;
                break;
            }
            case 'pan': {
                this.canvas.panBy(e.clientX - drag.start.x, e.clientY - drag.start.y);
                drag.start = { x: e.clientX, y: e.clientY };
                break;
            }
        }
        this.onChange();
    }
    /** 拖动听者：移动位置，Alt 拖动改朝向 */
    moveListener(w, e) {
        const keys = this.project.listenerKeys;
        if (e.altKey) {
            const cur = sampleKeys(keys, this.currentTime);
            const yaw = (Math.atan2(w.y - cur.y, w.x - cur.x) * 180) / Math.PI;
            this.upsertListenerKey({ t: this.currentTime, x: cur.x, y: cur.y, yaw });
        }
        else {
            const cur = sampleKeys(keys, this.currentTime);
            this.upsertListenerKey({ t: this.currentTime, x: w.x, y: w.y, yaw: cur.yaw });
        }
    }
    /** 拖动声源：在当前时间更新/插入关键帧（实时听到方位变化） */
    moveSourceCurrent(trackId, w) {
        const tr = this.project.sources.find((t) => t.id === trackId);
        if (!tr)
            return;
        const existing = tr.keys.find((k) => Math.abs(k.t - this.currentTime) < 0.08);
        if (existing) {
            existing.x = w.x;
            existing.y = w.y;
        }
        else {
            const kf = { t: this.currentTime, x: w.x, y: w.y };
            tr.keys.push(kf);
            tr.keys.sort((a, b) => a.t - b.t);
        }
    }
    upsertListenerKey(kf) {
        const keys = this.project.listenerKeys;
        const existing = keys.find((k) => Math.abs(k.t - kf.t) < 0.08);
        if (existing)
            Object.assign(existing, kf);
        else {
            keys.push(kf);
            keys.sort((a, b) => a.t - b.t);
        }
    }
    /** 双击空白：为选中轨在当前时间/位置加关键帧；双击关键帧删除 */
    onDblClick(e) {
        const w = this.eventWorld(e);
        if (!this.selectedId)
            return;
        const tr = this.project.sources.find((t) => t.id === this.selectedId);
        if (!tr)
            return;
        const idx = tr.keys.findIndex((k) => dist(w, k) < 0.5);
        if (idx >= 0 && tr.keys.length > 1) {
            tr.keys.splice(idx, 1);
        }
        else {
            tr.keys.push({ t: this.currentTime, x: w.x, y: w.y });
            tr.keys.sort((a, b) => a.t - b.t);
        }
        this.onChange();
    }
    setTime(t) {
        this.currentTime = t;
    }
    getSelectedTrack() {
        return this.project.sources.find((t) => t.id === this.selectedId) ?? null;
    }
}

Object.assign(__mod2, { EditorController });
})();

const __mod3 = {};
(() => {
/**
 * 实时音频引擎：AudioContext + AudioWorkletNode 封装。
 * 素材解码为单声道 Float32 后 transfer 给 worklet（零拷贝）。
 * 与离线渲染共用 BinauralRenderer，监听结果即导出结果。
 */
class AudioEngine {
    ctx = null;
    node = null;
    buffers = new Map();
    playheadCb = () => { };
    /** 解码用户选择的音频文件为单声道 PCM */
    async decodeFile(file, targetSampleRate) {
        const ctx = this.ensureContext();
        const arr = await file.arrayBuffer();
        const audio = await ctx.decodeAudioData(arr);
        if (audio.sampleRate !== targetSampleRate) {
            // 简单线性重采样到工程采样率
            const ratio = audio.sampleRate / targetSampleRate;
            const outLen = Math.floor(audio.length / ratio);
            const out = new Float32Array(outLen);
            const ch0 = audio.getChannelData(0);
            const ch1 = audio.numberOfChannels > 1 ? audio.getChannelData(1) : null;
            for (let i = 0; i < outLen; i++) {
                const pos = i * ratio;
                const i0 = Math.floor(pos);
                const frac = pos - i0;
                const a = (ch0[i0] ?? 0) + (ch1 ? ch1[i0] ?? 0 : 0);
                const b = (ch0[i0 + 1] ?? 0) + (ch1 ? ch1[i0 + 1] ?? 0 : 0);
                out[i] = (a + (b - a) * frac) / (ch1 ? 2 : 1);
            }
            return { data: out, sampleRate: targetSampleRate };
        }
        // 下混多声道
        const ch0 = audio.getChannelData(0);
        if (audio.numberOfChannels === 1)
            return { data: ch0.slice(), sampleRate: audio.sampleRate };
        const mixed = new Float32Array(audio.length);
        for (let c = 0; c < audio.numberOfChannels; c++) {
            const ch = audio.getChannelData(c);
            for (let i = 0; i < mixed.length; i++)
                mixed[i] += ch[i] / audio.numberOfChannels;
        }
        return { data: mixed, sampleRate: audio.sampleRate };
    }
    addBuffer(id, data, sampleRate) {
        this.buffers.set(id, { data, sampleRate });
    }
    ensureContext() {
        if (!this.ctx) {
            const Ctor = window.AudioContext ?? window.webkitAudioContext;
            this.ctx = new Ctor();
        }
        return this.ctx;
    }
    async load(project, workletUrl) {
        const ctx = this.ensureContext();
        if (!this.node) {
            await ctx.audioWorklet.addModule(workletUrl);
            this.node = new AudioWorkletNode(ctx, 'binaural-worklet', {
                numberOfInputs: 0,
                numberOfOutputs: 1,
                outputChannelCount: [2],
            });
            this.node.connect(ctx.destination);
            this.node.port.onmessage = (e) => {
                if (e.data?.type === 'playhead')
                    this.playheadCb(e.data.time);
            };
        }
        const buffers = [...this.buffers.entries()].map(([id, b]) => ({ id, data: b.data, sampleRate: b.sampleRate }));
        this.post({ type: 'load', project, buffers, startTime: 0 });
    }
    async resume() {
        await this.ensureContext().resume();
    }
    play() {
        this.post({ type: 'play' });
    }
    pause() {
        this.post({ type: 'pause' });
    }
    seek(time, playing) {
        this.post({ type: 'seek', time, playing });
    }
    setMuted(ids) {
        this.post({ type: 'setMuted', ids });
    }
    setSolo(id) {
        this.post({ type: 'setSolo', id });
    }
    get sampleRate() {
        return this.ensureContext().sampleRate;
    }
    post(msg) {
        this.node?.port.postMessage(msg);
    }
}

Object.assign(__mod3, { AudioEngine });
})();

const __mod4 = {};
(() => {
const { equalPower, pointInPolygon, KeyframeSampler } = __mod1;
const OUTDOOR_FALLBACK = {
    id: '__implicit_outdoor__',
    name: '室外（默认）',
    kind: 'outdoor',
    polygon: [],
    rt60: 0.18,
    roomSize: 30,
    levelDb: -26,
    hfDamping: 0.15,
    fadeSeconds: 1.2,
};
/**
 * 逐时间块采样工程：听者位姿、各声源位置/激活态、当前房间混响（含 A/B 交叉淡化）。
 * 关键帧查找使用游标采样器，顺序渲染时 O(1) 摊销；seek 后需调用 seek() 重置。
 */
class SceneSampler {
    project;
    roomA;
    roomB = null;
    fadePos = 1; // 0→1，1 表示淡化结束
    fadeDur = 1;
    listenerSampler;
    sourceSamplers = new Map();
    // 复用返回对象，避免逐子块分配
    listenerState = { pos: { x: 0, y: 0 }, yaw: 0, pitch: 0 };
    sampled;
    constructor(project) {
        this.project = project;
        this.roomA = project.rooms[0] ?? OUTDOOR_FALLBACK;
        this.listenerSampler = new KeyframeSampler(project.listenerKeys);
        for (const s of project.sources) {
            this.sourceSamplers.set(s.id, new KeyframeSampler(s.keys));
        }
        this.sampled = project.sources.map((track) => ({
            track,
            pos: { x: 0, y: 0 },
            active: false,
        }));
    }
    seek(t) {
        const mix = this.resolveRoomHard(t);
        this.roomA = mix;
        this.roomB = null;
        this.fadePos = 1;
        this.fadeDur = mix.fadeSeconds;
        this.listenerSampler.reset(t);
        for (const sm of this.sourceSamplers.values())
            sm.reset(t);
    }
    getListener(t) {
        const s = this.listenerSampler.sample(t);
        this.listenerState.pos.x = s.x;
        this.listenerState.pos.y = s.y;
        this.listenerState.yaw = s.yaw;
        this.listenerState.pitch = 0;
        return this.listenerState;
    }
    /** 返回内部复用数组，调用方不得跨调用持有 */
    getSources(t) {
        const out = this.sampled;
        for (let i = 0; i < out.length; i++) {
            const item = out[i];
            const track = item.track;
            item.active = t >= track.start && t < track.start + track.duration;
            const s = this.sourceSamplers.get(track.id).sample(t);
            item.pos.x = s.x;
            item.pos.y = s.y;
        }
        return out;
    }
    /** 当前房间混合；每渲染块调用一次以推进淡化 */
    getRoomMix(t, blockSeconds) {
        const target = this.resolveRoomHard(t);
        if (target.id !== this.roomA.id && (this.roomB === null || target.id !== this.roomB.id)) {
            // 开始新的交叉淡化
            this.roomB = this.roomA;
            this.roomA = target;
            this.fadePos = 0;
            this.fadeDur = Math.max(0.05, target.fadeSeconds);
        }
        if (this.fadePos < 1) {
            this.fadePos = Math.min(1, this.fadePos + blockSeconds / this.fadeDur);
            const [gB, gA] = equalPower(this.fadePos);
            return { roomA: this.roomA, gainA: gA, roomB: this.roomB, gainB: gB };
        }
        return { roomA: this.roomA, gainA: 1, roomB: null, gainB: 0 };
    }
    resolveRoomHard(t) {
        const auto = this.project.sceneAutomation;
        if (auto.length > 0) {
            let current = auto[0];
            for (const e of auto) {
                if (e.t <= t)
                    current = e;
            }
            return this.project.rooms.find((r) => r.id === current.roomId) ?? this.fallback(t);
        }
        return this.fallback(t);
    }
    fallback(t) {
        const l = this.getListener(t).pos;
        for (const room of this.project.rooms) {
            if (room.polygon.length >= 3 && pointInPolygon(l, room.polygon))
                return room;
        }
        return OUTDOOR_FALLBACK;
    }
}

Object.assign(__mod4, { SceneSampler });
})();

const __mod5 = {};
(() => {
const { TopViewCanvas } = __mod0;
const { EditorController } = __mod2;
const { AudioEngine } = __mod3;
const { SceneSampler } = __mod4;
/**
 * 编辑器主装配：Canvas 俯视图 + 时间轴 + 轨道表 + 传输控制 + 工程读写。
 * 播放循环用 requestAnimationFrame 驱动 SceneSampler 计算当前帧源位置，
 * 拖动声源时同一 project 实时下发，worklet 在下一音频块即听到方位变化。
 */
class EditorApp {
    project;
    ui;
    canvas;
    controller;
    engine = new AudioEngine();
    sampler;
    raf = 0;
    playing = false;
    lastPlayhead = 0;
    muted = new Set();
    workletUrl;
    constructor(project, canvasEl, ui, workletUrl) {
        this.project = project;
        this.ui = ui;
        this.workletUrl = workletUrl;
        this.canvas = new TopViewCanvas(canvasEl);
        this.canvas.resize();
        this.canvas.fitTo(project);
        this.controller = new EditorController(project, this.canvas);
        this.sampler = new SceneSampler(project);
        this.controller.onChange = () => this.render();
        this.engine.playheadCb = (t) => this.onPlayhead(t);
        this.bindTransport();
        this.buildTrackList();
        this.render();
        this.loop();
    }
    loop = () => {
        if (this.playing) {
            // 播放头由 worklet 回调驱动；这里仅保证画面刷新
            this.controller.setTime(this.lastPlayhead);
        }
        this.render();
        this.raf = requestAnimationFrame(this.loop);
    };
    onPlayhead(t) {
        this.lastPlayhead = t;
        if (t >= this.project.duration) {
            this.playing = false;
            this.engine.pause();
            this.ui.playBtn.textContent = '播放';
        }
        this.ui.timeInput.value = t.toFixed(2);
    }
    render() {
        const t = this.controller.currentTime;
        const listener = this.sampler.getListener(t);
        const sourcePositions = new Map();
        const currentKeyIds = new Set();
        for (const tr of this.project.sources) {
            const s = this.sampler.getSources(t).find((x) => x.track.id === tr.id);
            sourcePositions.set(tr.id, s.pos);
            tr.keys.forEach((k, i) => {
                if (Math.abs(k.t - t) < 0.12)
                    currentKeyIds.add(`${tr.id}:${i}`);
            });
        }
        const roomMix = this.sampler.getRoomMix(t, 0.05);
        const state = {
            project: this.project,
            listener: { pos: listener.pos, yaw: listener.yaw },
            sourcePositions,
            currentKeyIds,
            selectedId: this.controller.selectedId,
            mutedIds: this.muted,
            currentRoomId: roomMix.roomA.id,
        };
        this.canvas.draw(state);
    }
    bindTransport() {
        this.ui.playBtn.addEventListener('click', async () => {
            await this.engine.resume();
            this.playing = !this.playing;
            if (this.playing) {
                this.engine.play();
                this.ui.playBtn.textContent = '暂停';
            }
            else {
                this.engine.pause();
                this.ui.playBtn.textContent = '播放';
            }
        });
        this.ui.stopBtn.addEventListener('click', () => {
            this.playing = false;
            this.engine.seek(0, false);
            this.lastPlayhead = 0;
            this.controller.setTime(0);
            this.ui.playBtn.textContent = '播放';
        });
        this.ui.timeInput.addEventListener('change', () => {
            const t = Number(this.ui.timeInput.value) || 0;
            this.lastPlayhead = t;
            this.controller.setTime(t);
            this.engine.seek(t, this.playing);
        });
        this.ui.exportBtn.addEventListener('click', () => this.exportProject());
        this.ui.importAudioBtn.addEventListener('click', () => this.ui.audioFile.click());
        this.ui.audioFile.addEventListener('change', () => this.importAudio());
    }
    buildTrackList() {
        const list = this.ui.trackList;
        list.innerHTML = '';
        for (const tr of this.project.sources) {
            const row = document.createElement('div');
            row.className = 'track-row';
            row.dataset.id = tr.id;
            row.innerHTML = `
        <span class="dot" style="background:${tr.type === 'voice' ? '#4f8fe8' : '#46b882'}"></span>
        <span class="tname">${tr.name}</span>
        <button class="mute">${this.muted.has(tr.id) ? '🔇' : '🔊'}</button>
        <button class="solo">S</button>`;
            row.querySelector('.mute').addEventListener('click', () => {
                if (this.muted.has(tr.id))
                    this.muted.delete(tr.id);
                else
                    this.muted.add(tr.id);
                this.engine.setMuted([...this.muted]);
                this.buildTrackList();
                this.render();
            });
            row.addEventListener('click', () => {
                this.controller.selectedId = tr.id;
                this.render();
            });
            list.appendChild(row);
        }
    }
    async importAudio() {
        const file = this.ui.audioFile.files?.[0];
        if (!file)
            return;
        const decoded = await this.engine.decodeFile(file, this.project.sampleRate);
        const id = `clip_${Date.now()}`;
        this.engine.addBuffer(id, decoded.data, decoded.sampleRate);
        this.project.clips.push({
            id,
            name: file.name,
            url: file.name,
            sampleRate: decoded.sampleRate,
            frames: decoded.data.length,
            channels: 1,
        });
        this.ui.status.textContent = `已导入素材：${file.name}（${decoded.data.length} 帧）`;
    }
    exportProject() {
        const blob = new Blob([JSON.stringify(this.project, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${this.project.name}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
        this.ui.status.textContent = '工程 JSON 已导出；用 npm run render 离线渲染为 WAV';
    }
    /** 首次用户手势后加载 worklet（浏览器自动播放策略要求） */
    async startAudio() {
        await this.engine.resume();
        await this.engine.load(this.project, this.workletUrl);
    }
    get currentProject() {
        return this.project;
    }
    /** 外部（如 ResizeObserver）触发重绘 */
    redraw() {
        this.canvas.resize();
        this.render();
    }
}
/** 浏览器端创建一个示例工程（无素材时用于体验，素材为振荡器生成） */
function defaultProject(sampleRate) {
    return {
        version: 1,
        name: '广播剧双耳工程',
        sampleRate,
        duration: 60,
        listenerKeys: [{ t: 0, x: 0, y: 0, yaw: 90 }],
        sources: [],
        rooms: [
            {
                id: 'room_in',
                name: '室内',
                kind: 'indoor',
                polygon: [
                    { x: -6, y: -5 },
                    { x: 6, y: -5 },
                    { x: 6, y: 5 },
                    { x: -6, y: 5 },
                ],
                rt60: 0.6,
                roomSize: 8,
                levelDb: -16,
                hfDamping: 0.55,
                fadeSeconds: 1.5,
            },
        ],
        occluders: [
            { id: 'wall', a: { x: 3, y: -5 }, b: { x: 3, y: 5 }, material: 'wall' },
        ],
        clips: [],
        sceneAutomation: [],
    };
}

Object.assign(__mod5, { EditorApp, defaultProject });
})();

// ---- entry: D:\codex\runs\12526\workspace\dist\browser\main.js ----
const { EditorApp, defaultProject } = __mod5;
const canvas = document.getElementById('topview');
const app = new EditorApp(defaultProject(48000), canvas, {
    playBtn: document.getElementById('play'),
    stopBtn: document.getElementById('stop'),
    timeInput: document.getElementById('time'),
    trackList: document.getElementById('tracks'),
    exportBtn: document.getElementById('export'),
    importAudioBtn: document.getElementById('importAudio'),
    audioFile: document.getElementById('audioFile'),
    status: document.getElementById('status'),
}, './binaural-worklet.js');
document.getElementById('enableAudio').addEventListener('click', async () => {
    await app.startAudio();
    document.getElementById('enableAudio').disabled = true;
    document.getElementById('status').textContent = '实时双耳监听已启用（拖动声源可即时听到方位变化）';
});
// 窗口尺寸变化
new ResizeObserver(() => app.redraw()).observe(canvas);
