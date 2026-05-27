from django.shortcuts import render, redirect, get_object_or_404
from django.views import View
from django.contrib.auth import login, logout, authenticate
from django.contrib.auth.models import User
from django.contrib.auth.forms import UserCreationForm
from django.contrib.auth.forms import AuthenticationForm
from django.core.paginator import Paginator
from django.utils import timezone
from datetime import timedelta

from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from rest_framework.views import APIView

from .models import Room, RoomMembership, ChatMessage, RoomInviteLink
from .serializers import RoomSerializer, ChatMessageSerializer
from .permissions import IsRoomMember, IsRoomAdmin

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

class MenuView(View):
    def get(self, request):
        if not request.user.is_authenticated:
            return redirect('login')

        from django.db.models import Q, Exists, OuterRef

        # ✅ ОПТИМІЗОВАНО: Union query з пагінацією в БД
        # Замість завантаження всіх записів в-пам'ять, пагінуємо на рівні БД
        rooms_queryset = Room.objects.filter(
            Q(is_private=False) | Q(is_private=True, memberships__user=request.user)
        ).distinct().order_by('-created_at')

        paginator = Paginator(rooms_queryset, 10)
        page_number = request.GET.get('page')
        page_obj = paginator.get_page(page_number)
        return render(request, 'menu.html', {'page_obj': page_obj})

class RoomDetailView(View):
    def get(self, request, room_id):
        if not request.user.is_authenticated:
            return redirect('login')

        room = get_object_or_404(Room, id=room_id)

        # ✅ ОПТИМІЗОВАНО: Перевірка членства + додавання в одному запиті
        membership, created = RoomMembership.objects.get_or_create(
            user=request.user, 
            room=room,
            defaults={'role': 'member'}
        )

        # Якщо кімната приватна і користувач був добавлений через get_or_create
        # (тобто щойно додано), то дозвіл дати якщо вже був membre до цього
        if room.is_private and created:
            # Видалити неправомерний доступ
            membership.delete()
            return render(request, 'menu.html', {'error': 'Кімната приватна. Потрібно зайти через API /join/'})

        return render(request, 'room.html', {'room': room})

# --- DRF API VIEWS ---

class RoomViewSet(viewsets.ModelViewSet):
    serializer_class = RoomSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        from django.db.models import Q

        # ✅ ВСІ кімнати доступні для отримання (перевірка дозволів в permissions)
        # Публічні - завжди доступні
        # Приватні - перевіяються в join_private() та join_with_link()
        queryset = Room.objects.all().order_by('-created_at').prefetch_related('created_by')

        return queryset

    def get_permissions(self):
        if self.action in ['list', 'create', 'join_private', 'join_with_link']:
            return [IsAuthenticated()]
        elif self.action in ['retrieve', 'messages', 'leave']:
            return [IsAuthenticated(), IsRoomMember()]
        elif self.action in ['update', 'partial_update', 'destroy', 'change_password', 'generate_invite_link', 'add_member', 'remove_member']:
            return [IsAuthenticated(), IsRoomAdmin()]
        return [IsAuthenticated(), IsRoomMember()]

    def perform_create(self, serializer):
        room = serializer.save(created_by=self.request.user)
        RoomMembership.objects.create(user=self.request.user, room=room, role='admin')

    def perform_destroy(self, instance):
        # ✅ ОПТИМІЗОВАНО: Очистити всі мембершіпи перед видаленням кімнати
        # Це запобігає багу, коли нова кімната з тим же ім'ям дає доступ старим членам
        RoomMembership.objects.filter(room=instance).delete()
        instance.delete()

    @action(detail=True, methods=['post'], url_path='join')
    def join_private(self, request, pk=None):
        from django.contrib.auth.hashers import check_password
        room = self.get_object()
        password = request.data.get('password')

        # ✅ Перевірити чи користувач вже membre
        existing_membership = room.memberships.filter(user=request.user).first()
        if existing_membership:
            return Response({"status": "already_member"})

        # Публічна кімната - вхід без пароля
        if not room.is_private:
            membership = RoomMembership.objects.create(user=request.user, room=room)
            return Response({"status": "joined"})

        # Приватна кімната - потребує пароль
        if not password:
            return Response(
                {"detail": "Пароль потрібен для приватної кімнати."},
                status=status.HTTP_403_FORBIDDEN
            )

        if not room.password or not check_password(password, room.password):
            return Response(
                {"detail": "Невірний пароль."},
                status=status.HTTP_403_FORBIDDEN
            )

        membership = RoomMembership.objects.create(user=request.user, room=room)
        return Response({"status": "joined"})

    @action(detail=True, methods=['post'], url_path='join-with-link')
    def join_with_link(self, request, pk=None):
        room = self.get_object()
        invite_token = request.data.get('token')

        if not invite_token:
            return Response(
                {"detail": "Токен посилання потрібен."},
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            invite = RoomInviteLink.objects.get(id=invite_token)
        except RoomInviteLink.DoesNotExist:
            return Response({"detail": "Невірне посилання."}, status=status.HTTP_404_NOT_FOUND)

        # Перевірка що посилання належить цій кімнаті
        if invite.room_id != room.id:
            return Response(
                {"detail": "Посилання не належить цій кімнаті."},
                status=status.HTTP_403_FORBIDDEN
            )

        if not invite.is_valid():
            return Response({"detail": "Посилання закінчилось або вже використано."}, status=status.HTTP_403_FORBIDDEN)

        membership, created = RoomMembership.objects.get_or_create(user=request.user, room=room)

        # Mark link as used
        invite.is_used = True
        invite.used_by = request.user
        invite.used_at = timezone.now()
        invite.save()

        return Response({"status": "joined" if created else "already_member"})

    @action(detail=True, methods=['post'], url_path='change-password')
    def change_password(self, request, pk=None):
        from django.contrib.auth.hashers import make_password
        room = self.get_object()
        new_password = request.data.get('password')

        # ✅ ОПТИМІЗОВАНО: Один запит для перевірки адміна
        is_admin = (
            room.created_by_id == request.user.id or 
            room.memberships.filter(user=request.user, role='admin').exists()
        )

        if not is_admin:
            return Response(
                {"detail": "Ви не адміністратор цієї кімнати."},
                status=status.HTTP_403_FORBIDDEN
            )

        if not room.is_private:
            return Response(
                {"detail": "Тільки приватні кімнати мають пароль."},
                status=status.HTTP_400_BAD_REQUEST
            )

        if not new_password:
            return Response(
                {"detail": "Пароль не може бути пустим."},
                status=status.HTTP_400_BAD_REQUEST
            )

        room.password = make_password(new_password)
        room.save()
        return Response({"status": "password_changed"})

    @action(detail=True, methods=['post'], url_path='generate-invite')
    def generate_invite_link(self, request, pk=None):
        room = self.get_object()

        # ✅ ОПТИМІЗОВАНО: Один запит для перевірки адміна
        is_admin = (
            room.created_by_id == request.user.id or 
            room.memberships.filter(user=request.user, role='admin').exists()
        )

        if not is_admin:
            return Response(
                {"detail": "Ви не адміністратор цієї кімнати."},
                status=status.HTTP_403_FORBIDDEN
            )

        if not room.is_private:
            return Response(
                {"detail": "Посилання можуть генеруватися тільки для приватних кімнат."},
                status=status.HTTP_400_BAD_REQUEST
            )

        expires_hours = request.data.get('expires_hours', 24)

        invite = RoomInviteLink.objects.create(
            room=room,
            created_by=request.user,
            expires_at=timezone.now() + timedelta(hours=expires_hours)
        )

        return Response({
            "token": str(invite.id),
            "expires_at": invite.expires_at.isoformat()
        })

    @action(detail=True, methods=['post'], url_path='add-member')
    def add_member(self, request, pk=None):
        room = self.get_object()
        username = request.data.get('username')

        # ✅ ОПТИМІЗОВАНО: Один запит для перевірки адміна
        is_admin = (
            room.created_by_id == request.user.id or 
            room.memberships.filter(user=request.user, role='admin').exists()
        )

        if not is_admin:
            return Response(
                {"detail": "Ви не адміністратор цієї кімнати."},
                status=status.HTTP_403_FORBIDDEN
            )

        if not room.is_private:
            return Response(
                {"detail": "Членів можна додавати тільки до приватних кімнат."},
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            user = User.objects.get(username=username)
        except User.DoesNotExist:
            return Response(
                {"detail": "Користувач не знайдений."},
                status=status.HTTP_404_NOT_FOUND
            )

        membership, created = RoomMembership.objects.get_or_create(user=user, room=room)

        return Response({
            "status": "added" if created else "already_member",
            "username": user.username
        })

    @action(detail=True, methods=['post'], url_path='remove-member')
    def remove_member(self, request, pk=None):
        room = self.get_object()
        user_id = request.data.get('user_id')

        # ✅ ОПТИМІЗОВАНО: Один запит для перевірки адміна
        is_admin = (
            room.created_by_id == request.user.id or 
            room.memberships.filter(user=request.user, role='admin').exists()
        )

        if not is_admin:
            return Response(
                {"detail": "Ви не адміністратор цієї кімнати."},
                status=status.HTTP_403_FORBIDDEN
            )

        if not room.is_private:
            return Response(
                {"detail": "Членів можна видаляти тільки з приватних кімнат."},
                status=status.HTTP_400_BAD_REQUEST
            )

        if not user_id:
            return Response(
                {"detail": "user_id потрібен."},
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            user = User.objects.get(id=user_id)
        except User.DoesNotExist:
            return Response(
                {"detail": "Користувач не знайдений."},
                status=status.HTTP_404_NOT_FOUND
            )

        # Не дозволяти видаляти адміна
        if user_id == room.created_by_id:
            return Response(
                {"detail": "Не можна видалити створювача кімнати."},
                status=status.HTTP_403_FORBIDDEN
            )

        try:
            membership = RoomMembership.objects.get(user=user, room=room)
            membership.delete()
            return Response({
                "status": "removed",
                "username": user.username
            })
        except RoomMembership.DoesNotExist:
            return Response(
                {"detail": "Користувач не є членом цієї кімнати."},
                status=status.HTTP_404_NOT_FOUND
            )

    @action(detail=True, methods=['post'], url_path='leave')
    def leave(self, request, pk=None):
        room = self.get_object()
        user = request.user

        # Не дозволяти адміну покинути кімнату (мусять видалити)
        if user.id == room.created_by_id:
            return Response(
                {"detail": "Адміністратор не може просто покинути кімнату. Видаліть кімнату замість цього."},
                status=status.HTTP_403_FORBIDDEN
            )

        try:
            membership = RoomMembership.objects.get(user=user, room=room)
            membership.delete()
            return Response({"status": "left"})
        except RoomMembership.DoesNotExist:
            return Response(
                {"detail": "Ви не є членом цієї кімнати."},
                status=status.HTTP_404_NOT_FOUND
            )

    @action(detail=True, methods=['get'], url_path='messages')
    def messages(self, request, pk=None):
        room = self.get_object()
        # ✅ ОПТИМІЗОВАНО: select_related для User щоб не робити N+1 запиту
        messages_queryset = ChatMessage.objects.filter(
            room=room
        ).select_related('user').order_by('-created_at')

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
