# AI 视频下载器（ai-video-downloader）

> 粘贴链接即可解析下载多平台视频，并用 AI 一键生成内容总结、思维导图与字幕。

「AI 视频下载器」是一个免费的视频解析下载与 AI 总结工具：输入一个视频链接，自动解析出清晰度列表并提供直链 / 服务端下载；登录后还可基于视频字幕生成 **AI 摘要、思维导图、字幕导出与视频问答**。支持辅助国内用户下载 YouTube、B 站、抖音（无水印）等平台视频，集成了账号体系与会员付费，是一个可上线运营的完整产品。

> 合规声明：本项目仅供技术学习与研究。请仅下载你拥有版权或已获授权的内容（如备份自己的视频、下载公开授权的免版权素材），并遵守所在地区法律法规及平台服务条款。开发者不对用户使用行为承担责任。

---

## 功能特性

- **多平台解析下载**：基于 yt-dlp 支持 YouTube / B 站 / 抖音等 1800+ 平台；抖音有专用解析模块，免 Cookie 获取无水印视频
- **智能清晰度选择**：解析结果展示音视频/格式/分辨率，合并格式自动走服务端合成，单文件格式走源站直链（blob 强制保存）
- **AI 总结摘要**：基于视频字幕流式生成中文总结，Markdown 排版
- **思维导图**：将视频内容结构化为可视化脑图（markmap 交互式渲染）
- **字幕提取导出**：支持人工字幕 / 自动字幕（含 B 站 AI 字幕与 b23 短链），在线预览并可导出 SRT / VTT / TXT
- **视频问答**：结合字幕与 AI 对话，随时追问视频内容
- **账号体系**：Supabase 邮箱认证 + 每日免费额度（默认 3 次总结/日）
- **会员付费**：Stripe Checkout 订阅（月度/年度），支付回调自动开通 VIP（当前定价 ¥9.9/月）
- **管理后台**：用户管理（调整 VIP）、订单管理、数据统计
- **部署友好**：Web/Admin 可部署到 Cloudflare Pages，核心服务可打包 Docker 部署到 Cloudflare Containers

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | Next.js 16（App Router）+ React + Tailwind CSS 4 + markmap |
| 后端 | Next.js Route Handlers（SSE 流式）+ 独立 Node 容器服务 |
| 视频解析 | yt-dlp + ffmpeg + 抖音专用解析器 |
| AI | DeepSeek（SSE 流式总结 / 思维导图 / 问答） |
| 数据与认证 | Supabase（PostgreSQL + RLS + Auth） |
| 支付 | Stripe Checkout + Webhook |
| 工程化 | pnpm + Turborepo Monorepo + TypeScript |

## 项目结构

```text
.
├── apps
│   ├── web          # 主站（营销页 + 解析下载 + AI 工作台），Next.js
│   ├── admin        # 管理后台（用户/订单/VIP），Next.js
│   └── container    # 核心容器服务（/parse /direct-url /subtitle），可 Docker 化
├── packages
│   ├── core         # 视频解析 / 下载 / 字幕 / AI 总结 核心逻辑（TS）
│   ├── db           # Supabase 数据访问与配额/订单/VIP 逻辑
│   └── shared       # 跨端共享类型与常量
├── supabase         # 数据库建表 / RLS 规则 SQL
└── docs             # 开发方案与文档
```

## 快速开始

环境要求：Node.js 22+、pnpm 10+；解析下载功能依赖系统可用的 `yt-dlp` 与 `ffmpeg`（容器镜像内已内置）。

```bash
# 1. 安装依赖
pnpm install

# 2. 配置环境变量（复制示例文件并填入真实值）
cp apps/web/.env.example apps/web/.env.local
cp apps/admin/.env.example apps/admin/.env.local

# 3. 初始化数据库（Supabase SQL 编辑器执行 supabase/ 目录下的建表与 RLS 脚本）

# 4. 启动
pnpm --filter web dev               # 主站 → http://localhost:3000
pnpm --filter admin dev -- --port 3001  # 管理后台 → http://localhost:3001
node apps/container/server.mjs      # 核心容器服务 → http://localhost:8788/health（可选）
```

## 环境变量

### apps/web（主站）

| 变量 | 说明 |
|---|---|
| NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY | Supabase 项目地址与匿名密钥 |
| SUPABASE_SERVICE_ROLE_KEY | 服务端管理密钥（仅服务端使用） |
| DEEPSEEK_API_KEY | DeepSeek 密钥（AI 总结/思维导图/问答） |
| STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET / STRIPE_PRICE_ID_MONTHLY / STRIPE_PRICE_ID_YEARLY | Stripe 支付（可选，未配置时支付按钮优雅降级） |
| NEXT_PUBLIC_APP_URL | 站点入口地址（支付回调用） |

### apps/admin（管理后台）

| 变量 | 说明 |
|---|---|
| ADMIN_PASSWORD | 管理后台登录密码（生产环境务必修改） |
| SUPABASE_SERVICE_ROLE_KEY 等 | 同主站（service_role 仅服务端） |

## 部署

- **Web / Admin**：`pnpm --filter web exec opennextjs-cloudflare` 后发布到 Cloudflare Pages，密钥用 Pages 环境变量/Secret 注入
- **核心容器服务**：参考 `apps/container/Dockerfile` 构建镜像（已内置 yt-dlp + ffmpeg），发布到 Cloudflare Containers，供 /parse、/direct-url、/subtitle 调用
- **Stripe**：在 Stripe 后台配置 Webhook，指向 `{站点}/api/stripe/webhook`，订阅 `checkout.session.completed` 等事件以自动开通 VIP

## 致谢

本项目在功能与结构上参考了开源项目 [liyupi/free-video-downloader](https://github.com/liyupi/free-video-downloader)（MIT License），后端核心解析与前端交互均在此基础上重写与扩展。感谢原作者 [程序员鱼皮](https://yuyuanweb.feishu.cn) 的开源分享。

## License

MIT License