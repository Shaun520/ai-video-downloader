/**
 * weibo.ts — 微博策略
 *
 * 实测结论（2026-09-15，video.weibo.com/show?fid=1034:{oid} 示例，probe11/probe-live 全链路验证）：
 *  - ① 访客 cookie：POST passport.weibo.com/visitor/genvisitor
 *       form: cb=gen_callback&fp={"android":{"device_id":""}}=
 *       → data.tid；再 GET passport.weibo.com/visitor/visitor?a=incarnate&t={tid}&w={3|2}&c=100&gc=&cb=cross_domain&from=weibo&_rand={r}
 *       → cookie jar 落地 SUB/SVB/SUBP/SRT/SRF，后续请求带上即可匿名访问
 *  - ② 取 mid：POST weibo.com/tv/api/component?page=/tv/show/1034:{oid}
 *       form: data={"Component_Play_Playinfo":{"oid":"1034:{oid}"}}；头 X-Requested-With: XMLHttpRequest、Referer 原链接
 *       → data.Component_Play_Playinfo.mid
 *  - ③ 详情：GET weibo.com/ajax/statuses/show?id={mid}（Referer https://weibo.com/）
 *       → 标题 page_info.media_info.kol_title || video_title || name
 *       → 直链 media_info.playback_list[].play_info.url（filter mime 以 video/ 开头，按 quality_desc 选最高清，跳过 image/jpeg scrubber 项）
 *       → 封面 page_info.page_pic；上传者 user.screen_name/id；时长 media_info.duration；发布时间 media_info.video_publish_time(unix)
 *  - 下载 Referer：https://weibo.com/
 */
import type { VideoFormat, VideoInfo } from "@saveany/shared";
import type { PlatformStrategy, StrategyContext, UniversalError } from "../types.js";
import { UniversalError as UE } from "../types.js";

function hostMatch(host: string): boolean {
  return host === "weibo.com" || host.endsWith(".weibo.com") || host === "weibo.cn" || host.endsWith(".weibo.cn");
}

/** 提取微博 oid：优先 "1034:{oid}" 形式，否则取首个 >=10 位数字 */
function extractOid(url: string): string | null {
  const full = /1034:(\d{6,})/.exec(url);
  if (full) return full[1];
  const num = /(\d{10,})/.exec(url);
  return num ? num[1] : null;
}

/** ① 获取访客 cookie（SUB），失败不影响已存在 cookie 的复用 */
async function ensureVisitor(http: import("../http.js").UniversalHttp): Promise<void> {
  if (http.jar.has()) return;
  const form = "cb=gen_callback&fp=" + encodeURIComponent(JSON.stringify({ android: { device_id: "" } })) + "=";
  const resp = await http.request("https://passport.weibo.com/visitor/genvisitor", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Referer: "https://weibo.com/" },
    body: form,
  });
  const text = await resp.text();
  const tid = /"tid":"([^"]+)"/.exec(text)?.[1];
  if (!tid) return;
  const newTid = /"new_tid":true/.test(text);
  await http.request(
    `https://passport.weibo.com/visitor/visitor?a=incarnate&t=${encodeURIComponent(tid)}&w=${newTid ? 3 : 2}&c=100&gc=&cb=cross_domain&from=weibo&_rand=${Math.random()}`,
    { headers: { Referer: "https://weibo.com/" } }
  );
}

async function fetchInfo(ctx: StrategyContext, oid: string): Promise<VideoInfo> {
  const { http } = ctx;
  await ensureVisitor(http);

  // ② component 拿 mid
  const playResp = await http.request(`https://weibo.com/tv/api/component?page=/tv/show/1034:${oid}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Requested-With": "XMLHttpRequest",
      Referer: `https://weibo.com/tv/show/1034:${oid}`,
    },
    body: "data=" + encodeURIComponent(JSON.stringify({ Component_Play_Playinfo: { oid: `1034:${oid}` } })),
  });
  let mid = "";
  try {
    const play = (await playResp.json()) as { data?: { Component_Play_Playinfo?: { mid?: string | number } } };
    const m = play?.data?.Component_Play_Playinfo?.mid;
    if (m != null) mid = String(m);
  } catch {
    /* 非 JSON（被重定向到登录/风控页）视为失败 */
  }
  if (!mid) throw new UE("needs_login", "微博视频解析失败（访客凭证失效），请稍后重试");

  // ③ 详情
  const show = await http.getJson<{ data?: Record<string, unknown> } | Record<string, unknown>>(
    `https://weibo.com/ajax/statuses/show?id=${mid}`,
    { Referer: "https://weibo.com/", Accept: "application/json,text/plain,*/*" }
  );
  const data = show && typeof show === "object" && "data" in show ? ((show as Record<string, unknown>).data as Record<string, unknown>) : (show as Record<string, unknown>);
  const pageInfo = (data?.page_info as Record<string, unknown>) || {};
  const media = (pageInfo.media_info as Record<string, unknown>) || {};
  const user = (data?.user as Record<string, unknown>) || {};

  // 直链：过滤非视频项（image/jpeg scrubber），quality_desc 高清优先
  const playback = Array.isArray(media.playback_list) ? (media.playback_list as Record<string, unknown>[]) : [];
  const rank = (desc: string): number => (/1080|全屏/.test(desc) ? 3 : /高清/.test(desc) ? 2 : /标清/.test(desc) ? 1 : 0);
  const candidates = playback
    .map((p) => (p.play_info as Record<string, unknown>) || {})
    .filter((p) => String(p.mime || "").startsWith("video/") && typeof p.url === "string" && p.url.startsWith("http"))
    .sort((a, b) => rank(String(a.quality_desc)) - rank(String(b.quality_desc)));
  const playInfo = candidates[candidates.length - 1];
  const directUrl = (playInfo?.url as string) || (media.stream_url_hd as string) || (media.stream_url as string);
  if (!directUrl) throw new UE("not_found", "未找到微博视频播放地址");

  const title = String(media.kol_title || media.video_title || media.name || data.text || "微博视频").replace(/<[^>]+>/g, "").slice(0, 200);
  const width = typeof media.width === "number" ? media.width : undefined;
  const height = typeof media.height === "number" ? media.height : undefined;

  const format: VideoFormat = {
    formatId: "weibo_nowm",
    ext: "mp4",
    resolution: width && height ? `${width}x${height}` : "原始",
    height,
    filesize: null,
    vcodec: "h264",
    acodec: "aac",
    hasAudio: true,
    label: `无水印 MP4${playInfo?.quality_desc ? ` (${playInfo.quality_desc})` : ""}`,
    url: directUrl,
  };

  return {
    id: mid,
    title,
    description: typeof data.text === "string" ? data.text.replace(/<[^>]+>/g, "").slice(0, 200) : undefined,
    thumbnail: typeof pageInfo.page_pic === "string" ? pageInfo.page_pic : (media.poster as string) || "",
    duration: typeof media.duration === "number" ? media.duration : undefined,
    uploader: (user.screen_name as string) || "微博用户",
    uploaderId: user.id != null ? String(user.id) : undefined,
    uploadDate: typeof media.video_publish_time === "number" ? new Date(media.video_publish_time * 1000).toISOString().slice(0, 10) : undefined,
    platform: "weibo",
    directUrl,
    formats: [format],
    subtitles: [],
    url: ctx.url,
  };
}

export const weiboStrategy: PlatformStrategy = {
  id: "weibo",
  label: "微博",
  match: hostMatch,
  referer: "https://weibo.com/",

  async resolve(ctx: StrategyContext): Promise<VideoInfo> {
    const input = ctx.extractUrl(ctx.url);
    const oid = extractOid(input);
    if (!oid) throw new UE("unsupported", "无法从微博链接中识别视频 ID");
    // 访客凭证偶发失效：完整流程重试一次（jar 内已带 cookie，二次走 component 即可生效）
    let lastErr: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await fetchInfo(ctx, oid);
      } catch (e) {
        lastErr = e;
        if (attempt === 0 && e instanceof UE && (e.kind === "needs_login" || e.kind === "not_found")) {
          // 清空 jar 重新获取访客 cookie 再试
          ctx.http.jar.clear();
          continue;
        }
        throw e;
      }
    }
    throw lastErr instanceof Error ? lastErr : new UE("unknown", "微博解析失败");
  },
};

export type { UniversalError };