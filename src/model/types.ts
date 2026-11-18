/** 数据模型：一集广播剧的全部空间信息。单位：米、秒、弧度。 */

export interface Vec2 { x: number; y: number }

/** 位置关键帧（俯视图平面） */
export interface Keyframe { time: number; x: number; y: number }

/** 朝向关键帧（弧度，0 = 俯视图 -y 方向即"图上"，顺时针为正） */
export interface HeadingKey { time: number; angle: number }

export type SourceKind = 'voice' | 'ambience';

export interface SourceDef {
  id: string;
  name: string;
  kind: SourceKind;
  color: string;
  /** 移动路线：按 time 升序的关键帧 */
  path: Keyframe[];
  /** 角色面朝方向（弧度），用于"背对听者高频衰减" */
  facing: number;
  /** 距耳平面的高度（米），上下方位感 */
  elevation: number;
  gain: number;
  /** 音频从时间轴这一刻开始播 */
  startTime: number;
  loop: boolean;
  /** 指向 AudioStore 里的 buffer */
  bufferId: string | null;
}

export interface ListenerDef {
  path: Keyframe[];
  heading: HeadingKey[];
}

/** 一段墙：隔在声源和听者之间会产生透墙闷声 */
export interface Wall {
  id: string;
  ax: number; ay: number; bx: number; by: number;
  /** 透射系数 0..1，越小墙越厚（砖墙 ~0.15，木板 ~0.5） */
  transmission: number;
}

/** 房间声学预设：早期反射 + 混响 */
export interface RoomPreset {
  name: string;
  /** 房间尺度（米），决定早期反射间隔 */
  roomSize: number;
  /** 混响时间 RT60（秒），室外取很小 */
  rt60: number;
  /** 湿声电平 0..1 */
  wet: number;
  /** 预延迟（毫秒） */
  preDelayMs: number;
  /** 高频阻尼 0..1，越大混响越闷 */
  damping: number;
}

/** 时间轴上的一段声学场景 */
export interface SceneSpan {
  start: number;
  end: number;
  preset: RoomPreset;
}

export interface Project {
  name: string;
  duration: number;
  listener: ListenerDef;
  sources: SourceDef[];
  walls: Wall[];
  scenes: SceneSpan[];
}

export const PRESETS: Record<string, RoomPreset> = {
  indoor_small: { name: '小房间', roomSize: 4,  rt60: 0.45, wet: 0.25, preDelayMs: 12, damping: 0.5 },
  indoor_hall:  { name: '大厅',   roomSize: 18, rt60: 1.8,  wet: 0.45, preDelayMs: 35, damping: 0.35 },
  outdoor:      { name: '室外',   roomSize: 60, rt60: 0.12, wet: 0.06, preDelayMs: 60, damping: 0.8 },
  cave:         { name: '山洞',   roomSize: 30, rt60: 3.2,  wet: 0.6,  preDelayMs: 45, damping: 0.2 },
};

let nextId = 1;
export function genId(prefix: string): string {
  return `${prefix}_${nextId++}_${Math.floor(performance.now() % 1e6)}`;
}
