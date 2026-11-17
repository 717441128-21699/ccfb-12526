import { TopViewCanvas } from './topViewCanvas.js';
import { sampleKeys, dist } from '../core/mathUtils.js';
import type { Keyframe, Project, Vec2 } from '../core/types.js';

type DragMode =
  | { kind: 'source'; trackId: string }
  | { kind: 'listener' }
  | { kind: 'key'; trackId: string; index: number }
  | { kind: 'pan'; start: Vec2; offset: Vec2 }
  | null;

/**
 * 编辑器交互状态机。所有编辑直接作用于 project 对象（可变模型），
 * 通过 onChange 回调触发重绘与持久化；播放位置由外部 transport 驱动。
 */
export class EditorController {
  private drag: DragMode = null;
  selectedId: string | null = null;
  /** 当前播放时间（秒），由 transport 更新 */
  currentTime = 0;
  onChange: () => void = () => {};

  constructor(
    private project: Project,
    private canvas: TopViewCanvas,
  ) {
    this.attach();
  }

  private attach(): void {
    const el = this.canvasElement;
    el.addEventListener('pointerdown', (e) => this.onDown(e));
    el.addEventListener('pointermove', (e) => this.onMove(e));
    window.addEventListener('pointerup', () => (this.drag = null));
    el.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const rect = el.getBoundingClientRect();
        this.canvas.zoom(e.deltaY < 0 ? 1.12 : 0.89, {
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
        });
        this.onChange();
      },
      { passive: false },
    );
    el.addEventListener('dblclick', (e) => this.onDblClick(e));
  }

  private get canvasElement(): HTMLCanvasElement {
    return (this.canvas as unknown as { canvas: HTMLCanvasElement }).canvas;
  }

  private eventWorld(e: PointerEvent | MouseEvent): Vec2 {
    const rect = this.canvasElement.getBoundingClientRect();
    return this.canvas.screenToWorld({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  }

  private onDown(e: PointerEvent): void {
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
        if (dist(w, tr.keys[i]!) < 0.5) {
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

  private onMove(e: PointerEvent): void {
    const drag = this.drag;
    if (!drag) return;
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
        if (!tr) break;
        const k = tr.keys[drag.index]!;
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
  private moveListener(w: Vec2, e: PointerEvent | MouseEvent): void {
    const keys = this.project.listenerKeys;
    if (e.altKey) {
      const cur = sampleKeys(keys, this.currentTime);
      const yaw = (Math.atan2(w.y - cur.y, w.x - cur.x) * 180) / Math.PI;
      this.upsertListenerKey({ t: this.currentTime, x: cur.x, y: cur.y, yaw });
    } else {
      const cur = sampleKeys(keys, this.currentTime);
      this.upsertListenerKey({ t: this.currentTime, x: w.x, y: w.y, yaw: cur.yaw });
    }
  }

  /** 拖动声源：在当前时间更新/插入关键帧（实时听到方位变化） */
  private moveSourceCurrent(trackId: string, w: Vec2): void {
    const tr = this.project.sources.find((t) => t.id === trackId);
    if (!tr) return;
    const existing = tr.keys.find((k) => Math.abs(k.t - this.currentTime) < 0.08);
    if (existing) {
      existing.x = w.x;
      existing.y = w.y;
    } else {
      const kf: Keyframe = { t: this.currentTime, x: w.x, y: w.y };
      tr.keys.push(kf);
      tr.keys.sort((a, b) => a.t - b.t);
    }
  }

  private upsertListenerKey(kf: Keyframe): void {
    const keys = this.project.listenerKeys;
    const existing = keys.find((k) => Math.abs(k.t - kf.t) < 0.08);
    if (existing) Object.assign(existing, kf);
    else {
      keys.push(kf);
      keys.sort((a, b) => a.t - b.t);
    }
  }

  /** 双击空白：为选中轨在当前时间/位置加关键帧；双击关键帧删除 */
  private onDblClick(e: MouseEvent): void {
    const w = this.eventWorld(e);
    if (!this.selectedId) return;
    const tr = this.project.sources.find((t) => t.id === this.selectedId);
    if (!tr) return;
    const idx = tr.keys.findIndex((k) => dist(w, k) < 0.5);
    if (idx >= 0 && tr.keys.length > 1) {
      tr.keys.splice(idx, 1);
    } else {
      tr.keys.push({ t: this.currentTime, x: w.x, y: w.y });
      tr.keys.sort((a, b) => a.t - b.t);
    }
    this.onChange();
  }

  setTime(t: number): void {
    this.currentTime = t;
  }

  getSelectedTrack() {
    return this.project.sources.find((t) => t.id === this.selectedId) ?? null;
  }
}
