"""
Definition of urls for DjangoVoIP.
"""

from django.contrib import admin
from django.urls import path, include
from rest_framework.routers import DefaultRouter
from rooms.views import (
    RoomViewSet, RegisterView, LoginView, LogoutView, 
    MenuView, RoomDetailView, TurnCredentialsView
)

router = DefaultRouter()
router.register(r'rooms', RoomViewSet, basename='room')

urlpatterns = [
    path('admin/', admin.site.urls),
    

    path('', MenuView.as_view(), name='menu'),
    path('register/', RegisterView.as_view(), name='register'),
    path('login/', LoginView.as_view(), name='login'),
    path('logout/', LogoutView.as_view(), name='logout'),
    path('room/<uuid:room_id>/', RoomDetailView.as_view(), name='room_detail'),
    

    path('api/', include(router.urls)),
    path('api/turn-credentials/', TurnCredentialsView.as_view(), name='turn_credentials'),
]