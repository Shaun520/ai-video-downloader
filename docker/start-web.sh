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

  # 等待 tailscaled 接受本地命令
  READY=
  for i in $(seq 1 15); do
    if tailscale version >/dev/null 2>&1; then READY=1; break; fi
    sleep 1
  done

  if [ -z "$READY" ]; then
    echo "[start] 警告：tailscaled 未就绪，跳过 Tailscale，直连模式启动"
  else
    # 可选：配置出口节点（你家电脑的 Tailscale IP），公网流量经它再出海
    # 需要满足：① 家电脑开启 exit node;② Clash 开 TUN/系统代理;③ 管理台批准该节点
    EXIT_ARGS=
    if [ -n "${TS_EXIT_NODE:-}" ]; then
      EXIT_ARGS="--exit-node=$TS_EXIT_NODE --exit-node-allow-lan-access"
      echo "[start] 使用出口节点：$TS_EXIT_NODE（公网流量经你家电脑出海）"
    fi

    # 后台登录 tailnet（ephemeral 节点）；失败不阻塞业务启动，错误会打印到日志便于诊断
    # shellcheck disable=SC2086
    tailscale up --authkey="$TAILSCALE_AUTHKEY" --hostname=saveany-web-cloudrun $EXIT_ARGS 2>&1 &
    TAILSCALE_UP_PID=$!

    # 等待节点上线拿到 IP，确保代理目标可达后才设置出站代理
    UP=
    for i in $(seq 1 60); do
      if tsip=$(tailscale ip -4 2>/dev/null); then
        UP=1
        echo "[start] Tailscale 上线：$tsip"
        break
      fi
      sleep 1
    done

    if [ -n "$UP" ]; then
      # 方案：直接用你家电脑的 Clash 当上游代理（不依赖出口节点，避免 Windows TUN 不拦截转发流量的坑）
      # UPSTREAM_PROXY_TAILNET = 你家电脑 Clash 的 tailnet 地址:端口，如 100.64.112.93:7890
      # 需要你家 Clash 开启「允许局域网 / Allow LAN」
      if [ -n "${UPSTREAM_PROXY_TAILNET:-}" ]; then
        CLASH_HOST="${UPSTREAM_PROXY_TAILNET%%:*}"
        CLASH_PORT="${UPSTREAM_PROXY_TAILNET##*:}"
        echo "[start] 用 socat 桥接本地 17890 -> Tailscale -> 你家 Clash ${CLASH_HOST}:${CLASH_PORT}"
        # socat 监听本地 17890，经 Tailscale SOCKS5(127.0.0.1:1055) 转发到你家 Clash
        socat TCP-LISTEN:17890,fork,reuseaddr \
          SOCKS5:127.0.0.1:${CLASH_HOST}:${CLASH_PORT},socksport=1055,socks5auth=none &
        SOCAT_PID=$!
        sleep 1
        if kill -0 "$SOCAT_PID" 2>/dev/null; then
          export PROXY_URL="http://127.0.0.1:17890"
          export HTTP_PROXY="$PROXY_URL"
          export HTTPS_PROXY="$PROXY_URL"
          export ALL_PROXY="$PROXY_URL"
          echo "[start] PROXY_URL=$PROXY_URL（经你家 Clash 出海）"
        else
          echo "[start] ❌ socat 启动失败，回退直连（海外平台不可用）"
        fi
      else
        # 未配置上游代理：仅用 Tailscale SOCKS5（访问 tailnet 内资源；公网直连会被墙）
        export PROXY_URL="socks5://127.0.0.1:1055"
        export HTTP_PROXY="$PROXY_URL"
        export HTTPS_PROXY="$PROXY_URL"
        export ALL_PROXY="$PROXY_URL"
        echo "[start] PROXY_URL=$PROXY_URL（未配置 UPSTREAM_PROXY_TAILNET，公网流量走容器直连）"
      fi
      # 出海自检：确认流量是否真的经你家 Clash 到达公网（非致命，仅诊断）
      echo "[start] 出海自检开始（最多 ~15s）..."
      if command -v curl >/dev/null 2>&1; then
        IP=$(curl -sS -m 12 https://api.ipify.org 2>/dev/null || true)
        if [ -n "$IP" ]; then
          echo "[start] ✅ 出海成功，当前公网出口 IP = $IP"
        else
          echo "[start] ❌ 出海失败：无法从公网获取 IP（请检查家端 Clash Allow LAN / 端口 / 节点）"
        fi
      else
        echo "[start] 容器无 curl，跳过出海自检"
      fi
    else
      echo "[start] 警告：Tailscale 60s 内未上线，继续以直连模式启动（海外平台不可用）。tailscale up 仍在后台重试，报错请看上方日志"
    fi
  fi
else
  echo "[start] 未配置 TAILSCALE_AUTHKEY，以直连模式运行"
fi

cd /app/apps/web || exit 1
echo "[start] 启动 Next.js（端口 ${PORT:-3000}）..."
exec node node_modules/next/dist/bin/next start -p "${PORT:-3000}"