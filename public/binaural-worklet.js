// 自动生成的单文件 ESM（AudioWorklet 打包产物，勿手改）

const __mod0 = {};
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

Object.assign(__mod0, { clamp, lerp, equalPower, dbToGain, degToRad, radToDeg, smoothstep, wrapDeg, dist, sub, sampleKeys, KeyframeSampler, segmentsIntersect, pointSegmentDistance, pointInPolygon });
})();

const __mod1 = {};
(() => {
const { equalPower, pointInPolygon, KeyframeSampler } = __mod0;
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

Object.assign(__mod1, { SceneSampler });
})();

const __mod2 = {};
(() => {
const { degToRad, radToDeg, wrapDeg } = __mod0;
/**
 * 把世界坐标的源位置换算到听者头部坐标系。
 * 听者转头（yaw 变化）时所有声音方位随之旋转 —— 全部空间化都基于该相对量。
 */
function relativeSpatial(source, listener) {
    const dx = source.x - listener.pos.x;
    const dy = source.y - listener.pos.y;
    const distance = Math.hypot(dx, dy) || 1e-6;
    const worldAngle = radToDeg(Math.atan2(dy, dx));
    const azimuth = wrapDeg(worldAngle - listener.yaw);
    // 2D 俯视图没有高度；pitch 接口保留，未来加入 z 坐标后直接生效
    const elevation = -listener.pitch;
    return { distance, azimuth, elevation, rel: { x: dx, y: dy } };
}
/** 正弦余弦（角度入参），避免重复转换 */
function sinDeg(deg) {
    return Math.sin(degToRad(deg));
}
function cosDeg(deg) {
    return Math.cos(degToRad(deg));
}

Object.assign(__mod2, { relativeSpatial, sinDeg, cosDeg });
})();

const __mod3 = {};
(() => {
const { pointSegmentDistance, segmentsIntersect, smoothstep } = __mod0;
const MATERIAL_TABLE = {
    // 薄墙/木门：明显变闷但仍可懂
    thin_wall: { cutoff: 1800, lossDb: 8, weight: 0.7 },
    // 标准隔墙
    wall: { cutoff: 900, lossDb: 14, weight: 1 },
    // 承重墙/混凝土：高度闷塞
    heavy_wall: { cutoff: 420, lossDb: 22, weight: 1.4 },
};
const NO_OCCLUSION = { amount: 0, cutoff: 21000, lossDb: 0, wallCount: 0 };
/**
 * 检测源到听者连线上穿过的所有遮挡墙并合成等效滤波。
 * 连线与墙段相交即视为穿墙；同时考虑擦边（距离 < 0.15m）的半遮挡平滑。
 */
function evaluateOcclusion(source, listener, occluders) {
    let weightSum = 0;
    let lossDb = 0;
    let wallCount = 0;
    let cutoffLog = Math.log(21000);
    for (const oc of occluders) {
        const hit = segmentsIntersect(source, listener, oc.a, oc.b);
        const edge = pointSegmentDistance(listener, oc.a, oc.b);
        // 听者贴墙（0.3m 内）给一点平滑过渡，避免跨过墙线时音色突变
        const edgeFactor = hit ? 1 : 1 - smoothstep(0.05, 0.3, edge);
        if (!hit && edgeFactor <= 0)
            continue;
        const mat = MATERIAL_TABLE[oc.material];
        const w = mat.weight * edgeFactor;
        weightSum += w;
        lossDb += mat.lossDb * edgeFactor;
        cutoffLog += (Math.log(mat.cutoff) - Math.log(21000)) * edgeFactor;
        if (hit)
            wallCount++;
    }
    if (weightSum === 0)
        return NO_OCCLUSION;
    const amount = Math.min(1, weightSum / 1.4);
    return {
        amount,
        cutoff: Math.exp(cutoffLog),
        lossDb,
        wallCount,
    };
}

Object.assign(__mod3, { evaluateOcclusion });
})();

const __mod4 = {};
(() => {
/** 音频 DSP 基础元件：双二阶、一阶低通、分数延迟（均为逐块 in-place 友好实现） */
/** 音频 DSP 通用：非规格化浮点数冲刷阈值（FTZ/DAZ，避免 denormal 导致数量级减速） */
const DENORMAL_FLUSH = 1e-15;
class OnePoleLowpass {
    a1 = 0;
    b0 = 1;
    z1 = 0;
    cutoff = -1;
    /** 平滑设置截止频率，cutoff<=0 表示直通 */
    setCutoff(cutoff, sampleRate) {
        if (cutoff === this.cutoff)
            return;
        this.cutoff = cutoff;
        if (cutoff <= 0 || cutoff >= sampleRate * 0.499) {
            this.a1 = 0;
            this.b0 = 1;
            return;
        }
        const x = Math.exp((-2 * Math.PI * cutoff) / sampleRate);
        this.a1 = x;
        this.b0 = 1 - x;
    }
    processBlock(inp, out, n) {
        let z = this.z1;
        const b0 = this.b0;
        const a1 = this.a1;
        for (let i = 0; i < n; i++) {
            z = b0 * inp[i] + a1 * z;
            if (Math.abs(z) < DENORMAL_FLUSH)
                z = 0;
            out[i] = z;
        }
        this.z1 = z;
    }
    reset() {
        this.z1 = 0;
    }
}
/** RBJ Cookbook 双二阶，当前使用 lowpass / highpass */
class Biquad {
    b0 = 1;
    b1 = 0;
    b2 = 0;
    a1 = 0;
    a2 = 0;
    x1 = 0;
    x2 = 0;
    y1 = 0;
    y2 = 0;
    lowpass(fc, sampleRate, q = 0.707) {
        const w = (2 * Math.PI * fc) / sampleRate;
        const cosw = Math.cos(w);
        const alpha = Math.sin(w) / (2 * q);
        const a0 = 1 + alpha;
        this.b0 = (1 - cosw) / 2 / a0;
        this.b1 = (1 - cosw) / a0;
        this.b2 = this.b0;
        this.a1 = (-2 * cosw) / a0;
        this.a2 = (1 - alpha) / a0;
    }
    highpass(fc, sampleRate, q = 0.707) {
        const w = (2 * Math.PI * fc) / sampleRate;
        const cosw = Math.cos(w);
        const alpha = Math.sin(w) / (2 * q);
        const a0 = 1 + alpha;
        this.b0 = (1 + cosw) / 2 / a0;
        this.b1 = -(1 + cosw) / a0;
        this.b2 = this.b0;
        this.a1 = (-2 * cosw) / a0;
        this.a2 = (1 - alpha) / a0;
    }
    processBlock(inp, out, n) {
        let x1 = this.x1;
        let x2 = this.x2;
        let y1 = this.y1;
        let y2 = this.y2;
        const { b0, b1, b2, a1, a2 } = this;
        for (let i = 0; i < n; i++) {
            const x = inp[i];
            let y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
            if (Math.abs(y) < DENORMAL_FLUSH)
                y = 0;
            x2 = x1;
            x1 = x;
            y2 = y1;
            y1 = y;
            out[i] = y;
        }
        this.x1 = x1;
        this.x2 = x2;
        this.y1 = y1;
        this.y2 = y2;
    }
    reset() {
        this.x1 = this.x2 = this.y1 = this.y2 = 0;
    }
}
/**
 * 分数延迟线（三次拉格朗日插值）。
 * 用于 ITD（亚采样精度）与耳廓反射延迟。
 * 容量取 2 的幂，索引使用位掩码 —— 热路径零取模运算。
 */
class FractionalDelay {
    buf;
    mask;
    idx = 0;
    constructor(maxDelaySamples) {
        // 三次插值需要回看 3 个样本，额外余量；容量向上取整到 2 的幂
        const need = Math.max(8, Math.ceil(maxDelaySamples) + 4);
        let cap = 8;
        while (cap < need)
            cap <<= 1;
        this.buf = new Float32Array(cap);
        this.mask = cap - 1;
    }
    reset() {
        this.buf.fill(0);
        this.idx = 0;
    }
    /** 写入一个样本 */
    push(x) {
        this.buf[this.idx] = x;
        this.idx = (this.idx + 1) & this.mask;
    }
    /**
     * 读取延迟 d 个样本前的值（d>=2，含分数部分）。
     * 读取不改变写指针，可在同一块中对同一条延迟线多次取不同延迟。
     */
    read(d) {
        const buf = this.buf;
        const mask = this.mask;
        const fl = Math.floor(d);
        const base = this.idx - 1 - fl;
        const f = d - fl;
        const x0 = buf[(base + 1) & mask];
        const x1 = buf[base & mask];
        const x2 = buf[(base - 1) & mask];
        const x3 = buf[(base - 2) & mask];
        // 三次拉格朗日（Horner 形式，减少乘法）
        return (x1 +
            0.5 * f * (x2 - x0 + f * (2 * x0 - 5 * x1 + 4 * x2 - x3 + f * (3 * (x1 - x2) + x3 - x0))));
    }
}
/** 块级分数延迟：先整块写入，再按固定延迟整块读出 */
class BlockFractionalDelay {
    line;
    block;
    constructor(maxDelaySamples, blockSize) {
        this.line = new FractionalDelay(maxDelaySamples);
        this.block = new Float32Array(blockSize);
    }
    reset() {
        this.line.reset();
    }
    process(inp, out, n, delaySamples) {
        const b = this.block;
        for (let i = 0; i < n; i++) {
            this.line.push(inp[i]);
            b[i] = this.line.read(delaySamples);
        }
        out.set(b.subarray(0, n));
    }
}

Object.assign(__mod4, { DENORMAL_FLUSH, OnePoleLowpass, Biquad, FractionalDelay, BlockFractionalDelay });
})();

const __mod5 = {};
(() => {
const { FractionalDelay } = __mod4;
const { dbToGain } = __mod0;
/**
 * 单房间混响引擎（单声道入，双耳出）。
 * 结构：预延迟 → 6 抽头早期反射（短延时，带左右耳差，保留空间方位感）
 *            → 8 线 Hadamard FDN 晚期混响（每线独立吸收低通，频率相关衰减）
 *
 * 室内：RT60 0.4–1.2s，反射密；室外：RT60 很短、湿声电平极低，仅留一点早期反射。
 * 场景切换不在本类内部处理 —— 渲染器同时持有 A/B 两个引擎做等功率交叉淡化，
 * 旧房间的混响尾巴在淡化期间自然衰减完毕。
 *
 * 性能约定：延迟线容量均为 2 的幂（位掩码索引）；所有每块恒定的延迟/系数
 * 在 process() 入口预计算一次；低通状态内联，热路径零函数调用。
 */
const FDN_ORDER = 8;
const BASE_DELAYS = [29.7, 37.1, 41.9, 46.3, 53.1, 59.9, 67.3, 73.9]; // 毫秒，互质分布
const EARLY_TAPS = [7.2, 11.9, 17.3, 23.1, 29.7, 38.4]; // 毫秒
const EARLY_GAINS = [0.55, 0.45, 0.38, 0.3, 0.24, 0.18];
const EARLY_LR_SHIFT = [0.0011, -0.0009, 0.0007, -0.0006, 0.0005, -0.0004]; // 双耳时间差（秒）
function hadamard8(x) {
    // 原地 8 阶 Hadamard，H8 正交，1/sqrt(8) 归一化
    for (let len = 1; len < 8; len *= 2) {
        for (let i = 0; i < 8; i += len * 2) {
            for (let j = 0; j < len; j++) {
                const a = x[i + j];
                const b = x[i + j + len];
                x[i + j] = a + b;
                x[i + j + len] = a - b;
            }
        }
    }
    const k = 1 / Math.sqrt(8);
    for (let i = 0; i < 8; i++)
        x[i] *= k;
}
class RoomEngine {
    sampleRate;
    wetGain = 0;
    earlyGain = 0;
    predelay;
    earlyL;
    earlyR;
    lineDelay = [];
    // 每线低通的内联状态与系数
    lineZ = new Float32Array(FDN_ORDER);
    lineA1 = new Float32Array(FDN_ORDER);
    lineB0 = new Float32Array(FDN_ORDER);
    feedback = new Float32Array(FDN_ORDER);
    m = new Float32Array(FDN_ORDER);
    current;
    constructor(room, sampleRate) {
        this.sampleRate = sampleRate;
        this.current = room;
        this.predelay = new FractionalDelay(Math.ceil(0.14 * sampleRate) + 4);
        this.earlyL = new FractionalDelay(Math.ceil(0.06 * sampleRate) + 4);
        this.earlyR = new FractionalDelay(Math.ceil(0.06 * sampleRate) + 4);
        for (let i = 0; i < FDN_ORDER; i++) {
            this.lineDelay.push(new FractionalDelay(Math.ceil(0.12 * sampleRate) + 4));
        }
        this.setRoom(room);
    }
    setRoom(room) {
        this.current = room;
        this.wetGain = dbToGain(room.levelDb);
        this.earlyGain = room.kind === 'outdoor' ? 0.25 : 0.9;
        const sr = this.sampleRate;
        for (let i = 0; i < FDN_ORDER; i++) {
            // 反馈系数由 RT60 与该线延时反推：g = 0.001^(delay/RT60)
            const delaySec = (BASE_DELAYS[i] / 1000) * (room.roomSize / 12);
            const g = Math.pow(0.001, delaySec / Math.max(0.05, room.rt60));
            this.feedback[i] = Math.min(0.95, g);
            // 高频阻尼：阻尼越强截止越低，奇数线略错开，避免染色
            const spread = 0.85 + 0.15 * (i % 2);
            const fc = (300 + 9000 * (1 - room.hfDamping)) * spread;
            const x = Math.exp((-2 * Math.PI * Math.min(fc, sr * 0.45)) / sr);
            this.lineA1[i] = x;
            this.lineB0[i] = 1 - x;
        }
    }
    get room() {
        return this.current;
    }
    /**
     * @param inMono 本块各声源汇入房间的单声道总线（已含 send 比例与墙损耗）
     * @param outL/outR 累加输出（不清零，与干声及另一房间叠加）
     */
    process(inMono, outL, outR, n) {
        const sr = this.sampleRate;
        const room = this.current;
        // ---- 每块恒定参数，入口预计算一次 ----
        const preD = 2 + Math.max(0.001, room.roomSize * 0.0008) * sr;
        const sizeScale = room.roomSize / 12;
        const earlyDL = EARLY_TAPS.map((ms, k) => {
            const shift = EARLY_LR_SHIFT[k] * sr;
            return 2 + (ms / 1000) * sizeScale * sr + Math.max(0, shift);
        });
        const earlyDR = EARLY_TAPS.map((ms, k) => {
            const shift = EARLY_LR_SHIFT[k] * sr;
            return 2 + (ms / 1000) * sizeScale * sr + Math.max(0, -shift);
        });
        const fdnD = BASE_DELAYS.map((ms) => 2 + (ms / 1000) * sizeScale * sr);
        const wet = this.wetGain;
        const eGain = this.earlyGain;
        const eg = EARLY_GAINS.map((g) => g * eGain);
        const pre = this.predelay;
        const eLineL = this.earlyL;
        const eLineR = this.earlyR;
        const lines = this.lineDelay;
        const m = this.m;
        const fb = this.feedback;
        const a1 = this.lineA1;
        const b0 = this.lineB0;
        const z = this.lineZ;
        for (let i = 0; i < n; i++) {
            const x = inMono[i];
            pre.push(x);
            const pv = pre.read(preD);
            // ---- 早期反射（双耳时间差制造空间宽度）----
            eLineL.push(pv);
            eLineR.push(pv);
            let eL = 0;
            let eR = 0;
            for (let k = 0; k < 6; k++) {
                eL += eg[k] * eLineL.read(earlyDL[k]);
                eR += eg[k] * eLineR.read(earlyDR[k]);
            }
            // ---- FDN 晚期混响（低通状态内联）----
            for (let j = 0; j < FDN_ORDER; j++)
                m[j] = lines[j].read(fdnD[j]);
            hadamard8(m);
            let wetSum = 0;
            for (let j = 0; j < FDN_ORDER; j++) {
                const v = m[j];
                let lp = b0[j] * v + a1[j] * z[j];
                if (Math.abs(lp) < 1e-15)
                    lp = 0; // FTZ
                z[j] = lp;
                let fed = lp * fb[j] + pv * 0.19;
                if (Math.abs(fed) < 1e-15)
                    fed = 0;
                lines[j].push(fed);
                wetSum += v;
            }
            outL[i] += wet * (eL + 0.32 * wetSum);
            outR[i] += wet * (eR + 0.32 * wetSum);
        }
    }
    reset() {
        this.predelay.reset();
        this.earlyL.reset();
        this.earlyR.reset();
        for (const d of this.lineDelay)
            d.reset();
        this.lineZ.fill(0);
    }
}

Object.assign(__mod5, { RoomEngine });
})();

const __mod6 = {};
(() => {
const { BlockFractionalDelay, FractionalDelay, OnePoleLowpass } = __mod4;
const { sinDeg } = __mod2;
const { clamp, degToRad } = __mod0;
/**
 * 参数化 HRTF（每耳独立），提供四类空间线索：
 *  1. ITD 双耳时间差（Woodworth 球面模型 + 近场修正）—— 左右定位主线索
 *  2. 头部声影 ILD：远耳低通衰减（对侧耳高频被头挡住）
 *  3. 耳廓反射陷波：延迟与增益随仰角/前后变化 —— 前后判别主线索
 *  4. 近场增益：极近距离的逐耳距离差带来的响度差
 *
 * 这是一个轻量合成模型（无需外部 SOFA/HRIR 数据），接口设计上可与
 * MeasuredHrtf（分块卷积实测 HRIR）互换。
 */
const HEAD_RADIUS = 0.0875; // 米，成人头等效半径
const SPEED_OF_SOUND = 343;
const MIN_DELAY = 2; // 分数延迟线最小可读延迟（插值要求）
class EarChannel {
    itd;
    shadow;
    pinnaLine;
    pinnaDelaySamples = MIN_DELAY;
    pinnaGain = 0.12;
    nearGain = 1;
    constructor(sampleRate, blockSize) {
        const maxItd = Math.ceil(((2 * HEAD_RADIUS) / SPEED_OF_SOUND) * sampleRate) + 4;
        this.itd = new BlockFractionalDelay(maxItd, blockSize);
        this.shadow = new OnePoleLowpass();
        // 耳廓反射延迟 0.05–0.4ms
        this.pinnaLine = new FractionalDelay(Math.ceil(0.00045 * sampleRate) + 4);
    }
    /**
     * @param side       -1 左耳 / +1 右耳
     * @param lateral    该耳相对声源的侧向系数（对侧=+1 声影最重，同侧=-1）
     * @param backFactor 0=正前 1=正后
     */
    update(p, side, lateral, backFactor, sinAz, cosAz, sampleRate) {
        const absAz = Math.abs(degToRad(p.azimuth));
        // ---- ITD：Woodworth 全量双耳时间差 + 近场分量 ----
        // 同侧耳取最小基准延迟，对侧耳在其基础上增加完整 ITD，保证双耳相对差即物理 ITD
        const farField = (HEAD_RADIUS / SPEED_OF_SOUND) * (absAz + Math.sin(absAz));
        const nearFactor = clamp(HEAD_RADIUS / Math.max(p.distance, HEAD_RADIUS), 0, 1);
        const itdSeconds = farField * (1 + 0.35 * nearFactor * Math.sin(absAz));
        // lateral: 该耳处于对侧(=1)时承担全部 ITD；同侧(=0)为基准
        const delay = MIN_DELAY + lateral * itdSeconds * sampleRate;
        this.itdDelay = delay;
        // ---- 头部声影：对侧耳低通 ----
        const shadowWeight = clamp(lateral, 0, 1);
        const cutoff = 21000 - 17500 * shadowWeight; // 同侧 21k 直通，对侧 ~3.5k
        this.shadow.setCutoff(cutoff, sampleRate);
        // ---- 耳廓反射：后方反射路径更长、陷波更深 ----
        const pinnaSeconds = 0.0001 + 0.00018 * (backFactor + 0.5 * Math.max(0, sinDeg(p.elevation)));
        this.pinnaDelaySamples = MIN_DELAY + pinnaSeconds * sampleRate;
        this.pinnaGain = 0.1 + 0.22 * backFactor - 0.05 * Math.abs(degToRad(p.elevation));
        // 预计算三次插值权重（分数部分在整个子块内不变）
        const pd = this.pinnaDelaySamples;
        this.pinnaIntDelay = Math.floor(pd);
        const f = pd - this.pinnaIntDelay;
        this.pinnaW0 = 0.5 * f * (-1 + f * (2 - f));
        this.pinnaW1 = 1 + 0.5 * f * f * (-5 + f * (3 + 2 * f));
        this.pinnaW2 = 0.5 * f * (2 + f * (4 - 3 * f));
        this.pinnaW3 = 0.5 * f * f * (-1 + f);
        // ---- 近场逐耳距离差（复用已算好的 sin/cos）----
        const earOffset = HEAD_RADIUS * side * sinAz * 1;
        const earDist = Math.max(0.05, p.distance - earOffset);
        this.nearGain = clamp(p.distance / earDist, 0.85, 1.18);
        void cosAz;
    }
    itdDelay = MIN_DELAY;
    pinnaW0 = 0;
    pinnaW1 = 0;
    pinnaW2 = 0;
    pinnaW3 = 0;
    pinnaIntDelay = 0;
    process(inp, out, n) {
        this.itd.process(inp, out, n, this.itdDelay);
        this.shadow.processBlock(out, out, n);
        const pg = this.pinnaGain;
        const line = this.pinnaLine;
        const ng = this.nearGain;
        // 延迟在块内恒定：插值权重预算一次，热循环只做 4 次位掩码取数
        const w0 = this.pinnaW0;
        const w1 = this.pinnaW1;
        const w2 = this.pinnaW2;
        const w3 = this.pinnaW3;
        const intD = this.pinnaIntDelay;
        const mask = line.mask;
        const buf = line.buf;
        let idx = line.idx;
        for (let i = 0; i < n; i++) {
            const x = out[i];
            buf[idx] = x;
            idx = (idx + 1) & mask;
            const base = idx - 1 - intD;
            const delayed = buf[(base + 1) & mask] * w0 +
                buf[base & mask] * w1 +
                buf[(base - 1) & mask] * w2 +
                buf[(base - 2) & mask] * w3;
            // 直达 + 延迟反射相消形成陷波（前后/仰角着色）
            out[i] = ng * (x - pg * delayed);
        }
        line.idx = idx;
    }
    reset() {
        this.itd.reset();
        this.shadow.reset();
        this.pinnaLine.reset();
    }
}
class ParametricHrtf {
    left;
    right;
    constructor(sampleRate, blockSize) {
        this.left = new EarChannel(sampleRate, blockSize);
        this.right = new EarChannel(sampleRate, blockSize);
    }
    update(p, sampleRate) {
        const azRad = degToRad(p.azimuth);
        const sinAz = Math.sin(azRad);
        const cosAz = Math.cos(azRad);
        const back = clamp((1 - cosAz) / 2, 0, 1); // 正前 0 → 正后 1
        // 左耳对侧程度：声源在右侧(sinAz>0)时左耳进入声影
        this.left.update(p, -1, clamp(sinAz, 0, 1), back, sinAz, cosAz, sampleRate);
        this.right.update(p, 1, clamp(-sinAz, 0, 1), back, sinAz, cosAz, sampleRate);
    }
    process(inp, outL, outR, n) {
        this.left.process(inp, outL, n);
        this.right.process(inp, outR, n);
    }
    reset() {
        this.left.reset();
        this.right.reset();
    }
}

Object.assign(__mod6, { ParametricHrtf });
})();

const __mod7 = {};
(() => {
const { ParametricHrtf } = __mod6;
const { dbToGain, smoothstep } = __mod0;
const makePole = () => ({ b0: 1, a1: 0, z: 0 });
function setCutoff(p, fc, sampleRate) {
    if (fc <= 0 || fc >= sampleRate * 0.499) {
        p.b0 = 1;
        p.a1 = 0;
        return;
    }
    const x = Math.exp((-2 * Math.PI * fc) / sampleRate);
    p.a1 = x;
    p.b0 = 1 - x;
}
/**
 * 单个声源的完整处理链（每轨一个实例）：
 *   素材 → 基础增益 → 指向性（背对听者掉高频）→ 穿墙低通/衰减
 *        → 距离增益 + 空气吸声 → 参数化 HRTF → 左右耳累加
 *   另取一路经墙损耗后的信号作为房间发送（远声混响占比更高）。
 * 增益/滤波在同一个热循环内融合完成，每子块仅三遍（融合级联、双耳×2）。
 */
class SourceProcessor {
    track;
    hrtf;
    dirPole = makePole();
    occPole = makePole();
    airPole = makePole();
    baseGain;
    gainSmoothed = 0;
    sampleRate;
    postScratch;
    outL;
    outR;
    constructor(track, sampleRate, subBlock) {
        this.track = track;
        this.sampleRate = sampleRate;
        this.baseGain = dbToGain(track.gainDb);
        this.hrtf = new ParametricHrtf(sampleRate, subBlock);
        this.postScratch = new Float32Array(subBlock);
        this.outL = new Float32Array(subBlock);
        this.outR = new Float32Array(subBlock);
    }
    reset() {
        this.hrtf.reset();
        this.dirPole = makePole();
        this.occPole = makePole();
        this.airPole = makePole();
        this.gainSmoothed = 0;
    }
    /**
     * 尾部门控：源已停止，但房间混响尾巴还需自然衰减。
     * 只跑融合滤波 + 房间发送（输入静音），跳过 HRTF 干声；
     * 电平衰减到听阈以下后由渲染器彻底跳过。
     * @returns 当前尾音电平（用于调用方决定何时彻底关闭）
     */
    processTail(n, roomBus, roomOffset) {
        const dp = this.dirPole;
        const op = this.occPole;
        const ap = this.airPole;
        let zDir = dp.z;
        let zOcc = op.z;
        let zAir = ap.z;
        let peak = 0;
        for (let i = 0; i < n; i++) {
            zDir = dp.a1 * zDir;
            zOcc = op.a1 * zOcc;
            zAir = ap.a1 * zAir;
            if (Math.abs(zAir) < 1e-15) {
                zDir = 0;
                zOcc = 0;
                zAir = 0;
            }
            const v = zAir;
            roomBus[roomOffset + i] += v * 0.32;
            const a = v < 0 ? -v : v;
            if (a > peak)
                peak = a;
        }
        dp.z = zDir;
        op.z = zOcc;
        ap.z = zAir;
        return peak;
    }
    process(n, readMono, spatial, occlusion, facingCos, mixL, mixR, mixOffset, roomBus, roomOffset) {
        const sr = this.sampleRate;
        const tr = this.track;
        const post = this.postScratch;
        readMono(post, n);
        // ---- 距离模型：反距离衰减 + 最大距离淡出 ----
        const d = Math.max(spatial.distance, tr.minDistance);
        let distanceGain = tr.minDistance / d;
        const fadeZone = Math.max(0.5, tr.maxDistance * 0.15);
        const farFade = 1 - smoothstep(tr.maxDistance - fadeZone, tr.maxDistance, spatial.distance);
        distanceGain *= farFade;
        // ---- 空气吸声：高频随距离滚动衰减 ----
        const airCutoff = Math.min(21000, 16000 * Math.exp(-0.045 * Math.max(0, d - 1)));
        setCutoff(this.airPole, airCutoff, sr);
        // ---- 语音指向性：背对听者高频衰减 ----
        let dirCutoff = 21000;
        if (tr.type === 'voice' && tr.directivity > 0) {
            const away = smoothstep(-0.2, -1, facingCos); // 背对比例 0..1
            dirCutoff = 21000 - tr.directivity * away * 15500;
        }
        setCutoff(this.dirPole, dirCutoff, sr);
        // ---- 穿墙：等效低通 + 电平损耗 ----
        setCutoff(this.occPole, occlusion.cutoff, sr);
        const occlusionGain = dbToGain(-occlusion.lossDb);
        // 目标总增益，做块间平滑（淡入淡出与移动都不会爆音）
        const targetGain = this.baseGain * distanceGain * occlusionGain;
        this.gainSmoothed += (targetGain - this.gainSmoothed) * 0.12;
        // ---- 单遍融合：增益 → 三个一阶低通级联 ----
        const g = this.gainSmoothed;
        const dp = this.dirPole;
        const op = this.occPole;
        const ap = this.airPole;
        let zDir = dp.z;
        let zOcc = op.z;
        let zAir = ap.z;
        const sendFactor = 0.16 + 0.5 * smoothstep(1, tr.maxDistance, spatial.distance);
        for (let i = 0; i < n; i++) {
            const x0 = post[i] * g;
            zDir = dp.b0 * x0 + dp.a1 * zDir;
            zOcc = op.b0 * zDir + op.a1 * zOcc;
            zAir = ap.b0 * zOcc + ap.a1 * zAir;
            // FTZ：防止长时静音/弱信号下 IIR 状态落入 denormal 区
            if (Math.abs(zAir) < 1e-15) {
                zDir = 0;
                zOcc = 0;
                zAir = 0;
            }
            post[i] = zAir;
            roomBus[roomOffset + i] += zAir * sendFactor;
        }
        dp.z = zDir;
        op.z = zOcc;
        ap.z = zAir;
        // ---- HRTF 双耳渲染 ----
        const hp = {
            azimuth: spatial.azimuth,
            elevation: spatial.elevation,
            distance: spatial.distance,
        };
        this.hrtf.update(hp, sr);
        const oL = this.outL;
        const oR = this.outR;
        this.hrtf.process(post, oL, oR, n);
        for (let i = 0; i < n; i++) {
            mixL[mixOffset + i] += oL[i];
            mixR[mixOffset + i] += oR[i];
        }
    }
}

Object.assign(__mod7, { SourceProcessor });
})();

const __mod8 = {};
(() => {
const { SceneSampler } = __mod1;
const { relativeSpatial } = __mod2;
const { evaluateOcclusion } = __mod3;
const { clamp } = __mod0;
const { RoomEngine } = __mod5;
const { SourceProcessor } = __mod7;
const SUB_BLOCK = 64;
const TAIL_THRESHOLD = 1e-6;
/**
 * 双耳渲染器（离线与 AudioWorklet 实时共用）。
 * 渲染粒度为块（blockSize，须为 subBlock 的整数倍），块内逐 subBlock 更新
 * 几何/HRTF/滤波器系数。离线用 64（约 1.3ms 空间分辨率），实时端可传 128。
 * 调用方按时间顺序喂块；跳转时间轴必须 seek()。
 */
class BinauralRenderer {
    sampleRate;
    project;
    sampler;
    processors = new Map();
    sources = new Map();
    roomA;
    roomB = null;
    blockSize;
    subBlock;
    subBlocks;
    roomBusA;
    roomBusB;
    wetL;
    wetR;
    blockL;
    blockR;
    muted = new Set();
    solo = null;
    /** 非活动轨的混响尾巴状态：1=刚停止有尾巴，0=尾巴已尽彻底关闭 */
    tails = new Map();
    constructor(project, sources, blockSize = 1024, subBlock = SUB_BLOCK) {
        if (blockSize % subBlock !== 0)
            throw new Error('blockSize 必须是 subBlock 的整数倍');
        this.project = project;
        this.sampleRate = project.sampleRate;
        this.blockSize = blockSize;
        this.subBlock = subBlock;
        this.subBlocks = blockSize / subBlock;
        this.sampler = new SceneSampler(project);
        for (const s of sources)
            this.sources.set(s.id, s);
        for (const track of project.sources) {
            this.processors.set(track.id, new SourceProcessor(track, project.sampleRate, subBlock));
        }
        this.roomA = new RoomEngine(project.rooms[0] ?? this.implicitOutdoor(), project.sampleRate);
        this.roomBusA = new Float32Array(blockSize);
        this.roomBusB = new Float32Array(blockSize);
        this.wetL = new Float32Array(blockSize);
        this.wetR = new Float32Array(blockSize);
        this.blockL = new Float32Array(blockSize);
        this.blockR = new Float32Array(blockSize);
    }
    implicitOutdoor() {
        return {
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
    }
    seek(timeSeconds) {
        this.sampler.seek(timeSeconds);
        for (const p of this.processors.values())
            p.reset();
        this.roomA = new RoomEngine(this.roomA.room, this.sampleRate);
        this.roomB = null;
        this.tails.clear();
    }
    /**
     * 渲染从 timeSeconds 开始的一个块。
     * @returns 左右耳各 blockSize 个样本（内部缓冲，下次调用失效）
     */
    renderBlock(timeSeconds) {
        const n = this.blockSize;
        const sr = this.sampleRate;
        const mixL = this.blockL;
        const mixR = this.blockR;
        const busA = this.roomBusA;
        const busB = this.roomBusB;
        mixL.fill(0);
        mixR.fill(0);
        busA.fill(0);
        busB.fill(0);
        const blockSeconds = n / sr;
        const roomMix = this.sampler.getRoomMix(timeSeconds, blockSeconds);
        this.ensureRoomEngines(roomMix.roomA, roomMix.roomB);
        const sub = this.subBlock;
        for (let sb = 0; sb < this.subBlocks; sb++) {
            const off = sb * sub;
            const tMid = timeSeconds + (off + sub / 2) / sr;
            const listener = this.sampler.getListener(tMid);
            const sampled = this.sampler.getSources(tMid);
            // 房间交叉淡化在一个块内近似恒定（淡化时长秒级，块长毫秒级）
            const gA = roomMix.gainA;
            const gB = roomMix.gainB;
            const hasB = this.roomB !== null && gB > 0;
            for (const item of sampled) {
                const track = item.track;
                if (this.muted.has(track.id))
                    continue;
                if (this.solo !== null && this.solo !== track.id)
                    continue;
                const proc = this.processors.get(track.id);
                const audio = this.sources.get(track.clipId);
                if (!proc || !audio)
                    continue;
                // ---- 非活动轨：只维持混响尾巴，跳过 HRTF 干声，超阈值后彻底关闭 ----
                if (!item.active) {
                    if (this.tails.get(track.id) === 1) {
                        const peak = proc.processTail(sub, busA, off);
                        if (peak < TAIL_THRESHOLD)
                            this.tails.set(track.id, 0);
                        else if (hasB) {
                            for (let i = 0; i < sub; i++) {
                                const send = busA[off + i];
                                busB[off + i] = send * gB;
                                busA[off + i] = send * gA;
                            }
                        }
                    }
                    continue;
                }
                this.tails.set(track.id, 1); // 活动中；转非活动后自然进入尾巴阶段
                const spatial = relativeSpatial(item.pos, listener);
                const occlusion = evaluateOcclusion(item.pos, listener.pos, this.project.occluders);
                const facingCos = this.voiceFacingCos(track, tMid, listener.pos.x, listener.pos.y);
                const clipFrameMid = Math.floor((tMid - track.start + track.inPoint) * audio.sampleRate) -
                    Math.floor(sub / 2);
                proc.process(sub, (out, frames) => {
                    const converted = Math.round(clipFrameMid * (audio.sampleRate / sr));
                    audio.readBlock(converted, frames, out);
                }, spatial, occlusion, facingCos, mixL, mixR, off, busA, off);
                // 房间发送按当前淡化增益拆给 A/B 两个房间引擎
                if (hasB) {
                    for (let i = 0; i < sub; i++) {
                        const send = busA[off + i];
                        busB[off + i] = send * gB;
                        busA[off + i] = send * gA;
                    }
                }
            }
        }
        // ---- 房间引擎：湿声累加到独立缓冲后与干声混合（总线已按 A/B 增益拆分）----
        const wetL = this.wetL;
        const wetR = this.wetR;
        wetL.fill(0);
        wetR.fill(0);
        this.roomA.process(busA, wetL, wetR, n);
        if (this.roomB)
            this.roomB.process(busB, wetL, wetR, n);
        for (let i = 0; i < n; i++) {
            mixL[i] = softClip(mixL[i] + wetL[i]);
            mixR[i] = softClip(mixR[i] + wetR[i]);
        }
        return { left: mixL, right: mixR };
    }
    ensureRoomEngines(a, b) {
        if (this.roomA.room.id !== a.id) {
            this.roomA = new RoomEngine(a, this.sampleRate);
        }
        if (b) {
            if (!this.roomB || this.roomB.room.id !== b.id) {
                this.roomB = new RoomEngine(b, this.sampleRate);
            }
        }
        else {
            this.roomB = null;
        }
    }
    /**
     * 语音指向性：计算声源"前方"与"源→听者方向"的夹角余弦。
     * 源的前方取其运动路径切线方向；静止源视为全向（返回 1）。
     */
    voiceFacingCos(track, t, lx, ly) {
        const keys = track.keys;
        if (keys.length < 2)
            return 1;
        let i = 0;
        while (i < keys.length - 2 && t > keys[i + 1].t)
            i++;
        const a = keys[i];
        const b = keys[i + 1];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.hypot(dx, dy);
        if (len < 1e-4)
            return 1;
        const fx = dx / len;
        const fy = dy / len;
        const pos = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const tx = lx - pos.x;
        const ty = ly - pos.y;
        const tl = Math.hypot(tx, ty) || 1;
        return clamp((fx * tx + fy * ty) / tl, -1, 1);
    }
}
function softClip(x) {
    const ax = Math.abs(x);
    if (ax <= 0.7)
        return x;
    // 有理逼近 tanh，避免 Math.tanh 的高开销；误差 <1%，单调对称。
    // 上限收敛到 0.9（再经 -6dB 母带电平），给量化留足 headroom 杜绝满幅削波
    const u = (ax - 0.7) / 0.3;
    return 0.9 * Math.sign(x) * (0.7 + 0.3 * (u / (1 + 0.5 * u)));
}

Object.assign(__mod8, { SUB_BLOCK, BinauralRenderer });
})();

// ---- entry: D:\codex\runs\12526\workspace\dist\browser\binaural-worklet.js ----
const { BinauralRenderer } = __mod8;
/**
 * AudioWorklet 全局处理器。
 * 主线程把工程 JSON + 素材 PCM 端口数据传入，worklet 内实例化
 * 与离线渲染完全相同的 BinauralRenderer，保证"听到即导出"。
 *
 * 实时块固定 128 样本，subBlock 取 128（约 2.7ms 空间分辨率，满足拖动反馈）。
 */
class BinauralWorkletProcessor extends AudioWorkletProcessor {
    renderer = null;
    sources = [];
    playhead = 0;
    playing = false;
    blockSize = 128;
    constructor() {
        super();
        this.port.onmessage = (e) => this.handleMessage(e.data);
    }
    handleMessage(msg) {
        switch (msg.type) {
            case 'load': {
                // 素材通过 transfer 的 Float32Array 重建 AudioSource（轻量内联实现）
                this.sources = msg.buffers.map((b) => new InlineBufferSource(b.id, b.data, b.sampleRate));
                const project = msg.project;
                this.renderer = new BinauralRenderer(project, this.sources, this.blockSize, this.blockSize);
                this.playhead = msg.startTime * sampleRate;
                this.renderer.seek(msg.startTime);
                break;
            }
            case 'play':
                this.playing = true;
                break;
            case 'pause':
                this.playing = false;
                break;
            case 'seek': {
                this.playhead = msg.time * sampleRate;
                this.renderer?.seek(msg.time);
                this.playing = msg.playing ?? this.playing;
                break;
            }
            case 'setMuted':
                this.renderer.muted = new Set(msg.ids);
                break;
            case 'setSolo':
                this.renderer.solo = msg.id;
                break;
        }
    }
    process(_inputs, outputs) {
        const out = outputs[0];
        const outL = out[0];
        const outR = out[1] ?? out[0];
        if (this.renderer && this.playing) {
            const t = this.playhead / sampleRate;
            const { left, right } = this.renderer.renderBlock(t);
            outL.set(left.subarray(0, this.blockSize));
            outR.set(right.subarray(0, this.blockSize));
            this.playhead += this.blockSize;
            this.port.postMessage({ type: 'playhead', time: this.playhead / sampleRate });
        }
        else {
            outL.fill(0);
            outR.fill(0);
        }
        return true;
    }
}
/** worklet 内不能依赖 DOM AudioBuffer，直接用 transfer 来的 Float32Array */
class InlineBufferSource {
    data;
    id;
    sampleRate;
    channels = 1;
    frames;
    constructor(id, data, sampleRate) {
        this.data = data;
        this.id = id;
        this.sampleRate = sampleRate;
        this.frames = data.length;
    }
    readBlock(frame, n, out) {
        const start = Math.max(0, frame);
        const skip = start - frame;
        for (let i = 0; i < skip; i++)
            out[i] = 0;
        const valid = Math.min(n - skip, Math.max(0, this.frames - start));
        for (let i = 0; i < valid; i++)
            out[skip + i] = this.data[start + i];
        for (let i = skip + valid; i < n; i++)
            out[i] = 0;
        return n;
    }
}
registerProcessor('binaural-worklet', BinauralWorkletProcessor);
