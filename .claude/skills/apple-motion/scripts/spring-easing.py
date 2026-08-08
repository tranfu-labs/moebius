#!/usr/bin/env python3
"""把临界阻尼弹簧采样成 CSS linear() 缓动，得到零依赖的真弹簧曲线。

临界阻尼（bounce = 0）永不过冲，因此不违反「禁止 bounce / elastic」类的动效红线；
它和贝塞尔的区别在速度剖面——起步有加速度、收尾自然停住，而不是硬停。

    x(t) = 1 - (1 + wt) * e^(-wt)        w = 2*pi / duration

duration 用苹果 spring(duration:bounce:) 的语义：**感知时长**，约等于无阻尼周期，
不是沉降时间。total 要比 duration 长一截，把尾巴留给它自己停住。

用法：
    python3 spring-easing.py                    # 默认 duration=0.36s total=0.5s
    python3 spring-easing.py 0.28 0.4           # 更快的一档
    python3 spring-easing.py 0.36 0.5 --points 20
"""

import argparse
import math


def displacement(t: float, omega: float) -> float:
    return 1 - (1 + omega * t) * math.exp(-omega * t)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("duration", nargs="?", type=float, default=0.36, help="感知时长（秒）")
    parser.add_argument("total", nargs="?", type=float, default=0.5, help="动画总时长（秒），即 animation-duration")
    parser.add_argument("--points", type=int, default=26, help="采样点数，20-30 足够")
    args = parser.parse_args()

    omega = 2 * math.pi / args.duration
    points = []
    for i in range(args.points + 1):
        progress = i / args.points
        value = displacement(progress * args.total, omega)
        # 末点强制为 1：采样残差留在终态上会让元素停不到位。
        if i == args.points:
            value = 1.0
        points.append(f"{value:.4f} {progress * 100:.0f}%")

    print(f"/* spring(duration: {args.duration}s, bounce: 0)  omega = {omega:.2f} */")
    print(f"/* 感知时长处已到 {displacement(args.duration, omega) * 100:.1f}%；animation-duration 用 {args.total * 1000:.0f}ms */")
    print("linear(" + ", ".join(points) + ")")


if __name__ == "__main__":
    main()
