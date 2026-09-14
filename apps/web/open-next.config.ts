// OpenNext Cloudflare 配置（@opennextjs/cloudflare）
// 本应用未使用 ISR/数据缓存，使用默认（noop）增量缓存即可，无需 R2/KV。
import { defineCloudflareConfig } from "@opennextjs/cloudflare";

export default defineCloudflareConfig({});