/**
 * 音频编解码：G.711 μ-law（ITU-T G.711，公开标准算法，此处按标准自行实现）+ 简单重采样
 *
 * 为什么 V1 用 μ-law 而不是 Opus：
 * - 四端都能用纯 JS 编解码，无需 WASM（微信小程序对 WASM 有包体与性能限制，App 逻辑层不跑 WebAudio）
 * - 8kHz 单声道 = 64 kbps（8 KB/s），对讲（窄带语音）可接受；Opus 约 16–24 kbps，见设计文档“生产化”一节
 */
const BIAS = 0x84;
const CLIP = 32635;

const EXP_LUT = new Uint8Array(256);
for (let i = 0; i < 256; i++) EXP_LUT[i] = i < 2 ? 0 : Math.floor(Math.log2(i));

/** 16 位线性 PCM → μ-law 字节 */
export function linearToMulaw(sample) {
  let s = sample | 0;
  const sign = (s >> 8) & 0x80;
  if (sign) s = -s;
  if (s > CLIP) s = CLIP;
  s += BIAS;
  const exponent = EXP_LUT[(s >> 7) & 0xff];
  const mantissa = (s >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

/** μ-law 字节 → 16 位线性 PCM */
export function mulawToLinear(u) {
  const v = ~u & 0xff;
  const sign = v & 0x80;
  const exponent = (v >> 4) & 0x07;
  const mantissa = v & 0x0f;
  let s = ((mantissa << 3) + BIAS) << exponent;
  s -= BIAS;
  return sign ? -s : s;
}

const DECODE_LUT = new Int16Array(256);
for (let i = 0; i < 256; i++) DECODE_LUT[i] = mulawToLinear(i);

export function encodeInt16(int16) {
  const out = new Uint8Array(int16.length);
  for (let i = 0; i < int16.length; i++) out[i] = linearToMulaw(int16[i]);
  return out;
}

export function encodeFloat32(f32) {
  const out = new Uint8Array(f32.length);
  for (let i = 0; i < f32.length; i++) {
    const x = Math.max(-1, Math.min(1, f32[i]));
    out[i] = linearToMulaw(Math.round(x * 32767));
  }
  return out;
}

/** μ-law 字节 → Float32（-1..1），供 WebAudio 播放 */
export function decodeToFloat32(bytes) {
  const out = new Float32Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) out[i] = DECODE_LUT[bytes[i]] / 32768;
  return out;
}

/**
 * 降采样（盒式平均，近似低通，防止明显混叠）。有状态：跨块保留余数，适合流式。
 * @returns {(input: Float32Array) => Float32Array}
 */
export function createDownsampler(fromRate, toRate) {
  const ratio = fromRate / toRate;
  let acc = 0, accN = 0, pos = 0; // pos：距离下一个输出点的输入样本累计
  return (input) => {
    if (ratio === 1) return input;
    const out = [];
    for (let i = 0; i < input.length; i++) {
      acc += input[i]; accN++; pos++;
      if (pos >= ratio) {
        out.push(acc / accN);
        acc = 0; accN = 0; pos -= ratio;
      }
    }
    return Float32Array.from(out);
  };
}

/** 把连续样本切成固定长度帧（流式） */
export function createFramer(frameSamples, onFrame) {
  let buf = new Float32Array(0);
  return {
    push(samples) {
      const merged = new Float32Array(buf.length + samples.length);
      merged.set(buf); merged.set(samples, buf.length);
      let off = 0;
      while (merged.length - off >= frameSamples) {
        onFrame(merged.subarray(off, off + frameSamples));
        off += frameSamples;
      }
      buf = merged.slice(off);
    },
    reset() { buf = new Float32Array(0); }
  };
}

/** 4 字节头 + μ-law 负载（与 backend/src/realtime/hub.js 帧格式一致） */
export const CODEC_MULAW_8K = 1;
export function packFrame(seq, mulawBytes) {
  const out = new Uint8Array(4 + mulawBytes.length);
  out[0] = CODEC_MULAW_8K;
  out[1] = (seq >> 8) & 0xff; out[2] = seq & 0xff; out[3] = 0;
  out.set(mulawBytes, 4);
  return out.buffer;
}
export function unpackFrame(arrayBuffer) {
  const u8 = new Uint8Array(arrayBuffer);
  if (u8.length < 5) return null;
  return { codec: u8[0], seq: (u8[1] << 8) | u8[2], streamId: u8[3], payload: u8.subarray(4) };
}
