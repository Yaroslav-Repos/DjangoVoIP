import json
import logging
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async
from .models import Room, RoomMembership, ChatMessage
import time
from django.utils.html import escape

import asyncio
from django.core.cache import cache

logger = logging.getLogger(__name__)

class SpeakConsumer(AsyncWebsocketConsumer):

    async def connect(self):
        self.room_id = self.scope['url_route']['kwargs']['room_id']

        room = await self.get_room()
    
        if not room:
            await self.close(code=4004)
            return

        self.room_group_name = f'ts_room_{self.room_id}'
        self.active_users_key = f'users_{self.room_id}'
        self.user = self.scope['user']

        logger.info(f'User {self.user} connecting to room {self.room_id}')

        if not self.user.is_authenticated or not await self.is_member():
            logger.warning(f'User {self.user} not authenticated or not member')
            await self.close(code=4003)
            return

        await self.channel_layer.group_add(self.room_group_name, self.channel_name)
        await self.accept()

        logger.info(f'User {self.user} connected to room {self.room_id}')

        existing_users = await self._get_active_users()

        for user_id_str, username in existing_users.items():
            user_id = int(user_id_str)
            if user_id != self.user.id:
                await self.send(text_data=json.dumps({
                    'stream': 'presence',
                    'payload': {
                        'action': 'join',
                        'user_id': user_id,
                        'username': username
                    }
                }))


        await self._add_user_to_presence()
        

        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'presence_message',
                'action': 'join',
                'user_id': self.user.id,
                'username': self.user.username
            }
        )

        self.last_message_time = 0
        self.spam_warnings = 0


    async def disconnect(self, close_code):
        if hasattr(self, 'room_group_name'):

            await self._remove_user_from_presence()
            
            if close_code != 4004:
                await self.channel_layer.group_send(
                    self.room_group_name,
                    {
                        'type': 'presence_message',
                        'action': 'leave',
                        'user_id': self.user.id,
                        'username': self.user.username
                    }
                )
            
            await self.channel_layer.group_discard(self.room_group_name, self.channel_name)
            logger.info(f'User {self.user} disconnected from room {self.room_id}')


    async def receive(self, text_data):
        try:
            # 1. Захист від спаму (Rate Limiting на рівні сокета)
            current_time = time.time()
            if current_time - getattr(self, 'last_message_time', 0) < 0.3: # Максимум 1 повідомлення на 0.3 сек
                self.spam_warnings = getattr(self, 'spam_warnings', 0) + 1
                if self.spam_warnings > 5:
                    logger.warning(f"Disconnecting {self.user} for spamming.")
                    await self.close(code=4429) # Too Many Requests
                return
        
            self.last_message_time = current_time
            self.spam_warnings = max(0, getattr(self, 'spam_warnings', 0) - 1) # Зменшуємо попередження з часом

            # 2. Перевірка доступу (вже є у тебе)
            if not await self.is_member():
                await self.close(code=4003)
                return

            data = json.loads(text_data)
        
            # 3. Перевірка структури (щоб не зловити AttributeError)
            if not isinstance(data, dict):
                return

        except json.JSONDecodeError:
            await self.close(code=1003)
            return

        stream = data.get('stream')
        payload = data.get('payload', {})

        if not isinstance(payload, dict):
            return

        if stream == 'chat':
            msg_text = str(payload.get('message', '')).strip()
        
            # 4. Валідація довжини
            if not msg_text or len(msg_text) > 1000:
                return 
            
            # 5. Санітизація (захист від XSS HTML/JS ін'єкцій)
            safe_text = escape(msg_text)

            await self.save_message(safe_text)
            await self.channel_layer.group_send(
                self.room_group_name,
                {
                    'type': 'chat_message',
                    'sender': self.user.username,
                    'message': safe_text
                }
            )
        
        elif stream == 'voice':
            # Перевірка, що payload містить потрібний ключ (isMuted)
            if 'isMuted' not in payload:
                return
            
            # Гарантуємо, що статус міняється ТІЛЬКИ для того, хто відправив запит
            safe_payload = {'isMuted': bool(payload['isMuted'])}
        
            await self.channel_layer.group_send(
                self.room_group_name,
                {
                    'type': 'voice_state_message',
                    'user_id': self.user.id, # Жорстко прив'язуємо до відправника
                    'state': safe_payload
                }
            )

    async def presence_message(self, event):
        await self.send(text_data=json.dumps({'stream': 'presence', 'payload': event}))

    async def chat_message(self, event):
        await self.send(text_data=json.dumps({'stream': 'chat', 'payload': event}))

    async def voice_state_message(self, event):
        await self.send(text_data=json.dumps({'stream': 'voice', 'payload': event}))
    
    async def force_disconnect(self, event):
        if self.user.id == event['user_id']:
            logger.info(f"Користувача {self.user.id} було вигнано. Примусово закриваємо сокет.")
            await self.close(code=4003)

    async def room_deleted(self, event):
        logger.info(f"Кімнату {self.room_id} видалено. Закриваємо з'єднання для всіх учасників.")
        await self.close(code=4004)

    @database_sync_to_async
    def get_room(self):
        return Room.objects.filter(id=self.room_id).first()

    @database_sync_to_async
    def is_member(self):
        return RoomMembership.objects.filter(user=self.user, room_id=self.room_id).exists()

    @database_sync_to_async
    def save_message(self, text):
        return ChatMessage.objects.create(
            room_id=self.room_id,
            user=self.user,
            text=text
        )




    # на майбутнє: можна оптимізувати, щоб не дерти з кешу, перейти на Redis

    async def _get_active_users(self):

        return await cache.aget(self.active_users_key, default={})

    async def _add_user_to_presence(self):

        lock_key = f"lock_presence_{self.room_id}"
        

        while not await cache.aadd(lock_key, "locked", timeout=10):
            await asyncio.sleep(0.02)
            
        try:
            active_users = await cache.aget(self.active_users_key, default={})
            active_users[str(self.user.id)] = self.user.username
            await cache.aset(self.active_users_key, active_users, timeout=86400)
        finally:
            await cache.adelete(lock_key)  

    async def _remove_user_from_presence(self):

        lock_key = f"lock_presence_{self.room_id}"
        
        while not await cache.aadd(lock_key, "locked", timeout=10):
            await asyncio.sleep(0.02)
            
        try:
            active_users = await cache.aget(self.active_users_key, default={})
            active_users.pop(str(self.user.id), None)
            
            if active_users:
                await cache.aset(self.active_users_key, active_users, timeout=86400)
            else:
                await cache.adelete(self.active_users_key)
        finally:
            await cache.adelete(lock_key)