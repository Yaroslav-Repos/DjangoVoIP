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

from django.conf import settings

from rest_framework.throttling import UserRateThrottle

from livekit import api

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from .utils import kick_from_livekit, delete_livekit_room

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
    def post(self, request):
        # CSRF 
        logout(request)
        return redirect('login')

    def get(self, request):
        # redirect до форми logout

        return redirect('menu')

class MenuView(View):
    def get(self, request):
        if not request.user.is_authenticated:
            return redirect('login')

        from django.db.models import Q

        # Фільтруємо кімнати - показуємо тільки доступні користувачеві
        # - Публічні кімнати (всім)
        # - Приватні кімнати (тільки для членів)
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

        # Приватна кімната - перевіра доступу
        if room.is_private:
            # Перевіра чи користувач член приватної кімнати
            membership = room.memberships.filter(user=request.user).first()
            if not membership:
                # Спроба несанкціонованого доступу
                return render(
                    request, 
                    'menu.html', 
                    {'error': 'Кімната приватна. Потрібно приєднатись через приватне посилання або пароль.'},
                    status=403
                )
        else:
            #  Публічна кімната - автоматичне додавання в члени
            membership, created = RoomMembership.objects.get_or_create(
                user=request.user, 
                room=room,
                defaults={'role': 'member'}
            )

        return render(request, 'room.html', {'room': room})

# --- DRF API VIEWS ---

class RoomViewSet(viewsets.ModelViewSet):
    serializer_class = RoomSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        from django.db.models import Q

        # list action - показуємо тільки доступні користувачеві кімнати
        # - Публічні - всім
        # - Приватні - тільки тим, хто член
        # 
        # Для retrieve/update/delete - перевіряється в permissions

        if self.action == 'list':
            # Отримуємо фільтр is_private з query параметра (true/false/None)
            is_private_param = self.request.query_params.get('is_private')

            if is_private_param is not None:

                is_private = is_private_param.lower() in ('true', '1', 'yes')
                if is_private:
                    # Приватні - тільки для членів
                    queryset = Room.objects.filter(
                        is_private=True,
                        memberships__user=user
                    ).distinct()
                else:
                    # Публічні - для всіх
                    queryset = Room.objects.filter(is_private=False)
            else:
                # Без фільтра - показуємо все доступне
                queryset = Room.objects.filter(
                    Q(is_private=False) | Q(is_private=True, memberships__user=user)
                ).distinct()

            queryset = queryset.order_by('-created_at').prefetch_related('created_by')
        else:
            # Для інших операцій дозволяємо доступ до всіх, перевірку робить permissions
            queryset = Room.objects.all().order_by('-created_at').prefetch_related('created_by')

        return queryset

    def list(self, request, *args, **kwargs):
        """ПАГІНАЦІЯ + ПОШУК"""
        queryset = self.filter_queryset(self.get_queryset())

        # Пошук за назвою кімнати (регістронезалежний)
        search_query = request.query_params.get('search', '').strip()
        if search_query:
            queryset = queryset.filter(name__icontains=search_query)

        # Отримати розмір сторінки з query параметра (за замовчуванням 10)
        page_size = request.query_params.get('page_size', 10)
        try:
            page_size = int(page_size)
            if page_size < 1 or page_size > 100:
                page_size = 10
        except (ValueError, TypeError):
            page_size = 10

        paginator = Paginator(queryset, page_size)
        page_number = request.query_params.get('page', 1)

        try:
            page_obj = paginator.page(page_number)
        except:
            page_obj = paginator.page(1)

        serializer = self.get_serializer(page_obj, many=True)
        return Response({
            'count': paginator.count,
            'next': paginator.num_pages > int(page_number) if page_number else False,
            'previous': int(page_number) > 1 if page_number else False,
            'num_pages': paginator.num_pages,
            'results': serializer.data
        })

    def get_permissions(self):
        if self.action in ['list', 'create', 'join_private', 'join_with_link']:
            return [IsAuthenticated()]
        elif self.action in ['retrieve', 'messages', 'leave', 'members']:
            #  тільки членам кімнати
            return [IsAuthenticated(), IsRoomMember()]
        elif self.action in ['update', 'partial_update', 'destroy', 'change_password', 'generate_invite_link', 'add_member', 'remove_member']:
            #  адміністративні дії - тільки адміну
            return [IsAuthenticated(), IsRoomAdmin()]
        return [IsAuthenticated(), IsRoomMember()]

    def perform_create(self, serializer):
        room = serializer.save(created_by=self.request.user)
        RoomMembership.objects.create(user=self.request.user, room=room, role='admin')

    def perform_destroy(self, instance):
        room_id = instance.id

        channel_layer = get_channel_layer()
        async_to_sync(channel_layer.group_send)(
            f'ts_room_{room_id}',
            {
                'type': 'room_deleted'
            }
        )

        async_to_sync(delete_livekit_room)(room_id)

        RoomMembership.objects.filter(room=instance).delete()
        instance.delete()

    @action(detail=True, methods=['post'], url_path='join')
    def join_private(self, request, pk=None):
        from django.contrib.auth.hashers import check_password
        room = self.get_object()
        password = request.data.get('password')

        #  ПЕРЕВІРКА 1: Користувач вже член кімнати
        existing_membership = room.memberships.filter(user=request.user).first()
        if existing_membership:
            return Response({"status": "already_member"})

        #  ПЕРЕВІРКА 2: Публічна кімната - вхід без пароля
        if not room.is_private:
            membership = RoomMembership.objects.create(user=request.user, room=room)
            return Response({"status": "joined"})

        #  ПЕРЕВІРКА 3: Приватна кімната - потребує пароль
        if not password:
            return Response(
                {"detail": "Пароль потрібен для приватної кімнати."},
                status=status.HTTP_403_FORBIDDEN
            )

        #  ПЕРЕВІРКА 4: Пароль має розумну довжину
        if len(password) > 500:
            return Response(
                {"detail": "Пароль занадто довгий."},
                status=status.HTTP_400_BAD_REQUEST
            )

        #  ПЕРЕВІРКА 5: Перевірка пароля (безпечна)
        if not room.password or not check_password(password, room.password):
            return Response(
                {"detail": "Невірний пароль."},
                status=status.HTTP_403_FORBIDDEN
            )

        #  ПЕРЕВІРКА 6: Створити членство
        membership = RoomMembership.objects.create(user=request.user, room=room)
        return Response({"status": "joined"})

    @action(detail=True, methods=['post'], url_path='join-with-link')
    def join_with_link(self, request, pk=None):
        room = self.get_object()
        invite_token = request.data.get('token')

        #  ПЕРЕВІРКА 1: Токен обов'язковий
        if not invite_token:
            return Response(
                {"detail": "Потрібен токен посилання."},
                status=status.HTTP_400_BAD_REQUEST
            )

        #  ПЕРЕВІРКА 2: Токен має розумну довжину (UUID)
        if len(str(invite_token)) > 100:
            return Response(
                {"detail": "Невірний формат токена."},
                status=status.HTTP_400_BAD_REQUEST
            )

        #  ПЕРЕВІРКА 3: Токен існує в БД
        try:
            invite = RoomInviteLink.objects.get(id=invite_token)
        except RoomInviteLink.DoesNotExist:
            return Response({"detail": "Невірне посилання."}, status=status.HTTP_404_NOT_FOUND)

        #  ПЕРЕВІРКА 4: Посилання належить цій кімнаті
        if invite.room_id != room.id:
            return Response(
                {"detail": "Посилання не належить цій кімнаті."},
                status=status.HTTP_403_FORBIDDEN
            )

        #  ПЕРЕВІРКА 5: Посилання ще дійсне
        if not invite.is_valid():
            return Response(
                {"detail": "Посилання закінчилось або вже використано."}, 
                status=status.HTTP_403_FORBIDDEN
            )

        # ПЕРЕВІРКА 6: Користувач вже член
        existing_membership = room.memberships.filter(user=request.user).first()
        if existing_membership:
            return Response({"status": "already_member"})

        #  ПЕРЕВІРКА 7: Створити членство та позначити посилання як використане
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

        #  ПЕРЕВІРКА 1: Тільки адміни можуть змінювати пароль
        is_admin = (
            room.created_by_id == request.user.id or 
            room.memberships.filter(user=request.user, role='admin').exists()
        )
        if not is_admin:
            return Response(
                {"detail": "Ви не адміністратор цієї кімнати."},
                status=status.HTTP_403_FORBIDDEN
            )

        #  ПЕРЕВІРКА 2: Тільки приватні кімнати мають пароль
        if not room.is_private:
            return Response(
                {"detail": "Тільки приватні кімнати мають пароль."},
                status=status.HTTP_400_BAD_REQUEST
            )

        #  ПЕРЕВІРКА 3: Новий пароль обов'язковий
        if not new_password:
            return Response(
                {"detail": "Пароль не може бути пустим."},
                status=status.HTTP_400_BAD_REQUEST
            )

        #  ПЕРЕВІРКА 4: Пароль має розумну довжину (min 3, max 500)
        if len(new_password) < 1:
            return Response(
                {"detail": "Пароль занадто короткий."},
                status=status.HTTP_400_BAD_REQUEST
            )
        if len(new_password) > 500:
            return Response(
                {"detail": "Пароль занадто довгий."},
                status=status.HTTP_400_BAD_REQUEST
            )

        #  ПЕРЕВІРКА 5: Зберегти новий пароль
        room.password = make_password(new_password)
        room.save()
        return Response({"status": "password_changed"})

    @action(detail=True, methods=['post'], url_path='generate-invite')
    def generate_invite_link(self, request, pk=None):
        room = self.get_object()

        #  ПЕРЕВІРКА 1: Тільки адміни можуть генерувати посилання
        is_admin = (
            room.created_by_id == request.user.id or 
            room.memberships.filter(user=request.user, role='admin').exists()
        )
        if not is_admin:
            return Response(
                {"detail": "Ви не адміністратор цієї кімнати."},
                status=status.HTTP_403_FORBIDDEN
            )

        #  ПЕРЕВІРКА 2: Тільки приватні кімнати мають посилання
        if not room.is_private:
            return Response(
                {"detail": "Посилання можуть генеруватися тільки для приватних кімнат."},
                status=status.HTTP_400_BAD_REQUEST
            )

        #  ПЕРЕВІРКА 3: Параметр expires_hours має розумну величину
        expires_hours = request.data.get('expires_hours', 24)
        try:
            expires_hours = int(expires_hours)
        except (ValueError, TypeError):
            return Response(
                {"detail": "expires_hours повинен бути числом."},
                status=status.HTTP_400_BAD_REQUEST
            )

        #  ПЕРЕВІРКА 4: Від 1 до 720 годин (30 днів)
        if expires_hours < 1 or expires_hours > 720:
            return Response(
                {"detail": "expires_hours повинен бути від 1 до 720 годин."},
                status=status.HTTP_400_BAD_REQUEST
            )

        #  ПЕРЕВІРКА 5: Створити посилання
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
        username = request.data.get('username', '').strip()

        #  ПЕРЕВІРКА 1: Тільки адміни можуть додавати членів
        is_admin = (
            room.created_by_id == request.user.id or 
            room.memberships.filter(user=request.user, role='admin').exists()
        )
        if not is_admin:
            return Response(
                {"detail": "Ви не адміністратор цієї кімнати."},
                status=status.HTTP_403_FORBIDDEN
            )

        #  ПЕРЕВІРКА 2: Тільки приватні кімнати мають членів для додавання
        if not room.is_private:
            return Response(
                {"detail": "Членів можна додавати тільки до приватних кімнат."},
                status=status.HTTP_400_BAD_REQUEST
            )

        #  ПЕРЕВІРКА 3: username обов'язковий
        if not username:
            return Response(
                {"detail": "username потрібен."},
                status=status.HTTP_400_BAD_REQUEST
            )

        #  ПЕРЕВІРКА 4: username має розумну довжину
        if len(username) > 150:
            return Response(
                {"detail": "username занадто довгий."},
                status=status.HTTP_400_BAD_REQUEST
            )

        #  ПЕРЕВІРКА 5: Користувач існує (однакова відповідь для всіх помилок)
        user = User.objects.filter(username=username).first()
        if not user:
            return Response(
                {"detail": "Не вдалося додати користувача. Перевірте дані."},
                status=status.HTTP_403_FORBIDDEN
            )

        # ПЕРЕВІРКА 6: Не дозволяти додавати себе самого (якщо вже член)
        if user.id == request.user.id:
            existing = room.memberships.filter(user=user).first()
            if existing:
                return Response({
                    "status": "already_member",
                    "username": user.username
                })

        #  ПЕРЕВІРКА 7: Додати або отримати членство
        membership, created = RoomMembership.objects.get_or_create(
            user=user, 
            room=room,
            defaults={'role': 'member'}
        )

        return Response({
            "status": "added" if created else "already_member",
            "username": user.username
        })

    @action(detail=True, methods=['post'], url_path='remove-member')
    def remove_member(self, request, pk=None):
        room = self.get_object()
        username = request.data.get('username', '').strip()

        #  ПЕРЕВІРКА 1: Тільки адміни можуть видаляти членів
        is_admin = (
            room.created_by_id == request.user.id or 
            room.memberships.filter(user=request.user, role='admin').exists()
        )
        if not is_admin:
            return Response(
                {"detail": "Ви не адміністратор цієї кімнати."},
                status=status.HTTP_403_FORBIDDEN
            )

        #  ПЕРЕВІРКА 2: Тільки приватні кімнати мають членів для видалення
        if not room.is_private:
            return Response(
                {"detail": "Членів можна видаляти тільки з приватних кімнат."},
                status=status.HTTP_400_BAD_REQUEST
            )

        #  ПЕРЕВІРКА 3: username обов'язковий
        if not username:
            return Response(
                {"detail": "username потрібен."},
                status=status.HTTP_400_BAD_REQUEST
            )

        #  ПЕРЕВІРКА 4: username має розумну довжину
        if len(username) > 150:
            return Response(
                {"detail": "username занадто довгий."},
                status=status.HTTP_400_BAD_REQUEST
            )

        #  ПЕРЕВІРКА 5: Користувач існує (🛡️ БЕЗПЕКА: однакова відповідь для всіх помилок)
        user = User.objects.filter(username=username).first()
        if not user:
            return Response(
                {"detail": "Не вдалося видалити користувача. Перевірте дані."},
                status=status.HTTP_403_FORBIDDEN
            )

        #  ПЕРЕВІРКА 6: Не дозволяти видаляти адміна кімнати
        if user.id == room.created_by_id:
            return Response(
                {"detail": "Не можна видалити адміна кімнати."},
                status=status.HTTP_403_FORBIDDEN
            )

        #  ПЕРЕВІРКА 7: Не дозволяти видаляти себе самого
        if user.id == request.user.id:
            return Response(
                {"detail": "Використовуйте 'leave' для виходу з кімнати."},
                status=status.HTTP_400_BAD_REQUEST
            )

        #  ПЕРЕВІРКА 8: Користувач є членом кімнати
        try:
            membership = RoomMembership.objects.get(user=user, room=room)
            membership.delete()


            channel_layer = get_channel_layer()

            async_to_sync(channel_layer.group_send)(
                f'ts_room_{room.id}',
                {
                    'type': 'force_disconnect',
                    'user_id': user.id
                }
            )

            async_to_sync(kick_from_livekit)(room.id, user.id)

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

        #  ПЕРЕВІРКА 1: Користувач автентифікований (permissions)
        #  ПЕРЕВІРКА 2: Користувач є членом кімнати (IsRoomMember)

        #  ПЕРЕВІРКА 3: Не дозволяти адміну просто покинути кімнату
        if user.id == room.created_by_id:
            return Response(
                {"detail": "Адміністратор не може покинути кімнату. Видаліть кімнату замість цього."},
                status=status.HTTP_403_FORBIDDEN
            )

        #  ПЕРЕВІРКА 4: Видалити членство
        try:
            membership = RoomMembership.objects.get(user=user, room=room)
            membership.delete()
            return Response({"status": "left"})
        except RoomMembership.DoesNotExist:
            return Response(
                {"detail": "Ви не є членом цієї кімнати."},
                status=status.HTTP_404_NOT_FOUND
            )

    @action(detail=True, methods=['get'], url_path='members')
    def members(self, request, pk=None):
        room = self.get_object()

        #  БЕЗПЕКА: Тільки адміни можуть переглядати повний список членів
        is_admin = (
            room.created_by_id == request.user.id or 
            room.memberships.filter(user=request.user, role='admin').exists()
        )
        if not is_admin:
            return Response(
                {"detail": "Нема прав для перегляду списку членів."},
                status=status.HTTP_403_FORBIDDEN
            )

        #  Отримати всіх членів кімнати з пагінацією
        members_queryset = room.memberships.select_related('user').order_by('-joined_at')

        #  ПАГІНАЦІЯ: 20 членів на сторінку
        page_size = request.query_params.get('page_size', 20)
        try:
            page_size = int(page_size)
            if page_size < 1 or page_size > 100:
                page_size = 20
        except (ValueError, TypeError):
            page_size = 20

        paginator = Paginator(members_queryset, page_size)
        page_number = request.query_params.get('page', 1)

        try:
            page_obj = paginator.page(page_number)
        except:
            page_obj = paginator.page(1)

       
        members_data = [
            {
                'username': membership.user.username,
                'role': membership.role,
                'joined_at': membership.joined_at.isoformat()
            }
            for membership in page_obj
        ]

        return Response({
            'count': paginator.count,
            'next': paginator.num_pages > int(page_number) if page_number else False,
            'previous': int(page_number) > 1 if page_number else False,
            'num_pages': paginator.num_pages,
            'results': members_data
        })

    @action(detail=True, methods=['get'], url_path='messages')
    def messages(self, request, pk=None):
        room = self.get_object()
  
        messages_queryset = ChatMessage.objects.filter(
            room=room
        ).select_related('user').order_by('-created_at')


        paginator = Paginator(messages_queryset, 50)
        page_number = request.query_params.get('page', 1)
        try:
            page_obj = paginator.page(page_number)
        except:
            page_obj = paginator.page(1)

        serializer = ChatMessageSerializer(page_obj, many=True)
        return Response({
            'count': paginator.count,
            'next': paginator.num_pages > int(page_number),
            'results': serializer.data
        })


class LiveKitTokenThrottle(UserRateThrottle):
    scope = 'livekit_token'  

import logging

logger = logging.getLogger(__name__)

class LiveKitTokenView(APIView):


    action = 'retrieve' 
    
    permission_classes = [IsAuthenticated] 

    throttle_classes = []


    def get(self, request, pk):
        user = request.user


        if not user or not user.is_authenticated:
            return Response(
                {"detail": "Дані не були надані (Користувач не автентифікований)."},
                status=status.HTTP_401_UNAUTHORIZED
            )


        throttle = LiveKitTokenThrottle()
        if not throttle.allow_request(request, self):
            wait = throttle.wait()
            return Response(
                {"detail": f"Забагато запитів. Спробуйте знову через {wait} секунд(и)."},
                status=status.HTTP_429_TOO_MANY_REQUESTS
            )


        room_obj = get_object_or_404(Room, id=pk)


        permission_checker = IsRoomMember()
        if not permission_checker.has_object_permission(request, self, room_obj):
            return Response(
                {"detail": "У вас немає прав для доступу до цієї кімнати (Ви не є її учасником)."},
                status=status.HTTP_403_FORBIDDEN
            )

        if not room_obj.is_private:
            membership, created = RoomMembership.objects.get_or_create(
                user=user, 
                room=room_obj,
                defaults={'role': 'member'}
            )
        else:
            membership = room_obj.memberships.filter(user=user).first()


        is_admin = False
        can_publish = True  

        if membership:
            if membership.role == 'admin':
                is_admin = True
            elif membership.role == 'muted':  #для майбутнього, якщо буде роль muted (?)
                can_publish = False  


        try:
            grant = api.AccessToken(settings.LIVEKIT_API_KEY, settings.LIVEKIT_API_SECRET) \
                .with_identity(str(user.id)) \
                .with_ttl(timedelta(minutes=5))\
                .with_name(user.username) \
                .with_grants(api.VideoGrants(
                    room_join=True,
                    room=f"room_{room_obj.id}",
                    can_publish=can_publish,  
                    can_subscribe=True,   
                    room_admin=is_admin   
                ))

            return Response({
                "token": grant.to_jwt(),
                "livekit_url": settings.LIVEKIT_URL
            }, status=status.HTTP_200_OK)

        except Exception as e:
            logger.error(f"Помилка генерації токена LiveKit для користувача {user.id}: {e}")
            return Response(
                {"detail": "Внутрішня помилка сервера при ініціалізації медіа-сесії."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )


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
