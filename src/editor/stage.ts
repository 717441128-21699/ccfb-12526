import type { Project, SourceDef, Vec2 } from '../model/types';
import { samplePath, sampleHeading } from '../model/geometry';

export type Tool = 'select' | 'addSource' | 'wall' | 'listener';

export interface ViewEvents {
  onSelectSource(src: SourceDef | null): void;
  onSelectListener(): void;
  onMoveSource(src: SourceDef, pos: Vec2, elevDelta: number): void;
  onMoveListener(pos: Vec2): void;
  onRotateListener(angle: number): void;
  onAddSource(pos: Vec2): void;
  onAddWall(a: Vec2, b: Vec2): void;
  onDeleteKeyframe(src: SourceDef, index: number): void;
  onScrub?(t: number): void;
}

/**
 * 俯视图 Canvas：声源是点、路线是折线、听者是带朝向的三角。
 * 世界坐标单位是米，y 向下 = 听者正前方（图上）。
 */
export class StageView {
  private ctx: CanvasRenderingContext2D;
  private scale = 40; // 像素/米
  private ox = 0; private oy = 0; // 原点偏移（像素）
  private tool: Tool = 'select';
  private drag: { kind: string; src?: SourceDef; start?: Vec2; moved?: boolean } | null = null;
  selected: SourceDef | null = null;
  listenerSelected = false;
  time = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    private project: Project,
    private events: ViewEvents,
  ) {
    this.ctx = canvas.getContext('2d')!;
    this.ox = canvas.width / 2;
    this.oy = canvas.height / 2;
    this.bind();
  }

  setTool(t: Tool): void { this.tool = t; }

  toScreen(p: Vec2): Vec2 {
    return { x: p.x * this.scale + this.ox, y: -p.y * this.scale + this.oy };
  }
  toWorld(p: Vec2): Vec2 {
    return { x: (p.x - this.ox) / this.scale, y: -(p.y - this.oy) / this.scale };
  }

  resize(): void {
    const r = this.canvas.getBoundingClientRect();
    this.canvas.width = r.width * devicePixelRatio;
    this.canvas.height = r.height * devicePixelRatio;
    this.ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    this.draw();
  }

  // ---------- 绘制 ----------

  draw(): void {
    const c = this.ctx;
    const w = this.canvas.width / devicePixelRatio;
    const h = this.canvas.height / devicePixelRatio;
    c.clearRect(0, 0, w, h);
    this.drawGrid(w, h);

    // 墙体
    c.strokeStyle = '#6b7280'; c.lineWidth = 4; c.lineCap = 'round';
    for (const wall of this.project.walls) {
      const a = this.toScreen({ x: wall.ax, y: wall.ay });
      const b = this.toScreen({ x: wall.bx, y: wall.by });
      c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke();
    }

    // 声源路线 + 关键帧
    for (const src of this.project.sources) {
      if (src.path.length > 1) {
        c.strokeStyle = src.color + '66'; c.lineWidth = 2;
        c.beginPath();
        src.path.forEach((k, i) => {
          const p = this.toScreen(k);
          if (i === 0) c.moveTo(p.x, p.y); else c.lineTo(p.x, p.y);
        });
        c.stroke();
      }
      for (let i = 0; i < src.path.length; i++) {
        const p = this.toScreen(src.path[i]);
        c.fillStyle = src.color + 'aa';
        c.beginPath(); c.arc(p.x, p.y, 3, 0, Math.PI * 2); c.fill();
      }
    }

    // 声源当前位置
    for (const src of this.project.sources) {
      const pos = this.toScreen(samplePath(src.path, this.time));
      const sel = src === this.selected;
      c.fillStyle = src.color;
      c.beginPath(); c.arc(pos.x, pos.y, sel ? 9 : 7, 0, Math.PI * 2); c.fill();
      if (sel) {
        c.strokeStyle = '#fff'; c.lineWidth = 2;
        c.beginPath(); c.arc(pos.x, pos.y, 12, 0, Math.PI * 2); c.stroke();
      }
      // 朝向短线
      const fa = src.facing;
      c.strokeStyle = src.color; c.lineWidth = 2;
      c.beginPath(); c.moveTo(pos.x, pos.y);
      c.lineTo(pos.x + Math.sin(fa) * 16, pos.y - Math.cos(fa) * 16); c.stroke();
      // 高度标记
      if (Math.abs(src.elevation) > 0.05) {
        c.fillStyle = '#ffd166'; c.font = '10px sans-serif';
        c.fillText(`↕${src.elevation.toFixed(1)}m`, pos.x + 12, pos.y - 10);
      }
      c.fillStyle = '#d8dce3'; c.font = '11px sans-serif';
      c.fillText(src.name, pos.x + 12, pos.y + 4);
    }

    // 听者：三角 + 朝向
    const lp = this.toScreen(samplePath(this.project.listener.path, this.time));
    const head = sampleHeading(this.project.listener.heading, this.time);
    c.save();
    c.translate(lp.x, lp.y);
    c.rotate(head);
    c.fillStyle = this.listenerSelected ? '#4da3ff' : '#e8ecf2';
    c.beginPath();
    c.moveTo(0, -12); c.lineTo(8, 8); c.lineTo(-8, 8); c.closePath(); c.fill();
    // 左右耳标记
    c.fillStyle = '#ff6b6b'; c.beginPath(); c.arc(-6, 2, 2.5, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#51cf66'; c.beginPath(); c.arc(6, 2, 2.5, 0, Math.PI * 2); c.fill();
    c.restore();
    c.fillStyle = '#8a919d'; c.font = '11px sans-serif';
    c.fillText('听者', lp.x + 14, lp.y + 4);
  }

  private drawGrid(w: number, h: number): void {
    const c = this.ctx;
    c.strokeStyle = '#22262d'; c.lineWidth = 1;
    const step = this.scale;
    for (let x = this.ox % step; x < w; x += step) {
      c.beginPath(); c.moveTo(x, 0); c.lineTo(x, h); c.stroke();
    }
    for (let y = this.oy % step; y < h; y += step) {
      c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke();
    }
    c.fillStyle = '#3a4048'; c.font = '10px sans-serif';
    c.fillText('1 米/格', 8, h - 8);
  }

  // ---------- 交互 ----------

  private hitSource(sp: Vec2): SourceDef | null {
    for (let i = this.project.sources.length - 1; i >= 0; i--) {
      const src = this.project.sources[i];
      const p = this.toScreen(samplePath(src.path, this.time));
      if (Math.hypot(p.x - sp.x, p.y - sp.y) < 12) return src;
    }
    return null;
  }

  private hitListener(sp: Vec2): boolean {
    const p = this.toScreen(samplePath(this.project.listener.path, this.time));
    return Math.hypot(p.x - sp.x, p.y - sp.y) < 14;
  }

  private hitKeyframe(sp: Vec2): { src: SourceDef; index: number } | null {
    for (const src of this.project.sources) {
      for (let i = 0; i < src.path.length; i++) {
        const p = this.toScreen(src.path[i]);
        if (Math.hypot(p.x - sp.x, p.y - sp.y) < 6) return { src, index: i };
      }
    }
    return null;
  }

  private evPos(e: MouseEvent): Vec2 {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private bind(): void {
    this.canvas.addEventListener('mousedown', e => {
      const sp = this.evPos(e);
      const wp = this.toWorld(sp);
      if (this.tool === 'addSource') { this.events.onAddSource(wp); return; }
      if (this.tool === 'listener') { this.events.onMoveListener(wp); return; }
      if (this.tool === 'wall') { this.drag = { kind: 'wall', start: wp }; return; }

      const src = this.hitSource(sp);
      if (src) {
        this.selected = src; this.listenerSelected = false;
        this.events.onSelectSource(src);
        this.drag = { kind: e.shiftKey ? 'elev' : 'src', src };
      } else if (this.hitListener(sp)) {
        this.listenerSelected = true; this.selected = null;
        this.events.onSelectListener();
        this.drag = { kind: e.shiftKey ? 'lisRotate' : 'lis' };
      } else {
        this.selected = null; this.listenerSelected = false;
        this.events.onSelectSource(null);
        this.drag = { kind: 'pan', start: sp };
      }
      this.draw();
    });

    this.canvas.addEventListener('mousemove', e => {
      if (!this.drag) return;
      const sp = this.evPos(e);
      const wp = this.toWorld(sp);
      const d = this.drag;
      if (d.kind === 'src' && d.src) {
        this.events.onMoveSource(d.src, wp, 0);
        d.moved = true;
      } else if (d.kind === 'elev' && d.src) {
        this.events.onMoveSource(d.src, samplePath(d.src.path, this.time), -e.movementY / 50);
        d.moved = true;
      } else if (d.kind === 'lis') {
        this.events.onMoveListener(wp);
      } else if (d.kind === 'lisRotate') {
        const lp = samplePath(this.project.listener.path, this.time);
        this.events.onRotateListener(Math.atan2(wp.x - lp.x, -(wp.y - lp.y)));
      } else if (d.kind === 'pan' && d.start) {
        this.ox += sp.x - d.start.x; this.oy += sp.y - d.start.y;
        d.start = sp;
        this.draw();
      }
    });

    this.canvas.addEventListener('mouseup', e => {
      if (this.drag?.kind === 'wall' && this.drag.start) {
        const wp = this.toWorld(this.evPos(e));
        if (Math.hypot(wp.x - this.drag.start.x, wp.y - this.drag.start.y) > 0.2) {
          this.events.onAddWall(this.drag.start, wp);
        }
      }
      this.drag = null;
    });

    this.canvas.addEventListener('dblclick', e => {
      const hit = this.hitKeyframe(this.evPos(e));
      if (hit && hit.src.path.length > 1) {
        this.events.onDeleteKeyframe(hit.src, hit.index);
      }
    });

    this.canvas.addEventListener('wheel', e => {
      e.preventDefault();
      const sp = this.evPos(e);
      const before = this.toWorld(sp);
      this.scale *= e.deltaY < 0 ? 1.1 : 0.9;
      this.scale = Math.min(400, Math.max(5, this.scale));
      const after = this.toWorld(sp);
      this.ox += (after.x - before.x) * this.scale;
      this.oy -= (after.y - before.y) * this.scale;
      this.draw();
    }, { passive: false });
  }
}
