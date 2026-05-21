import time, hmac, hashlib, base64
from django.shortcuts import render, redirect, get_object_or_404
from django.views import View
from django.contrib.auth import login, logout, authenticate
from django.contrib.auth.forms import UserCreationForm, AuthenticationForm
from django.contrib.auth.mixins import LoginRequiredMixin
from django.core.paginator import Paginator

from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from rest_framework.views import APIView

from .models import Room, RoomMembership, ChatMessage
from .serializers import RoomSerializer, ChatMessageSerializer
from .permissions import IsRoomMember

class RegisterView(View):
    def get(self, request):
        return render(request, 'register.html', {'form': UserCreationForm()})
    def post(self, request):
        form = UserCreationForm(request.POST)
        if form.is_valid():
            user = form.save()
            login(request, user)
            return redirect('menu')
        return render(request, 'register.html', {'form': form})

class LoginView(View):
    def get(self, request):
        return render(request, 'login.html', {'form': AuthenticationForm()})
    def post(self, request):
        form = AuthenticationForm(data=request.POST)
        if form.is_valid():
            login(request, form.get_user())
            return redirect('menu')
        return render(request, 'login.html', {'form': form})

class LogoutView(View):
    def get(self, request):
        logout(request)
        return redirect('login')

class MenuView(LoginRequiredMixin, View):
    def get(self, request):
        rooms = Room.objects.all().order_by('-created_at')
        paginator = Paginator(rooms, 10)
        page_number = request.GET.get('page')
        page_obj = paginator.get_page(page_number)
        return render(request, 'menu.html', {'page_obj': page_obj})

class RoomDetailView(LoginRequiredMixin, View):
    def get(self, request, room_id):
        room = get_object_or_404(Room, id=room_id)


        is_member = RoomMembership.objects.filter(user=request.user, room=room).exists()

        if room.is_private and not is_member:
            return render(request, 'menu.html', {'error': 'Кімната приватна. Потрібно зайти через API /join/'})


        if not room.is_private and not is_member:
            RoomMembership.objects.create(user=request.user, room=room)

        return render(request, 'room.html', {'room': room})

# --- DRF API VIEWS ---

class RoomViewSet(viewsets.ModelViewSet):
    queryset = Room.objects.all().order_by('-created_at')
    serializer_class = RoomSerializer
    permission_classes = [IsAuthenticated]

    def get_permissions(self):
        if self.action in ['list', 'create', 'join_private']:
            return [IsAuthenticated()]
        elif self.action in ['retrieve', 'messages']:
            return [IsAuthenticated(), IsRoomMember()]
        elif self.action in ['update', 'partial_update', 'destroy']:
            return [IsAuthenticated(), IsRoomMember()]
        return [IsAuthenticated(), IsRoomMember()]

    def perform_create(self, serializer):
        room = serializer.save(created_by=self.request.user)
        RoomMembership.objects.create(user=self.request.user, room=room, role='admin')

    @action(detail=True, methods=['post'], url_path='join')
    def join_private(self, request, pk=None):
        from django.contrib.auth.hashers import check_password
        room = self.get_object()
        password = request.data.get('password')
        if room.is_private and not check_password(password, room.password):
            return Response({"detail": "Невірний пароль."}, status=status.HTTP_403_FORBIDDEN)
        RoomMembership.objects.get_or_create(user=request.user, room=room)
        return Response({"status": "joined"})

    @action(detail=True, methods=['get'], url_path='messages')
    def messages(self, request, pk=None):
        room = self.get_object()
        messages_queryset = ChatMessage.objects.filter(room=room).order_by('-created_at')

        page = self.paginate_queryset(messages_queryset)
        if page is not None:
            serializer = ChatMessageSerializer(page, many=True)
            return self.get_paginated_response(serializer.data)
        serializer = ChatMessageSerializer(messages_queryset, many=True)
        return Response(serializer.data)

class TurnCredentialsView(APIView):
    permission_classes = [IsAuthenticated]
    def get(self, request):
        return Response({
            "iceServers": [
                {"urls": "stun:stun.l.google.com:19302"},
                {"urls": "stun:stun1.l.google.com:19302"},
                {"urls": "stun:stun2.l.google.com:19302"},
                {"urls": "stun:stun3.l.google.com:19302"},
                {"urls": "stun:stun4.l.google.com:19302"}
            ]
        })
