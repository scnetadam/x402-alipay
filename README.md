# x402-Alipay Demo

将 x402 支付协议替换为**支付宝沙箱**实现的微支付方案。

## 架构

```
Agent/Client                        Server (FastAPI)
    |                                     |
    |--- GET /api/data -----------------> |
    |                                     | 未支付
    |<-- 402 + alipay QR/pay_url -------- |
    |                                     |
    |   [用户通过支付宝沙箱 App 付款]       |
    |                                     |
    |--- GET /api/data -----------------> |
    |    headers: x402-trade-no=xxxx       |
    |                                     | 验签（支付宝回调）
    |<-- 200 + data --------------------- |
```

## 文件结构

```
x402-alipay/
├── .env                     # 支付宝沙箱配置
├── requirements.txt
├── README.md
├── server.py                # FastAPI 主程序
├── client.py                # Agent 模拟客户端
├── payment_backends/
│   ├── __init__.py
│   ├── base.py              # 抽象接口
│   ├── x402_chain.py        # 链上版（参考）
│   └── alipay.py            # 支付宝沙箱实现
└── tests/
    └── test_alipay.py
```

## 快速开始

### 1. 注册支付宝沙箱

1. 登录 [支付宝开放平台](https://open.alipay.com/) → 控制台 → 沙箱应用
2. 获取 **APPID**、**应用私钥**、**支付宝公钥**
3. 下载沙箱版支付宝 App（用于扫码支付）

### 2. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env 填入沙箱参数
```

### 3. 安装并运行

```bash
pip install -r requirements.txt
python server.py
```

### 4. 模拟客户端请求

```bash
python client.py
```

## 支付宝 → 人民币替换思路

`payment_backends/alipay.py` 实现 `PaymentBackend` 接口，替换掉链上验签逻辑：

```python
class AlipayBackend(PaymentBackend):
    async def verify_payment(self, trade_no, amount):
        # 调用支付宝 alipay.trade.query
        # 校验 trade_status = TRADE_SUCCESS
        # 校验 total_amount 一致
        return True
```

x402 的 `402 → 支付 → 带证明重试 → 验签 → 放行` 流程完全保留，只是底层验证方式变了。

## License

MIT
