# TikTok / YouTube 海外平台处理记录：封面白屏、ASR 转写、反爬 403、友好错误提示

> 记录日期：2026-09-14
> 相关文件：`apps/web/app/api/thumbnail/route.ts`、`apps/web/.env.local`、`packages/core/src/{downloader,subtitle,asr}.ts`、`apps/web/lib/subtitle-cache.ts`、`apps/web/app/api/{parse,download,direct-url,subtitle,summarize,mindmap,chat}/route.ts`

---

## 0. 背景与架构约定

| 项 | 约定 |
| --- | --- |
| 出站代理 | 本机 Clash `http://127.0.0.1:7890`，统一定义在 `.env.local` 的 `PROXY_URL`；yt-dlp 与缩略图拉取共用 |
| yt-dlp 调度 | Node 侧 `spawn` 系统 yt-dlp（`packages/core/src/downloader.ts`），配置代理时自动加 `--proxy` |
| 部署形态 | Cloudflare Workers（无子进程）→ 转发的容器核心服务（有 yt-dlp/ffmpeg）；本地 dev 直接跑 yt-dlp |
| ASR 后端选择 | 配置 `AZURE_SPEECH_KEY+REGION` → 优先 Azure（境外区域可拉海外直链）；否则回落百炼（国内可达直链）；均无 → 无字幕降级 |

---

## 1. TikTok 解析报错：`Unexpected response from webpage request`

### 1.1 现象

```
ERROR: [TikTok] 7659351610841124104: Unexpected response from webpage request;
please report this issue on https://github.com/yt-dlp/yt-dlp/issues
```

### 1.2 根因

yt-dlp 的 TikTok 提取器依赖 **浏览器指纹伪装（impersonation）** 才能通过反爬校验。本机 Python 环境缺 `curl_cffi` 组件，yt-dlp 退化为普通 HTTP 客户端 → TikTok 返回异常页面结构，yt-dlp 判定为 "Unexpected response"。

### 1.3 解决

- 本地：`python -m pip install curl_cffi`
- 容器 `apps/container/Dockerfile`：`pip3 install -U "yt-dlp[default]"`（`[default]` 内含 curl_cffi）
- 验证：`python -c "import curl_cffi"` / `yt-dlp --version`

---

## 2. TikTok / YouTube 封面全部白屏

### 2.1 现象

解析 TikTok/YouTube 后，视频封面显示为白色空块。

### 2.2 根因（三层叠加）

1. 封面图由**浏览器端直连**海外 CDN（`i.ytimg.com` / `tiktokcdn.com`），国内直连不可达 → `<img>` 加载失败；
2. 海外 CDN 带**防盗链 Referer 校验**，即使可达也被 403；
3. 前端 `onError` 将失败的 `<img>` 隐藏，露出 `bg-zinc-100` 浅灰底色 → 视觉上就是"白封面"。

### 2.3 解决

新增 **`/api/thumbnail` 反防盗链代理路由**（`apps/web/app/api/thumbnail/route.ts`）：

- `resolveOutboundProxy()`：优先 `PROXY_URL`，其次 `HTTPS_PROXY/HTTP_PROXY`；
- `refererFor()`：按目标域动态生成 `Referer: <目标站 origin>/`；
- 代理模式下用 **undici 的 `ProxyAgent` + undici 自带 `fetch`**（`ProxyAgent` 与 Node 全局 fetch 不兼容，直接配 `dispatcher` 会 `fetch failed` / `invalid onRequestStart method`），并对 undici `Response` 类型做断言；
- 无代理（Cloudflare Worker 环境）直接走全球网络。

### 2.4 踩坑：undici ProxyAgent 与全局 fetch 不兼容

Node 运行时全局 `fetch` 由 undici 实现，但直接 `new ProxyAgent(proxy)` 传给 `fetch(url, { dispatcher })` 会报 `invalid onRequestStart method`。必须：

```ts
import { ProxyAgent, fetch as proxyFetch } from "undici";
proxyFetch(url, { headers, dispatcher: new ProxyAgent(proxy) });
```

（TypeScript 下 undici Response 与 Web Response 类型有差异，用 `as unknown as Response` 断言。）

---

## 3. 海外平台（TikTok/YouTube）接入语音转写

抖音通过阿里云百炼（大陆直链可达）转写成功；但 TikTok/YouTube 的音频直链（`googlevideo` / `tiktokcdn`）**对大陆百炼服务端不可达**（`FILE_DOWNLOAD_FAILED`）。因此新增 **Azure Batch Transcription（境外区域）** 通道：

- `packages/core/src/asr.ts`：
  - `resolveAzureSpeechConfig()`：读取 `AZURE_SPEECH_KEY / AZURE_SPEECH_REGION / AZURE_SPEECH_LOCALE`（默认 `en-US`）；
  - `transcribeAzureFile()`：POST `/speechtotext/v3.1/transcriptions` 创建任务 → 轮询 `self` 状态 → 拉取 `kind=Transcription` 结果 JSON → 按 100ns tick 时间戳解析分段。
- `subtitle.ts` `extractViaAsr()`：无字幕轨道（TikTok/YouTube 常见）时，yt-dlp 拿 `bestaudio/best` 直链 → 按配置选择 Azure / 百炼转写，作为 `subtitleType: "auto"` 返回。

### 3.1 踩坑一：`punctuationMode` 合法值拼错 → 400

Azure v3.1 创建任务返回 400（InvalidPayload），因为 `punctuationMode` 合法枚举是 **`DictatedAndAutomatic`**，错写成 `DictationAndAutomatic`（多了个 n）。同时补齐必填的 `timeToLiveHours`。

### 3.2 踩坑二：任务 `Failed` 但原因被丢弃

轮询到 `status === "Failed"` 时旧代码只抛固定文案"Azure 转写失败"，真实原因（`statusMessage` 等）全部丢失、并被上层 catch 静默吞掉，前端只能看到误导性的"无字幕"。修复：`Failed/超时` 分支把最近一次任务查询的 JSON 摘要带进错误信息，便于定位。

### 3.3 转写中文（AZURE_SPEECH_LOCALE）

Azure 批量转录按**单一 locale** 整段识别。纯中文视频把 `.env.local` 的 `AZURE_SPEECH_LOCALE` 改为 `zh-CN` 即可；中英混说话音建议按主语言设置（v3.1 不支持多语自动检测）。

---

## 4. YouTube 报"未找到可用字幕，无法进行 AI 总结（可能没有字幕或受版权保护）"

### 4.1 排查链（实测定位）

对用户视频 `youtube.com/shorts/OHrwq9ZT6-E?si=...`（无字幕轨）做了全链路复现：

1. `getVideoInfo`：`manualSubs=[]`，`automatic_captions=[]`；换 `player_client=web/tv/mweb` 均拿不到自动字幕 → 该视频**确实无公开字幕轨**；
2. 走 ASR 兜底：yt-dlp 能拿到音频直链（`googlevideo.com`），
3. Azure 创建任务 → **任务 `Failed`，且 `statusMessage` 为空** → 说明失败发生在"Azure 服务端下载该音频"环节：**YouTube 对数据中心 IP 访问 googlevideo 有限制/限流**。而 TikTok（`tiktokcdn`）音频 Azure 可正常下载转写（对照组成功）；
4. 失败结果被写入 Supabase `video_transcripts` 表**负缓存（无字幕）1 天** → 用户一整天内重试同样命中旧缓存，一直报错。

### 4.2 修复

- **错误原因透传**：`SubtitleResult` 新增 `error?: string`；`extractViaAsr` 失败时返回具体原因（"语音转写失败：转写服务无法取到该平台的音频（可能平台限制数据中心访问）…"），经 `subtitle-cache.ts` 透传到前端，不再猜测"没字幕/版权"；
- **负缓存收窄**：`NEGATIVE_TTL_MS` 从 24h 改为 **15 分钟**（提取失败/瞬时风控多为假阴性，避免锁死用户一整天）；
- summarize / mindmap / chat / subtitle 四个入口统一使用 `sub.error ?? 通用文案`。

### 4.3 遗留限制（平台硬约束，本地无法绕过）

无字幕轨 + 音频不对外部转写服务开放的视频（示例为 AI 生成的 Shorts）无法转写。多数 YouTube 视频有自动字幕轨，直接出字幕不触达本路径。

---

## 5. 同一视频第二次解析报 `HTTP Error 403: Forbidden`

### 5.1 现象

第一次解析成功，紧接着第二次解析同一 TikTok 视频报：

```
ERROR: [TikTok] <id>: Unable to download webpage: HTTP Error 403: Forbidden
```

### 5.2 根因

TikTok 对**同一出口 IP 高频、无 cookie 的网页抓取**有瞬时风控：首次放行 → 紧接着再抓 → 403 → 数分钟后恢复（复测复现成功）。`403` 属**瞬时性**错误，不是配置问题。

### 5.3 解决

`runYtDlp()` 增加自动重试：对 403/429、5xx、`transporterror`/connection 中断、`unable to download webpage`、`unexpected response from webpage` 等瞬时错误退避重试（3s / 6s），重试常可恢复。

---

## 6. 错误提示优化（不再抛原始英文 ERROR）

### 6.1 现象

解析/下载失败时前端直接显示 yt-dlp 原始输出：

```
ERROR: [TikTok] 7659351610841124104: Unable to download webpage: HTTP Error 403: Forbidden (caused by <HTTPError 403: Forbidden>)
```

### 6.2 解决（`packages/core/src/downloader.ts`）

- `classifyYtDlpError()` 增强分类：403/429、"page needs to be reloaded"、TikTok 反爬页面 = `anti_bot`；404/410 = `unsupported`；超时/连接 = `network`；
- `YTDLP_ERROR_HINTS` 文案平实化（"平台风控拦截了本次请求…请稍等 1~2 分钟再试/更换网络出口节点" 等）；
- 新增 `friendlyYtDlpError()`：`parse` / `download` / `direct-url` / `subtitle` 四个接口 catch 统一调用，原始错误只进服务端日志。

---

## 7. 功能补充记录

- **总结摘要"展开全部"**：与字幕文本一致，默认 `max-h-[500px]` 可滚动，点击展开/收起，切换视频自动重置；
- **转写语言**：`AZURE_SPEECH_LOCALE=zh-CN` 转写中文（见 3.3）。

---

## 8. 环境配置速查（`.env.local`）

```ini
# 出站代理（本机 Clash；yt-dlp 与海外 CDN 缩略图拉取共用）
PROXY_URL=http://127.0.0.1:7890

# Azure 语音服务（TikTok/YouTube 等海外平台语音转写）
AZURE_SPEECH_KEY=...
AZURE_SPEECH_REGION=koreacentral
AZURE_SPEECH_LOCALE=zh-CN
```

---

## 9. 关键经验小结

1. **海外平台的一切网络访问都统一走 `PROXY_URL`**（yt-dlp、缩略图代理），避免"一个地方能通一个地方不能"；
2. **Node 全局 fetch 与 undici `ProxyAgent` 不兼容**，代理请求要显式用 undici 自带 fetch；
3. **ASR 转写服务的服务端下载能力决定可用性**：海外音频直链必须配境外区域转写（百炼在大陆拉不到 googlevideo/tiktokcdn）；
4. **不要静默吞掉转写/提取失败**——错误要带真实原因透传，否则用户会被"无字幕/版权"误导；
5. **负缓存要短 TTL**（假阴性锁死用户一整天是最伤体验的错误之一）；
6. **TikTok/YouTube 的 403 多为瞬时风控**，自动重试即可恢复，无需视为致命错误。