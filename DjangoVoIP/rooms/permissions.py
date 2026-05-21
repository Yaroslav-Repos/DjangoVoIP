from rest_framework import permissions

class IsRoomMember(permissions.BasePermission):
    def has_object_permission(self, request, view, obj):
        return obj.created_by == request.user or obj.memberships.filter(user=request.user).exists()
