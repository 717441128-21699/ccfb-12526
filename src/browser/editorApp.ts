import { TopViewCanvas, type DrawState } from './topViewCanvas.js';
import { EditorController } from './editorController.js';
import { AudioEngine } from './audioEngine.js';
import { SceneSampler } from '../core/timeline.js';
import type { Project } from '../core/types.js';

/**
 * 编辑器主装配：Canvas 俯视图 + 时间轴 + 轨道表 + 传输控制 + 工程读写。
 * 播放循环用 requestAnimationFrame 驱动 SceneSampler 计算当前帧源位置，
 * 拖动声源时同一 project 实时下发，worklet 在下一音频块即听到方位变化。
 */
export class EditorApp {
  private canvas: TopViewCanvas;
  private controller: EditorController;
  private engine = new AudioEngine();
  private sampler: SceneSampler;
  private raf = 0;
  private playing = false;
  private lastPlayhead = 0;
  private muted = new Set<string>();
  private workletUrl: string;

  constructor(
    private project: Project,
    canvasEl: HTMLCanvasElement,
    private ui: UiHandles,
    workletUrl: string,
  ) {
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

  private loop = (): void => {
    if (this.playing) {
      // 播放头由 worklet 回调驱动；这里仅保证画面刷新
      this.controller.setTime(this.lastPlayhead);
    }
    this.render();
    this.raf = requestAnimationFrame(this.loop);
  };

  private onPlayhead(t: number): void {
    this.lastPlayhead = t;
    if (t >= this.project.duration) {
      this.playing = false;
      this.engine.pause();
      this.ui.playBtn.textContent = '播放';
    }
    this.ui.timeInput.value = t.toFixed(2);
  }

  private render(): void {
    const t = this.controller.currentTime;
    const listener = this.sampler.getListener(t);
    const sourcePositions = new Map<string, { x: number; y: number }>();
    const currentKeyIds = new Set<string>();
    for (const tr of this.project.sources) {
      const s = this.sampler.getSources(t).find((x) => x.track.id === tr.id)!;
      sourcePositions.set(tr.id, s.pos);
      tr.keys.forEach((k, i) => {
        if (Math.abs(k.t - t) < 0.12) currentKeyIds.add(`${tr.id}:${i}`);
      });
    }
    const roomMix = this.sampler.getRoomMix(t, 0.05);
    const state: DrawState = {
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

  private bindTransport(): void {
    this.ui.playBtn.addEventListener('click', async () => {
      await this.engine.resume();
      this.playing = !this.playing;
      if (this.playing) {
        this.engine.play();
        this.ui.playBtn.textContent = '暂停';
      } else {
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

  private buildTrackList(): void {
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
      row.querySelector('.mute')!.addEventListener('click', () => {
        if (this.muted.has(tr.id)) this.muted.delete(tr.id);
        else this.muted.add(tr.id);
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

  private async importAudio(): Promise<void> {
    const file = this.ui.audioFile.files?.[0];
    if (!file) return;
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

  private exportProject(): void {
    const blob = new Blob([JSON.stringify(this.project, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${this.project.name}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    this.ui.status.textContent = '工程 JSON 已导出；用 npm run render 离线渲染为 WAV';
  }

  /** 首次用户手势后加载 worklet（浏览器自动播放策略要求） */
  async startAudio(): Promise<void> {
    await this.engine.resume();
    await this.engine.load(this.project, this.workletUrl);
  }

  get currentProject(): Project {
    return this.project;
  }

  /** 外部（如 ResizeObserver）触发重绘 */
  redraw(): void {
    this.canvas.resize();
    this.render();
  }
}

export interface UiHandles {
  playBtn: HTMLButtonElement;
  stopBtn: HTMLButtonElement;
  timeInput: HTMLInputElement;
  trackList: HTMLDivElement;
  exportBtn: HTMLButtonElement;
  importAudioBtn: HTMLButtonElement;
  audioFile: HTMLInputElement;
  status: HTMLSpanElement;
}

/** 浏览器端创建一个示例工程（无素材时用于体验，素材为振荡器生成） */
export function defaultProject(sampleRate: number): Project {
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
