# payment_backends/base.py
# 抽象支付验证接口

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Dict, Any


@dataclass
class PaymentProof:
    """支付证明 — 归一化结构"""
    tx_hash: str
    amount: str
    sender: str
    recipient: str
    raw_payload: dict = field(default_factory=dict)


class PaymentBackend(ABC):
    """支付后端抽象基类"""

    @abstractmethod
    async def verify_payment(
        self,
        proof: PaymentProof,
        expected_amount: str,
        expected_recipient: str,
    ) -> bool:
        ...

    @abstractmethod
    def payment_instructions(self, amount: str, recipient: str, nonce: str) -> Dict[str, Any]:
        ...
