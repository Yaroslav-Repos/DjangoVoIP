import json
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async
from .models import RoomMembership, ChatMessage

class TeamSpeakConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.room_id = self.scope['url_route']['kwargs']['room_id']
        self.room_group_name = f'ts_room_{self.room_id}'
        self.user = self.scope['user']

        if not self.user.is_authenticated or not await self.is_member():
            await self.close(code=4003)
            return

        await self.channel_layer.group_add(self.room_group_name, self.channel_name)
        await self.accept()

        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'presence_message',
                'action': 'join',
                'user_id': self.user.id,
                'username': self.user.username
            }
        )

    async def disconnect(self, close_code):
        if hasattr(self, 'room_group_name'):
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

    async def receive(self, text_data):
        try:
            if not await self.is_member():
                await self.close(code=4003)
                return

            data = json.loads(text_data)
        except json.JSONDecodeError:
            await self.close(code=1003)
            return

        stream = data.get('stream')
        payload = data.get('payload', {})

        if stream == 'chat':
            msg_text = payload.get('message')
            await self.save_message(msg_text)
            await self.channel_layer.group_send(
                self.room_group_name,
                {
                    'type': 'chat_message',
                    'sender': self.user.username,
                    'message': msg_text
                }
            )
        elif stream == 'voice':
            await self.channel_layer.group_send(
                self.room_group_name,
                {
                    'type': 'voice_state_message',
                    'user_id': self.user.id,
                    'state': payload
                }
            )
        elif stream == 'signaling':
            await self.channel_layer.group_send(
                self.room_group_name,
                {
                    'type': 'signaling_message',
                    'sender_id': self.user.id,
                    'target_user_id': payload.get('target_user_id'),
                    'sdp': payload.get('sdp'),
                    'ice': payload.get('ice')
                }
            )

    async def presence_message(self, event):
        await self.send(text_data=json.dumps({'stream': 'presence', 'payload': event}))

    async def chat_message(self, event):
        await self.send(text_data=json.dumps({'stream': 'chat', 'payload': event}))

    async def voice_state_message(self, event):
        await self.send(text_data=json.dumps({'stream': 'voice', 'payload': event}))

    async def signaling_message(self, event):
        if event['target_user_id'] == self.user.id or event['target_user_id'] == 'all':
            if event['sender_id'] != self.user.id:
                await self.send(text_data=json.dumps({'stream': 'signaling', 'payload': event}))

    @database_sync_to_async
    def is_member(self):
        return RoomMembership.objects.filter(user=self.user, room_id=self.room_id).exists()

    @database_sync_to_async
    def save_message(self, text):
        ChatMessage.objects.create(
            room_id=self.room_id,
            user=self.user,
            text=text
        )

    @database_sync_to_async
    def save_message(self, text):
        return ChatMessage.objects.create(room_id=self.room_id, user=self.user, text=text)
