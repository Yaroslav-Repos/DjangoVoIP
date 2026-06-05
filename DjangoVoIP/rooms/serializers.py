from rest_framework import serializers
from django.contrib.auth.models import User
from .models import Room, ChatMessage, RoomInviteLink

class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ['id', 'username']

class RoomSerializer(serializers.ModelSerializer):
    created_by = UserSerializer(read_only=True)
    password = serializers.CharField(write_only=True, required=False, allow_blank=True, style={'input_type': 'password'})
    is_admin = serializers.SerializerMethodField()

    class Meta:
        model = Room
        fields = ['id', 'name', 'is_private', 'password', 'created_by', 'created_at', 'is_admin']

    def create(self, validated_data):
        password = validated_data.pop('password', None)
        if validated_data.get('is_private') and password:
            from django.contrib.auth.hashers import make_password
            validated_data['password'] = make_password(password)
        else:
            validated_data['password'] = ''
        return super().create(validated_data)

    def get_is_admin(self, obj):
        request = self.context.get('request')
        if not request:
            return False
        
        return obj.created_by_id == request.user.id or obj.memberships.filter(
            user=request.user, role='admin'
        ).exists()

class ChatMessageSerializer(serializers.ModelSerializer):
    user = UserSerializer(read_only=True)

    class Meta:
        model = ChatMessage
        fields = ['id', 'user', 'text', 'created_at']

class RoomInviteLinkSerializer(serializers.ModelSerializer):
    class Meta:
        model = RoomInviteLink
        fields = ['id', 'created_at', 'expires_at', 'is_used']
        read_only_fields = ['id', 'created_at', 'expires_at', 'is_used']
