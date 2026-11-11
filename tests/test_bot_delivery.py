import asyncio
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock

import discord

from fixembed.delivery import DeliveryQueue
from fixembed.telemetry.delivery import DeliveryTelemetry


class BotDeliveryTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.queue = DeliveryQueue(DeliveryTelemetry(), message_limit=100)
        self.worker = asyncio.create_task(self.queue.run())

    async def asyncTearDown(self):
        self.worker.cancel()
        await asyncio.gather(self.worker, return_exceptions=True)
        self.queue.cancel_pending()

    async def test_sends_are_silent_and_preserve_attachments_and_mentions(self):
        channel = SimpleNamespace(send=AsyncMock())
        view, file, mentions = object(), object(), object()
        outcome = await self.queue.send(
            channel, view=view, files=(file,), allowed_mentions=mentions
        )
        self.assertEqual(outcome, "direct")
        channel.send.assert_awaited_once_with(
            content=None,
            embed=None,
            view=view,
            files=[file],
            allowed_mentions=mentions,
            silent=True,
        )
        await self.queue.queue.join()

    async def test_card_failure_is_rescued_by_a_silent_link(self):
        error = discord.HTTPException(
            SimpleNamespace(status=400, reason="Invalid"), "bad card"
        )
        channel = SimpleNamespace(send=AsyncMock(side_effect=[error, None]))
        outcome = await self.queue.send(
            channel, view=object(), fallback_content="https://fallback.test"
        )
        self.assertEqual(outcome, "rescued")
        channel.send.assert_awaited_with(
            content="https://fallback.test", allowed_mentions=None, silent=True
        )

    async def test_failed_sends_return_an_outcome_and_worker_continues(self):
        channel = SimpleNamespace(
            send=AsyncMock(side_effect=[RuntimeError("offline"), None])
        )
        self.assertEqual(await self.queue.send(channel, content="first"), "failed")
        self.assertEqual(await self.queue.send(channel, content="second"), "direct")

    async def test_cancelling_a_waiter_does_not_cancel_the_send(self):
        entered, release = asyncio.Event(), asyncio.Event()

        async def send(**kwargs):
            entered.set()
            await release.wait()

        channel = SimpleNamespace(send=AsyncMock(side_effect=send))
        waiter = asyncio.create_task(self.queue.send(channel, content="message"))
        await entered.wait()
        waiter.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await waiter
        release.set()
        await self.queue.queue.join()
        self.assertFalse(self.worker.done())

    async def test_shutdown_cancels_queued_waiters(self):
        pending = DeliveryQueue(DeliveryTelemetry())
        waiter = asyncio.create_task(pending.send(SimpleNamespace(send=AsyncMock())))
        await asyncio.sleep(0)
        pending.cancel_pending()
        with self.assertRaises(asyncio.CancelledError):
            await waiter
        await pending.queue.join()

    async def test_rate_limit_delays_the_next_send(self):
        queue = DeliveryQueue(DeliveryTelemetry(), message_limit=1, time_window=0.03)
        times = []

        async def send(**kwargs):
            times.append(asyncio.get_running_loop().time())

        worker = asyncio.create_task(queue.run())
        try:
            await queue.send(SimpleNamespace(send=send))
            await queue.send(SimpleNamespace(send=send))
            self.assertGreaterEqual(times[1] - times[0], 0.03)
        finally:
            worker.cancel()
            await asyncio.gather(worker, return_exceptions=True)
