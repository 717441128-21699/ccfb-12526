import { EditorApp, defaultProject } from './editorApp.js';

const canvas = document.getElementById('topview') as HTMLCanvasElement;
const app = new EditorApp(defaultProject(48000), canvas, {
  playBtn: document.getElementById('play') as HTMLButtonElement,
  stopBtn: document.getElementById('stop') as HTMLButtonElement,
  timeInput: document.getElementById('time') as HTMLInputElement,
  trackList: document.getElementById('tracks') as HTMLDivElement,
  exportBtn: document.getElementById('export') as HTMLButtonElement,
  importAudioBtn: document.getElementById('importAudio') as HTMLButtonElement,
  audioFile: document.getElementById('audioFile') as HTMLInputElement,
  status: document.getElementById('status') as HTMLSpanElement,
}, './binaural-worklet.js');

document.getElementById('enableAudio')!.addEventListener('click', async () => {
  await app.startAudio();
  (document.getElementById('enableAudio') as HTMLButtonElement).disabled = true;
  document.getElementById('status')!.textContent = '实时双耳监听已启用（拖动声源可即时听到方位变化）';
});

// 窗口尺寸变化
new ResizeObserver(() => app.redraw()).observe(canvas);
