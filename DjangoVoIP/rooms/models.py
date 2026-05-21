import uuid
from django.db import models
from django.contrib.auth.models import User

class Room(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=100)
    is_private = models.BooleanField(default=False)
    password = models.CharField(max_length=128, blank=True, null=True)
    created_by = models.ForeignKey(User, on_delete=models.CASCADE, related_name="owned_rooms")
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.name

class RoomMembership(models.Model):
    ROLE_CHOICES = [('admin', 'Admin'), ('member', 'Member')]
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="memberships")
    room = models.ForeignKey(Room, on_delete=models.CASCADE, related_name="memberships")
    role = models.CharField(max_length=10, choices=ROLE_CHOICES, default='member')
    joined_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('user', 'room')

class ChatMessage(models.Model):
    room = models.ForeignKey(Room, on_delete=models.CASCADE, related_name="messages")
    user = models.ForeignKey(User, on_delete=models.CASCADE)
    text = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
