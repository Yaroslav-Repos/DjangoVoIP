import os
from django.core.asgi import get_asgi_application
from channels.routing import ProtocolTypeRouter, URLRouter
from channels.auth import AuthMiddlewareStack
from channels.sessions import SessionMiddlewareStack
from channels.security.websocket import AllowedHostsOriginValidator
from django.urls import path, re_path

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'DjangoVoIP.settings')
django_asgi_app = get_asgi_application()

from rooms.consumers import SpeakConsumer

application = ProtocolTypeRouter({
    "http": django_asgi_app,
    "websocket": AllowedHostsOriginValidator(
        SessionMiddlewareStack(
            AuthMiddlewareStack(
                URLRouter([
                    re_path(r"ws/room/(?P<room_id>[0-9a-f-]+)/$", SpeakConsumer.as_asgi()),
                ])
            )
        )
    ),
})
