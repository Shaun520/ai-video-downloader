# 抖音字幕提取修复记录：ttwid 访客 Cookie 与 "Fresh cookies needed"

> 记录日期：2026-09-14
> 相关文件：`packages/core/src/douyin.ts`、`packages/core/src/subtitle.ts`

---

## 1. 问题现象

抖音视频的「AI 总结」功能报错：

```
ERROR: [Douyin] 7684959632527248683: Fresh cookies (not necessarily logged in) are needed
```

而同一视频的**下载**功能正常。这说明失败发生在字幕提取阶段，而非视频解析阶段。

## 2. 根因分析（两层）

### 2.1 表层：yt-dlp 的抖音提取器强制要求 Cookie

字幕提取的通用链路是调用 `yt-dlp --dump-single-json` / `--write-subs`。yt-dlp 的抖音（Douyin/TikTok）提取器为了拿到视频元数据，要求请求携带「较新（fresh）」的 Cookie，否则直接拒绝并抛出 `Fresh cookies are needed`。

曾尝试把访客 Cookie（`ttwid`）手动喂给 yt-dlp，仍然失败——yt-dlp 抖音提取器校验的 Cookie 远不止 `ttwid` 一项，手动拼接难以凑齐它认可的完整集合。

### 2.2 深层：分享页 SSR 是"看人下菜"的

抖音分享页（`https://www.iesdouyin.com/share/video/<id>/`）是服务端渲染（SSR），但不同会话拿到的 HTML 完全不同：

| 会话状态 | 页面返回 |
| --- | --- |
| 无 Cookie | 只有「打开 App」壳，`window._ROUTER_DATA` 里没有任何视频数据 |
| 携带 `ttwid` 访客 Cookie | 返回完整数据：`loaderData[*].videoInfoRes.item_list[0]` 包含视频信息 |

`ttwid` 是抖音下发的**游客身份 Cookie**，不需要登录。问题在于：**第一次请求时你没有它，服务器只有在响应里才把它发给你**——典型的"先有鸡还是先有蛋"。

## 3. 原仓库的做法：带 Cookie 重试，"碰"到有数据的页面

原 Python 仓库（`backend/douyin.py`，已被 TS 版逐行翻译）能稳定工作的本质是：

```python
session = requests.Session()   # 自动累积 set-cookie
resp = session.get(share_url)  # 第 1 次：无 Cookie → 可能只有"打开 App"壳，但拿到了 ttwid
resp = session.get(share_url)  # 第 2/3/… 次：带上 ttwid 重试 → 命中带完整数据的页面
```

`requests.Session()` 会自动保存每次响应的 `Set-Cookie`（含 `ttwid`、`__ac_nonce` 等），并在后续请求中自动携带。于是：

- 第 1 次请求：无 Cookie，可能拿不到数据，但**收获 `ttwid`**；
- 再带 `ttwid` 重试：大概率命中带完整数据的页面。

本质是**"带 Cookie 重试，直到碰中带数据的页面"**，带一定碰运气成分：如果服务器下发 Cookie 的节奏慢、或重试窗口内拿到的仍不是目标 `ttwid`，就会失败。

## 4. TS 版移植：CookieJar 复刻 requests.Session

`packages/core/src/douyin.ts` 用轻量 `CookieJar` 复刻了这一行为，并优化了停止条件：

- `CookieJar`：跨请求保存/携带 Cookie（`set` / `header`），等价于 `requests.Session()`；
- `fetchViaSharePage`：最多重试 6 次，每次请求后计算 Cookie 指纹（`fingerprint`）；
  - 若两次请求间 **Cookie 不再变化**，说明服务器已不下发新标识，继续重试无意义 → 提前退出；
- 附带 WAF 反爬处理（`solveWafAndRetry`：`wci`/`cs` 挑战的 sha256 前缀爆破），也是原仓库行为。

期间的实验文件 `downloads/exp-yt-ttwid.mjs` 验证了：**只喂 `ttwid` 给 yt-dlp 并不能满足其抖音提取器**，从而确定了"抖音字幕不走 yt-dlp"的方向。

## 5. 本次修复

### 5.1 解决字幕提取的 Cookie 报错

- `douyin.ts`：新增 `fetchItem(url)`，把 `resolveItem` 公共链路（提取链接 → 重定向 → video_id → 元数据）暴露出来，供字幕等扩展复用原始 `AwemeItem`；
- `subtitle.ts`：`extract()` 新增抖音专用分支 `extractDouyin()`：
  - 抖音链接**不再调用 yt-dlp**（规避其 Cookie 强制校验）；
  - 改用 `DouyinParser.fetchItem()` 走分享页数据源，确认视频可访问；
  - 抖音视频**无公开字幕轨道**，直接返回 `hasSubtitle: false`，整体 try/catch 兜底，不让任何原始错误冒泡。

### 5.2 效果

- AI 总结对抖音视频不再抛 `Fresh cookies are needed`，而是提示「未找到可用字幕，无法进行 AI 总结」——优雅降级；
- 下载功能不受影响（下载本来就走 `DouyinParser`，与 yt-dlp 无关）。

## 6. 实测结论（2026-09-14）：字幕提取不可行，当前"无字幕降级"是正确选择

用户追问"字幕提取阶段能否也用分享页方法实现"，为此做了一轮全链路实测（存证脚本 `downloads/exp-douyin-subtitle.mjs`）：

| 数据源 | 是否可用 Cookie 重试法 | 字幕结果 |
| --- | --- | --- |
| 分享页 SSR（`iesdouyin.com/share/video/<id>/`） | ✅ 可用（`fetchViaSharePage`） | item 无任何 subtitle/caption 字段 |
| iteminfo API（`web/api/v2/aweme/iteminfo/`） | ⚠️ 时好时坏 | 返回空；有数据时也无字幕字段 |
| Web 详情 API（`aweme/v1/web/aweme/detail/`） | ✅ 目前免 `a_bogus` 签名可用 | 探测 **80+ 视频（用户视频 1 + 热榜 79）零命中** `video.subtitle` |
| 热榜/推荐 feed API、搜索页 SSR | ❌ 需签名 / 空壳 | — |

额外做了子串扫描：所有视频的分享页 HTML 命中 "subtitle/caption" 全是 HTML 样板（`<caption>`、`<figcaption>` 标签名、`special-case-subtitle` 样式类），与视频字幕无关。

**结论**：抖音公开 Web 数据源均不暴露字幕轨道。App 内看到的"字幕"是客户端语音识别生成或创作者烧录进视频的画面，无服务端字幕文件可抓。因此字幕提取**无法**借用分享页 Cookie 重试法实现，`extractDouyin()` 返回 `hasSubtitle: false` 的优雅降级是当前正确做法——下载/解析链路复用 CookieJar 重试法，字幕链路明确不适用。

## 7. 遗留问题与后续方向

- 受上述实测限制，AI 总结对抖音视频**无法真正生成**，属平台能力边界；
- 若未来抖音开放字幕接口，`extractDouyin()` 只需在 `fetchViaSharePage`/详情 API 返回中检测 `video.subtitle` 并解析其 JSON 分段（`{text, start, end}`），结构上已预留分支，无需重构。