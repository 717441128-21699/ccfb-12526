import type { Project, Vec2 } from '../core/types.js';

/**
 * 俯视图 Canvas 渲染器：世界坐标（米）↔ 屏幕像素变换、网格、房间多边形、
 * 遮挡墙、听者（含朝向锥）、声源点与移动路径、当前时间位置标记。
 * 纯绘制，不含交互状态机（交互在 EditorController）。
 */
export class TopViewCanvas {
  private ctx: CanvasRenderingContext2D;
  private scale = 28; // 像素/米
  private offset: Vec2 = { x: 0, y: 0 };
  private dpr = 1;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('无法获取 2D 上下文');
    this.ctx = ctx;
    this.dpr = window.devicePixelRatio || 1;
  }

  /** 以世界坐标原点为中心适配画布 */
  fitTo(project: Project): void {
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

  worldToScreen(p: Vec2): Vec2 {
    // 屏幕 y 向下，世界 y 向上 → 取反
    return { x: p.x * this.scale + this.offset.x, y: -p.y * this.scale + this.offset.y };
  }

  screenToWorld(p: Vec2): Vec2 {
    return { x: (p.x - this.offset.x) / this.scale, y: -(p.y - this.offset.y) / this.scale };
  }

  zoom(factor: number, center?: Vec2): void {
    const before = center ? this.screenToWorld(center) : { x: 0, y: 0 };
    this.scale = Math.max(6, Math.min(120, this.scale * factor));
    if (center) {
      const after = this.screenToWorld(center);
      this.offset.x += (after.x - before.x) * this.scale;
      this.offset.y -= (after.y - before.y) * this.scale;
    }
  }

  /** 屏幕像素增量平移视图 */
  panBy(dxScreen: number, dyScreen: number): void {
    this.offset.x += dxScreen;
    this.offset.y += dyScreen;
  }

  get pixelPerMeter(): number {
    return this.scale;
  }

  resize(): void {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  draw(state: DrawState): void {
    const ctx = this.ctx;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#0f1420';
    ctx.fillRect(0, 0, w, h);
    this.drawGrid(w, h);

    for (const room of state.project.rooms) this.drawRoom(room, state.currentRoomId === room.id);
    for (const oc of state.project.occluders) this.drawOccluder(oc);
    for (const s of state.project.sources) this.drawTrack(s, state);
    this.drawListener(state);
  }

  private drawGrid(w: number, h: number): void {
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

  private drawRoom(room: Project['rooms'][number], active: boolean): void {
    if (room.polygon.length < 3) return;
    const ctx = this.ctx;
    ctx.beginPath();
    room.polygon.forEach((p, i) => {
      const s = this.worldToScreen(p);
      if (i === 0) ctx.moveTo(s.x, s.y);
      else ctx.lineTo(s.x, s.y);
    });
    ctx.closePath();
    ctx.fillStyle = room.kind === 'indoor' ? 'rgba(96,140,255,0.10)' : 'rgba(96,220,140,0.08)';
    ctx.fill();
    ctx.strokeStyle = active ? '#ffd166' : room.kind === 'indoor' ? '#5a82d6' : '#4fae7a';
    ctx.lineWidth = active ? 2.5 : 1.5;
    ctx.setLineDash(room.kind === 'outdoor' ? [6, 4] : []);
    ctx.stroke();
    ctx.setLineDash([]);
    const label = this.worldToScreen(room.polygon[0]!);
    ctx.fillStyle = '#8aa0c0';
    ctx.font = '12px system-ui';
    ctx.fillText(`${room.name} (${room.kind === 'indoor' ? '室内' : '室外'})`, label.x + 4, label.y + 14);
  }

  private drawOccluder(oc: Project['occluders'][number]): void {
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

  private drawTrack(track: Project['sources'][number], state: DrawState): void {
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
      const p = pts[i]!;
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

  private drawListener(state: DrawState): void {
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

export interface DrawState {
  project: Project;
  listener: { pos: Vec2; yaw: number };
  sourcePositions: Map<string, Vec2>;
  currentKeyIds: Set<string>;
  selectedId: string | null;
  mutedIds: Set<string>;
  currentRoomId: string | null;
}
