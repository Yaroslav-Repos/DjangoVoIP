import logging
from livekit import api
from django.conf import settings

logger = logging.getLogger(__name__)

async def kick_from_livekit(room_id, user_id):

    room_service = api.RoomService(settings.LIVEKIT_URL, settings.LIVEKIT_API_KEY, settings.LIVEKIT_API_SECRET)
    try:
        await room_service.remove_participant(room=f"room_{room_id}", identity=str(user_id))
        logger.info(f"Користувача {user_id} успішно видалено з LiveKit кімнати {room_id}")
    except Exception as e:
        # Якщо користувача не було в LiveKit, сервіс викине помилку. Ігноруємо її, щоб запит у БД пройшов успішно.
        logger.warning(f"Не вдалося видалити користувача {user_id} з LiveKit: {e}")

async def delete_livekit_room(room_id):

    room_service = api.RoomService(settings.LIVEKIT_URL, settings.LIVEKIT_API_KEY, settings.LIVEKIT_API_SECRET)
    try:
        await room_service.delete_room(room=f"room_{room_id}")
        logger.info(f"Кімнату {room_id} успішно видалено з LiveKit медіасервера")
    except Exception as e:
        logger.warning(f"Не вдалося видалити кімнату {room_id} з LiveKit: {e}")
