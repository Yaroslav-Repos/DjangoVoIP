import random
from datetime import timedelta

from django.contrib.auth.models import User
from django.utils import timezone
from faker import Faker

from rooms.models import (
    Room,
    RoomMembership,
    ChatMessage,
    RoomInviteLink,
)

fake = Faker("uk_UA")

ROOMS_COUNT = 500
MESSAGES_PER_ROOM = 500
USERS_COUNT = 50

print("Створення користувачів...")

users = []

for i in range(USERS_COUNT):
    username = f"user_{i}"

    user, created = User.objects.get_or_create(
        username=username,
        defaults={
            "email": f"{username}@example.com",
        }
    )

    if created:
        user.set_password("12345678")
        user.save()

    users.append(user)

print(f"Користувачів готово: {len(users)}")

print("Створення кімнат...")

rooms = []

for i in range(ROOMS_COUNT):
    owner = random.choice(users)

    room = Room.objects.create(
        name=fake.company(),
        is_private=random.choice([True, False]),
        password="1234" if random.choice([True, False]) else None,
        created_by=owner,
    )

    rooms.append(room)

    # creator membership
    RoomMembership.objects.get_or_create(
        user=owner,
        room=room,
        defaults={"role": "admin"}
    )

    # random members
    random_members = random.sample(users, random.randint(5, 20))

    memberships = []

    for member in random_members:
        memberships.append(
            RoomMembership(
                user=member,
                room=room,
                role="member"
            )
        )

    RoomMembership.objects.bulk_create(
        memberships,
        ignore_conflicts=True
    )

print(f"Кімнат створено: {len(rooms)}")

print("Створення invite links...")

invite_links = []

for room in rooms:
    invite_links.append(
        RoomInviteLink(
            room=room,
            created_by=room.created_by,
            expires_at=timezone.now() + timedelta(days=7),
            is_used=False,
        )
    )

RoomInviteLink.objects.bulk_create(invite_links)

print(f"Invite links створено: {len(invite_links)}")

print("Створення повідомлень...")

all_messages = []

for idx, room in enumerate(rooms, start=1):
    members = list(
        User.objects.filter(memberships__room=room).distinct()
    )

    for _ in range(MESSAGES_PER_ROOM):
        user = random.choice(members)

        all_messages.append(
            ChatMessage(
                room=room,
                user=user,
                text=fake.text(max_nb_chars=200),
                created_at=timezone.now() - timedelta(
                    minutes=random.randint(0, 100000)
                )
            )
        )

    # batch insert кожні 10 кімнат
    if idx % 10 == 0:
        ChatMessage.objects.bulk_create(all_messages, batch_size=5000)
        print(f"Оброблено кімнат: {idx}")
        all_messages = []

# залишок
if all_messages:
    ChatMessage.objects.bulk_create(all_messages, batch_size=5000)

print("Готово.")
