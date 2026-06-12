# payment_backends/base.py
# 抽象支付验证接口 — 链上版 / 支付宝版 统一接口

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Optional, Dict, Any


@dataclass
class PaymentProof:
    """支付证明 — 归一化结构"""
    tx_hash: str                # 交易唯一标识（链上 txHash / 支付宝 trade_no）
    amount: str                 # 支付金额
    sender: str                 # 付款方标识
    recipient: str              # 收款方标识
    raw_payload: dict = field(default_factory=dict)  # 原始凭证，验签时用


class PaymentBackend(ABC):
    """支付后端抽象基类"""

    @abstractmethod
    async def verify_payment(
        self,
        proof: PaymentProof,
        expected_amount: str,
        expected_recipient: str,
    ) -> bool:
        """验证支付是否真实有效"""
        ...

    @abstractmethod
    def payment_instructions(self, amount: str, recipient: str, nonce: str) -> Dict[str, Any]:
        """
        返回给客户端的支付指令
        链上版：x402 headers
        支付宝版：付款链接/二维码
        """
        ...
