# 广播剧双耳混音台

给广播剧用的双耳（binaural）混音工具：导演在俯视图上摆听者、摆角色、画移动路线，
程序按 HRTF 把每个声部渲染到左右耳。TypeScript + Web Audio API + Canvas。

## 运行

```bash
npm install
npm run dev        # 开发服务器
npm run build      # 类型检查 + 生产构建
```

打开后是一个演示工程：两个角色（一个从左走到右、一个从身后靠近）、
窗外雨声、一道墙、两个声学场景（小房间 → 大厅），听者会在 20–30 秒向右转头。
**戴耳机**点「▶ 预览」。

## 需求 → 实现对照

| 需求 | 实现 |
|---|---|
| 俯视图摆听者/角色/环境声、画路线 | `src/editor/stage.ts`：Canvas 俯视图，拖动声源在当前时间打关键帧，「录路径」模式播放中拖动自动采样 |
| HRTF 渲染、前后上下分得清 | `PannerNode` + `panningModel: 'HRTF'`（真三维，非仅左右声像）；高度按键（Shift+拖动）控制 Y 分量 |
| 距离远变小变闷 | 距离反比衰减（PannerNode）+ 空气吸收低通（越远截止频率越低），见 `src/audio/spatial.ts` |
| 隔墙闷声 | 声源→听者连线与墙体线段求交，每穿一道墙乘以透射系数，映射到低通 + 增益 |
| 背对听者高频掉 | 声源朝向与"看向听者"夹角 → 高频搁架最多 -14dB |
| 听者转头方位跟着转 | 所有声源位置换算到听者朝向坐标系（`computeSpatialParams`），转头轨道支持关键帧 |
| 早期反射/混响区分室内外 | 程序化 IR（离散早期反射 + 指数衰减噪声尾），见 `src/audio/ir.ts`；预设：小房间/大厅/室外/山洞 |
| 换场景混响平滑过渡 | 双卷积器乒乓：新 IR 装进静音那台再交叉淡化 3 秒，旧混响尾自然衰减（`ReverbBus`） |
| 40 分钟 20 声部渲染 < 3 分钟 | `OfflineAudioContext` 离线渲染，空间参数自适应采样写自动化（直线/静止段几乎无事件） |
| 拖动实时听方位 | 预览引擎每帧 `setTargetAtTime` 平滑更新，拖动即听 |

## 结构

```
src/
  model/types.ts      数据模型（工程、声源、墙体、场景、预设）
  model/geometry.ts   向量/关键帧采样/线段相交/遮挡计算
  audio/spatial.ts    空间参数纯函数（实时与离线共用，保证预览=渲染）
  audio/chain.ts      单声部处理链 + 混响乒乓总线
  audio/ir.ts         程序化混响 IR
  audio/preview.ts    实时预览引擎
  audio/render.ts     离线渲染 + WAV 导出
  audio/store.ts      音频素材库 + 演示音源
  editor/stage.ts     俯视图 Canvas
  editor/timeline.ts  时间轴
smoke/smoke.ts        纯逻辑冒烟测试（npx esbuild 打包后 node 跑）
```

## 操作

- 拖动声源：在当前时间打/改关键帧；双击路径点删除关键帧
- Shift+上下拖：调高度（上下方位）
- 选中听者后 Shift+拖动：转头（写入朝向关键帧）
- 侧栏可改音量、入场时间、循环、加载真实干声文件
- 「渲染整集」→ 可在线试听、下载 WAV

## 后续可升级

- **HRTF 数据集**：浏览器内置 HRTF 是一组通用头模。要更准的前后/上下（尤其防前后混淆），
  可加载 SOFA 格式的 HRTF 库，把 `PannerNode` 换成「按方位插值 HRIR + 卷积」的自研节点，
  处理链接口（`SourceChain`）已经留好了替换点
- **真实 IR**：`makeImpulseResponse` 换成实测/采样的房间 IR 文件即可，接口不变
- **遮挡模型**：当前是 2D 射线 + 透射系数；可升级为每面墙独立频响曲线
- **工程文件**：数据模型是纯 JSON 可序列化的，加保存/加载很直接
