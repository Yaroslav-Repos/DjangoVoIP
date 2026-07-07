# DjangoVoIP

A real-time video conferencing application built with Django, Django REST Framework, and LiveKit. Features include WebRTC-powered video calls, real-time chat, room management, and WebSocket-based live communication.

> 💡 **Inspired by Discord** - This project combines Discord's intuitive room-based communication model with robust video conferencing capabilities, creating a self-hosted alternative for team collaboration and real-time communication.

## 🌟 Features

- **Video Conferencing**: Real-time video calls powered by [LiveKit](https://livekit.io/) SFU (Selective Forwarding Unit)
- **Real-time Chat**: WebSocket-based instant messaging within rooms
- **Room Management**: Create, delete, and manage conference rooms
- **User Authentication**: Secure registration and login system
- **Private Rooms**: Password-protected rooms with invite links
- **Room Permissions**: Admin and member roles with access control
- **Responsive UI**: Progressive Web App (PWA) compatible interface
- **Live Notifications**: Real-time updates using Django Channels

## 🛠️ Tech Stack

- **Backend**: Django 3.2+ with Django REST Framework
- **Real-time Communication**: Django Channels 4.0+ with WebSocket support
- **Video Infrastructure**: LiveKit (requires separate deployment or cloud account)
- **Frontend**: HTML5, CSS3, JavaScript (Vanilla)
- **Database**: SQLite (development) / PostgreSQL (production)
- **Server**: Daphne ASGI server
- **Authentication**: Django built-in authentication

## 📋 Prerequisites

- Python 3.8+
- pip (Python package manager)
- LiveKit server access (self-hosted or cloud)
  - LiveKit URL
  - LiveKit API Key
  - LiveKit API Secret

## 🚀 Quick Start

### 1. Clone the Repository

```bash
git clone https://github.com/Yaroslav-Repos/DjangoVoIP.git
cd DjangoVoIP
```

### 2. Create Virtual Environment

```bash
# Windows
python -m venv venv
venv\Scripts\activate

# macOS/Linux
python3 -m venv venv
source venv/bin/activate
```

### 3. Install Dependencies

```bash
pip install -r requirements.txt
```

### 4. Configure Environment Variables

Create a `.env` file in the root directory:

```env
# Django Settings
SECRET_KEY=your-secret-key-here
DEBUG=True
ALLOWED_HOSTS=localhost,127.0.0.1,0.0.0.0

# LiveKit Configuration
LIVEKIT_URL=https://your-livekit-server.com
LIVEKIT_API_KEY=your-api-key
LIVEKIT_API_SECRET=your-api-secret

# Database (optional, uses SQLite by default)
# DATABASE_URL=postgresql://user:password@localhost/djangovoip
```

### 5. Run Database Migrations

```bash
python manage.py migrate
```

### 6. Create Superuser (Optional)

```bash
python manage.py createsuperuser
```

### 7. Start the Development Server

```bash
# Using Daphne ASGI server (recommended for WebSocket support)
daphne -b 0.0.0.0 -p 8000 DjangoVoIP.asgi:application

# Or use Django development server (WebSocket may not work)
python manage.py runserver
```

Visit `http://localhost:8000` in your browser.

## 📚 Project Structure

```
DjangoVoIP/
├── DjangoVoIP/              # Main project configuration
│   ├── settings.py          # Django settings
│   ├── urls.py              # URL routing
│   ├── asgi.py              # ASGI configuration for WebSocket
│   └── wsgi.py              # WSGI configuration for HTTP
├── rooms/                   # Main application
│   ├── models.py            # Database models
│   ├── views.py             # API views and web views
│   ├── serializers.py       # DRF serializers
│   ├── consumers.py         # WebSocket consumers
│   ├── permissions.py       # Custom permissions
│   ├── urls.py              # App URL routing
│   └── utils.py             # Utility functions
├── templates/               # HTML templates
├── static/                  # Static files (CSS, JS, images)
├── manage.py                # Django management script
└── requirements.txt         # Python dependencies
```

## 📖 API Endpoints

### Authentication
- `GET/POST /register/` - User registration
- `GET/POST /login/` - User login
- `GET /logout/` - User logout

### Rooms
- `GET/POST /api/rooms/` - List and create rooms
- `GET /api/rooms/{id}/` - Get room details
- `DELETE /api/rooms/{id}/` - Delete room
- `POST /api/rooms/{id}/join/` - Join private room with password
- `POST /api/rooms/{id}/join-with-link/` - Join with invite link
- `POST /api/rooms/{id}/leave/` - Leave room
- `GET /api/rooms/{id}/members/` - Get room members
- `POST /api/rooms/{id}/add-member/` - Add member to room
- `POST /api/rooms/{id}/remove-member/` - Remove member from room
- `POST /api/rooms/{id}/generate-invite/` - Generate invite link
- `POST /api/rooms/{id}/change-password/` - Change room password

### Chat & Messages
- `GET /api/rooms/{id}/messages/` - Get room chat messages

### Utilities
- `/about/` - About page
- `/menu/` - Main menu

## 💻 Usage Examples

### Create a Room

```javascript
// Frontend JavaScript
async function createRoom() {
  const response = await fetch('/api/rooms/', {
	method: 'POST',
	headers: {
	  'Content-Type': 'application/json',
	  'X-CSRFToken': getCookie('csrftoken')
	},
	body: JSON.stringify({
	  name: 'Team Meeting',
	  is_private: false
	})
  });

  const room = await response.json();
  console.log('Room created:', room);
}
```

### Join a Room

```javascript
// Join public room
async function joinRoom(roomId) {
  const response = await fetch(`/api/rooms/${roomId}/`, {
	method: 'GET'
  });

  const room = await response.json();
  // Redirect to room page
  window.location.href = `/room/${roomId}/`;
}

// Join private room with password
async function joinPrivateRoom(roomId, password) {
  const response = await fetch(`/api/rooms/${roomId}/join/`, {
	method: 'POST',
	headers: {
	  'Content-Type': 'application/json',
	  'X-CSRFToken': getCookie('csrftoken')
	},
	body: JSON.stringify({ password })
  });

  if (response.ok) {
	window.location.href = `/room/${roomId}/`;
  }
}
```

### WebSocket Chat Connection

```javascript
// Frontend WebSocket
const roomId = '12345678-1234-5678-1234-567812345678';
const chatSocket = new WebSocket(
  `ws://${window.location.host}/ws/room/${roomId}/`
);

chatSocket.onopen = function() {
  console.log('Chat connected');
};

chatSocket.onmessage = function(e) {
  const message = JSON.parse(e.data);
  console.log('Message:', message.text);
};

// Send message
function sendMessage(text) {
  chatSocket.send(JSON.stringify({
	type: 'chat_message',
	message: text
  }));
}
```

### Generate Invite Link

```javascript
async function generateInviteLink(roomId) {
  const response = await fetch(`/api/rooms/${roomId}/generate-invite/`, {
	method: 'POST',
	headers: {
	  'X-CSRFToken': getCookie('csrftoken')
	}
  });

  const data = await response.json();
  console.log('Invite link ID:', data.id);
  // Share link: /room/{roomId}/?invite={link_id}
}
```

## 🔒 Security Notes

1. **Environment Variables**: Never commit `.env` file to version control
2. **HTTPS**: Always use HTTPS in production
3. **CORS**: Configure CORS allowed origins in `settings.py`
4. **CSRF Protection**: Django CSRF middleware is enabled by default
5. **Password Hashing**: Room passwords are hashed using Django's password hashing
6. **Rate Limiting**: Consider adding rate limiting for API endpoints in production

## 🐳 Docker Deployment (Optional)

Create a `Dockerfile`:

```dockerfile
FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

ENV PYTHONUNBUFFERED=1

CMD ["daphne", "-b", "0.0.0.0", "-p", "8000", "DjangoVoIP.asgi:application"]
```

Build and run:

```bash
docker build -t djangovoip .
docker run -p 8000:8000 --env-file .env djangovoip
```

## 📦 Production Deployment

### Using Gunicorn + Nginx

```bash
pip install gunicorn
gunicorn -w 4 -b 0.0.0.0:8000 DjangoVoIP.wsgi:application
```

For WebSocket support, use Daphne:

```bash
daphne -b 0.0.0.0 -p 8000 DjangoVoIP.asgi:application
```

### Configure Nginx as Reverse Proxy

```nginx
server {
	listen 80;
	server_name your-domain.com;

	location / {
		proxy_pass http://127.0.0.1:8000;
		proxy_set_header Host $host;
		proxy_set_header X-Real-IP $remote_addr;
		proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
		proxy_set_header X-Forwarded-Proto $scheme;
	}

	location /ws/ {
		proxy_pass http://127.0.0.1:8000;
		proxy_http_version 1.1;
		proxy_set_header Upgrade $http_upgrade;
		proxy_set_header Connection "upgrade";
		proxy_set_header Host $host;
	}
}
```

## 🧪 Testing

Run tests:

```bash
python manage.py test
```

Load sample data:

```bash
python seed.py
```

## 📝 Environment Configuration Details

| Variable | Description | Default |
|----------|-------------|---------|
| `SECRET_KEY` | Django secret key | `django-secret-key-test` |
| `DEBUG` | Enable debug mode | `True` |
| `LIVEKIT_URL` | LiveKit server URL | `https://sfu.yaroslavtestapp.pp.ua` |
| `LIVEKIT_API_KEY` | LiveKit API key | (required) |
| `LIVEKIT_API_SECRET` | LiveKit API secret | (required) |
| `ALLOWED_HOSTS` | Allowed host domains | `*` |

## 🔗 Resources

- [Django Documentation](https://docs.djangoproject.com/)
- [Django REST Framework](https://www.django-rest-framework.org/)
- [Django Channels](https://channels.readthedocs.io/)
- [LiveKit Documentation](https://docs.livekit.io/)
- [WebSocket API](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket)

## 📊 Project Status

- ✅ Core video conferencing functionality
- ✅ Real-time chat system
- ✅ Room management
- ✅ User authentication
- 🚧 Additional features in development

---
