from rest_framework import serializers
from django.contrib.auth.models import User
from .models import Room, ChatMessage

class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ['id', 'username']

class RoomSerializer(serializers.ModelSerializer):
    created_by = UserSerializer(read_only=True)
    password = serializers.CharField(write_only=True, required=False, style={'input_type': 'password'})

    class Meta:
        model = Room
        fields = ['id', 'name', 'is_private', 'password', 'created_by', 'created_at']

    def create(self, validated_data):
        if validated_data.get('is_private') and validated_data.get('password'):
            from django.contrib.auth.hashers import make_password
            validated_data['password'] = make_password(validated_data['password'])
        return super().create(validated_data)

class ChatMessageSerializer(serializers.ModelSerializer):
    user = UserSerializer(read_only=True)

    class Meta:
        model = ChatMessage
        fields = ['id', 'user', 'text', 'created_at']
