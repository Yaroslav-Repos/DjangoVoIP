"""
Definition of urls for DjangoVoIP.
"""

from django.contrib import admin
from django.urls import path, include, re_path
from rest_framework.routers import DefaultRouter
from rooms.views import (
    RoomViewSet, RegisterView, LoginView, LogoutView, 
    MenuView, RoomDetailView, TurnCredentialsView, LiveKitTokenView,
    AboutView
)

from django.views.generic import RedirectView

from django.views.generic import TemplateView

router = DefaultRouter()
router.register(r'rooms', RoomViewSet, basename='room')

urlpatterns = [

    path('', RedirectView.as_view(url='menu/', permanent=False)), 

    path('admin/', admin.site.urls),

    path('menu/', MenuView.as_view(), name='menu'),
    path('register/', RegisterView.as_view(), name='register'),
    path('login/', LoginView.as_view(), name='login'),
    path('logout/', LogoutView.as_view(), name='logout'),
    path('room/<uuid:room_id>/', RoomDetailView.as_view(), name='room_detail'),

    path('about/', AboutView.as_view(), name='about'),

    path('service-worker.js', TemplateView.as_view(
        template_name="service-worker.js",
        content_type='application/javascript'
    ), name='service-worker'),

    path('api/', include(router.urls)),
   
    re_path(r'^api/rooms/(?P<pk>[0-9a-f\-]+)/join/$', RoomViewSet.as_view({'post': 'join_private'}), name='room-join'),
    re_path(r'^api/rooms/(?P<pk>[0-9a-f\-]+)/join-with-link/$', RoomViewSet.as_view({'post': 'join_with_link'}), name='room-join-with-link'),
    re_path(r'^api/rooms/(?P<pk>[0-9a-f\-]+)/change-password/$', RoomViewSet.as_view({'post': 'change_password'}), name='room-change-password'),
    re_path(r'^api/rooms/(?P<pk>[0-9a-f\-]+)/generate-invite/$', RoomViewSet.as_view({'post': 'generate_invite_link'}), name='room-generate-invite'),
    re_path(r'^api/rooms/(?P<pk>[0-9a-f\-]+)/add-member/$', RoomViewSet.as_view({'post': 'add_member'}), name='room-add-member'),
    re_path(r'^api/rooms/(?P<pk>[0-9a-f\-]+)/remove-member/$', RoomViewSet.as_view({'post': 'remove_member'}), name='room-remove-member'),
    re_path(r'^api/rooms/(?P<pk>[0-9a-f\-]+)/leave/$', RoomViewSet.as_view({'post': 'leave'}), name='room-leave'),
    re_path(r'^api/rooms/(?P<pk>[0-9a-f\-]+)/members/$', RoomViewSet.as_view({'get': 'members'}), name='room-members'),
    re_path(r'^api/rooms/(?P<pk>[0-9a-f\-]+)/messages/$', RoomViewSet.as_view({'get': 'messages'}), name='room-messages'),

    re_path(r'^api/rooms/(?P<pk>[0-9a-f\-]+)/livekit-token/$', LiveKitTokenView.as_view(), name='room_livekit_token'),

    path('api/turn-credentials/', TurnCredentialsView.as_view(), name='turn_credentials'),
    
]