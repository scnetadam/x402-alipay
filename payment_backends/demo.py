# payment_backends/demo.py
# Demo payment backend - no real config required

import asyncio
from typing import Dict, Any

from .base import PaymentBackend, PaymentProof


class DemoBackend(PaymentBackend):
    """Simulated payment backend for demo/testing"""

    def __init__(self):
        self._paid_orders: set = set()

    async def verify_payment(
        self,
        proof: PaymentProof,
        expected_amount: str,
        expected_recipient: str,
    ) -> bool:
        if proof.tx_hash in self._paid_orders:
            return True
        await asyncio.sleep(0.5)
        self._paid_orders.add(proof.tx_hash)
        return True

    def payment_instructions(self, amount: str, recipient: str, nonce: str) -> Dict[str, Any]:
        return {
            "x402-amount": amount,
            "x402-recipient": recipient,
            "x402-nonce": nonce,
            "x402-method": "demo",
            "x402-description": "Demo mode - call /pay/demo/{trade_no} to simulate",
        }

    def simulate_pay(self, trade_no: str) -> bool:
        self._paid_orders.add(trade_no)
        return True

    def is_paid(self, trade_no: str) -> bool:
        return trade_no in self._paid_orders
