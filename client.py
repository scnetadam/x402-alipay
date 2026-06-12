# client.py
# x402-Alipay 客户端模拟 — 模拟 AI Agent 的支付流程

import os
import time
import asyncio
import httpx
from dotenv import load_dotenv

load_dotenv()

SERVER_URL = "http://localhost:8000"
PAYMENT_AMOUNT = os.getenv("PAYMENT_AMOUNT", "0.01")


async def demo_flow():
    """
    模拟 AI Agent 的完整支付流程：
    1. 请求数据 → 收到 402
    2. 获取支付链接
    3. 提示用户付款（沙箱环境需手动扫码）
    4. 带支付证明重试 → 拿到数据
    """
    print("=" * 60)
    print("  x402-Alipay 客户端模拟")
    print("  " + "-" * 58)
    print("  流程: 请求 → 402 → 支付 → 重试 → 数据")
    print("=" * 60)

    async with httpx.AsyncClient() as client:
        # === 第一步：请求数据 ===
        print("\n[1/4] 请求受保护数据...")
        resp = await client.get(f"{SERVER_URL}/api/data")

        if resp.status_code == 200:
            print("  ✅ 已支付，直接拿到数据:")
            print(f"     {resp.json()}")
            return

        if resp.status_code != 402:
            print(f"  ❌ 意外响应: {resp.status_code}")
            return

        # === 第二步：解析 402 响应 ===
        print(f"\n[2/4] 收到 402 Payment Required")
        data = resp.json()
        trade_no = data.get("trade_no", "")
        pay_url = data.get("pay_url", "")
        amount = data.get("amount", PAYMENT_AMOUNT)

        print(f"  订单号: {trade_no}")
        print(f"  金额: ¥{amount}")
        print(f"  支付链接: {pay_url}")
        print()

        # === 第三步：提示用户支付 ===
        print("-" * 58)
        print("  💳 请在浏览器中打开支付链接")
        print("  使用沙箱版支付宝 App 扫码或登录支付")
        print("  沙箱买家账号: 在 .env 中配置 SANDBOX_BUYER_ACCOUNT")
        print("  沙箱买家密码: 111111")
        print("-" * 58)

        # 等待用户支付（沙箱环境需要手动操作）
        # 生产环境中，这里可以轮询订单状态
        max_wait = 120  # 最多等 2 分钟
        print(f"\n[3/4] 等待支付完成（最长 {max_wait} 秒）...")

        for i in range(max_wait):
            # 查询订单状态
            status_resp = await client.get(f"{SERVER_URL}/orders/{trade_no}/status")
            status_data = status_resp.json()

            if status_data.get("paid"):
                print(f"  ✅ 支付成功！(等待 {i+1} 秒)")
                break

            if i % 10 == 0 and i > 0:
                print(f"  已等待 {i} 秒... 请尽快完成支付")

            await asyncio.sleep(1)
        else:
            print("  ❌ 等待超时，支付未完成")
            print(f"  可手动打开支付链接完成支付后，再携带 x402-trade-no 请求")
            return

        # === 第四步：带支付证明重试 ===
        print(f"\n[4/4] 携带支付证明重试请求...")
        resp2 = await client.get(
            f"{SERVER_URL}/api/data",
            headers={"x402-trade-no": trade_no},
        )

        if resp2.status_code == 200:
            print("  ✅ 成功获取受保护数据:")
            print(f"     {resp2.json()}")
        else:
            print(f"  ❌ 重试失败: {resp2.status_code}")
            print(f"     {resp2.text}")

    print("\n" + "=" * 60)
    print("  流程完成")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(demo_flow())
