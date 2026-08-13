# Qwen3-TTS Codec 帧如何变成波形

> 适用模型：`Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice`  
> 当前权重参数：24 kHz、16 个量化器、每个码本 2,048 项、每帧 1,920 个波形采样点。

## 1. 先明确“Codec 帧”是什么

Talker 每完成一个音频时间步，不是直接生成 1,920 个振幅值，而是产生一组离散 Codec ID：

```text
Codec Frame Ft = [c0, c1, c2, ... c15]
                  └────── 16 个码本索引 ──────┘
```

每个 `cq` 都是 `0–2047` 范围内的整数。第一路主要承担语义/粗声学信息，其余 15 路逐级补充音色、基频、谐波、瞬态和细节残差。

因此，单个 Codec 帧是一组压缩后的离散声学描述，不是一段可以直接播放的 PCM，也不是一个固定的波形模板编号。

## 2. 完整解码链路

```text
Talker / Code Predictor
    │
    │  [B, T, 16] 离散 Codec ID
    ▼
调整为 [B, 16, T]
    │
    ▼
Split Residual Vector Quantizer
    │  16 路 ID 分别查询学习到的 Codebook 向量
    │  第一语义路 + 其余 15 路声学残差
    ▼
连续声学特征 [B, 512, T]
    │
    ▼
Causal Conv：512 → 1024 维
    │
    ▼
8 层滑窗 Transformer（窗口 72 帧）
    │  融合当前帧与历史帧，恢复连续性和上下文
    ▼
两级 ×2 上采样 + ConvNeXt
    │  T → 4T
    ▼
四级因果转置卷积 ×8、×5、×4、×3
    │  4T → 1,920T
    ▼
因果卷积降为 1 个通道 + clamp[-1, 1]
    │
    ▼
24 kHz 单声道浮点波形
    │
    ▼
float waveform × 32767 → PCM16 → 浏览器/声卡
```

## 3. 第一步：从离散 ID 恢复连续向量

每个码本都包含 2,048 个学习到的向量。Codec ID 的作用类似数组下标：

```text
cq = 731
     ↓ 查第 q 个 Codebook
eq = Codebookq[731]
```

16 个 ID 会得到 16 个向量。Qwen3-TTS 使用残差向量量化（RVQ）：

```text
zt = e0[c0] + e1[c1] + ... + e15[c15]
```

实现上第一语义量化器和其余 15 个声学量化器分开投影，然后再相加，最终得到每个时间步约 512 维的连续声学表示。

这一步只是“查码本并合成声学特征”，仍然没有产生波形。

## 4. 第二步：利用相邻帧恢复时间连续性

如果每个 Codec 帧独立解码，帧边界很容易出现爆音、断裂和音色跳变。因此连续特征还会经过：

- 因果卷积；
- 8 层滑动窗口 Transformer；
- 当前配置下最多约 72 帧历史上下文。

它们会联合解释相邻 Codec 帧，使音高、相位、共振峰、发音过渡和韵律保持连续。由此可见，波形的某个采样点通常由当前帧和历史帧共同决定，而不是只由一个 Codec ID 决定。

## 5. 第三步：逐级上采样成 24 kHz 波形

解码器使用学习到的转置卷积逐步扩大时间轴：

```text
2 × 2 × 8 × 5 × 4 × 3 = 1,920
```

所以输入 `T` 个 Codec 帧，理论上得到：

```text
T × 1,920 个波形采样点
```

当前输出采样率为 24,000 Hz，因此：

```text
1 帧时长 = 1,920 / 24,000 = 0.08 秒 = 80 ms
实际帧率 = 24,000 / 1,920 = 12.5 fps
```

“12Hz”是模型系列的标称名称，当前配置的精确时间倍率为 12.5 fps。

例如 10 个 Codec 帧：

```text
10 × 1,920 = 19,200 samples
19,200 / 24,000 = 0.8 秒音频
```

最后一层把多通道隐藏特征压到单声道振幅，并限制在 `[-1, 1]`。服务端再把浮点振幅量化成 PCM16：

```text
pcm16[n] ≈ round(clamp(wave[n], -1, 1) × 32767)
```

这些连续的 PCM16 数字交给浏览器或声卡，就成为扬声器振膜随时间变化的电信号，最终形成空气压力波。

## 6. 为什么不能把一个 Codec 帧简单理解成一小段固定声音

不能把它理解为：

```text
F37 → 查出固定的 80 ms 波形 → 与 F38 直接拼接
```

原因包括：

1. 一个帧包含 16 个码本 ID，不是一个 ID。
2. 16 路向量通过残差方式共同描述该时间步。
3. Transformer 和因果卷积会参考历史 Codec 帧。
4. 转置卷积的感受野跨越相邻帧。
5. 同一组局部 Codec ID 在不同历史上下文中，解码边界可能不同。

更准确的理解是：Codec 序列描述一条低帧率声学轨迹，神经解码器根据上下文把这条轨迹连续“展开”为高采样率波形。

## 7. 流式 Code2Wav 如何避免块边界噪声

当前 vLLM-Omni 服务不是让每个新帧完全独立通过 Code2Wav。稳态配置会累计新帧，并带上左侧 Codec 上下文进行解码：

```text
上一段历史上下文 + 本次新 Codec 帧
                ↓
          一起通过神经解码器
                ↓
   丢弃历史上下文对应的旧 PCM
                ↓
          只发送本次新增 PCM
```

当前部署配置使用：

- 稳态 Codec Chunk：25 帧；
- 左侧上下文上限：72 帧；
- 首包可在 1 个新 Codec 帧就绪后触发。

若左侧上下文为 `C` 帧，解码后会裁掉前面的：

```text
C × 1,920 samples
```

这样既保留神经解码器需要的历史信息，又不会把已经播放过的音频重复发送。它是流式拼接自然、避免块边界噪声的关键。

## 8. 与 WebUI 双轨的关系

WebUI 下轨中的 `F0、F1、F2...` 表示 Codec 时间步。当前服务输出给浏览器的是已经经过 Code2Wav 的 PCM，而不是原始 16 路 Codec ID，因此界面用精确倍率进行反向定位：

```text
当前 Codec 帧 = floor(已播放 PCM samples / 1,920)
```

新帧以紫色提交脉冲进入下轨，随后显示为青色待播放块；当前播放块用琥珀色边框和块内绿色填充表示 80 ms 内部进度，播放结束后转为绿色。生成帧数与当前播放帧之差就是音频缓冲领先量。

## 9. 对应实现

- Tokenizer/Decoder 配置：[Qwen3-TTS upstream configuration](https://github.com/QwenLM/Qwen3-TTS/blob/main/qwen_tts/core/tokenizer_12hz/configuration_qwen3_tts_tokenizer_v2.py)
- RVQ、Transformer 和神经波形解码器：[Qwen3-TTS upstream decoder](https://github.com/QwenLM/Qwen3-TTS/blob/main/qwen_tts/core/tokenizer_12hz/modeling_qwen3_tts_tokenizer_v2.py)
- Pro 流式服务与 Code2Wav 改动：[`patches/vllm-omni-v0.26-qwen3-tts-pro.patch`](../patches/vllm-omni-v0.26-qwen3-tts-pro.patch)
- 当前部署分块参数：[`deployment/qwen3_tts_pro.yaml`](../deployment/qwen3_tts_pro.yaml)
