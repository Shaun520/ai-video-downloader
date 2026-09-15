#!/usr/bin/env python3
"""
socks-bridge.py — 把容器本地 TCP 端口经 Tailscale SOCKS5 转发到你家 Clash。
用法：python3 socks-bridge.py 17890 127.0.0.1 1055 100.64.112.93 7890
  监听 17890 -> 经 SOCKS5(127.0.0.1:1055) -> 目标 100.64.112.93:7890
"""
import socket
import struct
import sys
import threading


def socks5_connect(proxy_host, proxy_port, target_host, target_port):
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(15)
    s.connect((proxy_host, proxy_port))
    # 握手：无认证
    s.sendall(b"\x05\x01\x00")
    resp = s.recv(2)
    if resp != b"\x05\x00":
        s.close()
        raise RuntimeError(f"SOCKS5 握手失败: {resp!r}")
    # 连接请求（域名方式）
    addr = target_host.encode()
    req = b"\x05\x01\x00\x03" + bytes([len(addr)]) + addr + struct.pack(">H", target_port)
    s.sendall(req)
    resp = s.recv(10)
    if len(resp) < 2 or resp[1] != 0x00:
        s.close()
        raise RuntimeError(f"SOCKS5 连接失败 code={resp[1] if len(resp) > 1 else '?'}")
    s.settimeout(None)
    return s


def pipe(src, dst):
    try:
        while True:
            data = src.recv(65536)
            if not data:
                break
            dst.sendall(data)
    except Exception:
        pass
    finally:
        for sock in (src, dst):
            try:
                sock.close()
            except Exception:
                pass


def handle(client, proxy_host, proxy_port, target_host, target_port):
    try:
        remote = socks5_connect(proxy_host, proxy_port, target_host, target_port)
    except Exception as e:
        print(f"[bridge] 连不上目标 {target_host}:{target_port}: {e}", flush=True)
        client.close()
        return
    t1 = threading.Thread(target=pipe, args=(client, remote), daemon=True)
    t2 = threading.Thread(target=pipe, args=(remote, client), daemon=True)
    t1.start()
    t2.start()


def main():
    if len(sys.argv) != 6:
        print("用法: socks-bridge.py <local_port> <socks_host> <socks_port> <target_host> <target_port>", file=sys.stderr)
        sys.exit(1)
    local_port = int(sys.argv[1])
    socks_host = sys.argv[2]
    socks_port = int(sys.argv[3])
    target_host = sys.argv[4]
    target_port = int(sys.argv[5])

    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind(("127.0.0.1", local_port))
    server.listen(50)
    print(f"[bridge] 监听 127.0.0.1:{local_port} -> SOCKS5 {socks_host}:{socks_port} -> {target_host}:{target_port}", flush=True)

    while True:
        client, _ = server.accept()
        threading.Thread(
            target=handle,
            args=(client, socks_host, socks_port, target_host, target_port),
            daemon=True,
        ).start()


if __name__ == "__main__":
    main()