# 广播剧双耳混音工具（Binaural Radio Drama Mixer）

面向广播剧制作的双耳（binaural）立体声混音工具。导演在 **Canvas 俯视图**上摆放听者与
声源、绘制移动路线，程序按**参数化 HRTF**把每个声音渲染到左右耳，支持前后方位判别、
距离衰减变闷、隔墙闷声、语音指向性、室内外反射/混响与场景平滑过渡。

实时监听（AudioWorklet）与离线导出（Node）共用**同一个渲染引擎**，保证"听到即导出"。

---

## 能力对照（需求 → 实现）

| 需求 | 实现 |
| --- | --- |
| 俯视图摆听者位置/朝向，声源/环境声为点，可画移动路线沿时间轴走 | `TopViewCanvas` + `EditorController`，关键帧分段线性插值，时间轴采样 `SceneSampler` |
| HRTF 渲染到左右耳，前后上下分清、不只左右 | `ParametricHrtf`：ITD（Woodworth+近场）、头部声影 ILD、耳廓反射陷波（前后/仰角）、近场逐耳增益 |
| 距离远变小变闷 | 反距离增益 + 最大距离淡出 + 空气吸声一阶低通（`SourceProcessor`） |
| 隔墙说话有透墙闷声 | `evaluateOcclusion` 线段求交，三种墙体材料（薄墙/墙/承重墙）等效低通+电平损耗 |
| 角色背对听者高频掉 | 语音指向性：路径切线与"指向听者"夹角驱动低通（`directivity`） |
| 听者转头所有声音方位跟随转 | 全部空间化基于头部坐标系相对方位角（`relativeSpatial` 减去听者 yaw） |
| 室内外空间感（早期反射+混响）区分，换场景平滑过渡 | `RoomEngine`：6 抽头早期反射 + 8 线 Hadamard FDN；A/B 双引擎等功率交叉淡化，旧房间尾巴自然衰减 |
| 40 分钟/20 声部渲染 ≤ 3 分钟 | 实测 **约 137–174s（15–17x 实时）**，流式读写内存与时长无关 |
| 拖动角色实时听方位变化 | AudioWorklet 128 样本块，复用同一 `BinauralRenderer`，~2.7ms 空间分辨率 |

---

## 目录结构

```
src/
  core/        平台无关核心：类型、数学、时间轴采样、几何、遮挡
  dsp/         音频 DSP：滤波器、参数化 HRTF、房间引擎、声源处理、主渲染器
  io/          WAV 流式读写器、离线渲染驱动
  browser/     Canvas 编辑器、AudioWorklet、音频引擎、打包入口
  node/        CLI（render/demo/server/bench）
  tests/       node:test 单元测试（23 个）
scripts/       零依赖 ESM 打包器（worklet/主入口打成单文件）
public/        浏览器工作台（含打包产物）
```

## 快速开始

```bash
npm install
npm run build      # tsc 编译 + 打包 worklet 与浏览器入口
npm test           # 23 个单元测试
npm run demo       # 生成合成素材的演示工程并渲染，报告速度
npm run serve      # 启动 Canvas 工作台 http://localhost:5173/
```

### 离线渲染一个工程

```bash
npm run render -- --project workdir/demo-project.json --out out.wav --bits 24 --masterDb -6
```

工程为 JSON（模型见 `src/core/types.ts`），素材路径相对工程目录。渲染器流式读取素材、
分块写盘，内存占用与节目时长无关；默认 -6dB 母带电平 + 软限幅双重防削波。

### 浏览器工作台

1. `npm run serve` 后打开 http://localhost:5173/
2. 点"启用实时监听"（浏览器自动播放策略要求用户手势）
3. 导入 WAV 素材、在俯视图拖动声源/听者、双击增删关键帧
4. "导出工程 JSON"，再用上面的 CLI 离线渲染为成品 WAV

操作：拖动声源/听者移动 · **Alt+拖动听者改朝向** · 双击加/删关键帧 · 滚轮缩放 · Shift+拖动平移

---

## DSP 设计要点

- **ITD**：Woodworth 球面模型 `(r/c)(θ+sinθ)` 加近场修正；同侧耳基准延迟、对侧耳承担
  完整 ITD，实测 90° 方位 ±714μs（真人约 650–700μs）。
- **ILD/声影**：对侧耳一阶低通，90° 时截止 ~3.5kHz，宽带噪声实测 5.25dB 双耳差。
- **前后判别**：耳廓延迟反射与直达声相消形成陷波，反射延迟/增益随前后与仰角变化。
- **FDN 混响**：8 线 Hadamard 混合，每线独立吸收低通实现频率相关衰减，反馈系数由
  RT60 反推 `g = 0.001^(delay/RT60)`。
- **性能**：延迟线容量取 2 的幂用位掩码索引；系数按子块更新；非活动轨跳过 DSP 仅保留
  混响尾巴；**所有 IIR 状态做 denormal FTZ 冲刷**（非规格化浮点数曾导致 5.7x 减速）。

## 工程数据模型（摘要）

- `listenerKeys` / `sources[].keys`：`{t, x, y, yaw?}` 关键帧，分段线性，外按首尾钳位。
- `rooms[]`：多边形 + `kind`(indoor/outdoor) + RT60/尺寸/湿电平/高频阻尼/淡化时长。
- `occluders[]`：墙线段 + 材料；源-听者连线与之相交即判定穿墙。
- 场景切换：填 `sceneAutomation` 显式指定，或留空由听者所在多边形自动判定。

## 支持的 WAV 格式

PCM 8/16/24/32-bit 与 IEEE float32，多声道自动下混为单声道；导出支持 16/24/32-bit
立体声（24-bit 为有符号二补码小端）。所有素材需与工程同采样率（导入浏览器端会重采样）。

## 已知边界

- 当前为 2D 俯视图，仰角字段已预留（`pitch`/`elevation`），加入 z 坐标即可启用上下定位。
- 参数化 HRTF 是轻量合成模型，未使用实测 SOFA/HRIR；接口按 `AudioSource`/渲染器边界
  设计，后续可替换为分块卷积实测 HRIR 而不动上层。
