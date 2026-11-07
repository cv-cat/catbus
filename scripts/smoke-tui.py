#!/usr/bin/env python3
"""catbus tui 的伪终端冒烟测试（AGENTS 7.5）：在真实的 pty 里启动界面、进出备用屏幕、按键、退出。

只用标准库，POSIX 专用（Windows 没有 pty 模块）。由 scripts/smoke.mjs 在有 python3 的 POSIX 系统上调用。
用法：python3 scripts/smoke-tui.py <catbus 命令或 js 入口...>
成功时退出码 0，并在 stdout 打印每一项检查；任何一项失败退出码 1。
"""
import fcntl, os, pty, re, select, signal, struct, sys, tempfile, termios, time

CMD = sys.argv[1:] or ["catbus"]
ANSI = re.compile(r"\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)")


def session(cols, rows, steps):
    """在 pty 里跑 `catbus tui`，依次执行 steps，返回 (输出, 是否已退出, 退出状态)。

    等待都是“等条件成立，最多等多久”，不是睡固定时间：CI 的虚拟机（尤其 macOS）又慢又抖，
    固定的 0.7 秒窗口会让“按 q 之后进程有没有退出”这类检查偶尔失败。
    """
    home = tempfile.mkdtemp(prefix="catbus-smoke-tui-")
    pid, fd = pty.fork()
    if pid == 0:
        env = dict(os.environ, TERM="xterm-256color", COLORTERM="truecolor", CATBUS_HOME=home, CATBUS_TUI_ANIMATE="0")
        os.execvpe(CMD[0], CMD + ["tui"], env)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
    buf = b""
    state = {"exited": False, "status": 0}

    def reap():
        """非阻塞地看子进程退出了没有。"""
        if state["exited"]:
            return True
        done, status = os.waitpid(pid, os.WNOHANG)
        if done != 0:
            state["exited"], state["status"] = True, status
        return state["exited"]

    def drain(seconds, until=None):
        """读 pty 输出，最多 seconds 秒；until 成立（或子进程退出）就提前返回。"""
        nonlocal buf
        end = time.time() + seconds
        while time.time() < end:
            r, _, _ = select.select([fd], [], [], 0.05)
            if r:
                try:
                    data = os.read(fd, 65536)
                except OSError:
                    reap()
                    return
                if not data:
                    reap()
                    return
                buf += data
            if until is not None and until():
                return
            if reap():
                return

    def raw_mode():
        """终端是否已被程序切到原始模式（ICANON 关掉）。读 pty 主端的 termios 就能看到。"""
        try:
            return not (termios.tcgetattr(fd)[3] & termios.ICANON)
        except termios.error:
            return False

    # 冷启动（加载 Ink、React、Yoga）：要等首页画出来，并且终端已经进入原始模式，最多 20 秒。
    # 只看“画出来了”不够：Ink 先画首页、之后才打开原始模式，两者之间终端还是行缓冲，
    # 这时发的 q 要等回车才会交给程序，Ctrl-C 会被终端直接变成 SIGINT。慢的 CI 虚拟机上这个间隔会变长，
    # 脚本正好在这时按键，就看到“按了 q 进程没退出”。
    drain(20, until=lambda: "平台".encode() in buf and raw_mode())
    for i, step in enumerate(steps):
        before = len(buf)
        if step[0] == "send":
            os.write(fd, step[1].encode())
        elif step[0] == "resize":
            fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", step[2], step[1], 0, 0))
            os.kill(pid, signal.SIGWINCH)
        # 每一步之后：等到有新的输出（界面重绘了），再多给 0.3 秒让它画完；进程退出了就不用等
        drain(5, until=lambda: len(buf) > before)
        drain(0.3)
        if state["exited"]:
            break
    # 最后一步如果是退出键：最多再等 10 秒让进程自己退出。
    # 注意：drain 内部每次循环都会尝试 reap，但在某些环境里 waitpid(WNOHANG) 可能有延迟；
    # drain 结束后，做一次阻塞的 wait 确保捕获退出状态。
    drain(10, until=reap)
    if not state["exited"]:
        # drain 里的非阻塞 wait 没捕获到，现在阻塞地等（最多 1 秒，之后杀掉）
        try:
            done, status = os.waitpid(pid, 0)  # 阻塞
            if done == pid:
                state["exited"], state["status"] = True, status
        except ChildProcessError:
            pass  # 进程已经被 reap 了
        except Exception:
            pass
    exited = state["exited"]
    if not exited:
        try:
            os.kill(pid, signal.SIGKILL)
            os.waitpid(pid, 0)
        except Exception:
            pass
    return buf.decode("utf8", "replace"), exited, state["status"]


failed = 0


def check(name, ok, detail=""):
    global failed
    print(("ok    " if ok else "FAIL  ") + name + (("：" + detail) if detail else ""))
    if not ok:
        failed += 1


def plain(text):
    return ANSI.sub("", text)


out, exited, status = session(100, 30, [("send", "q")])
text = plain(out)
check("进入备用屏幕", "\x1b[?1049h" in out)
check("画出首页", "平台" in text and "小红书" in text and "12306" in text, "平台栏 / 命令栏")
check("q 退出，退出码 0", exited and os.WEXITSTATUS(status) == 0 if exited else False, f"exited={exited} status={status}")
check("退出时离开备用屏幕、恢复光标", "\x1b[?1049l" in out and "\x1b[?25h" in out)

out, exited, status = session(100, 30, [("send", "/"), ("send", "12306"), ("send", "\x1b"), ("send", "\x03")])
text = plain(out)
check("命令面板", "命令面板" in text and "12306 ticket search" in text)
check("Ctrl-C 退出", exited)

out, exited, status = session(120, 34, [("resize", 60, 15), ("resize", 120, 34), ("send", "q")])
text = plain(out)
check("窗口缩小提示放大，放大后恢复", "终端太小了" in text and text.rfind("平台") > text.rfind("终端太小了"))

sys.exit(1 if failed else 0)
