import { PRESETS, genId, type Project, type SourceDef, type Vec2 } from './model/types';
import { AudioStore, makeDemoBuffer } from './audio/store';
import { PreviewEngine } from './audio/preview';
import { renderProject, encodeWav } from './audio/render';
import { StageView } from './editor/stage';
import { Timeline, fmtTime } from './editor/timeline';

// ---------- 演示工程：两个角色 + 一个环境声 + 一道墙 + 两个声学场景 ----------
const project: Project = {
  name: '演示剧集',
  duration: 60,
  listener: {
    path: [{ time: 0, x: 0, y: 0 }],
    heading: [
      { time: 0, angle: 0 },
      { time: 20, angle: 0 },
      { time: 30, angle: Math.PI / 2 },   // 20→30 秒缓慢向右转头
      { time: 60, angle: Math.PI / 2 },
    ],
  },
  sources: [
    {
      id: genId('src'), name: '角色甲', kind: 'voice', color: '#ff9f43',
      path: [{ time: 0, x: -4, y: 1 }, { time: 15, x: -4, y: 1 }, { time: 35, x: 4, y: 1 }, { time: 60, x: 4, y: 1 }],
      facing: Math.PI, elevation: 0, gain: 1, startTime: 0, loop: true, bufferId: 'demo_a',
    },
    {
      id: genId('src'), name: '角色乙', kind: 'voice', color: '#54a0ff',
      path: [{ time: 0, x: 2, y: -3 }, { time: 25, x: 2, y: -3 }, { time: 40, x: 0, y: 0.5 }, { time: 60, x: 0, y: 0.5 }],
      facing: 0, elevation: 0, gain: 1, startTime: 2, loop: true, bufferId: 'demo_b',
    },
    {
      id: genId('src'), name: '窗外雨声', kind: 'ambience', color: '#1dd1a1',
      path: [{ time: 0, x: 0, y: 6 }],
      facing: 0, elevation: 1.5, gain: 0.5, startTime: 0, loop: true, bufferId: 'demo_rain',
    },
  ],
  walls: [
    { id: genId('wall'), ax: -6, ay: 3, bx: 6, by: 3, transmission: 0.2 },
  ],
  scenes: [
    { start: 0, end: 30, preset: PRESETS.indoor_small },
    { start: 30, end: 60, preset: PRESETS.indoor_hall },
  ],
};

// ---------- 状态 ----------
const store = new AudioStore();
const engine = new PreviewEngine(project, store);
let selected: SourceDef | null = null;
let recording = false;
let lastRecordT = -1;
let rendered: AudioBuffer | null = null;
let renderSource: AudioBufferSourceNode | null = null;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const statusEl = $('status');
const setStatus = (s: string) => { statusEl.textContent = s; };

// 演示音频（等 AudioContext 采样率）
const bootCtx = new AudioContext();
store.set('demo_a', makeDemoBuffer(bootCtx, 'voice', 140));
store.set('demo_b', makeDemoBuffer(bootCtx, 'voice', 220));
store.set('demo_rain', makeDemoBuffer(bootCtx, 'ambience', 0));
void bootCtx.close();

// ---------- 关键帧工具 ----------
function setKeyframe(src: SourceDef, t: number, pos: Vec2): void {
  const path = src.path;
  const hit = path.find(k => Math.abs(k.time - t) < 0.15);
  if (hit) { hit.x = pos.x; hit.y = pos.y; return; }
  path.push({ time: t, x: pos.x, y: pos.y });
  path.sort((a, b) => a.time - b.time);
}

// ---------- 视图 ----------
const view = new StageView($('stageCanvas') as unknown as HTMLCanvasElement, project, {
  onSelectSource(src) { selected = src; timeline.selected = src; syncPanel(); timeline.draw(); },
  onSelectListener() { selected = null; timeline.selected = null; syncPanel(); $('selInfo').textContent = '听者（拖动移动，Shift+拖动转头）'; },
  onMoveSource(src, pos, elevDelta) {
    if (elevDelta !== 0) {
      src.elevation = Math.max(-3, Math.min(5, src.elevation + elevDelta));
    } else if (recording && engine.isPlaying) {
      if (engine.time - lastRecordT > 0.1) { setKeyframe(src, engine.time, pos); lastRecordT = engine.time; }
    } else {
      setKeyframe(src, engine.time, pos);
    }
    engine.poke(); view.draw(); timeline.draw(); syncPanel();
  },
  onMoveListener(pos) {
    project.listener.path = [{ time: 0, x: pos.x, y: pos.y }];
    engine.poke(); view.draw();
  },
  onRotateListener(angle) {
    const keys = project.listener.heading;
    const hit = keys.find(k => Math.abs(k.time - engine.time) < 0.3);
    if (hit) hit.angle = angle; else { keys.push({ time: engine.time, angle }); keys.sort((a, b) => a.time - b.time); }
    engine.poke(); view.draw();
  },
  onAddSource(pos) {
    const id = genId('src');
    const bufId = `demo_${id}`;
    store.set(bufId, makeDemoBuffer(new AudioContext(), 'voice', 120 + Math.random() * 160));
    project.sources.push({
      id, name: `声源${project.sources.length + 1}`, kind: 'voice',
      color: `hsl(${Math.floor(Math.random() * 360)},70%,60%)`,
      path: [{ time: engine.time, x: pos.x, y: pos.y }],
      facing: 0, elevation: 0, gain: 1, startTime: 0, loop: true, bufferId: bufId,
    });
    view.draw();
  },
  onAddWall(a, b) {
    project.walls.push({ id: genId('wall'), ax: a.x, ay: a.y, bx: b.x, by: b.y, transmission: 0.2 });
    engine.poke(); view.draw();
  },
  onDeleteKeyframe(src, i) { src.path.splice(i, 1); view.draw(); timeline.draw(); },
});

const timeline = new Timeline($('timeline'), project, t => {
  engine.seek(t); view.time = engine.time; view.draw(); timeline.draw(); updateTimeLabel();
});

function updateTimeLabel(): void { $('timeLabel').textContent = fmtTime(engine.time); }

// ---------- 工具栏 ----------
const tools: [string, 'select' | 'addSource' | 'wall' | 'listener'][] = [
  ['toolSelect', 'select'], ['toolAddSource', 'addSource'], ['toolWall', 'wall'], ['toolListener', 'listener'],
];
for (const [id, tool] of tools) {
  $(id).addEventListener('click', () => {
    view.setTool(tool);
    for (const [tid] of tools) $(tid).classList.toggle('active', tid === id);
  });
}

$('btnRecordPath').addEventListener('click', () => {
  recording = !recording;
  $('btnRecordPath').classList.toggle('active', recording);
  setStatus(recording ? '录路径中：播放时拖动声源即采样' : '');
});

$('btnPlay').addEventListener('click', () => {
  if (engine.isPlaying) { engine.stop(); $('btnPlay').textContent = '▶ 预览'; }
  else { engine.play(); $('btnPlay').textContent = '⏸ 停止'; }
});

$('btnRender').addEventListener('click', async () => {
  const btn = $('btnRender') as HTMLButtonElement;
  btn.disabled = true;
  const t0 = performance.now();
  try {
    rendered = await renderProject(project, store, f => setStatus(`渲染中 ${(f * 100).toFixed(0)}%`));
    const secs = ((performance.now() - t0) / 1000).toFixed(1);
    setStatus(`渲染完成：${fmtTime(project.duration)} 节目用时 ${secs}s`);
    ($('btnPlayRender') as HTMLButtonElement).disabled = false;
    ($('btnDownload') as HTMLButtonElement).disabled = false;
  } catch (err) {
    setStatus(`渲染失败：${String(err)}`);
  } finally {
    btn.disabled = false;
  }
});

$('btnPlayRender').addEventListener('click', () => {
  if (renderSource) { renderSource.stop(); renderSource = null; $('btnPlayRender').textContent = '▶ 听渲染'; return; }
  if (!rendered) return;
  const ctx = new AudioContext();
  renderSource = ctx.createBufferSource();
  renderSource.buffer = rendered;
  renderSource.connect(ctx.destination);
  renderSource.onended = () => { renderSource = null; $('btnPlayRender').textContent = '▶ 听渲染'; };
  renderSource.start();
  $('btnPlayRender').textContent = '⏸ 停止';
});

$('btnDownload').addEventListener('click', () => {
  if (!rendered) return;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(encodeWav(rendered));
  a.download = `${project.name}.wav`;
  a.click();
  URL.revokeObjectURL(a.href);
});

// ---------- 侧栏属性 ----------
function syncPanel(): void {
  const panel = $('srcProps');
  if (!selected) { panel.hidden = true; if ($('selInfo').textContent !== '听者（拖动移动，Shift+拖动转头）') $('selInfo').textContent = '未选中'; return; }
  panel.hidden = false;
  $('selInfo').textContent = `${selected.name} · ${selected.kind === 'voice' ? '角色' : '环境声'}`;
  ($('pName') as HTMLInputElement).value = selected.name;
  ($('pGain') as HTMLInputElement).value = String(selected.gain);
  $('pGainV').textContent = selected.gain.toFixed(2);
  ($('pElev') as HTMLInputElement).value = String(selected.elevation);
  ($('pFacing') as HTMLInputElement).value = String(Math.round(selected.facing * 180 / Math.PI));
  ($('pStart') as HTMLInputElement).value = String(selected.startTime);
  ($('pLoop') as HTMLInputElement).checked = selected.loop;
}

$('pName').addEventListener('input', e => { if (selected) { selected.name = (e.target as HTMLInputElement).value; view.draw(); } });
$('pGain').addEventListener('input', e => { if (selected) { selected.gain = Number((e.target as HTMLInputElement).value); syncPanel(); } });
$('pElev').addEventListener('input', e => { if (selected) { selected.elevation = Number((e.target as HTMLInputElement).value); engine.poke(); view.draw(); } });
$('pFacing').addEventListener('input', e => { if (selected) { selected.facing = Number((e.target as HTMLInputElement).value) * Math.PI / 180; engine.poke(); view.draw(); } });
$('pStart').addEventListener('input', e => { if (selected) selected.startTime = Number((e.target as HTMLInputElement).value); });
$('pLoop').addEventListener('change', e => { if (selected) selected.loop = (e.target as HTMLInputElement).checked; });
$('pFile').addEventListener('change', async e => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (!f || !selected) return;
  const id = `file_${selected.id}`;
  await store.loadFile(new AudioContext(), id, f);
  selected.bufferId = id;
  setStatus(`已加载 ${f.name}`);
});

// 场景选择器
const sceneSelect = $('sceneSelect') as HTMLSelectElement;
function refreshSceneUI(): void {
  const idx = engine.sceneIndexAt(engine.time);
  const span = project.scenes[idx];
  $('sceneInfo').textContent = `${span.preset.name} · RT60 ${span.preset.rt60}s · 湿声 ${(span.preset.wet * 100).toFixed(0)}%`;
  sceneSelect.innerHTML = '';
  Object.entries(PRESETS).forEach(([key, p]) => {
    const opt = document.createElement('option');
    opt.value = key; opt.textContent = p.name;
    if (p === span.preset) opt.selected = true;
    sceneSelect.appendChild(opt);
  });
}
sceneSelect.addEventListener('change', () => {
  const idx = engine.sceneIndexAt(engine.time);
  project.scenes[idx].preset = PRESETS[sceneSelect.value];
  refreshSceneUI();
});

// ---------- 主循环：播放头重绘 ----------
function frame(): void {
  if (engine.isPlaying) {
    view.time = engine.time;
    view.draw(); timeline.time = engine.time; timeline.draw();
    updateTimeLabel();
    if (!engine.isPlaying) $('btnPlay').textContent = '▶ 预览';
  }
  requestAnimationFrame(frame);
}

window.addEventListener('resize', () => { view.resize(); timeline.resize(); });
view.time = 0; timeline.time = 0;
view.resize(); timeline.resize();
refreshSceneUI();
updateTimeLabel();
frame();
setStatus('就绪：点 ▶ 预览，拖动声源听方位变化');
