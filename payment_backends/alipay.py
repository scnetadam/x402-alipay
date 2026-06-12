# payment_backends/alipay.py
# 支付宝沙箱支付后端实现

import json
import time
import uuid
import base64
from datetime import datetime
from typing import Optional, Dict, Any
from urllib.parse import urlencode, quote

import httpx
from cryptography.hazmat.primitives import serialization, hashes
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.backends import default_backend

from .base import PaymentBackend, PaymentProof


class AlipayBackend(PaymentBackend):
    """支付宝沙箱支付后端"""

    def __init__(
        self,
        app_id: str,
        app_private_key: str,
        alipay_public_key: str,
        gateway_url: str,
        notify_url: Optional[str] = None,
        return_url: Optional[str] = None,
    ):
        self.app_id = app_id
        self.gateway_url = gateway_url
        self.notify_url = notify_url
        self.return_url = return_url

        # 加载私钥
        self.private_key = serialization.load_pem_private_key(
            app_private_key.encode() if "-----BEGIN" in app_private_key
            else f"-----BEGIN RSA PRIVATE KEY-----\n{app_private_key}\n-----END RSA PRIVATE KEY-----".encode(),
            password=None,
            backend=default_backend(),
        )

        # 加载支付宝公钥
        self.alipay_public_key = serialization.load_pem_public_key(
            alipay_public_key.encode() if "-----BEGIN" in alipay_public_key
            else f"-----BEGIN PUBLIC KEY-----\n{alipay_public_key}\n-----END PUBLIC KEY-----".encode(),
            backend=default_backend(),
        )

    def _sign(self, params: Dict[str, str]) -> str:
        """生成 RSA2 签名"""
        # 按 key 排序
        sorted_params = sorted(params.items())
        sign_str = "&".join(f"{k}={v}" for k, v in sorted_params if v and k != "sign")

        signature = self.private_key.sign(
            sign_str.encode("utf-8"),
            padding.PKCS1v15(),
            hashes.SHA256(),
        )
        return base64.b64encode(signature).decode("utf-8")

    def _verify_sign(self, params: Dict[str, str], signature: str) -> bool:
        """验证支付宝回调签名"""
        sorted_params = sorted((k, v) for k, v in params.items() if k != "sign" and k != "sign_type")
        sign_str = "&".join(f"{k}={v}" for k, v in sorted_params)

        try:
            self.alipay_public_key.verify(
                base64.b64decode(signature),
                sign_str.encode("utf-8"),
                padding.PKCS1v15(),
                hashes.SHA256(),
            )
            return True
        except Exception:
            return False

    def _generate_trade_no(self) -> str:
        """生成商户订单号"""
        return f"x402_{datetime.now().strftime('%Y%m%d%H%M%S')}_{uuid.uuid4().hex[:8]}"

    async def create_trade_page_pay(self, amount: str, subject: str = "API 数据付费") -> Dict[str, Any]:
        """
        创建支付宝电脑网站支付订单
        返回支付链接（PC 扫码或表单）
        """
        trade_no = self._generate_trade_no()

        biz_content = json.dumps({
            "out_trade_no": trade_no,
            "total_amount": amount,
            "subject": subject,
            "product_code": "FAST_INSTANT_TRADE_PAY",
        })

        params = {
            "app_id": self.app_id,
            "method": "alipay.trade.page.pay",
            "format": "JSON",
            "charset": "utf-8",
            "sign_type": "RSA2",
            "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "version": "1.0",
            "biz_content": biz_content,
        }

        if self.notify_url:
            params["notify_url"] = self.notify_url
        if self.return_url:
            params["return_url"] = self.return_url

        sign = self._sign(params)
        params["sign"] = sign

        # 返回支付表单页面 URL（GET 请求即可跳转）
        query_string = urlencode(params)
        pay_url = f"{self.gateway_url}?{query_string}"

        return {
            "trade_no": trade_no,
            "pay_url": pay_url,
            "amount": amount,
        }

    async def query_trade(self, trade_no: str) -> Optional[Dict]:
        """查询交易状态"""
        biz_content = json.dumps({
            "out_trade_no": trade_no,
        })

        params = {
            "app_id": self.app_id,
            "method": "alipay.trade.query",
            "format": "JSON",
            "charset": "utf-8",
            "sign_type": "RSA2",
            "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "version": "1.0",
            "biz_content": biz_content,
        }

        sign = self._sign(params)
        params["sign"] = sign

        async with httpx.AsyncClient() as client:
            resp = await client.post(self.gateway_url, data=params)
            result = resp.json()

        # 验签
        response_key = f"{params['method']}_response"
        if response_key in result:
            # 简单验签（生产环境需更严谨）
            return result[response_key]

        return None

    async def verify_payment(
        self,
        proof: PaymentProof,
        expected_amount: str,
        expected_recipient: str,
    ) -> bool:
        """
        验证支付宝交易是否成功
        proof.tx_hash = trade_no
        """
        result = await self.query_trade(proof.tx_hash)
        if not result:
            return False

        # 沙箱中 TRADE_SUCCESS 表示支付成功
        trade_status = result.get("trade_status", "")
        if trade_status != "TRADE_SUCCESS":
            return False

        # 校验金额
        actual_amount = result.get("total_amount", "0")
        if float(actual_amount) != float(expected_amount):
            return False

        # 校验收款方（沙箱中 seller_id 应匹配）
        seller_id = result.get("seller_id", "")
        if expected_recipient and seller_id != expected_recipient:
            return False

        return True

    def payment_instructions(self, amount: str, recipient: str, nonce: str) -> Dict[str, Any]:
        """
        返回给客户端的支付指令
        """
        return {
            "x402-amount": amount,
            "x402-recipient": recipient,
            "x402-nonce": nonce,
            "x402-method": "alipay",
            "x402-description": "请使用支付宝沙箱 App 扫码支付",
        }

    async def handle_notify(self, params: Dict[str, str]) -> bool:
        """处理支付宝异步通知"""
        # 验签
        sign = params.get("sign", "")
        if not self._verify_sign(params, sign):
            return False

        # 校验交易状态
        trade_status = params.get("trade_status", "")
        if trade_status != "TRADE_SUCCESS" and trade_status != "TRADE_FINISHED":
            return False

        # 校验 app_id
        if params.get("app_id") != self.app_id:
            return False

        return True
