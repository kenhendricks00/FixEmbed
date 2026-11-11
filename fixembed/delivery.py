"""Rate-limit Discord sends and report whether card or fallback delivery succeeded."""

import asyncio
import time
from collections import deque

from fixembed.telemetry.delivery import DeliveryTelemetry, deliver_with_fallback

from .runtime import delivery_telemetry


class DeliveryQueue:
    def __init__(self, telemetry: DeliveryTelemetry, *, message_limit=5, time_window=1):
        if message_limit < 1 or time_window <= 0:
            raise ValueError("Delivery rate limits must be positive")
        self.telemetry = telemetry
        self.message_limit = message_limit
        self.time_window = time_window
        self.queue = asyncio.Queue()
        self.timestamps = deque()

    def cancel_pending(self):
        """Release senders still waiting when the bot closes."""
        while not self.queue.empty():
            _, completion, *_ = self.queue.get_nowait()
            if not completion.done():
                completion.cancel()
            self.queue.task_done()

    async def send(
        self,
        channel,
        content=None,
        embed=None,
        files=None,
        allowed_mentions=None,
        view=None,
        fallback_content=None,
    ):
        ticket = self.telemetry.queued("card" if view is not None else "link")
        completion = asyncio.get_running_loop().create_future()
        await self.queue.put(
            (
                ticket,
                completion,
                channel,
                content,
                embed,
                files,
                allowed_mentions,
                view,
                fallback_content,
            )
        )
        return await asyncio.shield(completion)

    async def run(self):
        while True:
            (
                ticket,
                completion,
                channel,
                content,
                embed,
                files,
                allowed_mentions,
                view,
                fallback_content,
            ) = await self.queue.get()
            try:
                current_time = time.monotonic()
                while (
                    self.timestamps
                    and current_time - self.timestamps[0] >= self.time_window
                ):
                    self.timestamps.popleft()

                while len(self.timestamps) >= self.message_limit:
                    await asyncio.sleep(0.1)
                    current_time = time.monotonic()
                    while (
                        self.timestamps
                        and current_time - self.timestamps[0] >= self.time_window
                    ):
                        self.timestamps.popleft()

                self.timestamps.append(time.monotonic())

                async def primary_send():
                    send_options = {
                        "content": content,
                        "embed": embed,
                        "allowed_mentions": allowed_mentions,
                        "view": view,
                        "silent": True,
                    }
                    if files:
                        send_options["files"] = list(files)
                    return await channel.send(**send_options)

                async def fallback_send():
                    return await channel.send(
                        content=fallback_content,
                        allowed_mentions=allowed_mentions,
                        silent=True,
                    )

                outcome = await deliver_with_fallback(
                    ticket,
                    telemetry=self.telemetry,
                    primary_send=primary_send,
                    fallback_send=fallback_send if fallback_content else None,
                )
                if not completion.done():
                    completion.set_result(outcome)
            except asyncio.CancelledError:
                if not completion.done():
                    completion.cancel()
                raise
            except Exception as error:
                self.telemetry.failed(ticket, error)
                if not completion.done():
                    completion.set_result("failed")
            finally:
                self.queue.task_done()


outbound = DeliveryQueue(delivery_telemetry)
rate_limited_send = outbound.send
send_worker = outbound.run
SEND_QUEUE = outbound.queue
