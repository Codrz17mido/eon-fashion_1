"""
Notification hooks for the order lifecycle.

New-order alerts go out over Telegram (see notify_new_order below) — the
storefront also still opens a pre-filled WhatsApp chat client-side for
the *customer* to confirm (see src/utils/whatsapp.js); this is the
separate admin-side "a new order just came in" alert.

notify_status_change / notify_order_cancelled are architecture-only
placeholders still, on purpose — no channel wired up for those yet. To
add one later: implement the function body, no other file needs to
change, since everything already calls these functions at the right
moments.
"""

import json
import logging
import urllib.error
import urllib.request

from django.conf import settings

logger = logging.getLogger('orders.notifications')


def _send_telegram_message(text):
    """Post a plain-text message to the configured Telegram chat via the
    Bot API. Uses only the standard library (urllib) — no new dependency
    for one small HTTP call. Never raises: a missing/invalid token, an
    unreachable network, or a Telegram-side error should never break
    order creation for the customer — it's only logged."""
    token = settings.TELEGRAM_BOT_TOKEN
    chat_id = settings.TELEGRAM_CHAT_ID
    if not token or not chat_id:
        logger.info('Telegram not configured (TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID unset) — skipping alert')
        return

    url = f'https://api.telegram.org/bot{token}/sendMessage'
    payload = json.dumps({'chat_id': chat_id, 'text': text}).encode('utf-8')
    request = urllib.request.Request(
        url, data=payload, headers={'Content-Type': 'application/json'}, method='POST',
    )
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            if response.status != 200:
                logger.warning('Telegram API returned status %s', response.status)
    except urllib.error.URLError as exc:
        logger.warning('Failed to send Telegram order alert: %s', exc)


def notify_new_order(order):
    """Called right after an order is successfully created and stock is
    reserved. Sends a Telegram alert to the admin group with the order
    details so a new order is never missed."""
    logger.info('New order %s from %s (%s items, total %s %s)',
                order.display_id, order.customer_name, order.items.count(),
                order.total, order.currency)

    lines = [
        f'🛍️ New order {order.display_id}',
        f'Customer: {order.customer_name}',
        f'Phone: {order.phone}',
        f'Backup phone: {order.phone_alt}' if order.phone_alt else 'Backup phone: —',
        f'Address: {order.address}',
        '',
    ]
    for item in order.items.all():
        lines.append(f'• {item.product_name} — {item.size}/{item.color} × {item.quantity}')
    lines.append('')
    lines.append(f'Total: {order.total} {order.currency}')
    lines.append(f'Payment: {order.payment_method}')

    _send_telegram_message('\n'.join(lines))


def notify_status_change(order, old_status, new_status):
    """Called whenever an admin changes an order's status. Intended
    future use: notify the customer their order was confirmed/shipped/etc."""
    logger.info('Order %s status changed: %s -> %s', order.display_id, old_status, new_status)


def notify_order_cancelled(order):
    """Called when an order is cancelled (see OrderViewSet.cancel).
    Intended future use: notify the customer + confirm restock to admin."""
    logger.info('Order %s cancelled', order.display_id)
