/**
 * 工程文件数据模型（浏览器与 Node 共用）。
 * 坐标系：俯视图 2D，单位米。x 向右，y 向上（屏幕坐标由编辑器负责翻转）。
 * 角度：度，0 = 朝 +x（东），逆时针为正，朝向用 yaw（水平面）；俯仰 pitch 正为向上。
 */

export interface Vec2 {
  x: number;
  y: number;
}

export interface Keyframe {
  /** 秒 */
  t: number;
  x: number;
  y: number;
  /** 度，仅听者关键帧使用；源关键帧中保留但忽略 */
  yaw?: number;
}

export type RoomKind = 'indoor' | 'outdoor';

export interface Room {
  id: string;
  name: string;
  kind: RoomKind;
  /** 多边形顶点（俯视墙线），用于点是否在房间内的判定 */
  polygon: Vec2[];
  /** 混响时长 RT60（秒） */
  rt60: number;
  /** 房间尺寸（米），决定早期反射密度 */
  roomSize: number;
  /** 混响湿声整体电平 dB */
  levelDb: number;
  /** 高频混响衰减比（0-1，越小越闷） */
  hfDamping: number;
  /** 场景切换交叉淡化时长（秒） */
  fadeSeconds: number;
}

export type OccluderMaterial = 'thin_wall' | 'wall' | 'heavy_wall';

export interface Occluder {
  id: string;
  a: Vec2;
  b: Vec2;
  material: OccluderMaterial;
}

export interface AudioClip {
  id: string;
  /** 展示名 */
  name: string;
  /** 相对工程目录的路径（Node）或浏览器端由编辑器注入，不持久化 */
  url: string;
  /** 采样率（由导入器填充） */
  sampleRate: number;
  /** 总帧数（由导入器填充） */
  frames: number;
  /** 声道数（由导入器填充，多声道会被下混为单声道） */
  channels: number;
}

export type DirectivityMode = 'voice' | 'omni' | 'custom';

export interface SourceTrack {
  id: string;
  name: string;
  clipId: string;
  /** 声音类型：voice 启用指向性（背对听者掉高频） */
  type: 'voice' | 'ambience';
  /** 源在工程时间轴上的起始时刻（秒） */
  start: number;
  /** 裁剪：素材内部起点（秒） */
  inPoint: number;
  /** 使用时长（秒），到末尾自动静音 */
  duration: number;
  /** 增益 dB */
  gainDb: number;
  /** 最低距离（米），更近不再变响 */
  minDistance: number;
  /** 最大可闻距离（米） */
  maxDistance: number;
  /** 语音指向性强度（0-1），type=voice 时生效 */
  directivity: number;
  /** 路径关键帧 */
  keys: Keyframe[];
  /** 静音/独奏由编辑器运行时控制，不持久化到文件 */
  muted?: boolean;
}

export interface SceneAutomation {
  /** 秒 */
  t: number;
  roomId: string;
}

export interface Project {
  version: 1;
  name: string;
  sampleRate: number;
  /** 工程时长（秒） */
  duration: number;
  listenerKeys: Keyframe[];
  sources: SourceTrack[];
  rooms: Room[];
  occluders: Occluder[];
  clips: AudioClip[];
  /** 场景混响自动化；为空时按听者所在多边形自动判定 */
  sceneAutomation: SceneAutomation[];
}

/** 某一时刻听者 / 声源的解析状态 */
export interface ListenerState {
  pos: Vec2;
  yaw: number; // 度
  pitch: number; // 度（当前模型保留，默认 0）
}

export interface SourceState {
  pos: Vec2;
  active: boolean;
}
