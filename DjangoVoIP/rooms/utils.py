import logging
from livekit import api
from django.conf import settings

logger = logging.getLogger(__name__)

async def kick_from_livekit(room_id, user_id):
    try:

        async with api.LiveKitAPI(settings.LIVEKIT_URL, settings.LIVEKIT_API_KEY, settings.LIVEKIT_API_SECRET) as lk:

            request = api.RoomParticipantIdentity(
                room=f"room_{room_id}", 
                identity=str(user_id)
            )
            await lk.room.remove_participant(request)
            
        logger.info(f"Користувача {user_id} успішно видалено з LiveKit кімнати {room_id}")
    except Exception as e:
        logger.warning(f"Не вдалося видалити користувача {user_id} з LiveKit: {e}")

async def delete_livekit_room(room_id):
    try:

        async with api.LiveKitAPI(settings.LIVEKIT_URL, settings.LIVEKIT_API_KEY, settings.LIVEKIT_API_SECRET) as lk:

            request = api.DeleteRoomRequest(
                room=f"room_{room_id}"
            )
            await lk.room.delete_room(request)
            
        logger.info(f"Кімнату {room_id} успішно видалено з LiveKit медіасервера")
    except Exception as e:
        logger.warning(f"Не вдалося видалити кімнату {room_id} з LiveKit: {e}")
