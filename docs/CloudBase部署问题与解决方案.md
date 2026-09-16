# CloudBase 部署问题与解决方案

记录将 video-downloader 项目部署到腾讯云 CloudBase 云托管过程中遇到的所有问题及最终解决方案。

---

## 一、架构决策

### 为什么必须用容器（不能用 Serverless/Workers）

项目依赖 `yt-dlp`（Python 程序）和 `ffmpeg` 二进制进行视频解析下载，这些无法在 Cloudflare Workers、Vercel Serverless 等无运行时文件系统的环境中运行。因此选择 **CloudBase 云托管（容器）** 方案。

### 海外视频平台访问问题

TikTok、YouTube 等平台在中国大陆网络不可直连。CloudBase 容器出口 IP 在国内，必须配置代理才能访问海外平台。

---

## 二、环境变量相关

### 问题 1：NEXT_PUBLIC_* 环境变量不生效

**现象**：在 CloudBase 控制台"环境变量"里填了 `NEXT_PUBLIC_SUPABASE_URL` 等，但页面拿不到值。

**原因**：`NEXT_PUBLIC_*` 是 Next.js 的**构建期内联变量**，`next build` 时就被替换进 JS bundle。CloudBase 控制台的环境变量是**运行时**注入，对已构建的产物无效。而 CloudBase 云托管**不支持构建参数**。

**解决方案**：将 `NEXT_PUBLIC_*` 三个值直接写死在 Dockerfile 的 `ARG` 中。这三个值（Supabase URL、anon key、APP_URL）均为公开值，写进公开仓库无安全风险。真正的密钥（service_role_key、API key 等）仍走控制台环境变量。

```dockerfile
ARG NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
ARG NEXT_PUBLIC_APP_URL=https://your-domain.com
```

---

## 三、CloudBase 平台机制

### 问题 2：修改环境变量后不生效

**现象**：在控制台改了环境变量，容器日志里还是旧值。

**原因**：CloudBase 云托管的环境变量**绑定服务版本**，每个版本独立。创建版本时的环境变量会固化进该版本，之后在"服务设置"里改配置**不会影响已运行的版本**。

**解决方案**：修改环境变量后，必须**新建版本**并在新版本配置里确认环境变量，部署后将流量切到新版本。

### 问题 3：旧实例一直被访问

**现象**：新建了版本，但请求还是打到旧实例。

**原因**：CloudBase 的流量不会自动切到新版本，需要手动配置。

**解决方案**：版本管理 → 找到最新版本 → 流量配置 → 设为 100%。

---

## 四、Tailscale 出海代理方案

### 整体架构

```
CloudBase 容器(yt-dlp) → Tailscale隧道 → 家庭电脑(Clash) → 海外节点 → YouTube/TikTok
```

### 问题 4：Tailscale auth key 无效

**现象**：日志报 `invalid key: API key xxx not valid`。

**原因**：复制错了。Tailscale 控制台 Keys 页有两类：
- **Auth keys**（`tskey-auth-xxx`）—— 用于 `tailscale up --authkey`
- **API access tokens** —— 用于调用 Tailscale API

另外单次使用的 key 用完即废。

**解决方案**：在 [Keys 页面](https://login.tailscale.com/admin/settings/keys) 生成 **Auth key**，勾选 **Reusable**（可复用），完整复制 `tskey-auth-xxx` 格式的字符串。

### 问题 5：tailscale up 的 --timeout 参数报错

**现象**：`tailscale up --authkey=xxx --timeout=30s` 报错。

**原因**：`tailscale up` 命令不支持 `--timeout` 参数。

**解决方案**：移除 `--timeout`，改用后台启动 + 轮询 `tailscale ip -4` 判断上线状态。

### 问题 6：Tailscale userspace 模式

**现象**：CloudBase 容器没有 `/dev/net/tun` 设备，普通 Tailscale 模式无法运行。

**原因**：serverless 容器通常不提供 tun 设备。

**解决方案**：使用 Tailscale 的 **userspace networking 模式**（`--tun=userspace-networking`），不需要 tun 设备，tailscaled 本身提供 SOCKS5/HTTP 代理。

```sh
tailscaled --tun=userspace-networking --socks5-server=127.0.0.1:1055 &
tailscale up --authkey=$TAILSCALE_AUTHKEY
```

### 问题 7：出口节点（Exit Node）在 Windows + Clash TUN 下不工作

**现象**：配置了出口节点（`--exit-node=家电脑IP`），但日志显示 `socks5: client connection failed: context deadline exceeded`，YouTube 解析超时。

**原因**：Windows 的 Clash TUN 模式（WFP 方案）**只拦截本机进程发起的出站连接**，不拦截从 Tailscale 进来的"转发流量"。容器的公网流量到达家电脑后，直接从物理网卡（中国宽带）出去，被墙。

**解决方案**：**不用出口节点**。改用端口桥接方案——容器直接通过 Tailscale SOCKS5 代理访问家电脑的 Clash 代理端口：

```
yt-dlp → 容器本地桥接器 → Tailscale SOCKS5 → 家电脑Clash(IP:7890) → 海外
```

需要家电脑 Clash 开启 **Allow LAN**（允许局域网连接）。

### 问题 8：socat 不支持 SOCKS5

**现象**：`socat ... SOCKS5:...` 报错 `unknown device/address "SOCKS5"`。

**原因**：Debian slim 镜像里的 socat 编译时未启用 SOCKS 支持。

**解决方案**：用 **Python 手写 SOCKS5 桥接器**（容器里已有 Python3，无需额外依赖）。脚本见 `docker/socks-bridge.py`：

- 监听容器本地端口 17890
- 经 Tailscale SOCKS5（127.0.0.1:1055）转发到家电脑 Clash 端口
- yt-dlp 的 `PROXY_URL` 设为 `http://127.0.0.1:17890`

### 问题 9：YouTube 字幕下载 429 Too Many Requests

**现象**：出海链路已通，视频解析成功，但下载字幕（timedtext 接口）时返回 HTTP 429。

**原因**：
1. 出口 IP（Clash 节点）是共享/数据中心 IP，被 YouTube 标记，限流阈值低
2. 未传 YouTube cookies，匿名请求更易被限流
3. 短时间内请求频率过高

**解决方案**（按优先级）：
1. 更换 Clash 节点（换地区/换住宅 IP 节点）
2. 等待 1-2 分钟后重试（限流是临时的）
3. 如需长期稳定，可接入 YouTube cookies 或做请求间隔/退避控制

---

## 五、域名与备案

### 默认域名

CloudBase 分配的 `*.run.tcloudbase.com` 默认域名**不需要备案**，平台已完成合规。但仅供开发测试，有访问频率限制，且首次访问会显示"测试域名"确认页。

### 自定义域名

绑定自己的域名**必须 ICP 备案**。且 CloudBase 免费体验版不支持备案，需升级套餐。

---

## 六、关键环境变量清单

| 变量 | 位置 | 说明 |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Dockerfile ARG | 构建期内联，公开值 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Dockerfile ARG | 构建期内联，公开值 |
| `NEXT_PUBLIC_APP_URL` | Dockerfile ARG | 构建期内联，支付回调域名 |
| `SUPABASE_SERVICE_ROLE_KEY` | 控制台环境变量 | 运行时密钥，不可入库 |
| `DEEPSEEK_API_KEY` | 控制台环境变量 | AI 总结用（可选） |
| `TAILSCALE_AUTHKEY` | 控制台环境变量 | Tailscale 加入网络用 |
| `UPSTREAM_PROXY_TAILNET` | 控制台环境变量 | 家电脑 Clash 的 tailnet 地址:端口，如 `100.64.112.93:7890` |

---

## 七、文件清单

| 文件 | 作用 |
|---|---|
| `Dockerfile.web` | Web 应用容器镜像（含 ffmpeg、yt-dlp、Tailscale、Python 桥接器） |
| `Dockerfile.admin` | Admin 后台容器镜像 |
| `docker/start-web.sh` | 容器启动入口（Tailscale + 代理桥接 + Next.js） |
| `docker/socks-bridge.py` | Python SOCKS5 端口桥接器 |
| `.dockerignore` | Docker 构建上下文排除规则 |
