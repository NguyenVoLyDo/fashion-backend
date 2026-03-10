/**
 * Payment service — stubs for dev/test.
 */

/**
 * Returns a fake payment URL for non-COD methods.
 */
export function getPaymentUrl(order) {
    return `https://payment-gateway.example.com/pay?order=${order.orderNo}`;
}

/**
 * Stub: verify VNPay webhook signature and extract data.
 */
export function verifyVnpayWebhook(query) {
    console.log('[payment] VNPay webhook query:', query);
    return {
        orderId: query.vnp_TxnRef,
        success: true,
        txnId: query.vnp_TransactionNo ?? null,
    };
}

/**
 * Stub: verify MoMo webhook signature and extract data.
 */
export function verifyMomoWebhook(body) {
    console.log('[payment] MoMo webhook body:', body);
    return {
        orderId: body.orderId,
        success: true,
        txnId: body.transId ?? null,
    };
}
