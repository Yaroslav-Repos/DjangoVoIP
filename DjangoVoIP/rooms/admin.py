from django.contrib import admin
from .models import Room, RoomMembership, ChatMessage, RoomInviteLink


@admin.register(Room)
class RoomAdmin(admin.ModelAdmin):
    list_display = ('name', 'is_private', 'created_by', 'created_at')
    search_fields = ('name',)
    list_filter = ('is_private', 'created_at')


@admin.register(RoomMembership)
class RoomMembershipAdmin(admin.ModelAdmin):
    list_display = ('user', 'room', 'role', 'joined_at')
    search_fields = ('user__username', 'room__name')
    list_filter = ('role', 'joined_at')


@admin.register(ChatMessage)
class ChatMessageAdmin(admin.ModelAdmin):
    list_display = ('user', 'room', 'created_at')
    search_fields = ('user__username', 'room__name', 'text')
    list_filter = ('created_at',)


@admin.register(RoomInviteLink)
class RoomInviteLinkAdmin(admin.ModelAdmin):
    list_display = (
        'room',
        'created_by',
        'expires_at',
        'is_used',
        'used_by',
        'used_at'
    )
    search_fields = (
        'room__name',
        'created_by__username',
        'used_by__username'
    )
    list_filter = ('is_used', 'created_at', 'expires_at')
