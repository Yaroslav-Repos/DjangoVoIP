from rest_framework import permissions

class IsRoomMember(permissions.BasePermission):
    def has_permission(self, request, view):
        return request.user and request.user.is_authenticated

    def has_object_permission(self, request, view, obj):
        # Публічні кімнати - всім дозволено
        if not obj.is_private:
            return True

        # Приватні - тільки членам або через join endpoints
        # Якщо це запит на join - дозвіл дати в самому методі
        if view.action in ['join_private', 'join_with_link']:
            return True

        # Інші операції - тільки члени
        return obj.created_by_id == request.user.id or obj.memberships.filter(user=request.user).exists()

class IsRoomAdmin(permissions.BasePermission):
    def has_permission(self, request, view):
        return request.user and request.user.is_authenticated

    def has_object_permission(self, request, view, obj):
        #  Перевірка ID до порівняння об'єктів
        if obj.created_by_id == request.user.id:
            return True
        membership = obj.memberships.filter(user=request.user, role='admin').exists()
        return membership
