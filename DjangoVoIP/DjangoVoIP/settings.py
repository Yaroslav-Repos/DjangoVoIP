"""
Django settings for DjangoVoIP project.

Based on 'django-admin startproject' using Django 2.1.2.

For more information on this file, see
https://docs.djangoproject.com/en/2.1/topics/settings/

For the full list of settings and their values, see
https://docs.djangoproject.com/en/2.1/ref/settings/
"""

import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()


#LIVEKIT_URL = "wss://yaroslavtestapp-75ga8j7b.livekit.cloud"
LIVEKIT_URL = "https://sfu.yaroslavtestapp.pp.ua"
LIVEKIT_API_KEY = "APIoXqcf2a35e9F"
LIVEKIT_API_SECRET = "3hqwCqWCgyRzeQxIrwgkXk5hSAi1d5HUzxq2dDMNHwM"


BASE_DIR = Path(__file__).resolve().parent.parent
SECRET_KEY = os.environ.get('SECRET_KEY', 'django-secret-key-test')
DEBUG = os.environ.get('DEBUG', 'True') == 'True'

ALLOWED_HOSTS = ["*"]

CORS_ALLOWED_ORIGINS = [
    "http://localhost:8000",
    "http://127.0.0.1:8000",
    "http://0.0.0.0:8000",
    "http://192.168.0.200:8000",
    "http://192.168.0.132:8000",
    "http://192.168.1.100:8000",
    "http://192.168.100.100:8000",
    "https://localhost:8000",
    "https://127.0.0.1:8000",
    "https://0.0.0.0:8000",
    "https://192.168.0.200:8000",
    "https://192.168.0.132:8000",
    "https://192.168.1.100:8000",
    "https://192.168.100.100:8000",
    "https://yaroslavtestapp.pp.ua"
]

CSRF_TRUSTED_ORIGINS = [
    'http://localhost:8000',
    'http://127.0.0.1:8000',
    'http://0.0.0.0:8000',
    'http://192.168.0.200:8000',
    'http://192.168.0.132:8000',
    'http://192.168.1.100:8000',
    'http://192.168.100.100:8000',
    'https://localhost:8000',
    'https://127.0.0.1:8000',
    'https://0.0.0.0:8000',
    'https://192.168.0.200:8000',
    'https://192.168.0.132:8000',
    'https://192.168.1.100:8000',
    'https://192.168.100.100:8000',
    'https://yaroslavtestapp.pp.ua'
]

INSTALLED_APPS = [
    'daphne',
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'rest_framework',
    'channels',
    'rooms',
    'django_extensions'
]

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'whitenoise.middleware.WhiteNoiseMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
    
]

ROOT_URLCONF = 'DjangoVoIP.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [BASE_DIR / 'templates'],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.debug',
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'DjangoVoIP.wsgi.application'
ASGI_APPLICATION = 'DjangoVoIP.asgi.application'

DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.sqlite3',
        'NAME': BASE_DIR / 'db.sqlite3',
    }
}

# Channel Layers Configuration

if DEBUG:
    CHANNEL_LAYERS = {
        'default': {
            'BACKEND': 'channels.layers.InMemoryChannelLayer'
        }
    }
    CACHES = {
    'default': {
        'BACKEND': 'django.core.cache.backends.locmem.LocMemCache',
        'LOCATION': 'presence-cache-unique-name',
    }
}
else:
    CHANNEL_LAYERS = {
        'default': {
            'BACKEND': 'channels_redis.core.RedisChannelLayer',
            'CONFIG': {
                "hosts": [os.environ.get('REDIS_URL', 'redis://127.0.0.1:6379/0')],
            },
        },
    }

REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': [
        'rest_framework.authentication.SessionAuthentication',
    ],
    'DEFAULT_PAGINATION_CLASS': 'rest_framework.pagination.PageNumberPagination',
    'PAGE_SIZE': 10,
    'DEFAULT_THROTTLE_RATES': {
        'livekit_token': '6/minute',
    }
}

STATIC_URL = '/static/'
STATICFILES_DIRS = [BASE_DIR / 'static']
STATIC_ROOT = BASE_DIR / 'staticfiles'

STATICFILES_STORAGE = 'whitenoise.storage.CompressedManifestStaticFilesStorage'

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'
LOGIN_URL = 'login'

# HTTPS/Security Settings
SECURE_SSL_REDIRECT = False  # Set to True only when using HTTPS in production
SECURE_HSTS_SECONDS = 0  # Set to 31536000 (1 year) in production
SECURE_HSTS_INCLUDE_SUBDOMAINS = False
SECURE_HSTS_PRELOAD = False
SESSION_COOKIE_SECURE = False  # Set to True when using HTTPS
CSRF_COOKIE_SECURE = False  # Set to True when using HTTPS