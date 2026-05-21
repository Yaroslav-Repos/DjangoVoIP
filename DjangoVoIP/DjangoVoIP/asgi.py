import os
from django.core.asgi import get_asgi_application
from channels.routing import ProtocolTypeRouter, URLRouter
from channels.auth import AuthMiddlewareStack
from channels.sessions import SessionMiddlewareStack
from channels.security.websocket import AllowedHostsOriginValidator
from django.urls import path

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'DjangoVoIP.settings')
django_asgi_app = get_asgi_application()

from rooms.consumers import TeamSpeakConsumer

application = ProtocolTypeRouter({
    "http": django_asgi_app,
    "websocket": AllowedHostsOriginValidator(
        SessionMiddlewareStack(
            AuthMiddlewareStack(
                URLRouter([
                    path("ws/room/<uuid:room_id>/", TeamSpeakConsumer.as_asgi()),
                ])
            )
        )
    ),
})
