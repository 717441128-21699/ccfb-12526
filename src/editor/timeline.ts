import type { Project, SourceDef } from '../model/types';

/** 时间轴：标尺 + 场景色带 + 播放头 + 选中声源的关键帧刻度，点击跳转 */
export class Timeline {
  private ctx: CanvasRenderingContext2D;
  selected: SourceDef | null = null;
  time = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    private project: Project,
    private onSeek: (t: number) => void,
  ) {
    this.ctx = canvas.getContext('2d')!;
    canvas.addEventListener('mousedown', e => this.seek(e));
    canvas.addEventListener('mousemove', e => { if (e.buttons & 1) this.seek(e); });
  }

  private seek(e: MouseEvent): void {
    const r = this.canvas.getBoundingClientRect();
    const t = (e.clientX - r.left) / r.width * this.project.duration;
    this.onSeek(Math.max(0, Math.min(this.project.duration, t)));
  }

  resize(): void {
    const r = this.canvas.getBoundingClientRect();
    this.canvas.width = r.width * devicePixelRatio;
    this.canvas.height = r.height * devicePixelRatio;
    this.ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    this.draw();
  }

  draw(): void {
    const c = this.ctx;
    const w = this.canvas.width / devicePixelRatio;
    const h = this.canvas.height / devicePixelRatio;
    const dur = this.project.duration;
    const x = (t: number) => t / dur * w;
    c.clearRect(0, 0, w, h);

    // 场景色带
    const colors = ['#2b3a4a', '#3a2b4a', '#2b4a33', '#4a3a2b'];
    this.project.scenes.forEach((s, i) => {
      c.fillStyle = colors[i % colors.length];
      c.fillRect(x(s.start), 0, x(s.end) - x(s.start), 18);
      c.fillStyle = '#aeb6c2'; c.font = '10px sans-serif';
      c.fillText(s.preset.name, x(s.start) + 4, 13);
    });

    // 时间标尺：自适应间隔
    const target = w / 120;
    const steps = [1, 5, 10, 30, 60, 300, 600];
    const step = steps.find(s => s >= target) ?? 600;
    c.strokeStyle = '#3a4048'; c.fillStyle = '#8a919d'; c.font = '10px sans-serif';
    for (let t = 0; t <= dur; t += step) {
      c.beginPath(); c.moveTo(x(t), 22); c.lineTo(x(t), 30); c.stroke();
      const m = Math.floor(t / 60), s = Math.floor(t % 60);
      c.fillText(`${m}:${String(s).padStart(2, '0')}`, x(t) + 2, 30);
    }

    // 选中声源的关键帧刻度
    if (this.selected) {
      c.fillStyle = this.selected.color;
      for (const k of this.selected.path) {
        c.fillRect(x(k.time) - 1, 36, 2, 12);
      }
    }

    // 播放头
    c.strokeStyle = '#4da3ff'; c.lineWidth = 2;
    c.beginPath(); c.moveTo(x(this.time), 0); c.lineTo(x(this.time), h); c.stroke();
  }
}

export function fmtTime(t: number): string {
  const m = Math.floor(t / 60), s = t % 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(1).padStart(4, '0')}`;
}
