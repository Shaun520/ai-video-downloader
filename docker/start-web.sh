#!/bin/sh
# start-web.sh — CloudBase 云托管启动入口
# 1) 若配置了 TAILSCALE_AUTHKEY，则以 userspace 模式启动 tailscaled（不需要 /dev/net/tun，
#    CloudBase 这类 serverless 容器可用），把流量经家庭 Clash 代理出海；
# 2) 启动 Next.js 应用。
set -u

if [ -n "${TAILSCALE_AUTHKEY:-}" ]; then
  echo "[start] 检测到 TAILSCALE_AUTHKEY，启动 tailscaled（userspace 模式）..."

  # 启动 tailscaled：userspace 网络 + 本机 SOCKS5/HTTP 代理（两者同端口）
  tailscaled \
    --tun=userspace-networking \
    --socks5-server=127.0.0.1:1055 \
    --outbound-http-proxy-listen=127.0.0.1:1055 &
  TAILSCALED_PID=$!

  # 等待 tailscaled 就绪
  for i in $(seq 1 15); do
    if tailscale version >/dev/null 2>&1; then break; fi
    sleep 1
  done

  # 登录并加入 tailnet（ephemeral 节点，容器销毁后自动清理）
  tailscale up --authkey="$TAILSCALE_AUTHKEY" --hostname=saveany-web-cloudrun --timeout=30s

  # 等待节点上线拿到 IP，确保代理目标可达后才放行业务流量
  UP=
  for i in $(seq 1 30); do
    if tsip=$(tailscale ip -4 2>/dev/null); then
      UP=1
      echo "[start] Tailscale 上线：$tsip"
      break
    fi
    sleep 1
  done

  if [ -n "$UP" ]; then
    # yt-dlp 等出站代理走本机 tailscale 提供的 SOCKS5，经家庭 Clash 出海
    export PROXY_URL="socks5://127.0.0.1:1055"
    export HTTP_PROXY="$PROXY_URL"
    export HTTPS_PROXY="$PROXY_URL"
    export ALL_PROXY="$PROXY_URL"
    echo "[start] PROXY_URL=$PROXY_URL"
  else
    echo "[start] 警告：Tailscale 30s 内未上线，继续以直连模式启动（海外平台将不可用）"
  fi
else
  echo "[start] 未配置 TAILSCALE_AUTHKEY，以直连模式运行"
fi

cd /app/apps/web || exit 1
echo "[start] 启动 Next.js（端口 ${PORT:-3000}）..."
exec node node_modules/next/dist/bin/next start -p "${PORT:-3000}"